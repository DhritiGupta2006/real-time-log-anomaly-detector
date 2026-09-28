from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from shared.models import LogEvent

from .parser import parse_line
from .tailer import LogTailer

log = logging.getLogger("logpulse.monitoring")

# sink(events, stats): in the monolith this is an in-process call to the detection engine;
# in microservices mode it is an HTTP client to the detection service.
EventSink = Callable[[list[LogEvent], dict], Awaitable[None]]


class MonitoringService:
    def __init__(self, path: str, sink: EventSink, poll_seconds: float = 0.25, from_start: bool = False):
        self.tailer = LogTailer(path, from_start=from_start)
        self.sink = sink
        self.poll_seconds = poll_seconds
        self.lines_read = 0
        self.events_parsed = 0
        self.malformed = 0

    def stats(self) -> dict:
        return {
            "lines_read": self.lines_read,
            "events_parsed": self.events_parsed,
            "malformed": self.malformed,
            "rotations": self.tailer.rotations,
        }

    async def poll_once(self) -> int:
        lines = self.tailer.read_new()
        events: list[LogEvent] = []
        for line in lines:
            if not line.strip():
                continue
            self.lines_read += 1
            ev = parse_line(line)
            if ev is None:
                self.malformed += 1
                if self.malformed <= 5 or self.malformed % 1000 == 0:
                    log.warning("malformed_log_line", extra={"ctx": {"count": self.malformed, "sample": line[:120]}})
            else:
                events.append(ev)
        self.events_parsed += len(events)
        if lines:
            await self.sink(events, self.stats())
        return len(events)

    async def run(self) -> None:
        log.info("monitor_started", extra={"ctx": {"path": self.tailer.path}})
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("monitor_poll_failed")  # keep tailing
            await asyncio.sleep(self.poll_seconds)
