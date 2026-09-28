"""Detection engine: sliding window → EWMA/MAD baseline → z-score + volume_drop → severity.

Key changes from v1 (IMPLEMENTATION_PLAN-2-2.md §6.2 and §6.3):
  - Baseline freeze is DETECTOR-LOCAL: the engine freezes the baseline the instant a raw gate
    is breached, without waiting for the alert manager's FSM confirmation.
  - Dual-threshold hysteresis: open on z >= Z_OPEN; clear only when z < Z_CLEAR.
  - VOLUME_DROP signal: fires HIGH when log volume < 20% of expected for 5 consecutive ticks.
  - Sustained ceiling: TRIGGERED regardless of z when rate >= RATE_CEILING for CEILING_EVALS ticks.
"""

from __future__ import annotations

import time
from collections.abc import Iterable

from shared.config import Settings
from shared.models import LogEvent, Metrics, Severity

from .baseline import Baseline
from .severity import Thresholds, classify
from .window import SlidingWindow


class DetectionEngine:
    def __init__(self, s: Settings):
        self.s = s
        self.window = SlidingWindow(s.window_seconds)
        self.baseline = Baseline(
            max_samples=s.baseline_max_samples,
            min_samples=s.baseline_min_samples,
            ewma_alpha=s.ewma_alpha,
            sigma_floor=s.sigma_floor,
            cooldown_seconds=s.baseline_cooldown_seconds,
        )
        self.thresholds = Thresholds(s.sigma_low, s.sigma_medium, s.sigma_high, s.sigma_critical)
        self.events_processed = 0
        self.malformed = 0

        # --- hysteresis state ---
        self._clear_streak = 0  # consecutive CLEAR ticks (below Z_CLEAR)
        self._ceiling_streak = 0  # consecutive ticks above RATE_CEILING
        self._anomaly_open = False  # True while the engine considers an anomaly active

        # --- volume-drop state ---
        self._vol_low_streak = 0  # consecutive ticks with low volume
        self._vol_drop_active = False  # True while volume-drop alert is open

    # ---------------------------------------------------------------------- #
    #  Ingest                                                                 #
    # ---------------------------------------------------------------------- #

    def ingest(self, events: Iterable[LogEvent], malformed: int | None = None) -> None:
        n = 0
        for e in events:
            self.window.add(e.ts, e.is_error)
            n += 1
        self.events_processed += n
        if malformed is not None:
            self.malformed = malformed

    # ---------------------------------------------------------------------- #
    #  Tick                                                                   #
    # ---------------------------------------------------------------------- #

    def tick(self, now: float | None = None) -> Metrics:  # noqa: PLR0912, PLR0915
        now = time.time() if now is None else now
        total, errors, rate = self.window.stats(now)
        sufficient = total >= self.s.min_window_events
        ready = self.baseline.ready
        mean = self.baseline.mean
        std = self.baseline.std

        # ------------------------------------------------------------------ #
        #  1. Compute z-score and candidate severity                          #
        # ------------------------------------------------------------------ #
        z, sev = 0.0, Severity.NORMAL

        # --- sustained ceiling check (independent of z) ---
        if sufficient and rate >= self.s.rate_ceiling:
            self._ceiling_streak += 1
        else:
            self._ceiling_streak = 0

        ceiling_triggered = self._ceiling_streak >= self.s.ceiling_evals

        if ready and sufficient:
            z = (rate - mean) / std

            # z-gate with absolute-change guard
            if z >= self.s.z_open and (rate - mean) >= self.s.min_delta:
                sev = classify(z, self.thresholds)
            elif ceiling_triggered:
                # Slow drift absorbed the baseline — ceiling catches what z missed
                sev = Severity.CRITICAL
            else:
                sev = Severity.NORMAL

        # ------------------------------------------------------------------ #
        #  2. Detector-local baseline freeze (spec §6.2 — headline differentiator)
        #
        #  Freeze as soon as the raw gate is breached, BEFORE consecutive-
        #  evaluation confirmation. This stops the baseline absorbing the first
        #  evaluations of an incident.
        # ------------------------------------------------------------------ #
        gate_breached = ready and sufficient and (z >= self.s.z_open or ceiling_triggered)

        if gate_breached:
            if not self._anomaly_open:
                self._anomaly_open = True
                self._clear_streak = 0
            self.baseline.freeze()

        # ------------------------------------------------------------------ #
        #  3. Hysteresis clear logic (spec §6.3)                             #
        #                                                                     #
        #  Clear only when z < Z_CLEAR (not just < Z_OPEN).                  #
        #  HOLD (Z_CLEAR ≤ z < Z_OPEN) resets the clear streak.              #
        # ------------------------------------------------------------------ #
        if self._anomaly_open:
            below_clear = ready and sufficient and z < self.s.z_clear and not ceiling_triggered
            if below_clear:
                self._clear_streak += 1
                if self._clear_streak >= self.s.clear_evals:
                    # Transition to CLEAR; start post-incident cooldown
                    self._anomaly_open = False
                    self._clear_streak = 0
                    self.baseline.unfreeze()
            else:
                # Still in HOLD or TRIGGERED — reset the clear streak
                self._clear_streak = 0

        # ------------------------------------------------------------------ #
        #  4. Baseline rate update (only when not frozen and data is good)    #
        # ------------------------------------------------------------------ #
        if sufficient:
            # Pass frozen check into baseline; it is a no-op while frozen.
            self.baseline.update_rate(rate, volume_sufficient=True)

        # ------------------------------------------------------------------ #
        #  5. Volume-drop signal (spec §6.3)                                  #
        # ------------------------------------------------------------------ #
        vol_sev = self._evaluate_volume_drop(now, total)

        # Freeze baseline on volume-drop suspicion too
        if vol_sev > Severity.NORMAL and not self.baseline.frozen:
            self.baseline.freeze()

        # Merge: take the higher severity between rate and volume signals
        effective_sev = max(sev, vol_sev)

        # ------------------------------------------------------------------ #
        #  6. Status string                                                   #
        # ------------------------------------------------------------------ #
        if not ready:
            status = "warming_up"
        elif not sufficient:
            status = "insufficient_data"
        elif effective_sev > Severity.NORMAL:
            status = "anomaly"
        else:
            status = "ok"

        # ------------------------------------------------------------------ #
        #  7. Build threshold lines for the chart                             #
        # ------------------------------------------------------------------ #
        t = self.thresholds
        return Metrics(
            ts=now,
            error_rate=rate,
            window_events=total,
            window_errors=errors,
            baseline_mean=mean,
            baseline_std=std,
            baseline_samples=self.baseline.count,
            baseline_required=self.s.baseline_min_samples,
            z_score=z,
            severity=int(effective_sev),
            status=status,
            events_processed=self.events_processed,
            malformed_lines=self.malformed,
            threshold_low=mean + t.low * std,
            threshold_medium=mean + t.medium * std,
            threshold_high=mean + t.high * std,
            threshold_critical=mean + t.critical * std,
        )

    # ---------------------------------------------------------------------- #
    #  Volume-drop helper                                                     #
    # ---------------------------------------------------------------------- #

    def _evaluate_volume_drop(self, _now: float, window_total: int) -> Severity:
        """Evaluate the VOLUME_DROP signal.

        Returns Severity.HIGH when the volume has been below 20% of expected
        for VOLUME_DROP_EVALS consecutive ticks; Severity.NORMAL otherwise.
        """
        if not self.baseline.ready:
            return Severity.NORMAL

        current_rps = window_total / self.s.window_seconds if self.s.window_seconds > 0 else 0.0
        expected = self.baseline.expected_volume

        if expected is None:
            self.baseline.update_volume(current_rps)
            return Severity.NORMAL

        if expected < self.s.volume_min_expected_rps:
            # Quiet-service guard: don't alert on naturally low-traffic services
            self.baseline.update_volume(current_rps)
            return Severity.NORMAL

        if current_rps < self.s.volume_drop_ratio * expected:
            self._vol_low_streak += 1
            if self._vol_low_streak >= self.s.volume_drop_evals:
                self._vol_drop_active = True
                return Severity.HIGH
        elif current_rps >= self.s.volume_drop_clear_ratio * expected:
            # Recovered above the clear threshold
            self._vol_low_streak = 0
            self._vol_drop_active = False
            self.baseline.update_volume(current_rps)
        # else: HOLD band — maintain streak without incrementing

        return Severity.HIGH if self._vol_drop_active else Severity.NORMAL
