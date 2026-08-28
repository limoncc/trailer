"""Integration test: PyO3 LocalBackend (Python → Rust → SQLite)."""

import msgpack
import pytest


@pytest.fixture
def tracker():
    from trailer.trailer import RustTracker

    import os
    db_path = "sqlite::memory:"
    t = RustTracker(db_path)
    yield t


def test_log_batch_accepts_valid_envelope(tracker):
    """RustTracker.log_batch should accept msgpack-encoded metric envelopes."""
    envelopes = [
        {
            "kind": "metric",
            "run_id": "test-run-1",
            "step": 0,
            "wall_time": 1000.0,
            "context": "",
            "payload": {"loss": 0.5, "train/loss": 0.7},
        },
        {
            "kind": "metric",
            "run_id": "test-run-1",
            "step": 1,
            "wall_time": 1001.0,
            "context": "",
            "payload": {"loss": 0.4, "train/loss": 0.6},
        },
    ]
    payload = msgpack.packb(envelopes, use_bin_type=True)
    # Should not raise — the batch is pushed to the channel
    tracker.log_batch(payload)


def test_log_batch_rejects_invalid_msgpack(tracker):
    """RustTracker.log_batch should raise ValueError on invalid msgpack."""
    with pytest.raises(Exception):
        tracker.log_batch(b"not valid msgpack!!!")


def test_tracker_version():
    """Verify the compiled module reports the right version."""
    import trailer
    import trailer.trailer
    assert trailer.trailer.__version__ == trailer.__version__


def test_rusttracker_class_exists():
    """RustTracker class is importable from Python."""
    from trailer.trailer import RustTracker
    assert RustTracker is not None
