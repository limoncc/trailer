"""stdout/stderr capture for the Trailer SDK.

Tees the process stdout and stderr to a ring buffer,
which is later flushed as log envelopes to the tracker.
"""

import sys
import threading
import time
from typing import Dict, List, Optional


class LogCapture:
    """Captures stdout/stderr lines to a ring buffer with rate limiting."""

    MAX_LINES_PER_SECOND = 200

    def __init__(self):
        self._buffer: List[Dict[str, str]] = []
        self._lock = threading.Lock()
        self._running = False
        self._orig_stdout: Optional[object] = None
        self._orig_stderr: Optional[object] = None
        self._dropped: int = 0
        self._line_count: int = 0
        self._last_reset = time.time()

    def start(self):
        if self._running:
            return
        self._running = True
        self._orig_stdout = sys.stdout
        self._orig_stderr = sys.stderr
        sys.stdout = _TeeWriter(self, "stdout")  # type: ignore
        sys.stderr = _TeeWriter(self, "stderr")  # type: ignore

    def stop(self):
        self._running = False
        if self._orig_stdout:
            sys.stdout = self._orig_stdout  # type: ignore
        if self._orig_stderr:
            sys.stderr = self._orig_stderr  # type: ignore

    def pop_lines(self) -> List[Dict[str, str]]:
        with self._lock:
            lines = list(self._buffer)
            self._buffer.clear()
            return lines

    def _write(self, text: str, stream: str):
        if not self._running:
            return

        now = time.time()
        with self._lock:
            # Rate limit reset every second
            if now - self._last_reset >= 1.0:
                self._line_count = 0
                self._last_reset = now

            if self._line_count >= self.MAX_LINES_PER_SECOND:
                self._dropped += 1
                if self._dropped % 200 == 1:
                    self._write_original(
                        f"[Trailer] Dropped ~{self._dropped} log lines (rate limit)\n",
                        "stderr",
                    )
                return

            self._line_count += 1
            for line in text.splitlines(True):
                self._buffer.append({
                    "stream": stream,
                    "ts": str(now),
                    "line": line.rstrip("\n"),
                })

    def _write_original(self, text: str, stream: str):
        target = self._orig_stdout if stream == "stdout" else self._orig_stderr
        if target:
            target.write(text)


class _TeeWriter:
    """A file-like object that tees writes to both the original stream and LogCapture."""

    def __init__(self, capture: LogCapture, stream_name: str):
        self._capture = capture
        self._stream = stream_name

    def write(self, text: str) -> int:
        self._capture._write(text, self._stream)
        self._capture._write_original(text, self._stream)
        return len(text)

    def flush(self):
        target = (
            self._capture._orig_stdout
            if self._stream == "stdout"
            else self._capture._orig_stderr
        )
        if target:
            target.flush()

    @property
    def encoding(self):
        return "utf-8"
