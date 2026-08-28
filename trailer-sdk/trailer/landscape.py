"""损失景观自动计算工具(纯 PyTorch,惰性导入——不给 SDK 增加硬依赖)。

多数用户只需一行:
    t.log_loss_landscape(model, dataloader, n=51, step=epoch)
本模块是其内部实现,也供高级用法单独调用:
    from trailer.landscape import filter_normalized_directions, evaluate_grid
    delta, eta = filter_normalized_directions(model, seed=0)
    grid = evaluate_grid(model, batches, delta, eta, n=51)   # z[row][col] = loss(θ*+α·δ+β·η)

⚠️ 方向必须 filter 归一化并跳过 bias/BN 参数(本模块已内置)——
   BN 尺度不变性会让未归一化的随机方向呈现假悬崖(Li et al. 2018)。
"""

from __future__ import annotations

from itertools import islice


def resolve_batches(batches, nbatches: int = 8):
    """DataLoader / 任意 (x, y) 可迭代 → 固定的前 nbatches 个 batch 列表。

    固定子集是帧间可比性的前提:同一 run 的多帧景观必须用同一批数据评估。
    """
    out = list(islice(iter(batches), nbatches))
    if not out:
        raise ValueError("batches 为空:需要 (x, y) 可迭代对象或 DataLoader")
    return out


def filter_normalized_directions(model, seed: int = 0):
    """随机方向 δ/η:filter 归一化(逐输出通道 d_f ← d_f/‖d_f‖·‖θ_f‖),跳过 bias/BN。

    返回 (delta, eta):两个与 model.parameters() 一一对齐的方向列表。
    """
    import torch

    g = torch.Generator().manual_seed(seed)
    delta, eta = [], []
    with torch.no_grad():
        for p in model.parameters():
            if p.ndim < 2:
                # bias / BatchNorm 的 weight·bias / LayerNorm 等:方向置零(不扰动)
                delta.append(torch.zeros_like(p))
                eta.append(torch.zeros_like(p))
                continue
            pair = []
            for _ in range(2):
                d = torch.randn(p.shape, generator=g)
                d = d.flatten(1) / d.flatten(1).norm(dim=1, keepdim=True)      # ‖d_f‖=1
                scale = p.flatten(1).norm(dim=1, keepdim=True)                  # ‖θ_f‖
                pair.append(d.reshape(p.shape) * scale.reshape(-1, *([1] * (p.ndim - 1))))
            delta.append(pair[0])
            eta.append(pair[1])
    return delta, eta


def interpolation_directions(model_a, model_b, seed: int = 1):
    """两 checkpoint 插值:δ = θ_b − θ_a(Goodfellow 2014 线性插值主方向),
    η 取 filter 归一化随机方向,构成"插值 × 随机"网格。"""
    import torch

    _, eta_rand = filter_normalized_directions(model_b, seed=seed)
    delta, eta = [], []
    with torch.no_grad():
        for pa, pb, e in zip(model_a.parameters(), model_b.parameters(), eta_rand):
            delta.append(pb - pa)
            eta.append(e)
    return delta, eta


def evaluate_grid(model, batches, delta, eta, n: int = 51, criterion=None):
    """在固定 batches 上评估网格:z[row][col] = loss(θ* + α·δ + β·η)。

    - row → β、col → α,端点 ±1;loss 按 batch 内样本数加权平均
    - model.eval() 冻结 BN running stats;结束恢复原参数与训练状态(try/finally)
    - 返回 numpy 数组,可直接交给 Tracker.log_loss_landscape
    """
    import numpy as np
    import torch

    if criterion is None:
        criterion = torch.nn.CrossEntropyLoss()
    originals = [p.detach().clone() for p in model.parameters()]
    was_training = model.training
    model.eval()
    grid = np.empty((n, n), dtype=np.float64)
    try:
        with torch.no_grad():
            for i in range(n):
                beta = -1.0 + 2.0 * i / (n - 1)
                for j in range(n):
                    alpha = -1.0 + 2.0 * j / (n - 1)
                    for p, o, d, e in zip(model.parameters(), originals, delta, eta):
                        p.copy_(o + alpha * d + beta * e)      # θ = θ* + α·δ + β·η
                    total = 0.0
                    count = 0
                    for x, y in batches:
                        total += float(criterion(model(x), y)) * len(x)
                        count += len(x)
                    grid[i, j] = total / max(count, 1)
    finally:
        with torch.no_grad():
            for p, o in zip(model.parameters(), originals):
                p.copy_(o)
        if was_training:
            model.train()
    return grid
