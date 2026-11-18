"""Only a branch's own failures count toward cells.maxEjections: a conflict with a moved main and
the push, PR and merge plumbing are excused by cause, and the foreman excuses a known flake with
ejection-excuse."""

from __future__ import annotations

import pytest
from test_lane import events, run_steps

from botcore_factory.report import lane_report

BRANCH = "feat/export-csv"
CI_FAILED = {"checks": {BRANCH: "failure"}}


def cell_of(run) -> dict:
    return next(c for c in run.state()["cells"] if c["branch"] == BRANCH)


def at_two(run) -> None:
    with run.store.update("two ejections") as state:
        next(c for c in state["cells"] if c["branch"] == BRANCH)["ejections"] = 2


@pytest.mark.parametrize(
    "outcomes,cause",
    [
        (
            {"merge": {BRANCH: "conflict: foundations/fast-af/provenance/provenance.json"}},
            "conflict",
        ),
        ({"push": {BRANCH: "fail: ! [rejected] (non-fast-forward)"}}, "push-failed"),
        ({"pr": {BRANCH: "fail: Validation Failed: No commits between"}}, "pr-failed"),
        ({"mergePr": {BRANCH: "fail: Head branch was modified."}}, "merge-failed"),
    ],
)
def test_an_ejection_that_is_not_the_branch_s_own_does_not_count(make_run, outcomes, cause):
    run = make_run("running")
    at_two(run)
    run.change_world(outcomes=outcomes)
    run_steps(run, 3)
    [ejected] = events(run, "ejected")
    assert ejected["reason"] == cause and ejected["excused"]
    assert events(run, "ejection-limit") == []
    cell = cell_of(run)
    assert (cell["ejections"], cell["excused"], cell["lastEjection"]["cause"]) == (3, 1, cause)
    [record] = [r for r in run.store.read_records() if r["kind"] == "ejected"]
    assert record["counted"] is False and record["excuse"]


def test_the_branch_s_own_failure_counts_and_reaches_the_limit(make_run):
    run = make_run("running")
    at_two(run)
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    [ejected] = events(run, "ejected")
    assert ejected["reason"] == "ci-failed" and "excused" not in ejected
    [limit] = events(run, "ejection-limit")
    assert limit["detail"] == "3 ejections count (0 of 3 excused); cells.maxEjections is 3"
    [record] = [r for r in run.store.read_records() if r["kind"] == "ejected"]
    assert record["counted"] is True


async def test_the_foreman_excuses_a_flake_and_the_limit_is_answered(make_run):
    run = make_run("running")
    at_two(run)
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    result = await run.call(
        "ejection_excuse", branch=BRANCH, reason="#1408: the hosted harness flakes under load"
    )
    assert result.success, result.error
    assert result.data == {
        "branch": BRANCH,
        "attempt": 1,
        "cause": "ci-failed",
        "ejections": 3,
        "excused": 1,
        "counted": 2,
        "limit": 3,
        "answered": [events(run, "ejection-limit")[0]["id"]],
    }
    [limit] = events(run, "ejection-limit")
    assert limit["open"] is False and limit["resolution"]["by"] == "ejection-excuse"
    [ejected] = events(run, "ejected")
    assert ejected["open"] is True  # Still answered by the re-enqueue or a drop.
    cell = cell_of(run)
    assert cell["lastEjection"]["excused"].startswith("#1408")
    [record] = [r for r in run.store.read_records() if r["kind"] == "ejection-excused"]
    assert (record["attempt"], record["cause"]) == (1, "ci-failed")
    report = lane_report(run.factory(), None, None)
    assert (report["ejections"], report["excusedEjections"]) == (1, 1)
    again = await run.call("ejection_excuse", branch=BRANCH, reason="twice")
    assert again.error.code == "ALREADY_EXCUSED"


async def test_lane_status_shows_what_counts(make_run):
    run = make_run("running")
    run.change_world(outcomes={"merge": {BRANCH: "conflict: a"}})
    run_steps(run)
    data = (await run.call("lane_status")).data
    view = next(c for c in data["cells"] if c["branch"] == BRANCH)
    assert (view["ejections"], view["excused"], view["countedEjections"]) == (1, 1, 0)
    assert view["lastEjection"]["excused"] == "main moved under it"
    report = lane_report(run.factory(), None, None)
    assert (report["ejections"], report["excusedEjections"]) == (1, 1)


async def test_an_excuse_needs_an_ejection_a_reason_and_a_cell(make_run):
    run = make_run("running")
    none = await run.call("ejection_excuse", branch=BRANCH, reason="flake")
    assert none.error.code == "NOT_FOUND" and "no ejection" in none.error.message
    empty = await run.call("ejection_excuse", branch=BRANCH, reason=" ")
    assert empty.error.code == "VALIDATION_ERROR"
    missing = await run.call("ejection_excuse", branch="fix/nobody", reason="flake")
    assert missing.error.code == "NOT_FOUND"


async def test_an_ejection_from_before_the_cell_kept_it_is_read_from_the_records(make_run):
    run = make_run("running")
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    with run.store.update("an older lane") as state:
        cell = next(c for c in state["cells"] if c["branch"] == BRANCH)
        del cell["lastEjection"], cell["excused"]
    result = await run.call("ejection_excuse", branch=BRANCH, reason="#1408")
    assert result.success, result.error
    assert (result.data["cause"], result.data["counted"]) == ("ci-failed", 0)


async def test_another_foreman_cannot_excuse(make_run):
    run = make_run("running")
    run.change_world(outcomes=CI_FAILED)
    run_steps(run, 3)
    await run.call("lane_wait", consumer="foreman", session="thread-a", timeout_ms=0)
    busy = await run.call("ejection_excuse", branch=BRANCH, reason="flake", session="thread-b")
    assert busy.error.code == "FOREMAN_BUSY"
