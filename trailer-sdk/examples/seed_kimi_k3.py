"""Kimi-K3 风格 MoE 模型结构示例 — 现场提取图结构并录为 run 的 Model 数据。

之前的版本依赖一个从未提交的 docs/data/kimi-k3.json;现在直接用 mviz 引擎从
nn.Module 现场提取,无需任何预置文件。

用法(连本地 server):
  TRAILER_HOST=http://127.0.0.1:5120 TRAILER_TOKEN=<token> \
      .venv/bin/python examples/seed_kimi_k3.py
"""
import json
import os
import urllib.request

import torch
import torch.nn as nn
import torch.nn.functional as F

from trailer import Tracker
from trailer.model import extract_graph, save_graph


class Expert(nn.Module):
    def __init__(self, hidden=4096, inter=1024):
        super().__init__()
        self.gate_proj = nn.Linear(hidden, inter, bias=False)
        self.up_proj = nn.Linear(hidden, inter, bias=False)
        self.down_proj = nn.Linear(inter, hidden, bias=False)

    def forward(self, x):
        return self.down_proj(F.silu(self.gate_proj(x)) * self.up_proj(x))


class MoEBlock(nn.Module):
    """Kimi-K3 式稀疏 MoE:ModuleList 专家池 + gate 路由 + 共享专家。"""

    def __init__(self, hidden=4096, inter=1024, experts=8, top_k=2):
        super().__init__()
        self.experts = nn.ModuleList([Expert(hidden, inter) for _ in range(experts)])
        self.gate = nn.Linear(hidden, experts, bias=False)
        self.shared_expert = Expert(hidden, inter)
        self.top_k = top_k

    def forward(self, x):
        w = F.softmax(self.gate(x), dim=-1)
        outs = torch.stack([e(x) for e in self.experts], dim=-2)
        return (outs * w.unsqueeze(-1)).sum(dim=-2) + self.shared_expert(x)


class KimiLikeModel(nn.Module):
    def __init__(self, vocab=1024, hidden=512, layers=8, experts=8):
        super().__init__()
        self.embed_tokens = nn.Embedding(vocab, hidden)
        self.layers = nn.ModuleList([MoEBlock(hidden, hidden // 4, experts) for _ in range(layers)])
        self.norm = nn.RMSNorm(hidden)
        self.lm_head = nn.Linear(hidden, vocab, bias=False)

    def forward(self, idx):
        x = self.embed_tokens(idx)
        for layer in self.layers:
            x = layer(x)
        return self.lm_head(self.norm(x))


def main():
    model = KimiLikeModel().eval()
    graph = extract_graph(model, name="kimi-k3-like", input_spec="tensor (1, 128)")

    # 可选:留档到本地 JSON(GRAPH_OUT 环境变量指定路径)
    out = os.environ.get("GRAPH_OUT")
    if out:
        save_graph(graph, out)

    meta = graph.get("meta", {})
    print(f"提取 Kimi-K3 风格图: class={meta.get('class')} params={meta.get('total_params_fmt')}")

    t = Tracker(project="kimi_k3", name="Kimi-K3 architecture", config={
        "model": meta.get("name", "kimi-k3-like"),
        "arch_class": meta.get("class"),
        "params": meta.get("total_params_fmt"),
        "source": "extract_graph(KimiLikeModel)",
    })
    t.log({"moe_blocks": 8, "experts_per_block": 8}, step=0)

    # 也可以直接 log_model(model) —— 本示例展示手工上传已提取的图
    host = os.environ.get("TRAILER_HOST", "http://127.0.0.1:5120")
    token = os.environ.get("TRAILER_TOKEN", "")
    if not token:
        raise SystemExit("TRAILER_TOKEN 未设置(或改用 t.log_model(model) 走本地模式)")
    payload = {"name": "kimi-k3-like", "kind": "model", "body": json.dumps(graph), "step": 0}
    req = urllib.request.Request(
        f"{host.rstrip('/')}/api/v1/runs/{t.run_id}/figures",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=60)
    t.finish()
    print(f"✓ 模型结构已记录到 run: {t.run_id}")


if __name__ == "__main__":
    main()
