"""Forward tracing: real tensor-flow edges + real I/O shapes.

Two mechanisms combined:
1. forward hooks on every module  -> I/O shapes, execution order
2. TorchDispatchMode op tracking  -> true dataflow across out-of-module ops
   (x + attn_out residual adds, concats, ...), so residual / skip edges are
   discovered automatically without torch.fx.

Tensor identity uses id() with a keepalive list to prevent id reuse after GC.
Each tensor carries a bounded "producer set" (last PROD_CAP leaf modules that
contributed to it); ops merge the sets of their inputs.
"""
from __future__ import annotations

from typing import Any, Optional

import torch
import torch.nn as nn
from torch.utils._python_dispatch import TorchDispatchMode
from torch.utils._pytree import tree_flatten

PROD_CAP = 3  # max producers remembered per tensor


def _tensors(obj: Any) -> list[torch.Tensor]:
    flat, _ = tree_flatten(obj)
    return [x for x in flat if isinstance(x, torch.Tensor)]


def _shape_of(obj: Any) -> list[str]:
    return [f"({', '.join(str(d) for d in t.shape)}) {str(t.dtype).replace('torch.', '')}"
            for t in _tensors(obj)]


class _FlowTracker(TorchDispatchMode):
    def __init__(self, producers: dict[int, list[str]], keepalive: list):
        super().__init__()
        self.producers = producers
        self.keepalive = keepalive

    def __torch_dispatch__(self, func, types, args=(), kwargs=None):
        kwargs = kwargs or {}
        out = func(*args, **kwargs)
        func_name = str(func)
        is_add = "aten::add" in func_name
        merged: list[str] = []
        for t in _tensors((args, kwargs)):
            src = self.producers.get(id(t), ())
            picks = [src[-1]] if src else []
            if not is_add and src:
                # for non-add ops keep full capped history
                picks = list(src)
            for p in picks:
                if p in merged:
                    merged.remove(p)
                merged.append(p)
        if merged:
            merged = merged[-PROD_CAP:]
            for t in _tensors(out):
                self.producers[id(t)] = merged
                self.keepalive.append(t)
        return out


def trace_edges(
    model: nn.Module,
    example_input: Any,
    root_id: str = "root",
) -> tuple[list[dict], dict[str, dict]]:
    """Run one forward pass; return (edges, io_map).

    edges: [{source, target, kind: tensor|residual, shape}]
    io_map: {node_id: {"in": [...], "out": [...], "order": k}}
    """
    producers: dict[int, list[str]] = {}
    keepalive: list = []
    io_map: dict[str, dict] = {}
    edge_set: dict[tuple[str, str], dict] = {}
    order = [0]
    last_leaf: list[Optional[str]] = [None]
    handles = []

    def is_leaf(mod: nn.Module) -> bool:
        return not any(True for _ in mod.children())

    def make_hook(nid: str, leaf: bool):
        def hook(mod, args, kwargs, output):
            io_map[nid] = {
                "in": _shape_of(args) + _shape_of(kwargs),
                "out": _shape_of(output),
                "order": order[0],
            }
            order[0] += 1
            if not leaf:
                return
            for t in _tensors((args, kwargs)):
                for src in producers.get(id(t), ()):
                    if src == nid:
                        continue
                    key = (src, nid)
                    if key not in edge_set:
                        kind = "tensor" if src == last_leaf[0] else "residual"
                        shp = next(iter(io_map.get(src, {}).get("out", [])), "")
                        edge_set[key] = {"source": src, "target": nid,
                                         "kind": kind, "shape": shp,
                                         "order": io_map[nid]["order"]}
            for t in _tensors(output):
                producers[id(t)] = [nid]
                keepalive.append(t)
            last_leaf[0] = nid
        return hook

    for name, mod in model.named_modules():
        nid = root_id if name == "" else f"{root_id}.{name}"
        handles.append(mod.register_forward_hook(make_hook(nid, is_leaf(mod)), with_kwargs=True))

    model.eval()
    try:
        with torch.no_grad(), _FlowTracker(producers, keepalive):
            if isinstance(example_input, (list, tuple)):
                model(*example_input)
            elif isinstance(example_input, dict):
                model(**example_input)
            else:
                model(example_input)
    finally:
        for h in handles:
            h.remove()
        keepalive.clear()

    edges = sorted(edge_set.values(), key=lambda e: e["order"])
    for e in edges:
        e.pop("order", None)
    return edges, io_map


def attach_io(tree: dict, io_map: dict[str, dict]) -> None:
    """Merge traced I/O shapes back into the tree (in place)."""
    info = io_map.get(tree["id"])
    if info:
        tree["io"] = {"in": info["in"], "out": info["out"]}
    for c in tree.get("children", []):
        attach_io(c, io_map)
