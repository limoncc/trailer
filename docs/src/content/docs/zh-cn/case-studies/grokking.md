---
title: Grokking 进阶案例
description: 用 trailer 全套能力跟踪一个真实研究实验 — 模型图、权重直方图、嵌入 PCA、损失景观与断点续训
---

前面的教程用玩具例子入门。这一页把镜头拉到一个真实的研究实验——**grokking**（顿悟）现象，演示如何用 trailer 的完整能力跟踪一次"看懂模型内部如何演化"的训练。

配套可运行脚本：[`docs/examples/grokking-mini/grokking_mini.py`](https://github.com/limoncc/trailer/blob/main/docs/examples/grokking-mini/grokking_mini.py)（约 280 行，自包含，CPU/MPS 几分钟跑完）。

## 什么是 grokking

训练一个单层 Transformer 做**模加法** `a + b (mod p)`：输入 3 个 token `[a, b, "="]`，模型在 `=` 位置预测 `(a + b) % p`。

训练集只覆盖全部 `(a,b)` 组合的一部分。若模型只是**死记**训练样本，测试集里没见过的组合永远答不对；只有真正学到 mod 运算的**规律**才能泛化。

grokking 就是这条曲线的形态：

- **记忆期**：`train/acc` 先爬到接近 100%，而 `test/acc` 长期停在低位（模型在背答案）
- **顿悟**：训练很久之后，`test/acc` 突然跳到 100%（模型从记忆切换到规律）

用 trailer 记录这条曲线，你能在看板里亲眼看到这次"突变"，并进一步观察**模型内部**（权重分布、词嵌入几何、损失曲面）如何随之改变。

## 第一步：接入 trailer 的完整跟踪

脚本的核心是把 trailer 的能力铺满整个训练过程：

```python
tracker = Tracker(
    project="grokking-mini",
    name=f"p{p}-wd{weight_decay}",
    config={                      # 超参快照, Compare 页可 diff
        "task": "a + b mod p", "p": p, "train_frac": train_frac,
        "epochs": epochs, "batch_size": batch_size, "lr": lr,
        "weight_decay": weight_decay, "seed": seed, "device": str(device),
        "landscape_n": landscape_n,
    },
    metric_directions={"test/acc": "max", "train/acc": "max"},
)
tracker.log_model(model, name="GrokkingMini")   # 模型结构图
```

- `config` 记下全部超参——其中 `weight_decay` 是诱发 grokking 的关键之一（大权重衰减把解推向平坦区域）
- `metric_directions` 声明 `test/acc` 越大越好，run 表格的 best 按此计算
- `log_model` 记录模型结构，先在 Model 页确认网络长什么样

## 第二步：记录曲线与内部状态

训练循环里，每个 epoch 同时记录**外部表现**与**内部状态**：

```python
# 外部表现: 三条曲线(train/val/test 命名分组, 看板自动分组)
tracker.log({"train/loss": train_loss, "train/acc": train_acc, "test/acc": test_acc},
            step=epoch)

# 内部状态: 权重分布随训练演化(Histograms 页)
tracker.log_histogram(model.attn.w_q.weight.detach().cpu().numpy().tolist(),
                      name="attn/w_q", step=epoch)
tracker.log_histogram(model.unembed.weight.detach().cpu().numpy().tolist(),
                      name="unembed/weight", step=epoch)

# 内部状态: 词嵌入 3D 投影(PCA 页), grokking 后数字 token 会排成 mod p 的环
tracker.log_pca(model.tok_emb.weight.detach().cpu().numpy(),
                name="tok_emb", step=epoch)
```

> `log_histogram` / `log_pca` 都需要 CPU 上的 numpy 数组：`.detach()` 断开计算图，`.cpu().numpy()` 转换。传整个权重矩阵即可（内部会展平成一维）。

## 第三步：记录损失景观随训练的演化

损失景观（loss landscape）展示权重附近的 2D 损失曲面。脚本每隔若干 epoch 记录一帧，并在"记忆期"抓一份权重快照用于插值对比：

```python
# 记忆期快照: train_acc≈100% 而 test 还没起来的那一刻(只出现一次)
if memorized is None and train_acc >= 0.999 and test_acc < 0.5:
    memorized = copy.deepcopy(model)

# 每隔 landscape_every 轮记录景观
tracker.log_loss_landscape(model, ls_train, n=landscape_n, step=epoch,
                           seed=0, name="landscape/train")
if memorized is not None:
    tracker.log_loss_landscape(model, ls_train, model_b=memorized,
                               n=landscape_n, step=epoch, seed=0,
                               name="landscape/interp",
                               meta={"between": f"记忆期 ↔ 当前 epoch {epoch}"})
```

- `ls_train` 是**固定**的评估子集（`shuffle=False` 只取一次），保证各帧可比——这是景观回放有意义的前提
- `seed=0` 固定随机方向，同 run 各帧的 δ/η 一致
- `model_b=memorized` 生成**插值景观**：展示"当前解 ↔ 记忆解"之间的地形，grokking 后两解之间的势垒会消失
- 迷你版用小网格（`n=15`）省时；实测每帧约 0.2s

## 第四步：断点续训（可选）

训练到一半要从 checkpoint 重来？用 `resume_from` + `from_step` 截断续训：

```python
# 第一次训练
tracker = Tracker(project="grokking-mini", resume_from=None)
# ... 训练到 step=500, 之后想从 step=300 的 checkpoint 重来
tracker2 = Tracker(project="grokking-mini",
                   resume_from=tracker.run_id,   # 复用同一个 run
                   from_step=300)                 # 删除 step>300 的旧数据再续训
```

`from_step=N` 会删除该 run 中 step > N 的**全部时序数据**（metrics / histograms / figures / tables / media）并重算 summary，再从 N+1 继续。不截断的话，旧的 501..800 会与新数据在同一步重叠，出图 / Compare / Explore 都会错乱。

脚本的 `--resume-demo` 标志会自动演示这一过程。详见 [断点续训](/zh-cn/sdk/logging/#断点续训resume)。

## 第五步：在看板里解读

```bash
trailer up
```

进入 `grokking-mini` 项目，逐页观察：

| 页 | 看什么 |
|----|--------|
| **Metrics** | `train/acc` 一直 100%，`test/acc` 低位横盘后突然跳到 100%——这条"S 形"就是 grokking |
| **Histograms** | 注意力权重 `attn/w_q` 与 `unembed/weight` 的分布如何随顿悟重新排列 |
| **PCA** | 词嵌入 `tok_emb` 的 3D 投影；grokking 后数字 token 会排成 mod p 的**环形结构**，肉眼可辨 |
| **Landscape** | 拖动 step 滑块回放景观演化：记忆期尖锐狭窄 → grokking 后平坦宽阔（weight_decay 的经典效应） |
| **Model** | `GrokkingMini` 的计算图，确认信息如何从 a、b 汇聚到 `=` 位置 |

### 实测曲线形态

默认参数（`p=31, d_model=128, d_mlp=512, lr=3e-3, wd=1.0, batch=128`）在 Apple MPS 上约 7 分钟跑完，实测：

- 记忆期：`test/acc` 长期停在 ~30%（模型只学会"答案依赖 a"的捷径）
- 顿悟：约 epoch 300 后开始爬升，~670 epoch 达到 100%（触发 early-stop）

> **调参提示**：容量太小（`d_model=64`）或学习率太小（`lr=1e-3`）都只会停在记忆态、看不到跳变。若你的曲线没跳变，先加大 `d_model`/`d_mlp` 和 `lr`。

## 你已经掌握了

- 用 `config` + `metric_directions` 让实验可对比、best 有语义
- 用 `log_histogram` / `log_pca` 观察模型**内部**演化，而不只是 loss 曲线
- 用 `log_loss_landscape`（含固定子集、固定 seed、插值快照）回放损失曲面
- 用 `resume_from` + `from_step` 安全地从 checkpoint 截断续训

这套"外部曲线 + 内部状态 + 损失曲面"的三维跟踪，正是 trailer 相对只记标量的工具的优势。想探索更多分析方式，去 [Explore 工作台](/zh-cn/ui/explore/) 做跨项目分析，或用 [Sweeps](/zh-cn/ui/sweeps/) 扫描超参。
