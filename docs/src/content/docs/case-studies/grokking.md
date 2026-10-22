---
title: Grokking case study
description: Tracking a real research experiment with trailer's full feature set — model graph, weight histograms, embedding PCA, loss landscapes, and resume
---

The previous tutorials used toy examples. This page zooms out to a real research phenomenon — **grokking** — and shows how to use trailer's full feature set to track a training run that reveals how the model's *interior* evolves.

Companion script: [`docs/examples/grokking-mini/grokking_mini.py`](https://github.com/limoncc/trailer/blob/main/docs/examples/grokking-mini/grokking_mini.py) (~280 lines, self-contained, runs in a few minutes on CPU/MPS).

## What is grokking

Train a single-layer Transformer to do **modular addition** `a + b (mod p)`: the input is 3 tokens `[a, b, "="]`, and the model predicts `(a + b) % p` at the `=` position.

The training set covers only a fraction of all `(a, b)` pairs. If the model merely **memorizes** the training samples, unseen combinations in the test set stay wrong forever; only by learning the true **rule** of mod can it generalize.

Grokking is the shape of that curve:

- **Memorization phase**: `train/acc` climbs to nearly 100% while `test/acc` stays near the floor (the model is reciting answers)
- **Insight**: after a long plateau, `test/acc` suddenly jumps to 100% (the model switches from memory to rule)

Recording this curve with trailer lets you *see* the transition in the dashboard — and go further, watching the model's **interior** (weight distribution, embedding geometry, loss surface) change with it.

## Step 1: Wire up trailer's full tracking

The script's core spreads trailer's capabilities across the whole training process:

```python
tracker = Tracker(
    project="grokking-mini",
    name=f"p{p}-wd{weight_decay}",
    config={                      # hyperparameter snapshot, diffable on Compare
        "task": "a + b mod p", "p": p, "train_frac": train_frac,
        "epochs": epochs, "batch_size": batch_size, "lr": lr,
        "weight_decay": weight_decay, "seed": seed, "device": str(device),
        "landscape_n": landscape_n,
    },
    metric_directions={"test/acc": "max", "train/acc": "max"},
)
tracker.log_model(model, name="GrokkingMini")   # model graph
```

- `config` records every hyperparameter — including `weight_decay`, one of the key levers that induces grokking (large weight decay pushes the solution toward flatter regions)
- `metric_directions` declares `test/acc` as "higher is better", so the run table's best column computes semantically
- `log_model` records the network so you can confirm its structure on the Model page first

## Step 2: Log curves and internal state

Inside the training loop, each epoch logs both **external behavior** and **internal state**:

```python
# External behavior: three curves (group/naming auto-groups them in the UI)
tracker.log({"train/loss": train_loss, "train/acc": train_acc, "test/acc": test_acc},
            step=epoch)

# Internal state: weight distributions evolving over training (Histograms page)
tracker.log_histogram(model.attn.w_q.weight.detach().cpu().numpy().tolist(),
                      name="attn/w_q", step=epoch)
tracker.log_histogram(model.unembed.weight.detach().cpu().numpy().tolist(),
                      name="unembed/weight", step=epoch)

# Internal state: 3D projection of token embeddings (PCA page);
# after grokking the digit tokens arrange into a mod-p ring
tracker.log_pca(model.tok_emb.weight.detach().cpu().numpy(),
                name="tok_emb", step=epoch)
```

> `log_histogram` / `log_pca` both need CPU numpy arrays: `.detach()` severs the autograd graph, `.cpu().numpy()` converts. Passing the whole weight matrix is fine (it is flattened internally).

## Step 3: Log the loss landscape as training evolves

A loss landscape visualizes the 2D loss surface around the weights. The script records a frame every few epochs and captures a weight snapshot during the memorization phase for interpolation:

```python
# Memorization snapshot: the moment train_acc≈100% but test hasn't moved (happens once)
if memorized is None and train_acc >= 0.999 and test_acc < 0.5:
    memorized = copy.deepcopy(model)

# Record the landscape every landscape_every epochs
tracker.log_loss_landscape(model, ls_train, n=landscape_n, step=epoch,
                           seed=0, name="landscape/train")
if memorized is not None:
    tracker.log_loss_landscape(model, ls_train, model_b=memorized,
                               n=landscape_n, step=epoch, seed=0,
                               name="landscape/interp",
                               meta={"between": f"memorization ↔ epoch {epoch}"})
```

- `ls_train` is a **fixed** evaluation subset (`shuffle=False`, taken once), which is what makes the frames comparable — the precondition for a meaningful replay
- `seed=0` fixes the random directions so δ/η match across frames of the same run
- `model_b=memorized` produces the **interpolation landscape**: the terrain between the current solution and the memorized one; after grokking, the barrier between them disappears
- The mini version uses a small grid (`n=15`) for speed; each frame takes ~0.2s in practice

## Step 4: Resume from a checkpoint (optional)

Need to restart mid-training from a checkpoint? Use `resume_from` + `from_step`:

```python
# First training run
tracker = Tracker(project="grokking-mini", resume_from=None)
# ... trained to step=500; now restart from the step=300 checkpoint
tracker2 = Tracker(project="grokking-mini",
                   resume_from=tracker.run_id,   # reuse the same run
                   from_step=300)                 # delete old data with step > 300 first
```

`from_step=N` deletes **all** time-series data with step > N (metrics / histograms / figures / tables / media), recomputes the summary, and continues from N+1. Without truncation, the old 501..800 would overlap the new data at the same steps, corrupting plots / Compare / Explore.

The script's `--resume-demo` flag demonstrates this automatically. See [Resuming a run](/sdk/logging/#resuming-a-run).

## Step 5: Read it in the dashboard

```bash
trailer up
```

Open the `grokking-mini` project and inspect each page:

| Page | What to look for |
|------|------------------|
| **Metrics** | `train/acc` pinned at 100% while `test/acc` plateaus low then jumps to 100% — that S-curve is grokking |
| **Histograms** | How attention weights (`attn/w_q`) and `unembed/weight` rearrange at the moment of insight |
| **PCA** | The 3D projection of `tok_emb`; after grokking the digit tokens form a mod-p **ring**, visible to the naked eye |
| **Landscape** | Drag the step slider to replay the surface: sharp and narrow during memorization → broad and flat after grokking (the classic weight-decay effect) |
| **Model** | The `GrokkingMini` computation graph — how information from a and b flows into the `=` position |

### Measured curve shape

With the defaults (`p=31, d_model=128, d_mlp=512, lr=3e-3, wd=1.0, batch=128`) on Apple MPS, a full run takes ~7 minutes. Measured behavior:

- Memorization: `test/acc` sits near ~30% for a long time (the model learns only the "answer depends on a" shortcut)
- Insight: starts climbing around epoch 300 and reaches 100% by ~670 (triggering early-stop)

> **Tuning tip**: too little capacity (`d_model=64`) or too small a learning rate (`lr=1e-3`) both stall in the memorization phase with no jump. If your curve doesn't jump, increase `d_model`/`d_mlp` and `lr`.

## What you have learned

- Using `config` + `metric_directions` so experiments are comparable and best is semantic
- Observing the model's **interior** with `log_histogram` / `log_pca`, not just the loss curve
- Replaying the loss surface with `log_loss_landscape` (fixed subset, fixed seed, interpolation snapshots)
- Safely restarting from a checkpoint with `resume_from` + `from_step`

This three-way tracking — external curves, internal state, and loss surface — is exactly where trailer pulls ahead of scalar-only tools. For more analysis, head to the [Explore workspace](/ui/explore/) for cross-project analysis, or [Sweeps](/ui/sweeps/) for hyperparameter grids.
