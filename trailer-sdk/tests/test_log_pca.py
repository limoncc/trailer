"""Tracker.log_pca — 3D PCA + k-means 聚类 → figures(kind='pca')."""

import json
import sys
from unittest.mock import Mock


def _remote_tracker(monkeypatch):
    """构造远程模式 Tracker + 捕获 POST payload。"""
    monkeypatch.setenv("TRAILER_HOST", "http://test:8080")
    posted = []

    def fake_urlopen(req, timeout=None):
        posted.append(json.loads(req.data))
        resp = Mock()
        resp.status = 201
        resp.__enter__ = Mock(return_value=resp)
        resp.__exit__ = Mock(return_value=None)
        return resp

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    from trailer.tracker import Tracker
    t = Tracker(project="test", db_path=":memory:")
    return t, posted


class TestLogPca:

    def test_log_pca_structure_with_labels(self, monkeypatch):
        """metadata 提供标签 → clusters 按标签生成，body 结构完整。"""
        t, posted = _remote_tracker(monkeypatch)
        import numpy as np
        vectors = np.random.randn(30, 8).tolist()
        labels = [f"cat_{i % 3}" for i in range(30)]
        t.log_pca(vectors, metadata=labels, name="pca1")
        t.finish()

        assert len(posted) >= 1
        payload = posted[-1]
        assert payload["kind"] == "pca"
        body = json.loads(payload["body"])
        assert body["meta"]["n_samples"] == 30
        assert body["meta"]["n_components"] == 3
        assert len(body["meta"]["clusters"]) == 3
        assert len(body["points"]) == 30
        assert set(body["points"][0]) == {"x", "y", "z", "cluster"}
        assert body["meta"]["axis_labels"][0].startswith("PC1")
        assert "%" in body["meta"]["axis_labels"][0]
        # 颜色取前端同款调色板
        assert body["meta"]["clusters"][0]["color"].startswith("#")

    def test_log_pca_kmeans_without_labels(self, monkeypatch):
        """无 metadata → k-means 自动聚类，聚类数在推断上限内。"""
        t, posted = _remote_tracker(monkeypatch)
        import numpy as np
        vectors = np.random.randn(40, 6).tolist()
        t.log_pca(vectors, name="pca_k")
        t.finish()

        body = json.loads(posted[-1]["body"])
        n_clusters = len(body["meta"]["clusters"])
        assert 2 <= n_clusters <= 8
        assert all("cluster" in p for p in body["points"])

    def test_log_pca_n_clusters_explicit(self, monkeypatch):
        """显式 n_clusters 生效（聚类数 ≤ 请求值）。"""
        t, posted = _remote_tracker(monkeypatch)
        import numpy as np
        vectors = np.random.randn(60, 6).tolist()
        t.log_pca(vectors, name="pca_n", n_clusters=5)
        t.finish()

        body = json.loads(posted[-1]["body"])
        assert len(body["meta"]["clusters"]) <= 5

    def test_log_pca_numpy_fallback(self, monkeypatch):
        """sklearn 缺失 → numpy 手写 PCA/k-means 兜底仍产出合法 3D。"""
        monkeypatch.setitem(sys.modules, "sklearn", None)
        t, posted = _remote_tracker(monkeypatch)
        import numpy as np
        vectors = np.random.randn(25, 5).tolist()
        labels = [f"g{i % 2}" for i in range(25)]
        t.log_pca(vectors, metadata=labels, name="pca_fb")
        t.finish()

        body = json.loads(posted[-1]["body"])
        assert body["meta"]["n_samples"] == 25
        assert len(body["points"]) == 25
        assert all({"x", "y", "z"} <= set(p) for p in body["points"])

    def test_log_pca_passthrough_dict(self, monkeypatch):
        """已是 {meta, points} dict → 原样透传。"""
        t, posted = _remote_tracker(monkeypatch)
        data = {
            "meta": {
                "title": "manual", "n_samples": 3, "n_components": 3,
                "explained_variance": [0.5, 0.3, 0.2],
                "axis_labels": ["PC1", "PC2", "PC3"],
                "clusters": [{"id": 0, "label": "A", "color": "#fff", "count": 3}],
            },
            "points": [
                {"x": 0, "y": 0, "z": 0, "cluster": "A"},
                {"x": 1, "y": 1, "z": 1, "cluster": "A"},
                {"x": 2, "y": 2, "z": 2, "cluster": "A"},
            ],
        }
        t.log_pca(data, name="pca_pass")
        t.finish()

        assert json.loads(posted[-1]["body"]) == data

    def test_log_pca_step_increment(self, monkeypatch):
        """step 自动递增；显式传 step 不递增。"""
        t, posted = _remote_tracker(monkeypatch)
        import numpy as np
        vectors = np.random.randn(10, 4).tolist()
        t.log_pca(vectors, name="a")
        t.log_pca(vectors, name="b")
        t.log_pca(vectors, name="c", step=99)
        t.finish()

        pca_posts = [p for p in posted if p.get("kind") == "pca"]
        steps = [p["step"] for p in pca_posts]
        assert steps[-1] == 99
        assert steps[0] < steps[1]
