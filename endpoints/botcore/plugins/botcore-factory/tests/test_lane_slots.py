"""A validated branch that gives its slot to the front of the queue keeps its validation
(lushly-dev/afd#1452): its checkout moves aside, and the base checks at the front decide whether
it runs again."""

from __future__ import annotations

import pytest
from test_lane import entry_of, kinds, prs, run_steps

FRONT, BEHIND = "feat/export-csv", "fix/retry-backoff"
# A short hash of the branch keeps a/b and a-b apart.
KEPT = "slots/kept-fix-retry-backoff-192b6b0b"
UNITS_CONFIG = {"units": ["units"]}


@pytest.fixture
def released(make_run):
    """The front branch's check is pending while the branch behind it validates; then main
    moves, the front must validate again, and the branch behind gives up the only slot."""
    run = make_run("running")
    run.change_world(outcomes={"checks": {FRONT: "pending"}})
    run_steps(run, 2)
    run.change_world(main={"head": "main-human"}, outcomes={"checks": {FRONT: "success"}})
    actions = run_steps(run)
    assert f"released slot 1 from {BEHIND}; its validation is kept" in actions
    return run


def test_the_branch_behind_keeps_its_validation_and_its_checkout(released):
    entry = entry_of(released, BEHIND)
    assert entry["state"] == "validated" and "slot" not in entry
    assert (entry["base"], entry["validatedHead"], entry["path"]) == (
        "main-0",
        "c3d4e5f+main-0",
        KEPT,
    )
    checkouts = released.world_data()["checkouts"]
    assert checkouts[KEPT.removeprefix("slots/")]["head"] == "c3d4e5f+main-0"
    assert checkouts["1"]["branch"] == FRONT  # The slot went to the front.
    [record] = [r for r in released.store.read_records() if r["kind"] == "slot-released"]
    assert (record["branch"], record["slot"], record["path"]) == (BEHIND, "1", KEPT)
    assert released.state()["lane"]["keptCheckouts"] == [KEPT]
    reruns = [
        (r["branch"], r["reason"]) for r in released.store.read_records() if r["kind"] == "rerun"
    ]
    assert reruns == [(FRONT, "main-moved")]  # Only the front validates again.


def test_it_is_pushed_from_its_kept_checkout_when_main_s_move_cannot_touch_it(released):
    released.change_world(
        units={"packages/a/": ["package:a"], "packages/b/": ["package:b"]},
        main={"changes": {"main@600": ["packages/a/x.ts"], "c3d4e5f+main-0": ["packages/b/y.ts"]}},
    )
    actions = run_steps(released, 4, **UNITS_CONFIG)
    assert "merged feat/export-csv (PR 600)" in actions
    assert f"advanced {BEHIND} to main@600" in actions
    assert f"opened PR 601 for {BEHIND} at c3d4e5f+main-0" in actions
    assert prs(released)["601"]["head"] == "c3d4e5f+main-0"  # The validation it kept.
    assert [r["branch"] for r in released.store.read_records() if r["kind"] == "validated"] == [
        FRONT,
        BEHIND,
        FRONT,
    ]
    # Pushed, it no longer needs the checkout.
    assert released.world_data()["removedCheckouts"] == [KEPT]
    assert released.state()["lane"]["keptCheckouts"] == []


def test_it_validates_again_when_main_s_move_needs_it_and_its_checkout_is_removed(released):
    actions = run_steps(released, 3)  # No units command: a moved main validates again.
    assert "merged feat/export-csv (PR 600)" in actions
    assert f"rerun {BEHIND} (main-moved)" in actions
    assert f"validating {BEHIND} in slot 1" in actions
    assert released.world_data()["removedCheckouts"] == [KEPT]


def test_a_checkout_that_cannot_move_gives_its_validation_up_as_before(make_run):
    run = make_run("running")
    run.change_world(outcomes={"checks": {FRONT: "pending"}, "park": "fail: busy"})
    run_steps(run, 2)
    run.change_world(main={"head": "main-human"}, outcomes={"checks": {FRONT: "success"}})
    actions = run_steps(run)
    assert f"rerun {BEHIND} (slot-needed)" in actions
    [rerun] = [r for r in run.store.read_records() if r.get("reason") == "slot-needed"]
    assert rerun["detail"] == "its checkout stayed: busy"
    assert entry_of(run, BEHIND)["state"] == "queued"
    assert "slot-released" not in kinds(run)


def test_a_kept_checkout_that_cannot_be_removed_is_tried_again(released):
    released.change_world(outcomes={"remove": "fail: in use"})
    actions = run_steps(released, 3)
    assert f"kept checkout {KEPT} not removed yet: in use" in actions
    assert released.state()["lane"]["keptCheckouts"] == [KEPT]
    released.change_world(outcomes={"remove": "ok"})
    run_steps(released)
    assert released.state()["lane"]["keptCheckouts"] == []


def test_parking_a_validated_slot_cleans_slot_clean_paths_and_keeps_validation(make_run):
    """lushly-dev/afd#1659: parking moves the slot checkout to kept-*, so configured in-slot
    build output is cleaned before parking while the validation record survives."""
    rel = "foundations/specimen/host/target"
    run = make_run("running")
    run.change_world(outcomes={"checks": {FRONT: "pending"}})
    run_steps(run, 2, slot_clean_paths=[rel])
    # Simulate build output created inside slot 1 while BEHIND validated.
    run.change_world(
        main={"head": "main-human"},
        outcomes={"checks": {FRONT: "success"}},
        slotOutputs={"1": [rel]},
    )
    actions = run_steps(run, slot_clean_paths=[rel])
    assert f"released slot 1 from {BEHIND}; its validation is kept" in actions
    assert entry_of(run, BEHIND)["state"] == "validated"
    assert entry_of(run, BEHIND)["path"] == KEPT
    assert run.world_data()["slotOutputs"]["1"] == []
    assert {"slot": "1", "path": rel} in run.world_data()["cleanedSlotPaths"]
