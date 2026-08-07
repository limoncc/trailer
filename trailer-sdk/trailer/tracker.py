"""Trailer Tracker — main entry point for users.

Usage:
    from trailer import Tracker
    tracker = Tracker(project="my_exp")
    for epoch in range(100):
        tracker.log({"loss": 0.5, "lr": 0.001}, step=epoch)
    tracker.finish()
"""

import json
import os
import time
import threading
from typing import Any, Dict

from trailer.buffer import RingBuffer
from trailer.backend import LocalBackend, MockBackend

# PCA 3D 聚簇调色板（与前端 frontend/src/lib/pca/pca3d-viewer.ts DEFAULT_COLORS 保持一致）
DEFAULT_PCA_COLORS = [
    "#5B8FF9", "#5AD8A6", "#5D7092", "#F6BD16", "#E8684A",
    "#6DC8EC", "#9270CA", "#FF9D4D", "#269A99", "#FF99C3",
]


class Tracker:
    """Experiment tracker — zero-config, non-blocking.

    Local mode (default):
        Direct PyO3 → Rust → SQLite. No HTTP, no server process.
        Start the UI with `trailer up`.

    Remote mode (TRAILER_HOST set):
        msgpack batch HTTP POST to trailer-server.

    Hardware monitoring (default on):
        Automatically collects CPU, memory, and GPU metrics every 5s
        in a background daemon thread. Data flows through the same
        RingBuffer pipeline as user metrics.
    """

    def __init__(
        self,
        project: str = "default",
        group: str | None = None,
        name: str | None = None,
        db_path: str = "trailer.db",
        storage: str | None = None,
        data_dir: str = "data",
        resume_from: str | None = None,
        auto_collect: bool = True,
        sweep_id: str | None = None,
        config: dict | None = None,
        metric_directions: dict | None = None,
        host: str | None = None,
        token: str | None = None,
    ):
        # 参数优先，环境变量兜底；host 为 None → 本地模式
        self._host = host or os.environ.get("TRAILER_HOST")
        self._token = token or os.environ.get("TRAILER_TOKEN")
        self.project = project
        self.sweep_id = sweep_id
        self.config = dict(config or {})
        # 指标方向声明(如 {"accuracy": "max", "my_score": "max"}),
        # 合并进 config,由 SummaryTap 读取后按方向计算 best
        if metric_directions:
            self.config["metric_directions"] = metric_directions
        self.run_id = resume_from or f"run_{os.urandom(6).hex()}"
        self._step: int = 0
        self._latest_step: int = 0  # 最新用户 step(硬件监控对齐用)
        # 硬件监控:step 驱动异步采样(每新 step 触发一次,对齐实验 step)+ 5s 时间兜底
        self._last_sampled_step: int = -1     # 最近已采样的 step(采样线程写)
        self._sample_requested_step: int = -1  # 主线程请求采样的 step
        self._sample_event = threading.Event()

        # If resuming, get last step from server
        if resume_from:
            host = self._host or "http://127.0.0.1:5120"
            import urllib.request as _req
            try:
                # Resume the run
                req = _req.Request(
                    f"{host.rstrip('/')}/api/v1/runs/{resume_from}/resume",
                    headers=self._auth_headers(),
                    method="POST",
                )
                _req.urlopen(req)
                # Get last step
                resp = _req.urlopen(
                    _req.Request(
                        f"{host.rstrip('/')}/api/v1/runs/{resume_from}/last_step",
                        headers=self._auth_headers(),
                    )
                )
                data = json.loads(resp.read())
                self._step = (data.get("last_step") or 0) + 1
            except Exception as e:
                print(f"Trailer: resume failed: {e}")

        # Select backend based on host (参数或环境变量)
        host = self._host
        if host:
            from trailer.backend import RemoteBackend
            self._backend = RemoteBackend(host=host, token=self._token)
            self._mode = "remote"
            self.storage = "server"
        else:
            try:
                from trailer.trailer import RustTracker
                # 存储类型：显式参数 > 环境变量 > 默认 SQLite
                storage = storage or os.environ.get("TRAILER_STORAGE")
                data_dir = data_dir or os.environ.get("TRAILER_DATA_DIR", "data")
                self.storage = storage or "sqlite"
                self._backend = LocalBackend(RustTracker(db_path, storage, data_dir))
                self._mode = "local"
                if self.storage == "file":
                    print(f"Trailer: 本地文件模式 → data_dir={data_dir}")
            except ImportError:
                self._backend = MockBackend()
                self._mode = "mock"
                self.storage = "mock"

        # Create run entry in the database
        try:
            name_str = name or self.run_id[:12]
            if self._mode == "local":
                self._backend._rust.create_run(self.run_id, self.project, name_str, self.sweep_id, json.dumps(self.config), 1)
            elif self._mode == "remote":
                import urllib.request as _ur
                body = json.dumps({"project": self.project, "name": name_str, "run_id": self.run_id, "sweep_id": self.sweep_id, "config": self.config}).encode()
                req = _ur.Request(f"{host.rstrip('/')}/api/v1/runs", data=body,
                    headers=self._auth_headers(), method="POST")
                _ur.urlopen(req, timeout=5)
        except Exception:
            pass  # Non-fatal — run will exist after first flush

        self._buffer = RingBuffer(maxlen=100_000)
        self._lock = threading.Lock()
        self._closed = False

        # Start background flush thread
        self._thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._thread.start()

        # Start background heartbeat thread(让服务端区分活跃与意外中断的 run)
        self._heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self._heartbeat_thread.start()

        # Start hardware monitoring (CPU, memory, GPU)
        self._monitor_running = False
        self._monitor_thread = None
        if auto_collect:
            self._start_monitor()

    def _auth_headers(self):
        """JSON content-type + 可选的 API token 鉴权头。"""
        headers = {"content-type": "application/json"}
        if self._token:
            headers["authorization"] = f"Bearer {self._token}"
        return headers

    def _start_monitor(self):
        """Start hardware monitoring daemon thread.

        Step-driven + 5s time fallback:
          - Each new user step wakes the thread to sample immediately, so the
            system-info chart shares the exact same x axis (step) as experiments.
          - When no new step arrives (long step / paused), fall back to sampling
            every 5s so long-running steps still get multiple snapshots.
        Runs alongside the flush thread; sampling is best-effort and never blocks log().
        """
        self._monitor_running = True

        def _loop():
            # 启动立即采样一次,让 step 0 起就有系统信息
            self._record_hardware_sample(self._latest_step)
            while self._monitor_running:
                self._sample_event.wait(timeout=5.0)
                self._sample_event.clear()
                # 优先采主线程请求的新 step;否则兜底采当前最新 step
                if self._sample_requested_step > self._last_sampled_step:
                    step = self._sample_requested_step
                else:
                    step = self._latest_step
                self._record_hardware_sample(step)

        self._monitor_thread = threading.Thread(target=_loop, daemon=True)
        self._monitor_thread.start()

    def _record_hardware_sample(self, step: int) -> None:
        """采集一次硬件快照并绑定到指定 step,写入 RingBuffer。

        与 _notify_step 配套:每个新 step 触发一次采样,保证系统信息图
        与实验指标图 x 轴(step)一致;采样点同时带 wall_time,前端可切时间轴。
        """
        try:
            from . import _rust as _r
            if _r is None:
                return
            raw = _r.sample_hardware()
            sample = json.loads(raw)
            ts = sample["timestamp"]

            # CPU + memory record
            mem_total = sample.get("memory_total_mb", 0)
            cpu_payload = {
                "system/cpu": sample["cpu_usage"],
                "system/mem_used": sample["memory_used_mb"],
            }
            if mem_total > 0:
                cpu_payload["system/mem_used_prop"] = sample["memory_used_mb"] / mem_total
            if sample.get("cpu_temp_c") is not None:
                cpu_payload["system/cpu/temperature"] = sample["cpu_temp_c"]
            if sample.get("cpu_power_w") is not None:
                cpu_payload["system/cpu/power"] = sample["cpu_power_w"]
            self._buffer.put({
                "kind": "metric",
                "run_id": self.run_id,
                "step": step,
                "wall_time": ts,
                "context": "",
                "payload": cpu_payload,
            })

            # Per-GPU records
            for gpu in sample.get("gpus", []):
                prefix = f"system/{gpu['vendor']}/gpu{gpu['index']}"
                payload = {}
                if gpu.get("gpu_util") is not None:
                    payload[f"{prefix}/util"] = gpu["gpu_util"]
                if gpu.get("mem_used_mb") is not None:
                    payload[f"{prefix}/mem_used"] = gpu["mem_used_mb"]
                    # Proportion: use GPU total if available, else system total (unified memory)
                    gpu_total = gpu.get("mem_total_mb")
                    if gpu_total and gpu_total > 0:
                        payload[f"{prefix}/mem_used_prop"] = gpu["mem_used_mb"] / gpu_total
                    elif mem_total > 0:
                        payload[f"{prefix}/mem_used_prop"] = gpu["mem_used_mb"] / mem_total
                if gpu.get("temp_c") is not None:
                    payload[f"{prefix}/temperature"] = gpu["temp_c"]
                if gpu.get("power_w") is not None:
                    payload[f"{prefix}/power"] = gpu["power_w"]
                if payload:
                    self._buffer.put({
                        "kind": "metric",
                        "run_id": self.run_id,
                        "step": step,
                        "wall_time": ts,
                        "context": f"{gpu['vendor']}/gpu{gpu['index']}",
                        "payload": payload,
                    })
            self._last_sampled_step = step
        except Exception:
            pass  # Silent degradation — don't crash training

    def _notify_step(self, step: int) -> None:
        """新 step 出现时唤醒采样线程立即采样,让系统信息与实验 step 对齐。"""
        if not self._monitor_running:
            return
        if step > self._last_sampled_step:
            self._sample_requested_step = step
            self._sample_event.set()

    def log(self, metrics: Dict[str, Any], step: int | None = None) -> None:
        """Record metrics at a step. Microsecond return."""
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)

        payload = {}
        for k, v in metrics.items():
            payload[k] = v  # msgpack will handle float/int

        record = {
            "kind": "metric",
            "run_id": self.run_id,
            "step": step,
            "wall_time": time.time(),
            "context": "",
            "payload": payload,
        }
        self._buffer.put(record)

    def log_histogram(
        self,
        values,
        name: str = "weights",
        step: int | None = None,
        bins: int = 24,
    ) -> None:
        """Record a weight/bias distribution histogram.

        Args:
            values: 1D array/tensor of values to histogram.
            name: Name for this histogram (e.g. 'layer1/weights').
            step: Global step.
            bins: Number of histogram buckets.
        """
        import numpy as _np
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)

        arr = _np.asarray(values, dtype=float)
        if arr.size == 0:
            return
        counts, edges = _np.histogram(arr, bins=bins)
        bucket_limits = edges[1:].tolist()
        bucket_counts = counts.tolist()

        record = {
            "kind": "histogram",
            "run_id": self.run_id,
            "step": step,
            "wall_time": time.time(),
            "context": "",
            "payload": {
                name: name,
                "min": float(arr.min()),
                "max": float(arr.max()),
                "num": int(arr.size),
                "sum": float(arr.sum()),
                "sum_squares": float((arr ** 2).sum()),
                "bucket_limits": bucket_limits,
                "bucket_counts": bucket_counts,
            },
        }
        self._buffer.put(record)

    def log_text(self, text: str, name: str = "default", step: int | None = None) -> None:
        """Record a text sample (LLM prompt/response, transcript)."""
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)
        if self._mode == "local":
            try:
                self._backend._rust.save_text(self.run_id, step, name, text)
            except Exception as e:
                print(f"Trailer: log_text failed: {e}")
        elif self._mode == "remote":
            import urllib.request as _ur
            host = self._host or "http://127.0.0.1:5120"
            payload = {"name": name, "body": text, "step": step}
            body = json.dumps(payload).encode()
            req = _ur.Request(f"{host.rstrip('/')}/api/v1/runs/{self.run_id}/texts",
                              data=body, headers=self._auth_headers(), method="POST")
            try:
                _ur.urlopen(req, timeout=10)
            except Exception as exc:
                print(f"Trailer: log_text failed: {exc}")
        else:
            record = {
                "kind": "text",
                "run_id": self.run_id,
                "step": step,
                "wall_time": time.time(),
                "context": "",
                "payload": {"name": name, "body": text},
            }
            self._buffer.put(record)

    def log_figure(
        self,
        fig,
        name: str = "figure",
        step: int | None = None,
    ) -> None:
        """Record a figure — matplotlib Figure or G2 chart spec dict.

        Dict specs are rendered on the frontend with G2.
        matplotlib Figures are saved as PNG (base64).
        Sends directly to the figures API endpoint (bypasses ingestion pipeline).
        """
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)

        if isinstance(fig, dict):
            kind = "g2"
            body = json.dumps(fig)
        else:
            kind = "png"
            import io as _io, base64 as _b64
            buf = _io.BytesIO()
            fig.savefig(buf, format="png")
            body = _b64.b64encode(buf.getvalue()).decode()

        if self._mode == "local":
            try:
                self._backend.save_figure(name, kind, body, step, self.run_id)
            except Exception as e:
                print(f"Trailer: log_figure failed: {e}")
        else:
            payload = {"name": name, "kind": kind, "body": body, "step": step}
            host = self._host or "http://127.0.0.1:5120"
            import urllib.request as _req
            data = json.dumps(payload).encode()
            req = _req.Request(
                f"{host.rstrip('/')}/api/v1/runs/{self.run_id}/figures",
                data=data, headers=self._auth_headers(), method="POST",
            )
            try:
                _req.urlopen(req, timeout=10)
            except Exception as exc:
                print(f"Trailer: log_figure failed: {exc}")

    def log_image(
        self,
        img,
        name: str = "image",
        step: int | None = None,
    ) -> None:
        """Record an image — file path, PIL Image, or numpy array.

        Converted to PNG and uploaded to the media API.
        """
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)

        if isinstance(img, str):
            # File path
            with open(img, "rb") as f:
                raw = f.read()
        else:
            # PIL Image or numpy array
            import io as _io, base64 as _b64
            buf = _io.BytesIO()
            img.save(buf, format="PNG")
            raw = buf.getvalue()

        self._post_media(name=name, kind="image", ext="png", data=raw, step=step)

    def log_video(
        self,
        path: str,
        name: str = "video",
        step: int | None = None,
    ) -> None:
        """Record a video file from disk."""
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)
        import base64 as _b64
        with open(path, "rb") as f:
            ext = path.rsplit(".", 1)[-1] if "." in path else "mp4"
            raw = f.read()
        self._post_media(name=name, kind="video", ext=ext, data=raw, step=step)

    def log_audio(
        self,
        path: str,
        name: str = "audio",
        step: int | None = None,
    ) -> None:
        """Record an audio file from disk."""
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)
        import base64 as _b64
        with open(path, "rb") as f:
            ext = path.rsplit(".", 1)[-1] if "." in path else "wav"
            raw = f.read()
        self._post_media(name=name, kind="audio", ext=ext, data=raw, step=step)

    def log_table(
        self,
        data,
        name: str = "table",
        step: int | None = None,
    ) -> None:
        """Record a table — pandas DataFrame or list of dicts.

        Converts to column names + array of rows JSON and POSTs to tables API.
        """
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)

        if hasattr(data, "to_dict"):
            # pandas DataFrame
            columns = list(data.columns)
            rows = [list(r) for r in data.to_numpy()]
        elif isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
            # list of dicts
            columns = list(data[0].keys())
            rows = [[r[c] for c in columns] for r in data]
        else:
            print("Trailer: log_table requires DataFrame or list[dict]")
            return

        if self._mode == "local":
            try:
                self._backend.save_table(name, columns, rows, step, self.run_id)
            except Exception as e:
                print(f"Trailer: log_table failed: {e}")
        else:
            payload = {"name": name, "columns": columns, "data": rows, "step": step}
            host = self._host or "http://127.0.0.1:5120"
            import urllib.request as _req
            body = json.dumps(payload).encode()
            req = _req.Request(
                f"{host.rstrip('/')}/api/v1/runs/{self.run_id}/tables",
                data=body, headers=self._auth_headers(), method="POST",
            )
            try:
                _req.urlopen(req, timeout=30)
            except Exception as exc:
                print(f"Trailer: log_table failed: {exc}")

    def log_model(
        self,
        model,
        name: str = "model",
        step: int | None = None,
        input_shape: tuple = (1, 128),
        trace: bool = False,
    ) -> None:
        """Record a PyTorch model architecture as an interactive Leafer graph.

        Uses the mviz engine to extract module hierarchy, parameter breakdowns,
        and (optionally) real tensor-flow edges via forward hooks.

        Args:
            model: PyTorch nn.Module instance.
            name: Name for this model snapshot.
            step: Global step (auto-increments if None).
            input_shape: Input tensor shape (batch, seq_len) for hook tracing.
            trace: If True, run a forward pass to capture real I/O shapes + edges.
        """
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)

        from trailer.model import extract_graph, save_graph as _sg
        import json, tempfile, os

        if trace:
            from trailer.model import trace_edges, attach_io, remap_edges
            import torch
            x = torch.randn(*input_shape)
            edges, io_map = trace_edges(model, x)
            graph = extract_graph(
                model, name=name, merge_repeats=True, edges=edges,
                input_spec=f"{input_shape}",
            )
            graph["edges"] = remap_edges(graph["tree"], edges)
            attach_io(graph["tree"], io_map)
            graph["meta"]["trace_mode"] = "hooks"
        else:
            graph = extract_graph(
                model, name=name, merge_repeats=True,
                input_spec=f"tensor {input_shape}",
            )

        body_str = json.dumps(graph)
        if self._mode == "local":
            try:
                self._backend.save_figure(name, "model", body_str, step, self.run_id)
            except Exception as e:
                print(f"Trailer: log_model failed: {e}")
        else:
            import urllib.request as _req
            host = self._host or "http://127.0.0.1:5120"
            payload = {"name": name, "kind": "model", "body": body_str, "step": step}
            data = json.dumps(payload).encode()
            req = _req.Request(
                f"{host.rstrip('/')}/api/v1/runs/{self.run_id}/figures",
                data=data, headers=self._auth_headers(), method="POST",
            )
            try:
                _req.urlopen(req, timeout=30)
            except Exception as exc:
                print(f"Trailer: log_model failed: {exc}")

    def log_embedding(
        self,
        vectors,
        metadata=None,
        name: str = "embedding",
        step: int | None = None,
    ) -> None:
        """Log high-dimensional vectors with PCA reduction to 2D for visualization.

        Args:
            vectors: 2D list/array of shape (n_samples, n_features)
            metadata: Optional list of labels for coloring points
            name: Name for the embedding visualization
        """
        import numpy as _np

        arr = _np.array(vectors, dtype=float)
        if arr.ndim != 2 or arr.shape[0] < 2:
            print("Trailer: log_embedding needs at least 2 vectors")
            return

        # PCA to 2D
        try:
            from sklearn.decomposition import PCA
            pca = PCA(n_components=2)
            coords = pca.fit_transform(arr)
            variance = pca.explained_variance_ratio_.sum()
        except ImportError:
            # Fallback: take first 2 columns
            coords = arr[:, :2] if arr.shape[1] >= 2 else _np.column_stack([arr[:, 0], _np.zeros(arr.shape[0])])
            variance = 0.0

        # Build scatter data
        labels = metadata if metadata else [f"p{i}" for i in range(arr.shape[0])]
        data = [{"x": float(coords[i, 0]), "y": float(coords[i, 1]), "label": str(labels[i])}
                for i in range(arr.shape[0])]

        g2_spec = {
            "type": "point",
            "data": data,
            "encode": {"x": "x", "y": "y", "color": "label"},
            "style": {"fillOpacity": 0.7, "size": 5},
            "axis": {"x": {"title": f"PC1 ({variance*100:.0f}% var)"},
                     "y": {"title": f"PC2 ({(1-variance)*100:.0f}% var)" if variance else "PC2"}},
        }

        # Reuse log_figure which handles local/remote mode
        self.log_figure(g2_spec, name=name, step=step)

    def log_pca(
        self,
        vectors,
        metadata=None,
        name: str = "pca",
        step: int | None = None,
        n_clusters: int | None = None,
    ) -> None:
        """把高维向量 PCA 降到 3 维并记录，前端用 Three.js 3D 散点展示。

        Args:
            vectors: (n_samples, n_features) 的 2D list/array；
                     也接受已按 {meta, points} 结构化的 dict（原样透传）。
            metadata: None → 用 k-means 自动聚类分簇；
                      list[str/int] → 逐样本簇标签（须与样本数一致）；
                      list[dict] 含 label/cluster 键 → 逐样本取标签；
                      dict 含 labels/cluster 键 → 同上。
            name: 图表名（前端按 name 分组卡片）。
            step: 全局 step（None 自动递增）。
            n_clusters: k-means 聚类数（仅 metadata 为 None 时生效）；None 自动推断。
        """
        if step is None:
            step = self._step
            self._step += 1
        self._latest_step = max(self._latest_step, step)
        self._notify_step(self._latest_step)

        if isinstance(vectors, dict) and "points" in vectors and "meta" in vectors:
            data = vectors                      # 已是 pca-viewer 格式，直接落库
        else:
            import numpy as _np
            arr = _np.asarray(vectors, dtype=float)
            if arr.ndim != 2 or arr.shape[0] < 2:
                print("Trailer: log_pca needs at least 2 vectors")
                return
            coords, explained = self._pca_3d(arr)
            labels = self._pca_labels(metadata, arr.shape[0])
            if labels is None:
                k = n_clusters or self._infer_n_clusters(arr.shape[0])
                labels = self._pca_kmeans(coords, k)
            data = self._build_pca_json(name, coords, explained, labels)

        body = json.dumps(data, ensure_ascii=False)
        if self._mode == "local":
            try:
                self._backend.save_figure(name, "pca", body, step, self.run_id)
            except Exception as e:
                print(f"Trailer: log_pca failed: {e}")
        else:
            import urllib.request as _req
            host = self._host or "http://127.0.0.1:5120"
            payload = {"name": name, "kind": "pca", "body": body, "step": step}
            data_b = json.dumps(payload).encode()
            req = _req.Request(
                f"{host.rstrip('/')}/api/v1/runs/{self.run_id}/figures",
                data=data_b, headers=self._auth_headers(), method="POST",
            )
            try:
                _req.urlopen(req, timeout=30)
            except Exception as exc:
                print(f"Trailer: log_pca failed: {exc}")

    def _pca_3d(self, arr):
        """降到 3 维。sklearn 缺失时用 numpy 特征分解兜底（与 gen_pca_data.py 同法）。"""
        import numpy as _np
        n, d = arr.shape
        k = max(1, min(3, d, n - 1))
        try:
            from sklearn.decomposition import PCA
            pca = PCA(n_components=k)
            coords = pca.fit_transform(arr)
            explained = list(pca.explained_variance_ratio_) + [0.0] * (3 - k)
        except ImportError:
            mean = arr.mean(axis=0)
            Xc = arr - mean
            cov = (Xc.T @ Xc) / max(n - 1, 1)
            vals, vecs = _np.linalg.eigh(cov)
            order = _np.argsort(vals)[::-1]
            vals, vecs = vals[order], vecs[:, order]
            coords = Xc @ vecs[:, :k]
            total = float(vals.sum()) or 1.0
            explained = (vals[:k] / total).tolist() + [0.0] * (3 - k)
        if coords.shape[1] < 3:
            coords = _np.hstack([coords, _np.zeros((coords.shape[0], 3 - coords.shape[1]))])
        return coords, explained[:3]

    def _pca_labels(self, metadata, n):
        """解析 metadata → 每样本簇标签；None 或长度不匹配返回 None（交由 k-means 聚类）。"""
        if metadata is None:
            return None
        labels = None
        if isinstance(metadata, dict):
            if "labels" in metadata:
                labels = metadata["labels"]
            elif "cluster" in metadata:
                labels = metadata["cluster"]
        elif isinstance(metadata, (list, tuple)):
            if len(metadata) == n and all(isinstance(x, (str, int, float)) for x in metadata):
                labels = metadata
            elif metadata and isinstance(metadata[0], dict):
                key = "label" if "label" in metadata[0] else ("cluster" if "cluster" in metadata[0] else None)
                if key:
                    labels = [d.get(key, "0") for d in metadata]
        if not labels or len(labels) != n:
            return None
        return [str(x) for x in labels]

    def _infer_n_clusters(self, n):
        """自动推断聚类数：min(8, max(2, round(√n)))。"""
        return max(2, min(8, int(round(n ** 0.5))))

    def _pca_kmeans(self, coords, n_clusters):
        """在 3D 坐标上 k-means 聚类（高维原始特征 O(n·d·k) 太慢）。sklearn 缺失时 numpy 手写兜底。"""
        import numpy as _np
        n = coords.shape[0]
        k = max(1, min(int(n_clusters), n))
        try:
            from sklearn.cluster import KMeans
            km = KMeans(n_clusters=k, n_init=10, random_state=0)
            labels = km.fit_predict(coords)
            return ["Cluster %d" % int(c) for c in labels]
        except ImportError:
            rng = _np.random.default_rng(0)
            idx = rng.choice(n, k, replace=False)
            centers = coords[idx].astype(float)
            labels = _np.zeros(n, dtype=int)
            for _ in range(100):
                dists = ((coords[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
                new_labels = _np.argmin(dists, axis=1)
                if _np.array_equal(new_labels, labels):
                    break
                labels = new_labels
                for j in range(k):
                    pts = coords[labels == j]
                    if len(pts) > 0:
                        centers[j] = pts.mean(axis=0)
            return ["Cluster %d" % int(c) for c in labels]

    def _build_pca_json(self, name, coords, explained, labels):
        """构建 pca-viewer 数据格式 {meta, points}。"""
        import numpy as _np
        n = coords.shape[0]
        from collections import OrderedDict
        counts = OrderedDict()
        for lab in labels:
            counts[lab] = counts.get(lab, 0) + 1
        clusters = [
            {"id": i, "label": lab, "color": DEFAULT_PCA_COLORS[i % len(DEFAULT_PCA_COLORS)], "count": c}
            for i, (lab, c) in enumerate(counts.items())
        ]
        axis_labels = ["PC%d (%.1f%%)" % (i + 1, explained[i] * 100) for i in range(3)]
        points = [
            {"x": float(coords[r, 0]), "y": float(coords[r, 1]), "z": float(coords[r, 2]), "cluster": labels[r]}
            for r in range(n)
        ]
        meta = {
            "title": name, "n_samples": n, "n_components": 3,
            "explained_variance": [float(v) for v in explained],
            "axis_labels": axis_labels, "clusters": clusters,
        }
        return {"meta": meta, "points": points}

    def _post_media(
        self,
        name: str,
        kind: str,
        ext: str,
        data: bytes,
        step: int,
    ) -> None:
        """Internal: upload media data to the API endpoint."""
        if self._mode == "local":
            try:
                self._backend.save_media(name, kind, ext, data, step, self.run_id)
            except Exception as e:
                print(f"Trailer: media failed: {e}")
            return
        import base64 as _b64
        payload = {
            "name": name, "kind": kind, "ext": ext,
            "data": _b64.b64encode(data).decode(), "step": step,
        }
        host = self._host or "http://127.0.0.1:5120"
        import urllib.request as _req
        body = json.dumps(payload).encode()
        req = _req.Request(
            f"{host.rstrip('/')}/api/v1/runs/{self.run_id}/media",
            data=body, headers=self._auth_headers(), method="POST",
        )
        try:
            _req.urlopen(req, timeout=30)
        except Exception as exc:
            print(f"Trailer: {kind} upload failed: {exc}")

    def _heartbeat_loop(self) -> None:
        """定期发送心跳(每 30s),让服务端能区分活跃与意外中断的 run。
        进程崩溃后心跳停止,服务端超时检查会把该 run 标记为 crashed。
        """
        while not self._closed:
            time.sleep(30)
            try:
                if self._mode == "local":
                    self._backend._rust.heartbeat(self.run_id)
                elif self._mode == "remote":
                    import urllib.request as _ur
                    host = self._host or "http://127.0.0.1:5120"
                    req = _ur.Request(
                        f"{host.rstrip('/')}/api/v1/runs/{self.run_id}/heartbeat",
                        headers=self._auth_headers(), method="POST",
                    )
                    _ur.urlopen(req, timeout=5)
            except Exception:
                pass  # 心跳失败不影响主流程

    def finish(self) -> None:
        """Shutdown: drain buffer, stop monitor + flush thread, mark run finished."""
        self._monitor_running = False
        # 唤醒采样线程,让最后一次 step 的采样完成后再退出,避免最后一步系统信息丢失
        self._sample_event.set()
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5)
        self._closed = True
        self._thread.join(timeout=5)
        # 标记 run 为 finished（本地 + 远程都要通知，否则心跳停止后服务端超时检查会标记 crashed）
        try:
            if self._mode == "local":
                self._backend._rust.finish_run(self.run_id)
            else:
                import urllib.request as _req
                host = self._host or "http://127.0.0.1:5120"
                req = _req.Request(
                    f"{host.rstrip('/')}/api/v1/runs/{self.run_id}/finish",
                    headers=self._auth_headers(), method="POST",
                )
                _req.urlopen(req, timeout=10)
        except Exception:
            pass

    def _flush_loop(self) -> None:
        """Background daemon: drain ring buffer and flush via backend."""
        while not self._closed or len(self._buffer) > 0:
            time.sleep(1.0)
            batch = self._buffer.pop_batch(500)
            if not batch:
                continue
            try:
                self._backend.flush(batch)
            except Exception as e:
                # Put items back on error (simple retry mechanism)
                for item in reversed(batch):
                    self._buffer.put(item)
                # Wait before retry
                time.sleep(2.0)
