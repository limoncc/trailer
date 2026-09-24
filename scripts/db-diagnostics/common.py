"""E 系列 SQLite 损坏复现实验共用工具。

退出码约定:0=PASS(未复现) / 3=REPRO(复现损坏) / 4=SKIPPED / 2=用法错误。
"""

import os
import sqlite3
import sys
import time
from datetime import datetime, timezone


def sqlite_versions() -> dict:
    """Python 侧 SQLite 版本(Rust 侧 bundled 3.46 由 Cargo.lock 决定)。"""
    return {"python_sqlite3": sqlite3.sqlite_version, "python": sys.version.split()[0]}


def db_fingerprint(db_path: str) -> dict:
    """库四件套元数据:大小 + mtime(损坏取证必存)。"""
    out = {}
    for suffix in ("", "-wal", "-shm", "-journal"):
        p = db_path + suffix
        if os.path.exists(p):
            st = os.stat(p)
            out[os.path.basename(p)] = {
                "size": st.st_size,
                "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            }
    return out


def dump_fingerprint(db_path: str, err: Exception | str, phase: str) -> None:
    """复现时打印完整指纹,提示保存四件套副本。"""
    print("=" * 60)
    print(f"[REPRO] phase={phase}")
    print(f"error: {err}")
    print(f"python sqlite3: {sqlite_versions()['python_sqlite3']}")
    print(f"db files: {db_fingerprint(db_path)}")
    print(f"time: {datetime.now(timezone.utc).isoformat()}")
    print(">>> 请立即保存 db/-wal/-shm 四件套副本供取证(scripts/db-diagnostics/e4_inspect.py)")


def check(conn: sqlite3.Connection, sql: str) -> str:
    """执行 PRAGMA 检查语句,损坏/报错原样抛出(由调用方捕获定性)。"""
    rows = conn.execute(sql).fetchall()
    return "; ".join(str(r[0]) for r in rows)


def writer_loop(tracker, stop_after: float | None, rate: int, stop_flag: list):
    """按 rate 条/秒持续 log,直到时长到或 stop_flag 置位。"""
    interval = 1.0 / max(rate, 1)
    n = 0
    deadline = time.time() + stop_after if stop_after else None
    while not (stop_flag[0] or (deadline and time.time() >= deadline)):
        tracker.log({"train/loss": 0.5, "lr": 0.001, "step_val": n % 100})
        n += 1
        if n % max(rate // 10, 1) == 0:
            time.sleep(interval * max(rate // 10, 1))  # 分批睡眠,避免纯自旋
    stop_flag[0] = True
    return n


def ro_connect(db_path: str, open_mode: str = "ro", query_only: bool = True, immutable: bool = False):
    """按实验参数打开轮询连接:默认严格只读 URI。"""
    uri = f"file:{db_path}?mode={open_mode}"
    if immutable:
        uri += "&immutable=1"
    conn = sqlite3.connect(uri, uri=True)
    if query_only:
        conn.execute("PRAGMA query_only = 1")
    return conn
