"""Remap traced edge endpoints onto the repeat-merged tree.

After fingerprint dedup, ids like root.layers.7.mlp no longer exist in the
tree (only the representative root.layers.0.mlp does). This module rewrites
edge endpoints to their representatives. Cross-repeat edges (block N output
-> block N+1 input) become 'loop' edges on the representative.
"""
from __future__ import annotations


def _collect_aliases(node: dict, aliases: dict[str, str]) -> None:
    rep = node.get("repeat")
    if rep:
        parent = node["id"].rsplit(".", 1)[0]
        rep_name = rep["names"][0]
        for other in rep["names"][1:]:
            aliases[f"{parent}.{other}"] = f"{parent}.{rep_name}"
    for c in node.get("children", []):
        _collect_aliases(c, aliases)


def remap_edges(tree: dict, edges: list[dict]) -> list[dict]:
    aliases: dict[str, str] = {}
    _collect_aliases(tree, aliases)
    if not aliases:
        return edges
    # longest prefix first so nested repeats resolve correctly
    prefixes = sorted(aliases.keys(), key=len, reverse=True)

    def resolve(nid: str) -> str:
        changed = True
        while changed:
            changed = False
            for p in prefixes:
                if nid == p or nid.startswith(p + "."):
                    nid = aliases[p] + nid[len(p):]
                    changed = True
                    break
        return nid

    # dedup by endpoint pair; when a semantic edge collides with a weaker one
    # (a traced tensor edge may share endpoints with an injected routing edge)
    # the higher-priority kind wins instead of first-seen
    pri = {"routing": 3, "residual": 2}
    seen: dict[tuple[str, str], dict] = {}
    for e in edges:
        s, t = resolve(e["source"]), resolve(e["target"])
        if s == t:
            continue
        key = (s, t)
        prev = seen.get(key)
        if prev is not None:
            if pri.get(e.get("kind"), 1) > pri.get(prev.get("kind"), 1):
                prev["kind"] = e["kind"]
                if e.get("shape"):
                    prev["shape"] = e["shape"]
            continue
        ne = dict(e)
        crossed = (s != e["source"]) or (t != e["target"])
        if crossed and ne.get("kind") == "tensor":
            ne["kind"] = "loop" if _same_stem(s, t) else "tensor"
        ne["source"], ne["target"] = s, t
        seen[key] = ne
    return list(seen.values())


def _same_stem(a: str, b: str) -> bool:
    """True if both ids live under the same representative repeat block."""
    pa, pb = a.split("."), b.split(".")
    n = min(len(pa), len(pb))
    common = 0
    for i in range(n):
        if pa[i] == pb[i]:
            common += 1
        else:
            break
    return common >= 3
