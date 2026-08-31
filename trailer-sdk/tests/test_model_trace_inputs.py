"""Example-input synthesis for trace mode.

`log_model(trace=True)` must work for models whose first layer is an Embedding
(needs Long/Int indices, not randn floats) and for non-fp32 weights (input
dtype should follow the model's parameters).
"""
import torch
import torch.nn as nn

from trailer.model import build_model_graph


class EmbedFirst(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed = nn.Embedding(64, 8)
        self.head = nn.Linear(8, 4)

    def forward(self, idx):
        return self.head(self.embed(idx))


class Tiny(nn.Module):
    def __init__(self):
        super().__init__()
        self.stem = nn.Linear(8, 8)
        self.head = nn.Linear(8, 4)

    def forward(self, x):
        return self.head(self.stem(x))


def test_trace_embedding_first_model():
    m = EmbedFirst().eval()
    g = build_model_graph(m, name="m", input_shape=(2, 16), trace=True)
    assert g["meta"]["trace_mode"] == "hooks"
    assert g["edges"]


def test_trace_follows_model_dtype():
    m = Tiny().half().eval()
    g = build_model_graph(m, name="m", input_shape=(2, 8), trace=True)
    assert g["meta"]["trace_mode"] == "hooks"
    gate = g["tree"]["children"][0]
    assert gate.get("dtype") == "float16"
