"""The commands through the factory host, over fixture worlds."""

from __future__ import annotations

import json

import pytest
from conftest import REPO_ROOT

from botcore_factory.claims import Claim, claim_body
from botcore_factory.fixture_world import FixtureGitHub, FixtureWorld
from botcore_factory.labels import IN_PROGRESS, PLANNED
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


class RivalClaimsFirst(FixtureGitHub):
    """The fixture's GitHub with the race the claim protocol leaves open: another branch's claim
    lands between this caller's read of the issue and its own label. ``fail_claim`` also fails
    the caller's claim comment, so its registration is undone."""

    def __init__(self, store, rival: Claim, fail_claim: bool = False):
        super().__init__(store)
        self.rival, self.fail_claim = rival, fail_claim

    def edit_labels(self, number, add=(), remove=()):
        if IN_PROGRESS in add:
            super().add_comment(number, claim_body(self.rival))
        super().edit_labels(number, add, remove)

    def add_comment(self, number, body):
        if self.fail_claim and "botcore-factory:claim" in body:
            raise WorldError("gh add_comment failed: HTTP 502")
        return super().add_comment(number, body)


RIVAL = Claim("t3/session", "laptop", "2030-01-04T00:00:00Z")


def labels_of(run, number: int) -> list[str]:
    return next(i for i in run.world_data()["issues"] if i["number"] == number)["labels"]


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


async def test_a_package_the_foreman_names_shares_one_cell(make_run):
    run = make_run("backlog", dials={"cells.issuesMax": 2})
    result = await run.call(
        "cell_register",
        branch="fix/timeouts",
        issues=[206, 201],
        route="sol/high",
        related_because="  Both change the timeout handling in server.ts  ",
    )
    assert result.success, result.error
    cell = result.data["cell"]
    assert cell["issues"] == [206, 201]
    assert cell["relatedBecause"] == "Both change the timeout handling in server.ts"
    for number in (206, 201):
        issue = next(i for i in run.world_data()["issues"] if i["number"] == number)
        assert "status:in-progress" in issue["labels"]
    [record] = run.store.read_records()
    assert record["issues"] == [206, 201]
    assert record["relatedBecause"] == "Both change the timeout handling in server.ts"


async def test_one_issue_records_no_package_reason(make_run):
    run = make_run("backlog")
    result = await run.call(
        "cell_register", branch="fix/one", issues=[206], route="r", related_because="unused"
    )
    assert result.success, result.error
    assert "relatedBecause" not in result.data["cell"]
    assert "relatedBecause" not in run.store.read_records()[0]


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
        "related_because",
    ),
    (
        "backlog",
        {"dials": {"cells.issuesMax": 2}},
        {"branch": "fix/blank", "issues": [201, 206], "related_because": "  "},
        "TOO_MANY_ISSUES",
        "related_because",
    ),
    (
        "backlog",
        {"dials": {"cells.issuesMax": 2}},
        {"branch": "fix/three", "issues": [201, 206, 101], "related_because": "shared files"},
        "TOO_MANY_ISSUES",
        "cells.issuesMax",
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
        {"host": {"freeMemoryGb": 40, "freeDiskGb": 12}},
        {"branch": "fix/disk", "issues": [101]},
        "DISK_LOW",
        "host.minFreeDiskGb",
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


async def test_refused_claim_histories_name_the_holder_and_write_nothing(make_run):
    """The histories scripts/issue-claim.test.mjs reads too: each row's ``expected`` says what
    both readers observe, or what each does where they are known to differ."""
    run = make_run("claim-histories")
    rows = {
        issue["number"]: (issue["title"], issue["expected"].get("factory", issue["expected"]))
        for issue in run.world_data()["issues"]
    }
    before = run.snapshot()
    for number, (title, want) in rows.items():
        if want["state"] == "free":
            continue  # The triage scenario registers the free issue after all refusals.
        result = await run.call("cell_register", branch="fix/observer", issues=[number], route="r")
        assert result.error.code == "ALREADY_CLAIMED", title
        holder = result.error.details["holder"] or {}
        seen = {key: holder.get(key) for key in ("branch", "leaseUntil", "machine")}
        wanted = {
            "branch": want["holder"],
            "leaseUntil": want.get("leaseUntil", seen["leaseUntil"]),
            "machine": want.get("machine", seen["machine"]),
        }
        assert seen == wanted, f"{title}: expected {wanted}, observed {seen}"
        expired = "expired" in result.error.message
        assert expired == (want["state"] == "stale" and want["holder"] is not None), title
        assert "issue-check" in result.error.suggestion, title
        assert run.snapshot() == before, title
    report = (await run.call("issue_check")).data
    stale = {entry["number"]: entry["branch"] for entry in report["staleClaims"]}
    assert stale == {n: want["holder"] for n, (_, want) in rows.items() if want["state"] == "stale"}
    assert report["dispatchable"] == [n for n, (_, want) in rows.items() if want["state"] == "free"]


async def test_a_failed_claim_write_records_no_cell(make_run):
    run = make_run("backlog")
    host = run.host(**failing(run, "add_comment"))
    result = await run.call("cell_register", host, branch="fix/w", issues=[201], route="r")
    assert result.error.code == "WRITE_FAILED"
    assert "put back" in result.error.message
    issue = next(i for i in run.world_data()["issues"] if i["number"] == 201)
    assert "status:planned" in issue["labels"] and "status:in-progress" not in issue["labels"]
    assert all(cell["branch"] != "fix/w" for cell in run.state()["cells"])


async def test_a_failed_registration_leaves_the_label_to_a_claim_that_landed_beside_it(make_run):
    run = make_run("backlog")
    host = run.host(github=RivalClaimsFirst(FixtureWorld(run.world_path), RIVAL, fail_claim=True))
    result = await run.call("cell_register", host, branch="fix/w", issues=[201], route="r")
    assert result.error.code == "WRITE_FAILED" and result.error.details["left"] == []
    assert all(cell["branch"] != "fix/w" for cell in run.state()["cells"])
    # The label is the rival's now: taking it away would hide its live claim from every reader.
    assert IN_PROGRESS in labels_of(run, 201) and PLANNED not in labels_of(run, 201)
    refused = await run.call("cell_register", branch="fix/other", issues=[201], route="r")
    assert refused.error.code == "ALREADY_CLAIMED"
    assert refused.error.details["holder"]["branch"] == RIVAL.branch


class CommentFailsOn(FixtureGitHub):
    """The fixture's GitHub, failing only the claim comment on one issue."""

    def __init__(self, store, number):
        super().__init__(store)
        self.number = number

    def add_comment(self, number, body):
        if number == self.number and "botcore-factory:claim" in body:
            raise WorldError("gh add_comment failed: HTTP 502")
        return super().add_comment(number, body)


async def test_a_package_that_fails_on_its_second_issue_puts_the_first_back(make_run):
    run = make_run("backlog", dials={"cells.issuesMax": 2})
    host = run.host(github=CommentFailsOn(FixtureWorld(run.world_path), 201))
    result = await run.call(
        "cell_register",
        host,
        branch="fix/pair",
        issues=[206, 201],
        route="r",
        related_because="shared files",
    )
    assert result.error.code == "WRITE_FAILED"
    assert "put back" in result.error.message and result.error.details["left"] == []
    for number in (206, 201):
        issue = next(i for i in run.world_data()["issues"] if i["number"] == number)
        assert "status:planned" in issue["labels"] and "status:in-progress" not in issue["labels"]
    assert all(cell["branch"] != "fix/pair" for cell in run.state()["cells"])
    # Nothing is left claimed, so the package registers once GitHub answers again.
    retry = await run.call(
        "cell_register", branch="fix/pair", issues=[206, 201], route="r", related_because="x"
    )
    assert retry.success, retry.error


async def test_a_refused_package_claims_none_of_its_issues(make_run):
    run = make_run("backlog", dials={"cells.issuesMax": 2})
    before = run.snapshot()
    result = await run.call(
        "cell_register", branch="fix/mixed", issues=[206, 205], route="r", related_because="x"
    )
    assert result.error.code == "ALREADY_CLAIMED"
    assert run.snapshot() == before


async def test_lane_status_shows_why_a_package_shares_its_cell(make_run):
    run = make_run("backlog", dials={"cells.issuesMax": 2})
    await run.call(
        "cell_register", branch="fix/pair", issues=[206, 201], route="r", related_because="x"
    )
    cells = (await run.call("lane_status")).data["cells"]
    assert next(c for c in cells if c["branch"] == "fix/pair")["relatedBecause"] == "x"


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
    short = (await make_run(host={"freeDiskGb": 12}).call("lane_status")).data
    assert short["canStartCell"] is False and "host.minFreeDiskGb is 20" in short["reason"]
    blind = (await make_run(thisMachine="nowhere").call("lane_status")).data
    assert blind["canStartCell"] is False and "Cannot read free disk" in blind["reason"]
    empty = (await make_run(issues=[]).call("lane_status")).data
    assert "triage-issues" in empty["reason"]


async def test_status_passes_disk_warnings_on_and_still_starts_cells(make_run):
    plain = (await make_run().call("lane_status")).data
    assert plain["diskWarnings"] == []
    warning = "/repo: 30 worktrees idle 3 days or more, over the limit of 20"
    warned = (await make_run(host={"diskWarnings": [warning]}).call("lane_status")).data
    assert warned["diskWarnings"] == [warning]
    assert warned["canStartCell"] == plain["canStartCell"]


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
            "excused": 0,
            "countedEjections": 0,
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
        ("cells.max", "3", "DIAL_OUT_OF_RANGE"),
        ("host.buildDir", "relative/build", "DIAL_OUT_OF_RANGE"),
        ("host.buildDir", 5, "DIAL_OUT_OF_RANGE"),
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


async def test_host_build_dir_takes_an_absolute_directory_or_empty_for_the_default(make_run):
    run = make_run()
    first = await run.call("dial_set", key="host.buildDir", value=" /Volumes/Dev ")
    assert (first.data["value"], first.data["previous"]) == ("/Volumes/Dev", "")
    assert (await run.call("dial_set", key="host.buildDir", value="")).data["value"] == ""


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
    assert run.state()["cells"][-1]["threads"] == []
    cell = (await run.call("cell_attach", branch="fix/a", thread="thread-1")).data["cell"]
    assert (cell["thread"], cell["state"]) == ("thread-1", "working")
    # A repair by another thread is attached too, and every thread is kept for the fold's
    # Factory-session trailers (lushly-dev/afd#1887).
    await run.call("cell_attach", branch="fix/a", thread="thread-2")
    cell = (await run.call("cell_attach", branch="fix/a", thread="thread-1")).data["cell"]
    assert (cell["thread"], cell["threads"]) == ("thread-1", ["thread-1", "thread-2"])
    # A cell registered before the list was kept may have had other threads: it gets none.
    with run.store.update("legacy") as state:
        state["cells"][-1].pop("threads")
    cell = (await run.call("cell_attach", branch="fix/a", thread="thread-3")).data["cell"]
    assert cell["thread"] == "thread-3" and "threads" not in cell
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


async def test_dropping_a_cell_leaves_the_issue_with_an_earlier_live_claimant(make_run):
    """A session's claim landed just before the cell's: dropping the cell ends only the cell's
    claim. The label stays with the session, so the issue is not dispatched a second time."""
    run = make_run("backlog")
    host = run.host(github=RivalClaimsFirst(FixtureWorld(run.world_path), RIVAL))
    assert (await run.call("cell_register", host, branch="fix/w", issues=[201], route="r")).success
    data = (await run.call("lane_drop", branch="fix/w", reason="Parked")).data
    assert data["dropped"] is True and data["released"] == [201]
    assert IN_PROGRESS in labels_of(run, 201) and PLANNED not in labels_of(run, 201)
    assert 201 not in (await run.call("issue_check")).data["dispatchable"]
    refused = await run.call("cell_register", branch="fix/other", issues=[201], route="r")
    assert refused.error.code == "ALREADY_CLAIMED"
    assert refused.error.details["holder"] == RIVAL.describe()
    # Once the session's lease runs out the foreman sees it as stale, as any lapsed claim.
    run.change_world(now="2030-01-05T00:00:00Z")
    stale = (await run.call("issue_check")).data["staleClaims"]
    assert {"number": 201, **RIVAL.describe()} in stale


async def test_dropping_a_cell_keeps_the_label_for_a_claim_its_open_pull_request_holds(make_run):
    """A session's lease ran out, but its branch has an open pull request, which the issue-claim
    CLI reads as holding: the label stays so that reader still sees the claim."""
    run = make_run("backlog")
    lapsed = Claim(RIVAL.branch, RIVAL.machine, "2030-01-02T00:00:00Z")
    host = run.host(github=RivalClaimsFirst(FixtureWorld(run.world_path), lapsed))
    assert (await run.call("cell_register", host, branch="fix/w", issues=[201], route="r")).success
    run.change_world(pullRequests=[{"number": 950, "branch": RIVAL.branch, "closes": []}])
    assert (await run.call("lane_drop", branch="fix/w", reason="Parked")).success
    assert IN_PROGRESS in labels_of(run, 201) and PLANNED not in labels_of(run, 201)


async def test_a_drop_whose_release_comment_fails_leaves_the_issue_held(make_run):
    """The release comment goes before the label: a failed comment leaves the claim and its
    label as they were, so the issue is never dispatched under a claim that still stands."""
    run = make_run("backlog")
    assert (await run.call("cell_register", branch="fix/w", issues=[201], route="r")).success
    host = run.host(**failing(run, "add_comment"))
    result = await run.call("lane_drop", host, branch="fix/w", reason="Parked")
    assert result.error.code == "WRITE_FAILED"
    assert IN_PROGRESS in labels_of(run, 201)
    assert 201 not in (await run.call("issue_check")).data["dispatchable"]


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


#: A ChatGPT plan with far more room than the Claude plan, as an owner who spends GPT on review
#: would see it.
GPT_ROOMIER = [
    {
        "id": "codex:primary",
        "provider": "codex",
        "used": 5,
        "elapsed": 90,
        "resetsAt": "2030-01-02T00:00:00Z",
    },
    {
        "id": "claudeAgent:seven_day",
        "provider": "claudeAgent",
        "used": 40,
        "elapsed": 60,
        "resetsAt": "2030-01-10T00:00:00Z",
    },
]


async def test_cells_start_only_on_a_claude_plan(make_run):
    """Cells implement on Opus (model routing, 2026-11-17), so a roomier ChatGPT plan is passed
    over: lane-status, cell-register and plan-list's next all name the Claude plan."""
    run = make_run("backlog", plans=GPT_ROOMIER)
    status = (await run.call("lane_status")).data
    assert status["canStartCell"] is True and status["plan"]["id"] == "claudeAgent:seven_day"
    listed = (await run.call("plan_list")).data
    assert [p["id"] for p in listed["plans"]] == ["codex:primary", "claudeAgent:seven_day"]
    assert listed["next"] == "claudeAgent:seven_day"
    result = await run.call(
        "cell_register", branch="fix/server-timeout", issues=[206], route="opus/medium"
    )
    assert result.success, result.error
    assert result.data["cell"]["plan"] == "claudeAgent:seven_day"


async def test_a_stale_plan_is_shown_and_never_assigned(make_run):
    """lushly-dev/afd#2691: a roomier Claude plan whose cache is out of date is passed over for
    the fresh one, and lane-status says it is stale rather than dropping it silently."""
    stale = {**GPT_ROOMIER[1], "id": "claudeAgent_2:seven_day", "used": 0,
             "stale": "the window reset at 2030-01-01T00:00:00Z"}  # fmt: skip
    run = make_run("backlog", plans=[*GPT_ROOMIER, stale])
    status = (await run.call("lane_status")).data
    assert status["plan"]["id"] == "claudeAgent:seven_day"
    assert status["stalePlans"] == [
        {"id": "claudeAgent_2:seven_day", "reason": "the window reset at 2030-01-01T00:00:00Z"}
    ]
    listed = (await run.call("plan_list")).data
    assert listed["next"] == "claudeAgent:seven_day"
    assert {p["id"]: p.get("stale") for p in listed["plans"]}["claudeAgent_2:seven_day"]


async def test_when_every_claude_plan_is_stale_the_refusal_says_so(make_run):
    stale = {**GPT_ROOMIER[1], "stale": "its cache was last checked at 2029-12-20T00:00:00Z"}
    run = make_run("backlog", plans=[GPT_ROOMIER[0], stale])
    status = (await run.call("lane_status")).data
    assert status["canStartCell"] is False and "out of date" in status["reason"]
    refused = await run.call(
        "cell_register", branch="fix/server-timeout", issues=[206], route="opus/medium"
    )
    assert refused.error.code == "PLANS_STALE"
    assert "claudeAgent:seven_day" in refused.error.message


async def test_a_ceiling_refusal_counts_the_stale_plans_beside_it(make_run):
    stale = {**GPT_ROOMIER[1], "id": "claudeAgent_2:seven_day", "stale": "its window reset"}
    full = {**GPT_ROOMIER[1], "used": 90}
    run = make_run("backlog", plans=[GPT_ROOMIER[0], full, stale])
    refused = await run.call(
        "cell_register", branch="fix/server-timeout", issues=[206], route="opus/medium"
    )
    assert refused.error.code == "PLAN_ABOVE_CEILING"
    assert "or stale (1: see stalePlans)" in refused.error.message


async def test_the_dial_lets_cells_take_any_plan(make_run):
    run = make_run("backlog", plans=GPT_ROOMIER, dials={"cells.claudeOnly": False})
    assert (await run.call("plan_list")).data["next"] == "codex:primary"
    assert (await run.call("lane_status")).data["plan"]["id"] == "codex:primary"
    result = await run.call("cell_register", branch="fix/server-timeout", issues=[206], route="x/y")
    assert result.success, result.error
    assert result.data["cell"]["plan"] == "codex:primary"


async def test_no_claude_plan_says_so_rather_than_blaming_the_ceiling(make_run):
    run = make_run("backlog", plans=GPT_ROOMIER[:1])
    status = (await run.call("lane_status")).data
    assert status["canStartCell"] is False and "No Claude plan" in status["reason"]
    refused = await run.call(
        "cell_register", branch="fix/server-timeout", issues=[206], route="opus/medium"
    )
    assert refused.error.code == "NO_CLAUDE_PLAN"
    assert "cells.claudeOnly" in refused.error.suggestion
    assert (await run.call("plan_list")).data["next"] is None


async def test_a_full_claude_plan_is_named_in_the_ceiling_refusal(make_run):
    full = [{**GPT_ROOMIER[0]}, {**GPT_ROOMIER[1], "used": 90}]
    run = make_run("backlog", plans=full)
    status = (await run.call("lane_status")).data
    assert status["canStartCell"] is False and "Every Claude plan" in status["reason"]
    refused = await run.call(
        "cell_register", branch="fix/server-timeout", issues=[206], route="opus/medium"
    )
    assert refused.error.code == "PLAN_ABOVE_CEILING"
    assert "Every Claude plan" in refused.error.message


async def test_with_the_dial_off_a_full_week_names_every_plan(make_run):
    full = [{**GPT_ROOMIER[0], "used": 95}, {**GPT_ROOMIER[1], "used": 90}]
    run = make_run("backlog", plans=full, dials={"cells.claudeOnly": False})
    refused = await run.call(
        "cell_register", branch="fix/server-timeout", issues=[206], route="x/y"
    )
    assert refused.error.code == "PLAN_ABOVE_CEILING"
    assert refused.error.message.startswith("Every plan is at or above")


@pytest.mark.parametrize("claude_only", [True, False])
async def test_no_plan_windows_are_unreadable_whatever_the_dial(make_run, claude_only):
    run = make_run("backlog", plans=[], dials={"cells.claudeOnly": claude_only})
    refused = await run.call(
        "cell_register", branch="fix/server-timeout", issues=[206], route="opus/medium"
    )
    assert refused.error.code == "PLANS_UNREADABLE"
    assert (await run.call("plan_list")).error.code == "PLANS_UNREADABLE"
    status = (await run.call("lane_status")).data
    assert status["canStartCell"] is False and "plans" in status["reason"]
