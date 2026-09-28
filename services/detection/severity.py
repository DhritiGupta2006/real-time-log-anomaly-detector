from __future__ import annotations

from dataclasses import dataclass

from shared.models import Severity


@dataclass(frozen=True)
class Thresholds:
    low: float = 1.0
    medium: float = 2.0
    high: float = 3.0
    critical: float = 5.0  # "extreme deviation"


def classify(z: float, t: Thresholds) -> Severity:
    if z >= t.critical:
        return Severity.CRITICAL
    if z > t.high:
        return Severity.HIGH
    if z > t.medium:
        return Severity.MEDIUM
    if z > t.low:
        return Severity.LOW
    return Severity.NORMAL
