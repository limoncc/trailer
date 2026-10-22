[中文](README.zh-CN.md) | **English**

# Trailer

> Next-gen **ML experiment tracking** — a lightning-fast, open-source experiment tracker with a **high-performance Rust core** and a local-first philosophy.

The ultimate trailer for your deep learning experiments — combining TensorBoard's depth, Aim's fluidity, and W&B's ecosystem, powered by a Rust core.

## Features

- ⚡ **High-performance Rust core** — LTTB downsampling, batched ingestion, 100k-entry ring buffer (P99 < 100µs)
- 📊 **Every data type you need** — scalars, text, figures, tables, media, histograms, embeddings, PCA, and model graphs
- 🏔️ **Loss landscape visualization** — filter-normalized 2D loss surfaces as heatmap / contour / interactive 3D, with training-evolution playback, log/linear color scale and a gradient-descent ball animation
- 🚀 **One-command local mode** — `trailer up` starts the full dashboard — zero config, no HTTP overhead, data lands locally
- 🔬 **Cross-project Explore** — line, scatter, and parallel-coordinates charts across runs — saved and shareable
- 🗄️ **Flexible storage** — SQLite (default), PostgreSQL, or TensorBoard-style file mode
- 👥 **Multi-user & permissions** — admin / experimenter roles, anonymous sharing links
- 🔍 **Powerful Compare** — progressive-loading comparison across runs

## Screenshots

**Run detail** — Config / Metrics / Histograms / PCA / Landscape / Model

<img src="docs/public/run-config.png" width="32%"/> <img src="docs/public/run-metrics.png" width="32%"/> <img src="docs/public/run-histograms.png" width="32%"/>

<img src="docs/public/run-pca.png" width="32%"/> <img src="docs/public/run-landscape.png" width="32%"/> <img src="docs/public/run-model.png" width="32%"/>

**Compare & explore** — Compare / Sweeps / Explore / Reports

<img src="docs/public/compare.png" width="32%"/> <img src="docs/public/sweeps-detail.png" width="32%"/> <img src="docs/public/explore.png" width="32%"/>

<img src="docs/public/reports.png" width="32%"/> <img src="docs/public/project-table.png" width="32%"/> <img src="docs/public/dashboard.png" width="32%"/>

**Home & welcome** — project list / onboarding

<img src="docs/public/home-welcome.png" width="32%"/> <img src="docs/public/sweeps-list.png" width="32%"/>

## Quick start

```bash
pip install trailer-sdk
```

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

Launch the dashboard:

```bash
trailer up          # http://127.0.0.1:5120
```

## Documentation

Full docs (English / 中文): **https://limoncc.github.io/trailer/**

## License

[Elastic License 2.0](LICENSE) — free for internal use; commercial hosting / SaaS requires a separate license. See [LICENSING.md](LICENSING.md).
