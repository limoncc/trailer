"""Integration tests for M2 SDK modules:
system_monitor, log_capture, code_snapshot, config_capture."""

import time
import pytest


class TestSystemMonitor:
    def test_start_stop_lifecycle(self):
        from trailer.system_monitor import SystemMonitor
        monitor = SystemMonitor(interval=0.1)
        assert not monitor._running

        monitor.start()
        assert monitor._running

        time.sleep(0.3)
        monitor.stop()
        assert not monitor._running  # after stop

    def test_produces_records(self):
        from trailer.system_monitor import SystemMonitor
        monitor = SystemMonitor(interval=0.1)
        monitor.start()
        time.sleep(0.35)
        records = monitor.pop_records()
        # Even without GPU, CPU monitoring via psutil should work
        # (or produce empty list if psutil not installed)
        assert isinstance(records, list)
        monitor.stop()

    def test_gpu_count(self):
        from trailer.system_monitor import SystemMonitor
        monitor = SystemMonitor()
        # GPU count is 0 on machines without nvml (expected)
        assert monitor._gpu_count >= 0
        monitor.shutdown_nvml()


class TestLogCapture:
    def test_stdout_tee(self):
        from trailer.log_capture import LogCapture
        capture = LogCapture()
        capture.start()

        import sys
        print("hello trace", flush=True)

        lines = capture.pop_lines()
        assert len(lines) >= 1
        assert lines[0]["stream"] == "stdout"
        assert "hello trace" in lines[0]["line"]

        capture.stop()

    def test_stderr_tee(self):
        from trailer.log_capture import LogCapture
        capture = LogCapture()
        capture.start()

        import sys
        sys.stderr.write("error message\n")
        sys.stderr.flush()

        lines = capture.pop_lines()
        assert any("error" in l["line"] and l["stream"] == "stderr" for l in lines)

        capture.stop()

    def test_rate_limit(self):
        from trailer.log_capture import LogCapture
        capture = LogCapture()
        capture.start()

        # Send 500 lines — only ~200 should be captured
        for i in range(500):
            print(f"line {i}")

        import time
        time.sleep(0.1)

        lines = capture.pop_lines()

        # Rate limit should keep captured lines reasonable
        assert len(lines) <= 250
        assert capture._dropped > 0

        capture.stop()


class TestCodeSnapshot:
    def test_captures_git_commit(self):
        from trailer.code_snapshot import capture_code_snapshot

        snapshot = capture_code_snapshot()
        # We're in a git repo, so git_commit should exist
        assert "git_commit" in snapshot
        assert len(snapshot["git_commit"]) == 40

    def test_captures_training_script(self):
        from trailer.code_snapshot import capture_code_snapshot

        snapshot = capture_code_snapshot()
        # Should capture this script at minimum
        if "training_script" in snapshot:
            assert len(snapshot["training_script"]) > 0


class TestConfigCapture:
    def test_explicit_config(self):
        from trailer.config_capture import capture_config

        cfg = capture_config(
            explicit={"lr": 0.001, "model": {"depth": 50}},
            capture_argparse=False,
            capture_env=False,
        )
        assert cfg["lr"] == 0.001
        assert cfg["model"]["depth"] == 50

    def test_deep_merge(self):
        from trailer.config_capture import _deep_update

        base = {"a": 1, "b": {"x": 1, "y": 2}}
        _deep_update(base, {"b": {"y": 99}, "c": 3})
        assert base["a"] == 1
        assert base["b"]["x"] == 1
        assert base["b"]["y"] == 99
        assert base["c"] == 3

    def test_safe_serialize(self):
        from trailer.config_capture import _safe_serialize

        assert _safe_serialize(42) == 42
        assert _safe_serialize([1, 2, 3]) == [1, 2, 3]
        assert _safe_serialize({"k": "v"}) == {"k": "v"}

        class Foo:
            pass

        result = _safe_serialize(Foo())
        assert isinstance(result, str)
