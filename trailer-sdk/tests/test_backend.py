"""TDD tests for Trailer SDK backends (LocalBackend, RemoteBackend, MockBackend).

Tests cover:
- MockBackend: flush counting
- LocalBackend: msgpack encoding + PyO3 dispatch
- RemoteBackend: HTTP POST to trailer-server
- Tracker.log_figure: figure recording
"""

import base64
import json
import msgpack
import pytest


class TestMockBackend:
    """MockBackend: test-only, records batches and counts."""

    @pytest.fixture
    def backend(self):
        from trailer.backend import MockBackend
        return MockBackend()

    def test_flush_counts_batches(self, backend):
        batch = [{"kind": "metric", "run_id": "r1", "step": 0,
                  "wall_time": 100.0, "context": "", "payload": {"loss": 0.5}}]
        backend.flush(batch)
        assert backend.batch_count == 1
        assert backend.total_items == 1

    def test_multiple_flushes_accumulate(self, backend):
        for i in range(5):
            batch = [{"step": i}, {"step": i + 1}]
            backend.flush(batch)
        assert backend.batch_count == 5
        assert backend.total_items == 10

    def test_empty_batch(self, backend):
        backend.flush([])
        assert backend.batch_count == 1
        assert backend.total_items == 0


class TestLocalBackend:
    """LocalBackend: PyO3 direct call to Rust SQLite."""

    def test_locallbackend_importable(self):
        from trailer.backend import LocalBackend
        assert LocalBackend is not None

    def test_mock_rust_module(self, monkeypatch):
        """
        Simulate a mock Rust module to verify LocalBackend flushes correctly.
        """
        batch_logged = []

        class MockRustTracker:
            def log_batch(self, payload):
                batch_logged.append(payload)

        from trailer.backend import LocalBackend
        local = LocalBackend(MockRustTracker())

        batch = [{"kind": "metric", "step": 0, "payload": {"loss": 0.5}}]
        local.flush(batch)

        assert local.batch_count == 1
        assert local.total_items == 1
        assert len(batch_logged) == 1
        # Verify msgpack was used
        decoded = msgpack.unpackb(batch_logged[0])
        assert decoded[0]["step"] == 0
        assert decoded[0]["payload"]["loss"] == 0.5


class TestRemoteBackend:
    """RemoteBackend: HTTP POST to trailer-server via httpx."""

    def test_remotebackend_importable(self):
        from trailer.backend import RemoteBackend
        assert RemoteBackend is not None

    def test_init_requires_no_httpx(self, monkeypatch):
        """
        RemoteBackend.__init__ should fail gracefully if httpx not installed.
        """
        from trailer.backend import RemoteBackend

        def broken_make_session(_self):
            raise ImportError("No module named 'httpx'")

        monkeypatch.setattr(RemoteBackend, "_make_session", broken_make_session)
        with pytest.raises(ImportError):
            RemoteBackend()


class TestLogFigure:
    """Tracker.log_figure: dict spec and matplotlib figure handling."""

    def test_log_figure_dict_spec(self, monkeypatch):
        """G2 dict spec is sent as kind='g2' with JSON body."""
        posted_data = {}

        def fake_urlopen(req, timeout=None):
            posted_data["body"] = json.loads(req.data)
            from unittest.mock import Mock
            resp = Mock()
            resp.status = 201
            resp.__enter__ = Mock(return_value=resp)
            resp.__exit__ = Mock(return_value=None)
            return resp

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
        monkeypatch.setenv("TRAILER_HOST", "http://test:8080")

        from trailer.tracker import Tracker
        t = Tracker(project="test", db_path=":memory:")
        t.log_figure({"type": "line", "data": [{"x": 0, "y": 1}]}, name="curve")
        t.finish()

        assert "body" in posted_data
        body = posted_data["body"]
        assert body["kind"] == "g2"
        assert body["name"] == "curve"
        assert json.loads(body["body"])["type"] == "line"

    def test_log_figure_handles_connection_error(self, monkeypatch):
        """log_figure shouldn't raise on network error, just prints."""
        monkeypatch.setenv("TRAILER_HOST", "http://test:8080")
        calls = []

        def broken_urlopen(req, timeout=None):
            calls.append(req)
            raise ConnectionError("server not available")

        monkeypatch.setattr("urllib.request.urlopen", broken_urlopen)

        from trailer.tracker import Tracker
        t = Tracker(project="test", db_path=":memory:")
        t.log_figure({"type": "line"})  # Should not raise
        t.finish()
        assert len(calls) >= 1


class TestLogTable:
    """Tracker.log_table — pandas DataFrame and list[dict] support."""

    def test_log_table_from_dicts(self, monkeypatch):
        """list[dict] converts to columns + rows."""
        monkeypatch.setenv("TRAILER_HOST", "http://test:8080")
        posted = []

        def fake_urlopen(req, timeout=None):
            posted.append(json.loads(req.data))
            from unittest.mock import Mock
            resp = Mock()
            resp.status = 201
            resp.__enter__ = Mock(return_value=resp)
            resp.__exit__ = Mock(return_value=None)
            return resp

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

        from trailer.tracker import Tracker
        t = Tracker(project="test", db_path=":memory:")
        t.log_table([{"epoch": 0, "loss": 0.5}, {"epoch": 1, "loss": 0.3}], name="metrics")
        t.finish()

        assert len(posted) >= 1
        body = posted[-1]
        assert body["name"] == "metrics"
        assert body["columns"] == ["epoch", "loss"]
        assert body["data"][0] == [0, 0.5]

    def test_log_table_handles_error_gracefully(self, monkeypatch):
        """log_table shouldn't raise on network error."""
        monkeypatch.setenv("TRAILER_HOST", "http://test:8080")
        def broken(req, timeout=None):
            raise ConnectionError("down")

        monkeypatch.setattr("urllib.request.urlopen", broken)

        from trailer.tracker import Tracker
        t = Tracker(project="test", db_path=":memory:")
        t.log_table([{"x": 1}])  # Should not raise
        t.finish()


class TestLogEmbedding:
    """Tracker.log_embedding — PCA reduction to 2D scatter."""

    def test_log_embedding_reduces_to_2d(self, monkeypatch):
        """Vectors with 10 features get reduced to 2D scatter."""
        monkeypatch.setenv("TRAILER_HOST", "http://test:8080")
        posted = []

        def fake_urlopen(req, timeout=None):
            posted.append(json.loads(req.data))
            from unittest.mock import Mock
            resp = Mock()
            resp.status = 201
            resp.__enter__ = Mock(return_value=resp)
            resp.__exit__ = Mock(return_value=None)
            return resp

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

        import numpy as np
        vectors = np.random.randn(20, 10).tolist()  # 20 points, 10 dims
        labels = [f"cat_{i % 3}" for i in range(20)]

        from trailer.tracker import Tracker
        t = Tracker(project="test", db_path=":memory:")
        t.log_embedding(vectors, metadata=labels, name="pca_test")
        t.finish()

        assert len(posted) >= 1
        body = json.loads(posted[-1]["body"])
        assert body["type"] == "point"
        assert len(body["data"]) == 20
        assert "x" in body["data"][0]
        assert "y" in body["data"][0]
        assert "label" in body["data"][0]


class TestLogModel:

    def test_log_model_extracts_hierarchy(self, monkeypatch):
        """Mock a nested model and verify nodes/edges structure."""
        monkeypatch.setenv("TRAILER_HOST", "http://test:8080")
        posted = []

        def fake_urlopen(req, timeout=None):
            posted.append(json.loads(req.data))
            from unittest.mock import Mock
            resp = Mock()
            resp.status = 201
            resp.__enter__ = Mock(return_value=resp)
            resp.__exit__ = Mock(return_value=None)
            return resp

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

        # Mock PyTorch-like modules
        class MockParam:
            def __init__(self, shape=None, requires_grad=True):
                self._shape = shape or (100,)
                self.requires_grad = requires_grad
            @property
            def shape(self):
                return self._shape
            @property
            def ndim(self):
                return len(self._shape)
            def numel(self):
                import math
                return math.prod(self._shape)

        class MockModule:
            def __init__(self, name, children=None, params=None):
                self._name = name
                self._children = children or []
                self._params = params or [MockParam()]
            def named_modules(self, prefix=""):
                yield (prefix, self)
                for c in self._children:
                    yield from c.named_modules(prefix=(prefix + "." + c._name) if prefix else c._name)
            def named_parameters(self, recurse=True):
                for i, p in enumerate(self._params):
                    yield (f"param_{i}", p)
            def named_children(self):
                for c in self._children:
                    yield (c._name, c)
            def parameters(self):
                return self._params
            def children(self):
                return iter(self._children)

        fc1 = MockModule("fc1")
        fc2 = MockModule("fc2")
        classifier = MockModule("classifier", [fc1, fc2])
        model = MockModule("model", [classifier])

        from trailer.tracker import Tracker
        t = Tracker(project="test", db_path=":memory:")
        t.log_model(model, name="resnet")
        t.finish()

        assert len(posted) >= 1
        payload = posted[-1]
        assert payload["kind"] == "model"
        graph = json.loads(payload["body"])
        # extract_graph 返回 {meta, tree, edges}: tree 为嵌套结构
        assert graph["meta"]["class"] == "MockModule"
        assert graph["meta"]["trace_mode"] == "static"
        assert graph["tree"]["class"] == "MockModule"          # 根节点
        assert len(graph["edges"]) > 0                         # 有顺序边
        # 树嵌套: model → classifier → fc1/fc2 (至少 4 个节点)
        def count_nodes(t):
            return 1 + sum(count_nodes(c) for c in t.get("children", []))
        assert count_nodes(graph["tree"]) >= 4

class TestLogMedia:
    """Tracker.log_image / log_video / log_audio."""

    def test_log_image_sends_media_request(self, monkeypatch):
        """log_image POSTs base64-encoded PNG to media API."""
        monkeypatch.setenv("TRAILER_HOST", "http://test:8080")
        posted = []

        def fake_urlopen(req, timeout=None):
            posted.append(json.loads(req.data))
            from unittest.mock import Mock
            resp = Mock()
            resp.status = 201
            resp.__enter__ = Mock(return_value=resp)
            resp.__exit__ = Mock(return_value=None)
            return resp

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

        from trailer.tracker import Tracker
        t = Tracker(project="test", db_path=":memory:")
        t.log_image(__file__, name="screenshot")
        t.finish()

        assert len(posted) >= 1
        body = posted[-1]
        assert body["kind"] == "image"
        assert body["name"] == "screenshot"
        assert body["ext"] == "png"
        assert len(body["data"]) > 0

    def test_log_video_sends_request(self, monkeypatch):
        """log_video reads file, base64-encodes, and POSTs."""
        monkeypatch.setenv("TRAILER_HOST", "http://test:8080")
        posted = []

        def fake_urlopen(req, timeout=None):
            posted.append(json.loads(req.data))
            from unittest.mock import Mock
            resp = Mock()
            resp.status = 201
            resp.__enter__ = Mock(return_value=resp)
            resp.__exit__ = Mock(return_value=None)
            return resp

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

        from trailer.tracker import Tracker
        t = Tracker(project="test", db_path=":memory:")
        # Use a temp file to simulate a video
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"fake mp4 content")
            tmp = f.name
        try:
            t.log_video(tmp, name="training")
            t.finish()
        finally:
            os.unlink(tmp)

        assert len(posted) >= 1
        body = posted[-1]
        assert body["kind"] == "video"
        assert body["ext"] == "mp4"