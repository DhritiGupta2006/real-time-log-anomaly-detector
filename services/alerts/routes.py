"""Edge routes shared by the monolith and the alerts service (the dashboard-facing API)."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Literal

from fastapi import APIRouter, Response, WebSocket
from pydantic import BaseModel

from shared.config import Settings
from shared.control import read_mode, write_mode

from .service import AlertService


class SimRequest(BaseModel):
    mode: Literal["normal", "spike"]


def build_router(
    svc: AlertService, s: Settings, service_name: str, health_extra: Callable[[], dict] | None = None
) -> APIRouter:
    r = APIRouter()
    started = time.time()

    @r.get("/health")
    @r.get("/healthz")
    def health(response: Response):
        extra = health_extra() if health_extra else {}
        ok = extra.pop("ok", True)
        if not ok:
            response.status_code = 503
        return {
            "status": "ok" if ok else "degraded",
            "service": service_name,
            "uptime_s": round(time.time() - started, 1),
            "ws_clients": len(svc.hub.clients),
            **extra,
        }

    @r.get("/readyz")
    def readyz(response: Response):
        notifier_status = svc.notifier.status() if hasattr(svc, "notifier") else {}
        degraded = False
        if s.aws_enabled:
            # Check if any target has circuit open
            targets = notifier_status.get("targets", {})
            for data in targets.values():
                if data.get("circuit_open", False):
                    degraded = True
        return {
            "ready": True,
            "service": service_name,
            "degraded": degraded,
            "notifier_degraded": int(degraded),
            "aws_status": notifier_status,
        }

    @r.get("/metrics")
    def metrics():
        notifier_status = svc.notifier.status() if hasattr(svc, "notifier") else {}
        targets = notifier_status.get("targets", {})
        total_retries = sum(t.get("retries", 0) for t in targets.values())
        total_dlq = sum(t.get("dlq", 0) for t in targets.values())
        active_alerts = 1 if svc.manager.active else 0
        total_alerts = len(svc.manager.all_alerts())
        uptime = round(time.time() - started, 1)

        lines = [
            "# HELP logpulse_uptime_seconds Process uptime in seconds",
            "# TYPE logpulse_uptime_seconds gauge",
            f"logpulse_uptime_seconds {uptime}",
            "# HELP logpulse_ws_clients Number of connected WebSocket clients",
            "# TYPE logpulse_ws_clients gauge",
            f"logpulse_ws_clients {len(svc.hub.clients)}",
            "# HELP logpulse_alerts_active Current active alerts",
            "# TYPE logpulse_alerts_active gauge",
            f"logpulse_alerts_active {active_alerts}",
            "# HELP logpulse_alerts_total Cumulative alerts recorded",
            "# TYPE logpulse_alerts_total counter",
            f"logpulse_alerts_total {total_alerts}",
            "# HELP logpulse_aws_retries_total Cumulative AWS delivery retries",
            "# TYPE logpulse_aws_retries_total counter",
            f"logpulse_aws_retries_total {total_retries}",
            "# HELP logpulse_aws_dlq_total Cumulative notifications routed to DLQ",
            "# TYPE logpulse_aws_dlq_total counter",
            f"logpulse_aws_dlq_total {total_dlq}",
            "# HELP logpulse_notifier_degraded Indicator if notifier is in degraded state",
            "# TYPE logpulse_notifier_degraded gauge",
            f"logpulse_notifier_degraded {1 if any(t.get('circuit_open', False) for t in targets.values()) else 0}",
        ]
        return Response(content="\n".join(lines) + "\n", media_type="text/plain")

    @r.get("/api/state")  # stateless polling fallback; identical payload to the WS snapshot
    def state():
        return svc.snapshot()

    @r.get("/api/alerts")
    def alerts():
        return [a.to_dict() for a in svc.manager.all_alerts()]

    @r.get("/api/simulator")
    def sim_get():
        return {"mode": read_mode(s.control_file)}

    @r.post("/api/simulator")
    def sim_set(req: SimRequest):
        write_mode(s.control_file, req.mode)
        return {"mode": req.mode}

    @r.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await svc.hub.connect(ws, svc.snapshot())
        try:
            while True:
                await ws.receive_text()  # keeps the socket open; also detects client disconnects
        except Exception:
            pass
        finally:
            svc.hub.remove(ws)

    return r
