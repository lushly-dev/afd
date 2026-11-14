"""The host-wide lane lock: one lane process per machine.

An exclusively created file (``lane.lock`` in the data directory, above every repository's
state) names the lane process: its pid, its start time and the repository it serves. A holder
that is no longer alive (checked through the world's processes, start time included where the
platform reports it) has died, and its lock is broken by the next taker. No ``flock``: the same
code runs on Windows and macOS. ``lane-start`` takes the lock and hands it to the detached
process it starts; that process adopts it.
"""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path

from botcore_factory.world import Processes


class LaneLocked(Exception):
    """Another live lane holds the host's lock."""

    def __init__(self, holder: dict) -> None:
        super().__init__(f"pid {holder.get('pid')} ({holder.get('repository', 'a lane')})")
        self.holder = holder


class HostLock:
    def __init__(self, path: Path, processes: Processes) -> None:
        self.path = path
        self.processes = processes

    def holder(self) -> dict | None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def live_holder(self) -> dict | None:
        """The holder, when its process still runs."""
        holder = self.holder()
        if holder is None or not isinstance(holder.get("pid"), int):
            return None
        return holder if self.processes.alive(holder["pid"], holder.get("startedAt")) else None

    def acquire(self, pid: int, **info) -> None:
        """Take the lock for ``pid``; a dead holder's lock is broken, a live one refuses."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        record = {"pid": pid, "startedAt": self.processes.start_time(pid), **info}
        for _ in range(2):
            try:
                descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                live = self.live_holder()
                if live is not None and live.get("pid") != pid:
                    raise LaneLocked(live) from None
                with contextlib.suppress(FileNotFoundError):
                    self.path.unlink()
                continue
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(record, handle)
            return
        raise LaneLocked(self.holder() or {})

    def hand_over(self, pid: int) -> None:
        """Name another process (the detached lane) as the holder, atomically."""
        record = {**(self.holder() or {}), "pid": pid, "startedAt": self.processes.start_time(pid)}
        temporary = self.path.with_name(f"{self.path.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(record), encoding="utf-8")
        os.replace(temporary, self.path)

    def release(self, pid: int | None = None) -> None:
        """Remove the lock; with ``pid``, only when that process holds it."""
        holder = self.holder()
        if pid is not None and holder is not None and holder.get("pid") != pid:
            return
        with contextlib.suppress(FileNotFoundError):
            self.path.unlink()
