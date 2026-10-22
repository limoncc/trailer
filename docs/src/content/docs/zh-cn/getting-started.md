---
title: 快速开始
description: 5 分钟上手 Trailer — 安装、记录第一个实验、打开看板、学会下一步
---

Trailer 是本地优先的 ML 实验追踪工具：训练脚本里记几行指标，就能在 Web 看板里看到曲线、对比实验、回放训练演化。

## 1. 安装

```bash
pip install trailer-sdk
```

wheel 内含 Rust 服务端二进制与前端，装完即用，无需单独部署。

从源码构建（开发模式）：

```bash
# 编译 Rust 服务端 + 打包前端
python build.py
# 编译 PyO3 扩展（可编辑安装）
uv run maturin develop
```

## 2. 记录第一个实验

在训练脚本里加三行：

```python
import random
from trailer import Tracker

tracker = Tracker(project="my_training")
for step in range(100):
    base = 0.9 * 0.96 ** step
    tracker.log({"train/loss": base + random.random() * 0.04,
                 "val/loss": base + 0.06 + random.random() * 0.06},
                step=step)
tracker.finish()
```

跑完后当前目录会生成 `trailer.db`（SQLite 本地存储），刚才的 100 步指标已落盘。

三个关键点：

- `Tracker(project=...)` 指定项目名，自动生成 `run_id`；多次运行同一脚本就是多个 run，天然可对比
- `t.log({...}, step=step)` 一次记录一组标量指标，`train/loss` 这类 `分组/名字` 命名会在看板里自动分组
- `t.finish()` 标记 run 完成（状态变为 finished）；异常退出也不会丢数据，后台会标记 crashed

## 3. 打开看板

```bash
trailer up
```

浏览器自动打开 `http://127.0.0.1:5120`。你能看到：

- 首页的 `my_training` 项目卡片与活跃概览
- 项目页的 run 表格（config、best、last 指标汇总）
- 点进 run 的 Metrics 页——`train/loss` 与 `val/loss` 两条衰减曲线

先自己点一圈：切换 Step / Wall Time 视图、框选缩放曲线、hover 读数。

## 4. 记录更多类型

Trailer 不止标量。常见补充：

```python
tracker.log({"lr": 0.01 * 0.99 ** step}, step=step)      # 更多标量（如学习率）
tracker.log_text("summary", "这轮收敛比上次快")            # 文本：结论、日志片段
tracker.log_figure(fig, name="confusion-matrix")          # matplotlib 图 / G2 spec
tracker.log_table({"epoch": [1, 2], "acc": [0.8, 0.9]})   # 表格
tracker.log_image(img, name="sample")                     # PIL / numpy / 路径
tracker.log_histogram(weights, name="w1")                 # 权重分布
tracker.log_pca(vectors, name="embeddings")               # 嵌入的 PCA 3D 投影
tracker.log_model(model, name="my-net")                   # PyTorch 模型结构图
```

硬件（CPU / 内存 / GPU）默认自动采样，无需任何代码，看板里与指标同轴对齐展示。

详见 [高级数据类型](sdk/advanced-data/)。

## 5. 给 run 起名、记录超参

```python
tracker = Tracker(
    project="my_training",
    name="lr0.01-batch32",                       # run 名，比 run_id 好认
    config={"lr": 0.01, "batch": 32, "opt": "adam"},  # 超参快照，Compare 页可看差异
    metric_directions={"accuracy": "max"},       # 声明指标方向，best 按语义计算
)
```

## 下一步

按顺序读，能从入门走到进阶：

1. [第一个完整实验](tutorial/first-experiment/) — 改超参重跑，用 Compare 找出最优组合
2. [指标、超参与 best 语义](tutorial/beyond-loss/) — train/val 分组、Step 语义、指标方向
3. [核心概念](core-concepts/) — 数据模型全景（项目 / Run / Sweep）
4. 想看一个真实研究实验怎么用 trailer 全套能力跟踪，读进阶案例 [Grokking 损失景观](case-studies/grokking/)（读完上面三篇后再来）

远程协作（团队 server）与多存储后端见 [本地 / 远程 / 文件模式](sdk/modes/)。
