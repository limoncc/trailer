---
title: Compare
description: Compare multiple runs side by side — metrics, config diff, and grouping filters
---

The Compare page (`/compare`) compares two or more runs.

## Selecting runs

- Pick ≥2 runs from the experiment table toolbar, or navigate to `/compare` with `?runs=...`
- Filter by **Run** and **Metric** groups to focus the comparison

## What you can compare

- **Metrics**: overlay curves from multiple runs on shared axes
- **Config**: side-by-side hyperparameter diff (added / modified / removed keys)
- **Summaries**: best / last / min / max per metric

## Grouping filters

Run and metric grouping filters let you compare e.g. only `train/*` metrics across a subset of runs.
