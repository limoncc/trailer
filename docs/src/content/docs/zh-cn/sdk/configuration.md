---
title: 配置与超参
description: 记录超参:config 捕获、指标方向
---

## 记录 config

```python
t = Tracker(project="demo", config={"lr": 0.01, "batch": 32})
```

config 随 run 存储,在 Run 详情页的 **Config** 标签展示。

## 自动捕获

配置捕获自动聚合多个来源:

- **显式 dict**(`Tracker(config=...)`)
- **`argparse`** 命令行参数
- **OmegaConf / Hydra** 配置

```python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--lr", type=float, default=0.01)
args = parser.parse_args()

t = Tracker(project="demo")   # --lr 自动捕获
```

## 代码快照

Trailer 记录 git 快照(commit / branch / diff),保证实验可复现。

## 指标方向

声明指标"越大越好"还是"越小越好",`best` 按语义计算:

```python
t = Tracker(
    project="demo",
    metric_directions={
        "accuracy": "max",
        "loss": "min",
        "val/f1": "max",
    },
)
```

summary(`best` / `best_step`)会遵循这些方向。
