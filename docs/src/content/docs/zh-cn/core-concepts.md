---
title: 核心概念
description: 理解 Trailer 的数据模型:项目、Run、Step、指标、Sweep、配置
---

## 项目(Project)

实验的顶级分组。`Tracker(project="demo")` 把所有 run 归入 `demo` 项目。一个项目可以包含任意数量的 run。前端首页按项目展示实验。

## Run

一次独立实验运行,由 `Tracker` 创建。每个 run 有:

- `run_id`:唯一标识(自动生成,如 `run_a1b2c3`),可用 `resume_from` 恢复
- `state`:运行状态 `running → finished | crashed | archived`
- `created_at` / `heartbeat_at`:创建与最近心跳时间
- `owner_id`:归属用户(多用户模式下隔离)

Run 状态由心跳机制管理:SDK 每 30s 发一次心跳,server 60s 未收到心跳自动标记 `crashed`。

## Step

训练迭代步数,是指标的 x 轴。`t.log({...}, step=step)` 显式指定;不指定时自动递增。

## 指标(Metric)

`log()` 记录的标量。支持 TensorBoard 风格的 `key/context` 命名(如 `train/loss`、`val/accuracy`),前端会自动按 `train`/`val` 分组。

## Summary

每个 run 每项指标的**增量统计**:`last`、`min`、`max`、`best`、`best_step`。`best` 按 `metric_directions` 声明的方向计算。前端表格直接展示,无需全量拉取指标。

## Sweep

超参搜索分组。实际使用 [Explore 工作台](/zh-cn/ui/explore/) 的 **Parallel(平行坐标)** 图对比超参组合。

## 配置(Config)

`Tracker(config={...})` 记录超参,支持:

- 显式 dict
- 自动捕获 `argparse` / OmegaConf / Hydra 参数
- 前端 Config Tab 查看,Compare 页支持配置差异对比

## 数据流

```
Python SDK [log()] → RingBuffer → FlushThread → PyO3/HTTP
    → Rust Ingest [Channel → Writer → SQLite/PostgreSQL/文件]
    → Axum API → Web UI
```
