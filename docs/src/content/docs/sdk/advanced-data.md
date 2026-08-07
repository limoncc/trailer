---
title: Advanced Data Types
description: Text, figures, tables, images, video, audio, histograms, embeddings, PCA, model graphs
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
