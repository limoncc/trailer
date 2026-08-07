"""Static extraction of nn.Module structure into a viewer-friendly JSON graph.

Design:
- No forward pass needed. Works on meta-device models (zero memory).
- Node id = dot path ("root", "root.layers.0", ...).
- Structural fingerprint dedup: consecutive siblings with identical structure
  are merged into one node with repeat.count = N.
- Edges: sequential "seq" edges are emitted for nn.Sequential containers
  (order is guaranteed). Real tensor-flow edges come from hooks.trace_edges.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Optional

import torch
import torch.nn as nn

MAX_BREAKDOWN = 12  # max direct params listed per node


# ---------------------------------------------------------------- helpers

def _fmt_params(n: int) -> str:
    if n >= 1e9:
        return f"{n / 1e9:.2f}B"
    if n >= 1e6:
        return f"{n / 1e6:.2f}M"
    if n >= 1e3:
        return f"{n / 1e3:.1f}K"
    return str(n)


def _parse_extra_repr(s: str) -> dict[str, Any]:
    """Parse 'in_features=512, out_features=2048, bias=True' into a dict."""
    attrs: dict[str, Any] = {}
    if not s or "\n" in s:
        return attrs
    # split on commas not inside brackets
    parts = re.split(r",\s*(?![^()\[\]]*[)\]])", s)
    for part in parts:
        if "=" in part:
            k, _, v = part.partition("=")
            k, v = k.strip(), v.strip()
            if k.isidentifier():
                attrs[k] = v
        else:
            p = part.strip()
            if p:
                attrs.setdefault("_args", []).append(p)
    if "_args" in attrs:
        attrs["_args"] = ", ".join(attrs["_args"])
    return attrs


def _io_hint(module: nn.Module) -> Optional[dict[str, str]]:
    """Derive input/output feature hints from hyper-params, no forward needed."""
    if isinstance(module, nn.Linear):
        return {"in": f"(*, {module.in_features})", "out": f"(*, {module.out_features})"}
    if isinstance(module, nn.Embedding):
        return {"in": "(*) int", "out": f"(*, {module.embedding_dim})"}
    if isinstance(module, (nn.Conv1d, nn.Conv2d, nn.Conv3d)):
        return {"in": f"(N, {module.in_channels}, ...)", "out": f"(N, {module.out_channels}, ...)"}
    if isinstance(module, nn.MultiheadAttention):
        d = module.embed_dim
        return {"in": f"(*, {d})", "out": f"(*, {d})"}
    if isinstance(module, nn.LayerNorm):
        shape = "x".join(str(s) for s in module.normalized_shape)
        return {"in": f"(*, {shape})", "out": f"(*, {shape})"}
    return None


def _detect_moe_experts(module: nn.Module) -> int:
    """Return the expert count if `module` is a *fused* MoE experts container.

    Fused experts (e.g. transformers Qwen3_5MoeExperts) store all experts as a
    single set of weights whose leading dim equals the expert count, instead of
    an nn.ModuleList. We expand them into virtual `expert xN` leaves so the
    structure is readable and param accounting stays correct.

    We only match genuine fused-expert leaves: a module that exposes `num_experts`,
    has a parameter whose leading dim equals that count, AND has no substantial
    submodules of its own (so a top-level model that merely *references*
    num_experts is not mistaken for an experts block).
    """
    ne = getattr(module, "num_experts", None)
    if not isinstance(ne, int) or ne <= 1:
        return 0
    # Only a *fused* experts block has 3D weights whose leading dim == num_experts
    # (e.g. gate_up_proj [ne, 2*inter, hidden]). A router (TopKRouter) also carries
    # `num_experts` but only a 2D routing weight, so we exclude it here.
    has_fused = any(getattr(p, "ndim", len(getattr(p, "shape", ()))) >= 3 and getattr(p, "shape", ())[:1] == (ne,) for p in module.parameters())
    if not has_fused:
        return 0
    has_real_children = any(
        any(True for _ in c.parameters()) or any(True for _ in c.children())
        for _, c in module.named_children()
    )
    return ne if not has_real_children else 0


def _make_moe_expert_node(module: nn.Module, path: str, ne: int) -> dict:
    """Build a single folded 'expert xN' CONTAINER.

    It shows the internal SwiGLU sub-structure of *one representative* expert
    (gate_up_proj -> SwiGLU -> down_proj) so the fused MoE block is explorable.
    The xN badge on the node indicates all experts share this identical layout.
    """
    total = sum(p.numel() for p in module.parameters())
    per = total // ne if ne else total

    # Per-expert projection leaves reconstructed from the fused weights.
    proj_children: list[dict] = []
    for name, p in module.named_parameters(recurse=False):
        shape = getattr(p, "shape", ())
        if not (getattr(p, "ndim", len(shape)) >= 1 and shape[:1] == (ne,)):
            continue
        per_shape = list(shape[1:])
        val = int(p.numel() // ne)
        attrs = {}
        if len(per_shape) == 2:
            attrs = {"in_features": per_shape[1], "out_features": per_shape[0]}
        # Linear weight shape is (out_features, in_features)
        inp = per_shape[-1] if per_shape else 0
        out = per_shape[0] if per_shape else 0
        proj_children.append({
            "id": f"{path}.expert.{name}",
            "name": name,
            "class": "Linear",
            "kind": "leaf",
            "params": {"total": val, "trainable": val, "self": val, "fmt": _fmt_params(val)},
            "param_breakdown": [{"label": name, "shape": per_shape, "value": val, "fmt": _fmt_params(val)}],
            "attrs": attrs,
            "io_hint": {"in": f"(*, {inp})", "out": f"(*, {out})"},
        })

    # SwiGLU activation inserted after the first (up) projection.
    act = {
        "id": f"{path}.expert.act_fn",
        "name": "act_fn",
        "class": "SwiGLU",
        "kind": "leaf",
        "params": {"total": 0, "trainable": 0, "self": 0, "fmt": "0"},
        "io_hint": {"in": "(*, 2·inter)", "out": "(*, inter)"},
    }
    children = []
    if proj_children:
        children.append(proj_children[0])
        children.append(act)
        children.extend(proj_children[1:])

    return {
        "id": f"{path}.expert",
        "name": "expert",
        "class": type(module).__name__.replace("Experts", "Expert"),
        "kind": "container",
        "params": {"total": per, "trainable": per, "self": per, "fmt": _fmt_params(per)},
        "children": children,
        "repeat": {
            "count": ne,
            "names": [f"expert.{i}" for i in range(ne)],
            "group_params": total,
            "group_fmt": _fmt_params(total),
        },
    }


def _detect_moe_block(module: nn.Module):
    """Detect a sparse-MoE *block* whose experts live in a ModuleList/Sequential
    (e.g. moonshotai Kimi-K3 ``KimiSparseMoeBlock``: experts=ModuleList(896),
    gate=KimiMoEGate, shared_experts=...). Distinct from *fused* experts (handled by
    ``_detect_moe_experts``), this folds the expert pool into one ``expert xN``
    container showing a single representative expert's sub-structure.

    Returns a dict or None.
    """
    pool = None
    for cname, child in module.named_children():
        if cname in ("experts", "experts_parallel", "experts_list") or "expert" in cname.lower():
            kids = list(child.children())
            if isinstance(child, (nn.ModuleList, nn.Sequential)) and len(kids) >= 2:
                pool = (cname, child, kids)
                break
    if pool is None:
        return None
    cname, child, elems = pool
    ne = len(elems)
    fp0 = _fingerprint(elems[0])
    same = sum(1 for e in elems if _fingerprint(e) == fp0)
    if same < max(2, int(ne * 0.8)):
        return None  # not a uniform expert pool
    # locate the router (gate / *router*)
    router = None
    for rcname, rchild in module.named_children():
        if rcname == "gate" or rcname.endswith("router") or "router" in rcname.lower():
            router = (rcname, rchild)
            break
    return {"pool_name": cname, "pool": child, "ne": ne,
            "template": elems[0], "router": router}


def _make_moe_block_node(module: nn.Module, name: str, path: str, info: dict,
                         merge_repeats: bool) -> dict:
    """Render a sparse-MoE block: keep router/shared/extra children, fold the expert
    ModuleList into one ``expert xN`` container built from a template element."""
    total = sum(p.numel() for p in module.parameters())
    trainable = sum(p.numel() for p in module.parameters() if getattr(p, "requires_grad", True))
    direct = list(module.named_parameters(recurse=False))
    self_params = sum(p.numel() for _, p in direct)
    ne = info["ne"]

    expert_node = _build_node(info["template"], "expert", f"{path}.expert", merge_repeats)
    expert_node["id"] = f"{path}.expert"
    expert_node["name"] = "expert"
    expert_node["moe_experts"] = ne
    per = expert_node["params"]["total"]
    expert_node["repeat"] = {
        "count": ne,
        "names": [f"expert.{i}" for i in range(ne)],
        "group_params": per * ne,
        "group_fmt": _fmt_params(per * ne),
    }

    children = []
    for cname, child in module.named_children():
        if cname == info["pool_name"]:
            children.append(expert_node)
        else:
            children.append(_build_node(child, cname, f"{path}.{cname}", merge_repeats))

    return {
        "id": path,
        "name": name,
        "class": type(module).__name__,
        "kind": "container",
        "params": {"total": total, "trainable": trainable, "self": self_params,
                   "fmt": _fmt_params(total)},
        "children": children,
        "moe_experts": ne,
    }


def _fingerprint(module: nn.Module) -> str:
    """Structural hash: class + extra_repr + named children fingerprints + param shapes."""
    h = hashlib.blake2b(digest_size=8)
    h.update(type(module).__name__.encode())
    try:
        h.update(module.extra_repr().encode())
    except Exception:
        pass
    for name, p in module.named_parameters(recurse=False):
        h.update(f"{name}:{tuple(getattr(p, 'shape', ()))}:{getattr(p, 'requires_grad', True)}".encode())
    for name, child in module.named_children():
        # child order + structure matter; the sibling *name* does not
        h.update(_fingerprint(child).encode())
    return h.hexdigest()


# ---------------------------------------------------------------- core walk

def _build_node(module: nn.Module, name: str, path: str, merge_repeats: bool) -> dict:
    total = sum(p.numel() for p in module.parameters())
    trainable = sum(p.numel() for p in module.parameters() if getattr(p, "requires_grad", True))
    direct = list(module.named_parameters(recurse=False))
    self_params = sum(p.numel() for _, p in direct)

    node: dict[str, Any] = {
        "id": path,
        "name": name,
        "class": type(module).__name__,
        "kind": "container" if any(True for _ in module.children()) else "leaf",
        "params": {
            "total": total,
            "trainable": trainable,
            "self": self_params,
            "fmt": _fmt_params(total),
        },
    }

    try:
        er = module.extra_repr()
    except Exception:
        er = ""
    attrs = _parse_extra_repr(er)
    # capture well-known MoE routing fields that extra_repr() often omits
    # (e.g. Qwen3_5MoeTopKRouter exposes top_k but prints nothing)
    for _rk in ("top_k", "num_experts_per_tok", "experts_per_tok", "moe_intermediate_size"):
        _rv = getattr(module, _rk, None)
        if isinstance(_rv, int):
            attrs.setdefault(_rk, str(_rv))
    if attrs:
        node["attrs"] = attrs

    hint = _io_hint(module)
    if hint:
        node["io_hint"] = hint

    if direct:
        node["param_breakdown"] = [
            {"label": pname, "shape": list(getattr(p, "shape", ())), "value": p.numel(), "fmt": _fmt_params(p.numel())}
            for pname, p in direct[:MAX_BREAKDOWN]
        ]
        if len(direct) > MAX_BREAKDOWN:
            node["param_breakdown"].append(
                {"label": f"... +{len(direct) - MAX_BREAKDOWN} more", "shape": [], "value": 0, "fmt": ""}
            )

    # ---- MoE fused experts: expand into virtual 'expert xN' leaves ----
    ne = _detect_moe_experts(module)
    if ne:
        node["kind"] = "container"
        node["params"]["self"] = 0
        node["children"] = [_make_moe_expert_node(module, path, ne)]
        node["moe_experts"] = ne
        return node

    # ---- sparse MoE block with a ModuleList expert pool (e.g. Kimi-K3) ----
    blk = _detect_moe_block(module)
    if blk:
        return _make_moe_block_node(module, name, path, blk, merge_repeats)

    children_raw = [(cname, child) for cname, child in module.named_children()]
    if not children_raw:
        return node

    child_nodes: list[dict] = []
    if merge_repeats:
        i = 0
        while i < len(children_raw):
            cname, child = children_raw[i]
            j = i + 1
            merged_names = [cname]
            if cname.isdigit():
                # only fold numeric siblings (ModuleList / Sequential entries);
                # named submodules (q_proj vs k_proj) are semantically distinct
                fp = _fingerprint(child)
                while (j < len(children_raw)
                       and children_raw[j][0].isdigit()
                       and _fingerprint(children_raw[j][1]) == fp):
                    merged_names.append(children_raw[j][0])
                    j += 1
            cnode = _build_node(child, cname, f"{path}.{cname}", merge_repeats)
            count = j - i
            if count > 1:
                cnode["repeat"] = {"count": count, "names": merged_names}
                cnode["name"] = f"{cname}..{merged_names[-1]}" if cname.isdigit() else cname
                # params shown = one instance; also record group total
                cnode["repeat"]["group_params"] = cnode["params"]["total"] * count
                cnode["repeat"]["group_fmt"] = _fmt_params(cnode["params"]["total"] * count)
            child_nodes.append(cnode)
            i = j
    else:
        for cname, child in children_raw:
            child_nodes.append(_build_node(child, cname, f"{path}.{cname}", merge_repeats))

    node["children"] = child_nodes
    if isinstance(module, nn.Sequential):
        node["sequential"] = True
    return node


def _seq_edges(node: dict, edges: list[dict]) -> None:
    """Emit order edges for children inside every container (static fallback).

    nn.Sequential additionally gets 'seq' edges so the viewer can style them
    slightly more prominently, but for pure static viewing every container's
    child list is connected in definition order.
    """
    children = node.get("children", [])
    if len(children) > 1:
        kind = "seq" if node.get("sequential") else "order"
        for a, b in zip(children, children[1:]):
            edges.append({"source": a["id"], "target": b["id"], "kind": kind})
    for c in children:
        _seq_edges(c, edges)


# ---------------------------------------------------------------- MoE routing

def _is_router_node(n: dict) -> bool:
    c = n.get("class", "").lower()
    if c.endswith("router"):
        return True
    # a 'gate' module inside a MoE block that knows the expert count
    if "num_experts" in (n.get("attrs") or {}):
        return True
    return False


def enrich_moe_routing(tree: dict, edges: list[dict]) -> None:
    """Annotate MoE sparse blocks: router->experts routing edges + metadata.

    Detects a container that holds BOTH a fused-experts child (``moe_experts`` set)
    and a router child, then:
      * tags the router with a badge like "router · top-8/128",
      * injects a dashed 'routing' edge gate->experts labelled with the top-k,
      * appends a synthetic 'combine' node (Σ) that merges the selected experts
        with the shared expert, with routing/residual edges into it.
    """
    def walk(n: dict) -> None:
        children = n.get("children", [])
        if not children:
            return
        experts = next((c for c in children if c.get("moe_experts")), None)
        router = next((c for c in children if _is_router_node(c)), None)
        if router is None and experts:
            # sparse-MoE block: router is conventionally named 'gate'
            router = next((c for c in children if c.get("name") == "gate"), None)
        if router is None and experts:
            router = next((c for c in children
                           if "router" in c.get("class", "").lower()
                           or c.get("class", "").endswith("Gate")), None)
        if experts and router:
            ne = experts["moe_experts"]
            attrs = router.get("attrs") or {}
            k = None
            for key in ("top_k", "num_experts_per_tok", "experts_per_tok", "k"):
                if key in attrs:
                    try:
                        k = int(re.split(r"[^\d]", str(attrs[key]))[0])
                    except Exception:
                        k = None
                    if k:
                        break
            label = f"top-{k}/{ne}" if k else f"→{ne} experts"
            router["badge"] = f"router · {label}"
            n["moe_routing"] = {
                "num_experts": ne,
                "experts_per_tok": k,
                "router": router["class"],
                "label": label,
            }
            # router dispatches to the expert pool
            edges.append({
                "source": router["id"], "target": experts["id"],
                "kind": "routing", "shape": label,
            })
            # optional parallel shared-expert branch
            shared = next((c for c in children
                           if "shared" in c["name"].lower() or "shared" in c.get("class", "").lower()), None)
            # synthetic weighted-combine node = Σ(selected experts) + shared
            combine = {
                "id": n["id"] + ".combine",
                "name": "combine",
                "class": "WeightedCombine",
                "kind": "leaf",
                "params": {"total": 0, "trainable": 0, "self": 0, "fmt": "0"},
                "io_hint": {"in": "Σ selected experts + shared", "out": "(*, hidden)"},
                "op": "Σ",
            }
            n["children"].append(combine)
            edges.append({
                "source": experts["id"], "target": combine["id"],
                "kind": "routing", "shape": f"w·{label}",
            })
            if shared:
                edges.append({
                    "source": shared["id"], "target": combine["id"],
                    "kind": "residual", "shape": "shared",
                })
        for c in children:
            walk(c)
    walk(tree)


# ---------------------------------------------------------------- public API

def extract_graph(
    model: nn.Module,
    name: str = "model",
    merge_repeats: bool = True,
    edges: Optional[list[dict]] = None,
    input_spec: Optional[str] = None,
    output_spec: Optional[str] = None,
    extra_meta: Optional[dict] = None,
) -> dict:
    """Extract full graph JSON from an nn.Module (static, no forward)."""
    tree = _build_node(model, name, "root", merge_repeats)
    all_edges: list[dict] = [] if edges is None else list(edges)
    # MoE routing edges first, so they win the viewer's dedup over fallback order
    # edges that may share the same endpoint pair.
    enrich_moe_routing(tree, all_edges)
    if edges is None:
        # static mode: emit sequential/order fallback edges for every container.
        # Overlapping pairs (gate->experts etc.) are dropped by the viewer dedup.
        _seq_edges(tree, all_edges)
    total = tree["params"]["total"]
    meta = {
        "name": name,
        "class": type(model).__name__,
        "total_params": total,
        "total_params_fmt": _fmt_params(total),
        "trace_mode": "hooks" if edges else "static",
        "format_version": 1,
    }
    if input_spec:
        meta["input_spec"] = input_spec
    if output_spec:
        meta["output_spec"] = output_spec
    if extra_meta:
        meta.update(extra_meta)
    return {"meta": meta, "tree": tree, "edges": all_edges}


def save_graph(graph: dict, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=1)
    import os
    print(f"[mviz] wrote {path} ({os.path.getsize(path) / 1024:.1f} KB)")
