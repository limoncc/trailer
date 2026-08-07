---
title: Configuration & Hyperparameters
description: Log hyperparameters with config capture and metric directions
---

## Logging config

```python
t = Tracker(project="demo", config={"lr": 0.01, "batch": 32})
```

The config is stored with the run and shown in the run's **Config** tab.

## Automatic capture

Config capture aggregates several sources automatically:

- **Explicit dicts** passed to `Tracker(config=...)`
- **`argparse`** command-line arguments
- **OmegaConf / Hydra** configurations

```python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--lr", type=float, default=0.01)
args = parser.parse_args()

t = Tracker(project="demo")   # --lr is captured automatically
```

## Code snapshots

Trailer records a git snapshot (commit, branch, diff) so each run is reproducible.

## Metric directions

Declare whether higher or lower is better — `best` is computed semantically:

```python
t = Tracker(
    project="demo",
    metric_directions={
        "accuracy": "max",
        "loss": "min",
        "val/f1": "max",
    },
)
```

The summary (`best`, `best_step`) respects these directions.
