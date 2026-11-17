"""The lane's loop, step by step, over fixture worlds whose outside answers each test scripts
(``outcomes``) and whose clock it moves. Nothing here waits or starts a process."""

from __future__ import annotations

import json

import pytest

from botcore_factory.lane import first_lines, log_path, step


def run_steps(run, count: int = 1, **config) -> list[str]:
    """Step the lane ``count`` times, each over a fresh factory (the world as it is now) whose
    adapter has ``config`` laid over it."""
    actions = []
    for _ in range(count):
        factory = run.factory()
        if config:
            factory.config = factory.config.model_copy(update=config)
        actions += step(factory)
    return actions


INSTALL = {"install": ["pnpm", "install"]}


def kinds(run) -> list[str]:
    return [record["kind"] for record in run.store.read_records()]


def events(run, kind: str | None = None) -> list[dict]:
    return [e for e in run.state()["events"] if kind is None or e["type"] == kind]


def queue(run) -> list[tuple[str, str]]:
    return [(entry["branch"], entry["state"]) for entry in run.state()["queue"]]


def prs(run) -> dict:
    return run.world_data().get("prs", {})


def entry_of(run, branch: str) -> dict:
    return next(e for e in run.state()["queue"] if e["branch"] == branch)


@pytest.fixture
def lane(make_run):
    """The running fixture: two branches queued, one slot, this machine the lane host."""
    return make_run("running")


def test_a_queued_branch_is_validated_pushed_merged_and_landed(lane):
    assert run_steps(lane) == ["validating feat/export-csv in slot 1"]
    entry = lane.state()["queue"][0]
    assert (entry["state"], entry["base"], entry["validatedHead"]) == (
        "validating",
        "main-0",
        "b2c3d4e+main-0",
    )
    assert entry["logPath"] == "attempts/feat-export-csv-1.log"
    actions = run_steps(lane)
    assert actions[:2] == [
        "validated feat/export-csv",
        "opened PR 600 for feat/export-csv at b2c3d4e+main-0",
    ]
    assert "validating fix/retry-backoff in slot 1" in actions
    pr = prs(lane)["600"]
    assert pr["head"] == "b2c3d4e+main-0" and "Closes #104" in pr["body"]
    assert (
        "## Verification" in pr["body"] and "`pnpm verify` passed on b2c3d4e+main-0" in pr["body"]
    )
    assert "merged feat/export-csv (PR 600)" in run_steps(lane)
    assert prs(lane)["600"]["mergedHead"] == "b2c3d4e+main-0"
    state = lane.state()
    assert all(c["branch"] != "feat/export-csv" for c in state["cells"])
    assert [e["detail"] for e in events(lane, "merged")] == ["PR 600"]
    assert state["runs"][0]["prs"][-1] == {
        "number": 600,
        "branch": "feat/export-csv",
        "route": "opus/medium",
        "plan": "plan-b",  # So lane-report's byPlan counts it.
    }
    from botcore_factory.report import lane_report

    report = lane_report(lane.factory(), None, None)
    assert {"plan": "plan-b", "merged": 1} in report["byPlan"]
    assert kinds(lane) == [
        "validation-started",
        "validated",
        "validation-started",
        "validated",
        "merged",
    ]


# B1: the head pushed and merged is the one validated, whatever its slot holds now.


def test_a_validated_head_keeps_its_checkout_until_pushed(lane):
    with lane.store.update("third") as state:
        state["queue"].append({"branch": "fix/parser-empty-input", "head": "a1b2c3d"})
    lane.change_world(
        outcomes={
            "checks": {"feat/export-csv": "pending"},
            "validate": {"fix/parser-empty-input": "running"},
        }
    )
    run_steps(lane, 3)  # export-csv merging; retry-backoff validated and waiting to push.
    assert lane.world_data()["checkouts"]["1"]["branch"] == "fix/retry-backoff"
    assert entry_of(lane, "fix/parser-empty-input")["state"] == "queued"
    from botcore_factory.status import lane_status

    assert lane_status(lane.factory(), None, None)["slots"]["busy"] == 1
    lane.change_world(outcomes={"checks": {"feat/export-csv": "failure"}})
    run_steps(lane, 3)
    pushed = lane.world_data()["pushed"]
    assert pushed["fix/retry-backoff"] == "c3d4e5f+main-0"  # Not the slot's parser head.
    assert {pr["branch"]: pr["head"] for pr in prs(lane).values()} == {
        "feat/export-csv": "b2c3d4e+main-0",
        "fix/retry-backoff": "c3d4e5f+main-0",
    }
    assert lane.world_data()["checkouts"]["1"]["branch"] == "fix/parser-empty-input"


def test_a_nondefault_base_opens_its_own_pr_instead_of_reusing_a_main_pr(lane):
    lane.change_world(prs={"42": {"branch": "feat/export-csv", "base": "main", "state": "OPEN"}})
    run_steps(lane, 2, base_branch="develop")
    assert prs(lane)["600"]["base"] == "develop"
    assert prs(lane)["42"]["state"] == "OPEN"


@pytest.mark.parametrize("fail", [False, True], ids=["merged", "ejected"])
def test_terminal_entries_retire_their_origin_queue_ref(lane, fail):
    lane.change_world(
        originQueueRefs=[{"branch": "feat/export-csv", "head": "b2c3d4e"}],
        outcomes={"validate": {"feat/export-csv": "fail: FAIL x" if fail else "pass"}},
    )
    run_steps(lane, 3)
    assert lane.world_data()["originQueueRefs"] == []


def test_failed_queue_ref_cleanup_pauses_without_losing_the_completed_job(lane):
    lane.change_world(
        outcomes={
            "validate": {"feat/export-csv": "fail: FAIL x"},
            "deleteQueue": {"feat/export-csv": "fail: network unavailable"},
        }
    )
    run_steps(lane, 2)
    assert entry_of(lane, "feat/export-csv")["run"]
    assert lane.state()["lane"]["paused"]
    assert not events(lane, "ejected")
    lane.change_world(outcomes={"deleteQueue": {"feat/export-csv": "pass"}})
    with lane.store.update("resume") as state:
        state["lane"]["paused"] = False
    run_steps(lane, 3)
    assert events(lane, "ejected")[0]["reason"] == "final-failed"


@pytest.mark.parametrize(
    "output,trouble",
    [
        (
            "ERR_PNPM_OUTDATED_LOCKFILE Cannot install with frozen-lockfile\n"
            'botcore-factory-job: {"failed": "install", "code": 1, "timedOut": false}',
            False,
        ),
        ('botcore-factory-job: {"failed": "install", "code": 124, "timedOut": true}', True),
        (
            "ERR_PNPM_META_FETCH_FAIL GET https://registry.npmjs.org/foo: ETIMEDOUT\n"
            'botcore-factory-job: {"failed": "install", "code": 1, "timedOut": false}',
            True,
        ),
    ],
)
def test_real_job_markers_do_not_turn_branch_failures_into_timeouts(lane, output, trouble):
    lane.change_world(outcomes={"install": {"feat/export-csv": "fail: " + output}})
    run_steps(lane, 2, **INSTALL)
    assert bool(events(lane, "lane-error")) is trouble
    assert bool(events(lane, "ejected")) is not trouble
    if trouble:
        assert queue(lane)[0] == ("feat/export-csv", "queued")
    else:
        assert events(lane, "ejected")[0]["reason"] == "entry-invalid"


def test_a_github_policy_refusal_is_ejected_when_the_base_did_not_move(lane):
    output = (
        "X Pull request o/r#600 is not mergeable: the base branch policy prohibits the merge.\n"
        "To schedule the pull request to merge after all the requirements have been satisfied, "
        "add the `--auto` flag."
    )
    lane.change_world(outcomes={"mergePr": {"feat/export-csv": "fail: " + output}})
    run_steps(lane, 3)
    assert events(lane, "ejected")[0]["reason"] == "merge-failed"
    assert "policy prohibits" in events(lane, "ejected")[0]["detail"]
    assert "rerun" not in kinds(lane)


def test_a_merge_refusal_revalidates_only_when_a_fresh_fetch_proves_the_base_moved(lane):
    from dataclasses import replace

    run_steps(lane, 2)
    factory = lane.factory()
    github = factory.world.github

    class RacingGitHub:
        def __getattr__(self, name):
            return getattr(github, name)

        def merge_pr(self, pr, head):
            lane.change_world(main={"head": "main-raced"})
            from botcore_factory.world import WorldError

            raise WorldError("Pull request is not mergeable: the base branch policy prohibits it")

    factory.world = replace(factory.world, github=RacingGitHub())
    # Use a newly opened world when fetching, to see the racing remote update.
    git = factory.world.git

    class FreshGit:
        def __getattr__(self, name):
            return getattr(git, name)

        def fetch_base(self, base):
            return lane.factory().world.git.fetch_base(base)

    factory.world = replace(factory.world, git=FreshGit())
    assert "rerun feat/export-csv (main-moved)" in step(factory)
    assert not events(lane, "ejected")


def test_a_check_reported_for_another_head_is_not_this_one_s(lane):
    lane.change_world(outcomes={"checksByHead": {"stale-head": "success"}, "checks": {}})
    run_steps(lane, 2)
    lane.change_world(prs={"600": {"head": "b2c3d4e+main-0"}})
    from botcore_factory.fixture_world import FixtureWorld

    github = FixtureWorld(lane.world_path).world().github
    assert github.check_status(600, "ci-ok", "another-head") == "missing"


# B2: never merge after the base moved, and never behind the queue's order.


def test_the_base_moving_while_the_check_runs_validates_again_before_any_merge(lane):
    lane.change_world(outcomes={"checks": {"feat/export-csv": "pending"}})
    run_steps(lane, 2)
    assert entry_of(lane, "feat/export-csv")["state"] == "merging"
    lane.change_world(
        main={"head": "main-human"}, outcomes={"checks": {"feat/export-csv": "success"}}
    )
    actions = run_steps(lane)
    assert "rerun feat/export-csv (main-moved)" in actions
    assert "rerun fix/retry-backoff (slot-needed)" in actions
    assert "merged" not in kinds(lane)
    assert prs(lane)["600"]["state"] == "OPEN"
    entry = lane.state()["queue"][0]
    assert (entry["branch"], entry["pr"], entry["base"]) == ("feat/export-csv", 600, "main-human")
    run_steps(lane, 3)
    assert prs(lane)["600"]["mergedHead"] == "b2c3d4e+main-human"  # Bound to the new head.


def test_a_restart_never_puts_a_branch_ahead_of_one_merging(lane):
    from botcore_factory.lane_process import resume

    lane.change_world(
        outcomes={
            "checks": {"feat/export-csv": "pending"},
            "validate": {"fix/retry-backoff": "running"},
        }
    )
    run_steps(lane, 2)
    lane.change_world(processes={"running": {}})
    resume(lane.factory())
    assert queue(lane) == [("feat/export-csv", "merging"), ("fix/retry-backoff", "queued")]
    lane.change_world(outcomes={"validate": {"fix/retry-backoff": "pass"}})
    run_steps(lane, 2)
    lane.change_world(outcomes={"checks": {"feat/export-csv": "success"}})
    run_steps(lane, 6)
    merged = [r["branch"] for r in lane.store.read_records() if r["kind"] == "merged"]
    assert merged == ["feat/export-csv", "fix/retry-backoff"]


def test_merges_stay_in_queue_order(lane):
    lane.change_world(outcomes={"validate": {"feat/export-csv": "running"}})
    with lane.store.update("two slots") as state:
        state["dials"]["lane.slots"] = 2
    run_steps(lane, 2)
    assert queue(lane) == [("feat/export-csv", "validating"), ("fix/retry-backoff", "validated")]
    assert prs(lane) == {}  # The second waits for the first.


def test_two_slots_validate_two_branches_at_once(lane):
    with lane.store.update("two slots") as state:
        state["dials"]["lane.slots"] = 2
    run_steps(lane)
    assert [(e["branch"], e["slot"]) for e in lane.state()["queue"]] == [
        ("feat/export-csv", "1"),
        ("fix/retry-backoff", "2"),
    ]


EJECTIONS = [
    (
        {"merge": {"feat/export-csv": "conflict: src/a.ts, src/b.ts"}},
        "conflict",
        "Conflicts with main-0: src/a.ts, src/b.ts",
    ),
    (
        {"prepare": {"feat/export-csv": "fail: fatal: unknown revision b2c3d4e"}},
        "entry-invalid",
        "b2c3d4e cannot be checked out: fatal: unknown revision b2c3d4e",
    ),
    (
        {"validate": {"feat/export-csv": "fail: noise\nFAIL src/x.test.ts > parses empty input"}},
        "final-failed",
        "FAIL src/x.test.ts > parses empty input",
    ),
    (
        {"install": {"feat/export-csv": "fail: ERR_PNPM_OUTDATED_LOCKFILE"}},
        "entry-invalid",
        "ERR_PNPM_OUTDATED_LOCKFILE",
    ),
    (
        {"push": {"feat/export-csv": "fail: ! [rejected] (non-fast-forward)"}},
        "push-failed",
        "! [rejected] (non-fast-forward)",
    ),
    (
        {"pr": {"feat/export-csv": "fail: Validation Failed: No commits between main and it"}},
        "pr-failed",
        "Validation Failed: No commits between main and it",
    ),
    ({"checks": {"feat/export-csv": "failure"}}, "ci-failed", "ci-ok failed on PR 600 at"),
    (
        {"mergePr": {"feat/export-csv": "fail: Head branch was modified. Review and try again."}},
        "merge-failed",
        "Head branch was modified",
    ),
]


@pytest.mark.parametrize(
    "outcomes,cause,detail", EJECTIONS, ids=[e[1] + str(i) for i, e in enumerate(EJECTIONS)]
)
def test_a_branch_s_own_failure_ejects_it_with_its_cause(lane, outcomes, cause, detail):
    lane.change_world(outcomes=outcomes)
    run_steps(lane, 3, **(INSTALL if "install" in outcomes else {}))
    [ejected] = events(lane, "ejected")
    assert (ejected["branch"], ejected["reason"]) == ("feat/export-csv", cause)
    assert detail in ejected["detail"]
    cell = next(c for c in lane.state()["cells"] if c["branch"] == "feat/export-csv")
    assert (cell["state"], cell["ejections"]) == ("ejected", 1)
    record = next(r for r in lane.store.read_records() if r["kind"] == "ejected")
    assert record["cause"] == cause and record["attempt"] == 1
    assert all(entry["branch"] != "feat/export-csv" for entry in lane.state()["queue"])
    assert events(lane, "lane-error") == []


def test_a_closed_pr_is_an_ejection(lane):
    lane.change_world(outcomes={"checks": {"feat/export-csv": "pending"}})
    run_steps(lane, 2)
    lane.change_world(prs={"600": {"state": "CLOSED"}})
    run_steps(lane)
    [ejected] = events(lane, "ejected")
    assert ejected["reason"] == "pr-closed"


# S2: the lane's own trouble pauses it and ejects nothing.

TROUBLE = [
    {"push": {"feat/export-csv": "fail: Could not resolve host: github.com"}},
    {"pr": {"feat/export-csv": "fail: HTTP 502: Bad Gateway"}},
    {"mergePr": {"feat/export-csv": "fail: HTTP 503: Service Unavailable"}},
    {"prepare": {"feat/export-csv": "fail: unable to access origin: Connection reset"}},
    {"checks": {"feat/export-csv": "cancelled"}},
    {"merge": {"feat/export-csv": "fail: merge: main - not something we can merge"}},
]


@pytest.mark.parametrize("outcomes", TROUBLE, ids=[next(iter(o)) for o in TROUBLE])
def test_transient_failures_pause_the_lane_and_eject_nothing(lane, outcomes):
    lane.change_world(outcomes=outcomes)
    run_steps(lane, 3)
    assert events(lane, "ejected") == []
    assert len(events(lane, "lane-error")) == 1 and lane.state()["lane"]["paused"] is True
    assert entry_of(lane, "feat/export-csv")


def test_an_install_failing_on_the_network_is_the_lane_s_trouble(lane):
    lane.change_world(
        outcomes={"install": {"feat/export-csv": "fail: ETIMEDOUT registry.npmjs.org"}}
    )
    run_steps(lane, 2, **INSTALL)
    assert events(lane, "ejected") == [] and len(events(lane, "lane-error")) == 1
    assert queue(lane)[0] == ("feat/export-csv", "queued")


def test_a_merge_that_landed_but_reported_failure_is_landed(lane):
    lane.change_world(outcomes={"mergePr": {"feat/export-csv": "lands-then-fail: timed out"}})
    actions = run_steps(lane, 3)
    assert "merged feat/export-csv (PR 600)" in actions
    assert events(lane, "ejected") == [] and events(lane, "lane-error") == []


# S1: the lane owns the branch it pushes: a repair pushes over its merge commit with a lease.


def test_a_repair_pushes_over_the_lane_s_own_merge_commit_with_a_lease(lane):
    lane.change_world(outcomes={"checks": {"feat/export-csv": "failure"}})
    run_steps(lane, 3)
    assert events(lane, "ejected")[0]["reason"] == "ci-failed"
    assert lane.world_data()["pushed"]["feat/export-csv"] == "b2c3d4e+main-0"
    with lane.store.update("repaired") as state:  # The cell's repair, enqueued again.
        state["queue"].insert(0, {"branch": "feat/export-csv", "head": "b2c3d4f", "attempt": 2})
        next(c for c in state["cells"] if c["branch"] == "feat/export-csv")["state"] = "queued"
    lane.change_world(outcomes={"checks": {"feat/export-csv": "success"}})
    run_steps(lane, 3)
    assert lane.world_data()["pushed"]["feat/export-csv"] == "b2c3d4f+main-0"
    assert len(events(lane, "ejected")) == 1  # Only the ci failure.


def test_a_branch_someone_else_pushed_to_is_not_overwritten(lane):
    lane.change_world(outcomes={"checks": {"feat/export-csv": "failure"}})
    run_steps(lane, 3)
    lane.change_world(pushed={"feat/export-csv": "someone-else"})
    with lane.store.update("repaired") as state:
        state["queue"].insert(0, {"branch": "feat/export-csv", "head": "b2c3d4f", "attempt": 2})
    run_steps(lane, 2)
    assert events(lane, "ejected")[-1]["reason"] == "push-failed"
    assert lane.world_data()["pushed"]["feat/export-csv"] == "someone-else"


# S3: a merge during a coverage run still owes coverage; the front waits for a gate's.


def test_coverage_debt_from_a_merge_during_a_coverage_run_is_kept(lane):
    with lane.store.update("every merge") as state:
        state["dials"]["lane.coverageEvery"] = 1
        state["queue"].append({"branch": "fix/parser-empty-input", "head": "a1b2c3d"})
    lane.change_world(
        outcomes={"coverage": "running", "changed": {"fix/retry-backoff": ["lefthook.yml"]}}
    )
    run_steps(lane, 6)  # 600 merges, coverage starts after it; 601 (a gate) merges meanwhile.
    lane_state = lane.state()["lane"]
    assert lane_state["coverage"]["after"] == [600] and lane_state["gateOwed"] == [601]
    assert "fix/parser-empty-input" not in {pr["branch"] for pr in prs(lane).values()}
    lane.change_world(outcomes={"coverage": "pass"})
    run_steps(lane)
    lane_state = lane.state()["lane"]
    assert lane_state["mergedSinceCoverage"] == [601] and lane_state["gateOwed"] == [601]
    assert lane_state["coverage"]["after"] == [601]  # A new run for the gate merge.
    assert "fix/parser-empty-input" not in {pr["branch"] for pr in prs(lane).values()}
    run_steps(lane, 3)
    assert lane.state()["lane"]["gateOwed"] == []
    assert "fix/parser-empty-input" in {pr["branch"] for pr in prs(lane).values()}


def test_coverage_runs_every_n_merges(lane):
    with lane.store.update("every merge") as state:
        state["dials"]["lane.coverageEvery"] = 1
    lane.change_world(outcomes={"validate": {"fix/retry-backoff": "running"}})
    actions = run_steps(lane, 3)
    assert actions[-1] == "coverage on main@600"
    assert "coverage passed" in run_steps(lane)
    record = next(r for r in lane.store.read_records() if r["kind"] == "coverage")
    assert (record["main"], record["outcome"], record["after"]) == ("main@600", "passed", [600])
    assert lane.state()["lane"]["mergedSinceCoverage"] == []


def test_a_gate_merge_whose_coverage_fails_is_main_broken(lane):
    lane.change_world(
        outcomes={
            "changed": {"feat/export-csv": ["lefthook.yml"]},
            "coverage": "fail: FAIL packages/core coverage below threshold",
            "validate": {"fix/retry-backoff": "running"},
        }
    )
    run_steps(lane, 5)
    [broken] = events(lane, "main-broken")
    assert broken["suspects"] == [600] and "coverage below threshold" in broken["detail"]
    lane_state = lane.state()["lane"]
    assert lane_state["paused"] is True and "main is broken" in lane_state["pauseReason"]


# S4 and S5: install runs after the merge, in the background job, with a timeout.


def test_install_runs_after_the_merge_in_the_background_job(lane):
    run_steps(lane, **INSTALL)
    [job] = lane.world_data()["processes"]["running"].values()
    assert [s["label"] for s in job["steps"]] == ["install", "validate"]
    assert job["steps"][0]["timeout"] == 1800
    assert job["head"] == "b2c3d4e+main-0"  # Merged before anything ran.


# #1341: a slot validates on the Node its own .nvmrc names, never the host's default node.


def test_validation_runs_on_the_node_the_slot_s_nvmrc_names(lane):
    lane.change_world(slotFiles={".nvmrc": "26\n"}, nodes={"26": "/fnm/v26.13.0/bin"})
    run_steps(lane, **INSTALL)
    [job] = lane.world_data()["processes"]["running"].values()
    assert [s["path"] for s in job["steps"]] == [["/fnm/v26.13.0/bin"]] * 2


def test_without_an_nvmrc_the_job_keeps_the_host_s_path(lane):
    run_steps(lane)
    [job] = lane.world_data()["processes"]["running"].values()
    assert all("path" not in s for s in job["steps"])


def test_a_node_the_host_lacks_pauses_the_lane_and_validates_nothing(lane):
    lane.change_world(slotFiles={".nvmrc": "26"})
    run_steps(lane)
    assert "validation-started" not in kinds(lane)
    assert not lane.world_data().get("processes", {}).get("running")
    assert queue(lane)[0] == ("feat/export-csv", "queued")
    detail = lane.state()["lane"]["pauseReason"]
    assert "Node 26" in detail and "fnm install 26" in detail


def test_an_nvmrc_alias_pauses_the_lane_with_the_way_forward(lane):
    lane.change_world(slotFiles={".nvmrc": "lts/*"})
    run_steps(lane)
    assert "validation-started" not in kinds(lane)
    assert "pin a version number" in lane.state()["lane"]["pauseReason"]


# S6, S7, S8: never validated against a base it lacks, never merged unguarded or as a non-host.


def test_a_merge_that_did_not_happen_is_never_validated(lane):
    lane.change_world(outcomes={"merge": {"feat/export-csv": "fail: not something we can merge"}})
    run_steps(lane)
    assert "validation-started" not in kinds(lane)
    assert "did not happen" in events(lane, "lane-error")[0]["detail"]


def test_without_a_required_check_the_lane_merges_nothing(lane):
    run_steps(lane, 2)
    run_steps(lane, required_check=None)
    assert "merged" not in kinds(lane)
    assert "required_check" in events(lane, "lane-error")[0]["detail"]


def test_a_lane_that_is_no_longer_the_host_merges_nothing(lane):
    run_steps(lane, 2)
    lane.change_world(laneHost="mini")
    run_steps(lane)
    assert prs(lane)["600"]["state"] == "OPEN"
    assert lane.state()["lane"]["stopRequested"] == "not-host"
    assert "mini" in events(lane, "lane-error")[0]["detail"]


# S12: a check that never finishes is the lane's trouble, with the PR left open.


def test_a_check_that_never_finishes_pauses_the_lane_and_leaves_the_pr_open(lane):
    lane.change_world(outcomes={"checks": {"feat/export-csv": "pending"}})
    run_steps(lane, 2)
    lane.change_world(now="2030-01-01T01:00:00Z")
    run_steps(lane)
    assert events(lane, "lane-error") == []
    lane.change_world(now="2030-01-01T01:31:00Z")
    run_steps(lane)
    [error] = events(lane, "lane-error")
    assert "90 minutes" in error["detail"] and prs(lane)["600"]["state"] == "OPEN"
    assert entry_of(lane, "feat/export-csv")["state"] == "merging"


def test_the_ejection_limit(lane):
    with lane.store.update("two ejections") as state:
        state["cells"][3]["ejections"] = 2  # feat/export-csv
    lane.change_world(outcomes={"merge": {"feat/export-csv": "conflict: a"}})
    run_steps(lane)
    [limit] = events(lane, "ejection-limit")
    assert limit["branch"] == "feat/export-csv" and "3 ejections" in limit["detail"]


def test_a_pr_merged_elsewhere_is_landed_and_flagged(lane):
    lane.change_world(outcomes={"checks": {"feat/export-csv": "pending"}})
    run_steps(lane, 2)
    lane.change_world(prs={"600": {"state": "MERGED"}})
    assert "merged feat/export-csv (PR 600)" in run_steps(lane)
    mine = [e["type"] for e in events(lane) if e.get("branch") == "feat/export-csv"]
    assert mine == ["merged", "merged-without-check"]


def test_a_fetch_failure_pauses_and_a_sign_in_failure_needs_the_owner(lane):
    lane.change_world(outcomes={"fetch": "fail: Could not resolve host: github.com"})
    run_steps(lane)
    [error] = events(lane, "lane-error")
    assert "Could not resolve host" in error["detail"] and "needsOwner" not in error
    assert lane.state()["lane"]["paused"] is True and len(lane.state()["queue"]) == 2
    lane.change_world(outcomes={"fetch": "ok"})
    assert run_steps(lane) == []  # Paused until lane-resume.


def test_held_branches_join_the_queue_when_there_is_room(make_run):
    run = make_run("running", dials={"lane.queueMax": 3})
    with run.store.update("held") as state:
        state["held"].append({"branch": "fix/parser-empty-input", "head": "a1b2c3d", "attempt": 1})
    assert "queued fix/parser-empty-input" in run_steps(run)
    assert run.state()["held"] == [] and queue(run)[-1] == ("fix/parser-empty-input", "queued")


def test_queue_empty_is_said_once_and_a_drained_move_happens_then(make_run):
    run = make_run(laneHost="workstation", lane={"draining": True, "drainTo": "mini"})
    run_steps(run)
    [empty] = events(run, "queue-empty")
    assert empty["detail"] == "The lane host moved to mini"
    assert run.world_data()["laneHost"] == "mini"
    assert run.state()["lane"]["stopRequested"] == "moved"
    run_steps(run)
    assert len(events(run, "queue-empty")) == 1


def test_a_lost_validation_goes_back_to_the_front(lane):
    run_steps(lane)
    data = lane.world_data()
    data["processes"]["running"].clear()  # The process that ran it is gone.
    lane.world_path.write_text(json.dumps(data))
    assert run_steps(lane)[0] == "rerun feat/export-csv (restart)"
    assert queue(lane)[0] == ("feat/export-csv", "validating")


def test_the_lane_never_validates_without_a_validate_command(lane, tmp_path):
    bare = tmp_path / "repo"
    (bare / ".github").mkdir(parents=True)
    (bare / ".github/labels.json").write_bytes((lane.target / ".github/labels.json").read_bytes())
    (bare / "botcore.toml").write_text('[plugins.factory]\nlabels = ".github/labels.json"\n')
    step(lane.factory(bare))
    assert "validate" in events(lane, "lane-error")[0]["detail"]


def test_first_lines_prefer_failures_and_logs_are_named_per_attempt():
    assert first_lines("ok\nok\nFAIL a\nError: b\n") == ["FAIL a", "Error: b"]
    assert first_lines("one\ntwo") == ["one", "two"]
    assert log_path("fix/a b", 2) == "attempts/fix-a-b-2.log"
