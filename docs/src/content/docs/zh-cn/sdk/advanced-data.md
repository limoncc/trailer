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

可视化权重附近的 2D 损失曲面——热力图、等高线、可交互 3D 曲面。每个 step 记录一张网格,Landscape 标签页即可回放"景观随训练演化"。

**自动模式(PyTorch,推荐)**——直接传模型:SDK 自动构造 filter 归一化方向(跳过 bias/BN)、在固定 batch 子集上评估网格、恢复原参数并记录。需要训练环境装有 `torch`(缺失时友好跳过,绝不阻塞训练):

```python
t.log_loss_landscape(model, train_loader, n=51, step=epoch)       # 随机方向
t.log_loss_landscape(model, loader, model_b=ckpt, step=epoch)     # 两 checkpoint 插值
t.log_loss_landscape(model, loader, n=51, chunk=128)              # vector 模式:显存紧张时调小 chunk
t.log_loss_landscape(model, loader, parallel="high")              # vector 并行档位: low/medium/high/max
```

**评估模式**——默认零调参:不传 `mode`/`chunk`/`parallel` 时,SDK 先探测一次前向的激活占用,然后在约 1GB 的显存预算(`DEFAULT_MEMORY_BUDGET`)内选最省的可行方案——预算内选最小 `chunk` 走 vector,连单个网格点都放不下则转 serial。记录的 `meta.mode` 标明实际走的路径:

- **`vector`**(多数情况):`torch.func` 批量前向(`vmap`+`functional_call`)。预算同时计入**参数项**(模型+fp32 双方向+扰动批量)与**批量激活**——真实 batch 下后者才是大头。快 1~2 个数量级,预算装得下就优先用它。
- **`serial`**(大模型,或预算无法满足):**in-place 逐点扰动**,每个网格点评估完从 CPU 备份精确恢复——**零整模型参数副本**,GPU 峰值 ≈ 模型 + 激活。设备放不下双方向张量时,方向按模型 dtype 建在 CPU、逐层流式上卡。`vmap` 无法追踪的模型(flash-attention、自定义 CUDA 算子、量化内核)也走这条路径。

`chunk` / `parallel` / `mode` 保留为**可选覆盖项**(显式给定会跳过探测,保持档位语义):

```python
t.log_loss_landscape(model, loader)                    # auto:显存预算自动规划,零调参
t.log_loss_landscape(model, loader, mode="serial")     # 强制低显存路径
t.log_loss_landscape(model, loader, parallel="high")   # 显式换更大的参数工作集
```

**手动模式(其他框架 / 离线计算)**——传现成网格:

```python
# z[row][col] = loss(θ* + α·δ + β·η), α ∈ x_range, β ∈ y_range
grid = ...  # N×N 浮点矩阵,推荐 51×51,边长上限 250
t.log_loss_landscape(grid, name="landscape", step=epoch,
                     x_range=(-1, 1), y_range=(-1, 1),
                     meta={"normalization": "filter", "direction": "random", "seed": 0})
```

> **⚠️ 画图前必读**——方向 δ/η 必须 **filter 归一化**(按输出通道逐个 `d_f ← d_f/‖d_f‖·‖θ_f‖`),且必须**跳过 bias / BatchNorm 参数**。未归一化的随机方向在 BN 网络上会因尺度不变性产生假悬崖(Li et al., NeurIPS 2018)。自动模式已内置处理;手动模式可直接复制的 PyTorch 配方(含 BN running statistics 陷阱)见 `trailer-sdk/examples/loss_landscape_demo.py`(`--self-check` 可在无数据集情况下验证方向数学),构件亦可导入:`from trailer.landscape import filter_normalized_directions, evaluate_grid`。

实践默认值:51×51 网格 × 固定 8 个 batch 子集(10M 参数 CNN 约 2–5 GPU 分钟),取 train loss,每个 run 固定方向 seed 保证跨 step 可比。

### 大模型(LLM)

网格开销 ≈ `n²` 次前向 × 评估 tokens——单卡分钟级;显存才是硬门槛,`mode="serial"` 已把它移除(前提是模型本身装得下)。7B fp16 模型参考:

| n | 前向次数 | A100 bf16,约 2k 评估 tokens |
|---|---|---|
| 51 | 2601 | ~8 分钟 |
| 21 | 441 | ~1.5 分钟 |

- 建议 `n=21`、`nbatches=1~2`、短序列固定校准集——景观要的是**相对形状**,不是精确 loss 值
- 跨 step 用同一评估子集保证可比(自动模式已内置)
- `parallel`/`chunk` 只作用于 `vector` 模式,`serial` 忽略之

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
