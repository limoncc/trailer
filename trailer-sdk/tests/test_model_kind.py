"""Semantic node kinds + graph format v2 additive fields.

Node `kind` (embedding/attention/mlp/moe/norm/linear/conv/head/act/container/
module) drives the viewer's color table and inspector chip from ONE source —
previously each browser redraw re-guessed the kind from class-name substrings.

Format v2 is additive: meta.format_version = 2 and repeat nodes carry a
`signature` (structural hash proving the folded members are identical).
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

from trailer.model import extract_graph


class AttnBlock(nn.Module):
    def __init__(self, d=8):
        super().__init__()
        self.q_proj = nn.Linear(d, d, bias=False)
        self.k_proj = nn.Linear(d, d, bias=False)
        self.v_proj = nn.Linear(d, d, bias=False)
        self.o_proj = nn.Linear(d, d, bias=False)

    def forward(self, x):
        return self.o_proj(self.v_proj(self.q_proj(x)))


class MlpBlock(nn.Module):
    def __init__(self, d=8):
        super().__init__()
        self.gate_proj = nn.Linear(d, 2 * d, bias=False)
        self.down_proj = nn.Linear(2 * d, d, bias=False)

    def forward(self, x):
        return self.down_proj(F.silu(self.gate_proj(x)))


class Layer(nn.Module):
    def __init__(self, d=8):
        super().__init__()
        self.self_attn = AttnBlock(d)
        self.mlp = MlpBlock(d)
        self.input_layernorm = nn.RMSNorm(d)

    def forward(self, x):
        return self.mlp(self.input_layernorm(self.self_attn(x)))


def _find(node, pred):
    if pred(node):
        return node
    for c in node.get("children", []):
        hit = _find(c, pred)
        if hit:
            return hit
    return None


def test_container_and_semantic_kinds():
    model = nn.Sequential(nn.Embedding(32, 8), Layer(8), nn.GELU(), nn.Linear(8, 4))
    g = extract_graph(model, merge_repeats=False)
    kinds = {c["name"]: c["kind"] for c in g["tree"]["children"]}
    assert kinds["0"] == "embedding"
    assert kinds["1"] == "container"
    assert kinds["2"] == "act"
    assert kinds["3"] == "linear"
    layer = g["tree"]["children"][1]
    lkinds = {c["name"]: c["kind"] for c in layer["children"]}
    assert lkinds["self_attn"] == "attention"
    assert lkinds["mlp"] == "mlp"
    assert lkinds["input_layernorm"] == "norm"
    attn = layer["children"][0]
    akinds = {c["name"]: c["kind"] for c in attn["children"]}
    assert all(k == "linear" for k in akinds.values())


def test_attention_name_match():
    m = nn.ModuleDict({"attn": AttnBlock()})
    g = extract_graph(m, merge_repeats=False)
    assert g["tree"]["children"][0]["kind"] == "attention"


def test_head_kind():
    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            self.lm_head = nn.Linear(8, 32)

    g = extract_graph(Net())
    assert g["tree"]["children"][0]["kind"] == "head"


def test_conv_kind():
    g = extract_graph(nn.Conv2d(3, 8, 3))
    assert g["tree"]["kind"] == "conv"


def test_format_version_2_and_repeat_signature():
    model = nn.Sequential(*[Layer(8) for _ in range(3)])
    g = extract_graph(model, merge_repeats=True)
    assert g["meta"]["format_version"] == 2
    rep = _find(g["tree"], lambda n: n.get("repeat"))
    assert rep is not None
    sig = rep["repeat"].get("signature")
    assert isinstance(sig, str) and len(sig) > 0


def test_moe_block_and_experts_kind():
    class Expert(nn.Module):
        def __init__(self):
            super().__init__()
            self.w1 = nn.Linear(8, 16, bias=False)

    class MoE(nn.Module):
        def __init__(self):
            super().__init__()
            self.experts = nn.ModuleList([Expert() for _ in range(4)])
            self.gate = nn.Linear(8, 4, bias=False)

    g = extract_graph(MoE(), merge_repeats=True)
    experts = _find(g["tree"], lambda n: n.get("moe_experts"))
    assert experts is not None
    assert experts["kind"] == "moe"
    folded = _find(g["tree"], lambda n: n.get("id", "").endswith(".expert"))
    assert folded is not None and folded["kind"] == "moe"
    assert folded["repeat"].get("signature")
