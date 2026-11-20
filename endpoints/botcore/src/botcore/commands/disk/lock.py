"""One disk-* run at a time per machine: an exclusive lock file with the holder's pid."""

from __future__ import annotations

import json
import os
import socket
import sys
import time
from pathlib import Path

STALE_SECONDS = 6 * 3600


class LockHeld(Exception):
    """Another live run holds the lock."""


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class RunLock:
    """`with RunLock(path):` holds the machine's run lock or raises LockHeld."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.held = False

    def _take(self) -> bool:
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            return False
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump({"pid": os.getpid(), "host": socket.gethostname(), "at": time.time()}, handle)
        self.held = True
        return True

    def _stale(self) -> bool:
        try:
            holder = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return True
        too_old = time.time() - float(holder.get("at", 0)) > STALE_SECONDS
        return too_old or not pid_alive(int(holder.get("pid", 0)))

    def __enter__(self) -> RunLock:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self._take():
            return self
        if self._stale():
            self.path.unlink(missing_ok=True)
            if self._take():
                return self
        raise LockHeld(f"another disk run holds {self.path}")

    def __exit__(self, *_exc: object) -> None:
        if self.held:
            self.path.unlink(missing_ok=True)
            self.held = False
