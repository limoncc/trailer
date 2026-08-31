"""MoE routing: extraction, detection robustness, and trace-pipeline survival.

Regression pinning for the mviz MoE engine:

* static extraction must inject routing edges + a synthetic combine node for
  both ModuleList expert pools (Kimi-style) and fused experts (Qwen3.5-style);
* ``build_model_graph(trace=True)`` (the seam behind ``tracker.log_model``)
  must keep those routing edges — they used to be overwritten when only the
  raw hook edges were remapped, orphaning the combine node;
* expert detection must not depend on a ``num_experts`` attribute being
  exposed, and non-uniform pools must still fold + route.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

from trailer.model import extract_graph

H, INTER, NE, K = 8, 16, 4, 2


class Expert(nn.Module):
    def __init__(self, h=H, inter=INTER):
        super().__init__()
        self.w1 = nn.Linear(h, inter, bias=False)
        self.w2 = nn.Linear(inter, h, bias=False)

    def forward(self, x):
        return self.w2(F.silu(self.w1(x)))


class MoEGate(nn.Module):
    """Kimi-style gate: attribute named 'gate', class name not Router/Gate."""

    def __init__(self, h=H, ne=NE, k=K):
        super().__init__()
        self.proj = nn.Linear(h, ne, bias=False)
        self.top_k = k

    def extra_repr(self):
        return f"top_k={self.top_k}"

    def forward(self, x):
        return F.softmax(self.proj(x), dim=-1)


class TopKRouter(nn.Module):
    def __init__(self, h=H, ne=NE, k=K):
        super().__init__()
        self.weight = nn.Parameter(torch.randn(ne, h) * 0.1)
        self.top_k = k
        self.num_experts = ne

    def extra_repr(self):
        return f"top_k={self.top_k}, num_experts={self.num_experts}"

    def forward(self, x):
        scores = F.softmax(x @ self.weight.T, dim=-1)
        topv, topi = scores.topk(self.top_k, dim=-1)
        return torch.zeros_like(scores).scatter(-1, topi, topv)


class SparseMoEBlock(nn.Module):
    """ModuleList expert pool + gate child (Kimi-style)."""

    def __init__(self, h=H, inter=INTER, ne=NE, k=K):
        super().__init__()
        self.experts = nn.ModuleList([Expert(h, inter) for _ in range(ne)])
        self.gate = MoEGate(h, ne, k)

    def forward(self, x):
        w = self.gate(x)
        outs = torch.stack([e(x) for e in self.experts], dim=-2)
        return (outs * w.unsqueeze(-1)).sum(dim=-2)


class FusedExperts(nn.Module):
    def __init__(self, ne=NE, h=H, inter=INTER):
        super().__init__()
        self.num_experts = ne
        self.gate_up = nn.Parameter(torch.randn(ne, 2 * inter, h) * 0.1)
        self.down = nn.Parameter(torch.randn(ne, h, inter) * 0.1)

    def forward(self, x):
        outs = []
        for i in range(self.num_experts):
            a, b = self.gate_up[i].chunk(2, dim=0)
            outs.append((F.silu(x @ a.T) * (x @ b.T)) @ self.down[i].T)
        return torch.stack(outs, dim=-2)


class FusedMoEBlock(nn.Module):
    """Fused-experts block + TopKRouter + shared expert (Qwen3.5-style)."""

    def __init__(self, ne=NE, h=H, inter=INTER, k=K):
        super().__init__()
        self.router = TopKRouter(h, ne, k)
        self.experts = FusedExperts(ne, h, inter)
        self.shared_expert = Expert(h, inter)

    def forward(self, x):
        w = self.router(x)
        return (self.experts(x) * w.unsqueeze(-1)).sum(dim=-2) + self.shared_expert(x)


class MoEModel(nn.Module):
    """stem -> N identical MoE blocks -> head (exercises repeat remapping)."""

    def __init__(self, block_cls=SparseMoEBlock):
        super().__init__()
        self.stem = nn.Linear(H, H)
        self.layers = nn.ModuleList([block_cls() for _ in range(3)])
        self.head = nn.Linear(H, 4)

    def forward(self, x):
        h = self.stem(x)
        for lyr in self.layers:
            h = lyr(h)
        return self.head(h)


def _find(node, pred):
    if pred(node):
        return node
    for c in node.get("children", []):
        hit = _find(c, pred)
        if hit:
            return hit
    return None


def _find_edges(edges, **kw):
    return [e for e in edges if all(e.get(k) == v for k, v in kw.items())]


class TestStaticRouting:
    """These pass on current main — they pin the existing static behaviour."""

    def test_modulelist_pool_gets_routing_edges(self):
        g = extract_graph(MoEModel(), merge_repeats=True)
        block = _find(g["tree"], lambda n: n["id"] == "root.layers.0")
        assert block is not None and block.get("moe_routing")
        gate = _find(block, lambda n: n["name"] == "gate")
        assert gate.get("badge") == "router · top-2/4"
        assert _find(block, lambda n: n["id"] == "root.layers.0.combine")
        r = _find_edges(g["edges"], source="root.layers.0.gate",
                        target="root.layers.0.expert", kind="routing")
        assert len(r) == 1 and r[0]["shape"] == "top-2/4"
        assert len(_find_edges(g["edges"], source="root.layers.0.expert",
                               target="root.layers.0.combine", kind="routing")) == 1

    def test_fused_experts_get_routing_and_shared_residual(self):
        g = extract_graph(MoEModel(FusedMoEBlock), merge_repeats=True)
        block = _find(g["tree"], lambda n: n["id"] == "root.layers.0")
        assert block.get("moe_routing", {}).get("num_experts") == NE
        router = _find(block, lambda n: n["name"] == "router")
        assert router.get("badge") == "router · top-2/4"
        assert len(_find_edges(g["edges"], source="root.layers.0.router",
                               target="root.layers.0.experts", kind="routing")) == 1
        assert len(_find_edges(g["edges"], source="root.layers.0.experts",
                               target="root.layers.0.combine", kind="routing")) == 1
        shared = _find_edges(g["edges"], source="root.layers.0.shared_expert",
                             target="root.layers.0.combine", kind="residual")
        assert len(shared) == 1 and shared[0]["shape"] == "shared"


class TestTracedRouting:
    """trace=True must not drop the injected routing edges (regression)."""

    def test_routing_survives_trace_pipeline(self):
        from trailer.model.pipeline import build_model_graph

        for block_cls, router_id, pool_id in (
            (SparseMoEBlock, "root.layers.0.gate", "root.layers.0.expert"),
            (FusedMoEBlock, "root.layers.0.router", "root.layers.0.experts"),
        ):
            model = MoEModel(block_cls).eval()
            g = build_model_graph(model, name="m", input_shape=(2, H), trace=True)
            assert g["meta"]["trace_mode"] == "hooks"
            assert len(_find_edges(g["edges"], source=router_id,
                                   target=pool_id, kind="routing")) == 1
            combine_edges = _find_edges(g["edges"],
                                        source=pool_id,
                                        target="root.layers.0.combine")
            assert len(combine_edges) == 1 and combine_edges[0]["kind"] == "routing"
            # combine node is not an orphan
            assert any(e["target"] == "root.layers.0.combine" for e in g["edges"])
            # real I/O shapes are attached
            gate = _find(g["tree"], lambda n: n["id"] == router_id)
            assert gate and gate.get("io", {}).get("out")


class TestDetectionRobustness:
    def test_fused_experts_without_num_experts_attr(self):
        """Weights-only inference: two stacked 3D params sharing a leading dim."""

        class Opaque(nn.Module):
            def __init__(self):
                super().__init__()
                self.gate_up = nn.Parameter(torch.randn(NE, 2 * INTER, H) * 0.1)
                self.down = nn.Parameter(torch.randn(NE, H, INTER) * 0.1)

            def forward(self, x):
                outs = []
                for i in range(self.gate_up.shape[0]):
                    a, b = self.gate_up[i].chunk(2, dim=0)
                    outs.append((F.silu(x @ a.T) * (x @ b.T)) @ self.down[i].T)
                return torch.stack(outs, dim=-2)

        class Block(nn.Module):
            def __init__(self):
                super().__init__()
                self.gate = nn.Linear(H, NE, bias=False)
                self.experts = Opaque()

            def forward(self, x):
                w = F.softmax(self.gate(x), dim=-1)
                return (self.experts(x) * w.unsqueeze(-1)).sum(dim=-2)

        g = extract_graph(Block(), merge_repeats=True)
        experts = _find(g["tree"], lambda n: n["name"] == "experts")
        assert experts is not None and experts.get("moe_experts") == NE
        assert _find_edges(g["edges"], source="root.gate",
                           target="root.experts", kind="routing")

    def test_single_3d_weight_is_not_mistaken_for_experts(self):
        """A lone stacked 3D+ weight (e.g. a Conv3d kernel) is not experts."""
        m = nn.Conv3d(2, NE, kernel_size=2)
        g = extract_graph(m, merge_repeats=True)
        assert _find(g["tree"], lambda n: n.get("moe_experts")) is None
        assert not _find_edges(g["edges"], kind="routing")

    def test_nonuniform_pool_folds_majority_and_keeps_uniques(self):
        class Odd(nn.Module):
            def __init__(self):
                super().__init__()
                self.w1 = nn.Linear(H, INTER, bias=False)

            def forward(self, x):
                return self.w1(x)

        class Mixed(nn.Module):
            def __init__(self):
                super().__init__()
                self.experts = nn.ModuleList([Expert() for _ in range(3)] + [Odd(), Odd()])
                self.gate = MoEGate()

            def forward(self, x):
                w = self.gate(x)
                outs = torch.stack([e(x) for e in self.experts], dim=-2)
                return (outs * w.unsqueeze(-1)).sum(dim=-2)

        g = extract_graph(Mixed(), merge_repeats=True)
        experts = _find(g["tree"], lambda n: n["name"] == "experts")
        assert experts is not None and experts.get("moe_experts") == 5
        kids = experts.get("children", [])
        folded = [c for c in kids if c.get("repeat")]
        assert len(folded) == 1 and folded[0]["repeat"]["count"] == 3
        assert len(kids) == 3  # folded majority + 2 uniques
        routing = _find_edges(g["edges"], kind="routing")
        assert {e["source"] for e in routing} == {"root.gate", "root.experts"}
