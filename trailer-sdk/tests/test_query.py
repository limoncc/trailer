"""Tests for the Query SDK."""
import json
import pytest


class TestQueryRuns:
    def test_runs_returns_dataframe(self, monkeypatch):
        mock_data = [
            {"run_id": "r1", "project": "demo", "state": "running"},
            {"run_id": "r2", "project": "demo", "state": "finished"},
        ]

        def fake_urlopen(url, timeout=None):
            class FakeResp:
                def read(self):
                    return json.dumps(mock_data).encode()
                def __enter__(self):
                    return self
                def __exit__(self, *a):
                    pass
            return FakeResp()

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

        from trailer.query import Query
        q = Query(host="http://test:8080")
        df = q.runs(project="demo")

        assert len(df) == 2
        assert list(df.columns) == ["run_id", "project", "state"]


class TestQueryMetrics:
    def test_metrics_flattens_groups(self, monkeypatch):
        mock_data = [
            {"key": "loss", "context": "train", "points": [
                {"step": 0, "value": 0.5}, {"step": 1, "value": 0.3}]},
            {"key": "acc", "context": "train", "points": [
                {"step": 0, "value": 0.8}]},
        ]

        def fake_urlopen(url, timeout=None):
            class FakeResp:
                def read(self):
                    return json.dumps(mock_data).encode()
                def __enter__(self):
                    return self
                def __exit__(self, *a):
                    pass
            return FakeResp()

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

        from trailer.query import Query
        q = Query(host="http://test:8080")
        df = q.metrics(run_id="r1")

        assert len(df) == 3  # 2 + 1 points
        assert "key" in df.columns
        assert "value" in df.columns
        assert df["key"].iloc[0] == "loss"
        assert df["key"].iloc[2] == "acc"


class TestQueryTexts:
    def test_texts_returns_list(self, monkeypatch):
        mock_data = [
            {"run_id": "r1", "step": 0, "name": "log", "body": "test"},
        ]

        def fake_urlopen(url, timeout=None):
            class FakeResp:
                def read(self):
                    return json.dumps(mock_data).encode()
                def __enter__(self):
                    return self
                def __exit__(self, *a):
                    pass
            return FakeResp()

        monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

        from trailer.query import Query
        q = Query(host="http://test:8080")
        df = q.texts(run_id="r1")

        assert len(df) == 1
        assert df.iloc[0]["body"] == "test"
