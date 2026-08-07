---
title: 看板与项目
description: 首页、项目列表、实验表格、活跃概览
---

首页提供所有实验的概览。

## 项目列表

- 每个项目列出其 run;点击项目进入实验表格
- 状态卡片显示总 run 数、活跃 run 数、报告数

## 实验表格

Run 表格支持:

- **状态筛选**:全部 / running / finished / crashed / archived
- **搜索**:名称、表达式、或 `config.key == value`
- **列配置**:按用户 localStorage 持久化
- **分页** + 页大小选择

## Run 管理

每行末尾的 ⋮ 菜单:

| 操作 | 端点 | 说明 |
|------|------|------|
| Copy | `POST /api/v1/runs/{id}/copy` | 复制 run |
| Resume | `POST /api/v1/runs/{id}/resume` | 仅非 running 状态 |
| Archive | `POST /api/v1/runs/{id}/archive` | 仅 running 状态 |
| Delete | `POST /api/v1/runs/{id}/delete` | 需输入确认 |

多选后工具栏出现 **Compare**(≥2 个 run)与批量 Archive / Delete。

## 活跃图

GitHub 风格的活跃热力图,按 run 创建日期分组。

## Dashboard 页

`/dashboard` 页面展示状态卡片、项目概览表和活跃 run 图表。
