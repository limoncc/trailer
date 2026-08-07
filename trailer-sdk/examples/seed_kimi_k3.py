"""Kimi-K3 模型结构示例 — 读取已有的 kimi-k3.json 录为 run 的 Model 数据。

用法(连本地 server):
  TRAILER_HOST=http://127.0.0.1:5120 TRAILER_TOKEN=<token> \
      .venv/bin/python python/examples/seed_kimi_k3.py
"""
import json
import os
import urllib.request

from trailer import Tracker

GRAPH_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "data", "kimi-k3.json")


def main():
    with open(GRAPH_PATH) as f:
        graph = json.load(f)

    meta = graph.get("meta", {})
    print(f"加载 Kimi-K3 图: name={meta.get('name')} class={meta.get('class')} "
          f"params={meta.get('total_params_fmt')}")

    t = Tracker(project="kimi_k3", name="Kimi-K3 architecture", config={
        "model": meta.get("name", "Kimi-K3"),
        "arch_class": meta.get("class"),
        "params": meta.get("total_params_fmt"),
        "source": meta.get("source"),
    })

    # 模型指标(模拟)
    t.log({"moe_blocks": 32, "active_params_b": 3.2, "total_params_b": 32.7}, step=0)

    # 直接写 model figure(kind=model, body=图 JSON)
    host = os.environ.get("TRAILER_HOST", "http://127.0.0.1:5120")
    token = os.environ.get("TRAILER_TOKEN", "")
    if not token:
        raise SystemExit("TRAILER_TOKEN 未设置")
    payload = {"name": "kimi-k3", "kind": "model", "body": json.dumps(graph), "step": 0}
    req = urllib.request.Request(
        f"{host.rstrip('/')}/api/v1/runs/{t.run_id}/figures",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=60)
    t.finish()
    print(f"✓ Kimi-K3 模型结构已记录到 run: {t.run_id}")


if __name__ == "__main__":
    main()
