"""2 个完整 run — 覆盖全部数据类型(本地模式)。

数据类型:Config / Metrics / Histograms / Figures / Texts / Media / Tables / Model

用法(连本地 server):
  TRAILER_HOST=http://127.0.0.1:5120 TRAILER_TOKEN=<token> \
      .venv/bin/python python/examples/seed_full_demo.py
"""
import math
import os
import random

random.seed(3)

import numpy as np
from PIL import Image
import torch
import torch.nn as nn

from trailer import Tracker


class SimpleCNN(nn.Module):
    def __init__(self, hidden=16):
        super().__init__()
        self.conv1 = nn.Conv2d(3, hidden, 3, padding=1)
        self.bn1 = nn.BatchNorm2d(hidden)
        self.conv2 = nn.Conv2d(hidden, hidden * 2, 3, padding=1)
        self.bn2 = nn.BatchNorm2d(hidden * 2)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(hidden * 2, 10)

    def forward(self, x):
        x = self.pool(torch.relu(self.bn2(self.conv2(torch.relu(self.bn1(self.conv1(x)))))))
        return self.fc(x.flatten(1))


def run_exp(name, hidden, lr, seed):
    rnd = random.Random(seed)
    t = Tracker(project="demo_full8", name=name, config={
        "model": "SimpleCNN", "hidden": hidden, "lr": lr, "epochs": 30,
        "optimizer": "adam", "batch_size": 64, "dataset": "cifar10",
    })
    steps = list(range(30))

    # 1. Metrics(多 key)
    for step in steps:
        t.log({
            "train/loss": 0.8 * math.exp(-step / 30) + 0.03 * rnd.random(),
            "train/acc": 1 - math.exp(-step / 35) + 0.01 * rnd.random(),
            "val/loss": 0.9 * math.exp(-step / 28) + 0.04 * rnd.random(),
        }, step=step)

    # 2. Histograms(权重分布演化)
    for step in range(0, 30, 5):
        t.log_histogram(
            [rnd.gauss(0, max(0.1, 1 - step / 30 * 0.6)) for _ in range(400)],
            name="conv1/weight", step=step,
        )

    # 3. Figures(G2 line spec)
    loss_data = [{"step": s, "value": 0.8 * math.exp(-s / 30) + 0.02 * rnd.random()} for s in steps]
    t.log_figure({
        "type": "line",
        "data": loss_data,
        "encode": {"x": "step", "y": "value"},
    }, name="loss_curve", step=0)

    # 4. Texts(Markdown)
    t.log_text(
        f"## {name}\n\n{name} 完整实验记录(全部数据类型)。\n\n"
        f"- 模型:SimpleCNN(hidden={hidden})\n- lr={lr}\n- 训练 30 epoch",
        name="notes", step=0,
    )

    # 5. Media(图像)
    arr = (np.random.rand(64, 64, 3) * 255).astype(np.uint8)
    t.log_image(Image.fromarray(arr, "RGB"), name="sample_input", step=0)
    mask = (np.random.rand(64, 64) * 255).astype(np.uint8)
    t.log_image(Image.fromarray(mask, "L"), name="mask", step=10)

    # 6. Tables(混淆矩阵)
    t.log_table([
        {"actual": "cat", "predicted": "cat", "count": 85},
        {"actual": "cat", "predicted": "dog", "count": 15},
        {"actual": "dog", "predicted": "cat", "count": 10},
        {"actual": "dog", "predicted": "dog", "count": 90},
    ], name="confusion_matrix", step=29)

    # 7. Model(PyTorch 架构图)
    t.log_model(SimpleCNN(hidden), name="architecture", step=0, trace=True, input_shape=(1, 3, 32, 32))

    t.finish()
    print(f"  ✓ {name}(config+metrics+hist+fig+text+media+table+model)")


def main():
    for name, hidden, lr, seed in [
        ("cnn_full_a", 16, 0.01, 1),
        ("cnn_full_b", 32, 0.05, 2),
    ]:
        run_exp(name, hidden, lr, seed)
    print("✅ demo_full8 项目:2 个完整 run 已生成")


if __name__ == "__main__":
    main()
