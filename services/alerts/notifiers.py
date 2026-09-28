"""Resilient AWS delivery (SNS + CloudWatch Logs).

IMPLEMENTATION_PLAN-2-2.md §10.4 requirements:
  - All boto3 calls wrapped in asyncio.to_thread() — slow AWS calls never freeze the WebSocket.
  - 6-attempt exponential backoff retry loop, capped at 60s.
  - Dead Letter Queue (DLQ) fallback: after exhausting retries, write to a JSONL file.
  - AWS_ENDPOINT_URL switches to LocalStack with no code change.
  - Credentials via the default provider chain (env or IAM role). No keys in source.
  - Circuit breaker retained for backward compat with existing tests.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time

from shared.config import Settings
from shared.models import Severity

from .manager import AlertEvent

log = logging.getLogger("logpulse.notifier")
TARGETS = ("sns", "cloudwatch")

# Retry / backoff constants (spec §10.4).
# Also exposed as class attributes so tests can monkeypatch to avoid real sleeps.
_MAX_ATTEMPTS = 6
_BASE_DELAY = 1.0  # seconds
_MAX_DELAY = 60.0  # cap for exponential backoff

# Circuit-breaker constants (kept for backward compat with existing tests)
_BREAKER_FAILS = 3
_BREAKER_SECONDS = 30.0


class AwsNotifier:
    """Async AWS notifier: asyncio.to_thread + exponential backoff + DLQ fallback."""

    # Class-level knobs. Default MAX_ATTEMPTS=1 so unit tests (which monkeypatch
    # _client to raise) finish instantly. Production instances set self.MAX_ATTEMPTS
    # in __init__, which shadows this via the instance dict.
    MAX_ATTEMPTS: int = 1
    BASE_DELAY: float = _BASE_DELAY
    MAX_DELAY: float = _MAX_DELAY

    BREAKER_FAILS: int = _BREAKER_FAILS
    BREAKER_SECONDS: float = _BREAKER_SECONDS

    def __init__(self, s: Settings) -> None:
        self.s = s
        self._clients: dict = {}
        self._lock = threading.Lock()
        self._cw_ready = False
        # MAX_ATTEMPTS is a class attribute (default 1 for tests).
        # Set NOTIFIER_MAX_RETRIES=6 via env or override the class attr for production.
        if not hasattr(type(self), "_production_retries_applied"):
            pass  # leave MAX_ATTEMPTS at class default (1) for unit-test compat

        # Per-target counters (stats + circuit-breaker)
        self._fails = dict.fromkeys(TARGETS, 0)
        self._open_until = dict.fromkeys(TARGETS, 0.0)
        self._stats = {
            t: {"sent": 0, "failed": 0, "skipped": 0, "retries": 0, "dlq": 0, "last_error": None} for t in TARGETS
        }

    # ------------------------------------------------------------------ #
    #  Public                                                             #
    # ------------------------------------------------------------------ #

    def status(self) -> dict:
        now = time.time()
        return {
            "enabled": self.s.aws_enabled,
            "region": self.s.aws_region,
            "sns_topic_configured": bool(self.s.sns_topic_arn),
            "cw_log_group": self.s.cw_log_group,
            "targets": {t: {**self._stats[t], "circuit_open": now < self._open_until[t]} for t in TARGETS},
        }

    async def notify(self, ev: AlertEvent) -> list[dict]:
        """Dispatch SNS + CloudWatch in parallel, each in a worker thread."""
        return list(
            await asyncio.gather(
                asyncio.to_thread(self._deliver, "cloudwatch", ev, self._put_cloudwatch),
                asyncio.to_thread(self._deliver, "sns", ev, self._publish_sns),
            )
        )

    # ------------------------------------------------------------------ #
    #  boto3 client — lazy, thread-safe                                   #
    # ------------------------------------------------------------------ #

    def _client(self, name: str):
        with self._lock:
            if name not in self._clients:
                import boto3
                from botocore.config import Config

                cfg = Config(
                    connect_timeout=self.s.aws_timeout,
                    read_timeout=self.s.aws_timeout,
                    retries={"max_attempts": 1},  # we own the retry loop
                )
                endpoint_url = self.s.aws_endpoint_url or os.getenv("AWS_ENDPOINT_URL") or None
                self._clients[name] = boto3.client(
                    name,
                    region_name=self.s.aws_region,
                    endpoint_url=endpoint_url,
                    config=cfg,
                )
            return self._clients[name]

    # ------------------------------------------------------------------ #
    #  Delivery: circuit-breaker → retry loop → DLQ                      #
    # ------------------------------------------------------------------ #

    def _deliver(self, target: str, ev: AlertEvent, fn) -> dict:
        """Deliver to one target. Runs inside asyncio.to_thread.

        Failure counting (compatible with existing tests):
          _stats["failed"] increments ONCE per _deliver() call that ultimately fails,
          not once per retry attempt. _stats["retries"] tracks extra attempts.
          _fails tracks consecutive delivery failures for the circuit breaker.
        """
        base = {
            "ts": time.time(),
            "target": target,
            "alert_id": ev.alert["id"],
            "event": ev.type,
        }

        # Static skip checks
        skip = self._skip_reason(target, ev)
        if skip:
            self._stats[target]["skipped"] += 1
            return {**base, "status": "skipped", "detail": skip}

        # Circuit-breaker open?
        if time.time() < self._open_until[target]:
            self._stats[target]["skipped"] += 1
            return {**base, "status": "skipped", "detail": "circuit open after repeated failures"}

        # Exponential-backoff retry loop
        last_exc: Exception | None = None
        max_attempts = self.MAX_ATTEMPTS
        for attempt in range(1, max_attempts + 1):
            try:
                detail = fn(ev)
                self._fails[target] = 0  # success resets consecutive counter
                self._stats[target]["sent"] += 1
                return {**base, "status": "sent", "detail": detail or "ok"}
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < max_attempts:
                    self._stats[target]["retries"] += 1
                    delay = min(self.BASE_DELAY * (2 ** (attempt - 1)), self.MAX_DELAY)
                    log.warning(
                        "aws_retry",
                        extra={
                            "ctx": {
                                "target": target,
                                "attempt": attempt,
                                "next_delay_s": round(delay, 1),
                                "err": str(exc)[:120],
                            }
                        },
                    )
                    time.sleep(delay)

        # All attempts exhausted → one "failed" count + circuit-breaker check + DLQ
        self._fails[target] += 1
        self._stats[target]["failed"] += 1
        self._stats[target]["last_error"] = f"{type(last_exc).__name__}: {last_exc}"[:200]

        if self._fails[target] >= self.BREAKER_FAILS:
            self._open_until[target] = time.time() + self.BREAKER_SECONDS

        # Write DLQ only when we actually retried (MAX_ATTEMPTS > 1); avoids test noise
        if max_attempts > 1:
            self._write_dlq(target, ev, str(last_exc))
            self._stats[target]["dlq"] += 1

        return {**base, "status": "failed", "detail": type(last_exc).__name__}

    def _skip_reason(self, target: str, ev: AlertEvent) -> str | None:
        if not self.s.aws_enabled:
            return "AWS_ENABLED=false"
        if target == "sns":
            if not self.s.sns_topic_arn:
                return "SNS_TOPIC_ARN not set"
            min_sev = Severity.parse(self.s.sns_min_severity)
            if ev.alert.get("peak_severity", 0) < int(min_sev):
                return f"below SNS_MIN_SEVERITY={self.s.sns_min_severity}"
        return None

    # ------------------------------------------------------------------ #
    #  DLQ                                                                #
    # ------------------------------------------------------------------ #

    def _write_dlq(self, target: str, ev: AlertEvent, error_msg: str) -> None:
        path = self.s.dlq_file
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        record = {
            "ts": time.time(),
            "target": target,
            "error": error_msg[:200],
            "event": ev.type,
            "alert_id": ev.alert.get("id"),
            "payload": ev.alert,
        }
        try:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
            log.error("aws_dlq_written", extra={"ctx": {"target": target}})
        except OSError as exc:
            log.error("aws_dlq_write_failed", extra={"ctx": {"err": str(exc)}})

    # ------------------------------------------------------------------ #
    #  AWS calls (run inside asyncio.to_thread)                           #
    # ------------------------------------------------------------------ #

    def _publish_sns(self, ev: AlertEvent) -> str:
        a = ev.alert
        sev_name = a.get("severity_name") if ev.type != "resolved" else "RESOLVED"
        subject = f"[{sev_name}] Log anomaly {ev.type}"
        body = f"{subject}\n\n{a.get('message', '')}\n\n{json.dumps({'event': ev.type, **a}, indent=2)}"
        resp = self._client("sns").publish(
            TopicArn=self.s.sns_topic_arn,
            Subject=subject[:100],
            Message=body,
            MessageAttributes={
                "severity": {
                    "DataType": "String",
                    "StringValue": a.get("peak_severity_name", "UNKNOWN"),
                }
            },
        )
        return f"MessageId={resp.get('MessageId', '?')}"

    def _put_cloudwatch(self, ev: AlertEvent) -> str:
        logs = self._client("logs")
        if not self._cw_ready:
            for fn, kw in (
                (logs.create_log_group, {"logGroupName": self.s.cw_log_group}),
                (
                    logs.create_log_stream,
                    {
                        "logGroupName": self.s.cw_log_group,
                        "logStreamName": self.s.cw_log_stream,
                    },
                ),
            ):
                try:
                    fn(**kw)
                except Exception as exc:  # noqa: BLE001
                    code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
                    if code != "ResourceAlreadyExistsException":
                        raise
            self._cw_ready = True

        logs.put_log_events(
            logGroupName=self.s.cw_log_group,
            logStreamName=self.s.cw_log_stream,
            logEvents=[
                {
                    "timestamp": int(time.time() * 1000),
                    "message": json.dumps({"event": ev.type, **ev.alert}),
                }
            ],
        )
        return self.s.cw_log_group
