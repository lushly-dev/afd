"""The lane process: starting, stopping, running in the foreground and noticing its death."""

from __future__ import annotations

import json
import os
import sys

import pytest

from botcore_factory.fixture_world import FIXTURE_LANE_PID
from botcore_factory.lane_process import host_lock, pins, run_loop


def lock_of(run):
    return host_lock(run.factory())


START_REFUSALS = [
    ("fresh", {}, "HOST_NOT_SET", "lane-host-list"),
    ("fresh", {"laneHost": "mini"}, "NOT_LANE_HOST", "lane-host-set"),
    ("running", {}, "LANE_LOCKED", "lane-stop"),
    (
        "fresh",
        {"laneHost": "workstation", "requiredCheckOnMain": False},
        "REQUIRED_CHECK_MISSING",
        "required",
    ),
]


@pytest.mark.parametrize(
    "name,overrides,code,hint", START_REFUSALS, ids=[r[2] for r in START_REFUSALS]
)
async def test_lane_start_refuses_with_the_way_forward_and_starts_nothing(
    make_run, name, overrides, code, hint
):
    run = make_run(name, **overrides)
    before = run.snapshot()
    result = await run.call("lane_start")
    assert result.error.code == code and hint in result.error.suggestion
    assert run.snapshot() == before
    assert "detached" not in run.world_data().get("processes", {})


async def test_lane_start_refuses_a_toolchain_off_the_repository_s_pins(
    make_run, tmp_path, example_repo
):
    target = tmp_path / "pinned"
    target.mkdir()
    for name in ("botcore.toml", ".github"):
        source = example_repo / name
        if source.is_dir():
            (target / name).mkdir()
            (target / name / "labels.json").write_bytes((source / "labels.json").read_bytes())
        else:
            (target / name).write_bytes(source.read_bytes())
    (target / "package.json").write_text(
        json.dumps({"packageManager": "pnpm@10.30.1", "engines": {"node": ">=22.12.0"}})
    )
    run = make_run(laneHost="workstation", toolchains={"pnpm": "9.15.0", "node": "24.1.0"})
    result = await run.call("lane_start", run.host(target=target))
    assert result.error.code == "TOOLCHAIN_MISMATCH"
    assert result.error.details["mismatches"] == ["pnpm ==10.30.1 (have 9.15.0)"]
    assert pins(target) == {"pnpm": "==10.30.1", "node": ">=22.12.0"}


async def test_lane_start_starts_the_lane_detached_and_hands_it_the_lock(make_run):
    run = make_run(laneHost="workstation")
    data = (await run.call("lane_start")).data
    assert data["running"] is True and data["runId"] == "run-1"
    detached = run.world_data()["processes"]["detached"][str(data["pid"])]
    assert detached[:3] == [sys.executable, "-m", "botcore_factory.lane_main"]
    assert detached[3] == "--target"
    assert lock_of(run).live_holder()["pid"] == data["pid"]
    lane = run.state()["lane"]
    assert (lane["running"], lane["pid"], lane["runId"]) == (True, data["pid"], "run-1")
    assert run.store.read_records()[-1]["kind"] == "run-started"
    again = await run.call("lane_start")
    assert again.error.code == "LANE_LOCKED"


async def test_lane_stop_on_an_idle_lane_stops_it_and_summarizes_the_run(make_run):
    run = make_run("finished")
    assert (await run.call("lane_stop")).data == {"running": False}
    assert FIXTURE_LANE_PID not in run.world_data()["processes"]["alive"]
    assert lock_of(run).holder() is None
    state = run.state()
    assert state["lane"]["running"] is False
    assert run.store.read_records()[-1] == {
        **run.store.read_records()[-1],
        "kind": "run-stopped",
        "reason": "stopped",
    }


async def test_lane_stop_lets_a_validation_finish_unless_forced(make_run):
    run = make_run("running")
    from test_lane import run_steps

    run.change_world(outcomes={"validate": {"feat/export-csv": "running"}})
    run_steps(run)
    data = (await run.call("lane_stop")).data
    assert data == {"running": True, "stopping": True, "finishing": ["feat/export-csv"]}
    assert run.state()["lane"]["stopRequested"] == "after-validation"
    forced = (await run.call("lane_stop", force=True)).data
    assert forced == {"running": False}
    queue = run.state()["queue"]
    assert (queue[0]["branch"], queue[0]["state"]) == ("feat/export-csv", "queued")
    reasons = [
        r.get("reason") for r in run.store.read_records() if r["kind"] in ("rerun", "run-stopped")
    ]
    assert reasons == ["restart", "forced"]


async def test_a_dead_lane_is_noticed_by_status_and_wait(make_run):
    run = make_run("running")
    data = run.world_data()
    data["processes"]["alive"].remove(FIXTURE_LANE_PID)
    run.world_path.write_text(json.dumps(data))
    status = (await run.call("lane_status")).data
    assert status["running"] is False
    stopped = [e for e in status["openEvents"] if e["type"] == "lane-stopped"]
    assert len(stopped) == 1 and str(FIXTURE_LANE_PID) in stopped[0]["detail"]
    waited = (await run.call("lane_wait", consumer="observer", timeout_ms=1)).data
    assert [e["type"] for e in waited["events"]].count("lane-stopped") == 1
    await run.call("lane_status")  # Noticed once.
    assert len([e for e in run.state()["events"] if e["type"] == "lane-stopped"]) == 1


def test_run_loop_takes_the_lock_steps_and_ends_the_run(make_run):
    run = make_run("running", lane={"running": False})
    lock_of(run).release()
    slept = []
    result = run_loop(run.factory(), steps=3, sleep=slept.append, poll=0)
    assert result["steps"] == 3 and len(slept) == 2
    assert lock_of(run).holder() is None
    state = run.state()
    assert state["lane"]["running"] is False
    run_record = next(r for r in state["runs"] if r["id"] == result["runId"])
    assert run_record["merged"] == 1 and run_record["validations"] == 2
    assert run_record["prs"][0]["number"] == 600


def test_run_loop_refuses_while_another_lane_runs(make_run):
    from botcore_factory.runtime import Refusal

    run = make_run("running")
    with pytest.raises(Refusal) as refused:
        run_loop(run.factory(), steps=1, sleep=lambda _: None)
    assert refused.value.code == "LANE_LOCKED"


def test_a_restarted_lane_lands_what_merged_meanwhile(make_run):
    run = make_run("running", lane={"running": False})
    lock_of(run).release()
    from test_lane import run_steps

    run.change_world(outcomes={"checks": {"feat/export-csv": "pending"}})
    run_steps(run, 2)  # export-csv is merging; retry-backoff validating.
    run.change_world(prs={"600": {"state": "MERGED"}}, processes={"running": {}})
    result = run_loop(run.factory(), steps=1, sleep=lambda _: None)
    assert result["steps"] == 1
    kinds = [r["kind"] for r in run.store.read_records()]
    assert "merged" in kinds and "rerun" in kinds
    assert all(e["branch"] != "feat/export-csv" for e in run.state()["queue"])


async def test_the_lock_is_one_per_host(make_run, tmp_path):
    run = make_run(laneHost="workstation")
    lock = lock_of(run)
    lock.acquire(os.getpid(), repository="other/repo")
    result = await run.call("lane_start")
    assert result.error.code == "LANE_LOCKED" and "other/repo" in result.error.message
    lock.release(pid=12345)  # Not the holder: nothing happens.
    assert lock.holder()["pid"] == os.getpid()
