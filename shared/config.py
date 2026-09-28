"""Environment-based configuration (12-factor). Every knob is an env var named after the field.

Fail fast: raises ConfigError on invalid config, halting startup.
Degrade gracefully: unreachable AWS at startup is a warning, not a crash.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, fields


class ConfigError(ValueError):
    """Raised when a config value fails validation. The message names the variable, never prints secret values."""
    pass


_TRUE = {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    # paths
    log_file: str = "logs/app.log"
    control_file: str = "logs/sim_control.json"
    frontend_dir: str = "frontend"
    journal_file: str = "logs/journal.jsonl"
    dlq_file: str = "logs/dlq.jsonl"

    # detection — window
    window_seconds: float = 10.0
    tick_seconds: float = 1.0
    eval_interval_seconds: float = 1.0
    min_window_events: int = 20         # MIN_VOLUME: volume guard against alerting on a handful of lines

    # detection — baseline
    baseline_max_samples: int = 120     # MAD window
    baseline_min_samples: int = 20      # legacy compat; warmup uses warmup_evals
    warmup_evals: int = 20              # evaluations before detection is allowed
    ewma_alpha: float = 0.05            # EWMA smoothing factor for rate and volume
    sigma_floor: float = 0.01           # minimum spread; avoids ÷0 on a quiet baseline
    baseline_cooldown_seconds: float = 30.0  # extra freeze after readings return to normal

    # detection — gating
    min_delta: float = 0.03             # practical-significance guard; rate - baseline >= min_delta
    min_std: float = 0.005              # legacy compat alias for sigma_floor

    # detection — hysteresis / FSM
    z_open: float = 3.0                 # open threshold
    z_clear: float = 1.5                # clear threshold (hysteresis band below z_open)
    clear_evals: int = 3                # consecutive CLEAR readings before resolving
    confirm_ticks: int = 3              # legacy compat for AlertManager
    resolve_ticks: int = 5              # legacy compat for AlertManager
    cooldown_seconds: float = 60.0      # reopen window after resolve

    # detection — sustained ceiling
    rate_ceiling: float = 0.20          # absolute error rate; TRIGGERED regardless of z if sustained
    ceiling_evals: int = 5              # consecutive evals above ceiling to trigger

    # detection — severity sigma thresholds (for classify())
    sigma_low: float = 1.0
    sigma_medium: float = 2.0
    sigma_high: float = 3.0
    sigma_critical: float = 5.0

    # volume drop signal
    volume_window_seconds: float = 15.0         # short window for volume_rate
    volume_drop_ratio: float = 0.20             # trigger when volume < 20% of expected
    volume_drop_clear_ratio: float = 0.50       # clear when volume > 50% of expected
    volume_drop_evals: int = 5                  # consecutive low evaluations to trigger
    volume_min_expected_rps: float = 0.5        # quiet-service guard; skip if expected is below this

    # AWS
    aws_enabled: bool = False
    aws_region: str = "us-east-1"
    sns_topic_arn: str = ""
    sns_min_severity: str = "HIGH"
    cw_log_group: str = "/logpulse/alerts"
    cw_log_stream: str = "anomaly-alerts"
    aws_timeout: float = 3.0
    aws_endpoint_url: str = ""          # non-empty selects LocalStack
    notifiers: str = "console"          # comma list: console,cloudwatch,sns

    # bus backend
    bus_backend: str = "memory"
    redis_url: str = ""

    # inter-service (microservices mode)
    detection_url: str = "http://detection:8002"
    alerts_url: str = "http://alerts:8003"
    log_level: str = "INFO"

    # simulator HTTP control (demo only — off by default)
    sim_control: int = 0                # set to 1 to enable the /rate and /status HTTP endpoints
    sim_bind: str = "127.0.0.1"
    sim_port: int = 8001
    heartbeat_seconds: float = 15.0

    def validate(self) -> None:
        """Fail fast with a ConfigError if any threshold is invalid.

        All error messages name the variable, never print secret values.
        """
        if self.window_seconds <= 0:
            raise ConfigError("WINDOW_SECONDS must be > 0")
        if self.eval_interval_seconds <= 0:
            raise ConfigError("EVAL_INTERVAL_SECONDS must be > 0")
        if self.eval_interval_seconds > self.window_seconds:
            raise ConfigError("EVAL_INTERVAL_SECONDS must be <= WINDOW_SECONDS")
        if not (0.0 < self.ewma_alpha < 1.0):
            raise ConfigError("EWMA_ALPHA must be strictly between 0 and 1")
        if not (self.z_open > self.z_clear > 0.0):
            raise ConfigError("Must satisfy Z_OPEN > Z_CLEAR > 0")
        if self.min_window_events <= 0:
            raise ConfigError("MIN_WINDOW_EVENTS must be > 0")
        if self.min_delta < 0.0:
            raise ConfigError("MIN_DELTA must be >= 0")
        if self.clear_evals < 1:
            raise ConfigError("CLEAR_EVALS must be >= 1")
        if not (0.0 < self.rate_ceiling <= 1.0):
            raise ConfigError("RATE_CEILING must be in (0, 1]")
        if self.ceiling_evals < 1:
            raise ConfigError("CEILING_EVALS must be >= 1")
        if not (0.0 < self.volume_drop_ratio < self.volume_drop_clear_ratio <= 1.0):
            raise ConfigError(
                "Must satisfy 0 < VOLUME_DROP_RATIO < VOLUME_DROP_CLEAR_RATIO <= 1"
            )
        if self.volume_drop_evals < 1:
            raise ConfigError("VOLUME_DROP_EVALS must be >= 1")
        if self.volume_min_expected_rps < 0.0:
            raise ConfigError("VOLUME_MIN_EXPECTED_RPS must be >= 0")

        # notifiers
        if self.bus_backend not in {"memory", "redis"}:
            raise ConfigError(
                f"BUS_BACKEND must be 'memory' or 'redis', got '{self.bus_backend}'"
            )
        if self.bus_backend == "redis" and not self.redis_url:
            raise ConfigError("BUS_BACKEND=redis requires REDIS_URL to be set")

        known = {"console", "cloudwatch", "sns"}
        notif_list = [n.strip() for n in self.notifiers.split(",") if n.strip()]
        for n in notif_list:
            if n not in known:
                raise ConfigError(
                    f"NOTIFIERS contains unknown notifier '{n}'; allowed: {sorted(known)}"
                )
        if "sns" in notif_list and self.aws_enabled and not self.sns_topic_arn:
            raise ConfigError(
                "NOTIFIERS includes 'sns' with AWS_ENABLED=true but SNS_TOPIC_ARN is empty"
            )
        if "cloudwatch" in notif_list and self.aws_enabled and not self.cw_log_group:
            raise ConfigError(
                "NOTIFIERS includes 'cloudwatch' with AWS_ENABLED=true but CW_LOG_GROUP is empty"
            )

    @classmethod
    def from_env(cls, **overrides) -> "Settings":
        kw: dict = {}
        for f in fields(cls):
            raw = os.getenv(f.name.upper())
            if raw is None or raw == "":
                continue
            if f.type == "bool":
                kw[f.name] = raw.strip().lower() in _TRUE
            elif f.type == "int":
                kw[f.name] = int(raw)
            elif f.type == "float":
                kw[f.name] = float(raw)
            else:
                kw[f.name] = raw
        kw.update(overrides)
        s = cls(**kw)
        s.validate()
        return s
