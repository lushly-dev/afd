"""The lane's loop, step by step, over fixture worlds whose outside answers each test scripts
(``outcomes``) and whose clock it moves. Nothing here waits or starts a process."""

from __future__ import annotations

import json
from pathlib import PurePath

import pytest

from botcore_factory.events import lane_resume
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


def reviewed(run, state: dict, branch: str, head: str, worktree: str) -> None:
    """What lane-enqueue records for a branch a test queues by hand: its cell's worktree, which
    holds the head and its review, for the lane's own review check."""
    next(c for c in state["cells"] if c["branch"] == branch)["worktree"] = worktree
    run.change_world(
        worktrees={worktree: {"branch": branch, "head": head, "review": {"head": head}}}
    )


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


def test_the_commit_validated_pushed_and_merged_is_the_branch_folded_into_one(lane):
    """lushly-dev/afd#1809: a rebase merge lands each of a branch's own commits and drops its
    merges, so the lane folds the merged head into one commit on the base before validating."""
    lane.change_world(outcomes={"fold": {"feat/export-csv": "folded"}})
    assert run_steps(lane) == ["validating feat/export-csv in slot 1"]
    entry = entry_of(lane, "feat/export-csv")
    assert (entry["validatedHead"], entry["tree"]) == ("b2c3d4e+main-0=1", "tree-b2c3d4e+main-0")
    started = next(r for r in lane.store.read_records() if r["kind"] == "validation-started")
    assert started["head"] == "b2c3d4e+main-0=1"
    assert "opened PR 600 for feat/export-csv at b2c3d4e+main-0=1" in run_steps(lane)
    assert "merged feat/export-csv (PR 600)" in run_steps(lane)
    assert prs(lane)["600"]["mergedHead"] == "b2c3d4e+main-0=1"


def test_the_fold_is_given_every_thread_that_worked_on_the_cell(lane):
    """lushly-dev/afd#1887: the lane opens the pull request, so the commit it folds names the
    cell's threads, which botcore's skill-usage-triggers judges the change by."""
    with lane.store.update("repaired") as state:
        cell = next(c for c in state["cells"] if c["branch"] == "feat/export-csv")
        cell["threads"] = ["thread-1", cell["thread"]]  # a repair by another thread
    run_steps(lane)
    assert lane.world_data()["checkouts"]["1"]["foldSessions"] == ["thread-1", "thread-4"]


# B1: the head pushed and merged is the one validated, whatever its slot holds now.


def test_a_validated_head_keeps_its_checkout_until_pushed(lane):
    with lane.store.update("third") as state:
        state["queue"].append({"branch": "fix/parser-empty-input", "head": "a1b2c3d"})
        reviewed(lane, state, "fix/parser-empty-input", "a1b2c3d", "wt/parser")
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
    # The validated branch behind it gives up its slot but keeps its validation (#1452).
    assert "released slot 1 from fix/retry-backoff; its validation is kept" in actions
    assert "rerun fix/retry-backoff (slot-needed)" not in actions
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
        {"fold": {"feat/export-csv": "refuse: FOLD_REFUSED: its own commits have 2 authors"}},
        "entry-invalid",
        "FOLD_REFUSED: its own commits have 2 authors",
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
    {"fold": {"feat/export-csv": "fail: The fold of b2c3d4e+main-0 is not one commit of its tree"}},
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
        reviewed(lane, state, "feat/export-csv", "b2c3d4f", "wt/export-csv")
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
        reviewed(lane, state, "feat/export-csv", "b2c3d4f", "wt/export-csv")
    run_steps(lane, 2)
    assert events(lane, "ejected")[-1]["reason"] == "push-failed"
    assert lane.world_data()["pushed"]["feat/export-csv"] == "someone-else"


# S3: a merge during a coverage run still owes coverage; the front waits for a gate's.


def test_coverage_debt_from_a_merge_during_a_coverage_run_is_kept(lane):
    with lane.store.update("every merge") as state:
        state["dials"]["lane.coverageEvery"] = 1
        state["queue"].append({"branch": "fix/parser-empty-input", "head": "a1b2c3d"})
        reviewed(lane, state, "fix/parser-empty-input", "a1b2c3d", "wt/parser")
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
    assert not events(lane, "ejected")  # The base's own .nvmrc: no branch is to blame.


def test_an_nvmrc_alias_pauses_the_lane_with_the_way_forward(lane):
    lane.change_world(slotFiles={".nvmrc": "lts/*"})
    run_steps(lane)
    assert "validation-started" not in kinds(lane)
    assert "pin a version number" in lane.state()["lane"]["pauseReason"]


# #1352: a branch that bumps .nvmrc to a Node the host lacks is ejected; the lane goes on.

NODE_26 = "/fnm/v26.13.0/bin"


def _bumps_nvmrc(lane, spec: str) -> None:
    lane.change_world(
        slotFiles={".nvmrc": "26\n"},
        nodes={"26": NODE_26},
        branchSlotFiles={"feat/export-csv": {".nvmrc": spec + "\n"}},
        outcomes={"changed": {"feat/export-csv": [".nvmrc", "src/export.ts"]}},
    )


def test_a_branch_that_bumps_nvmrc_to_a_node_the_host_lacks_is_ejected(lane):
    _bumps_nvmrc(lane, "27")
    actions = run_steps(lane, **INSTALL)
    assert "ejected feat/export-csv (node-missing)" in actions
    assert "validating fix/retry-backoff in slot 1" in actions  # The next branch takes the slot.
    assert not lane.state()["lane"].get("paused")
    ejected = events(lane, "ejected")[0]
    assert ejected["reason"] == "node-missing" and not ejected.get("excused")
    assert ejected["detail"].startswith("NODE_MISSING: the branch's .nvmrc names Node 27")
    assert "keep the base's .nvmrc" in ejected["detail"] and "fnm install 27" in ejected["detail"]
    [record] = [r for r in lane.store.read_records() if r["kind"] == "ejected"]
    assert record["cause"] == "node-missing" and record["counted"] is True
    [job] = lane.world_data()["processes"]["running"].values()
    assert [s["path"] for s in job["steps"]] == [[NODE_26]] * 2  # Main's Node for the next.
    cell = next(c for c in lane.state()["cells"] if c["branch"] == "feat/export-csv")
    assert cell["state"] == "ejected" and cell["lastEjection"]["cause"] == "node-missing"


def test_a_branch_that_sets_an_nvmrc_alias_is_ejected_with_the_way_forward(lane):
    _bumps_nvmrc(lane, "lts/*")
    actions = run_steps(lane)
    assert "ejected feat/export-csv (node-missing)" in actions
    assert "pin a version number" in events(lane, "ejected")[0]["detail"]
    assert not lane.state()["lane"].get("paused")


def test_a_branch_that_deletes_nvmrc_is_ejected_not_run_on_the_host_s_node(lane):
    """#1505: no .nvmrc in its slot would validate it on the host's default Node."""
    lane.change_world(
        slotFiles={".nvmrc": "26\n"},
        nodes={"26": NODE_26},
        branchSlotFiles={"feat/export-csv": {".nvmrc": None}},
        outcomes={"changed": {"feat/export-csv": [".nvmrc", "src/export.ts"]}},
    )
    actions = run_steps(lane, **INSTALL)
    assert "ejected feat/export-csv (node-missing)" in actions
    assert "validating fix/retry-backoff in slot 1" in actions
    assert not lane.state()["lane"].get("paused")
    ejected = events(lane, "ejected")[0]
    assert ejected["reason"] == "node-missing" and not ejected.get("excused")
    assert ejected["detail"].startswith("NODE_MISSING: the branch deletes .nvmrc")
    assert "pins its Node" in ejected["detail"] and "keep the base's .nvmrc" in ejected["detail"]
    [job] = lane.world_data()["processes"]["running"].values()
    assert [s["path"] for s in job["steps"]] == [[NODE_26]] * 2  # Main's Node for the next.


def test_a_branch_that_blanks_nvmrc_is_ejected_and_told_to_pin_a_version(lane):
    lane.change_world(
        slotFiles={".nvmrc": "26\n"},
        nodes={"26": NODE_26},
        branchSlotFiles={"feat/export-csv": {".nvmrc": " \n"}},
        outcomes={"changed": {"feat/export-csv": [".nvmrc", "src/export.ts"]}},
    )
    actions = run_steps(lane)
    assert "ejected feat/export-csv (node-missing)" in actions
    detail = events(lane, "ejected")[0]["detail"]
    assert detail.startswith("NODE_MISSING: the branch leaves .nvmrc blank")
    assert "pin a version number" in detail and "deletes" not in detail


def test_without_nvmrc_in_base_or_branch_a_branch_validates_as_before(lane):
    lane.change_world(outcomes={"changed": {"feat/export-csv": ["src/export.ts"]}})
    assert run_steps(lane) == ["validating feat/export-csv in slot 1"]


def test_a_branch_whose_nvmrc_node_is_installed_validates_on_it(lane):
    _bumps_nvmrc(lane, "27")
    lane.change_world(nodes={"27": "/fnm/v27.0.0/bin"})
    assert run_steps(lane) == ["validating feat/export-csv in slot 1"]
    [job] = lane.world_data()["processes"]["running"].values()
    assert job["steps"][0]["path"] == ["/fnm/v27.0.0/bin"]


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
    lane.change_world(outcomes={"validate": {"feat/export-csv": "fail: FAIL src/x.test.ts"}})
    run_steps(lane, 2)
    [limit] = events(lane, "ejection-limit")
    assert limit["branch"] == "feat/export-csv" and "3 ejections count" in limit["detail"]


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


def test_first_lines_put_the_failed_test_and_suite_first_never_a_passing_test():
    """lushly-dev/afd#1373: a passing test whose name says "failed" is not the failure."""
    log = "\n".join(
        [
            "✔ starts a local run",
            "✖ SIGTERM during a real local run unwinds cleanup",
            "  AssertionError: Target page, context or browser has been closed",
            *[f"✔ passing test {n}" for n in range(30)],
            "✔ a failed restart remains a failure without leaking response bodies",
            "\x1b[32m✓ coloured pass that failed nothing\x1b[0m",
            "[verify] summary",
            "  pass  12s  check (ci.yml)",
            "  FAIL  612s  hosted-fixtures",
        ]
    )
    lines = first_lines(log)
    assert lines[:3] == [
        "✖ SIGTERM during a real local run unwinds cleanup",
        "  FAIL  612s  hosted-fixtures",
        "  AssertionError: Target page, context or browser has been closed",
    ]
    assert not any("✔" in line or "✓" in line for line in lines)
    # An exception line a test logged, or a prefixed passing line, never leads.
    noisy = "\n".join(
        [
            "  Error: listen EADDRINUSE (expected, retried)",
            "packages/x test: ✔ a failed restart remains a failure",
            "packages/x test: ✖ SIGTERM unwinds cleanup",
            "  FAIL  612s  hosted-fixtures",
        ]
    )
    assert first_lines(noisy) == [
        "packages/x test: ✖ SIGTERM unwinds cleanup",
        "  FAIL  612s  hosted-fixtures",
        "  Error: listen EADDRINUSE (expected, retried)",
    ]
    # Words before a colon are not a package prefix; an error that says "pass" is still one.
    loose = "\n".join(
        [
            "check result: FAILED as expected",
            "AssertionError [ERR_ASSERTION]: ok flag missing",
            "Error [ERR_X]: pass-through failed",
        ]
    )
    assert first_lines(loose)[:2] == [
        "AssertionError [ERR_ASSERTION]: ok flag missing",
        "Error [ERR_X]: pass-through failed",
    ]


def test_first_lines_prefer_failures_and_logs_are_named_per_attempt():
    assert first_lines("ok\nok\nFAIL a\nError: b\n") == ["FAIL a", "Error: b"]
    assert first_lines("one\ntwo") == ["one", "two"]
    assert log_path("fix/a b", 2) == "attempts/fix-a-b-2.log"


# lushly-dev/afd#1308: the lane checks each review itself, with the base's verifier.


def test_the_lane_ejects_a_head_whose_review_the_base_s_verifier_refuses(lane):
    """Enqueue ran the branch's own verifier; the lane's run, from the base, binds."""
    lane.change_world(worktrees={"wt/export-csv": {"review": None}})
    actions = run_steps(lane)
    assert "ejected feat/export-csv (review-unverified)" in actions
    assert "validating fix/retry-backoff in slot 1" in actions
    ejected = events(lane, "ejected")[0]
    assert (ejected["reason"], ejected["detail"]) == ("review-unverified", "no review record")
    assert "validation-started" not in [
        r["kind"] for r in lane.store.read_records() if r.get("branch") == "feat/export-csv"
    ]
    review = lane.world_data()["checkouts"]["review"]
    assert (review["branch"], review["head"]) == ("", "main-0")  # The base, never the branch.


def test_a_review_of_an_older_head_does_not_pass_the_lane(lane):
    lane.change_world(worktrees={"wt/export-csv": {"head": "b2c3d4f"}})  # Moved after enqueue.
    assert "ejected feat/export-csv (review-unverified)" in run_steps(lane)


def test_a_cell_whose_worktree_is_gone_is_ejected_not_paused(lane):
    data = lane.world_data()
    del data["worktrees"]["wt/export-csv"]
    lane.world_path.write_text(json.dumps(data), encoding="utf-8")
    actions = run_steps(lane)
    assert "ejected feat/export-csv (review-unverified)" in actions
    assert "is gone" in events(lane, "ejected")[0]["detail"]
    assert not lane.state()["lane"].get("paused")


def test_a_verifier_that_cannot_run_pauses_the_lane_and_ejects_nothing(lane):
    lane.change_world(outcomes={"review": "fail: node is not on PATH"})
    run_steps(lane)
    assert lane.state()["lane"]["paused"] is True
    assert "node is not on PATH" in lane.state()["lane"]["pauseReason"]
    assert not events(lane, "ejected")
    assert queue(lane) == [("feat/export-csv", "queued"), ("fix/retry-backoff", "queued")]


def test_review_evidence_without_the_worktree_is_the_lane_s_trouble(lane):
    run_steps(
        lane, review_evidence=["node", "scripts/review-record.mjs", "verify", "--head", "{head}"]
    )
    assert "must name {worktree}" in lane.state()["lane"]["pauseReason"]
    assert not events(lane, "ejected")


def test_a_verifier_that_crashes_on_the_base_pauses_the_lane_and_ejects_nothing(lane):
    """Node exits 1 for a missing or broken script: that is not the branch's refusal (3)."""
    lane.change_world(outcomes={"review": "exit 1"})
    run_steps(lane)
    assert "review verifier failed" in lane.state()["lane"]["pauseReason"]
    assert not events(lane, "ejected")


def test_a_repair_without_a_review_keeps_a_validated_branch_s_slot(lane):
    with lane.store.update("a validated branch holds the only slot") as state:
        state["queue"] = [
            {"branch": "fix/parser-empty-input", "head": "a1b2c3d"},
            {
                "branch": "feat/export-csv",
                "head": "b2c3d4e",
                "state": "validated",
                "slot": "1",
                "validatedHead": "b2c3d4e+main-0",
                "base": "main-0",
            },
        ]
        reviewed(lane, state, "fix/parser-empty-input", "a1b2c3d", "wt/parser")
    lane.change_world(worktrees={"wt/parser": {"review": None}})
    actions = run_steps(lane)
    assert "ejected fix/parser-empty-input (review-unverified)" in actions
    assert entry_of(lane, "feat/export-csv")["state"] == "validated"
    assert "rerun" not in kinds(lane)


# lushly-dev/afd#1410: a merge whose only conflicts are generated records is written again.

RECORDS = (
    "endpoints/botcore/provenance/provenance.json, endpoints/botcore/provenance/adaptations.json"
)
REGENERATE = {
    "regenerate": [
        {
            "name": "provenance",
            "paths": ["endpoints/*/provenance/*.json"],
            "run": ["node", "scripts/provenance-merge.mjs"],
        }
    ]
}


def regenerating(run_, steps: int = 1) -> list[str]:
    from botcore_factory.adapter import Regenerate

    specs = [Regenerate(**spec) for spec in REGENERATE["regenerate"]]
    return run_steps(run_, steps, regenerate=specs)


def test_conflicts_only_in_generated_records_are_written_again_and_validated(lane):
    from botcore_factory.report import lane_report

    lane.change_world(outcomes={"merge": {"feat/export-csv": f"conflict: {RECORDS}"}})
    actions = regenerating(lane)
    assert actions[:2] == [
        "regenerated provenance for feat/export-csv",
        "validating feat/export-csv in slot 1",
    ]
    assert entry_of(lane, "feat/export-csv")["validatedHead"] == "b2c3d4e+main-0"
    all_records = lane.store.read_records()
    rerecorded = next(r for r in all_records if r["kind"] == "provenance-rerecorded")
    assert rerecorded["branch"] == "feat/export-csv"
    assert rerecorded["attempt"] == 1
    assert rerecorded["base"] == "main-0"
    assert rerecorded["names"] == ["provenance"]
    assert rerecorded["paths"] == [
        "endpoints/botcore/provenance/provenance.json",
        "endpoints/botcore/provenance/adaptations.json",
    ]
    started = next(r for r in all_records if r["kind"] == "validation-started")
    assert started["regenerated"] == ["provenance"]
    assert lane_report(lane.factory(), None, None)["provenanceRerecorded"] == 1
    assert not events(lane, "ejected")


def test_a_regenerated_merge_is_folded_before_it_is_validated(lane):
    lane.change_world(
        outcomes={
            "merge": {"feat/export-csv": f"conflict: {RECORDS}"},
            "fold": {"feat/export-csv": "folded"},
        }
    )
    assert "validating feat/export-csv in slot 1" in regenerating(lane)
    assert entry_of(lane, "feat/export-csv")["validatedHead"] == "b2c3d4e+main-0=1"


def test_a_conflict_outside_the_generated_files_still_ejects(lane):
    lane.change_world(outcomes={"merge": {"feat/export-csv": f"conflict: {RECORDS}, src/a.ts"}})
    assert "ejected feat/export-csv (conflict)" in regenerating(lane)
    assert "provenance-rerecorded" not in kinds(lane)
    assert (
        "checkouts" not in lane.world_data()
        or "merging" not in (lane.world_data()["checkouts"]["1"])
    )


def test_a_regenerate_command_that_refuses_ejects_as_a_conflict(lane):
    lane.change_world(
        outcomes={
            "merge": {"feat/export-csv": f"conflict: {RECORDS}"},
            "regenerate": {
                "provenance": "fail: both sides changed $.files[a.py].import_classification"
            },
        }
    )
    actions = regenerating(lane)
    assert "ejected feat/export-csv (conflict)" in actions
    detail = events(lane, "ejected")[0]["detail"]
    assert "provenance could not merge them: both sides changed" in detail
    assert "merging" not in lane.world_data()["checkouts"]["1"]
    assert "provenance-rerecorded" not in kinds(lane)


def test_a_regenerate_command_that_cannot_run_pauses_the_lane(lane):
    lane.change_world(
        outcomes={
            "merge": {"feat/export-csv": f"conflict: {RECORDS}"},
            "regenerate": {"provenance": "error: node is not on PATH"},
        }
    )
    regenerating(lane)
    assert "could not run: node is not on PATH" in lane.state()["lane"]["pauseReason"]
    assert not events(lane, "ejected")


def test_paths_left_unmerged_after_regenerating_eject(lane):
    lane.change_world(
        outcomes={
            "merge": {"feat/export-csv": f"conflict: {RECORDS}"},
            "finish": {"feat/export-csv": "conflict: endpoints/botcore/provenance/provenance.json"},
        }
    )
    assert "ejected feat/export-csv (conflict)" in regenerating(lane)
    assert "provenance-rerecorded" not in kinds(lane)


def test_without_regenerate_a_records_conflict_ejects_as_before(lane):
    lane.change_world(outcomes={"merge": {"feat/export-csv": f"conflict: {RECORDS}"}})
    assert "ejected feat/export-csv (conflict)" in run_steps(lane)


def test_a_short_disk_pauses_the_lane_before_validating(lane):
    """lushly-dev/afd#1565: a full disk mid-build ejected a good branch; now the lane pauses
    first, names the dial and where the slots build, and ejects nothing."""
    lane.change_world(host={"freeDiskGb": 12})
    run_steps(lane, 2)
    assert "validation-started" not in kinds(lane) and not events(lane, "ejected")
    assert queue(lane)[0] == ("feat/export-csv", "queued")
    [error] = events(lane, "lane-error")
    assert "host.minFreeDiskGb is 20" in error["detail"] and "slots" in error["detail"]
    assert lane.state()["lane"]["paused"] is True
    factory = lane.factory()
    lane_resume(factory, "freed some disk")  # Not enough: it pauses again, ejecting nothing.
    run_steps(lane)
    assert lane.state()["lane"]["paused"] is True and len(events(lane, "lane-error")) == 2
    assert not events(lane, "ejected")
    lane.change_world(host={"freeDiskGb": 200})
    lane_resume(lane.factory(), "freed enough")
    assert run_steps(lane) == ["validating feat/export-csv in slot 1"]


def test_an_unreadable_disk_pauses_the_lane_with_the_way_out(lane):
    lane.change_world(host={"freeMemoryGb": 40}, machines=[], thisMachine="nowhere")
    run_steps(lane)
    assert "Cannot read free disk" in lane.state()["lane"]["pauseReason"]
    assert "host.minFreeDiskGb" in lane.state()["lane"]["pauseReason"]


@pytest.mark.parametrize(
    ("label", "message", "config"),
    [
        ("validate", "error: failed to write target/x.rlib: No space left on device", {}),
        ("install", "ERR_PNPM_ENOSPC  ENOSPC: no space left on device, write", INSTALL),
    ],
)
def test_a_job_that_runs_out_of_disk_pauses_the_lane_and_counts_no_ejection(
    lane, label, message, config
):
    """lushly-dev/afd#1641: a full disk is the host's failure, not the branch's."""
    lane.change_world(outcomes={label: {"feat/export-csv": f"fail: {message}"}})
    run_steps(lane, 2, **config)
    assert not events(lane, "ejected") and "ejected" not in kinds(lane)
    assert queue(lane)[0] == ("feat/export-csv", "queued")
    cell = next(c for c in lane.state()["cells"] if c["branch"] == "feat/export-csv")
    assert cell["ejections"] == 0 and "lastEjection" not in cell
    [error] = events(lane, "lane-error")
    assert "ran out of disk" in error["detail"] and "host.buildDir" in error["detail"]
    assert lane.state()["lane"]["paused"] is True
    rerun = [r for r in lane.store.read_records() if r["kind"] == "rerun"][-1]
    assert (rerun["reason"], rerun["detail"]) == ("disk-full", message)

    lane.change_world(outcomes={label: {"feat/export-csv": "pass"}})
    lane_resume(lane.factory(), "freed disk")
    assert run_steps(lane, **config) == ["validating feat/export-csv in slot 1"]


def test_a_failure_that_only_names_the_disk_in_a_passed_test_still_ejects(lane):
    output = "✓ handles ENOSPC when the cache is full\nFAIL src/a.test.ts > parses"
    lane.change_world(outcomes={"validate": {"feat/export-csv": f"fail: {output}"}})
    run_steps(lane, 2)
    assert events(lane, "ejected")[0]["reason"] == "final-failed"
    assert lane.state()["lane"].get("paused") is not True


def test_coverage_that_runs_out_of_disk_pauses_without_calling_main_broken(make_run):
    run = make_run("running", queue=[], held=[], lane={"mergedSinceCoverage": [1, 2, 3, 4, 5]})
    config = {"coverage": ["pnpm", "test:coverage"]}
    run.change_world(outcomes={"coverage": {"": "fail: ENOSPC: no space left on device"}})
    run_steps(run, 2, **config)
    assert not events(run, "main-broken") and "coverage" not in kinds(run)
    assert "ran out of disk" in run.state()["lane"]["pauseReason"]
    assert run.state()["lane"]["mergedSinceCoverage"] == [1, 2, 3, 4, 5]  # Still owed.


def test_a_short_disk_pauses_the_lane_before_starting_coverage(make_run):
    """lushly-dev/afd#1660: check free disk before start_coverage, so resuming on a still-full
    disk pauses again instead of running coverage into a second ENOSPC reported as main-broken."""
    run = make_run(
        "running",
        queue=[],
        held=[],
        lane={"mergedSinceCoverage": [1, 2, 3, 4, 5]},
        host={"freeDiskGb": 12},
    )
    config = {"coverage": ["pnpm", "test:coverage"]}
    run_steps(run, 2, **config)
    assert not events(run, "main-broken") and "coverage" not in kinds(run)
    assert run.state()["lane"].get("coverage") is None
    assert run.state()["lane"]["paused"] is True
    [error] = events(run, "lane-error")
    assert "Coverage waits" in error["detail"] and "host.minFreeDiskGb is 20" in error["detail"]
    assert run.state()["lane"]["mergedSinceCoverage"] == [1, 2, 3, 4, 5]

    lane_resume(run.factory(), "freed some disk")  # Still short: pauses again, never main-broken.
    run_steps(run, **config)
    assert run.state()["lane"]["paused"] is True
    assert len(events(run, "lane-error")) == 2 and not events(run, "main-broken")
    assert run.state()["lane"].get("coverage") is None

    run.change_world(host={"freeDiskGb": 200})
    lane_resume(run.factory(), "freed enough")
    assert "coverage on main-0" in run_steps(run, **config)
    assert "coverage passed" in run_steps(run, **config)
    assert run.state()["lane"]["mergedSinceCoverage"] == []


def test_an_unreadable_disk_pauses_the_lane_before_starting_coverage(make_run):
    run = make_run(
        "running",
        queue=[],
        held=[],
        dials={"host.buildDir": "/Volumes/Dev"},
        lane={"mergedSinceCoverage": [1, 2, 3, 4, 5]},
        host={"freeDiskGb": 200, "missingDirs": ["/Volumes/Dev"]},
    )
    run_steps(run, coverage=["pnpm", "test:coverage"])
    assert not events(run, "main-broken") and run.state()["lane"].get("coverage") is None
    assert run.state()["lane"]["paused"] is True
    assert "host.buildDir /Volumes/Dev is not a directory" in run.state()["lane"]["pauseReason"]


def test_coverage_sweeps_stale_slot_builds_before_reading_free_disk(make_run):
    stale = str(PurePath("slots/.build/1"))
    run = make_run(
        "running",
        queue=[],
        held=[],
        lane={
            "mergedSinceCoverage": [1, 2, 3, 4, 5],
            "slotBuilds": {"1": {"branch": "feat/already-merged", "path": stale}},
        },
    )
    actions = run_steps(run, coverage=["pnpm", "test:coverage"])
    assert "removed slot 1's build output for feat/already-merged" in actions
    assert "coverage on main-0" in actions
    assert run.world_data()["removedBuilds"] == [stale, str(PurePath("slots/.build/coverage"))]


def job_env(run) -> list[str]:
    """Each started job's CARGO_TARGET_DIR, in the order the jobs started."""
    running = run.world_data()["processes"]["running"]
    return [running[h]["steps"][-1]["env"]["CARGO_TARGET_DIR"] for h in sorted(running)]


def test_each_slot_builds_rust_in_its_own_directory_removed_when_it_takes_another_branch(lane):
    """lushly-dev/afd#1641: Rust build output in the slots reached 51 GB on the lane host."""
    target = str(PurePath("slots/.build/1"))
    lane.change_world(outcomes={"validate": {"fix/retry-backoff": "running"}})
    run_steps(lane, 2)
    assert job_env(lane) == [target]  # The first job finished; this is the second.
    assert lane.world_data()["removedBuilds"] == [target, target]
    assert lane.state()["lane"]["slotBuilds"] == {
        "1": {"branch": "fix/retry-backoff", "path": target}
    }


def test_host_build_dir_puts_the_build_output_on_another_volume(make_run):
    lane = make_run("running", dials={"host.buildDir": "/Volumes/Dev"})
    lane.change_world(outcomes={"validate": {"feat/export-csv": "running"}})
    run_steps(lane)
    assert job_env(lane) == [str(PurePath("/Volumes/Dev/slots-build/1"))]


def test_a_slot_keeps_its_build_for_the_same_branch_and_drops_it_when_the_dial_moves(make_run):
    from botcore_factory.lane import Step

    target = str(PurePath("slots/.build/1"))
    on_volume = str(PurePath("/Volumes/Dev/slots-build/1"))
    run = make_run("running")
    factory = run.factory()
    with factory.store.update("test") as state:
        slots = Step(factory, state)
        assert slots.slot_build("1", "fix/a") == target
        assert slots.slot_build("1", "fix/a") == target  # Kept: nothing removed.
        state["dials"]["host.buildDir"] = "/Volumes/Dev"
        assert slots.slot_build("1", "fix/a") == on_volume
    assert run.world_data()["removedBuilds"] == [target, target, on_volume]


def test_a_short_build_volume_pauses_the_lane_and_names_it(make_run):
    build_root = str(PurePath("/Volumes/Dev/slots-build"))
    lane = make_run(
        "running",
        dials={"host.buildDir": "/Volumes/Dev"},
        host={"freeDiskGb": 200, "freeDiskGbAt": {build_root: 5}},
    )
    run_steps(lane)
    assert "validation-started" not in kinds(lane)
    assert "5 GB of disk is free" in lane.state()["lane"]["pauseReason"]
    assert build_root in lane.state()["lane"]["pauseReason"]


def test_a_build_dir_that_is_not_mounted_pauses_the_lane(make_run):
    """An unmounted volume's mount point would put the build back on the system disk."""
    lane = make_run(
        "running",
        dials={"host.buildDir": "/Volumes/Dev"},
        host={"freeDiskGb": 200, "missingDirs": ["/Volumes/Dev"]},
    )
    run_steps(lane)
    assert "validation-started" not in kinds(lane) and not events(lane, "ejected")
    reason = lane.state()["lane"]["pauseReason"]
    assert "host.buildDir /Volumes/Dev is not a directory" in reason


@pytest.mark.parametrize(
    "line",
    [
        "✗ maps ENOSPC to a friendly message",
        "tests/test_fs.py::test_write[ENOSPC] PASSED",
        "_____ test_runs_out_of_disk[No space left on device] _____",
        "FAIL src/errors.test.ts > maps ENOSPC",
        "test disk::full_is_reported ... FAILED (No space left on device)",
    ],
)
def test_a_test_named_for_a_full_disk_is_not_read_as_one(line):
    from botcore_factory.failures import disk_full

    assert disk_full(f"{line}\nAssertionError: expected 1") is None


def test_a_full_disk_is_read_from_the_whole_log_and_through_pnpm_prefixes():
    from botcore_factory.failures import disk_full

    noise = "\n".join(f"line {n}" for n in range(500))
    full = "packages/x test: error: ENOSPC: no space left on device, write"
    assert disk_full(f"{full}\n{noise}") == "error: ENOSPC: no space left on device, write"


def test_a_second_full_disk_in_one_attempt_ejects_as_any_failure(lane):
    """Once per attempt: a branch whose own failure says so must not pause the lane for ever."""
    lane.change_world(outcomes={"validate": {"feat/export-csv": "fail: No space left on device"}})
    run_steps(lane, 2)
    lane_resume(lane.factory(), "freed disk")
    run_steps(lane, 2)
    assert events(lane, "ejected")[0]["reason"] == "final-failed"
    assert len(events(lane, "lane-error")) == 1


def test_a_free_slot_s_build_is_removed_once_its_branch_left_the_queue(lane):
    with lane.store.update("a slot that built a merged branch") as state:
        state["lane"]["slotBuilds"] = {"1": {"branch": "fix/merged", "path": "slots/.build/1"}}
    actions = run_steps(lane)
    assert actions[0] == "removed slot 1's build output for fix/merged"
    assert lane.world_data()["removedBuilds"][0] == "slots/.build/1"


def test_the_build_dir_is_never_the_slots_own_directory(make_run):
    """With the repository on the data volume, <buildDir>/<slots' folder> holds the slots."""
    from botcore_factory.cells import build_dir

    run = make_run("running")
    root = build_dir(run.factory(), {"host.buildDir": "/Volumes/Dev"}, "1")
    assert root == str(PurePath("/Volumes/Dev/slots-build/1"))
    assert PurePath("/Volumes/Dev/slots") not in PurePath(root).parents


def test_slot_clean_paths_are_cleaned_on_recycle_and_kept_for_same_branch(make_run):
    """lushly-dev/afd#1659: Specimen's build:host writes ignored output inside the slot checkout;
    slot_clean_paths cleans it on first use, branch change and dial move, but keeps it when the
    same branch re-validates."""
    from botcore_factory.lane import Step

    rel = "foundations/specimen/host/target"
    run = make_run("running")
    factory = run.factory()
    factory.config = factory.config.model_copy(update={"slot_clean_paths": [rel]})
    with factory.store.update("test") as state:
        slots = Step(factory, state)
        slots.slot_build("1", "fix/a")
        slots.slot_build("1", "fix/a")  # Same branch, same dial: kept.
        slots.slot_build("1", "fix/b")  # Different branch: cleaned.
        state["dials"]["host.buildDir"] = "/Volumes/Dev"
        slots.slot_build("1", "fix/b")  # Dial moved: cleaned.
    assert run.world_data()["cleanedSlotPaths"] == [
        {"slot": "1", "path": rel},
        {"slot": "1", "path": rel},
        {"slot": "1", "path": rel},
    ]


def test_slot_clean_paths_are_swept_for_free_slots_and_not_double_cleaned(make_run):
    """lushly-dev/afd#1659: sweep_builds cleans configured paths before free disk is read, both
    for slots tracked in slotBuilds and for pre-upgrade slots with no slotBuilds entry, without
    cleaning the same slot twice in one step."""
    rel = "foundations/specimen/host/target"
    run = make_run("running")
    run.change_world(
        slotOutputs={"1": [rel]}, outcomes={"validate": {"feat/export-csv": "running"}}
    )
    actions = run_steps(run, slot_clean_paths=[rel])
    assert f"cleaned slot 1's build output ({rel})" in actions
    assert run.world_data()["slotOutputs"]["1"] == []
    # Slot 1 is cleaned once in sweep_builds; slot_build in the same step does not duplicate it.
    slot1_cleans = [entry for entry in run.world_data()["cleanedSlotPaths"] if entry["slot"] == "1"]
    assert slot1_cleans == [{"slot": "1", "path": rel}]


def test_slot_clean_paths_are_cleaned_when_a_free_slot_s_branch_leaves_the_queue(lane):
    rel = "foundations/specimen/host/target"
    with lane.store.update("a slot that built a merged branch") as state:
        state["lane"]["slotBuilds"] = {"1": {"branch": "fix/merged", "path": "slots/.build/1"}}
    actions = run_steps(lane, slot_clean_paths=[rel])
    assert actions[0] == "removed slot 1's build output for fix/merged"
    slot1_cleans = [
        entry for entry in lane.world_data()["cleanedSlotPaths"] if entry["slot"] == "1"
    ]
    assert slot1_cleans == [{"slot": "1", "path": rel}]


def test_coverage_cleans_slot_clean_paths_on_start_completion_and_second_run(make_run):
    from botcore_factory.lane import Step

    rel = "foundations/specimen/host/target"
    run = make_run(
        "running",
        queue=[],
        held=[],
        lane={"mergedSinceCoverage": [1, 2, 3, 4, 5]},
    )
    config = {"coverage": ["pnpm", "test:coverage"], "slot_clean_paths": [rel]}
    run_steps(run, **config)  # Starts coverage (cleans coverage once before disk_short).
    run_steps(run, **config)  # Polls coverage pass (cleans coverage on completion).
    # A second coverage run with slotBuilds["coverage"] already set still cleans on slot_build.
    factory = run.factory()
    factory.config = factory.config.model_copy(update={"slot_clean_paths": [rel]})
    with factory.store.update("second coverage run") as state:
        Step(factory, state).slot_build("coverage", "")
    coverage_cleans = [
        entry for entry in run.world_data()["cleanedSlotPaths"] if entry["slot"] == "coverage"
    ]
    assert coverage_cleans == [
        {"slot": "coverage", "path": rel},
        {"slot": "coverage", "path": rel},
        {"slot": "coverage", "path": rel},
    ]


def test_coverage_deferred_slot_cleanup_retries_before_disk_check_without_losing_result(make_run):
    rel = "foundations/specimen/host/target"
    run = make_run(
        "running",
        queue=[],
        held=[],
        lane={"mergedSinceCoverage": [1, 2, 3, 4, 5]},
    )
    config = {"coverage": ["pnpm", "test:coverage"], "slot_clean_paths": [rel]}
    run_steps(run, **config)
    run.change_world(outcomes={"cleanSlotPaths": "fail: busy"}, slotOutputs={"coverage": [rel]})
    actions = run_steps(run, **config)
    assert "coverage passed" in actions
    assert any("coverage slot cleanup deferred: busy" in action for action in actions)
    assert run.state()["lane"]["mergedSinceCoverage"] == []
    assert run.world_data()["slotOutputs"]["coverage"] == [rel]
    # Next step retries inactive coverage cleanup BEFORE disk_short checks free disk.
    run.change_world(outcomes={"cleanSlotPaths": "ok"}, host={"freeDiskGb": 5})
    with run.store.update("queue next coverage") as state:
        state["lane"]["mergedSinceCoverage"] = [6, 7, 8, 9, 10]
    actions = run_steps(run, **config)
    assert f"cleaned coverage slot's build output ({rel})" in actions
    assert run.world_data()["slotOutputs"]["coverage"] == []
    assert run.state()["lane"]["paused"] is True  # Paused on disk_short AFTER cleanup ran.
