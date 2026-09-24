"""Regression tests: local-mode write drain — finish() must not lose batches.

修复前:log_batch fire-and-forget + finish() 只 drain Python buffer 到"入队"
(flush 线程 500 条/s、join 5s 超时)+ RustTracker Drop 时 tokio Runtime 丢弃
未完成的 writer 任务 → channel 未消费批次全丢(26 Tracker 迁移每 run 只落首批)。
修复后:finish() = final flush RingBuffer → Rust drain()(关通道 + 阻塞等
writer 把存量全部落库)→ finish_run。
"""

import msgpack
import pytest
import sqlite3


def _envelopes(run_id: str, start: int, count: int) -> list[dict]:
    return [
        {
            "kind": "metric",
            "run_id": run_id,
            "step": start + i,
            "wall_time": 1000.0 + (start + i),
            "context": "",
            "payload": {"loss": 0.5},
        }
        for i in range(count)
    ]


def _count(db_path: str, table: str = "metrics") -> int:
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def test_drain_persists_all_batches_to_file_db(tmp_path):
    """裸 RustTracker:连发 20×5000 立即 drain() → channel 存量全部落库。"""
    from trailer.trailer import RustTracker

    db = str(tmp_path / "drain.db")
    t = RustTracker(db)
    run_id = "drain-run"
    t.create_run(run_id, "t", "drain")
    total = 0
    for b in range(20):
        t.log_batch(
            msgpack.packb(_envelopes(run_id, b * 5000, 5000), use_bin_type=True)
        )
        total += 5000
    t.drain()  # 立即排空:修复前此处无此方法,且对象回收时丢掉未落库批次
    assert _count(db) == total


def test_tracker_finish_full_pipeline(tmp_path):
    """全链路:Tracker.log 10_000 条立即 finish() → 全部落库(修复前确定性丢批)。"""
    from trailer import Tracker

    db = str(tmp_path / "pipeline.db")
    t = Tracker(project="t", name="pipeline", db_path=db, auto_collect=False)
    for i in range(10_000):
        t.log({"train/loss": 0.5})
    t.finish()  # final flush buffer → Rust drain → finish_run
    assert _count(db) == 10_000


def test_drain_idempotent(tmp_path):
    """drain 两次不报错。"""
    from trailer.trailer import RustTracker

    t = RustTracker(str(tmp_path / "idem.db"))
    t.drain()
    t.drain()


def test_log_batch_after_drain_raises(tmp_path):
    """drain 后 log_batch 应报错且文案含 drained(防静默丢数据)。"""
    from trailer.trailer import RustTracker

    t = RustTracker(str(tmp_path / "closed.db"))
    t.drain()
    with pytest.raises(Exception, match="drained"):
        t.log_batch(msgpack.packb(_envelopes("r", 0, 1), use_bin_type=True))


def test_finish_idempotent(tmp_path):
    """finish() 两次:数据不变、不抛异常。"""
    from trailer import Tracker

    db = str(tmp_path / "fin2.db")
    t = Tracker(project="t", name="finish2", db_path=db, auto_collect=False)
    for i in range(100):
        t.log({"train/loss": 0.5})
    t.finish()
    t.finish()
    assert _count(db) == 100
