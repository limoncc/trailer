---
title: Metrics, config, and best semantics
description: train/val auto-grouping, config snapshots, metric_directions priority, Step vs Wall Time views
---

This page explains the mechanics behind the previous two pages: how to name metrics so they stay useful, how to record hyperparameters so comparisons are meaningful, what `best` actually means, and what `step` is.

## Metric naming: `group/name` auto-grouping

```python
tracker.log({"train/loss": 0.31, "val/loss": 0.42, "val/accuracy": 0.87}, step=epoch)
```

Trailer splits names TensorBoard-style: `train/loss` is stored as **key=`loss` + context=`train`**.

- The dashboard Metrics page groups by context: `train/*` in one group, `val/*` in another, collapsible
- The "Metrics group" filters in Compare and Explore also filter by context (e.g. show only `val/*`)
- Metrics without `/` (like `loss`) have an empty context and belong to no group — **always use a group prefix**

Common conventions: `train/*` for training-set metrics, `val/*` for validation, `test/*` for test; custom groups like `eval/f1` or `system/gpu_mem` work too.

## config: the hyperparameter snapshot

```python
tracker = Tracker(project="exp", config={"lr": 0.01, "batch": 32, "seed": 42})
```

- `config` is an arbitrarily nested JSON dict, immutable after creation (the Compare config diff is based on it)
- It is stored with the run metadata and shown in the run table and Compare page
- Rule of thumb: **anything that affects results is a hyperparameter** — seeds, data versions, framework versions, git commits are all worth recording

## metric_directions: how best is computed

The `best` column in the run table picks the semantically optimal value over the whole training process. The direction is resolved in this order:

1. **Explicit declaration**: `Tracker(metric_directions={"accuracy": "max"})`; values accept `max`/`maximize` and `min`/`minimize`
2. **Naming convention**: names containing `acc`/`accuracy`/`auc`/`f1`/`recall`/`precision`/`score` etc. → maximize; everything else → minimize
3. **Default**: minimize

Two easy pitfalls:

- The keys in `metric_directions` match the metric name **after** the context is split off: `val/accuracy` has key `accuracy`, so write `{"accuracy": "max"}` — `{"val/accuracy": "max"}` has no effect
- The same key computes `best` independently per context: `train/loss` and `val/loss` never interfere

`metric_directions` is merged into `config` and persisted, so direction declarations survive a resume.

## Step semantics

```python
tracker.log({"loss": 0.5}, step=10)   # explicit step: x-axis = 10
tracker.log({"loss": 0.4})            # no step: auto-increment (starts at 0)
```

- **Explicit step**: you control the x-axis; train and eval share one scale
- **Auto-increment**: each `log` call advances +1 — convenient for simple loops
- **Don't mix them carelessly**: once you use an explicit step, later calls without `step` continue the internal counter and may drift off your scale — pick one style per run
- Hardware metrics (CPU / memory / GPU) are sampled aligned to steps and shown on the same axis; switch to the **Wall Time** view for the real-time timeline (useful for spotting "which step was slow")

## From step to run summary

Each `(run, metric, context)` tuple incrementally maintains one summary row:

| Field | Meaning |
|-------|---------|
| `last` | value at the newest step |
| `min` / `max` | extremes over the whole run |
| `best` / `best_step` | direction-aware optimum and where it happened |

This is the data source for the best / last columns in the run table — maintained incrementally on write rather than recomputed on query, so tables load instantly.

## Next steps

- Recording non-scalar data (images / tables / embeddings / loss landscapes) → [Advanced data types](/sdk/advanced-data/)
- Multi-machine collaboration and storage backends → [Local / remote / file modes](/sdk/modes/)
- Training interrupted? → [Resuming a run](/sdk/logging/#resuming-a-run)
