---
title: Run Details
description: The run detail page — config, metrics, histograms, PCA, figures, texts, media, tables, model
---

The run page (`/run/[id]`) shows up to 9 tabs. Tabs appear only when the run has data for them.

| Tab | Content |
|-----|---------|
| Config | Hyperparameters, env, git snapshot |
| Metrics | All scalar curves — line charts with log axis, smoothing, Step / Wall Time toggle |
| Histograms | Weight distributions over steps (three-pane evolution) |
| PCA | 3D scatter of embeddings (Three.js), with step slider and auto-play |
| Figures | Logged images / matplotlib / G2 figures |
| Texts | Logged text samples |
| Media | Audio / video players |
| Tables | Logged tabular data |
| Model | PyTorch model graph (mviz) |

## Metrics tab

- Each metric card supports **moving-average smoothing**, **log axis**, and **multi-series** overlay
- X-axis can toggle between **Step** and **Wall Time**
- Hover shows crosshair + tooltip

## Sharing a run

The Share button generates an anonymous read-only link:

```
https://host/run/{id}?token=xxx
```

Anyone with the link can view the run without logging in.
