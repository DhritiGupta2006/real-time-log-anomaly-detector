"""Local development launcher — stitches the simulator, the API server, and the frontend.

Modes
-----
Production (default):
    Builds the Vite frontend to frontend/dist/, then starts:
      - simulator.log_simulator (background subprocess)
      - uvicorn api.main:app    (serves API + built frontend at /)

Development (--dev):
    Skips the frontend build and starts:
      - simulator.log_simulator (background subprocess)
      - uvicorn api.main:app    (API only, port 8000)
      - npm run dev             (Vite dev server at port 3000 with HMR; proxies /ws and /api/* to 8000)
    Open http://localhost:3000/ in dev mode.

Usage:
    python run.py              # prod: build + serve at http://127.0.0.1:8000/
    python run.py --dev        # dev:  Vite HMR at http://127.0.0.1:3000/
    python run.py --port 8080  # custom backend port
    python run.py --skip-build # skip npm build (use existing dist/)

Stop with Ctrl+C; all child processes are terminated cleanly.
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time


FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")


def _run(cmd: list[str], cwd: str | None = None, env: dict | None = None) -> subprocess.Popen:
    return subprocess.Popen(cmd, cwd=cwd, env=env)


def _shutdown(procs: list[subprocess.Popen]) -> None:
    print("\n[run.py] Shutting down ...", flush=True)
    for p in procs:
        if p.poll() is None:
            if sys.platform == "win32":
                try:
                    p.send_signal(signal.CTRL_C_EVENT)
                except Exception:
                    p.terminate()
            else:
                p.terminate()
    deadline = time.time() + 6
    for p in procs:
        remaining = max(0.0, deadline - time.time())
        try:
            p.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            p.kill()


def build_frontend() -> bool:
    """Run `npm run build` in frontend/. Returns True on success."""
    print("[run.py] Building frontend …", flush=True)
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=FRONTEND_DIR,
        shell=sys.platform == "win32",
    )
    if result.returncode != 0:
        print("[run.py] Frontend build FAILED. Falling back to existing dist/ if present.", flush=True)
        return False
    print("[run.py] Frontend build OK.", flush=True)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="LogPulse local launcher")
    parser.add_argument("--host", default="127.0.0.1", help="Backend bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Backend bind port (default: 8000)")
    parser.add_argument("--dev", action="store_true", help="Dev mode: run Vite dev server on port 3000")
    parser.add_argument("--skip-build", action="store_true", help="Skip npm build (use existing dist/)")
    parser.add_argument("--reload", action="store_true", help="Enable uvicorn --reload")
    args = parser.parse_args()

    # ------------------------------------------------------------------ #
    #  1. Ensure logs/ directory exists                                   #
    # ------------------------------------------------------------------ #
    os.makedirs("logs", exist_ok=True)

    # ------------------------------------------------------------------ #
    #  2. Build the frontend (production mode only)                       #
    # ------------------------------------------------------------------ #
    if not args.dev and not args.skip_build:
        build_frontend()

    # ------------------------------------------------------------------ #
    #  3. Start the log simulator                                         #
    # ------------------------------------------------------------------ #
    sim_cmd = [sys.executable, "-m", "simulator.log_simulator"]
    print(f"[run.py] Starting simulator:  {' '.join(sim_cmd)}", flush=True)
    sim_proc = _run(sim_cmd)
    time.sleep(0.5)  # let simulator create the log file

    # ------------------------------------------------------------------ #
    #  4. Start uvicorn (API + optional built frontend)                   #
    # ------------------------------------------------------------------ #
    api_cmd = [
        sys.executable, "-m", "uvicorn",
        "api.main:app",
        "--host", args.host,
        "--port", str(args.port),
        "--log-level", "warning",
    ]
    if args.reload:
        api_cmd.append("--reload")

    print(f"[run.py] Starting API:        {' '.join(api_cmd)}", flush=True)
    api_proc = _run(api_cmd)
    procs = [api_proc, sim_proc]

    # ------------------------------------------------------------------ #
    #  5. Optionally start the Vite dev server                            #
    # ------------------------------------------------------------------ #
    vite_proc = None
    if args.dev:
        time.sleep(1.5)  # wait for uvicorn to be ready before Vite starts proxying
        vite_cmd = ["npm", "run", "dev"]
        print(f"[run.py] Starting Vite dev:   {' '.join(vite_cmd)}", flush=True)
        vite_proc = _run(vite_cmd, cwd=FRONTEND_DIR)
        procs.append(vite_proc)
        print(f"[run.py] Dashboard (dev) ->   http://{args.host}:3000/", flush=True)
    else:
        print(f"[run.py] Dashboard ->         http://{args.host}:{args.port}/", flush=True)

    print(f"[run.py] API health ->        http://{args.host}:{args.port}/health", flush=True)
    print(f"[run.py] Prometheus metrics -> http://{args.host}:{args.port}/metrics", flush=True)
    print("[run.py] Press Ctrl+C to stop all processes.", flush=True)

    # ------------------------------------------------------------------ #
    #  6. Signal handling and watchdog                                    #
    # ------------------------------------------------------------------ #
    def _sig(signum=None, frame=None) -> None:  # noqa: ANN001
        _shutdown(procs)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _sig)
    if sys.platform != "win32":
        signal.signal(signal.SIGHUP, _sig)

    try:
        while True:
            for proc, name in zip(procs, ["API", "simulator", "Vite"][:len(procs)]):
                rc = proc.poll()
                if rc is not None:
                    print(f"[run.py] {name} exited with code {rc}. Shutting down.", flush=True)
                    _shutdown(procs)
                    sys.exit(rc)
            time.sleep(1)
    except KeyboardInterrupt:
        _shutdown(procs)


if __name__ == "__main__":
    main()
