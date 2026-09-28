"""AlertService: metrics in -> lifecycle/dedup -> WebSocket broadcast + async AWS delivery.

Now emits the *new* wire protocol expected by the React/TypeScript frontend:
  - "tick" messages instead of "metrics"
  - "alert" messages with incident_id / state / ISO timestamps
  - "snapshot" with ticks[], alerts[], active_incident

See services/alerts/wire.py for the full translation spec.
"""

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
from .wire import alert_dict_to_new_wire, metrics_to_tick

log = logging.getLogger("logpulse.alerts")


class AlertService:
    def __init__(self, s: Settings, notifier: AwsNotifier | None = None, hub: Hub | None = None):
        self.s = s
        self.manager = AlertManager(s.confirm_ticks, s.resolve_ticks)
        self.notifier = notifier or AwsNotifier(s)
        self.hub = hub or Hub()
        self.latest_tick: dict | None = None   # new-wire tick dict
        self.latest_metrics: dict | None = None  # old-wire metrics dict (kept for /metrics endpoint)
        self.last_metrics_at = 0.0
        self.ticks: deque[dict] = deque(maxlen=300)      # new-wire tick dicts
        self.deliveries: deque[dict] = deque(maxlen=40)
        self._tasks: set[asyncio.Task] = set()

    async def handle_metrics(self, m: Metrics) -> None:
        # --- old-wire dict (for internal use / Prometheus) ---
        self.latest_metrics = m.to_dict()
        self.last_metrics_at = time.time()

        # --- new-wire tick ---
        tick = metrics_to_tick(m)
        self.latest_tick = tick
        self.ticks.append(tick)
        await self.hub.broadcast(tick)

        # --- alert processing (same as before; translate to new wire before broadcast) ---
        for ev in self.manager.process(m):
            log.info(
                f"alert_{ev.type}",
                extra={
                    "ctx": {
                        "alert_id": ev.alert.get("id"),
                        "severity": ev.alert.get("severity_name"),
                        "error_rate": round(ev.alert.get("error_rate", 0), 4),
                    }
                },
            )
            # Determine FSM state for translation
            incident_state = self.manager._incident_state  # "OPEN"|"ESCALATED"|"NORMAL"
            if ev.type == "resolved":
                incident_state = "RESOLVED"
            elif ev.type == "escalated":
                incident_state = "ESCALATED"
            elif ev.type in ("opened",):
                incident_state = "OPEN"

            new_wire_alert = alert_dict_to_new_wire(ev.alert, incident_state)
            await self.hub.broadcast(new_wire_alert)

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

    def _active_incident_wire(self) -> dict | None:
        """Return the active incident in new-wire format, or None."""
        a = self.manager.active
        if a is None:
            return None
        return alert_dict_to_new_wire(a.to_dict(), self.manager._incident_state)

    def snapshot(self) -> dict:
        """New-wire snapshot: sent to a browser on WebSocket connect and via /api/state."""
        all_alerts = [
            alert_dict_to_new_wire(a.to_dict(), "RESOLVED" if a.status == "RESOLVED" else self.manager._incident_state)
            for a in self.manager.all_alerts()
        ]
        return {
            "type": "snapshot",
            "server_time": time.time(),
            "ticks": list(self.ticks),
            "alerts": all_alerts,
            "active_incident": self._active_incident_wire(),
        }

    def state_for_polling(self) -> dict:
        """REST polling response (/api/state) matching the new frontend's pollState()."""
        tick = self.latest_tick
        status = tick["status"] if tick else "WARMING_UP"
        all_alerts = [
            alert_dict_to_new_wire(a.to_dict(), "RESOLVED" if a.status == "RESOLVED" else self.manager._incident_state)
            for a in self.manager.all_alerts()
        ]
        return {
            "tick": tick,
            "alerts_recent": all_alerts[:20],
            "active_incident": self._active_incident_wire(),
            "status": status,
        }

    # ---------------------------------------------------------------------- #
    #  Legacy helpers (kept for Prometheus /metrics endpoint)                 #
    # ---------------------------------------------------------------------- #

    def legacy_snapshot(self) -> dict:
        """Old-wire snapshot kept for backward compat with /metrics Prometheus scraping."""
        return {
            "type": "snapshot",
            "server_time": time.time(),
            "metrics": self.latest_metrics,
            "series": list(self.ticks),
            "alerts": [a.to_dict() for a in self.manager.all_alerts()],
            "deliveries": list(self.deliveries),
            "aws": self.notifier.status(),
        }
