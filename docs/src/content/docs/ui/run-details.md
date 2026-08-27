---
title: Run Details
description: The run detail page — config, metrics, histograms, PCA, landscape, figures, texts, media, tables, model
---

The run page (`/run/[id]`) shows up to 10 tabs. Tabs appear only when the run has data for them.

| Tab | Content |
|-----|---------|
| Config | Hyperparameters, env, git snapshot |
| Metrics | All scalar curves — line charts with log axis, smoothing, Step / Wall Time toggle |
| Histograms | Weight distributions over steps (three-pane evolution) |
| PCA | 3D scatter of embeddings (Three.js), with step slider and auto-play |
| Landscape | 2D loss-landscape grids — heatmap, contour overlay, 3D surface; step slider + auto-play |
| Figures | Logged images / matplotlib / G2 figures |
| Texts | Logged text samples |
| Media | Audio / video players |
| Tables | Logged tabular data |
| Model | PyTorch model graph (mviz) |

## Metrics tab

- Each metric card supports **moving-average smoothing**, **log axis**, and **multi-series** overlay
- X-axis can toggle between **Step** and **Wall Time**
- Hover shows crosshair + tooltip

## Landscape tab

Each logged landscape (`t.log_loss_landscape(...)`, see [Advanced Data Types](/sdk/advanced-data/)) becomes a card:

- **Heat** — continuous colormap field, hover reads (α, β, loss)
- **Contour** — heatmap with d3-contour overlay
- **Surface** — interactive Three.js mesh: drag to rotate, scroll to zoom, wireframe toggle, Front/Side/Top views
- **⚽ Roll** — replays a gradient-descent ball (from the highest point, with trail) in **every** view; auto-plays on view switch and on each new step frame
- **Colormap picker** — magma (default) / plasma / viridis, applied to heatmap, contours and the 3D mesh
- **Step slider + ▶ auto-play** — replay landscape evolution across training
- Cards group by name and refresh live while the run is still training

## Sharing a run

The Share button generates an anonymous read-only link:

```
https://host/run/{id}?token=xxx
```

Anyone with the link can view the run without logging in.
