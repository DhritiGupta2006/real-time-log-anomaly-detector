"""Monitoring microservice: tails the log and ships parsed events to the detection service."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from shared.config import Settings
from shared.logging_setup import setup_logging
from shared.tasks import TaskGroup, supervise

from .service import MonitoringService
from .sink import HttpEventSink

settings = Settings.from_env()
setup_logging(settings.log_level, "monitoring")
sink = HttpEventSink(settings.detection_url)
monitor = MonitoringService(settings.log_file, sink)
tasks = TaskGroup()


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks.spawn(supervise(monitor.run, "monitor"), "monitor")
    yield
    await tasks.stop()
    await sink.close()


app = FastAPI(title="LogPulse Monitoring Service", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "monitoring",
        **monitor.stats(),
        "buffered": len(sink.buf),
        "send_failures": sink.failures,
    }
