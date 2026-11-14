"""The lane's own state: one directory per repository, one lock, atomic writes, a log.

State lives on the lane host in the per-user application data directory (``platformdirs``
``user_data_dir``, which the OS does not purge like a cache), keyed by repository. The
``BOTCORE_FACTORY_DATA_DIR`` environment variable replaces that base directory, for tests.

- ``state.json`` holds the lane, cells, queue, held branches, events, runs and dial overrides.
  Every write takes the lock, reads, changes and writes to a temporary file that replaces the
  old one (write-then-rename), so a reader never sees half a file.
- ``state.lock`` is the lock: created exclusively, holding the holder's pid and start time.
  A lock whose holder is no longer alive (checked through the world's processes, start time
  included where the platform reports it) is stale and is broken. No ``flock``: the same code
  runs on Windows and macOS.
- ``log.jsonl`` is append-only: every change, one JSON line each, never rewritten.

Claims are not here: they live on GitHub (see ``claims``).
"""

from __future__ import annotations

import contextlib
import copy
import json
import os
import re
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import platformdirs

from botcore_factory.world import Clock, Processes

DATA_DIR_ENV = "BOTCORE_FACTORY_DATA_DIR"
APP_NAME = "botcore-factory"
SCHEMA_VERSION = 1
_REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
STATE_SECTIONS: dict[str, Any] = {
    "lane": {},
    "dials": {},
    "cells": [],
    "queue": [],
    "held": [],
    "events": [],
    "runs": [],
    "baseline": {},
    "review": {},
    "window": {},
    "experiments": [],
    "watching": [],
    "slots": [],
}
LANE_DEFAULTS = {
    "running": False,
    "paused": False,
    "pauseReason": None,
    "draining": False,
    "runId": None,
}


class StateError(Exception):
    """The state could not be read, locked or written."""


class StateLocked(StateError):
    """Another live process holds the state lock."""


def repository_key(repository: str) -> str:
    """A directory name for ``owner/name``."""
    if not _REPOSITORY.fullmatch(repository) or ".." in repository:
        raise StateError(f"Not a repository name: {repository!r}; expected owner/name")
    return repository.replace("/", "--").lower()


def default_base(env: dict[str, str] | None = None) -> Path:
    env = os.environ if env is None else env
    override = env.get(DATA_DIR_ENV)
    if override:
        return Path(override)
    return Path(platformdirs.user_data_dir(APP_NAME, appauthor=False))


def empty_state() -> dict:
    state = copy.deepcopy(STATE_SECTIONS)
    state["lane"] = dict(LANE_DEFAULTS)
    state["version"] = SCHEMA_VERSION
    return state


class StateStore:
    """The lane's state for one repository."""

    def __init__(
        self,
        root: Path,
        processes: Processes,
        clock: Clock,
        *,
        lock_timeout: float = 30.0,
    ) -> None:
        self.root = root
        self.processes = processes
        self.clock = clock
        self.lock_timeout = lock_timeout

    @classmethod
    def for_repository(
        cls,
        repository: str,
        processes: Processes,
        clock: Clock,
        *,
        base: Path | None = None,
    ) -> StateStore:
        return cls((base or default_base()) / repository_key(repository), processes, clock)

    @property
    def state_path(self) -> Path:
        return self.root / "state.json"

    @property
    def lock_path(self) -> Path:
        return self.root / "state.lock"

    @property
    def log_path(self) -> Path:
        return self.root / "log.jsonl"

    def read(self) -> dict:
        """The current state; an absent file is the empty state."""
        try:
            raw = self.state_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return empty_state()
        except OSError as exc:
            raise StateError(f"Cannot read {self.state_path}: {exc}") from exc
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise StateError(f"{self.state_path} is not JSON: {exc}") from exc
        if not isinstance(data, dict) or data.get("version", SCHEMA_VERSION) != SCHEMA_VERSION:
            raise StateError(f"{self.state_path} has an unknown layout")
        state = empty_state()
        state.update(data)
        state["lane"] = {**LANE_DEFAULTS, **(data.get("lane") or {})}
        return state

    @contextlib.contextmanager
    def update(self, reason: str) -> Iterator[dict]:
        """Lock, read, yield the state to change, then write it if it changed.

        A caller that refuses leaves the state unchanged, and nothing is written or logged.
        """
        with self.locked():
            state = self.read()
            before = copy.deepcopy(state)
            yield state
            if state != before:
                self._write(state)
                self.log({"kind": "state", "reason": reason})

    def log(self, record: dict) -> None:
        """Append one record to the log; the log is never rewritten."""
        line = json.dumps({"at": self._now(), **record}, sort_keys=True)
        self.root.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def read_log(self) -> list[dict]:
        try:
            lines = self.log_path.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            return []
        return [json.loads(line) for line in lines if line.strip()]

    def _now(self) -> str:
        return self.clock.now().isoformat().replace("+00:00", "Z")

    def _write(self, state: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        temporary = self.root / f"state.json.{os.getpid()}.tmp"
        temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        _replace(temporary, self.state_path)

    @contextlib.contextmanager
    def locked(self) -> Iterator[None]:
        """Hold the state lock: an exclusively created file naming this process."""
        self.root.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + self.lock_timeout
        holder = {"pid": os.getpid(), "startedAt": self.processes.start_time(os.getpid())}
        while True:
            try:
                descriptor = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                if self._break_if_stale():
                    continue
                if time.monotonic() >= deadline:
                    raise StateLocked(
                        f"{self.lock_path} is held by a live process: {self._holder()}"
                    ) from None
                time.sleep(0.05)
                continue
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump({**holder, "takenAt": self._now()}, handle)
            break
        try:
            yield
        finally:
            with contextlib.suppress(FileNotFoundError):
                self.lock_path.unlink()

    def _holder(self) -> dict | None:
        try:
            data = json.loads(self.lock_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def _break_if_stale(self) -> bool:
        holder = self._holder()
        if holder is None:
            # Being written this instant, or left empty by a crash: judge by age.
            try:
                age = time.time() - self.lock_path.stat().st_mtime
            except FileNotFoundError:
                return True
            if age < 5:
                return False
        else:
            pid, started = holder.get("pid"), holder.get("startedAt")
            if isinstance(pid, int) and self.processes.alive(pid, started):
                return False
        with contextlib.suppress(FileNotFoundError):
            self.lock_path.unlink()
        self.log({"kind": "lock-broken", "holder": holder})
        return True


def _replace(source: Path, target: Path, attempts: int = 20) -> None:
    """os.replace, retried briefly: Windows refuses while another process reads the target."""
    for attempt in range(attempts):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.05)
