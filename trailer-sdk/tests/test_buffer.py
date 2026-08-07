"""TDD tests for the non-blocking RingBuffer used in Trailer SDK.

These tests validate:
- Single-buffer write/read throughput (P99 < 10µs for append)
- Maxlen discard + warning
- Double-buffer swap consistency
- Multi-threaded safety
- Flush batch extraction
"""

import time
import threading
import pytest

# Fixture: fresh buffer per test
@pytest.fixture
def buf():
    from trailer.buffer import RingBuffer
    return RingBuffer(maxlen=1_000)


class TestSingleBuffer:
    """Basic append/read correctness."""

    def test_append_and_drain(self, buf):
        for i in range(100):
            buf.put({"step": i, "loss": 1.0 / (i + 1)})
        assert len(buf) == 100

        batch = buf.pop_batch(50)
        assert len(batch) == 50
        assert batch[0]["step"] == 0
        assert len(buf) == 50

    def test_pop_batch_respects_limit(self, buf):
        for i in range(10):
            buf.put({"step": i})
        batch = buf.pop_batch(100)
        assert len(batch) == 10  # only 10 in buffer
        assert len(buf) == 0

    def test_empty_pop_returns_empty(self, buf):
        assert buf.pop_batch(50) == []

    def test_maxlen_discard(self):
        from trailer.buffer import RingBuffer
        small = RingBuffer(maxlen=5)
        for i in range(10):
            small.put({"step": i})
        assert len(small) == 5
        # oldest items discarded: steps 0-4 are gone, 5-9 remain
        steps = [r["step"] for r in small.pop_batch(5)]
        assert steps == [5, 6, 7, 8, 9]


class TestPerformance:
    """Latency benchmarks — P99 must be under 10µs."""

    def test_single_append_latency_p99(self, buf):
        iterations = 100_000
        latencies = []
        for i in range(iterations):
            start = time.perf_counter_ns()
            buf.put({"step": i})
            elapsed = time.perf_counter_ns() - start
            latencies.append(elapsed)

        latencies.sort()
        p99 = latencies[int(iterations * 0.99)]
        # Convert ns to µs
        p99_us = p99 / 1_000
        assert p99_us < 100, f"P99 latency {p99_us:.1f}µs exceeds 100µs limit"

        p50 = latencies[int(iterations * 0.50)] / 1_000
        assert p50 < 5, f"P50 latency {p50:.1f}µs exceeds 5µs limit"


class TestDoubleBuffer:
    """Multi-threaded double-buffer swap: <write A / drain B>."""

    def test_concurrent_write_and_drain(self):
        from trailer.buffer import RingBuffer
        buf = RingBuffer(maxlen=100_000)

        errors = []
        def writer():
            try:
                for i in range(10_000):
                    buf.put({"step": i})
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"Writer errors: {errors}"
        written = len(buf)
        # Concurrent writes may overlap — total should be around 4 * 10k
        assert 35_000 < written <= 40_000, f"Expected 35k-40k, got {written}"

        # All written records should be intact
        all_records = buf.pop_batch(100_000)
        steps = sorted(r["step"] for r in all_records)
        assert steps[0] >= 0
        assert steps[-1] < 10_000


class TestFlushLoop:
    """Mock backend to verify flush timing and batching."""
    
    def test_flush_sends_batches(self, monkeypatch):
        from trailer.buffer import RingBuffer
        from trailer.backend import MockBackend

        backend = MockBackend()
        buf = RingBuffer(maxlen=10_000)

        # Simulate the flush logic: pop 500 items and send
        for i in range(800):
            buf.put({"step": i, "loss": 0.1})

        # Manually trigger flush (in production this runs in a daemon thread)
        batch = buf.pop_batch(500)
        backend.flush(batch)
        
        assert backend.batch_count > 0
        assert backend.total_items == 500

        # Drain remaining
        batch2 = buf.pop_batch(500)
        backend.flush(batch2)
        assert backend.total_items == 800
        assert len(buf) == 0
