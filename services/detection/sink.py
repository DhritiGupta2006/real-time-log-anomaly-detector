from __future__ import annotations

import logging

import httpx

from shared.models import Metrics

log = logging.getLogger("logpulse.detection.sink")


class HttpMetricsSink:
    """Ships each tick to the alerts service. Never raises: detection must survive alert-service outages."""

    def __init__(self, base_url: str):
        self.client = httpx.AsyncClient(base_url=base_url, timeout=2.0)
        self.failures = 0
        self.sent = 0

    async def __call__(self, m: Metrics) -> None:
        try:
            r = await self.client.post("/internal/metrics", json=m.to_dict())
            r.raise_for_status()
            self.sent += 1
        except Exception as exc:
            self.failures += 1
            if self.failures <= 3 or self.failures % 60 == 0:
                log.warning("alerts_service_unreachable", extra={"ctx": {"failures": self.failures, "err": str(exc)}})

    async def close(self) -> None:
        await self.client.aclose()
