"""E1:本地写入 + Python 只读轮询 —— 复现 malformed 损坏的主实验。

用法:
  uv run python scripts/db-diagnostics/e1_ro_poll.py --db /tmp/e1.db --duration-s 120
  # 对照组:故意非 ro 打开(验证用户原脚本是否未用 URI ro)
  uv run python scripts/db-diagnostics/e1_ro_poll.py --db /tmp/e1b.db --open-mode rw --query-only 0

判定:任一轮询异常或 integrity_check 失败 → REPRO(退出码 3);全程干净 → PASS(0)。
"""

import argparse
import threading
import time

from common import check, dump_fingerprint, ro_connect, sqlite_versions, writer_loop


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/tmp/e1_danmaku.db")
    ap.add_argument("--duration-s", type=float, default=120)
    ap.add_argument("--interval-ms", type=float, default=50)
    ap.add_argument("--open-mode", choices=["ro", "rw"], default="ro")
    ap.add_argument("--query-only", type=int, default=1)
    ap.add_argument("--immutable", type=int, default=0)
    ap.add_argument("--write-rate", type=int, default=2000, help="写速率(条/秒)")
    ap.add_argument("--integrity-every", type=int, default=20, help="每 N 次轮询做一次 integrity_check")
    args = ap.parse_args()

    from trailer import Tracker

    print(f"[E1] db={args.db} poll={args.interval_ms}ms mode={args.open_mode} "
          f"query_only={args.query_only} immutable={args.immutable} rate={args.write_rate}/s")
    print(f"[E1] python sqlite3 = {sqlite_versions()['python_sqlite3']} (Rust bundled = 3.46.0)")

    stop_flag = [False]
    t = Tracker(project="e1", name="e1", db_path=args.db, auto_collect=False)
    tw = threading.Thread(target=writer_loop, args=(t, args.duration_s, args.write_rate, stop_flag))
    tw.start()

    errors: list[str] = []
    polls = 0
    poll_conn = None
    deadline = time.time() + args.duration_s
    try:
        poll_conn = ro_connect(args.db, args.open_mode, bool(args.query_only), bool(args.immutable))
    except Exception as e:
        errors.append(f"poll open failed: {e}")

    while time.time() < deadline and not errors:
        polls += 1
        try:
            poll_conn.execute("SELECT count(*) FROM metrics").fetchone()
            if polls % args.integrity_every == 0:
                check(poll_conn, "PRAGMA quick_check")
            if polls % (args.integrity_every * 10) == 0:
                check(poll_conn, "PRAGMA integrity_check")
        except Exception as e:
            errors.append(f"poll#{polls}: {e}")
            break
        time.sleep(args.interval_ms / 1000.0)

    stop_flag[0] = True
    tw.join(timeout=30)
    t.finish()  # 修复后的 finish 会正确排空

    # 最终完整性
    try:
        final_conn = ro_connect(args.db, args.open_mode, bool(args.query_only), bool(args.immutable))
        result = check(final_conn, "PRAGMA integrity_check")
        print(f"[E1] final integrity_check: {result[:120]}")
        if result != "ok":
            errors.append(f"final integrity_check: {result}")
        final_conn.close()
    except Exception as e:
        errors.append(f"final integrity_check: {e}")

    if errors:
        dump_fingerprint(args.db, "; ".join(errors[:5]), f"polls={polls}")
        raise SystemExit(3)
    print(f"[E1] PASS — {polls} 次轮询全程干净(写入 {args.write_rate}/s × {args.duration_s}s)")
    raise SystemExit(0)


if __name__ == "__main__":
    main()
