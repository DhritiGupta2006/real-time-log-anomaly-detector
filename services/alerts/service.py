"""AlertService: metrics in -> lifecycle/dedup -> WebSocket broadcast + async AWS delivery."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque

from shared.config import Settings
from shared.models import Metrics

from .hub import Hub
from .manager import AlertEvent, AlertManager
from .notifiers import AwsNotifier

log = logging.getLogger("logpulse.alerts")


class AlertService:
    def __init__(self, s: Settings, notifier: AwsNotifier | None = None, hub: Hub | None = None):
        self.s = s
        self.manager = AlertManager(s.confirm_ticks, s.resolve_ticks)
        self.notifier = notifier or AwsNotifier(s)
        self.hub = hub or Hub()
        self.latest: dict | None = None
        self.last_metrics_at = 0.0
        self.series: deque[dict] = deque(maxlen=300)
        self.deliveries: deque[dict] = deque(maxlen=40)
        self._tasks: set[asyncio.Task] = set()

    async def handle_metrics(self, m: Metrics) -> None:
        self.latest = m.to_dict()
        self.last_metrics_at = time.time()
        self.series.append(
            {k: self.latest[k] for k in ("ts", "error_rate", "baseline_mean", "threshold_low", "severity")}
        )
        await self.hub.broadcast({"type": "metrics", "data": self.latest})
        for ev in self.manager.process(m):
            log.info(
                f"alert_{ev.type}",
                extra={
                    "ctx": {
                        "alert_id": ev.alert["id"],
                        "severity": ev.alert["severity_name"],
                        "error_rate": round(ev.alert["error_rate"], 4),
                    }
                },
            )
            await self.hub.broadcast({"type": "alert", "event": ev.type, "alert": ev.alert})
            if ev.notify:  # AWS I/O runs off the detection path
                t = asyncio.create_task(self._deliver(ev))
                self._tasks.add(t)
                t.add_done_callback(self._tasks.discard)

    async def _deliver(self, ev: AlertEvent) -> None:
        try:
            results = await self.notifier.notify(ev)
        except Exception:
            log.exception("notify_failed")
            return
        for r in results:
            self.deliveries.appendleft(r)
            await self.hub.broadcast({"type": "delivery", "data": r})

    def snapshot(self) -> dict:
        return {
            "type": "snapshot",
            "server_time": time.time(),
            "metrics": self.latest,
            "series": list(self.series),
            "alerts": [a.to_dict() for a in self.manager.all_alerts()],
            "deliveries": list(self.deliveries),
            "aws": self.notifier.status(),
        }
