"""Non-blocking ring buffer for the Trailer SDK.

Design:
- Single deque with a threading lock (simpler than double-buffer swap).
- put() pushes to the right; pop_batch() drains from the left.
- maxlen controls the deque capacity — excess items trigger a warning.
- Thread-safe via threading.Lock.

P99 append latency target: < 10us (memory-only, no I/O).
"""

import threading
import warnings
from collections import deque
from typing import Any, Dict, List


class RingBuffer:
    """Thread-safe bounded FIFO buffer for metric records."""

    def __init__(self, maxlen: int = 100_000):
        self._buf: deque[Dict[str, Any]] = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self._dropped: int = 0

    def put(self, record: Dict[str, Any]) -> None:
        """Push a record into the buffer. Microsecond-level return.

        If maxlen is reached, the oldest item is silently discarded
        and a warning is emitted once per batch of drops.
        """
        with self._lock:
            was_full = len(self._buf) == self._buf.maxlen
            self._buf.append(record)
            if was_full:
                self._dropped += 1
                if self._dropped % 1000 == 1:
                    warnings.warn(
                        f"Trailer RingBuffer full ({self._buf.maxlen} items). "
                        f"Dropped ~{self._dropped} oldest records. "
                        "Increase maxlen or check network.",
                        stacklevel=2,
                    )

    def pop_batch(self, n: int) -> List[Dict[str, Any]]:
        """Extract up to n oldest records as a batch."""
        with self._lock:
            count = min(n, len(self._buf))
            batch = [self._buf.popleft() for _ in range(count)]
            return batch

    def __len__(self) -> int:
        with self._lock:
            return len(self._buf)

    @property
    def dropped(self) -> int:
        with self._lock:
            return self._dropped
