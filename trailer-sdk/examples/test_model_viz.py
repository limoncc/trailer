"""测试 model 可视化功能：生成 Qwen + 自定义模型数据"""
import os, sys, json, math
import torch
import torch.nn as nn

os.environ.pop("TRAILER_HOST", None)
from trailer import Tracker

# ============================================================
# 1. 自定义模型 MyCustomNet
# ============================================================
class MyCustomNet(nn.Module):
    def __init__(self, in_ch=3, num_classes=10):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(in_ch, 16, 3, padding=1),
            nn.BatchNorm2d(16),
            nn.ReLU(),
        )
        self.blocks = nn.ModuleList([
            nn.Sequential(
                nn.Conv2d(16, 16, 3, padding=1),
                nn.BatchNorm2d(16),
                nn.ReLU(),
            ) for _ in range(4)
        ])
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.head = nn.Linear(16, num_classes)

    def forward(self, x):
        x = self.stem(x)
        for b in self.blocks:
            x = b(x) + x
        return self.head(self.pool(x).flatten(1))

print("=" * 50)
print("1. Custom model (static)")
t = Tracker(project="model-demo", name="my_custom_net")
model = MyCustomNet()
t.log_model(model, name="my_custom_net", step=0)
# Some dummy metrics
for step in range(10):
    t.log({"loss": 0.5 / (step + 1)}, step=step)
t.finish()
print(f"   done: {t.run_id}")

# ============================================================
# 2. Custom model with trace (forward hooks)
# ============================================================
print("\n2. Custom model (with hooks trace)")
t = Tracker(project="model-demo", name="my_custom_net_traced")
model2 = MyCustomNet()
t.log_model(model2, name="my_custom_net_traced", step=0, trace=True, input_shape=(1, 3, 32, 32))
t.finish()
print(f"   done: {t.run_id}")

# ============================================================
# 3. Qwen3.5-0.8B (meta device, static only)
# ============================================================
print("\n3. Qwen3.5-0.8B (meta device)...")
try:
    from trailer.model import load_meta_model, hf_input_spec, hf_output_spec
    from trailer.model.hf import annotate_layer_badges

    MODEL_PATH = "/Users/xiaobai/dev/llama.cpp/build/models/qwen/Qwen3.5-0.8B"
    model_qwen, cfg = load_meta_model(MODEL_PATH)
    print(f"   loaded: {type(model_qwen).__name__}")

    t = Tracker(project="model-demo", name="qwen3.5-0.8b")
    from trailer.model import extract_graph, save_graph as _sg
    import json as _json

    graph = extract_graph(
        model_qwen, name="Qwen3.5-0.8B", merge_repeats=True,
        input_spec=hf_input_spec(cfg),
        output_spec=hf_output_spec(cfg),
    )
    try:
        annotate_layer_badges(graph, model_qwen, cfg)
    except Exception:
        pass

    body_str = _json.dumps(graph)
    t._backend.save_figure("qwen3.5-0.8b", "model", body_str, 0, t.run_id)
    t.finish()
    print(f"   done: {t.run_id}")
except Exception as e:
    print(f"   SKIP: {e}")

print("\n✅ 完成！访问 http://127.0.0.1:5120 查看 model-demo 项目")
