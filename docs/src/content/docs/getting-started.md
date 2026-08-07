---
title: Getting Started
description: Use Trailer in 5 minutes — install, log your first experiment, open the dashboard
---

## 1. Install

Install from PyPI (ships with the bundled Rust server binary):

```bash
pip install trailer-sdk
```

Build from source (development mode):

```bash
# Compile the Rust server + bundle the frontend
python build.py
# Compile the PyO3 extension (editable install)
uv run maturin develop
```

## 2. Log your first experiment

```python
from trailer import Tracker

t = Tracker(project="demo")
for step in range(10):
    t.log({"loss": 1.0 / (step + 1), "lr": 0.01}, step=step)
t.finish()
```

- `Tracker(project=...)` groups runs under a project and generates a `run_id` automatically
- `t.log({...}, step=step)` logs a set of scalar metrics
- `t.finish()` marks the run as finished

## 3. Open the dashboard

```bash
trailer up
```

Your browser opens `http://127.0.0.1:5120`, where you can see the `demo` project and the loss curve.

## 4. Log more data types

Trailer supports the full range of data types:

```python
t.log_text("summary", "experiment summary")           # text
t.log_figure(fig, name="my-plot")                     # matplotlib figure / G2 spec
t.log_table({"epoch": [1, 2], "acc": [0.8, 0.9]})     # table
t.log_image(img, name="sample")                       # PIL / numpy / path
t.log_histogram(weights, name="w1")                   # weight distribution
t.log_pca(vectors, name="embeddings")                 # PCA 3D scatter
t.log_model(model, name="my-net")                     # PyTorch model graph
```

See [Advanced data types](/sdk/advanced-data/).

## 5. Advanced options

```python
t = Tracker(
    project="advanced-demo",
    config={"lr": 0.01, "batch": 32}, # log hyperparameters
    metric_directions={"accuracy": "max"},  # declare metric direction for `best`
)
```

## Log remotely

```python
t = Tracker(
    project="demo",
    host="http://team-server:5120",
    token="rt_xxxx",                  # API token from your profile page
)
```

See [Local / remote / file modes](/sdk/modes/).
