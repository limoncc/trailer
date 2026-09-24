"""E3:轮询走 Rust 读路径(bundled SQLite 3.46)——区分「双 SQLite 版本并发」vs「纯并发」。

前置:cargo build -p trailer-core --example ro_reader
判定:配合 E1 使用——E1(Python 读)复现 + E3(Rust 读)PASS → 双版本问题;
     两者都复现 → 纯读写并发问题(与版本无关)。
"""

import argparse
import subprocess
import sys
import threading
import time

from common import dump_fingerprint, ro_connect, check, writer_loop

REPO = __file__.rsplit("/scripts/", 1)[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/tmp/e3.db")
    ap.add_argument("--duration-s", type=float, default=120)
    ap.add_argument("--interval-ms", type=float, default=50)
    ap.add_argument("--write-rate", type=int, default=2000)
    args = ap.parse_args()

    print(f"[E3] db={args.db} rust-read poll={args.interval_ms}ms rate={args.write_rate}/s")

    stop_flag = [False]
    t = Tracker(project="e3", name="e3", db_path=args.db, auto_collect=False)
    tw = threading.Thread(target=writer_loop, args=(t, args.duration_s, args.write_rate, stop_flag))
    tw.start()

    # Rust 只读轮询子进程(bundled 3.46)
    proc = subprocess.Popen(
        ["cargo", "run", "-q", "-p", "trailer-core", "--example", "ro_reader",
         "--", args.db, "--interval-ms", str(int(args.interval_ms))],
        cwd=REPO, stderr=subprocess.PIPE, text=True,
    )

    # 等写负载结束
    tw.join(timeout=args.duration_s + 60)
    stop_flag[0] = True

    try:
        _, stderr = proc.communicate(timeout=120)
    except subprocess.TimeoutExpired:
        proc.kill()
        _, stderr = proc.communicate()

    errors = []
    if proc.returncode != 0:
        err_text = (stderr or "").strip().splitlines()
        errors.append(f"ro_reader exit={proc.returncode}: {err_text[-3:] if err_text else '?'}")

    try:
        conn = ro_connect(args.db)
        result = check(conn, "PRAGMA integrity_check")
        print(f"[E3] integrity_check: {result[:120]}")
        if result != "ok":
            errors.append(f"integrity_check: {result}")
        conn.close()
    except Exception as e:
        errors.append(f"integrity_check: {e}")

    if errors:
        dump_fingerprint(args.db, "; ".join(errors), "final")
        raise SystemExit(3)
    print("[E3] PASS — Rust(bundled 3.46) 只读轮询全程无损坏")
    raise SystemExit(0)


if __name__ == "__main__":
    main()
