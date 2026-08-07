---
title: Compare 对比
description: 多 run 对比 — 指标叠加、配置差异、分组筛选
---

Compare 页面(`/compare`)对比两个及以上 run。

## 选择 run

- 在实验表格工具栏勾选 ≥2 个 run,或访问 `/compare?runs=...`
- 通过 **Run / Metrics 分组筛选**聚焦对比范围

## 对比什么

- **指标**:多 run 曲线在同一坐标系叠加
- **配置**:超参并排 diff(新增 / 修改 / 删除键)
- **Summary**:每项指标的 best / last / min / max

## 分组筛选

Run 与 Metric 分组筛选支持只对比部分 run 的部分指标(如仅 `train/*` 指标)。
