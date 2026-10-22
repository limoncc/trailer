---
title: Configuration & Hyperparameters
description: Log hyperparameters with config capture and metric directions
---

## Logging config

```python
t = Tracker(project="demo", config={"lr": 0.01, "batch": 32})
```

The config is stored with the run and shown in the run's **Config** tab. It is also the data source for the config diff on the [Compare](../ui/compare/) page.

- An arbitrarily nested JSON dict, immutable after creation
- Rule of thumb: **anything that affects results is a hyperparameter** — seeds, data versions, framework versions, and git commits are all worth recording

## Metric directions

Declare whether higher or lower is better — `best` is computed semantically:

```python
t = Tracker(
    project="demo",
    metric_directions={
        "accuracy": "max",
        "loss": "min",
        "f1": "max",      # matches val/f1 or test/f1 — see note below
    },
)
```

The summary (`best`, `best_step`) respects these directions.

> ⚠️ Keys match the metric name **after** the context is split off: `train/loss` has key `loss`, `val/accuracy` has key `accuracy`. So write `"accuracy"`, not `"val/accuracy"` — a full name with `/` has no effect. For the full direction-resolution priority (explicit > naming convention > default), see [Metrics, config, and best semantics](../tutorial/beyond-loss/).
