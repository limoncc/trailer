---
title: 第一个完整实验
description: 改超参重跑三次，用 run 表格与 Compare 找出最优组合 — 建立实验跟踪闭环
---

上一页你已经记下了一条曲线。这一页把"训练 → 记录 → 看 → 改 → 再跑 → 对比"的完整闭环走一遍——这是用 trailer 做实验的核心节奏。

## 场景

用一个 20 行的纯 Python 逻辑回归拟合二维点，学习率 `lr` 对收敛影响很大。我们跑 3 组超参，在看板里找出最优的一组。

## 第一步：写训练脚本（带 config）

```python
import argparse
import math
import random

from trailer import Tracker

parser = argparse.ArgumentParser()
parser.add_argument("--lr", type=float, default=0.05)
parser.add_argument("--steps", type=int, default=80)
args = parser.parse_args()

# 造两类二维点: x + 0.8y > 0 为正类
random.seed(42)
pts = [(random.uniform(-2, 2), random.uniform(-2, 2)) for _ in range(400)]
labels = [1.0 if x + 0.8 * y > 0 else 0.0 for x, y in pts]

w1 = w2 = bias = 0.0          # 权重初始化为 0

tracker = Tracker(
    project="playground",
    name=f"lr-{args.lr}",                          # run 名带上超参,表格里一眼可辨
    config={"lr": args.lr, "steps": args.steps},   # 超参快照,Compare 页可 diff
    metric_directions={"accuracy": "max"},         # 声明方向,best 按"越大越好"算
)

for step in range(args.steps):
    loss = 0.0
    correct = 0
    for (x, y), label in zip(pts, labels):
        p = 1.0 / (1.0 + math.exp(-(w1 * x + w2 * y + bias)))   # sigmoid
        loss += -(label * math.log(p + 1e-9) + (1 - label) * math.log(1 - p + 1e-9))
        correct += (p >= 0.5) == (label == 1.0)
        # 梯度下降
        err = p - label
        w1 -= args.lr * err * x / len(pts)
        w2 -= args.lr * err * y / len(pts)
        bias -= args.lr * err / len(pts)
    tracker.log({"train/loss": loss / len(pts),
                 "train/accuracy": correct / len(pts)}, step=step)

tracker.finish()
```

- `name=f"lr-{args.lr}"`：run 名带上关键超参
- `config={"lr": ..., "steps": ...}`：完整超参快照
- `metric_directions={"accuracy": "max"}`：best 语义（详见[下一篇](/zh-cn/tutorial/beyond-loss/)）

## 第二步：跑三次

```bash
python train.py --lr 0.01
python train.py --lr 0.05
python train.py --lr 0.5
```

`playground` 项目下现在有 3 个 run（`lr-0.01` / `lr-0.05` / `lr-0.5`），各自带自己的 config。

## 第三步：看板初筛

```bash
trailer up
```

进入 `playground` 项目页，run 表格里三行并列：

- 每行显示 best / last 的指标汇总——大 lr 常震荡不稳、小 lr 收敛慢，一眼看出差异
- 点任一 run 进详情页看曲线形态

## 第四步：Compare 精细对比

在表格里勾选 3 个 run → 点 **Compare**（或访问 `/compare?runs=...`）：

- **Metrics 区**：三个 run 的 `train/loss` 叠加在同一坐标系，收敛速度与最终水平直接可比
- **Config 区**：超参并排 diff，只有 `lr` 不同——确认对比变量唯一，结论才可信
- **Summary 区**：每项指标的 best / last / min / max 并排

## 第五步：养成记录习惯

把这套节奏固化进模板：

```python
tracker = Tracker(
    project="my-experiments",         # 项目按研究方向划分
    name=f"{model}-lr{lr}-bs{bs}",   # 名字带关键超参
    config={"lr": lr, "batch": bs, "model": model, "seed": seed},  # 能影响结果的都记
    metric_directions={"accuracy": "max", "loss": "min"},
)
```

几个值得现在就建立的习惯：

- **config 宁多勿少**——seed、数据版本、框架版本都算超参；Compare 的 config diff 只有信息全才有用
- **run 名有语义**——从表格直接读出实验意图，不用点进去
- **一个变量原则**——每组 run 只改一个超参，否则无法归因
- **结束必 `finish()`**——状态准确，看板才可信

## 你已经掌握了

- `Tracker(project/name/config/metric_directions)` 的完整用法
- run 表格初筛 + Compare 精细对比的两级流程
- 实验记录的基本纪律

下一步：[指标、超参与 best 语义](/zh-cn/tutorial/beyond-loss/) 把这几个 API 背后的机制讲透。
