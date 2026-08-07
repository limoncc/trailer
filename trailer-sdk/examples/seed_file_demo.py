"""文件模式演示:2 个实验,含 config/metrics/histograms/text/model。

用法(连本地文件模式 server):
  TRAILER_HOST=http://127.0.0.1:5120 TRAILER_TOKEN=<token> \
      .venv/bin/python python/examples/seed_file_demo.py
"""
import math
import os
import random

random.seed(1)

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


def train(t, steps, seed):
    rnd = random.Random(seed)
    for step in range(steps):
        t.log({
            "train/loss": 0.8 * math.exp(-step / 30) + 0.03 * rnd.random(),
            "train/acc": 1 - math.exp(-step / 35) + 0.01 * rnd.random(),
            "val/loss": 0.9 * math.exp(-step / 28) + 0.04 * rnd.random(),
        }, step=step)
    for step in range(0, steps, 5):
        t.log_histogram(
            [rnd.gauss(0, max(0.1, 1 - step / steps * 0.6)) for _ in range(500)],
            name="conv1/weight", step=step,
        )


def main():
    for name, hidden, lr, seed in [
        ("cnn_baseline", 16, 0.01, 1),
        ("cnn_wide", 32, 0.05, 2),
    ]:
        t = Tracker(project="demo_full", name=name, config={
            "model": "SimpleCNN", "hidden": hidden, "lr": lr, "epochs": 40,
            "optimizer": "adam", "batch_size": 64, "dataset": "cifar10",
        })
        t.log_text(
            f"## {name}\n\n{name} 训练实验记录:SimpleCNN(hidden={hidden}),lr={lr}。",
            name="notes", step=0,
        )
        t.log_model(SimpleCNN(hidden), name="architecture", step=0, trace=True, input_shape=(1, 3, 32, 32))
        train(t, 40, seed)
        t.finish()
        print(f"  ✓ {name}")


if __name__ == "__main__":
    main()
