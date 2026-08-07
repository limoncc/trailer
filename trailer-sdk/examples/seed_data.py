"""Trailer 示例数据生成器，覆盖全部功能。

用法:
  python seed_data.py               # 生成全部 5 个示例 + 图像补充
  python seed_data.py --only 2      # 只生成示例2(llm_finetune，texts 含公式+代码)

示例1  cnn_training     指标对比 + Config + 模型架构图
示例2  llm_finetune     指标 + 文本(公式+代码) + 直方图 + 嵌入 PCA
示例3  sweep_grid       超参搜索（sweep_id + config + 平行坐标）
示例4  tabular_classify 表格 + 丰富 Config + 系统监控
示例5  stress_walltime  压力测试 + Wall Time 时间流逝

本地模式：通过 PyO3 直写 SQLite，无需启动 server。
"""
import math
import os
import random
import time

# 本地模式：通过 PyO3 直写 SQLite
os.environ.pop("TRAILER_HOST", None)
random.seed(42)

import numpy as np
from PIL import Image
import torch
import torch.nn as nn

from trailer import Tracker


def train(t, steps, loss_fn, acc_fn=None, extra=None, sleep=0):
    """通用训练循环：记录 loss/accuracy/extra，可选 sleep 模拟真实时间。"""
    for step in range(steps):
        m = {"loss": loss_fn(step)}
        if acc_fn:
            m["accuracy"] = acc_fn(step)
        if extra:
            m.update(extra(step))
        t.log(m, step=step)
        if sleep:
            time.sleep(sleep)


class SimpleCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(3, 16, 3, padding=1)
        self.bn1 = nn.BatchNorm2d(16)
        self.conv2 = nn.Conv2d(16, 32, 3, padding=1)
        self.bn2 = nn.BatchNorm2d(32)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.dropout = nn.Dropout(0.5)
        self.fc = nn.Linear(32, 10)
    def forward(self, x):
        x = self.pool(torch.relu(self.bn2(self.conv2(torch.relu(self.bn1(self.conv1(x)))))))
        return self.fc(self.dropout(x.flatten(1)))


# ═══════════════════════════════════════════════════════════════
# 示例 1: CNN 训练 — 指标对比 + Config + 模型架构图
# ═══════════════════════════════════════════════════════════════
def example1():
    print("\n[示例1] cnn_training — 指标对比 + Config + 模型架构图")

    # 4 条对比曲线（不同 lr/batch），每 run 带 config
    for name, lr, batch, noise in [
        ("baseline", 0.01, 64, 0.05),
        ("high_lr", 0.1, 32, 0.08),
        ("small_batch", 0.01, 16, 0.06),
        ("noisy", 0.01, 64, 0.15),
    ]:
        t = Tracker(project="cnn_training", name=name,
                    config={"lr": lr, "batch_size": batch, "model": "SimpleCNN", "epochs": 50})
        train(t, 80,
              loss_fn=lambda s: 0.8 * math.exp(-s / 50) + noise * random.random(),
              acc_fn=lambda s: 1.0 - math.exp(-s / 80) + noise * 0.4 * random.random(),
              extra=lambda s: {"lr": lr})
        t.finish()
        print(f"  ✓ {name} (config {len(t.config)} keys)")

    # 模型架构图 run
    t = Tracker(project="cnn_training", name="architecture", config={"arch": "SimpleCNN"})
    t.log_model(SimpleCNN(), name="simple_cnn", step=0, trace=True, input_shape=(1, 3, 32, 32))
    train(t, 20, loss_fn=lambda s: 0.5 * math.exp(-s / 12) + 0.02 * random.random())
    t.finish()
    print("  ✓ architecture (模型架构图)")


# ═══════════════════════════════════════════════════════════════
# 示例 2: LLM 微调 — 指标 + 文本(公式+代码) + 直方图 + 嵌入 PCA
# ═══════════════════════════════════════════════════════════════
def example2():
    print("\n[示例2] llm_finetune — 文本 + 直方图 + 嵌入 PCA")

    t = Tracker(project="llm_finetune", name="gpt2_ft",
                config={"model": "gpt2", "lr": 5e-5, "epochs": 3, "max_seq_len": 128})
    train(t, 80,
          loss_fn=lambda s: 1.2 * math.exp(-s / 30) + 0.03 * random.random(),
          extra=lambda s: {"perplexity": math.exp(1.2 * math.exp(-s / 30)), "lr": 5e-5 * (0.95 ** s)})

    # 文本样本（LLM 对话/实验笔记，支持 Markdown + 数学公式 + 代码高亮）
    # step=5: 实验概览 — 列表 + 引用 + 块级公式
    t.log_text(
        "## 实验概览\n\n"
        "本次实验对 **GPT-2 (124M)** 进行领域微调，目标是最小化语言建模损失：\n\n"
        "$$\\mathcal{L} = -\\frac{1}{|\\mathcal{D}|}\\sum_{(x,y)\\in\\mathcal{D}} \\log p_\\theta(y\\,|\\,x)$$\n\n"
        "> 核心观察：小学习率 + 大 batch 在低资源场景下更稳定。\n\n"
        "主要步骤：\n"
        "1. 数据清洗与 tokenize\n"
        "2. 学习率 warmup + cosine 退火\n"
        "3. 周期性评估 perplexity",
        name="chat", step=5,
    )

    # step=15: 注意力机制 — 两块级公式 + 行内公式
    t.log_text(
        "## 注意力机制\n\n"
        "注意力允许模型动态关注序列中不同位置，核心是 **Q/K/V** 三矩阵：\n\n"
        "$$\\text{Attention}(Q,K,V) = \\text{softmax}\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V$$\n\n"
        "其中 $d_k$ 是缩放因子，防止点积过大导致 softmax 饱和。多头注意力将 $d_{model}$ 拆成 $h$ 个并行的 $d_k$ 维子空间：\n\n"
        "$$\\text{MultiHead}(Q,K,V) = \\text{Concat}(\\text{head}_1, \\dots, \\text{head}_h)W^O$$",
        name="chat", step=15,
    )

    # step=25: 超参数配置 — 表格 + 行内公式 + 退火公式
    t.log_text(
        "## 超参数配置\n\n"
        "| 参数 | 值 |\n"
        "|---|---|\n"
        "| learning_rate | $5 \\times 10^{-5}$ |\n"
        "| batch_size | 8 |\n"
        "| warmup_steps | 1000 |\n"
        "| weight_decay | $1 \\times 10^{-2}$ |\n"
        "| max_seq_len | 128 |\n\n"
        "warmup 阶段学习率线性上升，之后按 cosine 退火：\n\n"
        "$$\\eta_t = \\eta_{\\min} + \\frac{1}{2}(\\eta_{\\max} - \\eta_{\\min})\\left(1 + \\cos\\frac{\\pi t}{T}\\right)$$",
        name="chat", step=25,
    )

    # step=35: 数据加载 — Python 代码块
    t.log_text(
        "## 数据加载\n\n"
        "使用 HF `datasets` + `tokenizer` 预处理语料：\n\n"
        "```python\n"
        "from transformers import AutoTokenizer\n"
        "from datasets import load_dataset\n\n"
        "tokenizer = AutoTokenizer.from_pretrained(\"gpt2\")\n"
        "tokenizer.pad_token = tokenizer.eos_token\n\n"
        "def tokenize(examples):\n"
        "    return tokenizer(\n"
        "        examples[\"text\"], truncation=True, max_length=128\n"
        "    )\n\n"
        "dataset = load_dataset(\"wikitext\", \"wikitext-2-raw-v1\")[\"train\"]\n"
        "dataset = dataset.map(tokenize, batched=True, remove_columns=[\"text\"])\n"
        "```\n\n"
        "序列长度统一为 $L=128$，超出部分截断。",
        name="chat", step=35,
    )

    # step=45: 训练循环 — Python 代码块 + 交叉熵公式
    t.log_text(
        "## 训练循环\n\n"
        "```python\n"
        "optimizer = AdamW(model.parameters(), lr=5e-5, weight_decay=1e-2)\n"
        "scheduler = get_cosine_schedule_with_warmup(\n"
        "    optimizer, num_warmup_steps=1000, num_training_steps=total_steps\n"
        ")\n\n"
        "for step, batch in enumerate(train_loader):\n"
        "    outputs = model(**batch)\n"
        "    loss = outputs.loss  # 交叉熵损失\n"
        "    loss.backward()\n"
        "    optimizer.step()\n"
        "    scheduler.step()\n"
        "    optimizer.zero_grad()\n"
        "```\n\n"
        "每一歩的损失通过 softmax 交叉熵计算：\n\n"
        "$$\\mathcal{L}_{CE} = -\\log \\frac{e^{z_y}}{\\sum_j e^{z_j}}$$",
        name="chat", step=45,
    )

    # step=55: 损失与优化 — 两块级公式 + 行内公式
    t.log_text(
        "## 损失与优化\n\n"
        "语言建模使用交叉熵损失，逐 token 累加取平均：\n\n"
        "$$\\mathcal{L} = -\\frac{1}{N}\\sum_{t=1}^{N} \\log p_\\theta(y_t\\,|\\,y_{<t})$$\n\n"
        "优化器采用 AdamW，其更新规则为：\n\n"
        "$$m_t = \\beta_1 m_{t-1} + (1-\\beta_1) g_t \\qquad v_t = \\beta_2 v_{t-1} + (1-\\beta_2) g_t^2$$\n\n"
        "$$\\theta_{t+1} = \\theta_t - \\eta\\,\\frac{\\hat{m}_t}{\\sqrt{\\hat{v}_t} + \\epsilon}$$\n\n"
        "其中 $\\hat{m}_t = m_t/(1-\\beta_1^t)$ 为偏差修正项。",
        name="chat", step=55,
    )

    # step=65: 高效数据处理 — Rust 代码块 + 行内公式
    t.log_text(
        "## 高效数据处理\n\n"
        "对于流式数据预处理，用 Rust 实现并行 tokenize 可显著降低 IO 开销：\n\n"
        "```rust\n"
        "use rayon::prelude::*;\n\n"
        "fn tokenize_parallel(lines: Vec<String>) -> Vec<Vec<u32>> {\n"
        "    lines.par_iter()\n"
        "        .map(|line| tokenize(line, /* max_len */ 128))\n"
        "        .collect()\n"
        "}\n"
        "```\n\n"
        "归并排序的复杂度为 $O(n \\log n)$，适合海量样本排序去重。",
        name="chat", step=65,
    )

    # step=75: 总结与下一步 — 列表 + hr + 块级/行内公式
    t.log_text(
        "## 总结与下一步\n\n"
        "- 训练 3 epoch 后，validation perplexity 降至 **18.4**\n"
        "- 学习率按 cosine 退火至接近 0，收敛平稳\n\n"
        "---\n\n"
        "最终困惑度与损失的关系：\n\n"
        "$$\\text{PPL} = e^{\\mathcal{L}}$$\n\n"
        "**下一步计划**：\n"
        "1. 在 1B 参数模型上复现\n"
        "2. 尝试 LoRA 低秩微调，见 $W + \\Delta W = W + BA$",
        name="chat", step=75,
    )

    # 权重分布直方图演化
    for step in range(0, 80, 4):
        spread = max(0.1, 1.0 - step / 60)
        t.log_histogram(np.random.randn(1024) * spread, name="attention/q_proj", step=step)
        t.log_histogram(np.random.randn(1024) * spread * 0.5, name="attention/o_proj", step=step)
        t.log_histogram(np.random.randn(4096) * spread * 0.8, name="mlp/gate_proj", step=step)

    # 嵌入向量 PCA（3 聚类）
    centers = {
        "pos": [random.gauss(0, 0.1) for _ in range(50)],
        "neg": [random.gauss(1, 0.1) for _ in range(50)],
        "neu": [random.gauss(-0.5, 0.1) for _ in range(50)],
    }
    vectors, labels = [], []
    for cls, center in centers.items():
        for _ in range(25):
            vectors.append([c + random.gauss(0, 0.3) for c in center])
            labels.append(cls)
    t.log_embedding(vectors, metadata=labels, name="sentiment_embeddings", step=0)
    t.finish()
    print("  ✓ gpt2_ft (8 文本含公式+代码 + 3 直方图组 + 75 嵌入)")


# ═══════════════════════════════════════════════════════════════
# 示例 3: 超参搜索 — sweep_id + config + 平行坐标
# ═══════════════════════════════════════════════════════════════
def example3():
    print("\n[示例3] sweep_grid — 超参搜索")

    for lr in [0.001, 0.005, 0.01, 0.05]:
        for batch in [16, 32, 64]:
            t = Tracker(project="sweep_grid", name=f"lr{lr}_b{batch}",
                        sweep_id="lr-batch-grid", config={"lr": lr, "batch_size": batch})
            train(t, 40,
                  loss_fn=lambda s: 0.8 * math.exp(-s / (20 + lr * 1000)) + 0.02 * random.random(),
                  acc_fn=lambda s: 1.0 - math.exp(-s / (40 + batch / 2)) + 0.02 * random.random())
            t.finish()
    print("  ✓ 12 个 sweep runs")


# ═══════════════════════════════════════════════════════════════
# 示例 4: 表格分类 — 表格 + Config + 系统监控
# ═══════════════════════════════════════════════════════════════
def example4():
    print("\n[示例4] tabular_classify — 表格 + 系统监控")

    t = Tracker(project="tabular_classify", name="xgb",
                config={"objective": "binary:logistic", "max_depth": 6, "learning_rate": 0.01,
                        "n_estimators": 300, "subsample": 0.8, "colsample_bytree": 0.7,
                        "eval_metric": ["auc", "logloss"], "seed": 42},
                auto_collect=True)
    train(t, 40,
          loss_fn=lambda s: 0.6 * math.exp(-s / 35) + 0.02 * random.random(),
          acc_fn=lambda s: 0.5 + 0.45 * (1 - math.exp(-s / 40)) + 0.02 * random.random(),
          sleep=0.2)  # 10s 采集系统监控

    t.log_table([
        {"actual": "cat", "predicted": "cat", "count": 85},
        {"actual": "cat", "predicted": "dog", "count": 15},
        {"actual": "dog", "predicted": "cat", "count": 10},
        {"actual": "dog", "predicted": "dog", "count": 90},
    ], name="confusion_matrix", step=39)
    t.log_table([
        {"feature": "feature_a", "importance": 0.35},
        {"feature": "feature_b", "importance": 0.25},
        {"feature": "feature_c", "importance": 0.18},
        {"feature": "feature_d", "importance": 0.12},
        {"feature": "feature_e", "importance": 0.10},
    ], name="feature_importance", step=39)
    t.finish()
    print("  ✓ xgb (2 表格 + 8 config 键 + 系统监控)")


# ═══════════════════════════════════════════════════════════════
# 示例 5: 压力 + Wall Time — 大量数据 + 真实时间流逝
# ═══════════════════════════════════════════════════════════════
def example5():
    print("\n[示例5] stress_walltime — 压力测试 + Wall Time")

    # 压力：500 step 瞬时写入
    t = Tracker(project="stress_walltime", name="high_freq", config={"mode": "stress", "steps": 500})
    train(t, 500, loss_fn=lambda s: 0.9 * math.exp(-s / 100) + 0.01 * random.random())
    t.finish()
    print("  ✓ high_freq (500 step 瞬时)")

    # Wall Time：20 step × 2s 真实时间流逝（40s）
    t = Tracker(project="stress_walltime", name="wall_time", config={"mode": "real_time", "interval": "2s"})
    train(t, 20,
          loss_fn=lambda s: 0.6 * math.exp(-s / 12) + 0.03 * random.random(),
          acc_fn=lambda s: 1.0 - (0.6 * math.exp(-s / 12) + 0.03 * random.random()),
          sleep=2.0)
    t.finish()
    print("  ✓ wall_time (20 step × 2s = 40s)")


# ═══════════════════════════════════════════════════════════════
# 图像样本补充 — 示例1 追加（vision 功能）
# ═══════════════════════════════════════════════════════════════
def example1_images():
    print("\n[补充] cnn_training 图像样本")
    t = Tracker(project="cnn_training", name="images", config={"kind": "segmentation"})
    for step in [0, 10, 20, 30]:
        arr = (np.random.rand(64, 64, 3) * 255).astype(np.uint8)
        t.log_image(Image.fromarray(arr, "RGB"), name="input", step=step)
        mask = (np.random.rand(64, 64) * 255).astype(np.uint8)
        t.log_image(Image.fromarray(mask, "L"), name="mask", step=step)
    t.finish()
    print("  ✓ images (8 张)")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Trailer 示例数据生成器（本地模式：PyO3 直写 SQLite）")
    parser.add_argument("--only", type=int, choices=[1, 2, 3, 4, 5, 6],
                        help="只运行指定编号的示例（1-5 对应示例1-5；6 = 示例1 的图像补充）")
    args = parser.parse_args()

    print("=" * 52)
    print("Trailer 示例数据生成")
    print("=" * 52)

    if args.only is None:
        example1()
        example2()
        example3()
        example4()
        example5()
        example1_images()
    elif args.only == 1:
        example1()
        example1_images()
    elif args.only == 2:
        example2()
    elif args.only == 3:
        example3()
    elif args.only == 4:
        example4()
    elif args.only == 5:
        example5()

    print("\n" + "=" * 52)
    print("✅ 示例数据生成完毕！http://127.0.0.1:5120")
    print("=" * 52)


if __name__ == "__main__":
    main()
