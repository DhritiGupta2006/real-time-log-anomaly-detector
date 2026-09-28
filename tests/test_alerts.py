import asyncio
import random

from services.alerts.manager import AlertManager
from services.alerts.notifiers import AwsNotifier
from services.alerts.service import AlertService
from services.detection.engine import DetectionEngine
from shared.models import Metrics, Severity
from tests.helpers import settings, simulate


def M(sev: int, ts: float, rate: float = 0.2) -> Metrics:
    return Metrics(
        ts=ts,
        error_rate=rate,
        window_events=200,
        window_errors=int(rate * 200),
        baseline_mean=0.02,
        baseline_std=0.01,
        baseline_samples=50,
        baseline_required=20,
        z_score=float(sev) * 2,
        severity=sev,
        status="anomaly" if sev else "ok",
        events_processed=1,
        malformed_lines=0,
        threshold_low=0.03,
        threshold_medium=0.04,
        threshold_high=0.05,
        threshold_critical=0.07,
    )


def run(mgr, seq):
    out = []
    for i, sev in enumerate(seq):
        out += [(e.type, e.alert) for e in mgr.process(M(sev, 100 + i))]
    return out


def test_single_tick_blip_never_alerts():
    assert run(AlertManager(confirm_ticks=3), [0, 3, 0, 3, 0, 3, 0]) == []


def test_dedup_escalation_and_resolution():
    mgr = AlertManager(confirm_ticks=2, resolve_ticks=3)
    out = run(mgr, [1, 1, 1, 1, 2, 2, 4, 4, 3, 0, 0, 1, 0, 0, 0])
    assert [t for t, _ in out] == ["opened", "escalated", "escalated", "updated", "updated", "resolved"]
    resolved = out[-1][1]
    assert resolved["status"] == "RESOLVED" and resolved["peak_severity_name"] == "CRITICAL"
    assert mgr.active is None and len(mgr.history) == 1


def test_oscillation_below_peak_is_not_renotified():
    mgr = AlertManager(confirm_ticks=1, resolve_ticks=3)
    out = run(mgr, [3, 2, 3, 2, 3])
    assert [t for t, _ in out] == ["opened", "updated", "updated", "updated", "updated"]
    assert not any(e.notify for e in mgr.process(M(3, 200)))


def test_full_pipeline_spike_then_resolve():
    rng = random.Random(3)
    e, mgr = DetectionEngine(settings()), AlertManager(3, 5)
    ev, _, t = simulate(e, mgr, 1000, 60, 20, 0.02, rng)
    assert ev == []
    ev, _, t = simulate(e, mgr, t, 20, 20, 0.35, rng)
    assert [x.type for x in ev] == ["opened"]  # a step change opens directly at its final severity
    assert mgr.active and mgr.active.peak_severity == Severity.CRITICAL
    ev, _, t = simulate(e, mgr, t, 40, 20, 0.02, rng)
    assert ev[-1].type == "resolved" and mgr.active is None


def test_notifier_disabled_skips_and_never_raises():
    n = AwsNotifier(settings(aws_enabled=False))
    ev = AlertManager(1, 1).process(M(4, 1))[0]
    res = asyncio.run(n.notify(ev))
    assert {r["status"] for r in res} == {"skipped"}


def test_aws_failure_is_contained_and_circuit_opens(monkeypatch):
    n = AwsNotifier(settings(aws_enabled=True, sns_topic_arn="arn:aws:sns:us-east-1:1:t"))

    def boom(name):
        raise RuntimeError("no route to AWS")

    monkeypatch.setattr(n, "_client", boom)
    ev = AlertManager(1, 1).process(M(4, 1))[0]
    for _ in range(3):
        res = asyncio.run(n.notify(ev))
        assert {r["status"] for r in res} == {"failed"}
    res = asyncio.run(n.notify(ev))
    assert {r["status"] for r in res} == {"skipped"} and "circuit" in res[0]["detail"]
    assert n.status()["targets"]["sns"]["failed"] == 3


def test_sns_respects_min_severity(monkeypatch):
    n = AwsNotifier(settings(aws_enabled=True, sns_topic_arn="arn", sns_min_severity="HIGH"))
    calls = []
    monkeypatch.setattr(n, "_publish_sns", lambda ev: calls.append(ev) or "ok")
    monkeypatch.setattr(n, "_put_cloudwatch", lambda ev: "ok")
    low = AlertManager(1, 1).process(M(1, 1))[0]
    res = {r["target"]: r["status"] for r in asyncio.run(n.notify(low))}
    assert res == {"cloudwatch": "sent", "sns": "skipped"} and not calls


def test_alert_service_survives_aws_outage_and_broadcasts(monkeypatch):
    svc = AlertService(settings(aws_enabled=True, sns_topic_arn="arn", confirm_ticks=1))
    monkeypatch.setattr(svc.notifier, "_client", lambda n: (_ for _ in ()).throw(RuntimeError("down")))

    async def go():
        for i in range(3):
            await svc.handle_metrics(M(3, 100 + i))
        await asyncio.gather(*list(svc._tasks))

    asyncio.run(go())
    assert svc.manager.active is not None
    assert any(d["status"] == "failed" for d in svc.deliveries)


def test_gradual_ramp_escalates_through_severities():
    rng = random.Random(5)
    e, mgr = DetectionEngine(settings()), AlertManager(3, 5)
    _, _, t = simulate(e, mgr, 1000, 60, 20, 0.02, rng)
    ev = []
    for err in (0.05, 0.08, 0.12, 0.30):
        out, _, t = simulate(e, mgr, t, 5, 20, err, rng)
        ev += out
    kinds = [x.type for x in ev]
    assert kinds[0] == "opened" and "escalated" in kinds
    sevs = [x.alert["severity"] for x in ev if x.type in ("opened", "escalated")]
    assert sevs == sorted(sevs) and sevs[-1] > sevs[0]
