"""Unit tests for the shared host validation lock (lushly-dev/afd#1309)."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from botcore_factory import real_system
from botcore_factory.validation_lock import (
    LOCK_DIR_ENV,
    LOCK_VERSION,
    WAITER_TTL_SECONDS,
    ValidationLock,
    default_lock_dir,
    parse_job_handle,
)
from botcore_factory.world import Completed, WorldError


class FakeClock:
    def __init__(self, start: datetime | None = None) -> None:
        self._now = start or datetime(2030, 1, 1, 12, 0, 0, tzinfo=UTC)

    def now(self) -> datetime:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)


class FakeProcesses:
    def __init__(self, alive: dict[int, float | None] | None = None) -> None:
        self.live: dict[int, float | None] = {os.getpid(): 1_700_000_000.0, **(alive or {})}

    def alive(self, pid: int, started_at: float | None = None) -> bool:
        if pid not in self.live:
            return False
        known = self.live[pid]
        if started_at is None or known is None:
            return True
        return abs(known - started_at) < 2

    def start_time(self, pid: int) -> float | None:
        return self.live.get(pid)


def make_lock(
    tmp_path: Path,
    alive: dict[int, float | None] | None = None,
    *,
    mutex_timeout: float = 0.2,
    writing_grace: float = 5.0,
    waiter_ttl: float = WAITER_TTL_SECONDS,
) -> tuple[ValidationLock, FakeProcesses, FakeClock]:
    processes = FakeProcesses(alive)
    clock = FakeClock()
    lock = ValidationLock(
        processes,
        clock,
        directory=tmp_path / "host-lock",
        mutex_timeout=mutex_timeout,
        writing_grace=writing_grace,
        waiter_ttl=waiter_ttl,
    )
    return lock, processes, clock


def test_default_lock_dir_honors_env_and_falls_back_to_home(tmp_path):
    custom = str(tmp_path / "custom")
    assert default_lock_dir({LOCK_DIR_ENV: custom}) == Path(custom)
    assert default_lock_dir({}) == Path.home() / ".cache" / "lushly-factory"


def test_parse_job_handle_extracts_pid_and_start_time():
    assert parse_job_handle("12345@1795248935.4") == (12345, 1795248935.4)
    assert parse_job_handle("12345@") == (12345, None)
    assert parse_job_handle("run-1") == (None, None)
    assert parse_job_handle("abc@123") == (None, None)


def test_acquire_multi_slot_same_lane_and_release(tmp_path):
    lock, _, _ = make_lock(tmp_path, {100: 1_700_000_100.4})
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None  # Idempotent.
    assert lock.try_acquire("slot:2", "lushly-dev/afd", 100) is None
    lock.set_job("slot:1", "lushly-dev/afd", 100, 101, 1_700_000_105.6)

    state = lock.status()
    assert state["version"] == LOCK_VERSION
    assert state["owner"]["pid"] == 100
    assert state["owner"]["startedAtEpoch"] == 1_700_000_100
    assert state["owner"]["holds"] == [
        {"id": "slot:1", "jobPid": 101, "jobStartedAtEpoch": 1_700_000_106},
        {"id": "slot:2", "jobPid": None, "jobStartedAtEpoch": None},
    ]

    lock.release("slot:1", "lushly-dev/afd", 100)
    assert [h["id"] for h in lock.status()["owner"]["holds"]] == ["slot:2"]
    lock.release("slot:2", "lushly-dev/afd", 100)
    assert lock.status()["owner"] is None


def test_contention_fifo_waiter_turn_taking_and_starvation_prevention(tmp_path):
    lock, _, clock = make_lock(tmp_path, {100: 1000.0, 200: 2000.0})
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None

    # Lushly tries to acquire -> blocked and queued as waiters[0].
    clock.advance(5)
    blocker = lock.try_acquire("final", "lushly-dev/lushly", 200, lane="lushly-merge-lane")
    assert blocker == {
        "lane": "botcore-factory",
        "repository": "lushly-dev/afd",
        "pid": 100,
        "acquiredAt": "2030-01-01T12:00:00Z",
    }
    waiters = lock.status()["waiters"]
    assert len(waiters) == 1 and waiters[0]["lane"] == "lushly-merge-lane"
    enqueued_at = waiters[0]["enqueuedAt"]

    # Second poll refreshes refreshedAt without moving enqueuedAt.
    clock.advance(5)
    assert lock.try_acquire("final", "lushly-dev/lushly", 200, lane="lushly-merge-lane") == blocker
    waiters = lock.status()["waiters"]
    assert len(waiters) == 1
    assert waiters[0]["enqueuedAt"] == enqueued_at
    assert waiters[0]["refreshedAt"] == "2030-01-01T12:00:10Z"

    # Starvation prevention: while Lushly waits, AFD cannot acquire a NEW hold (slot:2) and does
    # NOT enqueue itself in waiters while it still owns slot:1.
    yield_blocker = lock.check_available("lushly-dev/afd", 100)
    assert yield_blocker == {
        "lane": "lushly-merge-lane",
        "repository": "lushly-dev/lushly",
        "pid": 200,
        "enqueuedAt": enqueued_at,
    }
    assert len(lock.status()["waiters"]) == 1

    # AFD releases slot:1 -> owner becomes None, but AFD STILL yields to waiters[0] (Lushly) and
    # now queues behind Lushly.
    lock.release("slot:1", "lushly-dev/afd", 100)
    assert lock.status()["owner"] is None
    assert lock.try_acquire("slot:2", "lushly-dev/afd", 100) == yield_blocker
    assert [w["lane"] for w in lock.status()["waiters"]] == [
        "lushly-merge-lane",
        "botcore-factory",
    ]

    # Lushly acquires -> removed from waiters; AFD stays waiters[0].
    assert lock.try_acquire("final", "lushly-dev/lushly", 200, lane="lushly-merge-lane") is None
    assert lock.status()["owner"]["lane"] == "lushly-merge-lane"
    assert [w["lane"] for w in lock.status()["waiters"]] == ["botcore-factory"]

    # Lushly releases -> AFD takes ownership.
    lock.release("final", "lushly-dev/lushly", 200, lane="lushly-merge-lane")
    assert lock.try_acquire("slot:2", "lushly-dev/afd", 100) is None
    assert lock.status()["owner"]["lane"] == "botcore-factory"
    assert lock.status()["waiters"] == []


def test_waiter_ttl_and_explicit_withdrawal_prevent_deadlock(tmp_path):
    lock, _, clock = make_lock(tmp_path, {100: 1000.0, 200: 2000.0})
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None
    assert lock.try_acquire("final", "lushly-dev/lushly", 200, lane="lushly-merge-lane") is not None
    lock.release("slot:1", "lushly-dev/afd", 100)

    # While Lushly's waiter is fresh, AFD yields.
    assert lock.check_available("lushly-dev/afd", 100) is not None

    # After WAITER_TTL_SECONDS without refresh, Lushly's waiter expires even while PID 200 lives.
    clock.advance(WAITER_TTL_SECONDS + 1)
    assert lock.check_available("lushly-dev/afd", 100) is None
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None

    # Explicit withdrawal clears immediately without waiting for TTL.
    assert lock.try_acquire("final", "lushly-dev/lushly", 200, lane="lushly-merge-lane") is not None
    lock.release("slot:1", "lushly-dev/afd", 100)
    lock.withdraw_waiter("lushly-dev/lushly", 200, lane="lushly-merge-lane")
    assert lock.status()["waiters"] == []
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None


def test_dead_owner_preserves_live_job_pid_and_auto_clears_once_both_die(tmp_path):
    lock, processes, _ = make_lock(tmp_path, {100: 1000.0, 101: 1010.0, 102: 1020.0, 200: 2000.0})
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None
    assert lock.try_acquire("slot:2", "lushly-dev/afd", 100) is None
    lock.set_job("slot:1", "lushly-dev/afd", 100, 101, 1010.0)
    lock.set_job("slot:2", "lushly-dev/afd", 100, 102, 1020.0)

    # Owner daemon (100) and slot:2 child (102) die, but slot:1 child (101) is still running.
    del processes.live[100]
    del processes.live[102]
    blocker = lock.try_acquire("final", "lushly-dev/lushly", 200, lane="lushly-merge-lane")
    assert blocker is not None and blocker["pid"] == 100
    assert [h["id"] for h in lock.status()["owner"]["holds"]] == ["slot:1"]

    # PID 101 is reused by an unrelated process with a different start time -> hold is dead.
    processes.live[101] = 9999.0
    assert lock.try_acquire("final", "lushly-dev/lushly", 200, lane="lushly-merge-lane") is None
    assert lock.status()["owner"]["lane"] == "lushly-merge-lane"


def test_reconcile_drops_leaked_holds_only_for_owning_lane(tmp_path):
    lock, _, _ = make_lock(tmp_path, {100: 1000.0, 200: 2000.0})
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None
    assert lock.try_acquire("slot:2", "lushly-dev/afd", 100) is None
    # Foreign lane reconcile touches nothing.
    lock.reconcile("lushly-dev/lushly", 200, [], lane="lushly-merge-lane")
    assert len(lock.status()["owner"]["holds"]) == 2

    lock.reconcile("lushly-dev/afd", 100, ["slot:2"])
    assert [h["id"] for h in lock.status()["owner"]["holds"]] == ["slot:2"]
    lock.reconcile("lushly-dev/afd", 100, [])
    assert lock.status()["owner"] is None


def test_mutex_stale_break_grace_window_and_timeout(tmp_path):
    lock, processes, _ = make_lock(tmp_path, {100: 1000.0}, mutex_timeout=0.15, writing_grace=5.0)
    lock.directory.mkdir(parents=True, exist_ok=True)

    # Dead mutex holder -> broken via rename-aside and no leftover stale files.
    lock.mutex_path.write_text(
        json.dumps({"pid": 99999, "startedAtEpoch": 500, "nonce": "dead"}), encoding="utf-8"
    )
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None
    assert not lock.mutex_path.exists()
    assert not list(lock.directory.glob("*.stale.*"))

    # Empty mutex within writing grace -> not broken, times out with WorldError.
    lock.mutex_path.write_text("", encoding="utf-8")
    with pytest.raises(WorldError, match="timed out"):
        lock.check_available("lushly-dev/afd", 100)

    # Once older than writing grace -> broken cleanly.
    old = lock.mutex_path.stat().st_mtime - 10
    os.utime(lock.mutex_path, (old, old))
    assert lock.check_available("lushly-dev/afd", 100) is None

    # Live mutex holder -> fails closed after timeout.
    processes.live[777] = 7777.0
    lock.mutex_path.write_text(
        json.dumps({"pid": 777, "startedAtEpoch": 7777, "nonce": "live"}), encoding="utf-8"
    )
    with pytest.raises(WorldError, match="timed out"):
        lock.release("slot:1", "lushly-dev/afd", 100)
    assert lock.mutex_path.exists()


def test_corrupt_or_unknown_version_fails_closed(tmp_path):
    lock, _, _ = make_lock(tmp_path, {100: 1000.0})
    lock.directory.mkdir(parents=True, exist_ok=True)

    lock.lock_path.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(WorldError, match="Corrupt"):
        lock.check_available("lushly-dev/afd", 100)
    with pytest.raises(WorldError, match="Corrupt"):
        lock.status()

    lock.lock_path.write_text(
        json.dumps({"version": 99, "owner": None, "waiters": []}), encoding="utf-8"
    )
    with pytest.raises(WorldError, match="unsupported version"):
        lock.try_acquire("slot:1", "lushly-dev/afd", 100)

    # JSON boolean true must not pass as version 1.
    lock.lock_path.write_text(
        json.dumps({"version": True, "owner": None, "waiters": []}), encoding="utf-8"
    )
    with pytest.raises(WorldError, match="unsupported version"):
        lock.try_acquire("slot:1", "lushly-dev/afd", 100)


def test_windows_permission_error_retries_on_mutex_open_and_unlink(tmp_path, monkeypatch):
    lock, _, _ = make_lock(tmp_path, {100: 1000.0}, mutex_timeout=1.0)
    real_open = os.open
    open_attempts = 0

    def flaky_open(path, flags, mode=0o777):
        nonlocal open_attempts
        if Path(path) == lock.mutex_path and open_attempts < 2:
            open_attempts += 1
            raise PermissionError("delete-pending on Windows")
        return real_open(path, flags, mode)

    real_unlink = Path.unlink
    unlink_attempts = 0

    def flaky_unlink(self, missing_ok=False):
        nonlocal unlink_attempts
        if self == lock.mutex_path and unlink_attempts < 2:
            unlink_attempts += 1
            raise PermissionError("sharing violation on Windows")
        return real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(os, "open", flaky_open)
    monkeypatch.setattr(Path, "unlink", flaky_unlink)
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 100) is None
    assert open_attempts == 2
    assert unlink_attempts == 2
    assert not lock.mutex_path.exists()


def test_cross_format_lushly_json_lock_is_respected(tmp_path):
    """Python reads and respects a validation-lock.json written in Lushly's exact Node schema."""
    lock, processes, _ = make_lock(
        tmp_path, {23456: 1_795_248_100.0, 23500: 1_795_248_120.0, 12345: 1_795_248_930.0}
    )
    lock.directory.mkdir(parents=True, exist_ok=True)
    lushly_payload = {
        "version": 1,
        "owner": {
            "lane": "lushly-merge-lane",
            "repository": "lushly-dev/lushly",
            "pid": 23456,
            "startedAtEpoch": 1_795_248_100,
            "acquiredAt": "2030-01-01T11:59:50Z",
            "holds": [
                {
                    "id": "final",
                    "jobPid": 23500,
                    "jobStartedAtEpoch": 1_795_248_120,
                }
            ],
        },
        "waiters": [],
    }
    lock.lock_path.write_text(json.dumps(lushly_payload, indent=2) + "\n", encoding="utf-8")

    blocker = lock.try_acquire("slot:1", "lushly-dev/afd", 12345)
    assert blocker == {
        "lane": "lushly-merge-lane",
        "repository": "lushly-dev/lushly",
        "pid": 23456,
        "acquiredAt": "2030-01-01T11:59:50Z",
    }
    written = json.loads(lock.lock_path.read_text(encoding="utf-8"))
    assert written["waiters"][0]["lane"] == "botcore-factory"
    assert written["waiters"][0]["repository"] == "lushly-dev/afd"
    assert written["waiters"][0]["startedAtEpoch"] == 1_795_248_930

    # When both Lushly's lane and its validation child exit, AFD takes over cleanly.
    del processes.live[23456]
    del processes.live[23500]
    assert lock.try_acquire("slot:1", "lushly-dev/afd", 12345) is None
    assert lock.status()["owner"]["repository"] == "lushly-dev/afd"


def test_darwin_start_time_uses_utc_and_c_locale(monkeypatch):
    seen = {}

    def fake_run(args, cwd=None, timeout=None, stdin=None, env=None):
        seen["args"] = args
        seen["env"] = env
        return Completed(tuple(args), 0, "Thu Jan  1 00:00:10 1970\n", "")

    monkeypatch.setattr(real_system, "run_process", fake_run)
    assert real_system._darwin_start_time(42) == 10.0
    assert seen["args"] == ["ps", "-o", "lstart=", "-p", "42"]
    assert seen["env"]["TZ"] == "UTC"
    assert seen["env"]["LC_ALL"] == "C"
