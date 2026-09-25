---
title: Explore 分析工作台
description: 跨项目分析 — 可拖拽缩放的对比看板,支持保存与分享
---

Explore 工作台(`/explore`)支持跨项目、多 run 的分析,可持久化并分享。

## 新建分析

1. 进入 `/explore` → **New Analysis**
2. 从任意项目挑选 run(RunPicker:分组、搜索、多选)
3. **Add Widget** 往看板里加卡片。看板与 Boards 同一套 36 列网格:拖动把手换位、右下角手柄缩放、磁铁吸附相邻卡片、卡片头改标题/取色,铅笔打开配置对话框。
4. **Save** 持久化布局

### 卡片类型(多 run 对比语义)

| 类型 | 说明 |
|---|---|
| **Metrics** (line) | 一个或多个指标 × 每个可见 run 各一条曲线;step/wall_time、log 轴、平滑 |
| **Scatter** | x/y 任选 config 或 summary 标量,每 run 一个点;log 轴 + 线性回归线 |
| **Pair** | 两条指标按 step 内连接成对散点(loss vs accuracy) |
| **Parallel** | 多维超参 + 目标指标(Leafer 渲染;悬停查看) |
| **Diff** | 超参消融差异表:只列出可见 run 之间取值不同的 config 键(需 2+ run) |
| **Summary** | 指标汇总表:每指标 Last / Best / Min / Max 四列(缺省取全部 summary 指标) |

单 run 语义的卡片(直方图 / 图片 / 文本 / 表格等)属于 Boards,不进 Explore。

## 分享

Explore 分析可生成匿名只读链接:

```
https://host/explore/{id}?token=xxx
```

该链接可匿名读取分析包含的所有 run 数据(只读:无添加/保存控件)。

## 数据模型

分析存储在 `explores` 表(run_ids + config,看板布局在 config.layout)。编辑与查看按 owner 隔离;`?token=` 链接提供匿名只读访问。
