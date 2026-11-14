"""The commands through the factory host, over fixture worlds."""

from __future__ import annotations

import json

import pytest
from conftest import REPO_ROOT

from botcore_factory.fixture_world import FixtureGitHub, FixtureWorld
from botcore_factory.world import WorldError


class FailingGitHub(FixtureGitHub):
    """The fixture's GitHub, failing the named operations."""

    def __init__(self, store, *failing):
        super().__init__(store)
        self.failing = set(failing)

    def __getattribute__(self, name):
        if name in object.__getattribute__(self, "failing"):

            def fail(*args, **kwargs):
                raise WorldError(f"gh {name} failed: HTTP 502")

            return fail
        return object.__getattribute__(self, name)


def failing(run, *operations):
    return {"github": FailingGitHub(FixtureWorld(run.world_path), *operations)}


# issue_check


async def test_issue_check_reports_the_backlog(make_run):
    run = make_run("backlog")
    result = await run.call("issue_check")
    assert result.success, result.error
    data = result.data
    assert data["untriaged"] == [202]
    assert data["violations"] == [
        {
            "number": 203,
            "rule": "several execution profiles (execution:bounded, execution:deep): keep one "
            "execution profile",
        }
    ]
    assert data["dispatchable"] == [206, 201]
    assert data["related"] == []
    assert data["staleClaims"] == [
        {
            "number": 208,
            "branch": "fix/cli-help",
            "machine": "laptop",
            "leaseUntil": "2030-01-02T07:00:00Z",
        }
    ]
    # The expert lane is held, assigned to the owner, and breaks no rule.
    assert [(h["number"], h["reasons"]) for h in data["held"]][1] == (
        207,
        ["execution:expert-escalation: the owner's lane"],
    )
    assert data["total"]["dispatchable"] == 2 and "nextCursor" not in data


async def test_issue_check_reads_only_the_numbered_issues(make_run):
    data = (await make_run("backlog").call("issue_check", numbers=[203, 206])).data
    assert data["dispatchable"] == [206] and [v["number"] for v in data["violations"]] == [203]


async def test_issue_check_refuses_what_is_not_an_issue_number(make_run):
    result = await make_run("backlog").call("issue_check", numbers=[0, 203])
    assert result.error.code == "VALIDATION_ERROR" and "numbers" in result.error.suggestion


async def test_issue_check_pages_every_list(make_run):
    run = make_run("backlog")
    first = (await run.call("issue_check", limit=1)).data
    assert first["dispatchable"] == [206] and first["nextCursor"] == "1"
    rest = (await run.call("issue_check", limit=1, cursor=first["nextCursor"])).data
    assert rest["dispatchable"] == [201] and rest["violations"] == []
    assert [held["number"] for held in rest["held"]] == [207]
    assert "nextCursor" not in rest
    bad = await run.call("issue_check", cursor="abc")
    assert bad.error.code == "VALIDATION_ERROR" and "nextCursor" in bad.error.suggestion
    assert (await run.call("issue_check", limit=0)).error.code == "VALIDATION_ERROR"


@pytest.mark.parametrize("operation", ["list_issues", "open_pull_requests", "comments"])
async def test_a_failed_read_is_read_failed_never_an_empty_success(make_run, operation):
    run = make_run("backlog")
    result = await run.call("issue_check", run.host(**failing(run, operation)))
    assert not result.success and result.error.code == "READ_FAILED"
    assert "HTTP 502" in result.error.message and result.error.suggestion


async def test_a_claim_label_without_a_claim_comment_is_a_stale_claim(make_run):
    run = make_run("backlog")
    data = run.world_data()
    next(i for i in data["issues"] if i["number"] == 205)["comments"] = []
    run.world_path.write_text(json.dumps(data))
    stale = (await run.call("issue_check")).data["staleClaims"]
    assert {"number": 205, "branch": None, "machine": None, "leaseUntil": None} in stale


async def test_intake_needs_the_adapter_s_labels(make_run, tmp_path):
    run = make_run("backlog")
    bare = tmp_path / "bare-repo"
    bare.mkdir()
    result = await run.call("issue_check", run.host(target=bare))
    assert result.error.code == "NOT_CONFIGURED" and "labels" in result.error.suggestion
    (bare / "botcore.toml").write_text('[plugins.factory]\nlabels = "labels.json"\n')
    (bare / "labels.json").write_text("{")
    result = await run.call("issue_check", run.host(target=bare))
    assert result.error.code == "ADAPTER_INVALID"


# cell_register


async def test_registering_claims_the_issue_and_assigns_the_roomiest_plan(make_run):
    run = make_run("backlog")
    result = await run.call(
        "cell_register", branch="fix/server-timeout", issues=[206], route="sol/high"
    )
    assert result.success, result.error
    cell = result.data["cell"]
    assert cell["issues"] == [206] and cell["plan"] == "plan-a" and cell["state"] == "registered"
    assert cell["leaseUntil"] == "2030-01-04T00:00:00Z" and cell["machine"] == "workstation"
    issue = next(i for i in run.world_data()["issues"] if i["number"] == 206)
    assert "status:in-progress" in issue["labels"] and "status:planned" not in issue["labels"]
    assert "botcore-factory:claim" in issue["comments"][-1]["body"]
    assert [c["branch"] for c in run.state()["cells"]] == [
        "fix/client-timeout",
        "fix/server-timeout",
    ]
    [record] = run.store.read_records()
    assert (record["kind"], record["branch"], record["profile"]) == (
        "cell-registered",
        "fix/server-timeout",
        "bounded",
    )
    # The claimed issue leaves the dispatch list and holds no stale claim.
    data = (await run.call("issue_check")).data
    assert data["dispatchable"] == [201] and [s["number"] for s in data["staleClaims"]] == [208]


async def test_registering_answers_open_queue_room_events(make_run):
    run = make_run(events=[{"id": "ev-1", "type": "queue-room", "open": True}])
    assert (await run.call("cell_register", branch="fix/a", issues=[101], route="r")).success
    assert run.state()["events"][0]["open"] is False


REFUSALS = [
    (
        "backlog",
        {},
        {"branch": "fix/two", "issues": [201, 206]},
        "TOO_MANY_ISSUES",
        "cells.issuesMax",
    ),
    (
        "backlog",
        {"dials": {"cells.issuesMax": 2}},
        {"branch": "fix/two", "issues": [201, 206]},
        "TOO_MANY_ISSUES",
        "related",
    ),
    (
        "backlog",
        {},
        {"branch": "fix/client-timeout", "issues": [201]},
        "ALREADY_EXISTS",
        "lane-drop",
    ),
    ("backlog", {}, {"branch": "fix/other", "issues": [205]}, "ALREADY_CLAIMED", "issue-check"),
    ("backlog", {}, {"branch": "fix/stale", "issues": [208]}, "ALREADY_CLAIMED", "staleClaims"),
    (
        "backlog",
        {},
        {"branch": "feat/naming", "issues": [204]},
        "NOT_DISPATCHABLE",
        "triage-issues",
    ),
    ("backlog", {}, {"branch": "fix/rules", "issues": [203]}, "NOT_DISPATCHABLE", "triage-issues"),
    ("backlog", {}, {"branch": "fix/expert", "issues": [207]}, "NOT_DISPATCHABLE", "triage-issues"),
    (
        "backlog",
        {"dials": {"cells.max": 1}},
        {"branch": "fix/b", "issues": [201]},
        "CELLS_FULL",
        "lane-wait",
    ),
    ("at-ceiling", {}, {"branch": "fix/c", "issues": [101]}, "PLAN_ABOVE_CEILING", "2030-01-08"),
    (
        "fresh",
        {"host": {"freeMemoryGb": 4}},
        {"branch": "fix/d", "issues": [101]},
        "HOST_LOADED",
        "host.minFreeGb",
    ),
    (
        "fresh",
        {"plansUnreadable": True},
        {"branch": "fix/e", "issues": [101]},
        "PLANS_UNREADABLE",
        "T3 Code",
    ),
    ("fresh", {}, {"branch": "has space", "issues": [101]}, "VALIDATION_ERROR", "branch"),
    ("fresh", {}, {"branch": "fix/f", "issues": []}, "VALIDATION_ERROR", "issue"),
]


@pytest.mark.parametrize(
    "name,overrides,arguments,code,hint",
    REFUSALS,
    ids=[f"{r[3]}-{r[2]['branch']}" for r in REFUSALS],
)
async def test_a_refused_registration_names_the_way_forward_and_writes_nothing(
    make_run, name, overrides, arguments, code, hint
):
    run = make_run(name, **overrides)
    before = run.snapshot()
    result = await run.call("cell_register", route="sol/high", **arguments)
    assert not result.success and result.error.code == code, result.error
    assert hint in result.error.suggestion
    assert run.snapshot() == before


async def test_already_claimed_names_the_holding_branch(make_run):
    result = await make_run("backlog").call("cell_register", branch="x", issues=[205], route="r")
    assert "fix/client-timeout" in result.error.message
    assert result.error.details["holder"]["machine"] == "workstation"


async def test_a_failed_claim_write_records_no_cell(make_run):
    run = make_run("backlog")
    host = run.host(**failing(run, "add_comment"))
    result = await run.call("cell_register", host, branch="fix/w", issues=[201], route="r")
    assert result.error.code == "WRITE_FAILED"
    assert "#201 labelled status:in-progress" in result.error.message
    assert all(cell["branch"] != "fix/w" for cell in run.state()["cells"])


# lane_status


async def test_status_says_a_cell_may_start_on_which_plan_and_issue(make_run):
    data = (await make_run("fresh", laneHost="workstation").call("lane_status")).data
    assert data["canStartCell"] is True and data["nextIssue"] == 101
    assert data["plan"]["id"] == "plan-a" and data["plan"]["room"] == 70
    assert data["host"] == {"id": "workstation", "isLaneHost": True, "laneHost": "workstation"}
    assert data["slots"] == {"total": 1, "busy": 0}
    assert data["dials"]["cells.max"] == 3 and data["running"] is False


async def test_status_says_why_not_and_when_room_returns(make_run):
    data = (await make_run("at-ceiling").call("lane_status")).data
    assert data["canStartCell"] is False and "ceiling" in data["reason"]
    assert data["nextReset"] == "2030-01-08T00:00:00Z"
    draining = (await make_run(lane={"draining": True}).call("lane_status")).data
    assert draining["canStartCell"] is False and "draining" in draining["reason"]
    loaded = (await make_run(host={"freeMemoryGb": 2}).call("lane_status")).data
    assert "loaded" in loaded["reason"]
    full = (await make_run("backlog", dials={"cells.max": 1}).call("lane_status")).data
    assert "seat" in full["reason"]
    unreadable = (await make_run(plansUnreadable=True).call("lane_status")).data
    assert unreadable["canStartCell"] is False and "plans" in unreadable["reason"]
    empty = (await make_run(issues=[]).call("lane_status")).data
    assert "triage-issues" in empty["reason"]


async def test_status_of_the_backlog(make_run):
    data = (await make_run("backlog").call("lane_status")).data
    assert (data["runId"], data["paused"], data["pauseReason"]) == (
        "run-4",
        True,
        "gh sign-in expired",
    )
    assert data["cells"] == [
        {
            "branch": "fix/client-timeout",
            "issues": [205],
            "issue": 205,
            "state": "working",
            "plan": "plan-a",
            "route": "sol/high",
            "ejections": 0,
            "thread": "thread-7",
        }
    ]
    assert [event["id"] for event in data["openEvents"]] == ["ev-41"]
    assert data["waitingOnOwner"] == 2  # #204's decision and the sign-in.
    assert data["nextIssue"] == 206


async def test_status_fails_on_a_failed_read(make_run):
    run = make_run("backlog")
    result = await run.call("lane_status", run.host(**failing(run, "get_variable")))
    assert result.error.code == "READ_FAILED"


# dials


async def test_dial_get_reads_one_or_every_dial(make_run):
    run = make_run()
    assert (await run.call("dial_get", key="lane.slots")).data == {
        "key": "lane.slots",
        "value": 1,
        "default": 1,
    }
    every = (await run.call("dial_get")).data["dials"]
    assert {"key": "plans.ceiling", "value": 85, "default": 85} in every
    missing = await run.call("dial_get", key="lane.slot")
    assert missing.error.code == "NOT_FOUND" and "lane.slots" in missing.error.suggestion


async def test_dial_set_returns_the_previous_value_and_refuses_out_of_range(make_run):
    run = make_run()
    too_many = await run.call("dial_set", key="lane.slots", value=8)
    assert too_many.error.code == "DIAL_OUT_OF_RANGE" and "4" in too_many.error.message
    assert (await run.call("dial_set", key="lane.slots", value=3)).data == {
        "key": "lane.slots",
        "value": 3,
        "previous": 1,
        "default": 1,
    }
    assert (await run.call("dial_get", key="lane.slots")).data["value"] == 3
    assert (await run.call("lane_status")).data["slots"]["total"] == 3
    assert run.store.read_log()[-1]["kind"] == "state"


@pytest.mark.parametrize(
    "key,value,code",
    [
        ("cells.max", 2.5, "DIAL_OUT_OF_RANGE"),
        ("cells.max", 0, "DIAL_OUT_OF_RANGE"),
        ("experience.hold", 1, "DIAL_OUT_OF_RANGE"),
        ("plans.ceiling", True, "DIAL_OUT_OF_RANGE"),
        ("review.enabled", False, "CONFIRMATION_REQUIRED"),
        ("no.such", 1, "NOT_FOUND"),
    ],
)
async def test_dial_set_refusals_write_nothing(make_run, key, value, code):
    run = make_run()
    before = run.snapshot()
    result = await run.call("dial_set", key=key, value=value)
    assert result.error.code == code and result.error.suggestion
    assert run.snapshot() == before


async def test_an_unmeasured_lane_host_carries_one_slot(make_run):
    run = make_run(laneHost="laptop", machines=[{"id": "laptop", "measured": False}])
    result = await run.call("dial_set", key="lane.slots", value=2)
    assert result.error.code == "DIAL_OUT_OF_RANGE" and "laptop" in result.error.message


async def test_a_wrong_input_name_is_refused_with_the_right_one(make_run):
    result = await make_run().call("cell_register", Branch="fix/a", issues=[101], route="r")
    assert result.error.code == "VALIDATION_ERROR" and "branch" in result.error.suggestion


def test_the_conftest_target_is_afd(make_run):
    assert (REPO_ROOT / "botcore.toml").is_file()


# cell_attach, lane_drop, plan_list


async def test_attaching_records_the_thread_and_starts_the_cell(make_run):
    run = make_run()
    await run.call("cell_register", branch="fix/a", issues=[101], route="r")
    cell = (await run.call("cell_attach", branch="fix/a", thread="thread-1")).data["cell"]
    assert (cell["thread"], cell["state"]) == ("thread-1", "working")
    missing = await run.call("cell_attach", branch="fix/none", thread="t")
    assert missing.error.code == "NOT_FOUND" and "lane-status" in missing.error.suggestion


async def test_dropping_releases_the_issue_dequeues_and_forgets_the_cell(make_run):
    run = make_run("ejected")
    data = (await run.call("lane_drop", branch="fix/parser-empty-input", reason="Abandoned")).data
    assert data == {"dropped": True, "released": [101], "answered": ["ev-7"]}
    issue = next(i for i in run.world_data()["issues"] if i["number"] == 101)
    assert "status:planned" in issue["labels"] and "status:in-progress" not in issue["labels"]
    assert "botcore-factory:release" in issue["comments"][-1]["body"]
    state = run.state()
    assert all(c["branch"] != "fix/parser-empty-input" for c in state["cells"])
    assert run.store.read_records()[-1]["kind"] == "dropped"
    assert (await run.call("issue_check")).data["dispatchable"][0] == 101


async def test_dropping_the_cell_that_filled_the_last_seat_opens_queue_room(make_run):
    run = make_run("backlog", dials={"cells.max": 1})
    await run.call("lane_drop", branch="fix/client-timeout", reason="Gone")
    [event] = [e for e in run.state()["events"] if e["type"] == "queue-room"]
    assert event["open"] and event["id"] == "ev-42"
    assert (await run.call("lane_status")).data["canStartCell"] is True


async def test_a_drop_whose_release_fails_keeps_the_cell(make_run):
    run = make_run("backlog")
    host = run.host(**failing(run, "add_comment"))
    result = await run.call("lane_drop", host, branch="fix/client-timeout", reason="x")
    assert result.error.code == "WRITE_FAILED"
    assert any(c["branch"] == "fix/client-timeout" for c in run.state()["cells"])
    unknown = await run.call("lane_drop", branch="no-such-branch", reason="Typo")
    assert unknown.error.code == "NOT_FOUND" and "lane-status" in unknown.error.suggestion


async def test_plan_list_shows_each_plan_s_room_and_ceiling(make_run):
    plans = (await make_run().call("plan_list")).data["plans"]
    assert [(p["id"], p["room"], p["aboveCeiling"]) for p in plans] == [
        ("plan-a", 70, False),
        ("plan-b", 20, False),
    ]
    above = (await make_run("at-ceiling").call("plan_list")).data["plans"]
    assert all(plan["aboveCeiling"] for plan in above)
    unreadable = await make_run(plansUnreadable=True).call("plan_list")
    assert unreadable.error.code == "PLANS_UNREADABLE"
