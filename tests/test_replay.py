"""Deterministic end-to-end replay tests on fixtures (IMPLEMENTATION_PLAN-2-2.md §7.4 and §13).

Feeds generated fixtures through DetectionEngine and AlertManager with an
injected clock to assert exact alert timeline outcomes without wall-clock sleep.
"""

from __future__ import annotations

from pathlib import Path

from services.alerts.manager import AlertManager
from services.detection.engine import DetectionEngine
from shared.config import Settings
from shared.models import LogEvent

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def parse_fixture_lines(filepath: Path) -> list[LogEvent]:
    events = []
    for line in filepath.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = line.strip().split()
        ts = float(parts[0])
        level = parts[1]
        svc = parts[2]
        events.append(LogEvent(ts=ts, level=level, service=svc))
    return events


def replay_fixture(
    fixture_name: str,
    settings: Settings | None = None,
    eval_interval: float = 1.0,
) -> list[dict]:
    s = settings or Settings()
    events = parse_fixture_lines(FIXTURES_DIR / fixture_name)
    engine = DetectionEngine(s)
    manager = AlertManager(confirm_ticks=3, resolve_ticks=3)

    if not events:
        return []

    t_start = int(events[0].ts)
    t_end = int(events[-1].ts) + 2

    # Group events by second
    by_sec: dict[int, list[LogEvent]] = {}
    for e in events:
        sec = int(e.ts)
        by_sec.setdefault(sec, []).append(e)

    all_alerts = []
    for current_t in range(t_start, t_end):
        sec_events = by_sec.get(current_t, [])
        engine.ingest(sec_events)
        m = engine.tick(now=float(current_t + 1))
        alert_events = manager.process(m)
        all_alerts.extend(alert_events)

    return all_alerts


def test_replay_healthy_fixture_produces_no_alerts():
    alerts = replay_fixture("healthy.log")
    opened = [a for a in alerts if a.type == "opened"]
    assert len(opened) == 0, f"Expected 0 alerts for healthy traffic, got {opened}"


def test_replay_noisy_normal_fixture_produces_no_alerts():
    alerts = replay_fixture("noisy_normal.log")
    opened = [a for a in alerts if a.type == "opened"]
    assert len(opened) == 0, f"Expected 0 alerts for noisy normal traffic, got {opened}"


def test_replay_spike_fixture_opens_and_resolves():
    alerts = replay_fixture("spike.log")
    opened = [a for a in alerts if a.type == "opened"]
    resolved = [a for a in alerts if a.type == "resolved"]

    assert len(opened) >= 1, "Expected spike to open an alert"
    assert opened[0].alert["peak_severity"] >= 3  # HIGH or CRITICAL
    assert len(resolved) >= 1, "Expected spike alert to resolve after recovery"


def test_replay_drift_fixture_triggers_ceiling():
    # Ceiling at 0.20 error rate triggers CRITICAL
    alerts = replay_fixture("drift.log", settings=Settings(rate_ceiling=0.20, ceiling_evals=3))
    opened = [a for a in alerts if a.type == "opened"]
    assert len(opened) >= 1, "Expected drift fixture to trigger alert"
    assert any(a.alert["peak_severity"] >= 3 for a in alerts)


def test_replay_silence_fixture_triggers_volume_drop():
    s = Settings(
        window_seconds=10.0,
        volume_min_expected_rps=0.5,
        volume_drop_ratio=0.20,
        volume_drop_evals=3,
    )
    alerts = replay_fixture("silence.log", settings=s)
    opened = [a for a in alerts if a.type == "opened"]
    assert len(opened) >= 1, "Expected volume drop during silence to open an alert"
