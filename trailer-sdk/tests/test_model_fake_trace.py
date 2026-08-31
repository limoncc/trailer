"""FakeTensor 符号追踪:真实 shape/数据流边,零真实计算、零权重需求。

trace=True 的默认路径是 FakeTensorMode 下的"干跑":Python 控制流执行,
张量全为 fake(不分配真实内存),因此——
* io_map 记录的 shape/dtype 是真实的(带 batch);
* 模块外的残差 aten::add 照常被 TorchDispatchMode 捕获;
* meta device 模型(无真实权重)也能完整提取。
fake 失败(数据依赖控制流等)自动回退真实 forward,meta.trace_mode 区分
"fake" / "hooks"。
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

from trailer.model import build_model_graph


class ResidualBlock(nn.Module):
    def __init__(self, d=8):
        super().__init__()
        self.a = nn.Linear(d, d)
        self.b = nn.Linear(d, d)

    def forward(self, x):
        return F.relu(x + self.b(self.a(x)))


class Stacked(nn.Module):
    def __init__(self, d=8):
        super().__init__()
        self.block1 = ResidualBlock(d)
        self.block2 = ResidualBlock(d)
        self.head = nn.Linear(d, 4)

    def forward(self, x):
        return self.head(self.block2(self.block1(x)))


def test_fake_trace_real_shapes_and_residual_edges():
    g = build_model_graph(Stacked(), name="m", input_shape=(2, 8), trace=True)
    assert g["meta"]["trace_mode"] == "fake"
    a = g["tree"]["children"][0]["children"][0]
    assert a["io"]["out"] == ["(2, 8) float32"]  # 真实 shape + dtype
    residual = [e for e in g["edges"] if e["kind"] == "residual"]
    assert residual, "模块外残差边未被发现"


def test_fake_trace_works_on_meta_model_without_weights():
    with torch.device("meta"):
        m = Stacked()
    g = build_model_graph(m, name="m", input_shape=(2, 8), trace=True)
    assert g["meta"]["trace_mode"] == "fake"
    assert g["edges"]
    head = g["tree"]["children"][2]
    assert head["io"]["out"] == ["(2, 4) float32"]


def test_fallback_to_real_forward_when_fake_unsupported():
    class DataDependent(nn.Module):
        def __init__(self):
            super().__init__()
            self.lin = nn.Linear(4, 2)

        def forward(self, x):
            return self.lin(x) * float(x.abs().sum().item() >= 0)  # .item() 在 fake 下必失败

    g = build_model_graph(DataDependent(), name="m", input_shape=(2, 4), trace=True)
    assert g["meta"]["trace_mode"] == "hooks"  # 回退到真实 forward
