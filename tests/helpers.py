import random

from services.alerts.manager import AlertManager
from services.detection.engine import DetectionEngine
from shared.config import Settings
from shared.models import LogEvent


def simulate(
    engine: DetectionEngine,
    manager: AlertManager | None,
    t0: float,
    seconds: int,
    rps: int,
    err: float,
    rng: random.Random,
):
    """Feed `seconds` of traffic, tick once per second, return (alert events, metrics list, end time)."""
    events, metrics = [], []
    for sec in range(seconds):
        t = t0 + sec
        engine.ingest([LogEvent(t + i / rps, "ERROR" if rng.random() < err else "INFO") for i in range(rps)])
        m = engine.tick(t + 1)
        metrics.append(m)
        if manager:
            events += manager.process(m)
    return events, metrics, t0 + seconds


def settings(**kw) -> Settings:
    return Settings(**kw)
