---
title: Sweeps
description: Hyperparameter sweeps grouped by sweep_id — parallel coordinates to relate parameters and metrics
---

The Sweeps page (`/sweeps`) groups runs from the same hyperparameter sweep together and uses a parallel coordinates chart to find out which parameter combinations lead to good results.

## Creating a sweep

Pass the same `sweep_id` to multiple runs and they land in the same group:

```python
for lr in [0.01, 0.05, 0.1]:
    for bs in [16, 32]:
        t = Tracker(project="exp", sweep_id="lr-bs-grid",
                    config={"lr": lr, "batch": bs},
                    metric_directions={"accuracy": "max"})
        train(t, lr, bs)
        t.finish()
```

`sweep_id` is just a label on the run — it doesn't affect how data is stored. Forgetting it is not an error; the run simply doesn't join a group.

## Sweep list page

`/sweeps` lists all sweeps; each card shows:

- The `sweep_id`, the number of runs, and the number of parameter dimensions
- The config key labels of the group's runs (up to 6 shown)

## Sweep detail page

Click into a sweep (`/sweeps/<sweep_id>`) — the centerpiece is the **parallel coordinates chart**:

- **Each vertical axis** = one parameter (with the `cfg_` prefix) or one metric (with the `metric_` prefix)
- **Each polyline** = one run, threading through every parameter and metric axis it involves
- **How to read it**: how high or low a polyline sits on a metric axis corresponds to how good or bad that run's result is. Trace it back along the parameter axes to see which parameter ranges tend to produce good results — densely crossed regions are common configurations, while sparse extreme positions are aggressive experiments

> ⚠️ Requirement: **≥2 runs and ≥2 dimensions** (parameters + metrics), otherwise the chart is empty. Make sure different runs' configs actually differ, or the parallel coordinates chart has nothing to tell apart.

The right sidebar offers:

- **Top Runs**: lists the sweep's runs in order; click one to jump straight to its detail page
- **Compare all**: sends the whole group of runs to the [Compare](/ui/compare/) page in one click for a closer comparison

## Typical workflow

1. Fix `sweep_id` in your script and loop over the parameters
2. Find the group on the Sweeps page → use the parallel coordinates chart for a first read of parameter trends
3. Use Top Runs / Compare all to dig deeper into the best few runs
4. Return to the script and sweep further around the best region

## Related

- `sweep_id` is a `Tracker` constructor argument — see [Logging Metrics & Data](/sdk/logging/)
- For free-form cross-project analysis use [Explore](/ui/explore/); Sweeps focuses on the parameters → metrics relationship within a single sweep
