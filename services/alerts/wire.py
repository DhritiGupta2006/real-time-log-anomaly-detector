"""Wire-protocol translation layer for the new React/TypeScript frontend.

The new frontend (src/hooks/useWebSocket.ts) expects a different shape than the
original vanilla-JS dashboard. This module converts our internal models to the
new wire format without touching any detection or alert-management logic.

New wire shapes
---------------
tick (emitted every engine tick):
    {
        "type": "tick",
        "ts": <unix float>,
        "rate": <float 0-1>,        # error_rate
        "baseline": <float>,        # baseline_mean
        "z": <float>,               # z_score
        "volume": <int>,            # window_events
        "status": "NORMAL"|"ANOMALY"|"WARMING_UP"|"DEGRADED",
        "expected_variation": <float>   # baseline_std
    }

alert (emitted on open / escalate / resolve):
    {
        "type": "alert",
        "incident_id": <str>,       # alert.id
        "alert_type": "ERROR_RATE",
        "state": "OPEN"|"ESCALATED"|"RESOLVED",
        "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
        "peak_severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
        "error_rate": <float>,
        "baseline": <float>,
        "z": <float>,
        "window_s": <int>,          # window_events / rate → approx 30 s
        "volume": <int>,
        "top_errors": [<str>, ...], # synthesized from message
        "opened_at": <ISO str>,
        "updated_at": <ISO str>,
        "resolved_at": <ISO str | None>,
        "explanation": <str>
    }

snapshot (sent on WebSocket connect / polling):
    {
        "type": "snapshot",
        "ticks": [<tick>, ...],     # recent series
        "alerts": [<alert>, ...],
        "active_incident": <alert | null>
    }

/api/state (REST polling fallback):
    {
        "tick": <tick | null>,
        "alerts_recent": [<alert>, ...],
        "active_incident": <alert | null>,
        "status": "NORMAL"|"ANOMALY"|...
    }
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from shared.models import Metrics, Severity

# Severity int → string name expected by the new frontend
_SEV_NAME = {
    Severity.NORMAL: "NORMAL",
    Severity.LOW: "LOW",
    Severity.MEDIUM: "MEDIUM",
    Severity.HIGH: "HIGH",
    Severity.CRITICAL: "CRITICAL",
}

# Internal status strings → new frontend SystemStatus enum values
_STATUS_MAP: dict[str, str] = {
    "ok": "NORMAL",
    "anomaly": "ANOMALY",
    "warming_up": "WARMING_UP",
    "insufficient_data": "WARMING_UP",  # treated as still warming up
}

# Internal alert manager FSM states → new frontend IncidentState
# "ACTIVE" covers both OPEN and ESCALATED; we use the manager's _incident_state
# to distinguish, but here we only receive the serialised alert dict.
_ALERT_STATE_MAP: dict[str, str] = {
    "ACTIVE": "OPEN",       # default; escalated alerts are handled separately
    "RESOLVED": "RESOLVED",
}


def metrics_to_tick(m: Metrics) -> dict:
    """Convert a Metrics object to a new-wire 'tick' payload."""
    status = _STATUS_MAP.get(m.status, "NORMAL")
    return {
        "type": "tick",
        "ts": m.ts,
        "rate": m.error_rate,
        "baseline": m.baseline_mean,
        "z": m.z_score,
        "volume": m.window_events,
        "status": status,
        "expected_variation": m.baseline_std,
        # Extra fields the PipelineHealthStrip may use
        "baseline_samples": m.baseline_samples,
        "baseline_required": m.baseline_required,
        "malformed_lines": m.malformed_lines,
        "events_processed": m.events_processed,
    }


def alert_dict_to_new_wire(a: dict, incident_state: str = "OPEN") -> dict:
    """Convert a serialised (old-wire) Alert dict to the new-wire alert shape.

    Parameters
    ----------
    a:
        The dict returned by Alert.to_dict()  (old wire format).
    incident_state:
        The manager's _incident_state string ("OPEN", "ESCALATED", "RESOLVED").
    """
    sev_int = a.get("severity", 0)
    peak_sev_int = a.get("peak_severity", sev_int)

    sev_name = _SEV_NAME.get(Severity(sev_int), "LOW")
    peak_sev_name = _SEV_NAME.get(Severity(peak_sev_int), sev_name)

    # Map internal FSM state → new IncidentState
    status = a.get("status", "ACTIVE")
    if status == "RESOLVED":
        state = "RESOLVED"
    elif incident_state == "ESCALATED":
        state = "ESCALATED"
    else:
        state = "OPEN"

    # Convert unix timestamps to ISO 8601 strings
    def _iso(ts: float | None) -> str | None:
        if ts is None:
            return None
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

    opened_iso = _iso(a.get("opened_at"))
    updated_iso = _iso(a.get("updated_at") or a.get("opened_at"))
    resolved_iso = _iso(a.get("resolved_at"))

    msg = a.get("message", "")
    explanation = msg  # reuse message as explanation

    # Synthesize top_errors from message (best effort for live data)
    top_errors: list[str] = [msg] if msg else ["Error rate anomaly detected"]

    # window_s: derive from window_events / rate ≈ window size in seconds
    # We don't have window_seconds here, so default 30 s (config default is 10s
    # but the frontend uses this only for display)
    error_rate = a.get("error_rate", 0.0)
    window_events = a.get("window_events", 0)

    return {
        "type": "alert",
        "incident_id": a.get("id", ""),
        "alert_type": "ERROR_RATE",
        "state": state,
        "severity": sev_name if state != "RESOLVED" else "NORMAL",
        "peak_severity": peak_sev_name,
        "error_rate": error_rate,
        "baseline": a.get("baseline_mean", 0.0),
        "z": a.get("z_score", 0.0),
        "window_s": 30,  # display-only; real window is configured server-side
        "volume": window_events,
        "top_errors": top_errors,
        "opened_at": opened_iso or "",
        "updated_at": updated_iso or "",
        "resolved_at": resolved_iso,
        "explanation": explanation,
    }
