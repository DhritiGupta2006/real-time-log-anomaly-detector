import random

import pytest

from services.detection.baseline import Baseline
from services.detection.engine import DetectionEngine
from services.detection.severity import Thresholds, classify
from services.detection.window import SlidingWindow
from shared.models import LogEvent, Severity
from tests.helpers import settings, simulate


def test_sliding_window_rate_and_eviction():
    w = SlidingWindow(10)
    for i in range(10):
        w.add(100 + i, is_error=(i < 3))
    assert w.stats(110) == (10, 3, 0.3)
    total, errors, rate = w.stats(115)  # events at t=100..104 fall out (cutoff 105)
    assert (total, errors) == (5, 0) and rate == 0.0
    assert w.stats(200) == (0, 0, 0.0)


def test_sliding_window_is_bounded():
    w = SlidingWindow(1000, max_events=100)
    for i in range(500):
        w.add(i, True)
    assert w.stats(500)[0] == 100


def test_baseline_min_samples_and_std_floor():
    b = Baseline(max_samples=5, min_samples=3, min_std=0.01)
    assert not b.ready and b.std == 0.01
    for v in (0.02, 0.02, 0.02):
        b.add(v)
    assert b.ready and b.mean == pytest.approx(0.02) and b.std == 0.01  # flat data -> floor
    for v in (0.1, 0.1, 0.1, 0.1, 0.1):
        b.add(v)
    assert b.count == 5 and b.mean == pytest.approx(0.1)  # rolling


def test_severity_classification_and_configurable_thresholds():
    t = Thresholds()
    assert [classify(z, t) for z in (0.5, 1.0, 1.5, 2.5, 3.5, 5.0, 12)] == [
        Severity.NORMAL,
        Severity.NORMAL,
        Severity.LOW,
        Severity.MEDIUM,
        Severity.HIGH,
        Severity.CRITICAL,
        Severity.CRITICAL,
    ]
    strict = Thresholds(low=2, medium=4, high=6, critical=10)
    assert classify(3, strict) == Severity.LOW and classify(3.1, t) == Severity.HIGH


def test_no_alerts_while_baseline_warming_up():
    e = DetectionEngine(settings(baseline_min_samples=20))
    e.ingest([LogEvent(1000 + i / 50, "ERROR") for i in range(50)])  # 100% errors from the start
    m = e.tick(1001)
    assert m.status == "warming_up" and m.severity == 0


def test_minimum_window_events_protection():
    rng = random.Random(1)
    e = DetectionEngine(settings())
    _, _, t = simulate(e, None, 1000, 30, 20, 0.02, rng)
    assert e.baseline.ready
    e2 = DetectionEngine(settings())
    e2.baseline = e.baseline
    e2.ingest([LogEvent(t + 5, "ERROR"), LogEvent(t + 5.1, "ERROR")])  # 100% errors but only 2 events
    m = e2.tick(t + 6)
    assert m.status == "insufficient_data" and m.severity == 0


def test_normal_traffic_is_quiet_and_spike_is_critical():
    rng = random.Random(7)
    e = DetectionEngine(settings())
    _, ms, t = simulate(e, None, 1000, 90, 20, 0.02, rng)
    assert max(m.severity for m in ms) == 0
    mean_before = e.baseline.mean
    _, ms, t = simulate(e, None, t, 15, 20, 0.30, rng)
    assert ms[-1].severity == Severity.CRITICAL and ms[-1].z_score > 5
    assert ms[-1].status == "anomaly"
    assert e.baseline.mean == pytest.approx(mean_before, abs=0.005)  # spike did not poison the baseline


def test_baseline_freeze_and_cooldown():
    b = Baseline(max_samples=10, min_samples=3, cooldown_seconds=10.0)
    for _ in range(5):
        b.update_rate(0.02)
    assert b.count == 5 and not b.is_frozen()

    # Freeze instantly
    b.freeze()
    assert b.is_frozen()
    b.update_rate(0.50)  # should be ignored while frozen
    assert b.count == 5

    # Unfreeze starts cooldown
    b.unfreeze()
    # At t=100 (assuming unfreeze called recently), within cooldown
    assert b.is_frozen(now=0.0)  # early timestamp -> still in cooldown window
    # After cooldown elapsed
    assert not b.is_frozen(now=9999999999.0)


def test_volume_drop_detection():
    from services.detection.detector import DetectionState, Detector

    d = Detector()
    b = Baseline(min_samples=3)
    for _ in range(5):
        b.add(0.02)
    b.update_volume(20.0)  # expected volume = 20 rps
    assert b.expected_volume is not None

    # Normal traffic -> CLEAR
    det = d.evaluate_volume_drop(20.0, b)
    assert det.state == DetectionState.CLEAR

    # Severe volume drop (1.0 rps < 20% of 20 = 4.0 rps)
    # Needs volume_drop_evals (5) consecutive evaluations
    for _ in range(4):
        det = d.evaluate_volume_drop(1.0, b)
        assert det.state in (DetectionState.CLEAR, DetectionState.HOLD)

    det = d.evaluate_volume_drop(1.0, b)
    assert det.state == DetectionState.TRIGGERED
    assert det.severity == Severity.HIGH


def test_sustained_ceiling_trigger():
    e = DetectionEngine(settings(rate_ceiling=0.20, ceiling_evals=3))
    # Warm up baseline with 0.18 error rate
    for i in range(30):
        e.baseline.add(0.18)
    assert e.baseline.ready

    # Ingest 3 consecutive ticks with 0.25 error rate (>= ceiling 0.20)
    for tick_idx in range(3):
        e.ingest([LogEvent(1000 + tick_idx, "ERROR" if j < 25 else "INFO") for j in range(100)])
        m = e.tick(1000 + tick_idx + 1)

    assert m.severity == Severity.CRITICAL

