---
title: Your first full experiment
description: Run three hyperparameters, then use the run table and Compare to pick the winner — build the tracking loop
---

The previous page got one curve into the dashboard. This page walks the full loop — train → log → look → change → rerun → compare. This rhythm is the core of experimenting with trailer.

## The scenario

A 20-line pure-Python logistic regression on 2D points, where the learning rate `lr` strongly affects convergence. We run three hyperparameter settings and pick the best one in the dashboard.

## Step 1: Write the training script (with config)

```python
import argparse
import math
import random

from trailer import Tracker

parser = argparse.ArgumentParser()
parser.add_argument("--lr", type=float, default=0.05)
parser.add_argument("--steps", type=int, default=80)
args = parser.parse_args()

# Two classes of 2D points: x + 0.8y > 0 is positive
random.seed(42)
pts = [(random.uniform(-2, 2), random.uniform(-2, 2)) for _ in range(400)]
labels = [1.0 if x + 0.8 * y > 0 else 0.0 for x, y in pts]

w1 = w2 = bias = 0.0          # zero initialization

tracker = Tracker(
    project="playground",
    name=f"lr-{args.lr}",                          # run name carries the hyperparameter
    config={"lr": args.lr, "steps": args.steps},   # snapshot, diffable on the Compare page
    metric_directions={"accuracy": "max"},         # best = "higher is better"
)

for step in range(args.steps):
    loss = 0.0
    correct = 0
    for (x, y), label in zip(pts, labels):
        p = 1.0 / (1.0 + math.exp(-(w1 * x + w2 * y + bias)))   # sigmoid
        loss += -(label * math.log(p + 1e-9) + (1 - label) * math.log(1 - p + 1e-9))
        correct += (p >= 0.5) == (label == 1.0)
        # gradient descent
        err = p - label
        w1 -= args.lr * err * x / len(pts)
        w2 -= args.lr * err * y / len(pts)
        bias -= args.lr * err / len(pts)
    tracker.log({"train/loss": loss / len(pts),
                 "train/accuracy": correct / len(pts)}, step=step)

tracker.finish()
```

The interesting part is the three `Tracker` parameters:

- `name=f"lr-{args.lr}"` — the run name carries the key hyperparameter
- `config={"lr": ..., "steps": ...}` — a full hyperparameter snapshot
- `metric_directions={"accuracy": "max"}` — best semantics (see [the next page](../tutorial/beyond-loss/))

## Step 2: Run it three times

```bash
python train.py --lr 0.01
python train.py --lr 0.05
python train.py --lr 0.5
```

The `playground` project now has three runs (`lr-0.01` / `lr-0.05` / `lr-0.5`), each with its own config.

## Step 3: First pass in the dashboard

```bash
trailer up
```

Open the `playground` project — three rows in the run table:

- Each row shows best / last metric summaries — large-lr runs tend to oscillate, small-lr runs converge slowly; the difference is visible at a glance
- Click any run to see the curve shapes

## Step 4: Fine-grained comparison in Compare

Select the three runs in the table and click **Compare** (or visit `/compare?runs=...`):

- **Metrics**: all three `train/loss` curves overlaid on one axis — convergence speed and final level directly comparable
- **Config**: side-by-side hyperparameter diff — only `lr` differs, which makes the conclusion trustworthy
- **Summary**: best / last / min / max of every metric, side by side

## Step 5: Build the recording habit

Solidify this rhythm into a template:

```python
tracker = Tracker(
    project="my-experiments",         # one project per research direction
    name=f"{model}-lr{lr}-bs{bs}",   # name carries the key hyperparameters
    config={"lr": lr, "batch": bs, "model": model, "seed": seed},  # anything that affects results
    metric_directions={"accuracy": "max", "loss": "min"},
)
```

Habits worth building now:

- **Record config generously** — seeds, data versions, framework versions are all hyperparameters; the Compare diff is only useful when the info is complete
- **Semantic run names** — read the experiment intent straight from the table
- **One variable at a time** — change one hyperparameter per run, or you cannot attribute the cause
- **Always `finish()`** — accurate states make a trustworthy dashboard

## What you have learned

- The full `Tracker(project/name/config/metric_directions)` usage
- The two-level workflow: run table for triage, Compare for fine comparison
- The basics of experiment-recording discipline

Next: [Metrics, config, and best semantics](../tutorial/beyond-loss/) explains the mechanisms behind these APIs.
