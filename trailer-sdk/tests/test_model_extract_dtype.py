"""dtype extraction for model graph nodes.

Real module instances carry their parameter dtypes — surfacing them in the
graph (node-level vote + per-param in param_breakdown) feeds the UI weights
table without any weight-file reading.
"""
import torch
import torch.nn as nn

from trailer.model import extract_graph


class Tiny(nn.Module):
    def __init__(self):
        super().__init__()
        self.a = nn.Linear(4, 8)
        self.b = nn.Linear(8, 4)

    def forward(self, x):
        return self.b(self.a(x))


def test_leaf_node_reports_majority_dtype():
    g = extract_graph(Tiny())
    a = g["tree"]["children"][0]
    assert a["dtype"] == "float32"


def test_dtype_follows_half_precision_params():
    m = Tiny().half()
    g = extract_graph(m)
    a = g["tree"]["children"][0]
    assert a["dtype"] == "float16"


def test_param_breakdown_rows_carry_dtype():
    g = extract_graph(Tiny())
    a = g["tree"]["children"][0]
    row = a["param_breakdown"][0]
    assert row["dtype"] == "float32"


def test_container_without_own_params_has_no_dtype():
    g = extract_graph(Tiny())
    assert "dtype" not in g["tree"]
