"""Log simulator: steady traffic, with on-demand control via the dashboard.

Two control mechanisms (both work simultaneously):
  1. File-based: reads logs/sim_control.json (existing dashboard buttons use this).
  2. HTTP control (IMPLEMENTATION_PLAN-2-2.md §7.3):
     Enabled when SIM_CONTROL=1. Exposes:
       POST /rate      { "error_rate": float, "lines_per_sec": float }
       POST /scenario  { "name": "spike" | "drift" | "silence" | "reset" }
       GET  /status    { "error_rate": ..., "lines_per_sec": ..., "lines_written": ..., "scenario": ... }
     Bound to SIM_BIND (default 127.0.0.1) on SIM_PORT (default 8001).
     CORS allowed for the dashboard origin.

Demo PHI: a small fraction of lines carry fake SSNs, emails, and member IDs so the
redaction story can be shown live (spec §7.3).

Usage (no HTTP control):
    python -m simulator.log_simulator

Usage (with HTTP control):
    SIM_CONTROL=1 python -m simulator.log_simulator
"""

from __future__ import annotations

import argparse
import os
import random
import threading
import time
try:
    from datetime import UTC, datetime
except ImportError:
    from datetime import datetime, timezone
    UTC = timezone.utc  # type: ignore[misc]

from shared.control import read_mode, write_mode

# --------------------------------------------------------------------------- #
#  Line generation                                                            #
# --------------------------------------------------------------------------- #

SERVICES = ["checkout", "auth", "search", "payments", "inventory"]
OK_MSGS = [
    "request completed",
    "cache hit",
    "session refreshed",
    "order accepted",
    "query ok",
]
ERR_MSGS = [
    "upstream timeout",
    "db connection refused",
    "payment gateway 502",
    "unhandled exception",
    "queue overflow",
]

# Fake PHI for the redaction demo (synthetic data only, spec §7.3 and §8)
_FAKE_PHI = [
    "patient_id=PA-00123 SSN=123-45-6789",
    "member_id=MEM-77421 dob=1972-04-15",
    "email=john.doe@example.com request_id=abc99",
    "mrn=MRN-55001 phone=+1-800-555-0199",
    "email=patient@clinic.org member_id=CL-33892",
]


def make_line(rng: random.Random, err_rate: float, now: float) -> str:
    ts = datetime.fromtimestamp(now, UTC).isoformat(timespec="milliseconds")
    if rng.random() < 0.002:  # sprinkle of garbage to prove parser resilience
        return "!!corrupted-line " + "#" * rng.randint(3, 20) + "\n"
    # ~1 in 200 lines carries fake PHI for the redaction demo
    phi_suffix = f" {rng.choice(_FAKE_PHI)}" if rng.random() < 0.005 else ""
    svc = rng.choice(SERVICES)
    if rng.random() < err_rate:
        return f"{ts} ERROR {svc} {rng.choice(ERR_MSGS)}{phi_suffix}\n"
    level = rng.choices(["INFO", "WARNING", "DEBUG"], weights=[90, 8, 2])[0]
    return f"{ts} {level} {svc} {rng.choice(OK_MSGS)}{phi_suffix}\n"


# --------------------------------------------------------------------------- #
#  Shared mutable state (written by HTTP thread, read by writer loop)        #
# --------------------------------------------------------------------------- #


class _SimState:
    def __init__(self, base_error: float, spike_error: float, rps: float) -> None:
        self._lock = threading.Lock()
        self.error_rate: float = base_error
        self.lines_per_sec: float = rps
        self.lines_written: int = 0
        self.scenario: str | None = None

        # Scenario defaults
        self._base_error = base_error
        self._spike_error = spike_error
        self._base_rps = rps

    def get(self) -> dict:
        with self._lock:
            return {
                "error_rate": self.error_rate,
                "lines_per_sec": self.lines_per_sec,
                "lines_written": self.lines_written,
                "scenario": self.scenario,
            }

    def apply_rate(self, error_rate: float | None, lines_per_sec: float | None) -> None:
        with self._lock:
            if error_rate is not None:
                self.error_rate = float(error_rate)
            if lines_per_sec is not None:
                self.lines_per_sec = float(lines_per_sec)
            self.scenario = None

    def apply_scenario(self, name: str) -> None:
        """Apply a named scenario. Scripts are immediate (no ramp in the HTTP path)."""
        with self._lock:
            self.scenario = name
            if name == "spike":
                self.error_rate = self._spike_error
                self.lines_per_sec = self._base_rps
            elif name == "silence":
                self.error_rate = self._base_error
                self.lines_per_sec = 0.0
            elif name == "drift":
                # Start the drift; the writer loop will slowly increase error_rate
                self.error_rate = self._base_error
                self.lines_per_sec = self._base_rps
            elif name == "reset":
                self.error_rate = self._base_error
                self.lines_per_sec = self._base_rps
            else:
                self.scenario = None

    def inc_lines(self, n: int) -> None:
        with self._lock:
            self.lines_written += n


# --------------------------------------------------------------------------- #
#  HTTP control server (spec §7.3, demo mode only)                           #
# --------------------------------------------------------------------------- #


def _start_http_control(state: _SimState, bind: str, port: int, control_file: str) -> None:
    """Start a tiny HTTP server in a daemon thread for dashboard-driven control."""
    import json
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # suppress access logs
            pass

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if self.path.rstrip("/") == "/status":
                body = json.dumps(state.get()).encode()
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(404)
                self.end_headers()

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            try:
                data = json.loads(self.rfile.read(length)) if length else {}
            except json.JSONDecodeError:
                self.send_response(400)
                self.end_headers()
                return

            if self.path.rstrip("/") == "/rate":
                state.apply_rate(
                    data.get("error_rate"),
                    data.get("lines_per_sec"),
                )
                # Also sync to the file-based control channel (for "spike" mode compat)
                if state.error_rate > state._base_error * 2:
                    try:
                        write_mode(control_file, "spike")
                    except Exception:
                        pass
                else:
                    try:
                        write_mode(control_file, "normal")
                    except Exception:
                        pass
            elif self.path.rstrip("/") == "/scenario":
                name = data.get("name", "")
                state.apply_scenario(name)
                # Sync file-based control
                try:
                    write_mode(control_file, "spike" if name == "spike" else "normal")
                except Exception:
                    pass
            else:
                self.send_response(404)
                self.end_headers()
                return

            body = json.dumps(state.get()).encode()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = HTTPServer((bind, port), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    print(f"simulator: HTTP control on http://{bind}:{port}/rate  GET /status  POST /scenario", flush=True)


# --------------------------------------------------------------------------- #
#  Main writer loop                                                           #
# --------------------------------------------------------------------------- #


def run(
    path: str,
    control: str,
    rps: float,
    base: float,
    spike: float,
    ramp_up: float,
    ramp_down: float,
    seed: int | None = None,
    sim_control: int = 0,
    sim_bind: str = "127.0.0.1",
    sim_port: int = 8001,
) -> None:
    rng = random.Random(seed)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    state = _SimState(base, spike, rps)

    if sim_control:
        _start_http_control(state, sim_bind, sim_port, control)

    cur_rate = base
    mode = "normal"
    last_ctl = 0.0
    carry = 0.0
    prev = time.time()

    print(f"simulator: {rps:.0f} lines/s -> {path} (base {base:.0%}, spike {spike:.0%})", flush=True)
    with open(path, "a", buffering=1) as fh:
        while True:
            time.sleep(0.1)
            now = time.time()
            dt, prev = now - prev, now

            # File-based control (unchanged — dashboard buttons still work)
            if now - last_ctl >= 0.5:
                new_mode = read_mode(control)
                if new_mode != mode:
                    print(f"simulator: mode -> {new_mode}", flush=True)
                mode, last_ctl = new_mode, now

            # HTTP control overrides file-based control
            if sim_control:
                s = state.get()
                target_rate = s["error_rate"]
                current_rps = s["lines_per_sec"]
            else:
                target_rate = spike if mode == "spike" else base
                current_rps = rps

            # Ramp toward target error rate
            if target_rate > cur_rate:
                cur_rate = min(target_rate, cur_rate + ramp_up * dt)
            else:
                cur_rate = max(target_rate, cur_rate - ramp_down * dt)

            # Write lines
            carry += current_rps * dt
            n, carry = int(carry), carry - int(carry)
            if n:
                chunk = "".join(make_line(rng, cur_rate, now) for _ in range(n))
                fh.write(chunk)
                if sim_control:
                    state.inc_lines(n)


# --------------------------------------------------------------------------- #
#  Entry point                                                                #
# --------------------------------------------------------------------------- #


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    e = os.getenv
    p.add_argument("--file", default=e("LOG_FILE", "logs/app.log"))
    p.add_argument("--control", default=e("CONTROL_FILE", "logs/sim_control.json"))
    p.add_argument("--rps", type=float, default=float(e("SIM_RPS", "20")))
    p.add_argument("--base-error", type=float, default=float(e("SIM_BASE_ERROR", "0.02")))
    p.add_argument("--spike-error", type=float, default=float(e("SIM_SPIKE_ERROR", "0.30")))
    p.add_argument(
        "--ramp-up",
        type=float,
        default=float(e("SIM_RAMP_UP", "0.005")),
        help="error-rate change per second during ramp up",
    )
    p.add_argument("--ramp-down", type=float, default=float(e("SIM_RAMP_DOWN", "0.10")))
    p.add_argument(
        "--sim-control",
        type=int,
        default=int(e("SIM_CONTROL", "0")),
        help="1 to enable HTTP control endpoints (demo only)",
    )
    p.add_argument("--sim-bind", default=e("SIM_BIND", "127.0.0.1"))
    p.add_argument("--sim-port", type=int, default=int(e("SIM_PORT", "8001")))
    a = p.parse_args()
    try:
        run(
            a.file,
            a.control,
            a.rps,
            a.base_error,
            a.spike_error,
            a.ramp_up,
            a.ramp_down,
            sim_control=a.sim_control,
            sim_bind=a.sim_bind,
            sim_port=a.sim_port,
        )
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
