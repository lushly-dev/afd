"""Lane loop and lifecycle integration tests for the shared host validation lock (#1309)."""

from __future__ import annotations

import json
import os
from dataclasses import replace

from test_lane import entry_of, events, queue, run_steps

from botcore_factory.fixture_world import FIXTURE_LANE_PID
from botcore_factory.lane import REVIEW_SLOT
from botcore_factory.lane_process import host_lock, resume, run_loop

LUSHLY_PID = 5_555_001
LUSHLY_JOB_PID = 5_555_002


def _lushly_lock(
    *,
    job_pid: int | None = LUSHLY_JOB_PID,
    acquired_at: str = "2030-01-01T00:00:00Z",
    waiters: list[dict] | None = None,
) -> dict:
    return {
        "version": 1,
        "owner": {
            "lane": "lushly-merge-lane",
            "repository": "lushly-dev/lushly",
            "pid": LUSHLY_PID,
            "startedAtEpoch": LUSHLY_PID,
            "acquiredAt": acquired_at,
            "holds": [
                {
                    "id": "final",
                    "jobPid": job_pid,
                    "jobStartedAtEpoch": job_pid,
                }
            ],
        },
        "waiters": waiters or [],
    }


def _seed_lushly_live(run, *, host_lock: dict | None = None) -> None:
    data = run.world_data()
    processes = data.setdefault("processes", {})
    for pid in (LUSHLY_PID, LUSHLY_JOB_PID):
        if pid not in processes.setdefault("alive", []):
            processes["alive"].append(pid)
        processes.setdefault("startTimes", {})[str(pid)] = float(pid)
    data["hostLock"] = host_lock if host_lock is not None else _lushly_lock()
    run.world_path.write_text(json.dumps(data), encoding="utf-8")


async def test_lane_waits_non_blocking_for_lushly_without_review_or_slot_eviction(make_run):
    run = make_run("running")
    _seed_lushly_live(run)

    # First step: AFD sees Lushly's hold -> waits without pausing, ejecting, or running review.
    actions = run_steps(run)
    assert actions == ["waiting on host validation lock (lushly-merge-lane: lushly-dev/lushly)"]
    assert run.state()["lane"]["paused"] is False
    assert not events(run, "lane-error")
    assert not events(run, "ejected")
    assert queue(run)[0] == ("feat/export-csv", "queued")
    assert REVIEW_SLOT not in run.world_data().get("checkouts", {})
    assert run.state()["lane"]["waitingOnHostLock"] == {
        "lane": "lushly-merge-lane",
        "repository": "lushly-dev/lushly",
        "pid": LUSHLY_PID,
        "acquiredAt": "2030-01-01T00:00:00Z",
    }
    assert [w["lane"] for w in run.world_data()["hostLock"]["waiters"]] == ["botcore-factory"]

    # Deterministic waitingOnHostLock: a second blocked step appends no redundant state log entry.
    log_before = len(run.store.read_log())
    run_steps(run)
    assert len(run.store.read_log()) == log_before

    # lane_status surfaces both waitingOnHostLock and hostLock.
    status = (await run.call("lane_status")).data
    assert status["waitingOnHostLock"]["lane"] == "lushly-merge-lane"
    assert status["hostLock"]["owner"]["repository"] == "lushly-dev/lushly"

    # Once Lushly releases the lock, AFD acquires slot:1, clears waitingOnHostLock, and validates.
    run.change_world(hostLock={"version": 1, "owner": None, "waiters": []})
    run.change_world(outcomes={"validate": {"feat/export-csv": "running"}})
    assert run_steps(run) == ["validating feat/export-csv in slot 1"]
    assert "waitingOnHostLock" not in run.state()["lane"]
    owner = run.world_data()["hostLock"]["owner"]
    assert owner["lane"] == "botcore-factory"
    assert owner["pid"] == FIXTURE_LANE_PID
    assert [h["id"] for h in owner["holds"]] == ["slot:1"]
    assert run.world_data()["hostLock"]["waiters"] == []

    # When validation finishes, slot:1 hold is released.
    run.change_world(outcomes={"validate": {"feat/export-csv": "pass"}})
    run_steps(run)
    # Next queued branch took slot:1 in the same step; let it finish too.
    assert run.world_data()["hostLock"]["owner"]["holds"][0]["id"] == "slot:1"
    run_steps(run)
    assert run.world_data()["hostLock"]["owner"] is None


def test_waiting_on_host_lock_does_not_evict_a_validated_slot(make_run):
    run = make_run("running")
    run.change_world(outcomes={"checks": {"feat/export-csv": "pending"}})
    # Step 1: validate export-csv. Step 2: export-csv merging, retry-backoff validating.
    run_steps(run, 2)
    # Step 3: retry-backoff is validated in slot 1 while export-csv is still merging.
    run_steps(run)
    assert entry_of(run, "fix/retry-backoff")["state"] == "validated"
    assert entry_of(run, "fix/retry-backoff")["slot"] == "1"

    # Requeue export-csv ahead of retry-backoff, then let Lushly hold the host lock.
    with run.store.update("requeue front") as state:
        front = state["queue"][0]
        front["state"] = "queued"
        front.pop("pr", None)
    _seed_lushly_live(run)

    actions = run_steps(run)
    assert actions == ["waiting on host validation lock (lushly-merge-lane: lushly-dev/lushly)"]
    # Slot 1 was NOT evicted while waiting on Lushly.
    assert entry_of(run, "fix/retry-backoff")["slot"] == "1"
    assert not run.state()["lane"].get("keptCheckouts")


def test_waiting_on_host_lock_when_owner_is_null_and_foreign_waiter_is_first(make_run):
    run = make_run("running")
    _seed_lushly_live(
        run,
        host_lock={
            "version": 1,
            "owner": None,
            "waiters": [
                {
                    "lane": "lushly-merge-lane",
                    "repository": "lushly-dev/lushly",
                    "pid": LUSHLY_PID,
                    "startedAtEpoch": LUSHLY_PID,
                    "enqueuedAt": "2030-01-01T00:00:00Z",
                    "refreshedAt": "2030-01-01T00:00:00Z",
                }
            ],
        },
    )
    run_steps(run)
    assert run.state()["lane"]["waitingOnHostLock"] == {
        "lane": "lushly-merge-lane",
        "repository": "lushly-dev/lushly",
        "pid": LUSHLY_PID,
        "enqueuedAt": "2030-01-01T00:00:00Z",
    }


def test_rollback_releases_host_lock_on_pre_start_job_ejection_or_trouble(make_run):
    # Conflict ejects before start_job -> hold released.
    run = make_run("running", outcomes={"merge": {"feat/export-csv": "conflict: src/a.ts"}})
    run.change_world(outcomes={"validate": {"fix/retry-backoff": "running"}})
    run_steps(run)
    # export-csv ejected cleanly; retry-backoff started in slot 1.
    assert events(run, "ejected")[0]["branch"] == "feat/export-csv"

    # Prepare failure pauses via LaneTrouble -> hold released immediately.
    run2 = make_run("running", outcomes={"prepare": {"feat/export-csv": "fail: disk read error"}})
    run_steps(run2)
    assert run2.state()["lane"]["paused"] is True
    assert run2.world_data()["hostLock"]["owner"] is None

    # start_job failure pauses via WorldError -> hold released immediately.
    run3 = make_run("running", outcomes={"start-validate": "fail: spawn failed"})
    run_steps(run3)
    assert run3.state()["lane"]["paused"] is True
    assert run3.world_data()["hostLock"]["owner"] is None


async def test_lane_drop_releases_host_lock_using_daemon_pid_not_cli_pid(make_run):
    run = make_run("running")
    run.change_world(outcomes={"validate": {"feat/export-csv": "running"}})
    run_steps(run)
    assert run.world_data()["hostLock"]["owner"]["pid"] == FIXTURE_LANE_PID
    assert os.getpid() != FIXTURE_LANE_PID

    result = await run.call("lane_drop", branch="feat/export-csv", reason="no longer needed")
    assert result.success, result.error
    assert run.world_data()["hostLock"]["owner"] is None


async def test_coverage_honors_host_lock_and_lane_stop_and_resume(make_run):
    run = make_run("running", queue=[], lane={"gateOwed": [600], "mergedSinceCoverage": [600]})
    _seed_lushly_live(run)

    # Coverage waits when Lushly holds the lock.
    actions = run_steps(run, coverage=["pnpm", "test:cov"])
    assert actions == ["waiting on host validation lock (lushly-merge-lane: lushly-dev/lushly)"]
    assert not run.state()["lane"].get("coverage")

    # Once Lushly releases, coverage acquires "coverage" hold and runs.
    run.change_world(hostLock={"version": 1, "owner": None, "waiters": []})
    run.change_world(outcomes={"coverage": "running"})
    assert run_steps(run, coverage=["pnpm", "test:cov"]) == ["coverage on main-0"]
    assert [h["id"] for h in run.world_data()["hostLock"]["owner"]["holds"]] == ["coverage"]

    # Graceful lane-stop waits for coverage rather than killing it.
    graceful = (await run.call("lane_stop")).data
    assert graceful == {"running": True, "stopping": True, "finishing": ["coverage"]}

    # Forced lane-stop kills coverage and releases its host lock hold.
    forced = (await run.call("lane_stop", force=True)).data
    assert forced == {"running": False}
    assert not run.state()["lane"].get("coverage")
    assert run.world_data()["hostLock"]["owner"] is None

    # Resume kills an orphaned coverage job and clears its hold.
    run2 = make_run("running", queue=[], lane={"gateOwed": [600], "mergedSinceCoverage": [600]})
    run2.change_world(outcomes={"coverage": "running"})
    run_steps(run2, coverage=["pnpm", "test:cov"])
    handle = run2.state()["lane"]["coverage"]["run"]
    assert handle in run2.world_data()["processes"]["running"]
    resume(run2.factory())
    assert handle not in run2.world_data()["processes"]["running"]
    assert not run2.state()["lane"].get("coverage")
    assert run2.world_data()["hostLock"]["owner"] is None


async def test_lane_pause_withdraws_waiter_and_clears_waiting_status(make_run):
    run = make_run("running")
    _seed_lushly_live(run)
    run_steps(run)
    assert len(run.world_data()["hostLock"]["waiters"]) == 1
    assert run.state()["lane"].get("waitingOnHostLock") is not None

    await run.call("lane_pause", reason="maintenance")
    assert run.world_data()["hostLock"]["waiters"] == []
    assert "waitingOnHostLock" not in run.state()["lane"]


async def test_corrupt_host_lock_fails_closed_without_ejecting(make_run):
    run = make_run("running")
    run.change_world(outcomes={"hostLock": "fail: Corrupt host validation lock JSON"})
    run_steps(run)
    assert run.state()["lane"]["paused"] is True
    first_reason = run.state()["lane"]["pauseReason"]
    assert "Corrupt host validation lock" in first_reason
    assert len(events(run, "lane-error")) == 1
    assert not events(run, "ejected")
    assert queue(run)[0] == ("feat/export-csv", "queued")

    # Subsequent ticks while paused must not emit duplicate lane-error events or overwrite reason.
    run_steps(run)
    assert len(events(run, "lane-error")) == 1
    assert run.state()["lane"]["pauseReason"] == first_reason

    status = await run.call("lane_status")
    assert not status.success and status.error.code == "READ_FAILED"


def test_poll_coverage_preserves_main_broken_even_when_host_lock_fails(make_run):
    run = make_run("running", queue=[], lane={"gateOwed": [600], "mergedSinceCoverage": [600]})
    run.change_world(outcomes={"coverage": "running"})
    run_steps(run, coverage=["pnpm", "test:cov"])
    # Coverage fails while the host lock file is corrupt -> main-broken and record still recorded.
    run.change_world(
        outcomes={
            "coverage": "fail: FAIL test_suite",
            "hostLock": "fail: Corrupt host validation lock JSON",
        }
    )
    run_steps(run, coverage=["pnpm", "test:cov"])
    assert run.state()["lane"]["paused"] is True
    assert "main is broken" in run.state()["lane"]["pauseReason"]
    assert len(events(run, "main-broken")) == 1
    assert not events(run, "lane-error")
    assert any(
        r["kind"] == "coverage" and r["outcome"] == "failed" for r in run.store.read_records()
    )


def test_stop_requested_gates_start_coverage_and_run_loop_waits_for_coverage(make_run):
    # stopRequested prevents starting a brand-new coverage run.
    run = make_run(
        "running",
        queue=[],
        lane={"gateOwed": [600], "mergedSinceCoverage": [600], "stopRequested": "after-validation"},
    )
    run_steps(run, coverage=["pnpm", "test:cov"])
    assert not run.state()["lane"].get("coverage")

    # run_loop stays alive while coverage is running and exits once coverage finishes.
    run2 = make_run(
        "running",
        queue=[],
        lane={"running": False, "gateOwed": [600], "mergedSinceCoverage": [600]},
    )
    host_lock(run2.factory()).release(FIXTURE_LANE_PID)
    run2.change_world(outcomes={"coverage": "running"})
    factory = run2.factory()
    factory.config = factory.config.model_copy(update={"coverage": ["pnpm", "test:cov"]})
    ticks = 0

    def after_step(_):
        nonlocal ticks
        ticks += 1
        if ticks == 1:
            with run2.store.update("stop") as state:
                state["lane"]["stopRequested"] = "after-validation"
        elif ticks == 2:
            factory.world.processes.store.data.setdefault("outcomes", {})["coverage"] = "pass"
            factory.world.processes.store.save()

    result = run_loop(factory, steps=5, sleep=after_step, poll=0)
    assert result["steps"] == 3 and result["running"] is False
    assert not run2.state()["lane"].get("coverage")
    assert run2.world_data()["hostLock"]["owner"] is None


def test_start_validation_records_real_job_pid_on_host_lock(make_run):
    run = make_run("running")
    factory = run.factory()
    base_processes = factory.world.processes

    class PidHandleProcesses:
        def __getattr__(self, name):
            return getattr(base_processes, name)

        def start_job(self, steps, cwd, log, *, label):
            base_processes.start_job(steps, cwd, log, label=label)
            return "77777@1700000777.4"

    factory.world = replace(factory.world, processes=PidHandleProcesses())
    from botcore_factory.lane import step

    step(factory)
    hold = run.world_data()["hostLock"]["owner"]["holds"][0]
    assert hold == {"id": "slot:1", "jobPid": 77777, "jobStartedAtEpoch": 1_700_000_777}
