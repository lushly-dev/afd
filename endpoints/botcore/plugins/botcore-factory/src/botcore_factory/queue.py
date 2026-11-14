"""Handing a reviewed branch to the lane: ``lane-enqueue``.

A cell calls it once, naming only its worktree, and ends its turn. Everything that can refuse is
checked before anything is written, in this order: the worktree and its branch, the cell
(``NOT_FOUND``), the lane host (``NOT_LANE_HOST``), uncommitted files (``DIRTY_WORKTREE``), the
review recorded for the exact head (``REVIEW_MISSING``, from the adapter's ``review_evidence``,
never from the caller), a repair's gate edits (``GATE_EDIT_IN_REPAIR``) and the cheap checks
(``PREQUEUE_FAILED``). Then the head is pushed to ``refs/factory/queue/<branch>`` on origin, the
branch is queued (a repair at the front) or held when the queue holds ``lane.queueMax``
branches, the ejection it repairs is answered and an ``enqueued`` record is written.
"""

from __future__ import annotations

from botcore_factory import dials, records
from botcore_factory.adapter import matches
from botcore_factory.claims import format_time
from botcore_factory.events import answer
from botcore_factory.runtime import Factory, Refusal
from botcore_factory.world import LANE_HOST_VARIABLE, WorldError

FIRST_LINES = 20
AREA_CI = "area:ci"


def _first_lines(text: str) -> list[str]:
    return [line for line in text.strip().splitlines() if line.strip()][:FIRST_LINES]


def _worktree(factory: Factory, worktree: str) -> tuple[str, str]:
    git = factory.world.git
    try:
        branch, head = git.branch(worktree), git.head(worktree)
    except WorldError as exc:
        raise Refusal(
            "NOT_FOUND",
            f"No worktree at {worktree}: {exc}",
            "Pass the path of the cell's own worktree",
        ) from exc
    if not branch:
        raise Refusal(
            "NOT_FOUND",
            f"{worktree} is not on a branch (detached HEAD)",
            "Check out the cell's branch in its worktree, then lane-enqueue again",
        )
    return branch, head


def _check_host(factory: Factory) -> None:
    world = factory.world
    lane_host, me = world.github.get_variable(LANE_HOST_VARIABLE), world.machine.id()
    if lane_host != me:
        where = f"the lane host is {lane_host}" if lane_host else "no lane host is set"
        raise Refusal(
            "NOT_LANE_HOST",
            f"This machine ({me}) is not the lane host: {where}",
            "Hand the branch over with lane-handoff from this machine"
            if lane_host
            else "Choose the lane host with lane-host-set first",
        )


def _check_clean(factory: Factory, worktree: str) -> None:
    files = factory.world.git.uncommitted(worktree)
    if files:
        shown = ", ".join(files[:10]) + (f" and {len(files) - 10} more" if len(files) > 10 else "")
        raise Refusal(
            "DIRTY_WORKTREE",
            f"{worktree} has uncommitted changes: {shown}",
            "Commit them with git commit (or remove them), then lane-enqueue again",
            files=files,
        )


def _check_review(factory: Factory, worktree: str, head: str) -> None:
    command = factory.config.review_evidence
    if not command:
        raise Refusal(
            "NOT_CONFIGURED",
            "The repository adapter names no review_evidence, so no head can show its review",
            "Set review_evidence under [plugins.factory]: the command that confirms the review "
            "recorded for {head}",
        )
    argv = [part.replace("{head}", head) for part in command]
    done = factory.world.processes.run(argv, cwd=worktree, label="review-evidence")
    if done.returncode != 0:
        raise Refusal(
            "REVIEW_MISSING",
            f"No review is recorded for {head}",
            "Run prepare-pr in lane mode on this head (it records the review), then "
            "lane-enqueue again",
        )


def _check_gate(factory: Factory, worktree: str, branch: str, cell: dict, state: dict) -> None:
    """A branch ejected for a failing check may not come back with new gate-path edits."""
    ejection = records.last_ejection(factory.store.read_records(), branch)
    cause = ejection.get("cause") if ejection else None
    if ejection is None:
        events = [e for e in state["events"] if e.get("type") == "ejected"]
        event = next((e for e in reversed(events) if e.get("branch") == branch), None)
        cause = event.get("reason") if event else None
    if cause not in records.FAILING_CHECK_CAUSES or cell.get("gateAllowed"):
        return
    since = ejection.get("head") if ejection else None
    edits = [
        path
        for path in factory.world.git.changed_files(worktree, since)
        if matches(path, factory.config.gate_paths)
    ]
    if not edits:
        return
    issues = [factory.world.github.get_issue(number) for number in cell.get("issues", [])]
    if any(AREA_CI in issue.labels for issue in issues):
        return
    raise Refusal(
        "GATE_EDIT_IN_REPAIR",
        f"{branch} was ejected ({cause}) and its repair edits gate paths: {', '.join(edits)}",
        "Repair it without editing the gate; if a diagnosis on the stronger route finds the gate "
        "edit is the right repair, the foreman records that with gate-allow",
        paths=edits,
    )


def _prequeue(factory: Factory, worktree: str) -> list[dict]:
    stages = []
    for stage in factory.config.prequeue:
        label = f"prequeue:{stage.name}"
        try:
            done = factory.world.processes.run(stage.run, cwd=worktree, label=label)
            failed, output = done.returncode != 0, done.stdout + "\n" + done.stderr
        except WorldError as exc:  # The stage could not run at all: it did not pass.
            failed, output = True, str(exc)
        if failed:
            lines = _first_lines(output)
            raise Refusal(
                "PREQUEUE_FAILED",
                f"The {stage.name} stage failed: {lines[0] if lines else 'no output'}",
                f"Fix what {stage.name} reports in the worktree, commit, then lane-enqueue again",
                stage=stage.name,
                lines=lines,
                passed=[entry["name"] for entry in stages],
            )
        stages.append({"name": stage.name, "passed": True})
    return stages


def _profile(factory: Factory, issues: list[int]) -> str:
    """The issue's execution profile, which Measurement weighs a merge by."""
    profiles = []
    for number in issues:
        labels = factory.world.github.get_issue(number).labels
        found = [name for name in labels if name.startswith("execution:")]
        profiles += [name.removeprefix("execution:") for name in found]
    return profiles[0] if profiles else "unknown"


def _admit(state: dict, entry: dict, repaired: bool) -> tuple[str, int]:
    """Queue the entry (a repair at the front) or hold it when the queue is full."""
    for listing in (state["queue"], state["held"]):
        listing[:] = [item for item in listing if item.get("branch") != entry["branch"]]
    most = dials.value(state["dials"], "lane.queueMax")
    if repaired:
        state["queue"].insert(0, entry)
        return "queued", 1
    if len(state["queue"]) >= most:
        state["held"].append({**entry, "holdReason": "queue-full"})
        return "held", len(state["held"])
    state["queue"].append(entry)
    return "queued", len(state["queue"])


def enqueue(factory: Factory, worktree: str, title: str | None, body_file: str | None) -> dict:
    branch, head = _worktree(factory, worktree)
    with factory.store.update(f"lane-enqueue {branch}") as state:
        cell = next((c for c in state["cells"] if c.get("branch") == branch), None)
        if cell is None:
            raise Refusal(
                "NOT_FOUND",
                f"No cell is registered for {branch}",
                "The foreman registers a cell with cell-register before starting it; a branch "
                "without one cannot be queued",
            )
        _check_host(factory)
        _check_clean(factory, worktree)
        _check_review(factory, worktree, head)
        _check_gate(factory, worktree, branch, cell, state)
        stages = _prequeue(factory, worktree)
        profile = _profile(factory, cell.get("issues", []))
        try:
            factory.world.git.push_queue_ref(worktree, branch, head)
        except WorldError as exc:
            raise Refusal(
                "WRITE_FAILED",
                f"Pushing {head} to refs/factory/queue/{branch} on origin failed: {exc}",
                "Nothing was queued. Check the network and origin, then lane-enqueue again",
            ) from exc
        now = format_time(factory.world.clock.now())
        history = factory.store.read_records()
        attempt = records.next_attempt(history, branch)
        repaired = cell.get("state") == "ejected"
        title = title or cell.get("title")
        body_file = body_file or cell.get("bodyFile")
        entry = {
            "branch": branch,
            "head": head,
            "attempt": attempt,
            "enqueuedAt": now,
            "title": title,
            "bodyFile": body_file,
            "issues": cell.get("issues", []),
        }
        placed, position = _admit(state, entry, repaired)
        cell.update(state=placed, head=head, title=title, bodyFile=body_file, worktree=worktree)
        answered = answer(state, "lane-enqueue", now, branch=branch)
        record = records.make(
            "enqueued",
            now,
            state["lane"].get("runId"),
            branch=branch,
            attempt=attempt,
            head=head,
            issues=cell.get("issues", []),
            plan=cell.get("plan"),
            route=cell.get("route"),
            profile=profile,
            state=placed,
            firstEnqueuedAt=records.first_enqueued(history, branch) or now,
            position=position,
            holdReason="queue-full" if placed == "held" else None,
            repair=repaired,
        )
        factory.store.append_record(record)
    result = {
        "state": placed,
        "position": position,
        "head": head,
        "branch": branch,
        "attempt": attempt,
        "prequeue": {"stages": stages},
        "answered": answered,
    }
    if placed == "held":
        result["holdReason"] = "queue-full"
    return result
