---
title: Run 详情
description: Run 详情页 — Config、Metrics、Histograms、PCA、Figures、Texts、Media、Tables、Model
---

Run 页面(`/run/[id]`)展示最多 9 个标签。只有 run 有对应数据时标签才会显示。

| 标签 | 内容 |
|------|------|
| Config | 超参、环境、git 快照 |
| Metrics | 全部标量曲线——折线图,支持 log 轴、平滑、Step / Wall Time 切换 |
| Histograms | 权重分布随 step 演化(三栏) |
| PCA | 嵌入 3D 散点(Three.js),step 滑块 + 自动播放 |
| Figures | 记录的图像 / matplotlib / G2 图 |
| Texts | 记录的文本样本 |
| Media | 音频 / 视频播放器 |
| Tables | 记录的表格数据 |
| Model | PyTorch 模型结构图(mviz) |

## Metrics 标签

- 每个指标卡片支持**移动平均平滑**、**log 轴**、**多系列叠加**
- X 轴可在 **Step** 与 **Wall Time** 间切换
- 悬停显示十字线 + tooltip

## 分享 run

Share 按钮生成匿名只读链接:

```
https://host/run/{id}?token=xxx
```

任何人凭链接无需登录即可查看该 run。
