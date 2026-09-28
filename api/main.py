"""Modular monolith: monitoring + detection + alerts composed in ONE process via in-process calls.

The same classes run as separate services in services/*/app.py, connected over HTTP instead.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from services.alerts.routes import build_router
from services.alerts.service import AlertService
from services.detection.engine import DetectionEngine
from services.monitoring.service import MonitoringService
from shared.config import Settings
from shared.logging_setup import setup_logging
from shared.tasks import TaskGroup, supervise

log = logging.getLogger("logpulse.api")


def create_app(settings: Settings | None = None, run_pipeline: bool = True) -> FastAPI:
    s = settings or Settings.from_env()
    setup_logging(s.log_level, "monolith")
    alerts = AlertService(s)
    engine = DetectionEngine(s)

    async def on_events(events, stats):  # in-process "network hop" between monitoring and detection
        engine.ingest(events, stats["malformed"])

    monitor = MonitoringService(s.log_file, on_events)
    tasks = TaskGroup()
    state = {"last_tick": 0.0}

    async def tick_loop() -> None:
        while True:
            try:
                m = engine.tick()
                state["last_tick"] = time.time()
                await alerts.handle_metrics(m)  # in-process hop between detection and alerts
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("tick_failed")
            await asyncio.sleep(s.tick_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if run_pipeline:
            tasks.spawn(supervise(monitor.run, "monitor"), "monitor")
            tasks.spawn(supervise(tick_loop, "detector"), "detector")
        yield
        await tasks.stop()

    def health_extra() -> dict:
        if not run_pipeline:
            return {"pipeline": "disabled"}
        age = time.time() - state["last_tick"] if state["last_tick"] else None
        return {"ok": age is not None and age < s.tick_seconds * 5, "last_tick_age_s": age, **monitor.stats()}

    app = FastAPI(title="LogPulse (modular monolith)", lifespan=lifespan)
    app.include_router(build_router(alerts, s, "monolith", health_extra))
    app.state.alerts, app.state.engine, app.state.monitor = alerts, engine, monitor
    if os.path.isdir(s.frontend_dir):
        app.mount("/", StaticFiles(directory=s.frontend_dir, html=True), name="ui")
    return app


app = create_app()
