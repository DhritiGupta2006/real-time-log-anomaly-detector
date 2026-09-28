from __future__ import annotations

from dataclasses import asdict, dataclass, fields
from enum import IntEnum

ERROR_LEVELS = frozenset({"ERROR", "CRITICAL"})


class Severity(IntEnum):
    NORMAL = 0
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

    @classmethod
    def parse(cls, name: str, default: Severity | None = None) -> Severity:
        try:
            return cls[name.strip().upper()]
        except KeyError:
            return default if default is not None else cls.MEDIUM


@dataclass(slots=True)
class LogEvent:
    ts: float
    level: str
    service: str = "-"

    @property
    def is_error(self) -> bool:
        return self.level in ERROR_LEVELS


@dataclass
class Metrics:
    """One detection tick. This is the contract between the detection and alert services."""

    ts: float
    error_rate: float
    window_events: int
    window_errors: int
    baseline_mean: float
    baseline_std: float
    baseline_samples: int
    baseline_required: int
    z_score: float
    severity: int
    status: str  # warming_up | insufficient_data | ok | anomaly
    events_processed: int
    malformed_lines: int
    threshold_low: float
    threshold_medium: float
    threshold_high: float
    threshold_critical: float

    def to_dict(self) -> dict:
        d = asdict(self)
        d["severity_name"] = Severity(self.severity).name
        return d

    @classmethod
    def from_dict(cls, d: dict) -> Metrics:
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names})


@dataclass
class Alert:
    id: str
    severity: int
    peak_severity: int
    status: str  # ACTIVE | RESOLVED
    opened_at: float
    updated_at: float
    error_rate: float
    peak_error_rate: float
    baseline_mean: float
    z_score: float
    peak_z: float
    message: str
    resolved_at: float | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["severity_name"] = Severity(self.severity).name
        d["peak_severity_name"] = Severity(self.peak_severity).name
        return d
