#!/usr/bin/env python3
"""
Trailer 实时预览演示
────────────────
使用方式：
  1. 启动服务端：trailer up（或运行 trailer-server）
  2. 打开浏览器 http://127.0.0.1:5120  登录 admin/admin
  3. 运行本脚本：uv run python trailer-sdk/examples/live_preview.py
  4. 在浏览器中观察数据实时增长（每 5 秒自动刷新）

说明：
  - 模拟 20 步训练，每步 3 秒，总计 60 秒
  - 自动采集 CPU/内存/GPU 数据（Tracker auto_collect=True）
  - 浏览器中 Metrics Tab 自动刷新，曲线逐步增长
  - 侧栏可调整刷新频率（Off/5s/10s/30s/60s）
"""

import time, math, sys
from trailer import Tracker

PRINT_WIDTH = 60

def main():
    print("=" * PRINT_WIDTH)
    print("  Trailer 实时预览演示")
    print()
    print("  👉 将浏览器打开到 http://127.0.0.1:5120")
    print("  👉 登录 admin/admin")
    print("  👉 侧栏选择 live_preview 项目")
    print("  👉 看数据和曲线一步步增长")
    print()
    print("  开始前方浏览器就绪，训练将立即开始！")
    print("=" * PRINT_WIDTH)

    t = Tracker(project="live_preview", name="实时预览演示")
    print(f"\n  ✅ 项目 live_preview 已出现在侧栏")
    print(f"  ⏳ 训练 20 步，每步 3 秒，持续 60 秒\n")

    total = 20
    for step in range(total):
        loss = 1.0 / (step + 1) + 0.03 * math.sin(step * 0.5)
        acc = 1.0 - loss + 0.01 * (step % 3)
        lr = 0.001 * (0.95 ** step)

        t.log({"train/loss": loss, "train/accuracy": acc, "lr": lr}, step=step)
        t.log_text(f"Epoch {step}: loss={loss:.4f}", name="log")

        bar = "█" * (step + 1) + "░" * (total - step - 1)
        sys.stdout.write(f"\r  Step {step+1:2d}/{total} [{bar}] loss={loss:.4f}  acc={acc:.4f}")
        sys.stdout.flush()
        time.sleep(3.0)

    print(f"\n\n{'=' * PRINT_WIDTH}")
    print(f"  ✅ 训练完成！共 {total} 步，{total * 3} 秒")
    print(f"  浏览器中数据已全部就绪")
    print(f"{'=' * PRINT_WIDTH}")
    t.finish()


if __name__ == "__main__":
    main()
