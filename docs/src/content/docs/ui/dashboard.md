---
title: Dashboard & Projects
description: Home page, project list, experiment table, and activity overview
---

The home page gives an overview of all experiments.

## Project list

- Each project is listed with its runs; click a project to open its experiment table
- Status cards show total runs, active runs, and reports

## Experiment table

The run table supports:

- **Status filter**: all / running / finished / crashed / archived
- **Search**: name, expression, or `config.key == value`
- **Column config**: persisted per-user via localStorage
- **Pagination** with page-size selector

## Run management

Each row's ⋮ menu offers:

| Action | Endpoint | Notes |
|--------|----------|-------|
| Copy | `POST /api/v1/runs/{id}/copy` | duplicate the run |
| Resume | `POST /api/v1/runs/{id}/resume` | only for non-running runs |
| Archive | `POST /api/v1/runs/{id}/archive` | only for running runs |
| Delete | `POST /api/v1/runs/{id}/delete` | type-to-confirm |

Multi-select shows a toolbar with **Compare** (≥2 runs) plus batch Archive / Delete.

## Activity chart

A GitHub-style activity heatmap grouped by run creation date.

## Dashboard page

The `/dashboard` page shows status cards, a project overview table, and an active-run chart.
