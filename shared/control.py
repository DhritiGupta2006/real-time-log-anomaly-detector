"""Tiny file-based control channel between the API and the log simulator (shared volume)."""

from __future__ import annotations

import json
import os
import time

MODES = ("normal", "spike")


def read_mode(path: str) -> str:
    try:
        with open(path) as fh:
            mode = json.load(fh).get("mode", "normal")
        return mode if mode in MODES else "normal"
    except (OSError, ValueError):
        return "normal"


def write_mode(path: str, mode: str) -> None:
    if mode not in MODES:
        raise ValueError(mode)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w") as fh:
        json.dump({"mode": mode, "ts": time.time()}, fh)
    os.replace(tmp, path)
