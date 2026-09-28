"""HTTP sink used when monitoring runs as its own service. Buffers when detection is down."""

from __future__ import annotations

import itertools
import logging
from collections import deque

import httpx

from shared.models import LogEvent

log = logging.getLogger("logpulse.monitoring.sink")


class HttpEventSink:
    def __init__(self, base_url: str, max_buffer: int = 100_000, batch: int = 5000):
        self.client = httpx.AsyncClient(base_url=base_url, timeout=2.0)
        self.buf: deque[LogEvent] = deque(maxlen=max_buffer)  # bounded: oldest dropped first
        self.batch = batch
        self.failures = 0
        self._last_malformed = -1

    async def __call__(self, events: list[LogEvent], stats: dict) -> None:
        self.buf.extend(events)
        malformed = stats.get("malformed", 0)
        if not self.buf and malformed == self._last_malformed:
            return
        while True:
            chunk = list(itertools.islice(self.buf, self.batch))
            payload = {
                "events": [{"ts": e.ts, "level": e.level, "service": e.service} for e in chunk],
                "malformed": malformed,
            }
            try:
                r = await self.client.post("/events", json=payload)
                r.raise_for_status()
            except Exception as exc:
                self.failures += 1
                if self.failures <= 3 or self.failures % 60 == 0:
                    log.warning(
                        "detection_unreachable_buffering", extra={"ctx": {"buffered": len(self.buf), "err": str(exc)}}
                    )
                return
            for _ in chunk:
                self.buf.popleft()
            self._last_malformed = malformed
            if not self.buf:
                return

    async def close(self) -> None:
        await self.client.aclose()
