"""resume 断点续训 + from_step 截断旧区间的回归测试。

场景:run 训练到 84 步,从 50 步 checkpoint 重新训练 ——
旧的 51..84 数据必须被删除,否则出图/Compare/Explore 会与新数据重叠。
"""

import sqlite3

from trailer import Tracker


def _metrics(db, key="loss", context=""):
    con = sqlite3.connect(db)
    try:
        return con.execute(
            "SELECT step, value FROM metrics WHERE key=? AND context=? ORDER BY step",
            (key, context),
        ).fetchall()
    finally:
        con.close()


def _summary(db, run_id, key="loss", context=""):
    con = sqlite3.connect(db)
    try:
        row = con.execute(
            "SELECT last, best, best_step, min_val, max_val FROM run_summary"
            " WHERE run_id=? AND key=? AND context=?",
            (run_id, key, context),
        ).fetchone()
        return row
    finally:
        con.close()


def test_resume_from_step_truncates_tail(tmp_path):
    """from_step=50:51..84 旧数据被删,新数据从 51 干净写入,自动步进衔接。"""
    db = str(tmp_path / "t.db")
    t = Tracker(project="p", db_path=db, auto_collect=False)
    for s in range(85):
        # 旧数据:loss 单调下降,step51 的旧值 0.49 与新值可区分
        t.log({"loss": 1.0 - s * 0.01}, step=s)
    t.finish()
    assert len(_metrics(db)) == 85

    t2 = Tracker(
        project="p",
        db_path=db,
        auto_collect=False,
        resume_from=t.run_id,
        from_step=50,
    )
    # 自动步进从 51 开始(保留区间的 last_step + 1)
    assert t2._step == 51
    t2.log({"loss": 0.99})  # 自动 step=51
    t2.log({"loss": 0.98})  # 自动 step=52
    t2.finish()

    rows = _metrics(db)
    steps = [s for s, _ in rows]
    assert steps == list(range(51)) + [51, 52], (
        f"应只剩 step<=50 + 新的 51/52, got {steps}"
    )
    v51 = [v for s, v in rows if s == 51]
    assert v51 == [0.99], f"step51 应只剩新值, got {v51}"


def test_resume_from_step_recomputes_summary(tmp_path):
    """截断后 run_summary 只反映保留区间(旧 best/min/max 不残留)。"""
    db = str(tmp_path / "s.db")
    t = Tracker(project="p", db_path=db, auto_collect=False)
    for s in range(85):
        t.log({"loss": s * 0.01}, step=s)  # 单调上升:min@0 max@84 last@84
    t.finish()

    t2 = Tracker(
        project="p",
        db_path=db,
        auto_collect=False,
        resume_from=t.run_id,
        from_step=50,
    )
    t2.finish()

    last, best, best_step, min_v, max_v = _summary(db, t.run_id)
    assert abs(max_v - 0.5) < 1e-9, f"max 不应含已删的 51..84, got {max_v}"
    assert best_step == 0, "loss(minimize) best 应回到保留区间的 step0"
    assert abs(last - 0.5) < 1e-9, f"last 应为保留区间最后一步, got {last}"
    assert abs(min_v - 0.0) < 1e-9


def test_resume_without_from_step_keeps_all(tmp_path):
    """不传 from_step:行为与旧版完全一致(纯追加,不截断)。"""
    db = str(tmp_path / "n.db")
    t = Tracker(project="p", db_path=db, auto_collect=False)
    for s in range(10):
        t.log({"loss": 1.0}, step=s)
    t.finish()

    t2 = Tracker(project="p", db_path=db, auto_collect=False, resume_from=t.run_id)
    assert t2._step == 10, "纯追加:自动步进从 last_step+1 继续"
    t2.log({"loss": 0.9})  # 自动 step=10
    t2.finish()
    assert len(_metrics(db)) == 11


def test_resume_negative_from_step_rejected(tmp_path):
    """from_step 为负数 → 直接 ValueError,不写任何数据。"""
    db = str(tmp_path / "neg.db")
    t = Tracker(project="p", db_path=db, auto_collect=False)
    t.log({"loss": 1.0}, step=0)
    t.finish()

    try:
        Tracker(
            project="p",
            db_path=db,
            auto_collect=False,
            resume_from=t.run_id,
            from_step=-1,
        )
    except ValueError:
        return
    raise AssertionError("from_step=-1 应抛 ValueError")


def test_resume_local_mode_needs_no_server(tmp_path):
    """本地模式 resume 不再依赖 trailer up:协商直连 PyO3,纯离线可用。"""
    db = str(tmp_path / "offline.db")
    t = Tracker(project="p", db_path=db, auto_collect=False)
    for s in range(5):
        t.log({"loss": 1.0}, step=s)
    t.finish()

    # 环境里没有 5120 server —— 本地 resume 必须照常工作
    t2 = Tracker(project="p", db_path=db, auto_collect=False, resume_from=t.run_id)
    assert t2._step == 5, "协商失败时 _step 会错回 0(旧 HTTP 依赖的坑)"
    t2.log({"loss": 0.5})
    t2.finish()
    assert [s for s, _ in _metrics(db)] == [0, 1, 2, 3, 4, 5]
