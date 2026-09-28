from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

log = logging.getLogger("logpulse.tasks")


async def supervise(factory: Callable[[], Awaitable[None]], name: str, delay: float = 1.0) -> None:
    """Run a long-lived loop and restart it if it ever crashes (detector-failure mitigation)."""
    while True:
        try:
            await factory()
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("task_crashed_restarting", extra={"ctx": {"task": name}})
            await asyncio.sleep(delay)


class TaskGroup:
    def __init__(self) -> None:
        self.tasks: list[asyncio.Task] = []

    def spawn(self, coro, name: str) -> None:
        self.tasks.append(asyncio.create_task(coro, name=name))

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()
