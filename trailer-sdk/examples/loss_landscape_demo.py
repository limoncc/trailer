"""损失景观(Loss Landscape)演示 —— 随机方向 + filter 归一化 + 2D 网格评估。

理论依据: Li et al., "Visualizing the Loss Landscape of Neural Nets", NeurIPS 2018。
标准做法: 画 loss(θ* + α·δ + β·η)，α,β ∈ [-1,1]²。

⚠️ 两个最常见的"垃圾图"成因（务必遵守）:
  1. 方向必须做 **filter 归一化**（δ_f ← δ_f/‖δ_f‖·‖θ_f‖，按输出通道/滤波器逐个归一），
     否则 BN 网络因尺度不变性会呈现假悬崖;
  2. 扰动必须 **跳过 bias / BN 参数**（官方 --xignore biasbn）。

本示例不依赖 torchvision: 用合成 2D 高斯二簇数据训练一个玩具 CNN（CPU 数秒）。
训练过程中按 epoch 记录景观快照，前端 Landscape 面板用滑条回放"景观随训练演化"。

用法:
    python loss_landscape_demo.py               # 完整训练 + 记录
    python loss_landscape_demo.py --self-check  # 无训练数据,仅验证方向数学
"""

import argparse
import sys
import time

import numpy as np


# ---------------------------------------------------------------- 方向构造

def filter_normalized_directions(model, seed: int = 0):
    """生成一对 filter 归一化的随机方向 (delta, eta)。

    - 形状与参数一致; ndim>=2 的参数按第 0 维(输出通道)逐滤波器归一:
      d_f ← d_f / ‖d_f‖ · ‖θ_f‖
    - ndim<2 的参数(bias / BN 的 weight/bias/running_*): 方向置 0(不扰动)
    """
    import torch

    g = torch.Generator().manual_seed(seed)
    delta, eta = [], []
    with torch.no_grad():
        for p in model.parameters():
            if p.ndim < 2:
                delta.append(torch.zeros_like(p))
                eta.append(torch.zeros_like(p))
                continue
            d = torch.randn(p.shape, generator=g)
            e = torch.randn(p.shape, generator=g)
            # 逐滤波器(第 0 维切片)归一化并缩放到权重范数
            for dst, src in ((delta, d), (eta, e)):
                norm = src.flatten(1).norm(dim=1)
                norm = torch.where(norm > 0, norm, torch.ones_like(norm))
                target = p.flatten(1).norm(dim=1)
                scaled = src.flatten(1) / norm.unsqueeze(1) * target.unsqueeze(1)
                dst.append(scaled.reshape(p.shape))
    return delta, eta


def interpolation_pair(model_a, model_b, seed: int = 1):
    """两 checkpoint 插值方向: delta = θ_b − θ_a（Goodfellow 2014 线性插值主方向），
    eta 取一个 filter 归一化随机方向作为第二维（构成"插值 × 随机"网格）。"""
    import torch

    delta, eta = [], []
    _, rand_e = filter_normalized_directions(model_b, seed=seed)
    with torch.no_grad():
        for pa, pb, r in zip(model_a.parameters(), model_b.parameters(), rand_e):
            delta.append(pb - pa)
            eta.append(r)
    return delta, eta


def set_params(model, originals, alpha: float, delta, beta: float, eta):
    """θ = θ* + α·δ + β·η（原地写入, 用完务必 restore_params）。"""
    import torch

    with torch.no_grad():
        for p, o, d, e in zip(model.parameters(), originals, delta, eta):
            p.copy_(o + alpha * d + beta * e)


def restore_params(model, originals):
    import torch

    with torch.no_grad():
        for p, o in zip(model.parameters(), originals):
            p.copy_(o)


# ---------------------------------------------------------------- 网格评估

def evaluate_grid(model, batches, delta, eta, n: int = 51, criterion=None):
    """在固定 batch 子集上评估 N×N 网格平均损失。

    - 固定 batch 子集 + 固定方向 seed → 同 run 的多帧之间可比;
    - model.eval(): 冻结 BN running statistics(接受远处点统计失配的简化处理;
      更严格做法是在每个网格点用校准 batch 重算 BN 统计, 成本更高);
    - 混合精度模型建议在 fp32 权重上构造方向(数值稳定性)。
    """
    import torch

    if criterion is None:
        criterion = torch.nn.CrossEntropyLoss()
    originals = [p.detach().clone() for p in model.parameters()]
    grid = np.empty((n, n), dtype=np.float64)
    was_training = model.training
    model.eval()  # 冻结 BN running stats
    with torch.no_grad():
        for i in range(n):
            beta = -1.0 + 2.0 * i / (n - 1)
            for j in range(n):
                alpha = -1.0 + 2.0 * j / (n - 1)
                set_params(model, originals, alpha, delta, beta, eta)
                total, count = 0.0, 0
                for x, y in batches:
                    total += float(criterion(model(x), y)) * len(x)
                    count += len(x)
                grid[i, j] = total / max(count, 1)
            print(f"\r  row {i + 1}/{n}", end="", flush=True)
    print("\r", end="", flush=True)
    restore_params(model, originals)
    if was_training:
        model.train()
    return grid


# ---------------------------------------------------------------- 自检

def self_check() -> int:
    """无训练数据: 在一个玩具 Linear 上验证方向数学与网格评估管线。"""
    try:
        import torch
    except ImportError:
        print("self-check 需要 torch: pip install torch")
        return 1

    torch.manual_seed(0)
    model = torch.nn.Sequential(torch.nn.Flatten(), torch.nn.Linear(16, 8), torch.nn.ReLU(), torch.nn.Linear(8, 2))
    x = torch.randn(32, 16)
    y = torch.randint(0, 2, (32,))
    delta, eta = filter_normalized_directions(model, seed=0)

    # 1) ndim<2 的参数方向必须为 0(bias / LN/BN 等)
    for p, d, e in zip(model.parameters(), delta, eta):
        if p.ndim < 2:
            assert float(d.abs().max()) == 0.0 and float(e.abs().max()) == 0.0, "bias 方向应置 0"

    # 2) filter 归一化: 每个输出通道的 ‖d_f‖ == ‖θ_f‖
    for p, d in zip(model.parameters(), delta):
        if p.ndim >= 2:
            assert torch.allclose(d.flatten(1).norm(dim=1), p.flatten(1).norm(dim=1), atol=1e-5), \
                "filter 归一化失败: ‖d_f‖ != ‖θ_f‖"

    # 3) α=β=0 时网格点 == 原模型损失; 网格有限
    grid = evaluate_grid(model, [(x, y)], delta, eta, n=5)
    assert np.isfinite(grid).all(), "网格出现 NaN/Inf"
    criterion = torch.nn.CrossEntropyLoss()
    with torch.no_grad():
        base = float(criterion(model(x), y))
    assert abs(grid[2, 2] - base) < 1e-4, f"中心点损失 {grid[2, 2]} 应等于原损失 {base}"

    print("self-check OK: filter 归一化 / bias 跳过 / 网格评估 全部通过")
    return 0


# ---------------------------------------------------------------- 主流程

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--grid", type=int, default=51, help="网格分辨率(默认 51)")
    ap.add_argument("--epochs", type=int, default=6, help="训练 epoch 数(默认 6)")
    ap.add_argument("--seed", type=int, default=0, help="方向随机 seed")
    ap.add_argument("--self-check", action="store_true", help="只做方向数学自检")
    ap.add_argument("--db", default="trailer.db", help="本地 SQLite 路径(默认 trailer.db)")
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    try:
        import torch
    except ImportError:
        print("需要 PyTorch: pip install torch")
        return 1

    from trailer import Tracker

    t = Tracker(project="loss-landscape-demo", db_path=args.db, config={
        "grid": args.grid, "epochs": args.epochs, "direction_seed": args.seed,
        "normalization": "filter", "direction": "random", "split": "train",
        "note": "synthetic 2-cluster blobs, toy CNN",
    })

    # --- 合成数据: 两个高斯簇(1×8×8 图像), 避免 torchvision 依赖 ---
    torch.manual_seed(42)
    n_per, half = 512, 4
    def make_blob(center: float, label: int):
        x = torch.randn(n_per, 1, 8, 8) + center
        y = torch.full((n_per,), label)
        return x, y
    xs = torch.cat([make_blob(-0.8, 0)[0], make_blob(0.8, 1)[0]])
    ys = torch.cat([make_blob(-0.8, 0)[1], make_blob(0.8, 1)[1]])
    perm = torch.randperm(len(xs))
    xs, ys = xs[perm], ys[perm]
    loader = torch.utils.data.DataLoader(
        torch.utils.data.TensorDataset(xs, ys), batch_size=64, shuffle=True)
    # 固定评估子集(前 8 个 batch), 保证各帧可比
    eval_batches = [(x, y) for x, y in loader][:8]

    model = torch.nn.Sequential(
        torch.nn.Conv2d(1, 8, 3, padding=1), torch.nn.ReLU(),
        torch.nn.Conv2d(8, 4, 3, padding=1), torch.nn.ReLU(),
        torch.nn.Flatten(), torch.nn.Linear(4 * 64, 2),
    )
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    criterion = torch.nn.CrossEntropyLoss()

    delta, eta = filter_normalized_directions(model, seed=args.seed)
    originals = [p.detach().clone() for p in model.parameters()]
    snapshot_epochs = {0, args.epochs // 2, args.epochs}

    for epoch in range(1, args.epochs + 1):
        model.train()
        for x, y in loader:
            opt.zero_grad()
            loss = criterion(model(x), y)
            loss.backward()
            opt.step()

        acc = float((model(eval_batches[0][0]).argmax(1) == eval_batches[0][1]).float().mean())
        print(f"epoch {epoch}: batch0 acc={acc:.3f}")

        if epoch in snapshot_epochs:
            print(f"evaluating landscape @ epoch {epoch} ({args.grid}x{args.grid})...")
            t0 = time.time()
            grid = evaluate_grid(model, eval_batches, delta, eta, n=args.grid)
            print(f"  done in {time.time() - t0:.1f}s, loss range [{grid.min():.4f}, {grid.max():.4f}]")
            t.log_loss_landscape(grid, name="landscape", step=epoch, meta={
                "normalization": "filter",
                "direction": "random",
                "seed": args.seed,
                "split": "train",
                "subset_batches": len(eval_batches),
                "runtime_s": round(time.time() - t0, 1),
            })

    restore_params(model, originals)
    t.log({"final/batch0_acc": acc}, step=args.epochs)
    t.finish()
    print("完成: trailer up → 打开 run → Landscape tab 回放景观演化")
    return 0


if __name__ == "__main__":
    sys.exit(main())
