"""Explore 演示数据:scaling law + 超参 sweep。

用法(本地模式,PyO3 直写 SQLite):
  .venv/bin/python python/examples/seed_explore.py
"""
import math
import os
import random

os.environ.pop("TRAILER_HOST", None)
random.seed(7)

from trailer import Tracker


def run_scaling(project, name, params, hidden, lr, base_loss):
    """scaling 数据:loss 终值随 params 递减,供 log-log 散点(scaling law)。"""
    t = Tracker(project=project, name=name, config={
        "params": params, "hidden": hidden, "lr": lr, "model": "transformer",
    })
    for step in range(60):
        t.log({"loss": base_loss * math.exp(-step / 40) + 0.01 * random.random()}, step=step)
    t.finish()
    print(f"  ✓ {project}/{name} params={int(params)}")


def main():
    # 跨项目 scaling law:两个项目,各 3 个不同规模模型
    print("[scaling-a] 小模型")
    for params, base in [(1e6, 1.2), (1e7, 0.6), (1e8, 0.3)]:
        run_scaling("scaling-a", f"model-{int(params)}", params, 32, 1e-3, base)

    print("[scaling-b] 大模型")
    for params, base in [(5e7, 0.5), (2e8, 0.25), (1e9, 0.12)]:
        run_scaling("scaling-b", f"model-{int(params)}", params, 64, 5e-4, base)

    # 同一模型不同超参 sweep:4 run,不同 lr/width
    print("[sweep-lr] 超参 sweep")
    for lr, width in [(1e-3, 64), (3e-4, 64), (1e-3, 128), (3e-4, 128)]:
        t = Tracker(project="sweep-lr", name=f"lr{lr}_w{width}",
                    sweep_id="sweep-lr",
                    config={"model": "transformer", "lr": lr, "width": width})
        for step in range(40):
            t.log({
                "train/loss": 1.5 * math.exp(-step / (15 + width / 8)) + 0.02 * random.random(),
                "accuracy": 1 - math.exp(-step / (20 + width / 10)) + 0.01 * random.random(),
            }, step=step)
        t.finish()

    # 平行坐标示例:多维超参网格 + accuracy(供 Parallel 图展示)
    print("[parallel-grid] 平行坐标示例(超参网格 + accuracy)")
    grid = []
    for lr in [1e-4, 1e-3, 3e-3]:
        for width in [32, 64, 128]:
            for depth in [2, 4]:
                grid.append((lr, width, depth))
    for i, (lr, width, depth) in enumerate(grid):
        t = Tracker(project="parallel-grid", name=f"pg{i}",
                    config={"lr": lr, "width": width, "depth": depth,
                            "dropout": round(0.1 + 0.1 * (i % 3), 2), "batch": 32})
        for step in range(20):
            # accuracy 与参数相关:width 大/depth 深 → 更高;lr 适中(1e-3) → 更高
            base = 0.45 + 0.25 * (width / 128) + 0.15 * (depth / 4) - abs(math.log10(lr) + 3) * 0.08
            t.log({"accuracy": min(0.99, base + 0.25 * (1 - math.exp(-step / 8)) + 0.01 * random.random())},
                  step=step)
        t.finish()
    print(f"  ✓ {len(grid)} 个平行坐标 run")
    print("✅ explore 演示数据已生成")


if __name__ == "__main__":
    main()
