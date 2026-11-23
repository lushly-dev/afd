"""The lane behind a merge queue: asking GitHub to merge is not the merge.

The fixture world can be told to have a queue (``mergeQueue.required``): a merge request then
queues the pull request, which stays open until the fixture says what the queue did with it
(``mergeQueue.outcomes``). Every test here first reads what the lane did without being told
anything about a queue: it finds one only in GitHub's answer.
"""

from __future__ import annotations

import json
import os
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

import pytest
from test_lane import entry_of, events, kinds, prs, queue, run_steps
from test_real_world import FakeRun

from botcore_factory.claims import format_time, parse_time
from botcore_factory.lane import step
from botcore_factory.lane_process import resume
from botcore_factory.real_world import CliGit, GhGitHub, make_runner
from botcore_factory.world import MergeProgress, WorldError

BRANCH, BEHIND = "feat/export-csv", "fix/retry-backoff"
GROUP = "group@600"


@pytest.fixture
def lane(make_run):
    """The running fixture, its base behind a merge queue: two branches queued, one slot."""
    run = make_run("running")
    run.change_world(mergeQueue={"required": True})
    return run


def queued(lane) -> dict:
    """Step until the first branch's pull request is in GitHub's queue; its entry."""
    run_steps(lane, 3)
    entry = entry_of(lane, BRANCH)
    assert entry["state"] == "merge-queued"
    return entry


def advance(lane, minutes: int) -> None:
    """Move the world's clock on from where it is."""
    now = parse_time(lane.world_data().get("now") or "2030-01-01T00:00:00Z")
    lane.change_world(now=format_time(now + timedelta(minutes=minutes)))


def settle(lane, outcome: str) -> list[str]:
    """Tell the queue what became of the branch and step until the lane has acted on it: a
    pull request that left the queue is read again two minutes on before it is ejected."""
    lane.change_world(mergeQueue={"outcomes": {BRANCH: outcome}})
    actions = run_steps(lane)
    if outcome.startswith("remove"):
        assert actions == [] and not events(lane, "ejected")  # One read decides nothing.
        advance(lane, 2)
        actions = run_steps(lane)
    return actions


def unchecked(lane) -> list[dict]:
    """This branch's ``merged-without-check`` events (the fixture holds an older one)."""
    return [e for e in events(lane, "merged-without-check") if e.get("branch") == BRANCH]


def queue_states(lane) -> dict:
    return dict(queue(lane))


def rewrite_pr(lane, number: str, **fields) -> None:
    """Set a pull request's fields in the world as given; None removes one."""
    data = lane.world_data()
    for key, value in fields.items():
        if value is None:
            data["prs"][number].pop(key, None)
        else:
            data["prs"][number][key] = value
    lane.world_path.write_text(json.dumps(data), encoding="utf-8")


def later(lane, minutes: int) -> None:
    lane.change_world(now=f"2030-01-01T{minutes // 60:02d}:{minutes % 60:02d}:00Z")


# No queue: what GitHub answers is a merge, and nothing changed.


def test_without_a_queue_the_merge_lands_at_once_as_before(make_run):
    lane = make_run("running")
    actions = run_steps(lane, 3)
    assert "merged feat/export-csv (PR 600)" in actions
    assert not any("waits in" in action for action in actions)
    merged = next(r for r in lane.store.read_records() if r["kind"] == "merged")
    assert "mergeQueue" not in merged and "queueMinutes" not in merged
    assert [e["detail"] for e in events(lane, "merged")] == ["PR 600"]
    assert prs(lane)["600"]["mergeCommit"] == "main@600"


# Queued, then merged.


def test_a_queued_pull_request_is_not_landed_until_github_says_it_merged(lane):
    actions = run_steps(lane, 3)
    assert "merge of feat/export-csv (PR 600) waits in the merge queue" in actions
    entry = entry_of(lane, BRANCH)
    assert entry["state"] == "merge-queued"
    assert entry["mergeQueue"] == {
        "since": "2030-01-01T00:00:00Z",
        "queuedAt": "2030-01-01T00:00:00Z",
        "removedBefore": "",
        "queue": True,
        "seen": True,
        "state": "QUEUED",
        "position": 1,
        "groupHead": GROUP,
    }
    # Nothing landed: no record, no event, the cell still seated, the queue ref still there.
    assert prs(lane)["600"]["state"] == "OPEN"
    assert "merged" not in kinds(lane) and not events(lane, "merged")
    assert any(cell["branch"] == BRANCH for cell in lane.state()["cells"])
    assert lane.state()["lane"].get("mergedSinceCoverage", []) == []


def test_lane_status_shows_the_queued_state(lane):
    from botcore_factory.status import lane_status

    queued(lane)
    shown = lane_status(lane.factory(), None, None)["queue"][0]
    assert (shown["branch"], shown["state"]) == (BRANCH, "merge-queued")
    assert shown["mergeQueue"]["state"] == "QUEUED"
    assert shown["mergeQueue"]["groupHead"] == GROUP


def test_behind_a_queue_the_lane_enqueues_at_the_head_and_never_asks_gh_to_merge(lane):
    """``gh pr merge`` there sets auto-merge when a check has not finished; the mutation is
    bound to the head and sets none."""
    run_steps(lane, 2)
    factory = lane.factory()
    github = factory.world.github
    asked = []

    class Watching:
        def __getattr__(self, name):
            return getattr(github, name)

        def merge_pr(self, pr, head):
            raise AssertionError("gh pr merge behind a merge queue")

        def enqueue_pr(self, pr, head):
            asked.append((pr, head))
            github.enqueue_pr(pr, head)

    factory.world = replace(factory.world, github=Watching())
    step(factory)
    assert asked == [(600, "b2c3d4e+main-0")]
    assert entry_of(lane, BRANCH)["state"] == "merge-queued"
    assert not prs(lane)["600"].get("autoMerge")


def test_a_head_that_moved_is_refused_by_the_queue_and_ejected(lane):
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}})
    run_steps(lane, 2)
    lane.change_world(outcomes={"checksByHead": {"b2c3d4e+main-0": "success"}})
    rewrite_pr(lane, "600", head="someone-pushed")
    run_steps(lane)
    ejected = events(lane, "ejected")[0]
    assert ejected["reason"] == "merge-failed"
    assert "expected head oid does not match" in ejected["detail"]
    assert "queue" not in prs(lane)["600"]


async def test_a_queued_branch_is_locked_nothing_is_pushed_or_enqueued(lane):
    queued(lane)
    git = lane.factory().world.git
    with pytest.raises(WorldError, match="protected branch hook declined"):
        git.push_head(git.prepare_slot("9", BRANCH, "b2c3d4e"), BRANCH, "b2c3d4e", None)
    before = lane.snapshot()
    refused = await lane.call("lane_enqueue", worktree="wt/export-csv")
    assert refused.error.code == "MERGE_QUEUED" and "locks the branch" in refused.error.message
    assert lane.snapshot() == before


def test_nothing_behind_a_queued_merge_is_pushed_or_merged(lane):
    queued(lane)
    actions = run_steps(lane, 4)
    assert not any(action.startswith(("opened PR", "merged")) for action in actions)
    assert queue(lane) == [(BRANCH, "merge-queued"), (BEHIND, "validated")]
    assert BEHIND not in lane.world_data()["pushed"]


def test_main_moving_under_a_queued_merge_validates_nothing_again(lane):
    """GitHub's queue rebuilds its commit on the new base and checks what lands."""
    queued(lane)
    lane.change_world(main={"head": "main-human"})
    actions = run_steps(lane, 2)
    assert not any(action.startswith("rerun") for action in actions)
    assert entry_of(lane, BRANCH)["state"] == "merge-queued"
    assert "rerun" not in kinds(lane) and "base-advanced" not in kinds(lane)


def test_a_queued_pull_request_lands_when_the_queue_merges_it(lane):
    queued(lane)
    later(lane, 6)
    actions = settle(lane, "merge")
    assert "merged feat/export-csv (PR 600), through the merge queue" in actions
    merged = next(r for r in lane.store.read_records() if r["kind"] == "merged")
    assert (merged["pr"], merged["mergeQueue"], merged["queueMinutes"]) == (600, True, 6.0)
    assert [e["detail"] for e in events(lane, "merged")] == ["PR 600, through the merge queue"]
    state = lane.state()
    assert all(cell["branch"] != BRANCH for cell in state["cells"])
    assert state["lane"]["mergedSinceCoverage"] == [600]
    assert state["runs"][0]["prs"][-1]["number"] == 600
    # The queue's commit is main's head, so the branch behind follows that base.
    assert prs(lane)["600"]["mergeCommit"] == GROUP
    run_steps(lane, 6)
    behind = next(r for r in lane.store.read_records()[::-1] if r["kind"] == "validation-started")
    assert (behind["branch"], behind["base"]) == (BEHIND, GROUP)


def test_a_merged_event_in_the_queue_s_timeline_is_not_a_removal(lane):
    """GitHub logs "removed from the merge queue, reason merged" for a merge too: a read
    that shows it before the pull request reads as merged waits, and ejects nothing."""
    queued(lane)
    rewrite_pr(lane, "600", queue=None, removedAt="2030-01-01T00:03:00Z", removalReason="merged")
    assert run_steps(lane) == []
    advance(lane, 2)  # Longer than any other removal is given.
    assert run_steps(lane) == []
    assert entry_of(lane, BRANCH)["state"] == "merge-queued" and not events(lane, "ejected")
    rewrite_pr(lane, "600", state="MERGED", mergeCommit=GROUP)
    assert "merged feat/export-csv (PR 600), through the merge queue" in run_steps(lane)


def test_a_pull_request_github_says_it_merged_is_never_ejected_however_long_it_reads_open(lane):
    queued(lane)
    rewrite_pr(lane, "600", queue=None, removedAt="2030-01-01T00:03:00Z", removalReason="merged")
    run_steps(lane)
    advance(lane, 6)
    run_steps(lane)
    assert not events(lane, "ejected") and "merged" not in kinds(lane)
    assert events(lane, "lane-error")[0]["detail"] == (
        "GitHub says the merge queue merged PR 600, but it has read as open for 5 minutes "
        "since; nothing was landed or ejected: read the pull request on GitHub, then lane-resume"
    )
    assert entry_of(lane, BRANCH)["state"] == "merge-queued"
    with lane.store.update("resume") as state:
        state["lane"]["paused"] = False
    rewrite_pr(lane, "600", state="MERGED", mergeCommit=GROUP)
    assert "merged feat/export-csv (PR 600), through the merge queue" in run_steps(lane)


def test_a_queued_head_the_lane_did_not_validate_is_not_adopted(lane):
    """The entry says ``merging`` and GitHub shows the pull request queued at another head:
    someone pushed and queued it. The lane pauses; it lands nothing it did not validate."""
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}})
    run_steps(lane, 2)
    rewrite_pr(
        lane,
        "600",
        head="someone-pushed",
        queue={"state": "QUEUED", "position": 1, "groupHead": GROUP},
    )
    run_steps(lane)
    assert entry_of(lane, BRANCH)["state"] == "merging"
    assert events(lane, "lane-error")[0]["detail"] == (
        "PR 600 is in the merge queue at someone-pushed, not at b2c3d4e+main-0, the head the "
        "lane validated: take it out of the queue on GitHub, then lane-resume"
    )
    assert "merged" not in kinds(lane) and not events(lane, "ejected")


def test_a_queued_pull_request_is_adopted_before_its_head_s_check_is_read(lane):
    """Ejecting a pull request that is in GitHub's queue would forget one about to merge."""
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}})
    run_steps(lane, 2)
    rewrite_pr(lane, "600", queue={"state": "QUEUED", "position": 1, "groupHead": GROUP})
    lane.change_world(outcomes={"checks": {BRANCH: "failure"}})
    run_steps(lane)
    assert entry_of(lane, BRANCH)["state"] == "merge-queued" and not events(lane, "ejected")


def test_a_merge_at_a_head_the_lane_did_not_validate_is_recorded_as_such(lane):
    """A person pushed and the queue merged that head between two steps: the validated head's
    check is green, and what merged was never validated."""
    queued(lane)
    rewrite_pr(lane, "600", state="MERGED", queue=None, head="someone-pushed", mergeCommit=GROUP)
    run_steps(lane)
    merged = next(r for r in lane.store.read_records() if r["kind"] == "merged")
    assert (merged["withoutCheck"], merged["headMoved"], merged["mergedHead"]) == (
        True,
        True,
        "someone-pushed",
    )
    assert [e["detail"] for e in unchecked(lane)] == [
        "PR 600 merged at someone-pushed, not at b2c3d4e+main-0, the head the lane validated"
    ]


def test_a_merge_at_the_validated_head_says_nothing_of_a_moved_head(lane):
    queued(lane)
    settle(lane, "merge")
    merged = next(r for r in lane.store.read_records() if r["kind"] == "merged")
    assert merged["withoutCheck"] is False and "headMoved" not in merged
    assert not unchecked(lane)


def test_a_restart_finds_a_merge_at_another_head(lane):
    queued(lane)
    rewrite_pr(lane, "600", state="MERGED", queue=None, head="someone-pushed", mergeCommit=GROUP)
    resume(lane.factory())
    merged = next(r for r in lane.store.read_records() if r["kind"] == "merged")
    assert merged["headMoved"] is True and unchecked(lane)


def test_an_open_pull_request_the_queue_says_it_merged_is_waited_for_not_asked_again(lane):
    """The entry still says ``merging`` (the lane stopped before recording its request) and
    the queue has just merged the pull request: open for another second, its check green, main
    already moved by its own squash. Asking again would validate it again and never record
    the merge."""
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}})
    run_steps(lane, 2)
    assert entry_of(lane, BRANCH)["state"] == "merging"
    lane.change_world(outcomes={"checks": {BRANCH: "success"}}, main={"head": GROUP})
    rewrite_pr(lane, "600", removedAt="2030-01-01T00:03:00Z", removalReason="merged")
    factory = lane.factory()
    github = factory.world.github

    class NeverAsked:
        def __getattr__(self, name):
            return getattr(github, name)

        def merge_pr(self, pr, head):
            raise AssertionError("asked again for a pull request the queue merged")

        enqueue_pr = merge_pr

    factory.world = replace(factory.world, github=NeverAsked())
    actions = step(factory)
    assert not any(action.startswith("rerun") for action in actions)
    assert entry_of(lane, BRANCH)["state"] == "merge-queued" and "rerun" not in kinds(lane)
    rewrite_pr(lane, "600", state="MERGED", mergeCommit=GROUP)
    assert "merged feat/export-csv (PR 600), through the merge queue" in run_steps(lane)
    assert kinds(lane).count("merged") == 1


# Queued, then removed.


def test_a_check_that_failed_on_the_queue_s_commit_ejects_as_a_failed_check(lane):
    queued(lane)
    lane.change_world(outcomes={"checksByHead": {GROUP: "failure"}})
    actions = settle(lane, "remove: CI failure")
    assert "ejected feat/export-csv (ci-failed)" in actions
    ejected = events(lane, "ejected")[0]
    assert ejected["reason"] == "ci-failed" and "excused" not in ejected
    assert ejected["detail"] == (
        "ci-ok failed on group@600, the commit the merge queue built for PR 600 (CI failure)"
    )
    cell = next(cell for cell in lane.state()["cells"] if cell["branch"] == BRANCH)
    assert (cell["state"], cell["ejections"], cell.get("excused")) == ("ejected", 1, 0)
    record = next(r for r in lane.store.read_records() if r["kind"] == "ejected")
    assert (record["cause"], record["counted"]) == ("ci-failed", True)
    assert prs(lane)["600"]["state"] == "OPEN" and "merged" not in kinds(lane)
    assert queue(lane)[0][0] == BEHIND  # The branch behind is at the front now.


def test_github_s_failed_checks_is_a_failed_check_even_without_the_check_s_state(lane):
    queued(lane)
    settle(lane, "remove: failed_checks")
    ejected = events(lane, "ejected")[0]
    assert ejected["reason"] == "ci-failed"
    assert ejected["detail"] == (
        "A check failed on group@600, the commit the merge queue built for PR 600"
    )


def test_the_removal_s_own_commit_is_read_before_the_entry_s_head(lane):
    """The removal names the commit the queue had built, and its message is the squash GitHub
    wrote; what the queue entry called its head while queued is only the fallback."""
    queued(lane)
    with lane.store.update("another commit as the entry's head") as state:
        state["queue"][0]["mergeQueue"]["groupHead"] = "entry-head"
    lane.change_world(
        commitMessages={GROUP: "t (#600)\n\n---------\n\nCo-authored-by: Two <two@example.org>"}
    )
    settle(lane, "remove: failed_checks")
    detail = events(lane, "ejected")[0]["detail"]
    assert detail.startswith("A check failed on group@600, the commit the merge queue built")
    assert "`Co-authored-by: Two <two@example.org>`" in detail


def test_a_pull_request_that_is_queued_again_is_not_ejected(lane):
    """Out of the queue on one read and back in on the next: the wait goes on."""
    queued(lane)
    entry = {"state": "QUEUED", "position": 1, "groupHead": GROUP}
    rewrite_pr(lane, "600", queue=None)
    assert run_steps(lane) == []
    rewrite_pr(lane, "600", queue=entry)
    advance(lane, 2)
    assert run_steps(lane) == [] and "leftAt" not in entry_of(lane, BRANCH)["mergeQueue"]
    assert not events(lane, "ejected")


def test_a_co_author_in_the_queue_s_squash_is_named_and_counts(lane):
    """The queue writes the squash itself; a base that refuses co-authors fails the group for
    that line alone. The lane says so, and the ejection counts, so it cannot loop."""
    queued(lane)
    message = "feat: export (#600)\n\n* feat: export\n\nCo-authored-by: Some One <one@example.org>"
    lane.change_world(
        outcomes={"checksByHead": {GROUP: "failure"}}, commitMessages={GROUP: message}
    )
    settle(lane, "remove")
    ejected = events(lane, "ejected")[0]
    assert ejected["reason"] == "ci-failed"
    assert "`Co-authored-by: Some One <one@example.org>`" in ejected["detail"]
    assert "author every commit of the branch as the pull request's author" in ejected["detail"]
    with lane.store.update("near the limit") as state:
        next(c for c in state["cells"] if c["branch"] == BRANCH).update(ejections=3, excused=1)
    assert not events(lane, "ejection-limit")


def test_three_failures_in_the_queue_reach_the_ejection_limit(lane):
    queued(lane)
    with lane.store.update("two before") as state:
        next(c for c in state["cells"] if c["branch"] == BRANCH).update(ejections=2, excused=0)
    lane.change_world(outcomes={"checksByHead": {GROUP: "failure"}})
    settle(lane, "remove")
    assert [e["branch"] for e in events(lane, "ejection-limit")] == [BRANCH]


def test_leaving_the_queue_for_another_reason_is_a_refused_merge_and_does_not_count(lane):
    queued(lane)
    settle(lane, "remove: merge conflict")
    ejected = events(lane, "ejected")[0]
    assert ejected["reason"] == "merge-failed"
    assert ejected["detail"] == "PR 600 left the merge queue unmerged: merge conflict"
    assert ejected["excused"] == "GitHub refused the merge"
    record = next(r for r in lane.store.read_records() if r["kind"] == "ejected")
    assert record["counted"] is False


def test_leaving_the_queue_with_no_reason_says_so(lane):
    queued(lane)
    settle(lane, "remove")
    assert events(lane, "ejected")[0]["detail"] == (
        "PR 600 left the merge queue unmerged; GitHub gave no reason"
    )


def test_a_pull_request_closed_in_the_queue_is_ejected_as_closed(lane):
    queued(lane)
    rewrite_pr(lane, "600", state="CLOSED", queue=None)
    run_steps(lane)  # Closed is final: no second read is waited for.
    assert events(lane, "ejected")[0]["reason"] == "pr-closed"


def test_an_unreadable_queue_commit_pauses_and_ejects_nothing(lane):
    queued(lane)
    lane.change_world(mergeQueue={"outcomes": {BRANCH: "remove"}})
    assert run_steps(lane) == []
    advance(lane, 2)
    factory = lane.factory()
    github = factory.world.github

    class NoCommit:
        def __getattr__(self, name):
            return getattr(github, name)

        def check_status(self, pr, name, head):
            raise WorldError("HTTP 502")

    factory.world = replace(factory.world, github=NoCommit())
    step(factory)
    assert not events(lane, "ejected")
    assert "Reading the merge queue's commit group@600" in events(lane, "lane-error")[0]["detail"]
    assert entry_of(lane, BRANCH)["state"] == "merge-queued"
    # Resumed, the next step reads the commit and decides.
    with lane.store.update("resume") as state:
        state["lane"]["paused"] = False
    run_steps(lane)
    assert events(lane, "ejected")[0]["reason"] == "merge-failed"


# A restart while queued.


def test_a_restart_while_queued_keeps_waiting_and_asks_for_no_second_merge(lane):
    queued(lane)
    lane.change_world(processes={"running": {}})  # The lane died; its jobs with it.
    resume(lane.factory())
    assert queue(lane) == [(BRANCH, "merge-queued"), (BEHIND, "validated")]
    factory = lane.factory()
    github = factory.world.github
    asked = []

    class Counting:
        def __getattr__(self, name):
            return getattr(github, name)

        def merge_pr(self, pr, head):
            asked.append(pr)

        def enqueue_pr(self, pr, head):
            asked.append(pr)

    factory.world = replace(factory.world, github=Counting())
    step(factory)
    assert asked == [] and entry_of(lane, BRANCH)["state"] == "merge-queued"
    assert "merged feat/export-csv (PR 600), through the merge queue" in settle(lane, "merge")


def test_a_restart_after_the_queue_merged_lands_it(lane):
    queued(lane)
    rewrite_pr(lane, "600", state="MERGED", queue=None, mergeCommit=GROUP)
    assert "merged feat/export-csv (PR 600), through the merge queue" in resume(lane.factory())
    assert kinds(lane).count("merged") == 1


def test_a_lane_that_stopped_between_asking_and_recording_finds_the_queued_request(lane):
    """The entry still says ``merging``: GitHub shows the request, so it is not asked again."""
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}})
    run_steps(lane, 3)
    assert entry_of(lane, BRANCH)["state"] == "merging"
    rewrite_pr(
        lane,
        "600",
        queue={"state": "QUEUED", "position": 2, "groupHead": GROUP},
        queuedHead="b2c3d4e+main-0",
    )
    actions = run_steps(lane)
    assert "merge of feat/export-csv (PR 600) waits in the merge queue" in actions
    assert entry_of(lane, BRANCH)["mergeQueue"]["position"] == 2


def test_a_merge_request_whose_answer_was_lost_is_found_in_the_queue(lane):
    lane.change_world(outcomes={"mergePr": {BRANCH: "lands-then-fail: timed out"}})
    run_steps(lane, 3)
    assert entry_of(lane, BRANCH)["state"] == "merge-queued"
    assert not events(lane, "lane-error") and not events(lane, "ejected")


def test_a_failed_read_after_asking_is_never_asked_again(lane):
    """GitHub took the request and the read after it failed. Left as ``merging``, a later step
    would ask again for a head GitHub may by then have let go: it waits, and the next read
    says what happened."""
    run_steps(lane, 2)
    factory = lane.factory()
    github = factory.world.github
    reads = []

    class Flaky:
        def __getattr__(self, name):
            return getattr(github, name)

        def merge_progress(self, pr):
            reads.append(pr)
            if len(reads) == 2:  # The read after the request.
                raise WorldError("HTTP 502")
            return github.merge_progress(pr)

    factory.world = replace(factory.world, github=Flaky())
    actions = step(factory)
    assert "PR 600 was asked for; reading it failed, read again: HTTP 502" in actions
    assert not events(lane, "lane-error") and "merged" not in kinds(lane)
    entry = entry_of(lane, BRANCH)
    assert entry["state"] == "merge-queued" and "seen" not in entry["mergeQueue"]
    assert run_steps(lane) == []  # The next read finds it queued.
    assert entry_of(lane, BRANCH)["mergeQueue"]["seen"] is True
    # Removed for failed checks, it is ejected and counted: the same head is not asked again.
    settle(lane, "remove: failed_checks")
    assert events(lane, "ejected")[0]["reason"] == "ci-failed"


def test_without_a_queue_a_read_that_trails_the_merge_lands_it_as_a_direct_merge(make_run):
    lane = make_run("running")
    run_steps(lane, 2)
    factory = lane.factory()
    github = factory.world.github
    reads = []

    class Trailing:
        def __getattr__(self, name):
            return getattr(github, name)

        def merge_progress(self, pr):
            reads.append(pr)
            if len(reads) == 2:  # The read after the request: GitHub's read trails its write.
                return MergeProgress(state="OPEN", head="b2c3d4e+main-0")
            return github.merge_progress(pr)

    factory.world = replace(factory.world, github=Trailing())
    step(factory)
    assert entry_of(lane, BRANCH)["state"] == "merge-queued" and "merged" not in kinds(lane)
    assert "merged feat/export-csv (PR 600)" in run_steps(lane)
    merged = next(r for r in lane.store.read_records() if r["kind"] == "merged")
    assert "mergeQueue" not in merged
    assert [e["detail"] for e in events(lane, "merged")] == ["PR 600"]


# The wait is bounded.


def test_a_wait_past_the_limit_pauses_the_lane_and_leaves_it_queued(lane):
    queued(lane)
    later(lane, 91)  # lane.checkTimeoutMinutes is 90.
    run_steps(lane)
    error = events(lane, "lane-error")[0]
    assert error["detail"] == (
        "PR 600 has waited in the merge queue for 90 minutes (QUEUED, position 1); it "
        "is left there: read the queue on GitHub, then lane-resume"
    )
    state = lane.state()
    assert state["lane"]["paused"] is True and not events(lane, "ejected")
    assert entry_of(lane, BRANCH)["state"] == "merge-queued"
    assert prs(lane)["600"]["state"] == "OPEN" and "queue" in prs(lane)["600"]
    # Resumed, the wait starts again, and a merge still lands with its whole time in the queue.
    with lane.store.update("resume") as state:
        state["lane"]["paused"] = False
    assert run_steps(lane) == []
    later(lane, 100)
    settle(lane, "merge")
    merged = next(r for r in lane.store.read_records() if r["kind"] == "merged")
    assert merged["queueMinutes"] == 100.0


def test_the_limit_is_the_dial(lane):
    with lane.store.update("dial") as state:
        state["dials"]["lane.checkTimeoutMinutes"] = 10
    queued(lane)
    later(lane, 9)
    run_steps(lane)
    assert not events(lane, "lane-error")
    later(lane, 11)
    run_steps(lane)
    assert "for 10 minutes" in events(lane, "lane-error")[0]["detail"]


# Auto-merge, and a request GitHub does not show.


def auto_merge_after_asking(lane) -> list[str]:
    """Step to the request, which GitHub answers by setting auto-merge instead of queueing."""
    run_steps(lane, 2)
    factory = lane.factory()
    github = factory.world.github

    class AutoMerge:
        def __getattr__(self, name):
            return getattr(github, name)

        def enqueue_pr(self, pr, head):
            rewrite_pr(lane, str(pr), autoMerge=True)

        def merge_progress(self, pr):
            return lane.factory().world.github.merge_progress(pr)

    factory.world = replace(factory.world, github=AutoMerge())
    return step(factory)


def test_auto_merge_on_a_pull_request_the_lane_has_not_asked_for_changes_nothing(make_run):
    """Set by a person, here without a queue: the lane still waits for its check and asks when
    it passes."""
    lane = make_run("running")
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}})
    run_steps(lane, 2)
    rewrite_pr(lane, "600", autoMerge=True)
    run_steps(lane)
    assert entry_of(lane, BRANCH)["state"] == "merging"
    lane.change_world(outcomes={"checks": {BRANCH: "success"}})
    assert "merged feat/export-csv (PR 600)" in run_steps(lane)


@pytest.mark.parametrize("queue", [False, True])
def test_a_refused_request_is_a_refusal_whoever_set_auto_merge(make_run, queue):
    """A person set auto-merge and pushed: the request is refused for the head. Auto-merge is
    never the lane's own lost answer, so the branch is ejected, not held to land a head the
    lane did not validate."""
    lane = make_run("running")
    lane.change_world(mergeQueue={"required": queue}, outcomes={"checks": {BRANCH: "pending"}})
    run_steps(lane, 2)
    lane.change_world(outcomes={"checksByHead": {"b2c3d4e+main-0": "success"}})
    rewrite_pr(lane, "600", head="someone-pushed", autoMerge=True)
    run_steps(lane)
    assert events(lane, "ejected")[0]["reason"] == "merge-failed"
    assert "merged" not in kinds(lane) and queue_states(lane).get(BRANCH) is None


def test_a_head_that_moves_while_only_auto_merge_holds_it_is_ejected(lane):
    auto_merge_after_asking(lane)
    rewrite_pr(lane, "600", head="someone-pushed")
    run_steps(lane)
    ejected = events(lane, "ejected")[0]
    assert ejected["reason"] == "merge-failed" and "moved to someone-pushed" in ejected["detail"]


def test_an_unreadable_branch_author_is_an_error_not_a_merge_as_the_lane():
    with pytest.raises(WorldError, match="author of the branch in slot cannot be read"):
        CliGit(FakeRun()).merge_main("slot", "main1")


def test_a_check_that_fails_while_auto_merge_waits_ejects(lane):
    auto_merge_after_asking(lane)
    assert entry_of(lane, BRANCH)["mergeQueue"]["state"] == "AUTO_MERGE"
    assert run_steps(lane) == []
    lane.change_world(outcomes={"checks": {BRANCH: "failure"}})
    run_steps(lane)
    ejected = events(lane, "ejected")[0]
    assert ejected["reason"] == "ci-failed" and "at b2c3d4e+main-0" in ejected["detail"]


def test_auto_merge_waiting_for_the_queue_is_a_queued_merge_too(lane):
    actions = auto_merge_after_asking(lane)
    assert (
        "merge of feat/export-csv (PR 600) waits in auto-merge, until the queue takes it" in actions
    )
    assert entry_of(lane, BRANCH)["mergeQueue"]["state"] == "AUTO_MERGE"
    later(lane, 91)
    run_steps(lane)
    assert (
        "auto-merge is set but the queue has not taken it"
        in (events(lane, "lane-error")[0]["detail"])
    )


def test_a_request_github_does_not_show_is_given_two_minutes_then_ejected(lane):
    queued(lane)
    with lane.store.update("never seen") as state:
        state["queue"][0]["mergeQueue"].pop("seen")
    rewrite_pr(lane, "600", queue=None)
    assert run_steps(lane) == [] and not events(lane, "ejected")
    later(lane, 3)
    assert run_steps(lane) == [] and not events(lane, "ejected")
    later(lane, 5)
    run_steps(lane)
    assert events(lane, "ejected")[0]["reason"] == "merge-failed"


def test_a_failed_check_ejects_even_with_auto_merge_set(lane):
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}})
    run_steps(lane, 2)
    rewrite_pr(lane, "600", autoMerge=True)
    lane.change_world(outcomes={"checks": {BRANCH: "failure"}})
    run_steps(lane)
    assert events(lane, "ejected")[0]["reason"] == "ci-failed"


# lane-drop.


async def test_a_branch_in_the_queue_cannot_be_dropped(lane):
    queued(lane)
    before = lane.snapshot()
    refused = await lane.call("lane_drop", branch=BRANCH, reason="Abandoned")
    assert refused.error.code == "MERGE_QUEUED" and "PR 600" in refused.error.message
    assert "remove the pull request from the merge queue" in refused.error.suggestion
    assert lane.snapshot() == before


async def test_lane_drop_refuses_merging_entry_held_by_github(lane):
    """lushly-dev/afd#1628: a merging entry whose PR is already queued, has auto-merge set,
    is already merged, or cannot be read on GitHub must not be dropped."""
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}})
    run_steps(lane, 2)
    assert entry_of(lane, BRANCH)["state"] == "merging"

    # Queued on GitHub (e.g. a person queued it or the lane died before recording merge-queued).
    rewrite_pr(lane, "600", queue={"state": "QUEUED", "position": 1, "groupHead": GROUP})
    before = lane.snapshot()
    refused = await lane.call("lane_drop", branch=BRANCH, reason="Abandoned")
    assert refused.error.code == "MERGE_QUEUED" and "PR 600" in refused.error.message
    assert lane.snapshot() == before

    # Auto-merge set on GitHub while the lane still reads the entry as merging.
    rewrite_pr(lane, "600", queue=None, autoMerge=True)
    before = lane.snapshot()
    refused = await lane.call("lane_drop", branch=BRANCH, reason="Abandoned")
    assert refused.error.code == "MERGE_QUEUED" and "auto-merge" in refused.error.message
    assert lane.snapshot() == before

    # Already merged on GitHub before the lane's next step landed it.
    rewrite_pr(lane, "600", autoMerge=False, state="MERGED")
    before = lane.snapshot()
    refused = await lane.call("lane_drop", branch=BRANCH, reason="Abandoned")
    assert refused.error.code == "MERGE_QUEUED" and "already merged" in refused.error.message
    assert lane.snapshot() == before

    # Settling as merged (queue removal says merged, PR still briefly reads OPEN).
    rewrite_pr(lane, "600", state="OPEN", removalReason="merged")
    before = lane.snapshot()
    refused = await lane.call("lane_drop", branch=BRANCH, reason="Abandoned")
    assert refused.error.code == "MERGE_QUEUED" and "already merged" in refused.error.message
    assert lane.snapshot() == before

    # Unreadable GitHub state fails closed (READ_FAILED) instead of dropping blindly.
    rewrite_pr(lane, "600", removalReason="")
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}, "mergeProgress": "fail: offline"})
    before = lane.snapshot()
    failed = await lane.call("lane_drop", branch=BRANCH, reason="Abandoned")
    assert failed.error.code == "READ_FAILED"
    assert lane.snapshot() == before

    # Open PR with neither queue nor auto-merge can still be dropped cleanly.
    lane.change_world(outcomes={"checks": {BRANCH: "pending"}, "mergeProgress": None})
    dropped = await lane.call("lane_drop", branch=BRANCH, reason="Abandoned")
    assert dropped.success and dropped.data["dropped"] is True
    assert BRANCH not in queue_states(lane)


# The fixture world's queue.


def test_the_fixture_queue_holds_a_pull_request_until_told_what_became_of_it(lane):
    queued(lane)
    github = lane.factory().world.github
    waiting = github.merge_progress(600)
    assert waiting == MergeProgress(
        state="OPEN",
        head="b2c3d4e+main-0",
        queue_required=True,
        queued=True,
        queue_state="QUEUED",
        position=1,
        group_head=GROUP,
    )
    assert waiting.pending
    lane.change_world(mergeQueue={"outcomes": {BRANCH: "remove: dequeued by a person"}})
    gone = lane.factory().world.github.merge_progress(600)
    assert (gone.state, gone.queued, gone.pending) == ("OPEN", False, False)
    assert (gone.removed_at, gone.removal_reason, gone.removed_commit) == (
        "2030-01-01T00:00:00Z",
        "dequeued by a person",
        GROUP,
    )
    assert lane.world_data()["main"].get("head") != GROUP


# The real world: GitHub's answer, and who a merge of the base is authored as.

PROGRESS_QUEUED = {
    "state": "OPEN",
    "isMergeQueueEnabled": True,
    "isInMergeQueue": True,
    "autoMergeRequest": None,
    "mergeQueueEntry": {"state": "AWAITING_CHECKS", "position": 2, "headCommit": {"oid": "g1"}},
    "timelineItems": {"nodes": []},
}


def progress_of(node) -> tuple[MergeProgress, FakeRun]:
    run = FakeRun(
        {
            "gh repo view": json.dumps({"nameWithOwner": "o/r"}),
            "gh api graphql": json.dumps({"data": {"repository": {"pullRequest": node}}}),
        }
    )
    return GhGitHub(run).merge_progress(7), run


def test_merge_progress_reads_the_queue_entry_from_one_graphql_call():
    progress, run = progress_of(PROGRESS_QUEUED)
    assert progress == MergeProgress(
        state="OPEN",
        queue_required=True,
        queued=True,
        queue_state="AWAITING_CHECKS",
        position=2,
        group_head="g1",
    )
    args = run.calls[-1][0]
    assert args[:3] == ["gh", "api", "graphql"]
    assert args[-6:] == ["-f", "owner=o", "-f", "name=r", "-F", "number=7"]
    query = next(part for part in args if part.startswith("query="))
    for field in ("isMergeQueueEnabled", "mergeQueueEntry", "REMOVED_FROM_MERGE_QUEUE_EVENT"):
        assert field in query


def test_merge_progress_reads_merged_removed_and_auto_merge():
    merged, _ = progress_of(
        {
            "state": "MERGED",
            "isMergeQueueEnabled": False,
            "isInMergeQueue": False,
            "autoMergeRequest": None,
            "mergeQueueEntry": None,
            "timelineItems": {"nodes": [{"createdAt": "2026-11-19T11:19:35Z", "reason": "merged"}]},
        }
    )
    assert (merged.state, merged.pending) == ("MERGED", False)
    assert (merged.removed_at, merged.removal_reason) == ("2026-11-19T11:19:35Z", "merged")
    waiting, _ = progress_of(
        {
            "state": "OPEN",
            "isMergeQueueEnabled": True,
            "isInMergeQueue": False,
            "autoMergeRequest": {"enabledAt": "2026-11-19T11:00:00Z"},
            "mergeQueueEntry": None,
            "timelineItems": {"nodes": []},
        }
    )
    assert (waiting.queued, waiting.waiting, waiting.pending) == (False, True, True)


def test_merge_progress_without_a_pull_request_is_an_error_not_an_open_one():
    with pytest.raises(WorldError, match="no pull request 7"):
        progress_of(None)


def test_the_real_enqueue_is_the_mutation_bound_to_the_head():
    answers = {
        "gh pr view": json.dumps({"id": "PR_1"}),
        "gh api graphql": json.dumps(
            {"data": {"enqueuePullRequest": {"mergeQueueEntry": {"state": "QUEUED"}}}}
        ),
    }
    run = FakeRun(answers)
    GhGitHub(run).enqueue_pr(7, "abc")
    args = run.calls[-1][0]
    assert args[-4:] == ["-f", "id=PR_1", "-f", "head=abc"]
    query = next(part for part in args if part.startswith("query="))
    assert "enqueuePullRequest(input: {pullRequestId: $id, expectedHeadOid: $head})" in query
    assert not any("merge" in part and "auto" in part.lower() for part in args[:3])
    refused = {
        "data": {"enqueuePullRequest": None},
        "errors": [{"type": "UNPROCESSABLE", "message": "expected head oid does not match"}],
    }
    run = FakeRun({**answers, "gh api graphql": json.dumps(refused)})
    with pytest.raises(WorldError, match="expected head oid does not match"):
        GhGitHub(run).enqueue_pr(7, "abc")


def test_a_commit_s_message_is_read_whole():
    run = FakeRun(
        {
            "gh repo view": json.dumps({"nameWithOwner": "o/r"}),
            "gh api repos/o/r/commits/g1": json.dumps(
                {"commit": {"message": "t (#7)\n\nCo-authored-by: A <a@b.c>"}}
            ),
        }
    )
    assert GhGitHub(run).commit_message("g1").endswith("Co-authored-by: A <a@b.c>")


def test_the_lane_authors_a_base_merge_as_the_branch_s_author(tmp_path, monkeypatch):
    """A merge queue writes the squash message itself and credits every commit author but the
    pull request's as a co-author. Committed by the lane and authored by the branch's own
    author, the lane's merge of the base adds nobody."""
    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    repo = tmp_path / "repo"
    repo.mkdir()
    run = make_runner(str(repo))
    run(["git", "init", "--initial-branch=main"])
    run(["git", "config", "user.name", "The Owner"])
    run(["git", "config", "user.email", "owner@example.org"])

    def commit(name: str, text: str, message: str) -> str:
        (repo / name).write_text(text, encoding="utf-8")
        run(["git", "add", "-A"])
        run(["git", "commit", "-q", "-m", message])
        return run(["git", "rev-parse", "HEAD"]).strip()

    commit("a.txt", "a\n", "base")
    run(["git", "checkout", "-q", "-b", "feat"])
    branch = commit("b.txt", "b\n", "feat: b")
    run(["git", "checkout", "-q", "main"])
    main = commit("c.txt", "c\n", "main moved")
    git = CliGit(run)
    slot = git.prepare_slot("1", "", branch)
    # Neither the lane's environment nor the host's configuration decides who authored it.
    monkeypatch.setenv("GIT_AUTHOR_NAME", "An Agent")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "agent@example.org")
    run(["git", "config", "committer.name", "Host Committer"])
    run(["git", "config", "committer.email", "host@example.org"])
    merged = git.merge_main(slot, main)
    assert merged.clean and merged.head != branch
    who = run(["git", "-C", slot, "log", "-1", "--format=%an <%ae>|%cn <%ce>|%P"]).strip()
    author, committer, parents = who.split("|")
    assert author == "The Owner <owner@example.org>"
    assert committer == "botcore-factory <factory@localhost>"
    assert parents.split() == [branch, main]
    # Every commit the pull request would hold has one author: nobody to credit beside them.
    authors = run(["git", "-C", slot, "log", "--format=%ae", f"{main}..HEAD"]).split()
    assert set(authors) == {"owner@example.org"}
    # A second move of main, onto a head that is a merge an older lane authored as itself: the
    # author is still the branch's, read from its own commits, never copied from that merge.
    run(
        ["git", "-C", slot, "commit", "--amend", "--no-edit", "--quiet"]
        + ["--author", "botcore-factory <factory@localhost>"]
    )
    run(["git", "checkout", "-q", "main"])
    later = commit("d.txt", "d\n", "main moved again")
    assert git.merge_main(slot, later).clean
    assert run(["git", "-C", slot, "log", "-1", "--format=%an <%ae>"]).strip() == (
        "The Owner <owner@example.org>"
    )
    # A branch with no commit of its own fast-forwards onto main. Main's tip is a merge commit
    # whose first parent is where the branch stood: it is main's commit, and is left alone.
    monkeypatch.delenv("GIT_AUTHOR_NAME")
    monkeypatch.delenv("GIT_AUTHOR_EMAIL")
    stood = run(["git", "rev-parse", "main"]).strip()
    run(["git", "checkout", "-q", "-b", "side", "main"])
    commit("e.txt", "e\n", "side")
    run(["git", "checkout", "-q", "main"])
    run(["git", "merge", "--no-ff", "--no-edit", "-q", "side"])
    tip = run(["git", "rev-parse", "main"]).strip()
    assert run(["git", "rev-list", "--parents", "-n", "1", tip]).split()[1] == stood
    monkeypatch.setenv("GIT_AUTHOR_NAME", "An Agent")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "agent@example.org")
    behind = git.prepare_slot("3", "", stood)
    forwarded = git.merge_main(behind, tip)
    assert forwarded.clean and forwarded.head == tip  # Main's own commit, not a copy of it.
    # A merge left open and committed by the lane (regenerated files) is authored so too.
    monkeypatch.delenv("GIT_AUTHOR_NAME")
    monkeypatch.delenv("GIT_AUTHOR_EMAIL")
    run(["git", "checkout", "-q", "-b", "other", branch])
    side = commit("a.txt", "branch\n", "feat: a")
    run(["git", "checkout", "-q", "main"])
    clash = commit("a.txt", "main\n", "main changes a")
    monkeypatch.setenv("GIT_AUTHOR_NAME", "An Agent")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "agent@example.org")
    other = git.prepare_slot("2", "", side)
    assert git.merge_main(other, clash, keep_open=lambda files: True).open
    (Path(other) / "a.txt").write_text("both\n", encoding="utf-8")
    run(["git", "-C", other, "add", "a.txt"])
    assert git.finish_merge(other).clean
    assert run(["git", "-C", other, "log", "-1", "--format=%an <%ae>|%cn"]).strip() == (
        "The Owner <owner@example.org>|botcore-factory"
    )
