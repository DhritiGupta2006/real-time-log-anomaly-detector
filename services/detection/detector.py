"""Detector: evaluates error_rate and volume_drop signals (IMPLEMENTATION_PLAN-2-2.md §6.3).

Each evaluation, per service, the detector emits detections for:
  1. Signal "error_rate":
     - TRIGGERED when z >= Z_OPEN, rate - p0 >= MIN_DELTA, and total >= MIN_VOLUME.
     - Sustained ceiling: TRIGGERED (CRITICAL) if rate >= RATE_CEILING for CEILING_EVALS consecutive ticks.
     - CLEAR when z < Z_CLEAR (and ceiling not breached).
     - HOLD otherwise (hysteresis band).
  2. Signal "volume_drop":
     - Evaluated only when baseline.ready and expected_volume >= VOLUME_MIN_EXPECTED_RPS.
     - TRIGGERED (HIGH) when volume_rate < VOLUME_DROP_RATIO * expected_volume for VOLUME_DROP_EVALS ticks.
     - CLEAR when volume_rate >= VOLUME_DROP_CLEAR_RATIO * expected_volume.
     - HOLD in between.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from shared.config import Settings
from shared.models import Severity

from .baseline import Baseline
from .severity import Thresholds, classify


class DetectionState(str, Enum):
    TRIGGERED = "TRIGGERED"
    HOLD = "HOLD"
    CLEAR = "CLEAR"


@dataclass
class Detection:
    signal: str  # "error_rate" | "volume_drop"
    state: DetectionState
    severity: Severity
    evidence: dict


class Detector:
    """Per-service detector evaluating error_rate and volume_drop signals."""

    def __init__(self, s: Settings | None = None) -> None:
        self.s = s or Settings()
        self.thresholds = Thresholds(
            self.s.sigma_low,
            self.s.sigma_medium,
            self.s.sigma_high,
            self.s.sigma_critical,
        )

        # error_rate streak counters
        self._ceiling_streak: int = 0
        self._rate_state: DetectionState = DetectionState.CLEAR

        # volume_drop streak counters
        self._vol_low_streak: int = 0
        self._vol_state: DetectionState = DetectionState.CLEAR

    def evaluate_error_rate(
        self,
        total: int,
        rate: float,
        baseline: Baseline,
    ) -> Detection:
        """Evaluate the error_rate signal with dual-threshold hysteresis and ceiling guard."""
        ready = baseline.ready
        sufficient = total >= self.s.min_window_events
        mean = baseline.p0
        std = baseline.std

        # Sustained ceiling check (catches slow drift absorbed by baseline)
        if sufficient and rate >= self.s.rate_ceiling:
            self._ceiling_streak += 1
        else:
            self._ceiling_streak = 0
        ceiling_triggered = self._ceiling_streak >= self.s.ceiling_evals

        z = (rate - mean) / std if (ready and sufficient and std > 0) else 0.0

        evidence = {
            "rate": rate,
            "baseline": mean,
            "std": std,
            "z_score": z,
            "total_events": total,
            "ceiling_triggered": ceiling_triggered,
        }

        if ceiling_triggered:
            self._rate_state = DetectionState.TRIGGERED
            return Detection(
                signal="error_rate",
                state=DetectionState.TRIGGERED,
                severity=Severity.CRITICAL,
                evidence=evidence,
            )

        if not (ready and sufficient):
            self._rate_state = DetectionState.CLEAR
            return Detection(
                signal="error_rate",
                state=DetectionState.CLEAR,
                severity=Severity.NORMAL,
                evidence=evidence,
            )

        # Triggered check
        if z >= self.s.z_open and (rate - mean) >= self.s.min_delta:
            self._rate_state = DetectionState.TRIGGERED
            sev = classify(z, self.thresholds)
            return Detection(
                signal="error_rate",
                state=DetectionState.TRIGGERED,
                severity=sev,
                evidence=evidence,
            )

        # Clear check
        if z < self.s.z_clear:
            self._rate_state = DetectionState.CLEAR
            return Detection(
                signal="error_rate",
                state=DetectionState.CLEAR,
                severity=Severity.NORMAL,
                evidence=evidence,
            )

        # Otherwise in HOLD band
        return Detection(
            signal="error_rate",
            state=DetectionState.HOLD,
            severity=classify(z, self.thresholds) if self._rate_state == DetectionState.TRIGGERED else Severity.NORMAL,
            evidence=evidence,
        )

    def evaluate_volume_drop(
        self,
        current_rps: float,
        baseline: Baseline,
    ) -> Detection:
        """Evaluate the volume_drop signal (silent-source detection)."""
        expected = baseline.expected_volume

        evidence = {
            "current_rps": current_rps,
            "expected_rps": expected,
            "ratio": (current_rps / expected) if (expected and expected > 0) else None,
        }

        if (
            not baseline.ready
            or expected is None
            or expected < self.s.volume_min_expected_rps
        ):
            # Quiet service or baseline not ready
            self._vol_low_streak = 0
            self._vol_state = DetectionState.CLEAR
            return Detection(
                signal="volume_drop",
                state=DetectionState.CLEAR,
                severity=Severity.NORMAL,
                evidence=evidence,
            )

        drop_threshold = self.s.volume_drop_ratio * expected
        clear_threshold = self.s.volume_drop_clear_ratio * expected

        if current_rps < drop_threshold:
            self._vol_low_streak += 1
            if self._vol_low_streak >= self.s.volume_drop_evals:
                self._vol_state = DetectionState.TRIGGERED
                return Detection(
                    signal="volume_drop",
                    state=DetectionState.TRIGGERED,
                    severity=Severity.HIGH,  # spec §6.3: fixed at HIGH
                    evidence=evidence,
                )
            return Detection(
                signal="volume_drop",
                state=DetectionState.HOLD,
                severity=Severity.NORMAL,
                evidence=evidence,
            )

        if current_rps >= clear_threshold:
            self._vol_low_streak = 0
            self._vol_state = DetectionState.CLEAR
            return Detection(
                signal="volume_drop",
                state=DetectionState.CLEAR,
                severity=Severity.NORMAL,
                evidence=evidence,
            )

        # Between drop and clear: HOLD
        return Detection(
            signal="volume_drop",
            state=self._vol_state,
            severity=Severity.HIGH if self._vol_state == DetectionState.TRIGGERED else Severity.NORMAL,
            evidence=evidence,
        )

    def evaluate(
        self,
        total: int,
        rate: float,
        current_rps: float,
        baseline: Baseline,
    ) -> list[Detection]:
        """Emit one Detection per signal ("error_rate", "volume_drop") every evaluation."""
        return [
            self.evaluate_error_rate(total, rate, baseline),
            self.evaluate_volume_drop(current_rps, baseline),
        ]
