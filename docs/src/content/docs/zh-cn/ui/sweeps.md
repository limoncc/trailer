---
title: Sweeps 超参扫描
description: 按 sweep_id 分组的超参扫描 — 平行坐标图找参数与指标的关系
---

Sweeps 页（`/sweeps`）把属于同一次超参扫描的 run 聚在一起，用平行坐标图找出"哪些参数组合通向好结果"。

## 创建一个 sweep

给多个 run 传同一个 `sweep_id`，它们就归入同一组：

```python
for lr in [0.01, 0.05, 0.1]:
    for bs in [16, 32]:
        t = Tracker(project="exp", sweep_id="lr-bs-grid",
                    config={"lr": lr, "batch": bs},
                    metric_directions={"accuracy": "max"})
        train(t, lr, bs)
        t.finish()
```

`sweep_id` 只是 run 上的一个标签，不影响数据落盘；忘记传也不会报错，只是不进分组。

## Sweep 列表页

`/sweeps` 列出所有 sweep，每个卡片显示：

- `sweep_id`、run 数量、参数维度数
- 该组 run 的 config key 标签（最多展示 6 个）

## Sweep 详情页

点进某个 sweep（`/sweeps/<sweep_id>`），核心是**平行坐标图**：

- **每条竖轴** = 一个参数（`cfg_` 前缀）或一个指标（`metric_` 前缀）
- **每条折线** = 一次 run，穿过它涉及的所有参数与指标轴
- **怎么读**：折线在某根指标轴上的高低对应结果好坏；往回追溯它在各参数轴上的位置，就能看出"哪段参数区间倾向于产生好结果"——线条密集交叉的区域是常见配置，稀疏的极端位置是激进尝试

> ⚠️ 前提：**≥2 个 run 且 ≥2 个维度**（参数 + 指标），否则图无内容。建议让不同 run 的 config 真有差异，平行坐标才有区分度。

右侧栏提供：

- **Top Runs**：按顺序列出该 sweep 的 run，点击直达详情
- **Compare all**：一键把整组 run 送进 [Compare](../ui/compare/) 页精细对比

## 典型工作流

1. 脚本里固定 `sweep_id`，循环扫参数
2. Sweeps 页找到该组 → 平行坐标图初判参数趋势
3. Top Runs / Compare all 深入对比最优的几个 run
4. 回到脚本，围绕最优区间继续扫

## 相关

- `sweep_id` 是 `Tracker` 的构造参数，见 [记录指标与数据](../sdk/logging/)
- 跨项目自由分析用 [Explore](../ui/explore/)，Sweeps 专注"单次扫描内参数→指标"的关系
