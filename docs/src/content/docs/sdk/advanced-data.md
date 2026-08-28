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

Visualize the 2D loss surface around your weights — heatmap, contour lines, and an interactive 3D surface. Log one grid per step and the Landscape tab replays how the landscape evolves during training.

**Auto mode (PyTorch, recommended)** — pass the model; the SDK builds filter-normalized directions (skipping bias/BN), evaluates the grid on a fixed batch subset, restores your parameters and records it. Requires `torch` in the training environment (missing → friendly skip, never blocks training):

```python
t.log_loss_landscape(model, train_loader, n=51, step=epoch)       # random directions
t.log_loss_landscape(model, loader, model_b=ckpt, step=epoch)     # two-checkpoint interpolation
t.log_loss_landscape(model, loader, n=51, chunk=128)              # vector mode: smaller chunks if VRAM-tight
t.log_loss_landscape(model, loader, parallel="high")              # vector presets: low/medium/high/max
```

**Evaluation modes** — `mode="auto"` (default) picks per model size, and the recorded `meta.mode` shows what actually ran:

- **`vector`** (weights < 512MB): `torch.func` batched forward (`vmap` + `functional_call`, chunked). Peak VRAM ≈ (5 + 2·chunk) × model bytes — orders of magnitude faster, ideal up to ~a few hundred million params.
- **`serial`** (weights ≥ 512MB, or forced with `mode="serial"`): perturbs weights **in place**, one grid point at a time, restoring each point exactly from a CPU backup — **zero full-model copies**. GPU peak ≈ model + activations. If the device can't also hold both direction tensors, they're built on CPU in the model's dtype and streamed layer-by-layer (adds a PCIe transfer per point — prefer `n=21` over `n=51`). Also the escape hatch for models `vmap` can't trace (flash-attention, custom CUDA ops, quantized kernels).

```python
t.log_loss_landscape(model, loader, mode="serial")   # force the low-memory path
t.log_loss_landscape(model, loader)                  # auto: ≥512MB of weights → serial
```

**Manual mode (any framework / offline)** — pass a pre-computed grid:

```python
# z[row][col] = loss(θ* + α·δ + β·η), α ∈ x_range, β ∈ y_range
grid = ...  # N×N float matrix, 51×51 recommended, edge ≤ 250
t.log_loss_landscape(grid, name="landscape", step=epoch,
                     x_range=(-1, 1), y_range=(-1, 1),
                     meta={"normalization": "filter", "direction": "random", "seed": 0})
```

> **⚠️ Read before plotting** — directions δ/η must be **filter-normalized** (per output channel: `d_f ← d_f/‖d_f‖·‖θ_f‖`) and must **skip bias / BatchNorm parameters**. Unnormalized random directions produce fake cliffs on BN networks due to scale invariance (Li et al., NeurIPS 2018). Auto mode handles this for you. For manual use, a ready-to-copy PyTorch recipe covering the BN running-stats pitfall lives in `trailer-sdk/examples/loss_landscape_demo.py` (`--self-check` verifies the math without a dataset), and the building blocks are importable: `from trailer.landscape import filter_normalized_directions, evaluate_grid`.

Practical defaults: 51×51 grid over fixed 8-batch subset (≈2–5 GPU-minutes for a 10M-param CNN), train loss, fixed direction seed per run for cross-step comparability.

### Large models (LLM)

Grid cost ≈ `n²` forwards × eval tokens — minutes-level on one GPU. Memory is the real cliff, and `mode="serial"` removes it (the model itself still has to fit). For a 7B model in fp16:

| n | forwards | A100 bf16, ~2k eval tokens |
|---|---|---|
| 51 | 2601 | ~8 min |
| 21 | 441 | ~1.5 min |

- Use `n=21`, `nbatches=1`–`2`, and a short fixed calibration set — the landscape needs *relative* shape, not exact loss values
- Keep the same eval subset across steps for comparability (auto mode already does)
- `parallel`/`chunk` only affect `vector` mode and are ignored by `serial`

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
