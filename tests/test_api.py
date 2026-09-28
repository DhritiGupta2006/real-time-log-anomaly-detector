import asyncio

from fastapi.testclient import TestClient

from api.main import create_app
from services.alerts.app import app as alerts_app
from shared.control import read_mode
from tests.helpers import settings
from tests.test_alerts import M


def make(tmp_path):
    s = settings(control_file=str(tmp_path / "ctl.json"), frontend_dir=str(tmp_path / "none"), confirm_ticks=1)
    return create_app(s, run_pipeline=False), s


def test_health(tmp_path):
    app, _ = make(tmp_path)
    r = TestClient(app).get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok" and r.json()["service"] == "monolith"


def test_healthz_readyz_and_metrics(tmp_path):
    app, _ = make(tmp_path)
    c = TestClient(app)
    r_hz = c.get("/healthz")
    assert r_hz.status_code == 200 and r_hz.json()["status"] == "ok"

    r_rz = c.get("/readyz")
    assert r_rz.status_code == 200 and r_rz.json()["ready"] is True

    r_met = c.get("/metrics")
    assert r_met.status_code == 200 and "logpulse_uptime_seconds" in r_met.text


def test_state_alerts_and_websocket_snapshot(tmp_path):
    app, _ = make(tmp_path)
    asyncio.run(app.state.alerts.handle_metrics(M(3, 100)))
    c = TestClient(app)
    st = c.get("/api/state").json()
    assert st["metrics"]["severity"] == 3 and len(st["alerts"]) == 1
    assert c.get("/api/alerts").json()[0]["status"] == "ACTIVE"
    with c.websocket_connect("/ws") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot" and snap["alerts"][0]["severity_name"] in {
            "HIGH",
            "MEDIUM",
            "CRITICAL",
            "LOW",
        }


def test_simulator_control_roundtrip(tmp_path):
    app, s = make(tmp_path)
    c = TestClient(app)
    assert c.post("/api/simulator", json={"mode": "spike"}).json() == {"mode": "spike"}
    assert read_mode(s.control_file) == "spike" and c.get("/api/simulator").json()["mode"] == "spike"
    assert c.post("/api/simulator", json={"mode": "explode"}).status_code == 422


def test_alerts_microservice_endpoints():
    c = TestClient(alerts_app)
    assert c.get("/health").json()["service"] == "alerts"
    assert c.post("/internal/metrics", json=M(0, 1).to_dict()).status_code == 202
    assert c.post("/internal/metrics", json={"bogus": 1}).status_code == 422
