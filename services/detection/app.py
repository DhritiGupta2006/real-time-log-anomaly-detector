"""Detection microservice: receives parsed events, ticks the engine, ships metrics to alerts."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from pydantic import BaseModel

from shared.config import Settings
from shared.logging_setup import setup_logging
from shared.models import LogEvent
from shared.tasks import TaskGroup, supervise

from .engine import DetectionEngine
from .sink import HttpMetricsSink

settings = Settings.from_env()
setup_logging(settings.log_level, "detection")
log = logging.getLogger("logpulse.detection")
engine = DetectionEngine(settings)
sink = HttpMetricsSink(settings.alerts_url)
tasks = TaskGroup()
state = {"last_tick": 0.0}


async def tick_loop() -> None:
    while True:
        try:
            m = engine.tick()
            state["last_tick"] = time.time()
            await sink(m)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("tick_failed")
        await asyncio.sleep(settings.tick_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks.spawn(supervise(tick_loop, "detector"), "detector")
    yield
    await tasks.stop()
    await sink.close()


app = FastAPI(title="LogPulse Detection Service", lifespan=lifespan)


class EventIn(BaseModel):
    ts: float
    level: str
    service: str = "-"


class Batch(BaseModel):
    events: list[EventIn]
    malformed: int = 0


@app.post("/events", status_code=202)
async def ingest(batch: Batch):  # async on purpose: shares the event loop thread with tick_loop
    engine.ingest([LogEvent(e.ts, e.level.upper(), e.service) for e in batch.events], batch.malformed)
    return {"accepted": len(batch.events)}


@app.get("/health")
def health(response: Response):
    age = time.time() - state["last_tick"] if state["last_tick"] else None
    ok = age is not None and age < settings.tick_seconds * 5
    if not ok:
        response.status_code = 503
    return {
        "status": "ok" if ok else "degraded",
        "service": "detection",
        "last_tick_age_s": age,
        "events_processed": engine.events_processed,
        "metrics_sent": sink.sent,
        "metrics_failed": sink.failures,
    }
