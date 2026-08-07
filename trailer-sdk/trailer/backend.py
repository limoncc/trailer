"""Backend abstraction for the Trailer Tracker.

Three implementations:
- LocalBackend: PyO3 direct call to Rust → SQLite (no HTTP).
- RemoteBackend: httpx keep-alive POST to trailer-server.
- MockBackend: for tests.

Protocol is internal — users create a Tracker, not a Backend directly.
"""

from typing import Any, Dict, List, Protocol

import msgpack


class FlushBackend(Protocol):
    """Protocol that any backend (local/remote/mock) must satisfy."""

    def flush(self, batch: List[Dict[str, Any]]) -> None: ...


class MockBackend:
    """Test-only backend that counts flushed records."""

    def __init__(self):
        self.batches: List[List[Dict[str, Any]]] = []
        self.batch_count: int = 0
        self.total_items: int = 0

    def flush(self, batch: List[Dict[str, Any]]) -> None:
        self.batches.append(batch)
        self.batch_count += 1
        self.total_items += len(batch)


class LocalBackend:
    """PyO3-based backend — sends msgpack batches directly to Rust thread.

    Uses the RustTracker's log_batch() to push envelopes through the
    ingestion channel (mpsc) → Writer → SQLite or FileStorage
    (由 RustTracker 的 storage 参数决定), zero HTTP overhead.
    """

    def __init__(self, rust_module):
        self._rust = rust_module
        self.total_items: int = 0
        self.batch_count: int = 0

    def flush(self, batch: List[Dict[str, Any]]) -> None:
        try:
            payload = msgpack.packb(batch, use_bin_type=True)
            self._rust.log_batch(payload)
            self.total_items += len(batch)
            self.batch_count += 1
        except Exception as e:
            raise RuntimeError(f"LocalBackend flush failed: {e}")

    def save_figure(self, name: str, kind: str, body: str, step: int, run_id: str) -> None:
        self._rust.save_figure(name, kind, body, step, run_id)
        self.total_items += 1

    def save_table(self, name: str, columns: list, rows: list, step: int, run_id: str) -> None:
        import json
        self._rust.save_table(name, columns, json.dumps(rows), step, len(rows), run_id)
        self.total_items += 1

    def save_media(
        self, name: str, kind: str, ext: str, data: bytes, step: int,
        run_id: str, artifacts_dir: str = "artifacts",
    ) -> None:
        import os, hashlib
        # Write file to disk
        h = hashlib.sha256(data).hexdigest()[:16]
        rel = f"media/{run_id}/{name}_{step}_{h}.{ext}"
        abs_path = os.path.join(artifacts_dir, rel)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "wb") as f:
            f.write(data)
        self._rust.save_media(name, kind, ext, rel, len(data), step, run_id)
        self.total_items += 1


class RemoteBackend:
    """HTTP-based backend — POSTs msgpack batches to trailer-server.

    Endpoint: POST /api/v1/ingest
    Format:   application/x-msgpack (list of Envelope dicts)
    """

    def __init__(self, host: str = "http://127.0.0.1:5120", token: str | None = None):
        import os
        self._host = host.rstrip("/")
        self._token = token or os.environ.get("TRAILER_TOKEN")
        self._session = self._make_session()
        self.total_items: int = 0
        self.batch_count: int = 0

    @staticmethod
    def _make_session():
        try:
            import httpx
            return httpx.Client(
                base_url="",
                timeout=30.0,
                transport=httpx.HTTPTransport(retries=3),
            )
        except ImportError:
            raise ImportError(
                "RemoteBackend requires httpx: `pip install httpx`"
            )

    def flush(self, batch: List[Dict[str, Any]]) -> None:
        try:
            payload = msgpack.packb(batch, use_bin_type=True)
            headers = {"content-type": "application/x-msgpack"}
            if self._token:
                headers["authorization"] = f"Bearer {self._token}"
            resp = self._session.post(
                f"{self._host}/api/v1/ingest",
                content=payload,
                headers=headers,
                timeout=15.0,
            )
            resp.raise_for_status()
            self.total_items += len(batch)
            self.batch_count += 1
        except Exception as e:
            raise RuntimeError(f"RemoteBackend flush failed: {e}")

    def close(self) -> None:
        try:
            self._session.close()
        except Exception:
            pass
