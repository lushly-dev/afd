"""Main moving under a validated branch: advance past a move that cannot touch what was validated,
validate again otherwise, and watch main after a merge that was not checked again."""

from __future__ import annotations

import pytest
from test_lane import entry_of, events, kinds, prs, run_steps

from botcore_factory.adapter import check_selected
from botcore_factory.report import lane_report

ADAPTER = {"units": ["units"], "shared_paths": ["pnpm-lock.yaml", ".nvmrc"]}
UNITS = {"packages/a/": ["package:a"], "packages/b/": ["package:b"], "docs/": []}
BRANCH, HEAD = "feat/export-csv", "b2c3d4e+main-0"


@pytest.fixture
def lane(make_run):
    """Two branches queued; feat/export-csv changes package a and waits on its check."""
    run = make_run("running")
    run.change_world(
        units=UNITS,
        outcomes={
            "checks": {BRANCH: "pending"},
            "changed": {BRANCH: ["packages/a/x.ts"]},
            "validate": {"fix/retry-backoff": "running"},
        },
    )
    run_steps(run, 2, **ADAPTER)
    assert entry_of(run, BRANCH)["state"] == "merging"
    return run


def move_main(lane, changes: list[str], **outcomes) -> list[str]:
    """Main moves to main-human, changing ``changes``; the check goes green; one step."""
    lane.change_world(
        main={"head": "main-human", "changes": {"main-human": changes}},
        outcomes={"checks": {BRANCH: "success"}, **outcomes},
    )
    return run_steps(lane, **ADAPTER)


def rerun_detail(lane) -> str:
    reruns = lane.store.read_records()
    [rerun] = [r for r in reruns if r["kind"] == "rerun" and r["reason"] == "main-moved"]
    return rerun["detail"]


def test_a_move_that_touches_none_of_its_units_advances_and_merges(lane):
    actions = move_main(lane, ["packages/b/y.ts", "docs/guide.md"])
    assert "advanced feat/export-csv to main-human" in actions
    assert "merged feat/export-csv (PR 600)" in actions
    assert prs(lane)["600"]["mergedHead"] == HEAD  # No new validation, no new head.
    records = lane.store.read_records()
    [advanced] = [r for r in records if r["kind"] == "base-advanced"]
    assert (advanced["previous"], advanced["base"], advanced["head"]) == (
        "main-0",
        "main-human",
        HEAD,
    )
    [merged] = [r for r in records if r["kind"] == "merged"]
    assert merged["advanced"] is True
    assert "rerun" not in kinds(lane)
    assert [item["pr"] for item in lane.state()["lane"]["uncheckedMerges"]] == [600]
    report = lane_report(lane.factory(), None, None)
    assert (report["baseAdvances"], report["reruns"]) == (1, 0)


def test_a_move_before_the_push_advances_too(make_run):
    run = make_run("running")
    run.change_world(units=UNITS, outcomes={"changed": {BRANCH: ["packages/a/x.ts"]}})
    run_steps(run, **ADAPTER)  # Validating on main-0.
    run.change_world(main={"head": "main-human", "changes": {"main-human": ["docs/a.md"]}})
    actions = run_steps(run, **ADAPTER)
    assert actions[1:3] == [
        "advanced feat/export-csv to main-human",
        f"opened PR 600 for feat/export-csv at {HEAD}",
    ]
    assert entry_of(run, BRANCH)["base"] == "main-human"


def test_a_move_that_touches_one_of_its_units_validates_again(lane):
    actions = move_main(lane, ["packages/a/z.ts"])
    assert "rerun feat/export-csv (main-moved)" in actions
    assert "package:a" in rerun_detail(lane)
    assert "merged" not in kinds(lane) and prs(lane)["600"]["state"] == "OPEN"
    entry = entry_of(lane, BRANCH)
    assert "units" not in entry and "advanced" not in entry  # Cleared with the validation.


@pytest.mark.parametrize("path", ["pnpm-lock.yaml", ".nvmrc", "lefthook.yml"])
def test_a_move_that_changes_a_shared_input_validates_again(make_run, path):
    run = make_run("running")
    run.change_world(units=UNITS, outcomes={"checks": {BRANCH: "pending"}})
    run_steps(run, 2, **ADAPTER, gate_paths=["lefthook.yml"])
    run.change_world(
        main={"head": "main-human", "changes": {"main-human": [path]}},
        outcomes={"checks": {BRANCH: "success"}},
    )
    assert "rerun feat/export-csv (main-moved)" in run_steps(
        run, **ADAPTER, gate_paths=["lefthook.yml"]
    )
    assert f"shared input: {path}" in rerun_detail(run)


def test_a_move_its_head_conflicts_with_validates_again(lane):
    actions = move_main(lane, ["packages/b/y.ts"], mergeTree={HEAD: "conflict: packages/b/y.ts"})
    assert "rerun feat/export-csv (main-moved)" in actions
    assert "conflicts with main-human: packages/b/y.ts" in rerun_detail(lane)


def test_a_move_affecting_every_unit_validates_again(lane):
    lane.change_world(units={"tsconfig.json": ["*"]})
    move_main(lane, ["tsconfig.json"])
    assert "every unit" in rerun_detail(lane)


def test_units_that_cannot_be_read_validate_again(lane):
    lane.change_world(units="fail")
    move_main(lane, ["packages/b/y.ts"])
    assert "units could not be read" in rerun_detail(lane)


def test_without_a_units_command_a_move_validates_again(lane):
    lane.change_world(
        main={"head": "main-human", "changes": {"main-human": ["docs/a.md"]}},
        outcomes={"checks": {BRANCH: "success"}},
    )
    assert "rerun feat/export-csv (main-moved)" in run_steps(lane, units=None)
    assert "no units command" in rerun_detail(lane)


def test_main_red_after_an_unchecked_merge_stops_the_lane(lane):
    move_main(lane, ["packages/b/y.ts"])
    lane.change_world(
        mainChecks={"main@600": {"TypeScript (Node 26.x)": "failure", "deploy": "success"}}
    )
    run_steps(lane, **ADAPTER)
    [broken] = events(lane, "main-broken")
    assert broken["reason"] == "unchecked-merge" and broken["suspects"] == [600]
    assert "TypeScript (Node 26.x) failed on main at main@600" in broken["detail"]
    state = lane.state()["lane"]
    assert state["paused"] is True and "merged without a re-check" in state["pauseReason"]
    assert state["uncheckedMerges"] == []
    assert not any(a.startswith("merged") for a in run_steps(lane, **ADAPTER))


def test_main_green_after_an_unchecked_merge_clears_it_once_settled(lane):
    move_main(lane, ["packages/b/y.ts"])
    lane.change_world(mainChecks={"main@600": {"TypeScript (Node 26.x)": "success"}})
    run_steps(lane, **ADAPTER)
    assert lane.state()["lane"]["uncheckedMerges"]  # Not settled yet: a workflow may be late.
    lane.change_world(now="2030-01-01T00:05:00Z")
    assert "main green after PR 600" in run_steps(lane, **ADAPTER)
    assert lane.state()["lane"]["uncheckedMerges"] == []
    assert not events(lane, "main-broken")


def test_main_checks_the_adapter_excludes_do_not_stop_the_lane(lane):
    move_main(lane, ["packages/b/y.ts"])
    lane.change_world(
        now="2030-01-01T00:05:00Z",
        mainChecks={"main@600": {"Version or Publish": "failure", "CI": "success"}},
    )
    run_steps(lane, **ADAPTER, main_checks=["!Version or Publish"])
    assert not events(lane, "main-broken") and lane.state()["lane"]["uncheckedMerges"] == []


def test_main_checks_that_never_finish_are_the_lane_s_trouble(lane):
    move_main(lane, ["packages/b/y.ts"])
    lane.change_world(now="2030-01-01T05:00:00Z", mainChecks={"main@600": {"CI": "pending"}})
    run_steps(lane, **ADAPTER)
    [error] = events(lane, "lane-error")
    assert "merged without a re-check" in error["detail"] and "PR 600" in error["detail"]


def test_check_selection_includes_and_excludes():
    assert check_selected("anything", [])
    assert check_selected("TypeScript (Node 26.x)", ["TypeScript (Node *)"])
    assert not check_selected("deploy", ["TypeScript (Node *)"])
    assert not check_selected("Version or Publish", ["!Version or Publish"])
    assert check_selected("CI", ["!Version or Publish"])
