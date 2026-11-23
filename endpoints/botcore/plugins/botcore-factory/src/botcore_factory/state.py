"""The lane's own state: one directory per repository, one lock, atomic writes, a log.

State lives on the lane host in the per-user application data directory (``platformdirs``
``user_data_dir``, which the OS does not purge like a cache), keyed by repository. The
``BOTCORE_FACTORY_DATA_DIR`` environment variable replaces that base directory, for tests.

- ``state.json`` holds the lane, cells, queue, held branches, events, runs and dial overrides.
  Every write takes the lock, reads, trims bounded history, and writes to a temporary file that
  is fsynced (along with its parent directory before and after ``os.replace``), so a reader
  never sees half a file and a crash does not leave a torn write.
  Trimming policy: open events are never dropped; closed events are capped at
  ``MAX_CLOSED_EVENTS`` (newest kept, ``eventSeq`` preserved). Active and unsummarized runs are
  never dropped; finished runs are capped at ``MAX_FINISHED_RUNS`` (newest kept, ``runSeq``
  preserved).
- ``state.lock`` is the lock: created exclusively, holding the holder's pid and start time.
  A lock whose holder is no longer alive (checked through the world's processes, start time
  included where the platform reports it) is stale and is broken only if its inode and exact
  bytes have not changed since inspection. No ``flock``: the same code runs on Windows and macOS.
- ``log.jsonl`` is append-only: every change, one JSON line each, never rewritten.
- ``records.jsonl`` is append-only too: the measurement records (``records``) every number of
  the lane's report and the improvement loop is computed from. ``records-summary.json`` keeps
  incremental branch and run summaries by byte offset into ``records.jsonl`` so hot lane steps
  never re-read the full log (chosen over SQLite to keep the append-only JSONL log authoritative
  and rebuildable with zero schema-migration or extra runtime dependencies).

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

from botcore_factory.claims import parse_time
from botcore_factory.lock import (
    WRITING_GRACE_SECONDS,
    LockSnapshot,
    atomic_write_text,
    fsync_dir,
    read_lock_snapshot,
    replace_file,
    replace_stale_lock,
    stale_break_guard,
    unlink_if_unchanged,
    write_exclusive_lock,
)
from botcore_factory.world import Clock, Processes

DATA_DIR_ENV = "BOTCORE_FACTORY_DATA_DIR"
APP_NAME = "botcore-factory"
SCHEMA_VERSION = 1
RECORD_SUMMARY_VERSION = 1
#: Maximum closed events kept in ``state.json`` (open events are never trimmed).
MAX_CLOSED_EVENTS = 200
#: Maximum finished runs kept in ``state.json`` (active/unsummarized runs are never trimmed).
MAX_FINISHED_RUNS = 100
_REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
_EVENT_ID = re.compile(r"ev-(\d+)")
_RUN_ID = re.compile(r"run-(\d+)")
_ATTEMPT_RECORD_KINDS = frozenset(
    {"enqueued", "queued", "held", "validation-started", "validated", "ejected", "merged"}
)
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


def trim_state(
    state: dict,
    *,
    max_closed_events: int = MAX_CLOSED_EVENTS,
    max_finished_runs: int = MAX_FINISHED_RUNS,
) -> None:
    """Enforce bounded growth on closed events and finished runs, preserving sequence numbers."""
    events = state.get("events")
    if isinstance(events, list):
        closed_indices = [i for i, e in enumerate(events) if not e.get("open", True)]
        excess = len(closed_indices) - max_closed_events
        if excess > 0:
            drop = set(closed_indices[:excess])
            dropped_nums = [
                int(m[1]) for i in drop if (m := _EVENT_ID.fullmatch(str(events[i].get("id"))))
            ]
            if dropped_nums:
                state["eventSeq"] = max(state.get("eventSeq", 0), max(dropped_nums))
            state["events"] = [e for i, e in enumerate(events) if i not in drop]

    runs = state.get("runs")
    if isinstance(runs, list):
        active_run = (state.get("lane") or {}).get("runId")
        finished_indices = [
            i for i, r in enumerate(runs) if r.get("id") != active_run and "merged" in r
        ]
        excess = len(finished_indices) - max_finished_runs
        if excess > 0:
            drop = set(finished_indices[:excess])
            dropped_nums = [
                int(m[1]) for i in drop if (m := _RUN_ID.fullmatch(str(runs[i].get("id"))))
            ]
            if dropped_nums:
                state["runSeq"] = max(state.get("runSeq", 0), max(dropped_nums))
            state["runs"] = [r for i, r in enumerate(runs) if i not in drop]


def _empty_record_summary() -> dict[str, Any]:
    return {
        "version": RECORD_SUMMARY_VERSION,
        "dev": None,
        "ino": None,
        "offset": 0,
        "branches": {},
        "runs": {},
    }


def _empty_run_accumulator() -> dict[str, Any]:
    return {
        "validations": 0,
        "totalMinutes": 0.0,
        "reruns": 0,
        "staleRuns": 0,
        "baseAdvances": 0,
        "rerunLimitAdvances": 0,
        "provenanceRerecorded": 0,
        "ejections": 0,
        "excusedEjections": 0,
        "foremanWakes": 0,
        "nextAttemptOrder": 0,
        "attempts": {},
    }


def _fold_record(summary: dict[str, Any], record: dict[str, Any]) -> None:  # noqa: C901, PLR0912
    kind = record.get("kind")
    branch = record.get("branch")
    if branch:
        branches = summary["branches"]
        bstats = branches.setdefault(branch, {})
        if kind == "enqueued":
            attempt = record.get("attempt")
            if isinstance(attempt, int):
                bstats["maxAttempt"] = max(bstats.get("maxAttempt", 0), attempt)
            at = record.get("at")
            if isinstance(at, str):
                prev = bstats.get("firstEnqueuedAt")
                if prev is None or at < prev:
                    bstats["firstEnqueuedAt"] = at
        elif kind == "ejected":
            bstats["lastEjection"] = record

    run_id = record.get("runId")
    if run_id is None:
        return
    run = summary["runs"].setdefault(run_id, _empty_run_accumulator())
    attempts: dict[str, dict[str, Any]] = run["attempts"]
    attempt_entry: dict[str, Any] | None = None
    if kind in _ATTEMPT_RECORD_KINDS and "attempt" in record:
        key = f"{branch or ''}\0{record['attempt']}"
        attempt_entry = attempts.get(key)
        if attempt_entry is None:
            order = int(run.get("nextAttemptOrder", 0))
            run["nextAttemptOrder"] = order + 1
            attempt_entry = {"branch": branch, "attempt": record["attempt"], "order": order}
            attempts[key] = attempt_entry
        if kind == "enqueued":
            attempt_entry["route"] = record.get("route")
            attempt_entry["plan"] = record.get("plan")
        elif kind == "ejected":
            attempt_entry["outcome"] = "ejected"
        elif kind == "merged":
            attempt_entry["outcome"] = "merged"
            attempt_entry["pr"] = record["pr"]

    if kind == "validated":
        minutes = record.get("minutes", 0)
        run["validations"] += 1
        run["totalMinutes"] += minutes
        if attempt_entry is not None:
            attempt_entry["validatedMinutes"] = attempt_entry.get("validatedMinutes", 0) + minutes
    elif kind == "rerun":
        reason = record.get("reason")
        if reason == "main-moved":
            run["reruns"] += 1
        elif reason == "restart":
            run["staleRuns"] += 1
    elif kind == "base-advanced":
        run["baseAdvances"] += 1
        if record.get("reason") == "rerun-limit":
            run["rerunLimitAdvances"] += 1
    elif kind == "provenance-rerecorded":
        run["provenanceRerecorded"] += 1
    elif kind == "ejected":
        run["ejections"] += 1
        if record.get("counted") is False:
            run["excusedEjections"] += 1
    elif kind == "ejection-excused":
        run["excusedEjections"] += 1
    elif kind == "wake":
        run["foremanWakes"] += 1
    elif kind == "run-stopped":
        run["attempts"] = {k: v for k, v in attempts.items() if v.get("outcome") == "merged"}


def _build_run_summary(
    run_acc: dict[str, Any] | None,
    started_at: str | None,
    stopped_at: str,
) -> dict[str, Any]:
    acc = run_acc or _empty_run_accumulator()
    merged_rows = sorted(
        (att for att in acc["attempts"].values() if att.get("outcome") == "merged"),
        key=lambda att: att.get("order", 0),
    )
    productive = sum(att.get("validatedMinutes", 0) for att in merged_rows)
    total = acc["totalMinutes"]
    hours = 0.0
    if started_at:
        hours = (parse_time(stopped_at) - parse_time(started_at)).total_seconds() / 3600
    return {
        "hours": round(hours, 2),
        "merged": len(merged_rows),
        "validations": acc["validations"],
        "productiveShare": round(productive / total, 2) if total else None,
        "reruns": acc["reruns"],
        "staleRuns": acc["staleRuns"],
        "baseAdvances": acc["baseAdvances"],
        "rerunLimitAdvances": acc["rerunLimitAdvances"],
        "provenanceRerecorded": acc["provenanceRerecorded"],
        "ejections": acc["ejections"],
        "excusedEjections": acc["excusedEjections"],
        "foremanWakes": acc["foremanWakes"],
        "prs": [
            {
                "number": row["pr"],
                "branch": row["branch"],
                "route": row.get("route"),
                "plan": row.get("plan"),
            }
            for row in merged_rows
        ],
    }


class StateStore:
    """The lane's state for one repository."""

    def __init__(
        self,
        root: Path,
        processes: Processes,
        clock: Clock,
        *,
        lock_timeout: float = 30.0,
        max_closed_events: int = MAX_CLOSED_EVENTS,
        max_finished_runs: int = MAX_FINISHED_RUNS,
    ) -> None:
        self.root = root
        self.processes = processes
        self.clock = clock
        self.lock_timeout = lock_timeout
        self.max_closed_events = max_closed_events
        self.max_finished_runs = max_finished_runs

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

    @property
    def records_summary_path(self) -> Path:
        return self.root / "records-summary.json"

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
        """Lock, read, yield the state to change, trim bounded sections, then write if changed.

        A caller that refuses leaves the state unchanged, and nothing is written or logged.
        """
        with self.locked():
            state = self.read()
            before = copy.deepcopy(state)
            yield state
            trim_state(
                state,
                max_closed_events=self.max_closed_events,
                max_finished_runs=self.max_finished_runs,
            )
            if state != before:
                self._write(state)
                self.log({"kind": "state", "reason": reason})

    def log(self, record: dict) -> None:
        """Append one record to the log; the log is never rewritten."""
        self._append(self.log_path, {"at": self._now(), **record})

    def read_log(self) -> list[dict]:
        return self._read_lines(self.log_path)

    @property
    def records_path(self) -> Path:
        return self.root / "records.jsonl"

    def append_record(self, record: dict) -> None:
        """Append one measurement record and incrementally advance the record summary."""
        self._append(self.records_path, record)
        self._sync_record_summary(strict_persist=True)

    def read_records(self) -> list[dict]:
        return self._read_lines(self.records_path)

    def record_summary(self) -> dict[str, Any]:
        """Incremental summary of ``records.jsonl``, reading only bytes appended since last sync."""
        return self._sync_record_summary(strict_persist=False)

    def next_attempt(self, branch: str) -> int:
        info = self.record_summary()["branches"].get(branch)
        return (info.get("maxAttempt", 0) if info else 0) + 1

    def first_enqueued(self, branch: str) -> str | None:
        info = self.record_summary()["branches"].get(branch)
        return info.get("firstEnqueuedAt") if info else None

    def last_ejection(self, branch: str) -> dict | None:
        info = self.record_summary()["branches"].get(branch)
        ejection = info.get("lastEjection") if info else None
        return copy.deepcopy(ejection) if isinstance(ejection, dict) else None

    def summarize_run(self, run_id: str, started_at: str | None, stopped_at: str) -> dict:
        run_acc = self.record_summary()["runs"].get(run_id)
        return _build_run_summary(run_acc, started_at, stopped_at)

    def _load_record_summary(self) -> dict[str, Any]:
        try:
            data = json.loads(self.records_summary_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, ValueError):
            return _empty_record_summary()
        if (
            not isinstance(data, dict)
            or data.get("version") != RECORD_SUMMARY_VERSION
            or not isinstance(data.get("offset"), int)
            or data["offset"] < 0
            or not isinstance(data.get("branches"), dict)
            or not isinstance(data.get("runs"), dict)
        ):
            return _empty_record_summary()
        return data

    def _persist_record_summary(self, summary: dict[str, Any], *, strict: bool) -> None:
        payload = json.dumps(summary, sort_keys=True) + "\n"
        if strict:
            atomic_write_text(self.records_summary_path, payload)
        else:
            with contextlib.suppress(OSError):
                atomic_write_text(self.records_summary_path, payload)

    def _sync_record_summary(self, *, strict_persist: bool = False) -> dict[str, Any]:
        summary = self._load_record_summary()
        try:
            handle = self.records_path.open("rb")
        except FileNotFoundError:
            return _empty_record_summary()
        with handle:
            st = os.fstat(handle.fileno())
            same_file = summary.get("dev") == st.st_dev and summary.get("ino") == st.st_ino
            prev_offset = summary["offset"]
            if same_file and st.st_size == prev_offset:
                return summary
            reset = not same_file or st.st_size < prev_offset
            offset = 0 if reset else prev_offset
            if reset:
                summary = _empty_record_summary()
            if offset > 0:
                handle.seek(offset - 1)
                if handle.read(1) != b"\n":
                    summary = _empty_record_summary()
                    offset = 0
                    reset = True
                    handle.seek(0)
            chunk = handle.read()
        if not chunk:
            if reset:
                summary["dev"] = st.st_dev
                summary["ino"] = st.st_ino
                summary["offset"] = 0
                self._persist_record_summary(summary, strict=strict_persist)
            return summary
        # Only fold complete newline-terminated lines so a concurrent mid-line write is not
        # misparsed; stop offset at the last newline.
        last_nl = chunk.rfind(b"\n")
        if last_nl == -1:
            return summary
        complete = chunk[: last_nl + 1]
        new_offset = offset + len(complete)
        try:
            text = complete.decode("utf-8")
            for line in text.splitlines():
                if line.strip():
                    _fold_record(summary, json.loads(line))
        except (UnicodeDecodeError, ValueError) as exc:
            raise StateError(f"{self.records_path} has a line that is not JSON: {exc}") from exc
        summary["dev"] = st.st_dev
        summary["ino"] = st.st_ino
        summary["offset"] = new_offset
        self._persist_record_summary(summary, strict=strict_persist)
        return summary

    def _append(self, path: Path, record: dict) -> None:
        line = json.dumps(record, sort_keys=True)
        self.root.mkdir(parents=True, exist_ok=True)
        existed = path.exists()
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        if not existed:
            fsync_dir(self.root)

    def _read_lines(self, path: Path) -> list[dict]:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            return []
        try:
            return [json.loads(line) for line in lines if line.strip()]
        except ValueError as exc:
            raise StateError(f"{path} has a line that is not JSON: {exc}") from exc

    def _now(self) -> str:
        return self.clock.now().isoformat().replace("+00:00", "Z")

    def _write(self, state: dict) -> None:
        atomic_write_text(self.state_path, json.dumps(state, indent=2, sort_keys=True) + "\n")

    @contextlib.contextmanager
    def locked(self) -> Iterator[None]:
        """Hold the state lock: an exclusively created file naming this process."""
        self.root.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + self.lock_timeout
        holder = {"pid": os.getpid(), "startedAt": self.processes.start_time(os.getpid())}
        mine: LockSnapshot | None = None
        while True:
            raw = json.dumps({**holder, "takenAt": self._now()}).encode("utf-8")
            try:
                mine = write_exclusive_lock(self.lock_path, raw)
                break
            except FileExistsError:
                taken = self._take_over_if_stale(raw)
                if taken is not None:
                    mine = taken
                    break
                if time.monotonic() >= deadline:
                    raise StateLocked(
                        f"{self.lock_path} is held by a live process: {self._holder()}"
                    ) from None
                time.sleep(0.05)
                continue
        try:
            yield
        finally:
            if mine is not None:
                unlink_if_unchanged(self.lock_path, mine)

    def _holder(self) -> dict | None:
        try:
            snapshot = read_lock_snapshot(self.lock_path)
        except OSError:
            return None
        return snapshot.holder() if snapshot is not None else None

    def _stale_snapshot(self) -> tuple[LockSnapshot, dict | None] | None:
        try:
            snapshot = read_lock_snapshot(self.lock_path)
        except OSError:
            return None
        if snapshot is None:
            return None
        holder = snapshot.holder()
        if holder is None:
            # Being written this instant, or left empty by a crash: judge by age.
            if time.time() - snapshot.mtime < WRITING_GRACE_SECONDS:
                return None
        else:
            pid, started = holder.get("pid"), holder.get("startedAt")
            if isinstance(pid, int) and self.processes.alive(pid, started):
                return None
        return snapshot, holder

    def _take_over_if_stale(self, new_raw: bytes) -> LockSnapshot | None:
        stale = self._stale_snapshot()
        if stale is None:
            return None
        snapshot, holder = stale
        replaced = replace_stale_lock(self.lock_path, snapshot, new_raw, self.processes)
        if replaced is None:
            return None
        self.log({"kind": "lock-broken", "holder": holder})
        return replaced

    def _break_if_stale(self) -> bool:
        stale = self._stale_snapshot()
        if stale is None:
            return False
        snapshot, holder = stale
        with stale_break_guard(self.lock_path, self.processes) as acquired:
            if not acquired:
                return False
            if not unlink_if_unchanged(self.lock_path, snapshot):
                return False
        self.log({"kind": "lock-broken", "holder": holder})
        return True


def _replace(source: Path, target: Path, attempts: int = 20) -> None:
    """Backwards-compatible alias for ``replace_file``."""
    replace_file(source, target, attempts=attempts)
