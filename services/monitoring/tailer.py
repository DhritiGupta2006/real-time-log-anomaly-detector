"""Rotation-safe tail of a continuously growing file (like `tail -F`)."""

from __future__ import annotations

import os


class LogTailer:
    def __init__(self, path: str, from_start: bool = False, max_read_bytes: int = 4 * 1024 * 1024):
        self.path = path
        self.from_start = from_start
        self.max_read_bytes = max_read_bytes  # bounds work per poll during traffic spikes
        self.rotations = 0
        self._fh = None
        self._inode: int | None = None
        self._buf = b""  # holds a trailing partial line until its newline arrives
        self._first_open = True

    def read_new(self) -> list[str]:
        lines: list[str] = []
        try:
            st = os.stat(self.path)
        except OSError:  # file missing (rotated away / not created yet)
            if self._fh is not None:
                lines += self._drain()
                self._close()
            return lines
        if self._fh is None:
            self._open(st, seek_end=self._first_open and not self.from_start)
        elif st.st_ino != self._inode:  # rotated: finish the old file, then start the new one
            lines += self._drain()
            self._close()
            self.rotations += 1
            self._open(st, seek_end=False)
        elif st.st_size < self._fh.tell():  # truncated in place
            self._fh.seek(0)
            self._buf = b""
            self.rotations += 1
        lines += self._drain()
        return lines

    def _open(self, st: os.stat_result, seek_end: bool) -> None:
        self._fh = open(self.path, "rb")  # noqa: SIM115 - long-lived handle
        self._inode = st.st_ino
        self._first_open = False
        self._buf = b""
        if seek_end:
            self._fh.seek(0, os.SEEK_END)

    def _close(self) -> None:
        if self._fh is not None:
            self._fh.close()
        self._fh = None
        self._inode = None
        self._buf = b""

    def _drain(self) -> list[str]:
        if self._fh is None:
            return []
        chunk = self._fh.read(self.max_read_bytes)
        if not chunk:
            return []
        parts = (self._buf + chunk).split(b"\n")
        self._buf = parts.pop()
        if len(self._buf) > 1024 * 1024:  # runaway line without newline: drop it
            self._buf = b""
        return [p.decode("utf-8", "replace").rstrip("\r") for p in parts]
