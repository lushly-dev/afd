"""Several real processes contend for the lane's locks: ``state.lock`` and ``lane.lock``.

The other lock tests run in one process and fake its neighbours. These start processes with
``spawn`` (the only start method Windows has, so every platform runs the same way), release
them together from a barrier, and check what the locks promise: one holder at a time, no lost
state update, one taker for a dead holder's lock, and nothing left behind. A process inside a
lock creates a marker file exclusively and removes it on the way out, so a second holder at
the same moment is caught by the operating system rather than inferred from timing.
"""

from __future__ import annotations

import json
import multiprocessing
import os
import queue
import threading
import time
from collections import Counter
from pathlib import Path

import pytest

from botcore_factory.lock import HostLock, LaneLocked
from botcore_factory.real_system import OsProcesses, SystemClock
from botcore_factory.state import StateStore

SPAWN = multiprocessing.get_context("spawn")
WORKERS = 6
ROUNDS = 15
LANE_HOLDS = 3
STALE_ROUNDS = 25
REPOSITORY = "lushly-dev/afd"
#: Generous: spawned interpreters start slowly on a loaded Windows runner.
JOIN_SECONDS = 180
BARRIER_SECONDS = 120


def _enter(marker: Path) -> bool:
    """Create the in-lock marker; False when another process is inside at the same moment."""
    try:
        os.close(os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
    except FileExistsError:
        return False
    return True


def _leave(marker: Path) -> None:
    os.unlink(marker)


def _store(root: str) -> StateStore:
    return StateStore(Path(root), OsProcesses(), SystemClock(), lock_timeout=JOIN_SECONDS)


def update_worker(root: str, marker: str, rounds: int, barrier, results) -> None:
    """Increment the shared counter ``rounds`` times, each under the state lock."""
    store = _store(root)
    overlaps = 0
    barrier.wait(BARRIER_SECONDS)
    for _ in range(rounds):
        with store.update("contention") as state:
            inside = _enter(Path(marker))
            overlaps += not inside
            state["contention"] = state.get("contention", 0) + 1
            state.setdefault("holders", []).append(os.getpid())
            time.sleep(0.002)
            if inside:
                _leave(Path(marker))
    results.put({"pid": os.getpid(), "overlaps": overlaps})


def lane_worker(path: str, marker: str, holds: int, barrier, results) -> None:
    """Take the host's lane lock ``holds`` times, refused whenever another lane holds it."""
    lock = HostLock(Path(path), OsProcesses())
    held = refused = overlaps = 0
    holders_seen: list[int | None] = []
    not_mine: list[dict | None] = []
    barrier.wait(BARRIER_SECONDS)
    deadline = time.monotonic() + JOIN_SECONDS / 2
    while held < holds and time.monotonic() < deadline:
        try:
            lock.acquire(os.getpid(), repository=REPOSITORY)
        except LaneLocked as locked:
            refused += 1
            holders_seen.append(locked.holder.get("pid"))
            time.sleep(0.005)
            continue
        inside = _enter(Path(marker))
        overlaps += not inside
        holder = lock.holder()
        if not holder or holder.get("pid") != os.getpid():
            not_mine.append(holder)
        time.sleep(0.02)
        if inside:
            _leave(Path(marker))
        lock.release(os.getpid())
        held += 1
        time.sleep(0.005)
    results.put(
        {
            "pid": os.getpid(),
            "held": held,
            "refused": refused,
            "overlaps": overlaps,
            "holdersSeen": holders_seen,
            "notMine": not_mine,
        }
    )


def stale_lane_worker(path: str, rounds: int, start, attempted, released, results) -> None:
    """Each round, try once to take a dead lane's lock; a winner holds it until every
    contender has tried, then releases it for the next round."""
    lock = HostLock(Path(path), OsProcesses())
    for round_ in range(rounds):
        start.wait(BARRIER_SECONDS)
        try:
            lock.acquire(os.getpid(), repository=REPOSITORY)
        except LaneLocked as locked:
            won, holder = False, locked.holder.get("pid")
        else:
            won, holder = True, (lock.holder() or {}).get("pid")
        results.put({"round": round_, "pid": os.getpid(), "won": won, "holder": holder})
        attempted.wait(BARRIER_SECONDS)
        if won:
            lock.release(os.getpid())
        released.wait(BARRIER_SECONDS)


def die_holding_lane_lock(path: str) -> None:
    HostLock(Path(path), OsProcesses()).acquire(os.getpid(), repository=REPOSITORY)
    os._exit(0)


def die_holding_state_lock(root: str) -> None:
    with _store(root).locked():
        os._exit(0)


def _exits(workers) -> str:
    return ", ".join(f"{worker.pid}: {worker.exitcode}" for worker in workers)


def _collect(results, workers, count: int, deadline: float) -> list[dict]:
    """``count`` results, failing at once (with exit codes) if a worker dies without one."""
    collected = []
    while len(collected) < count:
        assert time.monotonic() < deadline, (
            f"only {len(collected)} of {count} results in time; exit codes {_exits(workers)}"
        )
        try:
            collected.append(results.get(timeout=1))
        except queue.Empty:
            crashed = [w for w in workers if w.exitcode not in (None, 0)]
            assert not crashed, f"a worker died without reporting; exit codes {_exits(workers)}"
    return collected


def _wait(barrier, workers) -> None:
    try:
        barrier.wait(BARRIER_SECONDS)
    except threading.BrokenBarrierError:
        raise AssertionError(f"a barrier broke; exit codes {_exits(workers)}") from None


def _stop(workers) -> None:
    """Stop and release every worker, never hiding the failure that brought us here."""
    for worker in workers:
        if worker.pid is None:
            continue  # Never started: a start before it failed.
        if worker.is_alive():
            worker.terminate()
            worker.join(5)
        if worker.is_alive():
            worker.kill()
            worker.join(5)
        if not worker.is_alive():
            worker.close()


def _run(target, args_for, count: int) -> list[dict]:
    """Start ``count`` spawned workers behind one barrier and collect one result from each."""
    results = SPAWN.Queue()
    barrier = SPAWN.Barrier(count)
    workers = [
        SPAWN.Process(target=target, args=(*args_for(index), barrier, results))
        for index in range(count)
    ]
    try:
        for worker in workers:
            worker.start()
        deadline = time.monotonic() + JOIN_SECONDS
        collected = _collect(results, workers, count, deadline)
        for worker in workers:
            worker.join(max(deadline - time.monotonic(), 1))
            assert worker.exitcode == 0, f"worker {worker.pid} exited with {worker.exitcode}"
    finally:
        _stop(workers)
    return collected


@pytest.fixture
def dead_holder():
    """Run a target that exits holding a lock, and return its pid once it is gone.

    The process object stays open until the test ends: Windows may give a pid to a new process
    once the last handle to the old one closes, and a worker that took the dead holder's pid
    (with a start time within the liveness tolerance) would pass for it.
    """
    kept = []

    def run(target, *args) -> int:
        process = SPAWN.Process(target=target, args=args)
        process.start()
        kept.append(process)
        process.join(JOIN_SECONDS)
        assert process.exitcode == 0, f"the dying holder exited with {process.exitcode}"
        assert not OsProcesses().alive(process.pid)
        return process.pid

    yield run
    _stop(kept)


def _leftovers(directory: Path) -> list[str]:
    """Lock, guard, marker and temporary files that should not outlive the contention."""
    return sorted(
        path.name
        for path in directory.iterdir()
        if path.name.endswith((".lock", ".break", ".tmp", ".marker"))
    )


def _assert_counted(store: StateStore, results: list[dict], rounds: int) -> None:
    state = store.read()
    assert sum(result["overlaps"] for result in results) == 0
    assert state["contention"] == len(results) * rounds, "a state update was lost"
    assert Counter(state["holders"]) == {result["pid"]: rounds for result in results}
    updates = [entry for entry in store.read_log() if entry.get("reason") == "contention"]
    assert len(updates) == len(results) * rounds


def test_state_updates_from_several_processes_are_serialized_and_none_is_lost(tmp_path):
    root = tmp_path / "state"
    marker = tmp_path / "inside.marker"
    results = _run(update_worker, lambda _: (str(root), str(marker), ROUNDS), WORKERS)
    store = _store(str(root))
    _assert_counted(store, results, ROUNDS)
    assert not any(entry.get("kind") == "lock-broken" for entry in store.read_log())
    assert _leftovers(root) == []
    assert not marker.exists()
    # Every log line is whole: appends happen under the lock, never interleaved.
    for line in store.log_path.read_text(encoding="utf-8").splitlines():
        json.loads(line)


def test_a_state_lock_left_by_a_dead_process_is_broken_once_and_every_update_lands(
    tmp_path, dead_holder
):
    root = tmp_path / "state"
    marker = tmp_path / "inside.marker"
    dead = dead_holder(die_holding_state_lock, str(root))
    store = _store(str(root))
    assert json.loads(store.lock_path.read_text(encoding="utf-8"))["pid"] == dead

    results = _run(update_worker, lambda _: (str(root), str(marker), ROUNDS), WORKERS)
    assert dead not in {result["pid"] for result in results}
    _assert_counted(store, results, ROUNDS)
    broken = [entry for entry in store.read_log() if entry.get("kind") == "lock-broken"]
    assert [entry["holder"]["pid"] for entry in broken] == [dead]
    assert _leftovers(root) == []


def test_the_lane_lock_admits_one_process_at_a_time(tmp_path):
    path = tmp_path / "lane.lock"
    marker = tmp_path / "inside.marker"
    results = _run(lane_worker, lambda _: (str(path), str(marker), LANE_HOLDS), WORKERS)
    pids = {result["pid"] for result in results}
    assert [result["held"] for result in results] == [LANE_HOLDS] * WORKERS
    assert sum(result["overlaps"] for result in results) == 0
    assert [result["notMine"] for result in results] == [[]] * WORKERS
    # The processes did contend, and a refusal named another worker (or a lock mid-write).
    assert sum(result["refused"] for result in results) > 0
    for result in results:
        assert set(result["holdersSeen"]) <= (pids - {result["pid"]}) | {None}
    assert _leftovers(tmp_path) == []


def test_a_dead_lane_s_lock_is_taken_by_exactly_one_contender(tmp_path, dead_holder):
    # The race between takers is narrow, so the same processes contend for many rounds. The
    # test process joins each barrier and puts the dead lane's lock back between rounds.
    path = tmp_path / "lane.lock"
    dead = dead_holder(die_holding_lane_lock, str(path))
    assert HostLock(path, OsProcesses()).holder()["pid"] == dead
    assert HostLock(path, OsProcesses()).live_holder() is None
    stale = path.read_bytes()
    path.unlink()

    results = SPAWN.Queue()
    start, attempted, released = (SPAWN.Barrier(WORKERS + 1) for _ in range(3))
    workers = [
        SPAWN.Process(
            target=stale_lane_worker,
            args=(str(path), STALE_ROUNDS, start, attempted, released, results),
        )
        for _ in range(WORKERS)
    ]
    rounds: list[list[dict]] = []
    left_behind: list[list[str]] = []
    try:
        for worker in workers:
            worker.start()
        for _ in range(STALE_ROUNDS):
            path.write_bytes(stale)
            _wait(start, workers)
            _wait(attempted, workers)
            deadline = time.monotonic() + BARRIER_SECONDS
            rounds.append(_collect(results, workers, WORKERS, deadline))
            _wait(released, workers)
            left_behind.append(_leftovers(tmp_path))
        for worker in workers:
            worker.join(JOIN_SECONDS)
            assert worker.exitcode == 0, f"worker {worker.pid} exited with {worker.exitcode}"
    finally:
        _stop(workers)

    assert dead not in {worker_result["pid"] for round_ in rounds for worker_result in round_}

    for number, round_ in enumerate(rounds):
        winners = [result for result in round_ if result["won"]]
        assert len(winners) == 1, f"round {number}: {len(winners)} took the lock: {round_}"
        winner = winners[0]["pid"]
        assert winners[0]["holder"] == winner
        for result in round_:
            if not result["won"]:
                # A loser saw the winner, a lock mid-write, or the dead record before the swap.
                assert result["holder"] in {winner, dead, None}
    assert left_behind == [[]] * STALE_ROUNDS
