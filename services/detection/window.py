from __future__ import annotations

from collections import deque


class SlidingWindow:
    """Time-based sliding window over (timestamp, is_error). Bounded so spikes can't exhaust memory."""

    def __init__(self, seconds: float, max_events: int = 500_000):
        self.seconds = seconds
        self.max_events = max_events
        self._q: deque[tuple[float, bool]] = deque()
        self._errors = 0

    def add(self, ts: float, is_error: bool) -> None:
        self._q.append((ts, is_error))
        self._errors += is_error
        if len(self._q) > self.max_events:
            self._errors -= self._q.popleft()[1]

    def evict(self, now: float) -> None:
        cutoff = now - self.seconds
        while self._q and self._q[0][0] < cutoff:
            self._errors -= self._q.popleft()[1]

    def stats(self, now: float) -> tuple[int, int, float]:
        """Return (total, errors, error_rate) for the window ending at `now`."""
        self.evict(now)
        total = len(self._q)
        return total, self._errors, (self._errors / total if total else 0.0)
