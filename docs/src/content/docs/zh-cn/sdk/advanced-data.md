---
title: 高级数据类型
description: 文本、图表、表格、图像、视频、音频、直方图、嵌入、PCA、模型结构
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
