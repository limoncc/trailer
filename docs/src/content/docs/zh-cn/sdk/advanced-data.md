---
title: 高级数据类型
description: 文本、图表、表格、图像、视频、音频、直方图、嵌入、PCA、模型结构、损失景观
---

除了标量指标,`Tracker` 还支持完整的数据类型记录。

## 文本

```python
t.log_text("summary", "训练完成,准确率 91%")
```

## 图表

matplotlib 图或 G2 spec:

```python
import matplotlib.pyplot as plt

fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 4, 9])
t.log_figure(fig, name="loss-curve")
```

## 表格

DataFrame 或 list[dict]:

```python
t.log_table({"epoch": [1, 2, 3], "accuracy": [0.8, 0.85, 0.9]})
t.log_table([{"a": 1, "b": "x"}, {"a": 2, "b": "y"}], name="samples")
```

## 图像 / 视频 / 音频

```python
t.log_image(img, name="sample")       # PIL / numpy / 文件路径
t.log_video("output.mp4", name="demo")
t.log_audio("audio.wav", name="tts")
```

## 直方图

权重分布随时间演化:

```python
import torch
t.log_histogram(torch.randn(1000), name="w1", step=step)
```

Histograms 标签页以三栏展示权重演化。

## 嵌入向量

PCA 降维的嵌入可视化(需 `trailer[embedding]` 启用真实 PCA):

```python
t.log_embedding(vectors, name="embeddings", step=step)
```

## PCA(3D 散点)

PCA 降到 3 维 + k-means 聚类,Three.js 渲染:

```python
t.log_pca(vectors, name="embeddings", step=step)
```

## 损失景观(Loss Landscape)

可视化权重附近的 2D 损失曲面——热力图、等高线、可交互 3D 曲面。网格在训练循环内计算并按 step 记录,Landscape 标签页可用滑条回放"景观随训练演化":

```python
# z[row][col] = loss(θ* + α·δ + β·η), α ∈ x_range, β ∈ y_range
grid = ...  # N×N 浮点矩阵,推荐 51×51,边长上限 250
t.log_loss_landscape(grid, name="landscape", step=epoch,
                     x_range=(-1, 1), y_range=(-1, 1),
                     meta={"normalization": "filter", "direction": "random",
                           "seed": 0, "split": "train"})
```

> **⚠️ 画图前必读**——方向 δ/η 必须做 **filter 归一化**(按输出通道逐个 `d_f ← d_f/‖d_f‖·‖θ_f‖`),且必须**跳过 bias / BatchNorm 参数**。未归一化的随机方向在 BN 网络上会因尺度不变性产生假悬崖(Li et al., NeurIPS 2018)。可直接复制的 PyTorch 配方(含 BN running statistics 陷阱处理)见 `trailer-sdk/examples/loss_landscape_demo.py`,加 `--self-check` 可在无数据集情况下验证方向数学。

实践默认值:51×51 网格 × 固定 8 个 batch 子集(10M 参数 CNN 约 2–5 GPU 分钟),取 train loss,每个 run 固定方向 seed 保证跨 step 可比。

## 模型结构图

PyTorch 模型结构(mviz 引擎):

```python
import torch.nn as nn

model = nn.Sequential(nn.Linear(10, 10), nn.ReLU(), nn.Linear(10, 1))
t.log_model(model, name="my-net", step=step)
```

Model 标签页渲染计算图,含层 shape 与数据流边。

## 配置捕获

```python
t = Tracker(project="demo", config={"lr": 0.01, "batch_size": 32})
```

argparse / OmegaConf / Hydra 参数自动捕获。详见 [配置](/zh-cn/sdk/configuration/)。
