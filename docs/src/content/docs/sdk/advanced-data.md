---
title: Advanced Data Types
description: Text, figures, tables, images, video, audio, histograms, embeddings, PCA, model graphs, loss landscapes
---

Beyond scalar metrics, `Tracker` logs a full range of data types.

## Text

```python
t.log_text("summary", "training completed with 91% accuracy")
```

## Figures

Matplotlib figures or G2 specs:

```python
import matplotlib.pyplot as plt

fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 4, 9])
t.log_figure(fig, name="loss-curve")
```

## Tables

DataFrames or lists of dicts:

```python
t.log_table({"epoch": [1, 2, 3], "accuracy": [0.8, 0.85, 0.9]})
t.log_table([{"a": 1, "b": "x"}, {"a": 2, "b": "y"}], name="samples")
```

## Images / Video / Audio

```python
t.log_image(img, name="sample")       # PIL image, numpy array, or file path
t.log_video("output.mp4", name="demo")
t.log_audio("audio.wav", name="tts")
```

## Histograms

Weight distributions over time:

```python
import torch
t.log_histogram(torch.randn(1000), name="w1", step=step)
```

The Histograms tab shows three-pane weight evolution over steps.

## Embeddings

PCA-reduced embeddings (requires `trailer[embedding]` for real PCA):

```python
t.log_embedding(vectors, name="embeddings", step=step)
```

## PCA (3D scatter)

PCA down to 3 dimensions with k-means clustering — rendered in Three.js:

```python
t.log_pca(vectors, name="embeddings", step=step)
```

## Loss landscapes

Visualize the 2D loss surface around your weights — heatmap, contour lines, and an interactive 3D surface. Grids are computed in your training loop and logged per step, so the Landscape tab can replay how the landscape evolves during training:

```python
# z[row][col] = loss(θ* + α·δ + β·η), α ∈ x_range, β ∈ y_range
grid = ...  # N×N float matrix, 51×51 recommended, edge ≤ 250
t.log_loss_landscape(grid, name="landscape", step=epoch,
                     x_range=(-1, 1), y_range=(-1, 1),
                     meta={"normalization": "filter", "direction": "random",
                           "seed": 0, "split": "train"})
```

> **⚠️ Read before plotting** — directions δ/η must be **filter-normalized** (per output channel: `d_f ← d_f/‖d_f‖·‖θ_f‖`) and must **skip bias / BatchNorm parameters**. Unnormalized random directions produce fake cliffs on BN networks due to scale invariance (Li et al., NeurIPS 2018). A ready-to-copy PyTorch recipe covering the BN running-stats pitfall lives in `trailer-sdk/examples/loss_landscape_demo.py` (run with `--self-check` to verify the math without a dataset).

Practical defaults: 51×51 grid over fixed 8-batch subset (≈2–5 GPU-minutes for a 10M-param CNN), train loss, fixed direction seed per run for cross-step comparability.

## Model graphs

PyTorch model structure via the mviz engine:

```python
import torch.nn as nn

model = nn.Sequential(nn.Linear(10, 10), nn.ReLU(), nn.Linear(10, 1))
t.log_model(model, name="my-net", step=step)
```

The Model tab renders the computational graph with layer shapes and data flow edges.

## Configuration capture

```python
t = Tracker(project="demo", config={"lr": 0.01, "batch_size": 32})
```

argparse / OmegaConf / Hydra parameters are captured automatically. See [Configuration](/sdk/configuration/).
