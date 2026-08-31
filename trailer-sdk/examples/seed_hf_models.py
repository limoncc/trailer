"""transformers 模型架构示例 — config-only meta 加载 + FakeTensor 符号追踪。

不下载/不读取权重、不执行真实 forward:
* `load_meta_model` 仅凭 config.json 在 meta device 上实例化模型骨架;
* `build_model_graph(trace=True)` 走 FakeTensorMode 符号追踪——捕获
  * 真实 I/O shape(batch/dtype),
  * 模块外残差算子边(FakeTensor 下 aten::add 照常被 TorchDispatchMode 发现),
  * 完整 nn.Module 层次(self_attn / mlp / MoE 路由)。

用法(连本地 server):
  TRAILER_HOST=http://127.0.0.1:5120 TRAILER_TOKEN=<token> \
      .venv/bin/python examples/seed_hf_models.py
"""
import glob
import json
import os
import urllib.request

from trailer import Tracker
from trailer.model import build_model_graph
from trailer.model.hf import annotate_layer_badges, hf_input_spec, hf_output_spec, load_meta_model

# 本地候选:需要 config.json(+ 权重可选——fake 追踪不读权重)
CANDIDATES = [
    ("Qwen3.5-0.8B", "/Users/xiaobai/dev/llama.cpp/build/models/qwen/Qwen3.5-0.8B", (2, 128)),
    ("DeepSeek-V3.2-Exp", None, (2, 128)),  # 从 HF 缓存快照定位
]


def find_deepseek_snapshot():
    base = os.path.expanduser("~/.cache/huggingface/hub/models--deepseek-ai--DeepSeek-V3.2-Exp")
    snaps = sorted(glob.glob(os.path.join(base, "snapshots", "*")))
    return snaps[0] if snaps and os.path.exists(os.path.join(snaps[0], "config.json")) else None


def extract(path, input_shape):
    model, cfg = load_meta_model(path)
    # meta 权重默认 fp32,部分算子(如 _grouped_mm)要求 bf16——meta 上改 dtype 零成本
    import torch
    try:
        p0 = next(model.parameters())
        if p0.device.type == "meta" and p0.dtype == torch.float32:
            model.to(torch.bfloat16)
    except StopIteration:
        pass
    graph = build_model_graph(
        model, name=os.path.basename(path.rstrip("/")),
        input_shape=input_shape, trace=True,  # FakeTensor 符号追踪,零真实计算
        input_spec=hf_input_spec(cfg), output_spec=hf_output_spec(cfg),
        extra_meta={"source": f"transformers config-only: {os.path.basename(path.rstrip('/'))}"},
    )
    annotate_layer_badges(graph, model, cfg)
    return graph, cfg


def main():
    host = os.environ.get("TRAILER_HOST", "http://127.0.0.1:5120")
    token = os.environ.get("TRAILER_TOKEN", "")
    if not token:
        raise SystemExit("TRAILER_TOKEN 未设置")

    t = Tracker(project="model-demo", name="transformers 模型架构", config={
        "mode": "static + FakeTensor symbolic trace",
        "note": "config-only meta 加载,无权重下载,无真实 forward",
    }, host=host, token=token)
    t.log({"mode": "fake-trace"}, step=0)

    for name, path, shape in CANDIDATES:
        resolved = path or find_deepseek_snapshot()
        if not resolved:
            print(f"跳过 {name}: 本地未找到")
            continue
        try:
            graph, cfg = extract(resolved, shape)
        except Exception as exc:  # noqa: BLE001
            print(f"✗ {name}: {exc}")
            continue

        meta = graph["meta"]
        print(f"✓ {name}: {meta['total_params_fmt']} 参数, trace_mode={meta['trace_mode']}, "
              f"边 {len(graph['edges'])} 条")

        payload = {"name": name, "kind": "model", "body": json.dumps(graph), "step": 0}
        req = urllib.request.Request(
            f"{host.rstrip('/')}/api/v1/runs/{t.run_id}/figures",
            data=json.dumps(payload).encode(),
            headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=120)

    t.finish()
    print(f"✓ 已记录到 run: {t.run_id}")


if __name__ == "__main__":
    main()
