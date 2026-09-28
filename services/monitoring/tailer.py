"""Rotation-safe tail of a continuously growing file (like `tail -F`).

On Windows, files are opened with O_BINARY | O_RDONLY via os.open() and wrapped with
os.fdopen() so that the kernel handle allows the file to be renamed or deleted while
this reader holds it open (avoids WinError 32).

On Windows st_ino is always 0 so rotation cannot be detected via inode. Instead,
the tailer reads to EOF on every poll and re-opens if the path now points to a
smaller file (truncation) or a brand-new file was created at the same path after
the old one was moved away.
"""

from __future__ import annotations

import os
import sys


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
        elif self._has_rotated(st):  # rotated: finish the old file, then start the new one
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
        if sys.platform == "win32":
            # Standard open() / os.open() on Windows does NOT set FILE_SHARE_DELETE,
            # so any attempt to rename/delete the file while we hold it open fails with
            # WinError 32.  We call CreateFileW directly with all three share flags so
            # that log-rotation (rename) works correctly on Windows too.
            import ctypes
            import ctypes.wintypes
            import msvcrt

            GENERIC_READ = 0x80000000
            FILE_SHARE_READ = 0x00000001
            FILE_SHARE_WRITE = 0x00000002
            FILE_SHARE_DELETE = 0x00000004
            OPEN_EXISTING = 3
            FILE_ATTRIBUTE_NORMAL = 0x80

            handle = ctypes.windll.kernel32.CreateFileW(  # type: ignore[attr-defined]
                ctypes.c_wchar_p(self.path),
                GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                None,
            )
            INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
            if handle == INVALID_HANDLE_VALUE:
                raise OSError(f"CreateFileW failed for {self.path!r}")
            fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
            self._fh = os.fdopen(fd, "rb")
        else:
            self._fh = open(self.path, "rb")  # noqa: SIM115 - long-lived handle
        self._inode = st.st_ino
        self._first_open = False
        self._buf = b""
        if seek_end:
            self._fh.seek(0, os.SEEK_END)


    def _has_rotated(self, st: os.stat_result) -> bool:
        """Return True if the path now points to a different file than the one we have open.

        On POSIX, compare inodes. On Windows st_ino is 0 for all files, so we
        compare the OS-level file identity via os.fstat() on the open fd.
        """
        if st.st_ino != 0 and self._inode != 0:
            # POSIX: reliable inode comparison
            return st.st_ino != self._inode
        # Windows fallback: compare st_ino from fstat of the open handle vs path stat.
        # If the path was renamed away and a new file created, fstat gives a different
        # nFileIndexHigh/nFileIndexLow (exposed as st_ino on Python 3.x Windows).
        try:
            open_st = os.fstat(self._fh.fileno())
            return open_st.st_ino != st.st_ino
        except OSError:
            return False

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
