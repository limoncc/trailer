---
title: Logging Metrics & Data
description: Core Tracker API usage — init, log(), step, finish
---

## Creating a Tracker

```python
from trailer import Tracker

t = Tracker(project="demo")
t = Tracker(project="demo", resume_from="run_a1b2c3")     # resume a previous run
t = Tracker(project="demo", config={"lr": 0.01})          # log hyperparameters
t = Tracker(project="demo", metric_directions={"accuracy": "max"})
```

## Logging scalar metrics

```python
t.log({"loss": 0.5, "accuracy": 0.91}, step=10)
```

- Log multiple metrics per call; dict keys are metric names
- `step` is optional; auto-increments when omitted
- TensorBoard-style grouping works: `train/loss`, `val/accuracy` — grouped automatically in the UI

## Step semantics

- Explicit `step`: precise control of the x-axis
- Auto step: consecutive `log()` calls increment automatically
- Hardware-monitoring samples align with experiment steps; toggle Step / Wall Time views

## Resuming a run

```python
t = Tracker(project="demo", resume_from="run_a1b2c3")   # reuse the run_id, continue from last_step
```

- Pass the same `run_id` via `resume_from` to append data to a previous run instead of creating a new one. On first run, persist `t.run_id` (e.g. into a checkpoint file) so it can be restored later
- On resume the SDK asks the server for the run's last step and auto-increments from `last_step + 1`; with explicit `step=` you control the x-axis yourself
- **Resume negotiation always goes over HTTP** (`POST /api/v1/runs/{id}/resume` + `GET /api/v1/runs/{id}/last_step`, default `127.0.0.1:5120`) — even in local mode. Run `trailer up` so step continuation works; otherwise the negotiation fails silently and auto-steps restart from 0
- All three local storage backends support resuming: SQLite (`storage="sqlite"`, default), file mode (`storage="file", data_dir="data"`), PostgreSQL (`storage="postgres"`)

## Lifecycle

```python
t.finish()   # mark the run finished (state → finished)
```

- The SDK heartbeats every 30s in the background; after 60s without a heartbeat the server marks a run `crashed`
- `finish()` flushes the remaining buffer and joins the sampler thread, so the last step is never lost

## Performance

- Writes go through a thread-safe `RingBuffer` (100k entries, P99 < 100µs) — `log()` never blocks training
- A background FlushThread batches (500 items / 1s) and writes in bulk; local mode goes through PyO3 with zero network
