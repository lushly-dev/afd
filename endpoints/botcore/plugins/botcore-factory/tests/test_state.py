"""The lane state store: its location, lock, atomic writes and append-only log."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import platformdirs
import pytest

from botcore_factory.state import (
    APP_NAME,
    DATA_DIR_ENV,
    StateError,
    StateLocked,
    StateStore,
    default_base,
    empty_state,
    repository_key,
)


class Clock:
    def now(self):
        return datetime(2030, 1, 3, tzinfo=UTC)


class Processes:
    def __init__(self, alive=()):
        self.alive_pids = set(alive)

    def alive(self, pid, started_at=None):
        return pid == os.getpid() or pid in self.alive_pids

    def start_time(self, pid):
        return None

    def run(self, args, cwd, timeout=None):  # pragma: no cover - not used by the store
        raise AssertionError


def store(tmp_path: Path, alive=(), timeout=0.2) -> StateStore:
    return StateStore(tmp_path / "repo", Processes(alive), Clock(), lock_timeout=timeout)


def test_state_lives_in_user_data_keyed_by_repository_unless_overridden(tmp_path):
    assert default_base({}) == Path(platformdirs.user_data_dir(APP_NAME, appauthor=False))
    assert default_base({DATA_DIR_ENV: str(tmp_path)}) == tmp_path
    found = StateStore.for_repository("Owner/Repo.x", Processes(), Clock(), base=tmp_path)
    assert found.root == tmp_path / "owner--repo.x"


@pytest.mark.parametrize("name", ["owner", "a/b/c", "../x", "a/..", "a b/c"])
def test_a_repository_key_needs_owner_and_name(name):
    with pytest.raises(StateError):
        repository_key(name)


def test_an_absent_state_reads_empty_and_writes_nothing(tmp_path):
    lane = store(tmp_path)
    assert lane.read() == empty_state()
    with lane.update("nothing") as state:
        assert state["cells"] == []
    assert not lane.state_path.exists() and lane.read_log() == []


def test_a_change_is_written_whole_and_logged(tmp_path):
    lane = store(tmp_path)
    with lane.update("add a cell") as state:
        state["cells"].append({"branch": "fix/x"})
    assert json.loads(lane.state_path.read_text())["cells"] == [{"branch": "fix/x"}]
    assert lane.read()["lane"]["running"] is False  # Defaults fill what the file leaves out.
    assert [entry["reason"] for entry in lane.read_log()] == ["add a cell"]
    assert lane.read_log()[0]["at"] == "2030-01-03T00:00:00Z"
    assert not list(lane.root.glob("*.tmp")) and not lane.lock_path.exists()


def test_the_log_only_grows(tmp_path):
    lane = store(tmp_path)
    lane.log({"kind": "one"})
    lane.log({"kind": "two"})
    assert [entry["kind"] for entry in lane.read_log()] == ["one", "two"]


def test_an_exception_inside_an_update_writes_nothing_and_releases_the_lock(tmp_path):
    lane = store(tmp_path)
    with pytest.raises(RuntimeError), lane.update("fails") as state:
        state["cells"].append({"branch": "fix/x"})
        raise RuntimeError("refused")
    assert not lane.state_path.exists() and not lane.lock_path.exists()


def test_a_live_holder_keeps_the_lock(tmp_path):
    lane = store(tmp_path, alive={4242})
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text(json.dumps({"pid": 4242, "startedAt": None}))
    with pytest.raises(StateLocked, match="4242"), lane.update("blocked"):
        pass
    assert lane.lock_path.exists()


def test_a_dead_holder_s_lock_is_broken_and_logged(tmp_path):
    lane = store(tmp_path)
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text(json.dumps({"pid": 4242, "startedAt": 1.0}))
    with lane.update("after a crash") as state:
        state["dials"]["cells.max"] = 2
    assert lane.read()["dials"] == {"cells.max": 2}
    kinds = [entry["kind"] for entry in lane.read_log()]
    assert kinds == ["lock-broken", "state"]


def test_an_old_empty_lock_is_stale(tmp_path):
    lane = store(tmp_path)
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text("")
    os.utime(lane.lock_path, (1, 1))
    with lane.update("go") as state:
        state["runs"].append({"id": "run-1"})
    assert lane.read()["runs"] == [{"id": "run-1"}]


def test_a_fresh_empty_lock_is_waited_for(tmp_path):
    lane = store(tmp_path)
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text("")
    with pytest.raises(StateLocked), lane.update("blocked"):
        pass


@pytest.mark.parametrize("text", ["{", "[]", '{"version": 99}'])
def test_an_unreadable_state_is_an_error_never_an_empty_state(tmp_path, text):
    lane = store(tmp_path)
    lane.root.mkdir(parents=True)
    lane.state_path.write_text(text)
    with pytest.raises(StateError):
        lane.read()


def test_closed_events_and_finished_runs_are_trimmed_while_preserving_open_and_sequences(tmp_path):
    from botcore_factory.events import emit
    from botcore_factory.lane_process import new_run

    lane = StateStore(
        tmp_path / "repo",
        Processes(),
        Clock(),
        lock_timeout=0.2,
        max_closed_events=3,
        max_finished_runs=2,
    )
    with lane.update("populate") as state:
        # 5 closed events + 2 open events
        for _ in range(5):
            ev = emit(state, "2030-01-03T00:00:00Z", "merged", branch="b")
            ev["open"] = False
        emit(state, "2030-01-03T00:00:00Z", "ejected", branch="open-1")
        emit(state, "2030-01-03T00:00:00Z", "lane-error", detail="open-2")
        # 1 stopped-but-unsummarized run (no "merged" marker) + 4 summarized runs + 1 active run
        new_run(state, "2030-01-03T00:00:00Z")
        state["runs"][-1]["stoppedAt"] = "2030-01-03T00:30:00Z"
        for _ in range(4):
            new_run(state, "2030-01-03T00:00:00Z")
            state["runs"][-1].update(stoppedAt="2030-01-03T01:00:00Z", merged=1)
        active = new_run(state, "2030-01-03T02:00:00Z")
        state["lane"]["runId"] = active

    saved = lane.read()
    closed = [e["id"] for e in saved["events"] if not e.get("open", True)]
    opened = [e["id"] for e in saved["events"] if e.get("open", True)]
    assert closed == ["ev-3", "ev-4", "ev-5"]
    assert opened == ["ev-6", "ev-7"]
    # run-1 (unsummarized) is preserved, oldest summarized runs (run-2, run-3) are trimmed.
    assert [r["id"] for r in saved["runs"]] == ["run-1", "run-4", "run-5", "run-6"]
    assert saved["lane"]["runId"] == "run-6"

    # Dropping even the newest closed events/finished runs never reuses sequence numbers.
    with lane.update("next ids") as state:
        for e in state["events"]:
            e["open"] = False
        state["runs"][-1].update(stoppedAt="2030-01-03T03:00:00Z", merged=0)
        state["lane"]["runId"] = None
    with lane.update("after trim") as state:
        assert emit(state, "2030-01-03T04:00:00Z", "queue-room")["id"] == "ev-8"
        assert new_run(state, "2030-01-03T04:00:00Z") == "run-7"


def test_atomic_write_fsyncs_temp_file_and_directory_before_and_after_rename(tmp_path, monkeypatch):
    import stat

    from botcore_factory import lock as lock_mod

    lane = store(tmp_path)
    ops: list[str] = []
    real_fsync = os.fsync
    real_replace = lock_mod.replace_file

    def tracked_fsync(fd: int) -> None:
        kind = "dir-fsync" if stat.S_ISDIR(os.fstat(fd).st_mode) else "file-fsync"
        ops.append(kind)
        real_fsync(fd)

    def tracked_replace(src: Path, dst: Path, attempts: int = 20) -> None:
        ops.append("replace")
        real_replace(src, dst, attempts=attempts)

    monkeypatch.setattr(lock_mod.os, "fsync", tracked_fsync)
    monkeypatch.setattr(lock_mod, "replace_file", tracked_replace)

    lane._write(empty_state())
    expected = (
        ["file-fsync", "replace"]
        if os.name == "nt"
        else ["file-fsync", "dir-fsync", "replace", "dir-fsync"]
    )
    assert ops == expected


def test_lock_acquisition_cleans_up_if_fsync_fails(tmp_path, monkeypatch):
    from botcore_factory import lock as lock_mod
    from botcore_factory.lock import HostLock

    lane = store(tmp_path)
    monkeypatch.setattr(lock_mod, "fsync_dir", lambda _d: (_ for _ in ()).throw(OSError("io err")))
    with pytest.raises(OSError, match="io err"), lane.locked():
        pass
    assert not lane.lock_path.exists()

    hlock = HostLock(tmp_path / "lane.lock", Processes())
    with pytest.raises(OSError, match="io err"):
        hlock.acquire(os.getpid(), repository="o/r")
    assert not hlock.path.exists()


def _refuse_exclusive_creates(monkeypatch, times=1, *, pending=True):
    """Make the next ``times`` exclusive creates fail as Windows fails them: access denied.

    With ``pending`` the refused name still shows (a file being deleted) until the next look.
    """
    from botcore_factory import lock as lock_mod

    real_open = os.open
    refused = []
    showing = []

    def fake_open(path, flags, *args, **kwargs):
        if flags & os.O_EXCL and len(refused) < times:
            refused.append(path)
            if pending:
                showing.append(path)
            raise PermissionError(13, "Access is denied", str(path))
        return real_open(path, flags, *args, **kwargs)

    def fake_exists(path):
        if showing:
            showing.clear()
            return True
        return os.path.lexists(path)

    monkeypatch.setattr(lock_mod.os, "open", fake_open)
    monkeypatch.setattr(lock_mod, "_name_exists", fake_exists)
    monkeypatch.setattr(lock_mod, "_WINDOWS", True)
    return refused


def test_a_lock_being_deleted_on_windows_counts_as_held_and_is_retried(tmp_path, monkeypatch):
    from botcore_factory import lock as lock_mod
    from botcore_factory.lock import HostLock

    refused = _refuse_exclusive_creates(monkeypatch)
    with pytest.raises(FileExistsError):
        lock_mod.write_exclusive_lock(tmp_path / "x.lock", b"{}")
    assert refused

    refused = _refuse_exclusive_creates(monkeypatch)
    hlock = HostLock(tmp_path / "lane.lock", Processes())
    hlock.acquire(os.getpid(), repository="o/r")
    assert refused and hlock.holder()["pid"] == os.getpid()

    lane = store(tmp_path, timeout=5)
    refused = _refuse_exclusive_creates(monkeypatch)
    with lane.update("after a refused create") as state:
        state["touched"] = True
    assert refused and lane.read()["touched"] is True
    assert not lane.lock_path.exists()


def test_a_windows_refusal_after_the_name_is_gone_is_retried(tmp_path, monkeypatch):
    from botcore_factory import lock as lock_mod

    refused = _refuse_exclusive_creates(monkeypatch, times=2, pending=False)
    lock_mod.write_exclusive_lock(tmp_path / "x.lock", b"{}")
    assert len(refused) == 2 and (tmp_path / "x.lock").read_bytes() == b"{}"


def test_access_denied_for_good_is_not_mistaken_for_a_held_lock(tmp_path, monkeypatch):
    from botcore_factory import lock as lock_mod

    monkeypatch.setattr(lock_mod.time, "sleep", lambda _s: None)
    refused = _refuse_exclusive_creates(monkeypatch, times=10**6, pending=False)
    with pytest.raises(PermissionError):
        lock_mod.write_exclusive_lock(tmp_path / "x.lock", b"{}")
    assert len(refused) == lock_mod._WINDOWS_UNLINK_ATTEMPTS

    refused = _refuse_exclusive_creates(monkeypatch)
    monkeypatch.setattr(lock_mod, "_WINDOWS", False)
    with pytest.raises(PermissionError):
        lock_mod.write_exclusive_lock(tmp_path / "y.lock", b"{}")
    assert len(refused) == 1


def test_unreadable_existing_lock_honors_timeout_instead_of_spinning(tmp_path, monkeypatch):
    from botcore_factory import lock as lock_mod
    from botcore_factory import state as state_mod

    lane = store(tmp_path, timeout=0.1)
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text(json.dumps({"pid": 999, "startedAt": 1.0}))
    monkeypatch.setattr(
        lock_mod,
        "read_lock_snapshot",
        lambda _p: (_ for _ in ()).throw(PermissionError("denied")),
    )
    monkeypatch.setattr(state_mod, "read_lock_snapshot", lock_mod.read_lock_snapshot)
    with pytest.raises(StateLocked), lane.update("blocked"):
        pass


def test_stale_lock_is_not_removed_if_replaced_before_unlink(tmp_path):
    from botcore_factory.lock import HostLock, LaneLocked

    lane = store(tmp_path, alive={777})
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text(json.dumps({"pid": 999, "startedAt": 1.0}))
    orig_alive = lane.processes.alive

    def race_replace(pid, started):
        if pid == 999:
            lane.lock_path.unlink()
            lane.lock_path.write_text(json.dumps({"pid": 777, "startedAt": 2.0}))
        return orig_alive(pid, started)

    lane.processes.alive = race_replace
    assert lane._break_if_stale() is False
    assert json.loads(lane.lock_path.read_text())["pid"] == 777
    assert lane.read_log() == []

    # Same protection on HostLock.acquire: a replaced lock is not unlinked or overwritten.
    host_procs = Processes(alive={777})
    hlock = HostLock(tmp_path / "lane.lock", host_procs)
    hlock.path.write_text(json.dumps({"pid": 999, "startedAt": 1.0}))
    orig_host_alive = host_procs.alive

    def host_race(pid, started):
        if pid == 999:
            hlock.path.unlink()
            hlock.path.write_text(json.dumps({"pid": 777, "startedAt": 2.0, "repository": "o/r"}))
        return orig_host_alive(pid, started)

    host_procs.alive = host_race
    with pytest.raises(LaneLocked, match="777"):
        hlock.acquire(os.getpid(), repository="a/b")
    assert json.loads(hlock.path.read_text())["pid"] == 777


def test_stale_lock_replacement_is_serialized_across_contenders(tmp_path):
    from botcore_factory import lock as lock_mod

    lane = store(tmp_path, alive={555}, timeout=0.1)
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text(json.dumps({"pid": 999, "startedAt": 1.0}))
    # While a live contender holds the .break guard, another contender cannot replace the lock.
    guard = lane.lock_path.with_name("state.lock.break")
    guard.write_text(json.dumps({"pid": 555, "startedAt": None}))
    assert lane._take_over_if_stale(b'{"pid": 1}') is None
    assert json.loads(lane.lock_path.read_text())["pid"] == 999
    guard.unlink()

    # Once the guard is free, stale takeover atomically replaces the lock without leaving a gap.
    with lane.locked():
        assert json.loads(lane.lock_path.read_text())["pid"] == os.getpid()
    assert not lane.lock_path.exists()
    assert not guard.exists()
    assert [entry["kind"] for entry in lane.read_log()] == ["lock-broken"]

    # Also verify a live lock is never touched if a stale snapshot was read before a handoff.
    lane.lock_path.write_text(json.dumps({"pid": 999, "startedAt": 1.0}))
    stale_snap = lock_mod.read_lock_snapshot(lane.lock_path)
    lane.lock_path.unlink()
    lane.lock_path.write_text(json.dumps({"pid": 555, "startedAt": 2.0}))
    assert (
        lock_mod.replace_stale_lock(lane.lock_path, stale_snap, b'{"pid": 1}', lane.processes)
        is None
    )
    assert json.loads(lane.lock_path.read_text())["pid"] == 555


def test_stale_lock_is_not_removed_if_content_changes_in_place(tmp_path):
    lane = store(tmp_path)
    lane.root.mkdir(parents=True)
    lane.lock_path.write_text("")
    os.utime(lane.lock_path, (1, 1))
    from botcore_factory import state as state_mod

    orig_unlink_check = state_mod.unlink_if_unchanged

    def mutate_in_place(path, expected):
        # Same inode, content written before unlink check.
        with path.open("r+b") as handle:
            handle.write(json.dumps({"pid": 888, "startedAt": 3.0}).encode("utf-8"))
            handle.flush()
        return orig_unlink_check(path, expected)

    orig_attr = state_mod.unlink_if_unchanged
    state_mod.unlink_if_unchanged = mutate_in_place
    try:
        assert lane._break_if_stale() is False
    finally:
        state_mod.unlink_if_unchanged = orig_attr
    assert json.loads(lane.lock_path.read_text())["pid"] == 888


def test_incremental_record_summary_matches_full_scan_preserves_order_and_handles_truncation(
    tmp_path, monkeypatch
):
    from botcore_factory import records, report

    lane = store(tmp_path)
    seq = [
        # feat/z is seen and merged BEFORE feat/a (reverse alphabetical) to test PR ordering.
        records.make(
            "enqueued",
            "2030-01-03T00:01:00Z",
            "run-1",
            branch="feat/z",
            attempt=1,
            head="h1",
            issues=[1],
            plan="p1",
            route="r1",
            profile="bounded",
            state="queued",
            firstEnqueuedAt="2030-01-03T00:01:00Z",
        ),
        records.make(
            "validated",
            "2030-01-03T00:05:00Z",
            "run-1",
            branch="feat/z",
            attempt=1,
            outcome="failed",
            head="h1",
            base="m0",
            tree="t1",
            command=["pnpm", "verify"],
            minutes=4.0,
        ),
        records.make(
            "ejected",
            "2030-01-03T00:05:00Z",
            "run-1",
            branch="feat/z",
            attempt=1,
            cause="final-failed",
            head="h1",
        ),
        records.make(
            "enqueued",
            "2030-01-03T00:10:00Z",
            "run-1",
            branch="feat/z",
            attempt=2,
            head="h2",
            issues=[1],
            plan="p1",
            route="r1",
            profile="bounded",
            state="queued",
            firstEnqueuedAt="2030-01-03T00:01:00Z",
        ),
        records.make(
            "validated",
            "2030-01-03T00:16:00Z",
            "run-1",
            branch="feat/z",
            attempt=2,
            outcome="passed",
            head="h2",
            base="m1",
            tree="t2",
            command=["pnpm", "verify"],
            minutes=6.0,
        ),
        records.make(
            "rerun",
            "2030-01-03T00:12:00Z",
            "run-1",
            branch="feat/z",
            attempt=2,
            reason="main-moved",
        ),
        records.make("merged", "2030-01-03T00:20:00Z", "run-1", branch="feat/z", attempt=2, pr=1),
        records.make(
            "enqueued",
            "2030-01-03T00:21:00Z",
            "run-1",
            branch="feat/a",
            attempt=1,
            head="h3",
            issues=[2],
            plan="p2",
            route="r2",
            profile="bounded",
            state="queued",
            firstEnqueuedAt="2030-01-03T00:21:00Z",
        ),
        records.make("merged", "2030-01-03T00:22:00Z", "run-1", branch="feat/a", attempt=1, pr=2),
        records.make("wake", "2030-01-03T00:23:00Z", "run-1", consumer="foreman", events=1),
    ]
    for rec in seq:
        lane.append_record(rec)

    assert lane.records_summary_path.exists()
    full = lane.read_records()
    assert lane.next_attempt("feat/z") == records.next_attempt(full, "feat/z") == 3
    assert lane.first_enqueued("feat/z") == records.first_enqueued(full, "feat/z")
    assert lane.last_ejection("feat/z") == records.last_ejection(full, "feat/z")
    expected_summary = report.summarize(
        full, "run-1", "2030-01-03T00:00:00Z", "2030-01-03T01:00:00Z"
    )
    actual_summary = lane.summarize_run("run-1", "2030-01-03T00:00:00Z", "2030-01-03T01:00:00Z")
    assert actual_summary == expected_summary
    assert [pr["number"] for pr in actual_summary["prs"]] == [1, 2]

    # Appending one more record reads only the newly appended tail bytes, not the prefix.
    before_offset = json.loads(lane.records_summary_path.read_text())["offset"]
    read_sizes: list[int] = []
    real_open = Path.open

    def tracking_open(self_path: Path, mode: str = "r", *args, **kwargs):
        handle = real_open(self_path, mode, *args, **kwargs)
        if self_path == lane.records_path and mode == "rb":
            orig_read = handle.read

            class _Reader:
                def __getattr__(self, name):
                    return getattr(handle, name)

                def read(self, n=-1):
                    data = orig_read(n)
                    if n == -1:
                        read_sizes.append(len(data))
                    return data

                def __enter__(self):
                    handle.__enter__()
                    return self

                def __exit__(self, *exc):
                    return handle.__exit__(*exc)

            return _Reader()
        return handle

    with monkeypatch.context() as mp:
        mp.setattr(Path, "open", tracking_open)
        extra = records.make("wake", "2030-01-03T00:24:00Z", "run-1", consumer="foreman", events=1)
        lane.append_record(extra)
    after_offset = json.loads(lane.records_summary_path.read_text())["offset"]
    assert read_sizes == [after_offset - before_offset]
    assert read_sizes[0] < before_offset

    # Cached queries do not call read_records().
    monkeypatch.setattr(
        lane, "read_records", lambda: (_ for _ in ()).throw(AssertionError("full scan"))
    )
    assert lane.next_attempt("feat/z") == 3
    assert lane.first_enqueued("feat/z") == "2030-01-03T00:01:00Z"
    assert lane.last_ejection("feat/z")["cause"] == "final-failed"
    assert (
        lane.summarize_run("run-1", "2030-01-03T00:00:00Z", "2030-01-03T01:00:00Z")["foremanWakes"]
        == 2
    )

    # Corrupting records-summary.json rebuilds transparently from records.jsonl.
    lane.records_summary_path.write_text("{corrupt")
    assert lane.next_attempt("feat/z") == 3
    assert [
        pr["number"]
        for pr in lane.summarize_run("run-1", "2030-01-03T00:00:00Z", "2030-01-03T01:00:00Z")["prs"]
    ] == [1, 2]

    # Truncating records.jsonl in place to 0 bytes (same dev/ino) resets stale cache cleanly.
    with lane.records_path.open("r+b") as handle:
        handle.truncate(0)
    assert lane.next_attempt("feat/z") == 1
    assert lane.first_enqueued("feat/z") is None
    assert lane.last_ejection("feat/z") is None
    assert (
        lane.summarize_run("run-1", "2030-01-03T00:00:00Z", "2030-01-03T01:00:00Z")["merged"] == 0
    )
