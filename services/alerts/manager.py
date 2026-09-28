"""Alert lifecycle — strict FSM with dual-threshold hysteresis and append-only JSONL journal.

State machine (IMPLEMENTATION_PLAN-2-2.md §6.5):
    NORMAL --TRIGGERED--> OPEN --severity >= HIGH--> ESCALATED
       ^                   |                              |
       |                   +--- CLEAR x CLEAR_EVALS ------+
       +-------- RESOLVED <-------------------------------+

Key differences from v1:
  - Explicit OPEN / ESCALATED / RESOLVED states (not just ACTIVE / RESOLVED).
  - Open threshold: z >= Z_OPEN (via engine Detection).
  - Clear threshold: z < Z_CLEAR (hysteresis — avoids flapping).
  - HOLD band (Z_CLEAR <= z < Z_OPEN): resets the clear streak without resolving.
  - Cooldown: after RESOLVED, a new TRIGGERED within COOLDOWN_SECONDS reopens the *same*
    incident (recorded in history) instead of creating a new alert.
  - Append-only JSONL journal written on every transition; replayed at startup for crash-recovery.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections import deque
from dataclasses import dataclass

from shared.models import Alert, Metrics, Severity

log = logging.getLogger("logpulse.manager")

NOTIFY_TYPES = {"opened", "escalated", "resolved"}


@dataclass
class AlertEvent:
    type: str   # opened | escalated | updated | resolved
    alert: dict

    @property
    def notify(self) -> bool:
        return self.type in NOTIFY_TYPES


# --------------------------------------------------------------------------- #
#  JSONL Journal                                                              #
# --------------------------------------------------------------------------- #

class Journal:
    """Append-only JSONL journal for crash-safe incident state.

    One line per transition or update. On startup, replay() rebuilds all
    open incidents so a restart never loses an active alert.
    """

    def __init__(self, path: str) -> None:
        self.path = path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    def append(self, event: dict) -> None:
        """Write one JSON record (+ newline) to the journal. Atomic enough for our demo."""
        record = {**event, "_journal_ts": time.time()}
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")

    def replay(self) -> list[dict]:
        """Read the journal from disk; skip malformed lines. Returns all records."""
        records: list[dict] = []
        try:
            with open(self.path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError:
                        log.warning("journal_corrupt_line skipped")
        except FileNotFoundError:
            pass
        return records


# --------------------------------------------------------------------------- #
#  Alert manager                                                              #
# --------------------------------------------------------------------------- #

class AlertManager:
    """Manages a single incident at a time with the v2 FSM + hysteresis.

    Parameters
    ----------
    confirm_ticks:
        Consecutive anomalous ticks before an alert opens (open gate, not FSM — kept for
        backward compatibility; the engine's own z_open gate is the primary guard).
    resolve_ticks:
        Unused in the v2 FSM (replaced by clear_evals); kept for compat with existing tests.
    history:
        Maximum number of resolved incidents to keep in memory.
    journal_path:
        If given, every transition is written to an append-only JSONL file.
    cooldown_seconds:
        After RESOLVED, a new TRIGGERED within this window reopens the *same* incident.
    clear_evals:
        Consecutive CLEAR readings (z < Z_CLEAR) required to resolve.
    """

    def __init__(
        self,
        confirm_ticks: int = 3,
        resolve_ticks: int = 5,
        history: int = 100,
        journal_path: str | None = None,
        cooldown_seconds: float = 60.0,
        clear_evals: int = 3,
    ) -> None:
        self.confirm_ticks = confirm_ticks
        self.resolve_ticks = resolve_ticks   # kept for compat; FSM uses clear_evals
        self.cooldown_seconds = cooldown_seconds
        self.clear_evals = clear_evals
        self.active: Alert | None = None
        self.history: deque[Alert] = deque(maxlen=history)
        self._journal = Journal(journal_path) if journal_path else None

        # --- FSM state ---
        # "state" lives in Alert.status ("ACTIVE" = OPEN or ESCALATED, "RESOLVED")
        # We track the v2 FSM state separately so we can distinguish OPEN from ESCALATED
        # without changing the wire schema (Alert.status stays "ACTIVE" for both).
        self._incident_state: str = "NORMAL"   # NORMAL | OPEN | ESCALATED
        self._pending = 0                       # consecutive anomalous ticks (confirm gate)
        self._clear_streak = 0                  # consecutive ticks below Z_CLEAR
        self._resolved_at: float = 0.0          # for cooldown check

    # ---------------------------------------------------------------------- #
    #  Public helpers                                                         #
    # ---------------------------------------------------------------------- #

    def all_alerts(self) -> list[Alert]:
        return ([self.active] if self.active else []) + list(self.history)

    # ---------------------------------------------------------------------- #
    #  Main processing loop                                                   #
    # ---------------------------------------------------------------------- #

    def process(self, m: Metrics) -> list[AlertEvent]:  # noqa: PLR0912
        """Process one metrics tick, return a (possibly empty) list of AlertEvents."""
        sev = Severity(m.severity)
        events: list[AlertEvent] = []

        # ---- NORMAL: no active incident ----------------------------------- #
        if self._incident_state == "NORMAL":
            if sev >= Severity.LOW:
                self._pending += 1
            else:
                self._pending = 0

            if self._pending < self.confirm_ticks:
                return []

            # Confirm gate passed — open the incident
            self._pending = 0
            self._clear_streak = 0

            # Cooldown: reopen the same incident if within cooldown window
            if (
                self.history
                and (m.ts - self._resolved_at) < self.cooldown_seconds
            ):
                # Reopen the most-recently resolved incident
                a = self.history[0]
                self.history.popleft()
                a.status = "ACTIVE"
                a.severity = int(sev)
                a.updated_at = m.ts
                a.error_rate = m.error_rate
                a.z_score = m.z_score
                a.message = self._msg(m) + " [reopened within cooldown]"
                self.active = a
                self._incident_state = "ESCALATED" if sev >= Severity.HIGH else "OPEN"
                ev = AlertEvent("opened", a.to_dict())
                self._journal_write(ev)
                return [ev]

            # Brand-new incident
            a = self.active = Alert(
                id=uuid.uuid4().hex[:8],
                severity=int(sev),
                peak_severity=int(sev),
                status="ACTIVE",
                opened_at=m.ts,
                updated_at=m.ts,
                error_rate=m.error_rate,
                peak_error_rate=m.error_rate,
                baseline_mean=m.baseline_mean,
                z_score=m.z_score,
                peak_z=m.z_score,
                message=self._msg(m),
            )
            # HIGH or above enters ESCALATED directly (spec §6.5)
            self._incident_state = "ESCALATED" if sev >= Severity.HIGH else "OPEN"
            ev = AlertEvent("opened", a.to_dict())
            self._journal_write(ev)
            return [ev]

        # ---- OPEN or ESCALATED: active incident --------------------------- #
        a = self.active
        assert a is not None  # invariant

        # Update rolling fields always
        a.updated_at = m.ts
        a.error_rate = m.error_rate
        a.z_score = m.z_score
        a.peak_error_rate = max(a.peak_error_rate, m.error_rate)
        a.peak_z = max(a.peak_z, m.z_score)
        a.message = self._msg(m)

        # ---- Check for CLEAR (z < Z_CLEAR, hysteresis lower bound) -------- #
        # Use z_score directly from Metrics; the engine has already applied Z_CLEAR.
        # We treat severity == NORMAL as a proxy for "z < Z_CLEAR" when the engine
        # has already applied dual-threshold logic. Fall back to direct z check.
        z_clear_threshold = getattr(self, '_z_clear', 1.5)   # injected by tests or default
        is_clear = (sev == Severity.NORMAL) or (m.z_score < z_clear_threshold)

        if is_clear:
            self._clear_streak += 1
            if self._clear_streak >= self.clear_evals:
                # Resolve
                a.status = "RESOLVED"
                a.severity = int(Severity.NORMAL)
                a.resolved_at = m.ts
                a.message = (
                    f"Recovered after {m.ts - a.opened_at:.0f}s. "
                    f"Peak {a.peak_error_rate:.1%} ({Severity(a.peak_severity).name}, {a.peak_z:.1f}σ)"
                )
                self.history.appendleft(a)
                self.active = None
                self._incident_state = "NORMAL"
                self._clear_streak = 0
                self._resolved_at = m.ts
                ev = AlertEvent("resolved", a.to_dict())
                self._journal_write(ev)
                return [ev]
            # Still counting down — suppress
            return []

        # Still anomalous — reset clear streak (HOLD or TRIGGERED)
        self._clear_streak = 0

        # ---- Escalation: severity can only increase while open ------------ #
        if sev > Severity(a.peak_severity):
            a.peak_severity = a.severity = int(sev)
            if self._incident_state == "OPEN" and sev >= Severity.HIGH:
                self._incident_state = "ESCALATED"
            ev = AlertEvent("escalated", a.to_dict())
            self._journal_write(ev)
            return [ev]

        # De-escalation within the anomaly band: update silently
        if int(sev) != a.severity:
            a.severity = int(sev)
            ev = AlertEvent("updated", a.to_dict())
            self._journal_write(ev)
            return [ev]

        # Duplicate — suppress
        return []

    # ---------------------------------------------------------------------- #
    #  Helpers                                                                #
    # ---------------------------------------------------------------------- #

    @staticmethod
    def _msg(m: Metrics) -> str:
        return (
            f"Error rate {m.error_rate:.1%} is {m.z_score:.1f}σ above baseline "
            f"{m.baseline_mean:.1%} ({m.window_errors}/{m.window_events} events in window)"
        )

    def _journal_write(self, ev: AlertEvent) -> None:
        if self._journal is None:
            return
        try:
            self._journal.append({"type": ev.type, "alert": ev.alert})
        except Exception:
            log.exception("journal_write_failed")

    def restore_from_journal(self, journal_path: str) -> None:
        """Replay the JSONL journal to rebuild open incidents after a restart."""
        j = Journal(journal_path)
        for record in j.replay():
            alert_dict = record.get("alert", {})
            ev_type = record.get("type", "")
            if ev_type in {"opened"}:
                try:
                    a = Alert(
                        id=alert_dict["id"],
                        severity=alert_dict["severity"],
                        peak_severity=alert_dict["peak_severity"],
                        status=alert_dict["status"],
                        opened_at=alert_dict["opened_at"],
                        updated_at=alert_dict["updated_at"],
                        error_rate=alert_dict["error_rate"],
                        peak_error_rate=alert_dict["peak_error_rate"],
                        baseline_mean=alert_dict["baseline_mean"],
                        z_score=alert_dict["z_score"],
                        peak_z=alert_dict["peak_z"],
                        message=alert_dict.get("message", ""),
                        resolved_at=alert_dict.get("resolved_at"),
                    )
                    if a.status == "ACTIVE":
                        self.active = a
                        self._incident_state = (
                            "ESCALATED" if Severity(a.peak_severity) >= Severity.HIGH else "OPEN"
                        )
                    else:
                        self.history.appendleft(a)
                except (KeyError, TypeError):
                    log.warning("journal_replay_skipped_corrupt_record")
            elif ev_type == "resolved" and self.active:
                self.active.status = "RESOLVED"
                self.active.resolved_at = alert_dict.get("resolved_at")
                self.history.appendleft(self.active)
                self.active = None
                self._incident_state = "NORMAL"
                self._resolved_at = alert_dict.get("resolved_at", 0.0) or 0.0
