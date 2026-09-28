"""Deterministic fixture generator (IMPLEMENTATION_PLAN-2-2.md §7.4).

Generates reproducible fixture log files for end-to-end replay testing:
  - healthy.log: normal baseline traffic (2% error rate)
  - noisy_normal.log: brief error blips that do not breach thresholds (false-positive guard)
  - spike.log: normal -> 25% spike -> recovery
  - drift.log: gradual ramp to 30% error rate (tests sustained ceiling)
  - new_error.log: new error message template appears
  - silence.log: log volume drops to 0 for 30s (tests VOLUME_DROP)
"""

from __future__ import annotations

import random
from pathlib import Path

FIXTURES_DIR = Path(__file__).parent.parent / "tests" / "fixtures"


def generate_fixtures() -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    rng = random.Random(42)

    # 1. healthy.log: 120 seconds of healthy traffic at 20 rps (2% errors)
    lines = []
    t0 = 1700000000.0
    for sec in range(120):
        t = t0 + sec
        for i in range(20):
            ts = t + i / 20.0
            is_err = rng.random() < 0.02
            level = "ERROR" if is_err else "INFO"
            msg = "db connection timeout" if is_err else "cache hit"
            lines.append(f"{ts:.3f} {level} checkout {msg}\n")
    (FIXTURES_DIR / "healthy.log").write_text("".join(lines))

    # 2. noisy_normal.log: 120 seconds, baseline 2%, with brief blip to 3.5%
    lines = []
    for sec in range(120):
        t = t0 + sec
        err_rate = 0.035 if 60 <= sec < 65 else 0.02
        for i in range(20):
            ts = t + i / 20.0
            is_err = rng.random() < err_rate
            level = "ERROR" if is_err else "INFO"
            lines.append(f"{ts:.3f} {level} checkout response ok\n")
    (FIXTURES_DIR / "noisy_normal.log").write_text("".join(lines))

    # 3. spike.log: 60s normal (2%), 20s spike (25%), 60s normal
    lines = []
    for sec in range(140):
        t = t0 + sec
        err_rate = 0.25 if 60 <= sec < 80 else 0.02
        for i in range(20):
            ts = t + i / 20.0
            is_err = rng.random() < err_rate
            level = "ERROR" if is_err else "INFO"
            lines.append(f"{ts:.3f} {level} checkout upstream 503 error\n")
    (FIXTURES_DIR / "spike.log").write_text("".join(lines))

    # 4. drift.log: 60s normal, ramp to 30% errors, sustained above ceiling
    lines = []
    for sec in range(140):
        t = t0 + sec
        if sec < 60:
            err_rate = 0.02
        elif sec < 110:
            err_rate = 0.02 + 0.28 * ((sec - 60) / 50.0)
        else:
            err_rate = 0.30
        for i in range(20):
            ts = t + i / 20.0
            is_err = rng.random() < err_rate
            level = "ERROR" if is_err else "INFO"
            lines.append(f"{ts:.3f} {level} checkout memory pressure\n")
    (FIXTURES_DIR / "drift.log").write_text("".join(lines))

    # 5. new_error.log: 60s normal, then new error signature
    lines = []
    for sec in range(120):
        t = t0 + sec
        for i in range(20):
            ts = t + i / 20.0
            if sec >= 60 and rng.random() < 0.20:
                lines.append(f"{ts:.3f} ERROR checkout SSL handshake failed\n")
            elif rng.random() < 0.02:
                lines.append(f"{ts:.3f} ERROR checkout db timeout\n")
            else:
                lines.append(f"{ts:.3f} INFO checkout query completed\n")
    (FIXTURES_DIR / "new_error.log").write_text("".join(lines))

    # 6. silence.log: 60s normal 20 rps, then 30s 0 rps, then resume
    lines = []
    for sec in range(120):
        t = t0 + sec
        if 60 <= sec < 90:
            continue  # Total silence (0 rps)
        for i in range(20):
            ts = t + i / 20.0
            is_err = rng.random() < 0.02
            level = "ERROR" if is_err else "INFO"
            lines.append(f"{ts:.3f} {level} checkout healthcheck ok\n")
    (FIXTURES_DIR / "silence.log").write_text("".join(lines))


if __name__ == "__main__":
    generate_fixtures()
    print("Generated all fixtures in tests/fixtures/")
