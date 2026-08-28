"""损失景观 —— _pack_landscape 网格序列化校验 + log_loss_landscape 记录(kind='landscape' 走 figures 通道)。"""

import json
from unittest.mock import Mock

import pytest


class TestPackLandscape:
    """_pack_landscape 纯函数：形状校验、range 归一化、有效数字舍入、meta 合并。"""

    def test_basic_nested_list(self):
        """嵌套 list 网格 → 完整 body 结构与缺省 range。"""
        from trailer.tracker import _pack_landscape

        body = _pack_landscape([[0.0, 0.5], [1.0, 2.0]])
        assert body["v"] == 1
        assert body["n_rows"] == 2
        assert body["n_cols"] == 2
        assert body["x_range"] == [-1.0, 1.0]
        assert body["y_range"] == [-1.0, 1.0]
        assert body["z"] == [[0.0, 0.5], [1.0, 2.0]]
        # 自动 meta 键 + 用户键都在 meta 里
        assert body["meta"]["n_rows"] == 2
        assert body["meta"]["n_cols"] == 2

    def test_numpy_array_accepted(self):
        """np.ndarray 接受，形状/z 内容保持。"""
        np = pytest.importorskip("numpy")
        from trailer.tracker import _pack_landscape

        g = np.arange(12, dtype=np.float64).reshape(3, 4) / 7.0
        body = _pack_landscape(g)
        assert (body["n_rows"], body["n_cols"]) == (3, 4)
        assert len(body["z"]) == 3
        assert all(len(r) == 4 for r in body["z"])
        assert body["z"][0][0] == pytest.approx(float(g[0][0]), abs=1e-6)

    def test_int_grid_coerced_to_float(self):
        """整型网格转浮点输出。"""
        from trailer.tracker import _pack_landscape

        body = _pack_landscape([[1, 2], [3, 4]])
        assert body["z"] == [[1.0, 2.0], [3.0, 4.0]]
        assert all(isinstance(v, float) for r in body["z"] for v in r)

    def test_six_significant_digits_rounding(self):
        """浮点按 6 位有效数字舍入，序列化体积显著缩小。"""
        from trailer.tracker import _pack_landscape

        raw = 1 / 3
        grid = [[raw] * 8 for _ in range(8)]
        body = _pack_landscape(grid)
        expected = float(f"{raw:.6g}")
        assert body["z"][0][0] == expected
        assert json.dumps(body) != ""  # 可直接 JSON 化
        # 全部值都应等于舍入结果
        assert {r for row in body["z"] for r in row} == {expected}

    def test_meta_user_overrides_auto(self):
        """用户 meta 同名键覆盖自动键，其余保留。"""
        from trailer.tracker import _pack_landscape

        body = _pack_landscape(
            [[0.0, 0.0], [0.0, 0.0]],
            meta={"n_rows": 999, "normalization": "filter", "seed": 0},
        )
        assert body["meta"]["n_rows"] == 999  # 用户覆盖生效
        assert body["n_rows"] == 2           # 顶层结构不受影响
        assert body["meta"]["normalization"] == "filter"
        assert body["meta"]["seed"] == 0
        assert body["meta"]["x_range"] == [-1.0, 1.0]

    def test_ranges_normalized_and_sorted(self):
        """乱序 range 归一为 [min, max]。"""
        from trailer.tracker import _pack_landscape

        body = _pack_landscape([[0.0, 0.0], [0.0, 0.0]], x_range=(1.0, -1.0), y_range=[2.5, -2.5])
        assert body["x_range"] == [-1.0, 1.0]
        assert body["y_range"] == [-2.5, 2.5]

    def test_equal_range_raises(self):
        """range 两端相等 → ValueError(除零风险，画图无意义)。"""
        from trailer.tracker import _pack_landscape

        with pytest.raises(ValueError):
            _pack_landscape([[0.0, 0.0], [0.0, 0.0]], x_range=(1.0, 1.0))

    def test_non_2d_input_raises(self):
        """一维列表 / 标量 / 空输入 → ValueError。"""
        from trailer.tracker import _pack_landscape

        with pytest.raises(ValueError):
            _pack_landscape([1.0, 2.0, 3.0])          # 一维
        with pytest.raises(ValueError):
            _pack_landscape([])                        # 空
        with pytest.raises(ValueError):
            _pack_landscape([[], []])                  # 零列

    def test_ragged_rows_raise(self):
        """行长度不齐 → ValueError。"""
        from trailer.tracker import _pack_landscape

        with pytest.raises(ValueError):
            _pack_landscape([[1.0, 2.0], [1.0]])

    def test_edge_below_two_raises(self):
        """任一边长 <2 → ValueError。"""
        from trailer.tracker import _pack_landscape

        with pytest.raises(ValueError):
            _pack_landscape([[1.0]])
        with pytest.raises(ValueError):
            _pack_landscape([[1.0], [2.0]])  # 2x1

    def test_edge_above_limit_raises(self):
        """超过 250×250 上限 → ValueError(防 body 失控)。"""
        from trailer.tracker import _pack_landscape

        big = [[0.0] * 251 for _ in range(251)]
        with pytest.raises(ValueError):
            _pack_landscape(big)

    def test_non_finite_values_raise(self):
        """NaN / Inf 值会导致前端 JSON.parse 失败 → ValueError。"""
        np = pytest.importorskip("numpy")
        from trailer.tracker import _pack_landscape

        with pytest.raises(ValueError):
            _pack_landscape([[float("nan"), 0.0], [0.0, 0.0]])
        with pytest.raises(ValueError):
            _pack_landscape([[float("inf"), 0.0], [0.0, 0.0]])


def _remote_tracker(monkeypatch):
    """构造远程模式 Tracker + 捕获 POST payload（与 test_log_pca 同法）。"""
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


class TestLogLossLandscape:
    """log_loss_landscape 端到端：本地走 save_figure / 远程 POST figures。"""

    def test_remote_post_payload(self, monkeypatch):
        """远程模式 → POST {name, kind:'landscape', body, step}，body 完整可逆。"""
        t, posted = _remote_tracker(monkeypatch)
        grid = [[0.0, 1.0], [2.0, 3.0]]
        t.log_loss_landscape(grid, name="ll", step=7, meta={"normalization": "filter"})
        t.finish()

        assert len(posted) >= 1
        payload = posted[-1]
        assert payload["kind"] == "landscape"
        assert payload["name"] == "ll"
        assert payload["step"] == 7
        body = json.loads(payload["body"])
        assert body["n_rows"] == 2 and body["n_cols"] == 2
        assert body["z"] == [[0.0, 1.0], [2.0, 3.0]]
        assert body["meta"]["normalization"] == "filter"

    def test_numpy_input(self, monkeypatch):
        """np.ndarray 输入端到端。"""
        np = pytest.importorskip("numpy")
        t, posted = _remote_tracker(monkeypatch)
        g = np.arange(9, dtype=np.float64).reshape(3, 3)
        t.log_loss_landscape(g * 0.5, name="arr")
        t.finish()

        body = json.loads(posted[-1]["body"])
        assert (body["n_rows"], body["n_cols"]) == (3, 3)

    def test_step_auto_increment(self, monkeypatch):
        """step 自动递增；显式传 step 不递增。"""
        t, posted = _remote_tracker(monkeypatch)
        grid = [[0.0, 0.0], [0.0, 0.0]]
        t.log_loss_landscape(grid, name="a")
        t.log_loss_landscape(grid, name="b")
        t.log_loss_landscape(grid, name="c", step=99)
        t.finish()

        posts = [p for p in posted if p.get("kind") == "landscape"]
        steps = [p["step"] for p in posts]
        assert steps[0] < steps[1]
        assert steps[-1] == 99

    def test_invalid_grid_prints_and_no_post(self, monkeypatch, capsys):
        """非法网格打印提示且不抛异常、不产生 POST。"""
        t, posted = _remote_tracker(monkeypatch)
        out = t.log_loss_landscape([1.0, 2.0, 3.0])  # 一维非法
        assert out is None
        t.finish()

        assert not any(p.get("kind") == "landscape" for p in posted)
        assert "log_loss_landscape" in capsys.readouterr().out

    def test_local_mode_routes_to_save_figure(self, monkeypatch):
        """本地模式 → backend.save_figure(name, 'landscape', body, step, run_id)。"""
        t, _posted = _remote_tracker(monkeypatch)
        # 翻转为本地模式，后端换成捕获桩
        calls = []
        backend = Mock()
        backend.save_figure.side_effect = (
            lambda name, kind, body, step, run_id: calls.append((name, kind, body, step))
        )
        t._mode = "local"
        t._backend = backend

        t.log_loss_landscape([[0.0, 1.0], [1.0, 0.0]], name="loc", step=3)
        t.finish()

        assert len(calls) == 1
        name, kind, body, step = calls[0]
        assert (name, kind, step) == ("loc", "landscape", 3)
        assert json.loads(body)["x_range"] == [-1.0, 1.0]

    def test_default_name(self, monkeypatch):
        """缺省 name='loss_landscape'。"""
        t, posted = _remote_tracker(monkeypatch)
        t.log_loss_landscape([[0.0, 0.0], [0.0, 0.0]])
        t.finish()

        assert posted[-1]["name"] == "loss_landscape"


class TestLogLossLandscapeAuto:
    """传入 nn.Module + batches 的自动计算模式(鸭子类型重载)。"""

    def _toy(self, seed=0):
        torch = pytest.importorskip("torch")
        torch.manual_seed(seed)
        model = torch.nn.Sequential(
            torch.nn.Flatten(), torch.nn.Linear(16, 8), torch.nn.ReLU(), torch.nn.Linear(8, 2)
        )
        x = torch.randn(32, 16)
        y = torch.randint(0, 2, (32,))
        return model, [(x[:16], y[:16]), (x[16:], y[16:])]

    def test_auto_random_direction(self, monkeypatch):
        """传 nn.Module → 自动计算网格,meta 自动补 direction/normalization。"""
        torch = pytest.importorskip("torch")
        model, batches = self._toy()
        t, posted = _remote_tracker(monkeypatch)
        base = [p.detach().clone() for p in model.parameters()]
        ce = torch.nn.functional.cross_entropy
        # 网格中心(α=β=0) = 全部评估 batch 的平均 loss(evaluate_grid 的聚合方式)
        base_loss = sum(float(ce(model(x), y)) * len(x) for x, y in batches) / sum(len(x) for x, y in batches)

        t.log_loss_landscape(model, batches, name="auto", step=3, n=9, seed=0)
        t.finish()

        payload = [p for p in posted if p.get("kind") == "landscape"][-1]
        assert payload["step"] == 3
        body = json.loads(payload["body"])
        assert (body["n_rows"], body["n_cols"]) == (9, 9)
        assert body["meta"]["direction"] == "random"
        assert body["meta"]["normalization"] == "filter"
        assert body["meta"]["seed"] == 0
        assert all(v == v for row in body["z"] for v in row)  # 无 NaN
        # 参数必须被恢复
        for p, b in zip(model.parameters(), base):
            assert torch.equal(p, b)
        # 网格中心(α=β=0)应等于原模型 loss
        assert abs(body["z"][4][4] - base_loss) < 1e-3

    def test_auto_interp_direction(self, monkeypatch):
        """model_b 提供时走两 checkpoint 插值方向。"""
        model_a, batches = self._toy(seed=0)
        model_b, _ = self._toy(seed=1)
        t, posted = _remote_tracker(monkeypatch)
        t.log_loss_landscape(model_a, batches, model_b=model_b, name="interp", n=7, seed=5)
        t.finish()

        body = json.loads([p for p in posted if p.get("kind") == "landscape"][-1]["body"])
        assert (body["n_rows"], body["n_cols"]) == (7, 7)
        assert body["meta"]["direction"] == "interp"

    def test_auto_user_meta_overrides(self, monkeypatch):
        """用户 meta 覆盖自动 meta。"""
        model, batches = self._toy()
        t, posted = _remote_tracker(monkeypatch)
        t.log_loss_landscape(model, batches, n=5, meta={"direction": "my-own", "task": "demo"})
        t.finish()

        body = json.loads(posted[-1]["body"])
        assert body["meta"]["direction"] == "my-own"
        assert body["meta"]["task"] == "demo"
        assert body["meta"]["normalization"] == "filter"  # 自动键保留

    def test_auto_batches_resolved_from_dataloader(self, monkeypatch):
        """batches 可传 DataLoader(取前 nbatches 个)。"""
        torch = pytest.importorskip("torch")
        model, batches = self._toy()
        loader = torch.utils.data.DataLoader(
            torch.utils.data.TensorDataset(batches[0][0], batches[0][1]), batch_size=8
        )
        t, posted = _remote_tracker(monkeypatch)
        t.log_loss_landscape(model, loader, n=5, nbatches=2)
        t.finish()

        assert any(p.get("kind") == "landscape" for p in posted)  # 不抛异常即路由成功

    def test_auto_local_mode_routes_to_save_figure(self, monkeypatch):
        """自动模式本地路由:同样走 save_figure(kind=landscape)。"""
        torch = pytest.importorskip("torch")
        model, batches = self._toy()
        t, _ = _remote_tracker(monkeypatch)
        calls = []
        backend = Mock()
        backend.save_figure.side_effect = (
            lambda name, kind, body, step, run_id: calls.append((kind, json.loads(body)))
        )
        t._mode = "local"
        t._backend = backend

        t.log_loss_landscape(model, batches, name="loc", n=5)
        t.finish()

        assert len(calls) == 1
        kind, body = calls[0]
        assert kind == "landscape"
        assert body["n_rows"] == 5
