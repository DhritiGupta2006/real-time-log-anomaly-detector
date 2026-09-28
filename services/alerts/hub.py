from __future__ import annotations

import asyncio
import logging

from fastapi import WebSocket

log = logging.getLogger("logpulse.hub")


class Hub:
    """WebSocket fan-out. Slow or dead clients are dropped, never allowed to block the pipeline."""

    def __init__(self, send_timeout: float = 2.0):
        self.clients: set[WebSocket] = set()
        self.send_timeout = send_timeout

    async def connect(self, ws: WebSocket, snapshot: dict) -> None:
        await ws.accept()
        await ws.send_json(snapshot)  # full state first, so reconnects never show stale data
        self.clients.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def _send(self, ws: WebSocket, payload: dict) -> bool:
        try:
            await asyncio.wait_for(ws.send_json(payload), self.send_timeout)
            return True
        except Exception:
            return False

    async def broadcast(self, payload: dict) -> None:
        if not self.clients:
            return
        clients = list(self.clients)
        results = await asyncio.gather(*(self._send(c, payload) for c in clients))
        for c, ok in zip(clients, results, strict=True):
            if not ok:
                self.clients.discard(c)
