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
        main={"changes": {HEAD: ["packages/a/x.ts"]}},  # The branch's own changes.
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


def test_units_are_read_in_a_clean_slot_at_the_new_base(lane):
    """lushly-dev/afd#1354: not in the lane host's own checkout, which may be dirty or behind."""
    move_main(lane, ["packages/b/y.ts"])
    slots = lane.world_data()["checkouts"]
    assert slots["units"] == {"branch": "", "head": "main-human"}


def test_a_units_slot_that_cannot_be_prepared_validates_again(lane):
    move_main(lane, ["packages/b/y.ts"], prepare="fail: disk full")
    assert "units could not be read: disk full" in rerun_detail(lane)


def test_a_move_before_the_push_advances_too(make_run):
    run = make_run("running")
    run.change_world(units=UNITS, main={"changes": {HEAD: ["packages/a/x.ts"]}})
    run_steps(run, **ADAPTER)  # Validating on main-0.
    run.change_world(main={"head": "main-human", "changes": {"main-human": ["docs/a.md"]}})
    actions = run_steps(run, **ADAPTER)
    assert actions[1:3] == [
        "advanced feat/export-csv to main-human",
        f"opened PR 600 for feat/export-csv at {HEAD}",
    ]
    assert entry_of(run, BRANCH)["base"] == "main-human"
    body = prs(run)["600"]["body"]
    assert "(base main-0," in body and "Advanced to base main-human" in body


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


def test_main_checks_that_never_finish_are_given_up_once_as_the_lane_s_trouble(lane):
    move_main(lane, ["packages/b/y.ts"])
    lane.change_world(now="2030-01-01T05:00:00Z", mainChecks={"main@600": {"CI": "pending"}})
    run_steps(lane, **ADAPTER)
    [error] = events(lane, "lane-error")
    assert "merged without a re-check" in error["detail"] and "PR 600" in error["detail"]
    assert lane.state()["lane"]["uncheckedMerges"] == []  # Never a watch that wedges the lane.


def test_a_paused_lane_raises_no_trouble_of_its_own_but_still_sees_main_red(lane):
    move_main(lane, ["packages/b/y.ts"])
    with lane.store.update("pause") as state:
        state["lane"]["paused"] = True
    lane.change_world(outcomes={"mainChecks": "fail: HTTP 502"})
    run_steps(lane, 3, **ADAPTER)
    assert not events(lane, "lane-error")
    lane.change_world(outcomes={"mainChecks": "ok"}, mainChecks={"main@600": {"CI": "failure"}})
    run_steps(lane, **ADAPTER)
    assert [e["suspects"] for e in events(lane, "main-broken")] == [[600]]


def test_a_branch_that_renames_a_file_out_of_a_unit_keeps_that_unit(lane):
    lane.change_world(main={"changes": {HEAD: ["packages/a/old.ts", "packages/b/new.ts"]}})
    move_main(lane, ["packages/a/caller.ts"])
    assert "package:a" in rerun_detail(lane)


def test_a_branch_advances_twice_with_its_units_read_once(make_run):
    run = make_run("running")
    run.change_world(
        units=UNITS,
        main={"changes": {HEAD: ["packages/a/x.ts"]}},
        outcomes={"checks": {BRANCH: "pending"}, "validate": {"fix/retry-backoff": "running"}},
    )
    run_steps(run, **ADAPTER)  # Validating on main-0.
    run.change_world(main={"head": "main-human", "changes": {"main-human": ["docs/a.md"]}})
    assert "advanced feat/export-csv to main-human" in run_steps(run, **ADAPTER)  # Pushed.
    run.change_world(
        main={"head": "main-two", "changes": {"main-two": ["packages/b/y.ts"]}},
        units={"packages/a/": ["package:b"]},  # Read again, the branch would now overlap.
        outcomes={"checks": {BRANCH: "success"}},
    )
    assert "merged feat/export-csv (PR 600)" in run_steps(run, **ADAPTER)
    advanced = [r for r in run.store.read_records() if r["kind"] == "base-advanced"]
    assert [(r["previous"], r["base"]) for r in advanced] == [
        ("main-0", "main-human"),
        ("main-human", "main-two"),
    ]


def test_a_merge_refused_after_main_moved_advances_then_merges_next_step(lane):
    lane.change_world(outcomes={"checks": {BRANCH: "success"}})

    from dataclasses import replace

    from botcore_factory.lane import step
    from botcore_factory.world import WorldError

    factory = lane.factory()
    factory.config = factory.config.model_copy(update=ADAPTER)
    github = factory.world.github

    class RacingGitHub:
        def __getattr__(self, name):
            return getattr(github, name)

        def merge_pr(self, pr, head):
            lane.change_world(main={"head": "main-race", "changes": {"main-race": ["docs/r.md"]}})
            raise WorldError("Pull request is not mergeable: the base branch was modified")

    git = factory.world.git

    class FreshGit:
        def __getattr__(self, name):
            return getattr(git, name)

        def fetch_base(self, base):
            return lane.factory().world.git.fetch_base(base)

        def diff_names(self, old, new):
            return lane.factory().world.git.diff_names(old, new)

    factory.world = replace(factory.world, github=RacingGitHub(), git=FreshGit())
    assert "advanced feat/export-csv to main-race" in step(factory)
    assert entry_of(lane, BRANCH)["state"] == "merging"
    assert "merged feat/export-csv (PR 600)" in run_steps(lane, **ADAPTER)


def test_check_selection_includes_and_excludes():
    assert check_selected("anything", [])
    assert check_selected("TypeScript (Node 26.x)", ["TypeScript (Node *)"])
    assert not check_selected("deploy", ["TypeScript (Node *)"])
    assert not check_selected("Version or Publish", ["!Version or Publish"])
    assert check_selected("CI", ["!Version or Publish"])


# A branch that affects every unit (a lockfile change) overlaps every move of main (#1369).
STARVING = {**UNITS, "pnpm-lock.yaml": ["*"]}
GUARDED = {**ADAPTER, "gate_paths": ["lefthook.yml"]}


def validated_on(base: str) -> str:
    return f"b2c3d4e+{base}"


def move_to(run, n: int, changes: list[str], **outcomes) -> list[str]:
    """Main moves to main-``n`` changing ``changes``, the branch changes the lockfile; one step."""
    run.change_world(
        main={
            "head": f"main-{n}",
            "changes": {f"main-{n}": changes, validated_on(f"main-{n - 1}"): ["pnpm-lock.yaml"]},
        },
        outcomes=outcomes,
    )
    return run_steps(run, **GUARDED)


@pytest.fixture
def starving(make_run):
    """feat/export-csv changes the lockfile; main moved under two validations that passed."""
    run = make_run("running")
    run.change_world(
        units=STARVING,
        outcomes={"checks": {BRANCH: "pending"}, "validate": {"fix/retry-backoff": "running"}},
    )
    run_steps(run, **GUARDED)  # Validating on main-0.
    for n in (1, 2):
        assert "rerun feat/export-csv (main-moved)" in move_to(run, n, ["packages/b/y.ts"])
    assert entry_of(run, BRANCH)["baseReruns"] == 2
    return run


def test_after_the_rerun_limit_the_required_check_stands_in(starving):
    actions = move_to(starving, 3, ["packages/b/y.ts"])
    assert "advanced feat/export-csv to main-3 (2 reruns; its required check stands in)" in actions
    assert f"opened PR 600 for feat/export-csv at {validated_on('main-2')}" in actions
    body = prs(starving)["600"]["body"]
    assert "Main moved under it 2 times" in body and "`ci-ok` on this pull request" in body
    records = starving.store.read_records()
    [advanced] = [r for r in records if r["kind"] == "base-advanced"]
    assert (advanced["reason"], advanced["previous"], advanced["base"]) == (
        "rerun-limit",
        "main-2",
        "main-3",
    )
    assert advanced["detail"] == "a change affects every unit"
    starving.change_world(outcomes={"checks": {BRANCH: "success"}})
    assert "merged feat/export-csv (PR 600)" in run_steps(starving, **GUARDED)
    assert prs(starving)["600"]["mergedHead"] == validated_on("main-2")  # Bound to that head.
    [merged] = [r for r in starving.store.read_records() if r["kind"] == "merged"]
    assert merged["advanced"] is True and merged["checkStoodIn"] is True
    assert [item["pr"] for item in starving.state()["lane"]["uncheckedMerges"]] == [600]
    report = lane_report(starving.factory(), None, None)
    assert (report["reruns"], report["baseAdvances"], report["rerunLimitAdvances"]) == (2, 1, 1)


def test_a_move_while_its_check_runs_past_the_limit_still_merges_and_is_watched(starving):
    move_to(starving, 3, ["packages/b/y.ts"])  # Pushed; the check is pending.
    starving.change_world(
        main={"head": "main-4", "changes": {"main-4": ["packages/a/z.ts"]}},
        outcomes={"checks": {BRANCH: "success"}},
    )
    actions = run_steps(starving, **GUARDED)
    assert "advanced feat/export-csv to main-4 (2 reruns; its required check stands in)" in actions
    assert "merged feat/export-csv (PR 600)" in actions
    records = starving.store.read_records()
    late = [r for r in records if r["kind"] == "base-advanced"][-1]
    assert (late["base"], late["checkBase"]) == ("main-4", "main-3")  # Its check ran on main-3.
    [merged] = [r for r in records if r["kind"] == "merged"]
    assert (merged["checkBase"], merged["base"]) == ("main-3", "main-4")
    starving.change_world(mainChecks={"main@600": {"CI": "failure"}})
    run_steps(starving, **GUARDED)
    [broken] = events(starving, "main-broken")
    assert broken["suspects"] == [600] and starving.state()["lane"]["paused"] is True


def test_past_the_limit_a_move_touching_a_gate_path_validates_again(starving):
    assert "rerun feat/export-csv (main-moved)" in move_to(starving, 3, ["lefthook.yml"])
    assert "base-advanced" not in kinds(starving)
    assert entry_of(starving, BRANCH)["baseReruns"] == 3


def test_past_the_limit_a_conflict_validates_again(starving):
    actions = move_to(
        starving,
        3,
        ["packages/b/y.ts"],
        mergeTree={validated_on("main-2"): "conflict: pnpm-lock.yaml"},
    )
    assert "rerun feat/export-csv (main-moved)" in actions
    assert "base-advanced" not in kinds(starving)


def test_the_rerun_limit_is_a_dial(starving):
    with starving.store.update("dial") as state:
        state["dials"]["lane.maxBaseReruns"] = 3
    assert "rerun feat/export-csv (main-moved)" in move_to(starving, 3, ["packages/b/y.ts"])
    assert "advanced feat/export-csv to main-4 (3 reruns; its required check stands in)" in (
        move_to(starving, 4, ["packages/b/y.ts"])
    )


@pytest.mark.parametrize(
    "outcomes",
    [{"mergeTree": {validated_on("main-2"): "conflict: pnpm-lock.yaml"}}, {}],
    ids=["conflict", "gate-path"],
)
def test_past_the_limit_a_move_while_its_check_runs_is_refused_as_before(starving, outcomes):
    move_to(starving, 3, ["packages/b/y.ts"])  # Pushed; the check is pending.
    changes = ["packages/b/y.ts"] if outcomes else ["lefthook.yml"]
    starving.change_world(
        main={"head": "main-4", "changes": {"main-4": changes}},
        outcomes={"checks": {BRANCH: "success"}, **outcomes},
    )
    assert "rerun feat/export-csv (main-moved)" in run_steps(starving, **GUARDED)
    assert "merged" not in kinds(starving) and prs(starving)["600"]["state"] == "OPEN"


def test_past_the_limit_changes_that_cannot_be_read_validate_again(starving):
    actions = move_to(starving, 3, ["packages/b/y.ts"], diff="fail: git diff failed")
    assert "rerun feat/export-csv (main-moved)" in actions
    assert "base-advanced" not in kinds(starving)


def test_past_the_limit_an_unrelated_move_is_an_ordinary_advance(starving):
    starving.change_world(units={**UNITS, "pnpm-lock.yaml": ["package:a"]})
    actions = move_to(starving, 3, ["packages/b/y.ts"])
    assert "advanced feat/export-csv to main-3" in actions
    [advanced] = [r for r in starving.store.read_records() if r["kind"] == "base-advanced"]
    assert "reason" not in advanced and "checkStandsIn" not in entry_of(starving, BRANCH)
