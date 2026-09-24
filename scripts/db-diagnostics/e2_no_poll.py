"""E2 对照:同样写负载、无任何第二连接 → 结束后一次性 integrity_check。

预期必须 PASS(对应迁移第 1 轮:纯单写零损坏);若此实验也坏,结论推翻。
"""

import argparse
import threading

from common import check, dump_fingerprint, ro_connect, sqlite_versions, writer_loop


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/tmp/e2.db")
    ap.add_argument("--duration-s", type=float, default=120)
    ap.add_argument("--write-rate", type=int, default=2000)
    args = ap.parse_args()

    from trailer.trailer import Tracker

    print(f"[E2] db={args.db} rate={args.write_rate}/s duration={args.duration_s}s (无轮询)")
    print(f"[E2] python sqlite3 = {sqlite_versions()['python_sqlite3']}")

    stop_flag = [False]
    t = Tracker(project="e2", name="e2", db_path=args.db, auto_collect=False)
    tw = threading.Thread(target=writer_loop, args=(t, args.duration_s, args.write_rate, stop_flag))
    tw.start()
    tw.join(timeout=args.duration_s + 60)

    t.finish()  # 排空
    errors: list[str] = []
    try:
        conn = ro_connect(args.db)
        result = check(conn, "PRAGMA integrity_check")
        print(f"[E2] integrity_check: {result[:120]}")
        if result != "ok":
            errors.append(f"integrity_check: {result}")
        conn.close()
    except Exception as e:
        errors.append(f"integrity_check: {e}")

    if errors:
        dump_fingerprint(args.db, "; ".join(errors), "final")
        raise SystemExit(3)
    print("[E2] PASS — 纯单写全程无损坏(对照成立)")
    raise SystemExit(0)


if __name__ == "__main__":
    main()
