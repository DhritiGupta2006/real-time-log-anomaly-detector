"""Alerts microservice: alert lifecycle, AWS delivery and the dashboard WebSocket/REST edge."""

import time

from fastapi import FastAPI, HTTPException

from shared.config import Settings
from shared.logging_setup import setup_logging
from shared.models import Metrics

from .routes import build_router
from .service import AlertService

settings = Settings.from_env()
setup_logging(settings.log_level, "alerts")
svc = AlertService(settings)

app = FastAPI(title="LogPulse Alert Service")
app.include_router(
    build_router(
        svc,
        settings,
        "alerts",
        health_extra=lambda: {
            "last_metrics_age_s": (time.time() - svc.last_metrics_at) if svc.last_metrics_at else None
        },
    )
)


@app.post("/internal/metrics", status_code=202)
async def metrics(payload: dict):
    try:
        m = Metrics.from_dict(payload)
    except TypeError as exc:
        raise HTTPException(422, f"invalid metrics payload: {exc}") from exc
    await svc.handle_metrics(m)
    return {"ok": True}
