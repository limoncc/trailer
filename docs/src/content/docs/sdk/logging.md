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
t = Tracker(project="demo", resume_from="run_a1b2c3")                # reuse the run_id, continue from last_step
t = Tracker(project="demo", resume_from="run_a1b2c3", from_step=50)  # restart from a step-50 checkpoint: drop data after step 50
```

- Pass the same `run_id` via `resume_from` to append data to a previous run instead of creating a new one. On first run, persist `t.run_id` (e.g. into a checkpoint file) so it can be restored later
- On resume the SDK determines the run's last step and auto-increments from `last_step + 1`; with explicit `step=` you control the x-axis yourself
- `from_step=N` (optional): **truncate-tail resume** — deletes all time-series data of the run with `step > N` (metrics / histograms / texts / figures / tables / media) and recomputes the run summary, then continues from `N + 1`. Use this when retraining from an earlier checkpoint (e.g. trained to step 84, restarting from the step-50 checkpoint): without truncation the stale steps 51–84 would overlap with the new run and corrupt charts, Compare, and Explore
- Resume negotiation: remote mode goes over HTTP (`POST /api/v1/runs/{id}/resume` + `GET /api/v1/runs/{id}/last_step`); local mode talks to the Rust storage directly via PyO3 — **no `trailer up` required** anymore
- All three local storage backends support resuming (and truncation): SQLite (`storage="sqlite"`, default), file mode (`storage="file", data_dir="data"`), PostgreSQL (`storage="postgres"`)

## Lifecycle

```python
t.finish()   # mark the run finished (state → finished)
```

- The SDK heartbeats every 30s in the background; after 60s without a heartbeat the server marks a run `crashed`
- `finish()` flushes the remaining buffer and joins the sampler thread, so the last step is never lost

## Hardware monitoring (automatic)

With no code changes at all, the SDK automatically collects CPU / memory / GPU data by default and aligns it with metrics on the same axis:

- **When sampling happens**: each new step triggers one sample (bound to that step), plus a 5s time-based fallback — this keeps the system charts on the same x-axis as the metric charts, and the Wall Time view has data too
- **Device probe**: written to `env.hardware` once at run creation (GPU model, total VRAM, etc.) so the UI can identify the device
- **Naming**: `system/cpu_util`, `system/mem_used`, `system/mem_util` (0–1), `system/cpu/temp_c`, `system/cpu/power_w`; each GPU is recorded under `system/<vendor>/gpu<i>/` (`gpu_util`, `vram_used`, `vram_util`, `temp_c`, `power_w`)

```python
t = Tracker(project="demo", auto_collect=False)   # disable automatic hardware monitoring
```

Failed probes degrade silently (e.g. CPU only when there's no GPU) and never block training.

## Performance

- Writes go through a thread-safe `RingBuffer` (100k entries, P99 < 100µs) — `log()` never blocks training
- A background FlushThread batches (500 items / 1s) and writes in bulk; local mode goes through PyO3 with zero network
