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

# 方向构造与网格评估已收进 SDK 工具模块(与 Tracker.log_loss_landscape 自动模式同源)
from trailer.landscape import (
    evaluate_grid,
    filter_normalized_directions,
    interpolation_directions as interpolation_pair,
)
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

def restore_params(model, originals):
    """把快照前的参数原位写回(演示在记录间隙共享同一模型)。"""
    import torch
    with torch.no_grad():
        for p, o in zip(model.parameters(), originals):
            p.copy_(o)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--grid", type=int, default=51, help="网格分辨率(默认 51)")
    ap.add_argument("--epochs", type=int, default=6, help="训练 epoch 数(默认 6)")
    ap.add_argument("--seed", type=int, default=0, help="方向随机 seed")
    ap.add_argument("--mode", choices=["auto", "vector", "serial"], default="auto",
                    help="评估模式: auto 按模型规模判定;serial=逐点 in-place 低显存路径(大模型/LLM)")
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
            grid = evaluate_grid(model, eval_batches, delta, eta, n=args.grid, mode=args.mode)
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
