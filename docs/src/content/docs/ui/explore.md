---
title: Explore
description: Cross-project analysis workspace — configurable charts, saved and shareable
---

The Explore workspace (`/explore`) enables cross-project, multi-run analysis that persists and can be shared.

## Creating an analysis

1. Go to `/explore` → **New Analysis**
2. Pick runs from any project (RunPicker: grouped, searchable, multi-select)
3. Configure charts:
   - **Line**: x = step/wall_time, y = one or more metrics (multi-select, grouped by context); log axis and moving-average smoothing
   - **Scatter**: any x/y from config or summary metrics; log axis + linear regression line
   - **Parallel**: multi-dimensional hyperparameters + target metric (Leafer-rendered; hover to inspect, best combo pre-selected)
4. **Save** to persist the analysis

## Sharing

An Explore analysis can be shared as an anonymous read-only link:

```
https://host/explore/{id}?token=xxx
```

The link grants read access to the runs included in the analysis.

## Data model

Analyses are stored in the `explores` table (run_ids + chart defs). Editing and viewing are owner-scoped; `?token=` links allow anonymous read-only access.
