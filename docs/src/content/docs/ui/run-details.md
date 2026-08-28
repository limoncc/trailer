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

- **Heat** — pure colormap field, hover reads (α, β, loss)
- **Contour** — pure contour lines (no fill)
- **Both** — heatmap + d3-contour overlay
- **3D** — interactive Three.js surface mesh: drag to rotate, scroll to zoom, wireframe toggle, Front/Side/Top views
- **⚽ Roll + speed** — replays a gradient-descent ball (from the highest point, with trail) in **every** view; speed selectable 0.5×–4×; auto-plays on view switch and on each new step frame
- **Colormap picker** — coolwarm (default) / plasma / magma / viridis, applied to heatmap, contours and the 3D mesh
- **Z scale (log / lin)** — default **log**: an offset-log scale expands near-minimum detail so the bowl stays visible even when extreme walls dominate the min–max range; contour levels densify near the bottom accordingly; the 3D loss axis is labeled `(log)`. Hover tooltips always show the raw loss
- **Step slider + ▶ auto-play** — replay landscape evolution across training (slider moves between *logged* frames — log per epoch for step-by-step playback)
- Cards group by name and refresh live while the run is still training

## Sharing a run

The Share button generates an anonymous read-only link:

```
https://host/run/{id}?token=xxx
```

Anyone with the link can view the run without logging in.
