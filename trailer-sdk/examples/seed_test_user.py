"""给 test 用户生成模拟数据(远程模式)。

验证用户隔离:test 用户的数据只属于 test_demo 项目,
admin 能看到全部,其他用户看不到。

用法:
  TRAILER_HOST=http://127.0.0.1:5120 TRAILER_TOKEN=<test用户的token> \
      .venv/bin/python python/examples/seed_test_user.py
"""
import math
import os
import random
import time

random.seed(7)

from trailer import Tracker


def main():
    # 远程模式:create_run 走 HTTP POST /api/v1/runs(带 TRAILER_TOKEN)
    for name, lr, noise in [
        ("baseline", 0.01, 0.03),
        ("high_lr", 0.1, 0.06),
        ("sweep_a", 0.005, 0.02),
    ]:
        t = Tracker(
            project="test_demo",
            name=name,
            config={"lr": lr, "epochs": 50, "note": "test user data"},
        )
        for step in range(50):
            t.log({
                "loss": 0.8 * math.exp(-step / 30) + noise * random.random(),
                "accuracy": 1.0 - math.exp(-step / 50) + noise * 0.3 * random.random(),
            }, step=step)
        t.log_text(f"## {name} 训练日志\n\n这是 test 用户的实验 **{name}**。", name="notes", step=0)
        t.finish()
        print(f"  ✓ {name}")

    print("✅ test 用户数据生成完毕(test_demo 项目,3 个 run)")


if __name__ == "__main__":
    main()
