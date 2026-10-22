---
title: Getting Started
description: Get started with Trailer in 5 minutes — install, log your first experiment, open the dashboard
---

Trailer is a local-first ML experiment tracker: add a few logging lines to your training script, and get curves, run comparisons, and training-evolution replays in a web dashboard.

## 1. Install

```bash
pip install trailer-sdk
```

The wheel bundles the Rust server binary and the web UI — nothing to deploy separately.

Build from source (development mode):

```bash
# Build the Rust server + bundle the frontend
python build.py
# Build the PyO3 extension (editable install)
uv run maturin develop
```

## 2. Log your first experiment

Add three lines to your training script:

```python
import random
from trailer import Tracker

tracker = Tracker(project="my_training")
for step in range(100):
    base = 0.9 * 0.96 ** step
    tracker.log({"train/loss": base + random.random() * 0.04,
                 "val/loss": base + 0.06 + random.random() * 0.06},
                step=step)
tracker.finish()
```

When it finishes, a `trailer.db` (local SQLite storage) appears in the current directory with all 100 steps persisted.

Three key points:

- `Tracker(project=...)` sets the project name and auto-generates a `run_id`; running the same script again creates another run, so experiments are naturally comparable
- `t.log({...}, step=step)` records a batch of scalar metrics; names like `train/loss` (`group/name`) are auto-grouped in the dashboard
- `t.finish()` marks the run as finished; even on a crash no data is lost — the run is marked `crashed` in the background

## 3. Open the dashboard

```bash
trailer up
```

Your browser opens `http://127.0.0.1:5120`. You will see:

- The `my_training` project card and activity overview on the home page
- The run table in the project view (config, best, and last metric summaries)
- The run's Metrics page — two decaying curves, `train/loss` and `val/loss`

Click around: toggle Step / Wall Time views, drag-zoom the curves, hover to read values.

## 4. Log more data types

Trailer is not just scalars. Common extras:

```python
tracker.log({"lr": 0.01 * 0.99 ** step}, step=step)      # more scalars (e.g. learning rate)
tracker.log_text("summary", "converged faster than last run")  # text: conclusions, log snippets
tracker.log_figure(fig, name="confusion-matrix")          # matplotlib figure / G2 spec
tracker.log_table({"epoch": [1, 2], "acc": [0.8, 0.9]})   # tables
tracker.log_image(img, name="sample")                     # PIL / numpy / path
tracker.log_histogram(weights, name="w1")                 # weight distributions
tracker.log_pca(vectors, name="embeddings")               # PCA 3D projection of embeddings
tracker.log_model(model, name="my-net")                   # PyTorch model graph
```

Hardware (CPU / memory / GPU) is sampled automatically by default — zero code, aligned with your metrics on the same axis in the dashboard.

See [Advanced data types](sdk/advanced-data/).

## 5. Name runs and record hyperparameters

```python
tracker = Tracker(
    project="my_training",
    name="lr0.01-batch32",                       # human-readable run name
    config={"lr": 0.01, "batch": 32, "opt": "adam"},  # hyperparameter snapshot, diffable in Compare
    metric_directions={"accuracy": "max"},       # declare direction so best is computed semantically
)
```

## Next steps

Read in order to go from beginner to advanced:

1. [Your first full experiment](tutorial/first-experiment/) — change a hyperparameter, rerun, and use Compare to pick the winner
2. [Metrics, config, and best semantics](tutorial/beyond-loss/) — train/val grouping, step semantics, metric directions
3. [Core concepts](core-concepts/) — the full data model (projects / runs / sweeps)
4. For a real research experiment tracked with trailer's full feature set, see the advanced case study [Grokking loss landscapes](case-studies/grokking/) (read after the three above)

For team servers and alternative storage backends, see [Local / remote / file modes](sdk/modes/).
