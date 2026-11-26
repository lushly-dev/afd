"""The host-wide lane lock and durable file-locking primitives.

An exclusively created file (``lane.lock`` in the data directory, above every repository's
state) names the lane process: its pid, its start time and the repository it serves. A holder
that is no longer alive (checked through the world's processes, start time included where the
platform reports it) has died, and its lock is broken by the next taker only if its inode and
content are unchanged since inspection; a lock being written this instant (empty, under five
seconds old) is not. No ``flock``: the same code runs on Windows and macOS. ``lane-start``
takes the lock and hands it to the detached process it starts; that process adopts it.
"""

from __future__ import annotations

import contextlib
import errno
import json
import os
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from botcore_factory.world import Processes

#: How long an empty or unreadable lock counts as being written rather than abandoned.
WRITING_GRACE_SECONDS = 5
_WINDOWS = os.name == "nt"
_WINDOWS_UNLINK_ATTEMPTS = 20
_BREAK_GUARD_TIMEOUT = 5.0


@dataclass(frozen=True)
class LockSnapshot:
    """Identity and exact bytes read from a lock file via one file descriptor."""

    dev: int
    ino: int
    mtime: float
    raw: bytes

    def holder(self) -> dict[str, Any] | None:
        try:
            data = json.loads(self.raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return None
        return data if isinstance(data, dict) else None


def fsync_dir(directory: Path) -> None:
    """Flush directory metadata to disk on POSIX; Windows has no directory fsync."""
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(directory, flags)
    except OSError:
        if os.name == "nt":
            return
        raise
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def replace_file(source: Path, target: Path, attempts: int = 20) -> None:
    """``os.replace``, retried briefly: Windows refuses while another process reads the target."""
    for attempt in range(attempts):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.05)


def atomic_write_text(target: Path, content: str) -> None:
    """Write ``content`` to a temp file, fsync it and its directory, replace, and fsync again."""
    directory = target.parent
    directory.mkdir(parents=True, exist_ok=True)
    temporary = (
        directory / f"{target.name}.{os.getpid()}.{time.monotonic_ns()}.{uuid.uuid4().hex[:8]}.tmp"
    )
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        fsync_dir(directory)
        replace_file(temporary, target)
        fsync_dir(directory)
    except BaseException:
        with contextlib.suppress(OSError):
            temporary.unlink()
        raise


def read_lock_snapshot(path: Path) -> LockSnapshot | None:
    """Read a lock file's ``(dev, ino, mtime, bytes)`` from a single open descriptor.

    Returns ``None`` only when ``path`` does not exist. Raises ``OSError`` if ``path`` exists
    but cannot be opened or read, so callers never confuse an unreadable lock with a missing one.
    """
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except FileNotFoundError:
        return None
    with os.fdopen(descriptor, "rb") as handle:
        st = os.fstat(handle.fileno())
        raw = handle.read()
    return LockSnapshot(dev=st.st_dev, ino=st.st_ino, mtime=st.st_mtime, raw=raw)


def _unlink_same_inode(path: Path, expected_dev: int, expected_ino: int) -> bool:
    """Remove ``path`` only while its ``(st_dev, st_ino)`` matches, retrying Windows locks."""
    for attempt in range(_WINDOWS_UNLINK_ATTEMPTS):
        try:
            st = path.stat()
        except FileNotFoundError:
            return False
        except OSError:
            if os.name == "nt" and attempt < _WINDOWS_UNLINK_ATTEMPTS - 1:
                time.sleep(0.05)
                continue
            return False
        if (st.st_dev, st.st_ino) != (expected_dev, expected_ino):
            return False
        try:
            path.unlink()
            return True
        except FileNotFoundError:
            return False
        except PermissionError:
            if os.name == "nt" and attempt < _WINDOWS_UNLINK_ATTEMPTS - 1:
                time.sleep(0.05)
                continue
            return False
    return False


def unlink_if_unchanged(path: Path, expected: LockSnapshot) -> bool:
    """Remove ``path`` only if its device/inode and exact bytes still match ``expected``."""
    for attempt in range(_WINDOWS_UNLINK_ATTEMPTS):
        try:
            current = read_lock_snapshot(path)
        except OSError:
            if os.name == "nt" and attempt < _WINDOWS_UNLINK_ATTEMPTS - 1:
                time.sleep(0.05)
                continue
            return False
        if current is None:
            return False
        if (current.dev, current.ino) != (expected.dev, expected.ino) or (
            current.raw != expected.raw
        ):
            return False
        try:
            path.unlink()
            return True
        except FileNotFoundError:
            return False
        except PermissionError:
            if os.name == "nt" and attempt < _WINDOWS_UNLINK_ATTEMPTS - 1:
                time.sleep(0.05)
                continue
            return False
    return False


def _name_exists(path: Path) -> bool:
    """Whether ``path`` names anything, a file being deleted on Windows included (CPython's
    ``lstat`` falls back to the directory listing when the file itself refuses access)."""
    return os.path.lexists(path)


def _create_exclusive(path: Path) -> int:
    """``os.open`` with ``O_CREAT | O_EXCL``, raising ``FileExistsError`` while ``path`` exists.

    Windows refuses to create a name whose previous file is still being deleted (delete
    pending) with access denied. While the name is still there the lock counts as held; once it
    is gone the create is retried, and access still denied then is a real permission problem,
    raised as it is.
    """
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    for attempt in range(_WINDOWS_UNLINK_ATTEMPTS):
        try:
            return os.open(path, flags)
        except PermissionError as exc:
            if not _WINDOWS:
                raise
            if _name_exists(path):
                raise FileExistsError(
                    errno.EEXIST, "a lock file is being deleted", str(path)
                ) from exc
            if attempt == _WINDOWS_UNLINK_ATTEMPTS - 1:
                raise
            time.sleep(0.05)
    raise AssertionError("unreachable")  # pragma: no cover


def write_exclusive_lock(path: Path, raw: bytes) -> LockSnapshot:
    """Create ``path`` exclusively, write and fsync ``raw`` and parent dir, clean up on error.

    Raises ``FileExistsError`` while ``path`` exists, a Windows file still being deleted
    included (``_create_exclusive``): callers wait or retry as for any held lock.
    """
    descriptor = _create_exclusive(path)
    created_dev: int | None = None
    created_ino: int | None = None
    try:
        with os.fdopen(descriptor, "wb") as handle:
            st = os.fstat(handle.fileno())
            created_dev, created_ino = st.st_dev, st.st_ino
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
            st = os.fstat(handle.fileno())
            snapshot = LockSnapshot(dev=st.st_dev, ino=st.st_ino, mtime=st.st_mtime, raw=raw)
        fsync_dir(path.parent)
        return snapshot
    except BaseException:
        if created_dev is not None and created_ino is not None:
            _unlink_same_inode(path, created_dev, created_ino)
        raise


@contextlib.contextmanager
def stale_break_guard(lock_path: Path, processes: Processes) -> Iterator[bool]:
    """Serialize stale-lock replacement across contenders via a short-lived ``.break`` mutex.

    Yields ``True`` when this contender holds the guard and may verify-and-replace the stale lock,
    or ``False`` when another live contender holds the guard.
    """
    guard_path = lock_path.with_name(f"{lock_path.name}.break")
    guard_raw = json.dumps(
        {"pid": os.getpid(), "startedAt": processes.start_time(os.getpid())}
    ).encode("utf-8")
    mine: LockSnapshot | None = None
    for _ in range(3):
        try:
            mine = write_exclusive_lock(guard_path, guard_raw)
            break
        except FileExistsError:
            try:
                existing = read_lock_snapshot(guard_path)
            except OSError:
                break
            if existing is None:
                continue
            holder = existing.holder()
            if holder is None:
                if time.time() - existing.mtime < _BREAK_GUARD_TIMEOUT:
                    break
            else:
                pid, started = holder.get("pid"), holder.get("startedAt")
                if isinstance(pid, int) and processes.alive(pid, started):
                    break
            if not unlink_if_unchanged(guard_path, existing):
                break
    if mine is None:
        yield False
        return
    try:
        yield True
    finally:
        unlink_if_unchanged(guard_path, mine)


def replace_stale_lock(
    path: Path,
    expected: LockSnapshot,
    new_raw: bytes,
    processes: Processes,
) -> LockSnapshot | None:
    """Atomically replace a stale lock with ``new_raw`` only if inode and bytes are unchanged.

    Serialized across stale-lock contenders by ``stale_break_guard`` and swapped via
    ``os.replace`` so no contender can slip in between removal and creation.
    """
    with stale_break_guard(path, processes) as acquired:
        if not acquired:
            return None
        try:
            current = read_lock_snapshot(path)
        except OSError:
            return None
        if current is None:
            return None
        if (current.dev, current.ino) != (expected.dev, expected.ino) or (
            current.raw != expected.raw
        ):
            return None
        directory = path.parent
        temporary = (
            directory
            / f"{path.name}.{os.getpid()}.{time.monotonic_ns()}.{uuid.uuid4().hex[:8]}.tmp"
        )
        try:
            with temporary.open("wb") as handle:
                handle.write(new_raw)
                handle.flush()
                os.fsync(handle.fileno())
                st = os.fstat(handle.fileno())
                snapshot = LockSnapshot(
                    dev=st.st_dev, ino=st.st_ino, mtime=st.st_mtime, raw=new_raw
                )
            fsync_dir(directory)
            replace_file(temporary, path)
            fsync_dir(directory)
            return snapshot
        except BaseException:
            with contextlib.suppress(OSError):
                temporary.unlink()
            raise


class LaneLocked(Exception):
    """Another live lane holds the host's lock."""

    def __init__(self, holder: dict[str, Any]) -> None:
        super().__init__(f"pid {holder.get('pid')} ({holder.get('repository', 'a lane')})")
        self.holder = holder


class HostLock:
    def __init__(self, path: Path, processes: Processes) -> None:
        self.path = path
        self.processes = processes

    def holder(self) -> dict[str, Any] | None:
        try:
            snapshot = read_lock_snapshot(self.path)
        except OSError:
            return None
        return snapshot.holder() if snapshot is not None else None

    def _live_holder_from(self, snapshot: LockSnapshot | None) -> dict[str, Any] | None:
        if snapshot is None:
            return None
        holder = snapshot.holder()
        if holder is None or not isinstance(holder.get("pid"), int):
            if time.time() - snapshot.mtime < WRITING_GRACE_SECONDS:
                return {"pid": None, "writing": True}
            return None
        return holder if self.processes.alive(holder["pid"], holder.get("startedAt")) else None

    def live_holder(self) -> dict[str, Any] | None:
        """The holder, when its process still runs; a lock being written counts as live (its
        pid is then None)."""
        try:
            snapshot = read_lock_snapshot(self.path)
        except OSError:
            return {"pid": None, "unreadable": True}
        return self._live_holder_from(snapshot)

    def acquire(self, pid: int, **info: Any) -> None:
        """Take the lock for ``pid``; a dead holder's lock is replaced atomically only if its
        inode and bytes are unchanged, a live one refuses."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        record = {"pid": pid, "startedAt": self.processes.start_time(pid), **info}
        raw = json.dumps(record).encode("utf-8")
        for _ in range(3):
            try:
                write_exclusive_lock(self.path, raw)
                return
            except FileExistsError:
                try:
                    snapshot = read_lock_snapshot(self.path)
                except OSError:
                    raise LaneLocked({"pid": None, "unreadable": True}) from None
                if snapshot is None:
                    continue
                live = self._live_holder_from(snapshot)
                if live is not None and live.get("pid") != pid:
                    raise LaneLocked(live) from None
                if replace_stale_lock(self.path, snapshot, raw, self.processes) is not None:
                    return
                live_after = self.live_holder()
                if live_after is not None and live_after.get("pid") != pid:
                    raise LaneLocked(live_after) from None
                continue
        raise LaneLocked(self.holder() or {})

    def hand_over(self, pid: int, *, from_pid: int | None = None) -> None:
        """Name another process (the detached lane) as the holder, atomically and durably. With
        ``from_pid``, refuse (``LaneLocked``) unless that process still holds the lock."""
        holder = self.holder()
        if from_pid is not None and (holder is None or holder.get("pid") != from_pid):
            raise LaneLocked(holder or {})
        record = {**(holder or {}), "pid": pid, "startedAt": self.processes.start_time(pid)}
        atomic_write_text(self.path, json.dumps(record))

    def release(self, pid: int) -> None:
        """Remove the lock, only when ``pid`` holds it (or no one readable does) and unchanged."""
        try:
            snapshot = read_lock_snapshot(self.path)
        except OSError:
            return
        if snapshot is None:
            return
        holder = snapshot.holder()
        if holder is not None and holder.get("pid") != pid:
            return
        if holder is None and time.time() - snapshot.mtime < WRITING_GRACE_SECONDS:
            return  # Someone is taking it this instant.
        unlink_if_unchanged(self.path, snapshot)
