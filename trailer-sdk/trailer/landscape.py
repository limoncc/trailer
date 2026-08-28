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


def filter_normalized_directions(model, seed: int = 0, device=None, dtype=None):
    """随机方向 δ/η:filter 归一化(逐输出通道 d_f ← d_f/‖d_f‖·‖θ_f‖),跳过 bias/BN。

    返回 (delta, eta):两个与 model.parameters() 一一对齐的方向列表。

    Args:
        device: 方向张量存放设备,None = 跟随模型参数。
                大模型低显存模式传 torch.device("cpu"),评估时逐层流式上卡。
        dtype:  方向存储 dtype,None = fp32(向后兼容)。
                低显存模式可传模型 dtype(如 float16)省一半显存;
                数值在 fp32 下完成 filter 归一化后再 cast,精度无损感知。
    """
    import torch

    if device is None:
        device = next(model.parameters()).device
    g = torch.Generator(device=device.type).manual_seed(seed)
    delta, eta = [], []
    with torch.no_grad():
        for p in model.parameters():
            if p.ndim < 2:
                # bias / BatchNorm 的 weight·bias / LayerNorm 等:方向置零(不扰动)
                zero = torch.zeros(p.shape, device=device, dtype=dtype or p.dtype)
                delta.append(zero)
                eta.append(zero.clone())
                continue
            pair = []
            for _ in range(2):
                d = torch.randn(p.shape, generator=g, device=device)            # fp32 构造
                d = d.flatten(1) / d.flatten(1).norm(dim=1, keepdim=True)      # ‖d_f‖=1
                scale = p.flatten(1).norm(dim=1, keepdim=True)                  # ‖θ_f‖
                out = d.reshape(p.shape) * scale.reshape(-1, *([1] * (p.ndim - 1)))
                pair.append(out if dtype is None else out.to(dtype))
            delta.append(pair[0])
            eta.append(pair[1])
    return delta, eta


def interpolation_directions(model_a, model_b, seed: int = 1, device=None, dtype=None):
    """两 checkpoint 插值:δ = θ_b − θ_a(Goodfellow 2014 线性插值主方向),
    η 取 filter 归一化随机方向,构成"插值 × 随机"网格。

    device/dtype 语义同 filter_normalized_directions;δ 逐层算完即搬走,
    GPU 瞬时增量只有最大单层张量。
    """
    import torch

    _, eta_rand = filter_normalized_directions(model_b, seed=seed, device=device, dtype=dtype)
    if device is None:
        device = next(model_a.parameters()).device
    delta, eta = [], []
    with torch.no_grad():
        for pa, pb, e in zip(model_a.parameters(), model_b.parameters(), eta_rand):
            d = (pb - pa).to(device=device)
            if dtype is not None:
                d = d.to(dtype)
            delta.append(d)
            eta.append(e)
    return delta, eta


def _evaluate_grid_serial(model, batches, delta, eta, n: int = 51, criterion=None):
    """串行参考实现(逐网格点前向)。torch<2.0 无 torch.func 时的 fallback,
    也是向量化实现的等价性测试参照。"""
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


# 并行档位 → 扰动参数工作集显存预算(设备能力不同,用户按需选择)
PARALLEL_PRESETS = {
    "low": 64 << 20,      # 64MB  —— 集显/老卡/内存紧张
    "medium": 256 << 20,  # 256MB —— 普通独显
    "high": 1 << 30,      # 1GB   —— 大显存 GPU
    "max": 4 << 30,       # 4GB   —— 服务器级
}

# 模型字节数阈值:超过则 mode="auto" 判定走低显存串行路径。
# 向量化路径峰值 ≈ (5+2C)×模型字节,512MB 模型已需 >10GB,越过消费卡红线。
AUTO_SERIAL_THRESHOLD = 512 << 20


def resolve_mode(model, mode: str | None = None) -> str:
    """评估模式归一化:"auto"(或 None)按模型字节数判定 vector/serial。

    - "vector":torch.func 向量化,小模型快 1~2 个数量级
    - "serial":逐点 in-place 扰动,参数零拷贝——大模型(LLM)/vmap 不兼容的模型
    """
    if mode not in (None, "auto", "vector", "serial"):
        raise ValueError(f'mode 取值需为 "auto"/"vector"/"serial" 之一,收到: {mode!r}')
    if mode in ("vector", "serial"):
        return mode
    import torch

    nbytes = sum(p.numel() * p.element_size() for p in model.parameters())
    return "serial" if nbytes >= AUTO_SERIAL_THRESHOLD else "vector"


def _resolve_chunk(P: int, bytes_per_point: int, chunk: int | None = None, parallel: str | None = None) -> int:
    """并行批量推算:显式 chunk > parallel 档位 > 默认 ~300MB 自适应,钳位 [1, P]。

    下限 1:预算连一个网格点都放不下时降级为逐点评估,而不是强推多点导致 OOM。
    """
    if chunk is None:
        if parallel is not None:
            if parallel not in PARALLEL_PRESETS:
                raise ValueError(f"parallel 取值需为 {sorted(PARALLEL_PRESETS)} 之一,收到: {parallel!r}")
            budget = PARALLEL_PRESETS[parallel]
        else:
            budget = int(3e8)   # 默认 ~300MB 自适应
        chunk = max(int(budget // bytes_per_point), 1)
    return max(1, min(chunk, P))


def evaluate_grid(model, batches, delta, eta, n: int = 51, criterion=None, chunk: int | None = None, parallel: str | None = None):
    """向量化网格评估:z[row][col] = loss(θ* + α·δ + β·η)(row→β, col→α, 端点 ±1)。

    基于 torch.func(functional_call + vmap)把同一 chunk 内的网格点合并成批量前向,
    无逐点参数拷贝——相比串行循环快 1~2 个数量级,GPU 上收益最大。
    torch<2.0 自动回退串行实现;结果与串行版等价(有测试保证)。

    - loss 按 batch 内样本数加权平均(等价于拼接后取均值)
    - model.eval() 冻结 BN running stats;结束恢复原参数与训练状态(try/finally)
    - 返回 numpy 数组,可直接交给 Tracker.log_loss_landscape

    Args:
        chunk: 每批并行评估的网格点数。None → 由 parallel 档位(或默认 auto)推算;
               显存紧张可调小(如 64),小模型可调大。
        parallel: 并行档位 "low" / "medium" / "high" / "max"——映射不同的扰动参数
                  工作集显存预算(64MB/256MB/1GB/4GB),按自己设备能力选择。
                  chunk 显式给定时优先于 parallel;两者都缺省则按 ~300MB 自适应。
    """
    import numpy as np
    import torch

    try:
        from torch.func import functional_call, vmap
    except ImportError:  # torch < 2.0
        return _evaluate_grid_serial(model, batches, delta, eta, n=n, criterion=criterion)

    if criterion is None:
        criterion = torch.nn.CrossEntropyLoss()
    batches = list(batches)

    named = list(model.named_parameters())
    names = [k for k, _ in named]
    base = [p.detach() for _, p in named]
    deltas = dict(zip(names, delta))
    etas = dict(zip(names, eta))
    device = base[0].device

    # 固定评估子集拼接为单个 batch(loss 的样本加权均值 == 拼接后均值)
    xs = torch.cat([x.to(device) for x, _ in batches])
    ys = torch.cat([y.to(device) for _, y in batches])

    # 行主序展开:flat k = i*n + j → β_i(行), α_j(列)
    alphas = torch.linspace(-1.0, 1.0, n, device=device).repeat(n)
    betas = torch.linspace(-1.0, 1.0, n, device=device).repeat_interleave(n)
    P = n * n

    numel = sum(p.numel() for p in base)
    bytes_per_point = max(numel * base[0].element_size(), 1)
    chunk = _resolve_chunk(P, bytes_per_point, chunk=chunk, parallel=parallel)

    was_training = model.training
    model.eval()
    grid = np.empty((n, n), dtype=np.float64)
    try:
        with torch.no_grad():
            def loss_at(alpha, beta):
                pert = {
                    k: base[i] + alpha * deltas[k] + beta * etas[k]
                    for i, k in enumerate(names)
                }
                return criterion(functional_call(model, pert, (xs,)), ys)

            flat = torch.empty(P, dtype=torch.float32, device=device)
            for s in range(0, P, chunk):
                e = min(s + chunk, P)
                flat[s:e] = vmap(loss_at)(alphas[s:e], betas[s:e])
            grid = flat.cpu().to(torch.float64).numpy().reshape(n, n)
    finally:
        if was_training:
            model.train()
    return grid
