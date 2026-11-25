"""Who may let a repair edit its gate: only the lane's live foreman records gate-allow or
ejection-excuse, no label exempts a repair, and the lane checks a repair's gate edits again with
its own code and gate_paths before it validates."""

from __future__ import annotations

import json

import pytest
from conftest import FOREMAN
from test_lane import events, run_steps

from botcore_factory import events as lane_events
from botcore_factory.cells import measure_approve

BRANCH = "feat/export-csv"  # The running fixture's front branch.
GATE_EDIT = {"changed": {BRANCH: ["lefthook.yml", "src/export.ts"]}}
HEAD = "b2c3d4e"  # Its queued head in the running fixture.
FOREMAN_ONLY = [
    ("gate_allow", {"branch": BRANCH, "reason": "the diagnosis found it right", "head": HEAD}),
    ("ejection_excuse", {"branch": BRANCH, "reason": "#1408"}),
]


def as_repair(run, cause: str = "ci-failed") -> None:
    """The front branch came back after an ejection for ``cause``, as the lane would record."""
    with run.store.update("an earlier ejection") as state:
        event = lane_events.emit(state, "2030-01-01T00:00:00Z", "ejected", branch=BRANCH)
        event.update(reason=cause, open=False)
        cell = next(c for c in state["cells"] if c["branch"] == BRANCH)
        cell.update(ejections=1, lastEjection={"attempt": 1, "cause": cause, "excused": None})


def held(run) -> dict:
    return next(entry for entry in run.state()["held"] if entry["branch"] == BRANCH)


@pytest.mark.parametrize(("command", "arguments"), FOREMAN_ONLY)
async def test_naming_no_session_is_refused_and_writes_nothing(make_run, command, arguments):
    run = make_run("running")
    as_repair(run)
    before = run.snapshot()
    refused = await run.call(command, **arguments)
    assert refused.error.code == "FOREMAN_REQUIRED", refused.error
    assert "gate-allow" not in refused.error.suggestion
    assert "lane-wait" not in refused.error.suggestion  # It never says how to take the lane.
    assert run.snapshot() == before


@pytest.mark.parametrize(("command", "arguments"), FOREMAN_ONLY)
async def test_a_session_that_holds_no_lease_is_refused_and_takes_none(
    make_run, command, arguments
):
    """Naming a session is not enough: it never takes the lane for these two."""
    run = make_run("running")
    as_repair(run)
    refused = await run.call(command, **arguments, session="thread-guess")
    assert refused.error.code == "FOREMAN_REQUIRED", refused.error
    assert "lane-wait" not in refused.error.suggestion
    assert run.state()["lane"].get("foreman") is None


@pytest.mark.parametrize(("command", "arguments"), FOREMAN_ONLY)
async def test_only_the_session_holding_the_lane_may(make_run, command, arguments):
    run = make_run("running")
    as_repair(run)
    await run.take_lane()
    busy = await run.call(command, **arguments, session="thread-other")
    assert busy.error.code == "FOREMAN_REQUIRED", busy.error
    # Neither the refusal nor its details name the session that holds the lane.
    assert FOREMAN not in json.dumps(busy.error.model_dump())
    done = await run.call(command, **arguments, session=FOREMAN)
    assert done.success, done.error


async def test_a_cell_s_lane_status_shows_a_foreman_holds_the_lane_but_not_its_session(make_run):
    run = make_run("running")
    await run.take_lane()
    full = (await run.call("lane_status")).data
    assert full["foreman"]["session"] == FOREMAN
    cell = (await run.call("lane_status", run.host("factory-cell"))).data
    assert cell["foreman"] == {"held": True, "until": full["foreman"]["until"]}
    assert FOREMAN not in json.dumps(cell)
    run.change_world(now="2030-01-01T01:00:00Z")  # The lease has run out; its record stays.
    expired = (await run.call("lane_status", run.host("factory-cell"))).data
    assert expired["foreman"]["held"] is False


def test_the_lane_holds_a_repair_whose_gate_edits_its_own_check_finds(make_run):
    """lane-enqueue ran the cell's copy of the check; the lane's binds, before validation."""
    run = make_run("running")
    as_repair(run)
    run.change_world(outcomes=GATE_EDIT)
    actions = run_steps(run)
    assert f"held {BRANCH} (gate-change)" in actions
    assert not any(action.startswith(f"validating {BRANCH}") for action in actions)
    entry = held(run)
    assert entry["holdReason"] == "gate-change"
    assert entry["holdReasons"] == ["its repair after ci-failed edits gate path lefthook.yml"]
    [event] = events(run, "gate-change-held")
    assert event["branch"] == BRANCH and event["needsOwner"] == "gate-change"


def test_a_repair_whose_gate_edits_the_lane_cannot_read_waits_for_a_person(make_run):
    run = make_run("running")
    as_repair(run)
    run.change_world(outcomes={**GATE_EDIT, "repairEdits": {BRANCH: "fail: bad object a1b2"}})
    run_steps(run)
    [reason] = held(run)["holdReasons"]
    assert "could not read" in reason and "bad object a1b2" in reason


def test_a_branch_ejected_for_something_else_is_not_held(make_run):
    """A conflict with a moved main is no failing check: its repair may touch gate paths."""
    run = make_run("running")
    as_repair(run, cause="conflict")
    run.change_world(outcomes=GATE_EDIT)
    assert f"validating {BRANCH} in slot 1" in run_steps(run)


def test_gate_allow_or_the_owner_s_approval_lets_the_repair_validate(make_run):
    run = make_run("running")
    as_repair(run)
    with run.store.update("the foreman's gate-allow") as state:
        cell = next(c for c in state["cells"] if c["branch"] == BRANCH)
        cell["gateAllowed"] = {"reason": "x", "head": HEAD}
    run.change_world(outcomes=GATE_EDIT)
    assert f"validating {BRANCH} in slot 1" in run_steps(run)

    run = make_run("running")  # One for another head covers nothing here.
    as_repair(run)
    with run.store.update("an earlier gate-allow") as state:
        cell = next(c for c in state["cells"] if c["branch"] == BRANCH)
        cell["gateAllowed"] = {"reason": "x", "head": "0ld0ld0"}
    run.change_world(outcomes=GATE_EDIT)
    assert f"held {BRANCH} (gate-change)" in run_steps(run)

    run = make_run("running")
    as_repair(run)
    run.change_world(outcomes=GATE_EDIT)
    run_steps(run)
    approved = measure_approve(run.factory(), BRANCH, "the owner read the gate edit")
    assert approved["state"] == "queued"
    assert any(action.startswith(f"validating {BRANCH}") for action in run_steps(run))


def test_a_later_ejection_for_another_cause_does_not_end_the_check(make_run):
    """The cell keeps its failing-check ejection: a conflict since then starts nothing over."""
    run = make_run("running")
    as_repair(run, cause="conflict")
    with run.store.update("the failing check before it") as state:
        cell = next(c for c in state["cells"] if c["branch"] == BRANCH)
        cell["checkFailed"] = {"head": "a0a0a0a", "cause": "ci-failed", "attempt": 1}
    run.change_world(outcomes=GATE_EDIT)
    assert f"held {BRANCH} (gate-change)" in run_steps(run)
    assert held(run)["holdReasons"] == ["its repair after ci-failed edits gate path lefthook.yml"]


def test_the_lane_keeps_the_failing_check_it_ejects_for(make_run):
    run = make_run("running")
    run.change_world(outcomes={"checks": {BRANCH: "failure"}})
    run_steps(run, 3)
    cell = next(c for c in run.state()["cells"] if c["branch"] == BRANCH)
    assert cell["lastEjection"]["cause"] == "ci-failed"
    assert cell["checkFailed"] == {"head": HEAD, "cause": "ci-failed", "attempt": 1}


def test_a_repair_is_held_before_main_is_merged_in(make_run):
    """A conflict on the way must not eject it first and carry its gate edits past the check."""
    run = make_run("running")
    as_repair(run)
    run.change_world(outcomes={**GATE_EDIT, "merge": {BRANCH: "conflict: src/export.ts"}})
    actions = run_steps(run)
    assert f"held {BRANCH} (gate-change)" in actions
    assert not any(action.startswith(f"ejected {BRANCH}") for action in actions)
