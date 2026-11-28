"""The lane process: starting, stopping, running in the foreground and noticing its death."""

from __future__ import annotations

import json
import os
import sys

import pytest

from botcore_factory.fixture_world import FIXTURE_LANE_PID
from botcore_factory.lane_process import (
    LANE_LOG_ENV,
    host_lock,
    pins,
    run_loop,
    toolchain_mismatches,
)
from botcore_factory.lock import LaneLocked
from botcore_factory.runtime import Refusal


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


def _target_with_nvmrc(tmp_path, example_repo, spec: str):
    target = tmp_path / "nvmrc"
    (target / ".github").mkdir(parents=True)
    (target / "botcore.toml").write_bytes((example_repo / "botcore.toml").read_bytes())
    labels = (example_repo / ".github" / "labels.json").read_bytes()
    (target / ".github" / "labels.json").write_bytes(labels)
    (target / ".nvmrc").write_text(spec + "\n")
    return target


async def test_lane_start_refuses_when_the_nvmrc_node_is_not_installed(
    make_run, tmp_path, example_repo
):
    target = _target_with_nvmrc(tmp_path, example_repo, "26")
    run = make_run(laneHost="workstation", toolchains={"node": "24.21.0"})
    before = run.snapshot()
    result = await run.call("lane_start", run.host(target=target))
    assert result.error.code == "NODE_MISSING"
    assert "fnm install 26" in result.error.suggestion
    assert result.error.details["nvmrc"] == "26"
    assert run.snapshot() == before
    assert "detached" not in run.world_data().get("processes", {})


async def test_lane_start_starts_when_the_nvmrc_node_is_installed(make_run, tmp_path, example_repo):
    target = _target_with_nvmrc(tmp_path, example_repo, "v26")
    run = make_run(laneHost="workstation", nodes={"26": "/fnm/v26.13.0/bin"})
    result = await run.call("lane_start", run.host(target=target))
    assert result.data["running"] is True


async def test_lane_start_refuses_an_nvmrc_alias_it_cannot_resolve(
    make_run, tmp_path, example_repo
):
    target = _target_with_nvmrc(tmp_path, example_repo, "lts/*")
    run = make_run(laneHost="workstation", nodes={"26": "/fnm/v26.13.0/bin"})
    result = await run.call("lane_start", run.host(target=target))
    assert result.error.code == "NODE_UNPINNED"
    assert "version number" in result.error.suggestion


# #1352: lane-start reads the pins on the .nvmrc Node, as validation runs, not the host's PATH.

NODE_26 = "/fnm/v26.13.0/bin"


def _pinned_target_with_nvmrc(tmp_path, example_repo):
    target = _target_with_nvmrc(tmp_path, example_repo, "26")
    (target / "package.json").write_text(
        json.dumps({"packageManager": "pnpm@10.30.1", "engines": {"node": ">=26.0.0"}})
    )
    return target


async def test_lane_start_reads_the_pins_on_the_nvmrc_node_not_the_host_s_path(
    make_run, tmp_path, example_repo
):
    target = _pinned_target_with_nvmrc(tmp_path, example_repo)
    run = make_run(
        laneHost="workstation",
        toolchains={"node": "24.21.0", "pnpm": "9.15.0"},  # The host's default PATH.
        nodes={"26": NODE_26},
        nodeToolchains={NODE_26: {"node": "26.13.0", "pnpm": "10.30.1"}},
    )
    result = await run.call("lane_start", run.host(target=target))
    assert result.data["running"] is True


async def test_lane_start_refuses_a_pnpm_off_its_pin_on_the_nvmrc_node(
    make_run, tmp_path, example_repo
):
    target = _pinned_target_with_nvmrc(tmp_path, example_repo)
    run = make_run(
        laneHost="workstation",
        toolchains={"node": "26.13.0", "pnpm": "10.30.1"},  # Right, but not where jobs look.
        nodes={"26": NODE_26},
        nodeToolchains={NODE_26: {"node": "26.13.0", "pnpm": "10.29.0"}},
    )
    before = run.snapshot()
    result = await run.call("lane_start", run.host(target=target))
    assert result.error.code == "TOOLCHAIN_MISMATCH"
    assert result.error.details["mismatches"] == ["pnpm ==10.30.1 (have 10.29.0)"]
    assert "for Node 26" in result.error.suggestion
    assert run.snapshot() == before


def test_a_pnpm_outside_the_node_s_bin_is_the_one_on_the_host_s_path(
    make_run, tmp_path, example_repo
):
    target = _pinned_target_with_nvmrc(tmp_path, example_repo)
    run = make_run(
        toolchains={"node": "24.21.0", "pnpm": "9.15.0"},
        nodes={"26": NODE_26},
        nodeToolchains={NODE_26: {"node": "26.13.0"}},  # No pnpm beside this Node.
    )
    assert toolchain_mismatches(run.factory(target)) == ["pnpm ==10.30.1 (have 9.15.0)"]


async def test_a_host_probe_names_the_missing_nvmrc_node_and_not_the_default_node(
    make_run, tmp_path, example_repo
):
    target = _pinned_target_with_nvmrc(tmp_path, example_repo)
    run = make_run(toolchains={"node": "24.21.0", "pnpm": "10.30.1"})
    record = (await run.call("lane_host_probe", run.host(target=target))).data["record"]
    assert record["missing"] == ["node 26 from .nvmrc (not installed)"]


def test_run_loop_refuses_when_the_nvmrc_node_is_not_installed(make_run, tmp_path, example_repo):
    target = _target_with_nvmrc(tmp_path, example_repo, "26")
    run = make_run("running", lane={"running": False})
    lock_of(run).release(FIXTURE_LANE_PID)
    with pytest.raises(Refusal) as refused:
        run_loop(run.factory(target), steps=1, sleep=lambda _: None)
    assert refused.value.code == "NODE_MISSING"


async def test_lane_start_starts_the_lane_detached_and_hands_it_the_lock(make_run):
    run = make_run(laneHost="workstation")
    data = (await run.call("lane_start")).data
    assert data["running"] is True and data["runId"] == "run-1"
    detached = run.world_data()["processes"]["detached"][str(data["pid"])]
    assert detached[:3] == [sys.executable, "-m", "botcore_factory.lane_main"]
    assert detached[3] == "--target"
    log = str(run.store.root / "lane.log")
    assert detached[5:] == ["--log", log], "the lane writes and records its own log"
    assert run.state()["lane"]["log"] == log
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


async def test_a_dead_lane_names_the_log_it_recorded(make_run):
    """lushly-dev/afd#2836: lane-stopped named lane.log even when the lane's output went to a
    scheduled task's log; it names the file the lane recorded, or none."""
    for log in ("C:/state/lane-task.log", None):
        run = make_run("running", lane={"log": log})
        data = run.world_data()
        data["processes"]["alive"].remove(FIXTURE_LANE_PID)
        run.world_path.write_text(json.dumps(data))
        status = (await run.call("lane_status")).data
        [stopped] = [e for e in status["openEvents"] if e["type"] == "lane-stopped"]
        assert stopped.get("logPath") == log
        assert ("read its log" in stopped["detail"]) is (log is not None)
    # Started by a lane-start from before the lane recorded its log: lane.log is where it wrote.
    run = make_run("running")
    data = run.world_data()
    data["processes"]["alive"].remove(FIXTURE_LANE_PID)
    run.world_path.write_text(json.dumps(data))
    status = (await run.call("lane_status")).data
    [stopped] = [e for e in status["openEvents"] if e["type"] == "lane-stopped"]
    assert stopped["logPath"] == str(run.store.root / "lane.log")


def test_run_loop_records_the_log_its_launcher_named(make_run, monkeypatch):
    monkeypatch.setenv(LANE_LOG_ENV, "C:/state/lane-task.log")
    run = make_run("running", lane={"running": False})
    lock_of(run).release(FIXTURE_LANE_PID)
    seen = []
    run_loop(
        run.factory(), steps=2, sleep=lambda _: seen.append(run.state()["lane"].get("log")),
        poll=0,
    )  # fmt: skip
    assert seen == ["C:/state/lane-task.log"]


def test_run_loop_takes_the_lock_steps_and_ends_the_run(make_run):
    run = make_run("running", lane={"running": False})
    lock_of(run).release(FIXTURE_LANE_PID)
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
    run = make_run("running")
    with pytest.raises(Refusal) as refused:
        run_loop(run.factory(), steps=1, sleep=lambda _: None)
    assert refused.value.code == "LANE_LOCKED"


async def test_run_loop_takes_the_lock_over_from_the_launcher_that_started_it(
    make_run, monkeypatch
):
    # On Windows a venv's python.exe is a launcher: lane-start's pid is the interpreter's parent.
    run = make_run("running", lane={"running": False})
    lock_of(run).release(FIXTURE_LANE_PID)
    started = (await run.call("lane_start")).data
    launcher = started["pid"]
    assert launcher != os.getpid()
    monkeypatch.setattr(os, "getppid", lambda: launcher)
    world = run.world_data()
    world["processes"].setdefault("startTimes", {})[str(os.getpid())] = 123.0
    run.world_path.write_text(json.dumps(world))
    seen = []

    def during(_):
        seen.append((lock_of(run).live_holder(), run.state()["lane"]))

    result = run_loop(run.factory(), steps=2, sleep=during, poll=0)
    holder, lane = seen[0]
    # lane-stop and terminate name the interpreter, with its own start time.
    assert (holder["pid"], holder["startedAt"]) == (os.getpid(), 123.0)
    assert (lane["running"], lane["pid"], lane["runId"]) == (True, os.getpid(), started["runId"])
    assert result["runId"] == started["runId"]
    assert [r["kind"] for r in run.store.read_records()].count("run-started") == 1
    assert lock_of(run).holder() is None


async def test_run_loop_refuses_a_lane_start_pid_that_is_not_its_parent(make_run, monkeypatch):
    run = make_run("running", lane={"running": False})
    lock_of(run).release(FIXTURE_LANE_PID)
    started = (await run.call("lane_start")).data
    monkeypatch.setattr(os, "getppid", lambda: started["pid"] + 1)
    with pytest.raises(Refusal) as refused:
        run_loop(run.factory(), steps=1, sleep=lambda _: None)
    assert refused.value.code == "LANE_LOCKED"
    assert lock_of(run).live_holder()["pid"] == started["pid"]
    assert run.state()["lane"]["pid"] == started["pid"]


@pytest.mark.parametrize("lane", [{"running": False}, {"pid": FIXTURE_LANE_PID + 1}])
def test_run_loop_refuses_its_parent_s_lock_unless_the_state_names_it_running(
    make_run, monkeypatch, lane
):
    # A lane-start that failed after starting the child never marked the run as the parent's.
    run = make_run("running")
    with run.store.update("test") as state:
        state["lane"].update(lane)
    monkeypatch.setattr(os, "getppid", lambda: FIXTURE_LANE_PID)
    with pytest.raises(Refusal) as refused:
        run_loop(run.factory(), steps=1, sleep=lambda _: None)
    assert refused.value.code == "LANE_LOCKED"
    assert lock_of(run).live_holder()["pid"] == FIXTURE_LANE_PID


def test_run_loop_continues_the_run_lane_start_handed_to_it(make_run):
    # POSIX: start_detached's pid is the lane process itself, so nothing is taken over.
    run = make_run("running")
    lock_of(run).hand_over(os.getpid())
    with run.store.update("test") as state:
        state["lane"]["pid"] = os.getpid()
    run_id = run.state()["lane"]["runId"]
    seen = []
    result = run_loop(
        run.factory(), steps=2, sleep=lambda _: seen.append(run.state()["lane"]["pid"]), poll=0
    )
    assert result["runId"] == run_id and seen == [os.getpid()]
    assert [r["kind"] for r in run.store.read_records()].count("run-started") == 0


def test_run_loop_refuses_another_repository_s_lane_held_by_its_parent(make_run, monkeypatch):
    run = make_run("running")  # The state names FIXTURE_LANE_PID: only the repository differs.
    lock_of(run).release(FIXTURE_LANE_PID)
    lock_of(run).acquire(FIXTURE_LANE_PID, repository="other/repo")
    monkeypatch.setattr(os, "getppid", lambda: FIXTURE_LANE_PID)
    with pytest.raises(Refusal) as refused:
        run_loop(run.factory(), steps=1, sleep=lambda _: None)
    assert refused.value.code == "LANE_LOCKED"
    assert lock_of(run).live_holder()["pid"] == FIXTURE_LANE_PID


def test_a_restarted_lane_lands_what_merged_meanwhile(make_run):
    run = make_run("running", lane={"running": False})
    lock_of(run).release(FIXTURE_LANE_PID)
    from test_lane import run_steps

    run.change_world(outcomes={"checks": {"feat/export-csv": "pending"}})
    run_steps(run, 2)  # export-csv is merging; retry-backoff validating.
    run.change_world(prs={"600": {"state": "MERGED"}}, processes={"running": {}})
    result = run_loop(run.factory(), steps=1, sleep=lambda _: None)
    assert result["steps"] == 1
    kinds = [r["kind"] for r in run.store.read_records()]
    assert "merged" in kinds and "rerun" in kinds
    assert all(e["branch"] != "feat/export-csv" for e in run.state()["queue"])


def test_a_checked_hand_over_refuses_when_the_lock_moved(make_run):
    run = make_run("running")
    with pytest.raises(LaneLocked):
        lock_of(run).hand_over(os.getpid(), from_pid=FIXTURE_LANE_PID + 1)
    assert lock_of(run).holder()["pid"] == FIXTURE_LANE_PID


async def test_the_lock_is_one_per_host(make_run, tmp_path):
    run = make_run(laneHost="workstation")
    lock = lock_of(run)
    lock.acquire(os.getpid(), repository="other/repo")
    result = await run.call("lane_start")
    assert result.error.code == "LANE_LOCKED" and "other/repo" in result.error.message
    lock.release(pid=12345)  # Not the holder: nothing happens.
    assert lock.holder()["pid"] == os.getpid()


# B3: a status read never kills, and nothing is killed that is not provably the lane.


async def test_a_status_read_marks_a_dead_lane_stopped_and_kills_nothing(make_run):
    run = make_run("running")
    from test_lane import run_steps

    run.change_world(outcomes={"validate": {"feat/export-csv": "running"}})
    run_steps(run)
    [handle] = run.world_data()["processes"]["running"]
    data = run.world_data()
    data["processes"]["alive"].remove(FIXTURE_LANE_PID)
    run.world_path.write_text(json.dumps(data))
    status = (await run.call("lane_status")).data
    assert status["running"] is False
    processes = run.world_data()["processes"]
    assert "killed" not in processes and handle in processes["running"]
    entry = run.state()["queue"][0]
    assert (entry["branch"], entry["state"], entry["run"]) == (
        "feat/export-csv",
        "validating",
        handle,
    )
    # The next lane takes it up: the orphaned job is killed, never left running in its slot.
    from botcore_factory.lane_process import resume

    resume(run.factory())
    assert handle not in run.world_data()["processes"]["running"]
    queue = run.state()["queue"]
    assert (queue[0]["branch"], queue[0]["state"]) == ("feat/export-csv", "queued")


async def test_a_reused_pid_is_never_stopped(make_run):
    run = make_run("running")
    run.change_world(processes={"startTimes": {str(FIXTURE_LANE_PID): 99.0}})  # Another process.
    assert (await run.call("lane_stop")).data == {"running": False}
    processes = run.world_data()["processes"]
    assert FIXTURE_LANE_PID in processes["alive"] and "killed" not in processes


async def test_a_lock_without_a_start_time_is_never_acted_on(make_run):
    run = make_run("running")
    lock = lock_of(run)
    holder = lock.holder()
    holder.pop("startedAt")
    lock.path.write_text(json.dumps(holder))
    result = await run.call("lane_stop")
    assert result.error.code == "LANE_LOCKED" and "could not be confirmed" in result.error.message
    assert FIXTURE_LANE_PID in run.world_data()["processes"]["alive"]
    assert lock.holder()["pid"] == FIXTURE_LANE_PID


async def test_lane_stop_kills_the_verified_lane(make_run):
    run = make_run("running")
    assert (await run.call("lane_stop")).data == {"running": False}
    assert run.world_data()["processes"]["killed"] == [FIXTURE_LANE_PID]


# S9: the lock is one per machine; stopping one repository's lane leaves another's alone.


async def test_lane_stop_leaves_another_repository_s_lane_alone(make_run):
    run = make_run("running")
    lock = lock_of(run)
    lock.path.write_text(json.dumps({**lock.holder(), "repository": "other/repo"}))
    assert (await run.call("lane_stop")).data == {"running": False}
    assert FIXTURE_LANE_PID in run.world_data()["processes"]["alive"]
    assert lock.holder()["repository"] == "other/repo"
    assert run.state()["lane"]["running"] is False


# S4 and S7: the foreground loop outlasts a busy state lock, and refuses as lane-start does.


def test_run_loop_waits_out_a_busy_state_lock(make_run, monkeypatch):
    from botcore_factory import lane_process
    from botcore_factory.state import StateLocked

    run = make_run("running", lane={"running": False})
    lock_of(run).release(FIXTURE_LANE_PID)
    real, calls = lane_process.step, []

    def busy_once(factory):
        calls.append(1)
        if len(calls) == 1:
            raise StateLocked("a command holds the state lock")
        return real(factory)

    monkeypatch.setattr(lane_process, "step", busy_once)
    slept = []
    result = run_loop(run.factory(), steps=2, sleep=slept.append, poll=0)
    assert result["steps"] == 2 and len(calls) == 3 and len(slept) == 2


RUN_REFUSALS = [
    ({"requiredCheckOnMain": False}, "REQUIRED_CHECK_MISSING"),
    ({"laneHost": "mini"}, "NOT_LANE_HOST"),
]


@pytest.mark.parametrize("overrides,code", RUN_REFUSALS, ids=[r[1] for r in RUN_REFUSALS])
def test_run_loop_refuses_on_lane_start_s_grounds(make_run, overrides, code):
    run = make_run("running", lane={"running": False}, **overrides)
    lock_of(run).release(FIXTURE_LANE_PID)
    with pytest.raises(Refusal) as refused:
        run_loop(run.factory(), steps=1, sleep=lambda _: None)
    assert refused.value.code == code
    assert lock_of(run).holder() is None


def test_run_loop_refuses_a_toolchain_off_the_pins(make_run, tmp_path, example_repo):
    target = tmp_path / "pinned"
    (target / ".github").mkdir(parents=True)
    (target / "botcore.toml").write_bytes((example_repo / "botcore.toml").read_bytes())
    labels = (example_repo / ".github" / "labels.json").read_bytes()
    (target / ".github" / "labels.json").write_bytes(labels)
    (target / "package.json").write_text(json.dumps({"packageManager": "pnpm@10.30.1"}))
    run = make_run("running", lane={"running": False}, toolchains={"pnpm": "9.15.0"})
    lock_of(run).release(FIXTURE_LANE_PID)
    with pytest.raises(Refusal) as refused:
        run_loop(run.factory(target), steps=1, sleep=lambda _: None)
    assert refused.value.code == "TOOLCHAIN_MISMATCH"


# Nits: the host lock's write grace, and release only by its holder.


def test_a_lock_being_written_counts_as_held_and_an_abandoned_one_is_broken(make_run):
    from botcore_factory.lock import WRITING_GRACE_SECONDS, LaneLocked

    run = make_run(laneHost="workstation")
    lock = lock_of(run)
    lock.path.parent.mkdir(parents=True, exist_ok=True)
    lock.path.write_text("")  # Another process is between creating and writing it.
    assert lock.live_holder() == {"pid": None, "writing": True}
    with pytest.raises(LaneLocked):
        lock.acquire(os.getpid())
    lock.release(os.getpid())
    assert lock.path.exists()
    old = lock.path.stat().st_mtime - WRITING_GRACE_SECONDS - 1
    os.utime(lock.path, (old, old))
    assert lock.live_holder() is None
    lock.acquire(os.getpid(), repository="o/r")
    assert lock.holder()["pid"] == os.getpid()
    lock.release(os.getpid())
    assert lock.holder() is None
