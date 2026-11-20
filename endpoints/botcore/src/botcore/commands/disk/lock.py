"""One disk-* run at a time per machine: a lock the operating system holds for the process.

The lock file is never deleted. A run opens it and asks the kernel for an exclusive,
non-blocking lock (`flock` on macOS and Linux, `msvcrt.locking` on Windows). The kernel drops
it when the process exits however it exits, so there is no stale-lock guessing and no window in
which two runs can both believe they hold it. The holder's pid goes in a separate `.json` file
beside it for people to read: on Windows the locked file itself cannot be read while held.
"""

from __future__ import annotations

import json
import os
import socket
import time
from pathlib import Path


class LockHeld(Exception):
    """Another live run holds the lock."""


def _try_lock(fd: int) -> bool:
    if os.name == "nt":
        import msvcrt

        try:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True
    import fcntl

    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False
    return True


def _unlock(fd: int) -> None:
    if os.name == "nt":
        import msvcrt

        try:
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
        return
    import fcntl

    fcntl.flock(fd, fcntl.LOCK_UN)


def record_path(path: Path) -> Path:
    return path.with_name(path.name + ".json")


def holder(path: Path) -> dict:
    """Who last took the lock (for messages only)."""
    try:
        data = json.loads(record_path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


class RunLock:
    """`with RunLock(path):` holds the machine's run lock or raises LockHeld."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.fd: int | None = None

    @property
    def held(self) -> bool:
        return self.fd is not None

    def __enter__(self) -> RunLock:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        if not _try_lock(fd):
            os.close(fd)
            who = holder(self.path)
            detail = f" (pid {who['pid']} on {who.get('host', '?')})" if "pid" in who else ""
            raise LockHeld(f"another disk run holds {self.path}{detail}")
        self.fd = fd
        record = {"pid": os.getpid(), "host": socket.gethostname(), "at": time.time()}
        try:
            record_path(self.path).write_text(json.dumps(record), encoding="utf-8")
        except OSError:
            pass  # only a courtesy for messages; the kernel lock is what counts
        return self

    def __exit__(self, *_exc: object) -> None:
        if self.fd is not None:
            _unlock(self.fd)
            os.close(self.fd)
            self.fd = None
