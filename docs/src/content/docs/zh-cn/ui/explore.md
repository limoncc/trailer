---
title: Explore 分析工作台
description: 跨项目分析 — 可配置图表,支持保存与分享
---

Explore 工作台(`/explore`)支持跨项目、多 run 的分析,可持久化并分享。

## 新建分析

1. 进入 `/explore` → **New Analysis**
2. 从任意项目挑选 run(RunPicker:分组、搜索、多选)
3. 配置图表:
   - **Line**:x = step/wall_time,y = 一个或多个指标(多选,按 context 分组);支持 log 轴和移动平均平滑
   - **Scatter**:x/y 任选 config 或 summary 指标;log 轴 + 线性回归线
   - **Parallel**:多维超参 + 目标指标(Leafer 渲染;悬停查看,默认选中最佳组合)
4. **Save** 持久化分析

## 分享

Explore 分析可生成匿名只读链接:

```
https://host/explore/{id}?token=xxx
```

该链接可匿名读取分析包含的所有 run 数据。

## 数据模型

分析存储在 `explores` 表(run_ids + chart_defs)。编辑与查看按 owner 隔离;`?token=` 链接提供匿名只读访问。
