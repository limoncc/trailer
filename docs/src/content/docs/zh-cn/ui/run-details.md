---
title: Run 详情
description: Run 详情页 — Config、Metrics、Histograms、PCA、Landscape、Figures、Texts、Media、Tables、Model
---

Run 页面(`/run/[id]`)展示最多 10 个标签。只有 run 有对应数据时标签才会显示。

| 标签 | 内容 |
|------|------|
| Config | 超参、环境、git 快照 |
| Metrics | 全部标量曲线——折线图,支持 log 轴、平滑、Step / Wall Time 切换 |
| Histograms | 权重分布随 step 演化(三栏) |
| PCA | 嵌入 3D 散点(Three.js),step 滑块 + 自动播放 |
| Landscape | 2D 损失景观网格——热力图、等高线叠加、3D 曲面;step 滑块 + 自动播放 |
| Figures | 记录的图像 / matplotlib / G2 图 |
| Texts | 记录的文本样本 |
| Media | 音频 / 视频播放器 |
| Tables | 记录的表格数据 |
| Model | PyTorch 模型结构图(mviz) |

## Metrics 标签

- 每个指标卡片支持**移动平均平滑**、**log 轴**、**多系列叠加**
- X 轴可在 **Step** 与 **Wall Time** 间切换
- 悬停显示十字线 + tooltip

## Landscape 标签

每张记录的损失景观(`t.log_loss_landscape(...)`,见[高级数据类型](/zh-cn/sdk/advanced-data/))对应一张卡片:

- **Heat** — 纯色彩场,悬停读取 (α, β, loss)
- **Contour** — 纯等高线(无底色)
- **Both** — 热力图 + d3-contour 等高线叠加
- **Surface** — 可交互 Three.js 曲面:拖拽旋转、滚轮缩放、线框开关、Front/Side/Top 视角
- **⚽ Roll + 球速** — **三种视图**都可重放梯度下降小球(从最高点滚落,带尾迹);速度 0.5×–4× 可调;切换视图或新数据帧时自动播放
- **配色选择器** — plasma(默认)/ coolwarm / magma / viridis,热力图、等高线与 3D 曲面同步应用
- **Step 滑块 + ▶ 自动播放** — 回放景观随训练的演化(滑块在*已记录*的帧间移动——逐 epoch 记录即可逐步回放)
- 卡片按名称分组;run 仍在训练时按刷新间隔实时补帧

## 分享 run

Share 按钮生成匿名只读链接:

```
https://host/run/{id}?token=xxx
```

任何人凭链接无需登录即可查看该 run。
