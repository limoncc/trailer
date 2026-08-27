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
