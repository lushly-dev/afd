"""The lane's loop, step by step, over fixture worlds whose outside answers each test scripts
(``outcomes``) and whose clock it moves. Nothing here waits or starts a process."""

from __future__ import annotations

import json

import pytest

from botcore_factory.lane import first_lines, log_path, step


def run_steps(run, count: int = 1) -> list[str]:
    actions = []
    for _ in range(count):
        actions += step(run.factory())
    return actions


def kinds(run) -> list[str]:
    return [record["kind"] for record in run.store.read_records()]


def events(run, kind: str | None = None) -> list[dict]:
    return [e for e in run.state()["events"] if kind is None or e["type"] == kind]


def queue(run) -> list[tuple[str, str]]:
    return [(entry["branch"], entry["state"]) for entry in run.state()["queue"]]


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
    assert actions[:2] == ["validated feat/export-csv", "opened PR 600 for feat/export-csv"]
    assert "validating fix/retry-backoff in slot 1" in actions
    pr = lane.world_data()["prs"]["600"]
    assert pr["head"] == "b2c3d4e+main-0" and "Closes #104" in pr["body"]
    assert (
        "## Verification" in pr["body"] and "`pnpm verify` passed on b2c3d4e+main-0" in pr["body"]
    )
    actions = run_steps(lane)
    assert "merged feat/export-csv (PR 600)" in actions
    state = lane.state()
    assert all(c["branch"] != "feat/export-csv" for c in state["cells"])
    assert [e["detail"] for e in events(lane, "merged")] == ["PR 600"]
    assert state["runs"][0]["prs"][-1] == {
        "number": 600,
        "branch": "feat/export-csv",
        "route": "opus/medium",
    }
    assert kinds(lane) == [
        "validation-started",
        "validated",
        "validation-started",
        "validated",
        "merged",
    ]


def test_main_moving_since_a_validation_started_validates_again(lane):
    run_steps(lane, 3)  # export-csv merged; retry-backoff validating against main-0.
    actions = run_steps(lane)  # Its validation passes, but main is now main@600.
    assert "rerun fix/retry-backoff (main-moved)" in actions
    assert "validating fix/retry-backoff in slot 1" in actions
    assert lane.state()["queue"][0]["base"] == "main@600"
    run_steps(lane, 3)
    assert lane.state()["queue"] == []
    reruns = [r for r in lane.store.read_records() if r["kind"] == "rerun"]
    assert [r["reason"] for r in reruns] == ["main-moved"]


def test_merges_stay_in_queue_order(lane):
    lane.change_world(outcomes={"validate": {"feat/export-csv": "running"}})
    with lane.store.update("two slots") as state:
        state["dials"]["lane.slots"] = 2
    run_steps(lane, 2)
    assert queue(lane) == [("feat/export-csv", "validating"), ("fix/retry-backoff", "validated")]
    assert "prs" not in lane.world_data()  # The second waits for the first.


def test_two_slots_validate_two_branches_at_once(lane):
    with lane.store.update("two slots") as state:
        state["dials"]["lane.slots"] = 2
    run_steps(lane)
    assert [(e["branch"], e["slot"]) for e in lane.state()["queue"]] == [
        ("feat/export-csv", "1"),
        ("fix/retry-backoff", "2"),
    ]


@pytest.mark.parametrize(
    "outcomes,cause,detail",
    [
        (
            {"merge": {"feat/export-csv": "conflict: src/a.ts, src/b.ts"}},
            "conflict",
            "Conflicts with main-0: src/a.ts, src/b.ts",
        ),
        (
            {"prepare": {"feat/export-csv": "fail: unknown revision"}},
            "entry-invalid",
            "b2c3d4e cannot be checked out: unknown revision",
        ),
        (
            {
                "validate": {
                    "feat/export-csv": "fail: noise\nFAIL src/x.test.ts > parses empty input"
                }
            },
            "final-failed",
            "FAIL src/x.test.ts > parses empty input",
        ),
        (
            {"push": {"feat/export-csv": "fail: rejected (non-fast-forward)"}},
            "push-failed",
            "rejected (non-fast-forward)",
        ),
        (
            {"pr": {"feat/export-csv": "fail: GraphQL: base branch missing"}},
            "pr-failed",
            "GraphQL: base branch missing",
        ),
        ({"checks": {"feat/export-csv": "failure"}}, "ci-failed", "ci-ok failed on PR 600"),
        ({"mergePr": {"feat/export-csv": "fail: head changed"}}, "merge-failed", "head changed"),
    ],
)
def test_a_branch_s_own_failure_ejects_it_with_its_cause(lane, outcomes, cause, detail):
    lane.change_world(outcomes=outcomes)
    run_steps(lane, 3)
    [ejected] = events(lane, "ejected")
    assert (ejected["branch"], ejected["reason"], ejected["detail"]) == (
        "feat/export-csv",
        cause,
        detail,
    )
    cell = next(c for c in lane.state()["cells"] if c["branch"] == "feat/export-csv")
    assert (cell["state"], cell["ejections"]) == ("ejected", 1)
    record = next(r for r in lane.store.read_records() if r["kind"] == "ejected")
    assert record["cause"] == cause and record["attempt"] == 1
    assert all(entry["branch"] != "feat/export-csv" for entry in lane.state()["queue"])


def test_a_failed_validation_names_its_log(lane):
    lane.change_world(outcomes={"validate": {"feat/export-csv": "fail: FAIL a"}})
    run_steps(lane, 2)
    [ejected] = events(lane, "ejected")
    assert ejected["logPath"] == "attempts/feat-export-csv-1.log"


def test_the_last_allowed_ejection_raises_ejection_limit(lane):
    with lane.store.update("two ejections") as state:
        state["cells"][3]["ejections"] = 2  # feat/export-csv
    lane.change_world(outcomes={"merge": {"feat/export-csv": "conflict: a"}})
    run_steps(lane)
    [limit] = events(lane, "ejection-limit")
    assert limit["branch"] == "feat/export-csv" and "3 ejections" in limit["detail"]


def test_a_pending_check_waits_and_a_merge_made_elsewhere_is_landed_and_flagged(lane):
    lane.change_world(outcomes={"checks": {"feat/export-csv": "pending"}})
    run_steps(lane, 3)
    assert queue(lane)[0] == ("feat/export-csv", "merging")
    lane.change_world(prs={"600": {"state": "MERGED"}})
    actions = run_steps(lane)
    assert "merged feat/export-csv (PR 600)" in actions
    mine = [e for e in events(lane) if e.get("branch") == "feat/export-csv"]
    assert [e["type"] for e in mine] == [
        "merged",
        "merged-without-check",
    ]
    merged = next(r for r in lane.store.read_records() if r["kind"] == "merged")
    assert merged["withoutCheck"] is True


def test_the_lane_s_own_trouble_pauses_it_and_ejects_nothing(lane):
    lane.change_world(outcomes={"fetch": "fail: Could not resolve host: github.com"})
    run_steps(lane)
    [error] = events(lane, "lane-error")
    assert "Could not resolve host" in error["detail"] and "needsOwner" not in error
    state = lane.state()
    assert state["lane"]["paused"] is True and len(state["queue"]) == 2
    assert events(lane, "ejected") == []
    lane.change_world(outcomes={"fetch": "ok"})
    assert run_steps(lane) == []  # Paused: nothing starts until lane-resume.


def test_a_sign_in_failure_needs_the_owner(lane):
    lane.change_world(outcomes={"checks": {"feat/export-csv": "pending"}})
    run_steps(lane, 2)

    class SignedOut:
        def __init__(self, github):
            self.github = github

        def __getattr__(self, name):
            return getattr(self.github, name)

        def pr_state(self, pr):
            from botcore_factory.world import WorldError

            raise WorldError("HTTP 401: authentication required")

    import dataclasses

    factory = lane.factory()
    factory.world = dataclasses.replace(factory.world, github=SignedOut(factory.world.github))
    step(factory)
    [error] = events(lane, "lane-error")
    assert error["needsOwner"] == "sign-in"


def test_held_branches_join_the_queue_when_there_is_room(make_run):
    run = make_run("running", dials={"lane.queueMax": 3})
    with run.store.update("held") as state:
        state["held"].append(
            {
                "branch": "fix/parser-empty-input",
                "head": "a1b2c3d",
                "attempt": 1,
                "holdReason": "queue-full",
            }
        )
    actions = run_steps(run)
    assert "queued fix/parser-empty-input" in actions
    assert run.state()["held"] == [] and queue(run)[-1] == ("fix/parser-empty-input", "queued")
    assert "queued" in kinds(run)


def test_coverage_runs_every_n_merges_and_resets(lane):
    with lane.store.update("every merge") as state:
        state["dials"]["lane.coverageEvery"] = 1
    lane.change_world(outcomes={"validate": {"fix/retry-backoff": "running"}})
    actions = run_steps(lane, 3)  # export-csv merges, and coverage starts on the new main.
    assert actions[-1] == "coverage on main@600"
    assert "coverage passed" in run_steps(lane)
    record = next(r for r in lane.store.read_records() if r["kind"] == "coverage")
    assert (record["main"], record["outcome"], record["after"]) == ("main@600", "passed", [600])
    assert lane.state()["lane"]["mergesSinceCoverage"] == 0


def test_a_gate_merge_owes_coverage_and_a_failure_is_main_broken(lane):
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


def test_queue_empty_is_said_once_and_a_drained_move_happens_then(make_run):
    run = make_run(laneHost="workstation", lane={"draining": True, "drainTo": "mini"})
    run_steps(run)
    [empty] = events(run, "queue-empty")
    assert empty["detail"] == "The lane host moved to mini"
    assert run.world_data()["laneHost"] == "mini"
    lane_state = run.state()["lane"]
    assert lane_state["draining"] is False and lane_state["stopRequested"] == "moved"
    run_steps(run)
    assert len(events(run, "queue-empty")) == 1


def test_a_lost_validation_goes_back_to_the_front(lane):
    run_steps(lane)
    data = lane.world_data()
    data["processes"]["running"].clear()  # The process that ran it is gone.
    lane.world_path.write_text(json.dumps(data))
    actions = run_steps(lane)
    assert actions[0] == "rerun feat/export-csv (restart)"
    assert queue(lane)[0] == ("feat/export-csv", "validating")


def test_the_lane_never_validates_without_a_validate_command(lane, tmp_path):
    bare = tmp_path / "repo"
    (bare / ".github").mkdir(parents=True)
    (bare / ".github/labels.json").write_bytes((lane.target / ".github/labels.json").read_bytes())
    (bare / "botcore.toml").write_text('[plugins.factory]\nlabels = ".github/labels.json"\n')
    step(lane.factory(bare))
    [error] = events(lane, "lane-error")
    assert "validate" in error["detail"]


def test_first_lines_prefer_failures_and_logs_are_named_per_attempt():
    assert first_lines("ok\nok\nFAIL a\nError: b\n") == ["FAIL a", "Error: b"]
    assert first_lines("one\ntwo") == ["one", "two"]
    assert log_path("fix/a b", 2) == "attempts/fix-a-b-2.log"
