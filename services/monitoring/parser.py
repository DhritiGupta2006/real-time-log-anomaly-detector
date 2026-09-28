"""Log line parser with healthcare PHI redaction.

Expected format: `<ISO-8601 timestamp> <LEVEL> <service> <message...>`

Privacy contract (IMPLEMENTATION_PLAN-2-2.md §8):
  phi_redactor() runs BEFORE a line is queued, hashed, journaled, streamed to a client, or sent to AWS.
  top_messages in alerts contain redacted text only.
"""

from __future__ import annotations

import re
try:
    from datetime import UTC, datetime
except ImportError:
    from datetime import datetime, timezone
    UTC = timezone.utc  # type: ignore[misc]

from shared.models import LogEvent

# --------------------------------------------------------------------------- #
#  PHI / PII redaction patterns                                               #
# --------------------------------------------------------------------------- #

_PHI_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # SSN: 123-45-6789
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[REDACTED_SSN]"),
    # Email addresses
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "[REDACTED_EMAIL]"),
    # US phone numbers (various formats)
    (
        re.compile(r"\b(?:\+?1[.\-\s]?)?\(?\d{3}\)?[.\-\s]?\d{3}[.\-\s]?\d{4}\b"),
        "[REDACTED_PHONE]",
    ),
    # Patient / member / MRN identifiers
    (
        re.compile(r"(?i)\b(?:mrn|member[_ ]?id|patient[_ ]?id)\s*[:=]\s*[A-Za-z0-9\-]{5,}"),
        "[REDACTED_ID]",
    ),
    # Date of birth
    (
        re.compile(r"(?i)\b(?:dob|birth[_ ]?date)\s*[:=]\s*\S+"),
        "[REDACTED_DOB]",
    ),
]

# --------------------------------------------------------------------------- #
#  Line regex                                                                 #
# --------------------------------------------------------------------------- #

_LINE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)"
    r"\s+(?P<level>[A-Za-z]+)\s+(?P<service>\S+)(?:\s+(?P<message>.*))?$"
)
_ALIASES = {"WARN": "WARNING", "FATAL": "CRITICAL", "ERR": "ERROR", "SEVERE": "ERROR"}
_VALID = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}


# --------------------------------------------------------------------------- #
#  Public API                                                                 #
# --------------------------------------------------------------------------- #


def phi_redactor(text: str) -> tuple[str, int]:
    """Redact PHI/PII patterns from *text*.

    Returns:
        (redacted_text, total_substitution_count)

    Runs all patterns in a single pass through the string. The count is
    exposed on /metrics as ``redactions_total``.

    Limitations (stated honestly per §8): regex redaction is defense in depth,
    not a compliance guarantee. The stronger control is not logging PHI at all.
    All demo data is synthetic.
    """
    total = 0
    for pattern, replacement in _PHI_PATTERNS:
        text, n = pattern.subn(replacement, text)
        total += n
    return text, total


def parse_line(line: str) -> LogEvent | None:
    """Parse a log line into a LogEvent, or return None for malformed input.

    PHI redaction runs first — before the line is queued or inspected.
    The caller counts None returns; this function never raises.
    """
    # Privacy before aggregation
    redacted, _ = phi_redactor(line.strip())

    m = _LINE.match(redacted)
    if not m:
        return None

    level = m["level"].upper()
    level = _ALIASES.get(level, level)
    if level not in _VALID:
        return None

    try:
        dt = datetime.fromisoformat(m["ts"].replace(" ", "T").replace("Z", "+00:00"))
    except ValueError:
        return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)

    return LogEvent(
        ts=dt.timestamp(),
        level=level,
        service=m["service"],
    )
