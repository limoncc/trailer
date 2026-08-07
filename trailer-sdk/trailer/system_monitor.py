"""System metrics monitor for Trailer SDK.

Samples GPU utilization/memory (via pynvml) and CPU/memory (via psutil)
on a configurable interval. Runs in a background daemon thread.
"""

import threading
import time
from typing import Any, Dict, List, Optional


class SystemMonitor:
    """Background daemon thread that samples system metrics."""

    def __init__(self, interval: float = 5.0):
        self._interval = interval
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._buffer: List[Dict[str, Any]] = []
        self._lock = threading.Lock()

        # Try to import GPU monitoring module
        self._pynvml = None
        try:
            import pynvml
            pynvml.nvmlInit()
            self._gpu_count = pynvml.nvmlDeviceGetCount()
            self._pynvml = pynvml
        except Exception:
            self._gpu_count = 0

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=self._interval * 2)

    def pop_records(self) -> List[Dict[str, Any]]:
        with self._lock:
            records = list(self._buffer)
            self._buffer.clear()
            return records

    def _loop(self):
        while self._running:
            records = self._sample()
            with self._lock:
                self._buffer.extend(records)
            time.sleep(self._interval)

    def _sample(self) -> List[Dict[str, Any]]:
        timestamp = time.time()
        records = []

        # GPU metrics (via pynvml)
        if self._pynvml:
            for i in range(self._gpu_count):
                try:
                    handle = self._pynvml.nvmlDeviceGetHandleByIndex(i)
                    util = self._pynvml.nvmlDeviceGetUtilizationRates(handle)
                    mem = self._pynvml.nvmlDeviceGetMemoryInfo(handle)
                    temp = self._pynvml.nvmlDeviceGetTemperature(handle, self._pynvml.NVML_TEMPERATURE_GPU)
                    records.append({
                        "kind": "metric",
                        "run_id": "__system__",
                        "step": 0,
                        "wall_time": timestamp,
                        "context": f"gpu{i}",
                        "payload": {
                            f"system/gpu_util": float(util.gpu) / 100.0,
                            f"system/gpu_mem_used": mem.used / (1024 * 1024),
                            f"system/gpu_temp": float(temp),
                        },
                    })
                except Exception:
                    pass

        # CPU/memory (built-in, no extra deps)
        try:
            import psutil
            cpu = psutil.cpu_percent(interval=None) / 100.0
            mem_info = psutil.virtual_memory()
            records.append({
                "kind": "metric",
                "run_id": "__system__",
                "step": 0,
                "wall_time": timestamp,
                "context": "",
                "payload": {
                    "system/cpu": cpu,
                    "system/mem_used": mem_info.used / (1024 * 1024),
                    "system/mem_total": mem_info.total / (1024 * 1024),
                },
            })
        except ImportError:
            pass

        return records

    def shutdown_nvml(self):
        if self._pynvml:
            try:
                self._pynvml.nvmlShutdown()
            except Exception:
                pass
