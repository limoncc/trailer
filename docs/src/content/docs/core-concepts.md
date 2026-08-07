---
title: Core Concepts
description: Understand Trailer's data model — projects, runs, steps, metrics, sweeps, config
---

## Project

The top-level grouping for experiments. `Tracker(project="demo")` puts all runs under the `demo` project. The dashboard lists experiments per project.

## Run

A single experiment run, created by `Tracker`. Each run has:

- `run_id`: a unique identifier (e.g. `run_a1b2c3`), usable with `resume_from`
- `state`: `running → finished | crashed | archived`
- `created_at` / `heartbeat_at`: creation and last heartbeat time
- `owner_id`: owning user (isolation in multi-user mode)

Run state is managed by heartbeats: the SDK sends one every 30s; the server marks a run `crashed` after 60s without one.

## Step

The training iteration number — the x-axis of your metrics. Pass it explicitly with `t.log({...}, step=step)`, or let it auto-increment.

## Metric

Scalars logged with `log()`. TensorBoard-style `key/context` naming is supported (e.g. `train/loss`, `val/accuracy`), and the UI groups them automatically.

## Summary

Incremental statistics per run per metric: `last`, `min`, `max`, `best`, `best_step`. `best` respects the direction declared in `metric_directions`. The table view reads summaries directly — no need to fetch full series.

## Sweep

A hyperparameter search group. In practice, compare hyperparameter combinations with the **Parallel** chart in the [Explore workspace](/ui/explore/).

## Config

`Tracker(config={...})` logs hyperparameters. It supports:

- Explicit dicts
- Automatic capture of `argparse` / OmegaConf / Hydra parameters
- A Config tab in the run view, and config-diff comparison in the Compare page

## Data flow

```
Python SDK [log()] → RingBuffer → FlushThread → PyO3/HTTP
    → Rust Ingest [Channel → Writer → SQLite/PostgreSQL/File]
    → Axum API → Web UI
```
