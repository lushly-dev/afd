"""Handing a reviewed branch to the lane: ``lane-enqueue``.

A cell calls it once, naming only its worktree, and ends its turn. Everything that can refuse is
checked before anything is written, in this order: the worktree and its branch, the cell
(``NOT_FOUND``), the lane host (``NOT_LANE_HOST``), uncommitted files (``DIRTY_WORKTREE``), the
review recorded for the exact head (``REVIEW_MISSING``, from the adapter's ``review_evidence``,
never from the caller; fast feedback only, since it runs the branch's own verifier: the lane's
check at validation binds, lushly-dev/afd#1308), a repair's gate edits (``GATE_EDIT_IN_REPAIR``,
or ``GATE_CHECK_FAILED`` when they cannot be read) and the cheap checks (``PREQUEUE_FAILED``,
whose suggestion names the adapter's ``install`` command, since a new worktree fails them all).
Then the head is pushed to ``refs/factory/queue/<branch>`` on origin, the branch is queued (a
repair at the front) or held when the queue holds ``lane.queueMax`` branches, the ejection it
repairs is answered and an ``enqueued`` record is written.
"""

from __future__ import annotations

import shlex
from pathlib import PurePosixPath
from typing import Any

from botcore_factory import change_report, dials, records
from botcore_factory.adapter import matches
from botcore_factory.claims import format_time
from botcore_factory.events import answer, emit
from botcore_factory.lane_base import MERGE_QUEUED, open_index
from botcore_factory.runtime import EXTERNAL, STOP, Factory, Refusal, fix_input
from botcore_factory.world import LANE_HOST_VARIABLE, Issue, WorldError

FIRST_LINES = 20
REVIEW_TIMEOUT = 120  # Seconds; the verifier only reads a record.
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
            recovery=fix_input("worktree"),
        ) from exc
    if not branch:
        raise Refusal(
            "NOT_FOUND",
            f"{worktree} is not on a branch (detached HEAD)",
            "Check out the cell's branch in its worktree, then lane-enqueue again",
            recovery=EXTERNAL,
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
            f"Stop and tell the foreman: cells run on the lane host ({lane_host}) and call "
            "lane-enqueue there, since handing a branch over from another machine is not built yet"
            if lane_host
            else "Stop and tell the foreman, who chooses the lane host with lane-host-set",
            recovery=EXTERNAL,
        )


def _check_clean(factory: Factory, worktree: str) -> None:
    files = factory.world.git.uncommitted(worktree)
    if files:
        shown = ", ".join(files[:10]) + (f" and {len(files) - 10} more" if len(files) > 10 else "")
        raise Refusal(
            "DIRTY_WORKTREE",
            f"{worktree} has uncommitted changes: {shown}",
            "Commit them with git commit (or remove them), then lane-enqueue again",
            recovery=EXTERNAL,
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
            recovery=EXTERNAL,
        )
    argv = [part.replace("{head}", head).replace("{worktree}", worktree) for part in command]
    try:
        done = factory.world.processes.run(
            argv, cwd=worktree, timeout=REVIEW_TIMEOUT, label="review-evidence"
        )
        failed, output = done.returncode != 0, done.stderr + "\n" + done.stdout
    except WorldError as exc:  # It could not run, or ran too long: no review is shown.
        failed, output = True, str(exc)
    if failed:
        why = _first_lines(output)[:1]
        raise Refusal(
            "REVIEW_MISSING",
            f"No passing review is recorded for {head}" + (f": {why[0][:300]}" if why else ""),
            "Run prepare-pr in lane mode on this head (it records the review), then "
            "lane-enqueue again",
            recovery=EXTERNAL,
        )


def _check_gate(
    factory: Factory, worktree: str, branch: str, cell: dict[str, Any], state: dict[str, Any]
) -> None:
    """A branch ejected for a failing check may not come back with new gate-path edits."""
    ejection = factory.store.last_ejection(branch)
    cause = ejection.get("cause") if ejection else None
    if ejection is None:
        events = [e for e in state["events"] if e.get("type") == "ejected"]
        event = next((e for e in reversed(events) if e.get("branch") == branch), None)
        cause = event.get("reason") if event else None
    if cause not in records.FAILING_CHECK_CAUSES or cell.get("gateAllowed"):
        return
    since = ejection.get("head") if ejection else None
    # Only the branch's own change counts: a repair that rebases onto main, or merges it, brings
    # in main's gate edits too, and those are not the repair's (lushly-dev/afd#1374).
    # The base is the lane's own fetch, never a ref in the cell's worktree it could repoint.
    try:
        base = factory.world.git.fetch_base(factory.config.base_branch)
        edits = factory.world.git.repair_edits(
            worktree, base, since, lambda path: matches(path, factory.config.gate_paths)
        )
    except WorldError as exc:  # Unread is not clean: the repair waits.
        raise Refusal(
            "GATE_CHECK_FAILED",
            f"{branch} was ejected ({cause}) and its gate edits could not be read: {exc}",
            "Try lane-enqueue again; if it fails again, check the network and origin, and that "
            "the worktree still holds the ejected head's history",
            recovery=EXTERNAL,
        ) from exc
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
        recovery=EXTERNAL,
        paths=edits,
    )


def _prequeue(factory: Factory, worktree: str) -> list[dict[str, Any]]:
    stages: list[dict[str, Any]] = []
    for stage in factory.config.prequeue:
        label = f"prequeue:{stage.name}"
        try:
            done = factory.world.processes.run(stage.run, cwd=worktree, label=label)
            failed, output = done.returncode != 0, done.stdout + "\n" + done.stderr
        except WorldError as exc:  # The stage could not run at all: it did not pass.
            failed, output = True, str(exc)
        if failed:
            lines = _first_lines(output)
            fix = f"fix what {stage.name} reports in the worktree, commit, then lane-enqueue again"
            install, extra = factory.config.install, {}
            if install:
                # A new cell worktree has no dependencies, so the first stage fails on a missing
                # tool rather than on the branch (lushly-dev/afd#1594): name the command to run.
                extra["install"] = list(install)
                fix = (
                    f"If the worktree is new or rebased and not installed since, run "
                    f"`{shlex.join(install)}` in it (and build what the stage imports), then "
                    f"lane-enqueue again, with nothing to commit. Otherwise {fix}"
                )
            raise Refusal(
                "PREQUEUE_FAILED",
                f"The {stage.name} stage failed: {lines[0] if lines else 'no output'}",
                fix[0].upper() + fix[1:],
                recovery=EXTERNAL,
                stage=stage.name,
                lines=lines,
                passed=[entry["name"] for entry in stages],
                **extra,
            )
        stages.append({"name": stage.name, "passed": True})
    return stages


def _profile_from_issues(issues: list[Issue]) -> str:
    """The issue's execution profile, which Measurement weighs a merge by."""
    profiles = [
        name.removeprefix("execution:")
        for issue in issues
        for name in issue.labels
        if name.startswith("execution:")
    ]
    return profiles[0] if profiles else "unknown"


def _read_test_changes(
    factory: Factory, worktree: str, branch: str, head: str
) -> tuple[dict[str, Any] | None, str | None]:
    """Advisory test-change report at enqueue (the lane runs the base's copy before validation)."""
    if not factory.config.test_changes:
        return None, None
    try:
        base = factory.world.git.fetch_base(factory.config.base_branch)
        report = change_report.run_report(
            factory, cwd=worktree, worktree=worktree, base=base, head=head
        )
        return report, base
    except WorldError as exc:
        raise Refusal(
            "TEST_CHANGES_FAILED",
            f"Could not read test changes for {branch}: {exc}",
            "Check that origin is reachable and the adapter's test_changes command prints valid "
            "JSON, then lane-enqueue again",
            recovery=EXTERNAL,
        ) from exc


def _check_inputs(factory: Factory, branch: str, body_file: str | None) -> None:
    if matches(branch, factory.config.ignore_branches):
        raise Refusal(
            "IGNORED_BRANCH",
            f"{branch} is a branch the lane never takes (ignore_branches)",
            "Merge it by hand: the release PR, for one, is operator work",
            recovery=STOP,
        )
    if body_file is not None:
        path = PurePosixPath(body_file.replace("\\", "/"))
        if not body_file or path.is_absolute() or ".." in path.parts or ":" in body_file:
            raise Refusal(
                "BODY_FILE_OUTSIDE",
                f"body_file must be a path inside the worktree: {body_file!r}",
                "Pass the PR body's path relative to the worktree, e.g. pr-body.md",
                recovery=fix_input("body_file"),
            )


def _admit(
    state: dict[str, Any],
    entry: dict[str, Any],
    repaired: bool,
    *,
    hold_reason: str | None = None,
    hold_reasons: list[str] | None = None,
) -> tuple[str, int, str | None]:
    """Queue the entry (a repair at the front, behind a branch already merging) or hold it when
    an owner hold applies (``gate-change``) or the queue is full."""
    previous = next((e for e in state["queue"] if e.get("branch") == entry["branch"]), None)
    if previous is not None and previous.get("pr"):
        entry["pr"] = previous["pr"]  # Its PR stays open; the next push updates it.
    for listing in (state["queue"], state["held"]):
        listing[:] = [item for item in listing if item.get("branch") != entry["branch"]]
    if hold_reason is not None:
        held_entry = {**entry, "state": "held", "holdReason": hold_reason}
        if hold_reasons:
            detail, lines = change_report.summarize_hold(hold_reasons)
            held_entry["holdReasons"] = lines
            held_entry["holdDetail"] = detail
        state["held"].append(held_entry)
        return "held", len(state["held"]), hold_reason
    most = dials.value(state["dials"], "lane.queueMax")
    if repaired:
        index = open_index(state["queue"])
        state["queue"].insert(index, entry)
        return "queued", index + 1, None
    if len(state["queue"]) >= most:
        state["held"].append({**entry, "holdReason": "queue-full"})
        return "held", len(state["held"]), "queue-full"
    state["queue"].append(entry)
    return "queued", len(state["queue"]), None


def _find_cell(state: dict[str, Any], branch: str) -> dict[str, Any]:
    cell = next((c for c in state["cells"] if c.get("branch") == branch), None)
    if cell is None:
        raise Refusal(
            "NOT_FOUND",
            f"No cell is registered for {branch}",
            "The foreman registers a cell with cell-register before starting it; a branch "
            "without one cannot be queued",
            recovery=EXTERNAL,
        )
    cell_dict: dict[str, Any] = cell
    return cell_dict


def enqueue(
    factory: Factory, worktree: str, title: str | None, body_file: str | None
) -> dict[str, Any]:
    """The checks run outside the state lock (the cheap stages take minutes); the worktree is
    read again under it, so what joins the queue is the head that was checked."""
    branch, head = _worktree(factory, worktree)
    _check_inputs(factory, branch, body_file)
    cell = _find_cell(factory.store.read(), branch)
    _check_host(factory)
    _check_clean(factory, worktree)
    _check_review(factory, worktree, head)
    _check_gate(factory, worktree, branch, cell, factory.store.read())
    stages = _prequeue(factory, worktree)
    issues = [factory.world.github.get_issue(number) for number in cell.get("issues", [])]
    profile = _profile_from_issues(issues)
    report, base = _read_test_changes(factory, worktree, branch, head)
    hold_reasons: list[str] = []
    if change_report.is_factory_branch(issues, cell):
        if base is None:
            try:
                base = factory.world.git.fetch_base(factory.config.base_branch)
            except WorldError as exc:
                raise Refusal(
                    "GATE_CHECK_FAILED",
                    f"{branch}'s gate changes could not be read against "
                    f"{factory.config.base_branch}: {exc}",
                    "Check the network and origin, then lane-enqueue again",
                    recovery=EXTERNAL,
                ) from exc
        changed_gate = [
            path
            for path in factory.world.git.changed_files(worktree, base)
            if matches(path, factory.config.gate_paths)
        ]
        hold_reasons = change_report.check_less_reasons(report, gate_paths=changed_gate)
    with factory.store.update(f"lane-enqueue {branch}") as state:
        cell = _find_cell(state, branch)
        if hold_reasons and change_report.is_gate_change_approved(cell, head):
            hold_reasons = []
        waiting = next((e for e in state["queue"] if e.get("branch") == branch), None)
        if waiting is not None and waiting.get("state") == MERGE_QUEUED:
            raise Refusal(
                "MERGE_QUEUED",
                f"{branch} is in GitHub's merge queue as PR {waiting.get('pr')}, which locks "
                "the branch: nothing can be pushed to it",
                "Wait: the lane lands it when it merges, and ejects it when it leaves the "
                "queue, after which lane-enqueue takes the new head",
                recovery=EXTERNAL,
            )
        if factory.world.git.head(worktree) != head or factory.world.git.uncommitted(worktree):
            raise Refusal(
                "HEAD_MOVED",
                f"{worktree} changed while its checks ran (they checked {head})",
                "Commit everything, then lane-enqueue again: the checks run on the new head",
                recovery=EXTERNAL,
            )
        try:
            factory.world.git.push_queue_ref(worktree, branch, head)
        except WorldError as exc:
            raise Refusal(
                "WRITE_FAILED",
                f"Pushing {head} to refs/factory/queue/{branch} on origin failed: {exc}",
                "Nothing was queued. Check the network and origin, then lane-enqueue again",
                recovery=EXTERNAL,
            ) from exc
        now = format_time(factory.world.clock.now())
        attempt = factory.store.next_attempt(branch)
        first_enqueued_at = factory.store.first_enqueued(branch) or now
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
            **({"testChanges": report} if report is not None else {}),
        }
        gate_hold = change_report.GATE_CHANGE_HOLD if hold_reasons else None
        placed, position, hold_reason = _admit(
            state, entry, repaired, hold_reason=gate_hold, hold_reasons=hold_reasons
        )
        cell.update(state=placed, head=head, title=title, bodyFile=body_file, worktree=worktree)
        if report is not None:
            cell["testChanges"] = report
        answered = answer(state, "lane-enqueue", now, branch=branch)
        if gate_hold:
            detail, lines = change_report.summarize_hold(hold_reasons)
            emit(
                state,
                now,
                "gate-change-held",
                branch=branch,
                reason=gate_hold,
                detail=detail,
                lines=lines,
                needsOwner=gate_hold,
            )
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
            firstEnqueuedAt=first_enqueued_at,
            position=position,
            holdReason=hold_reason,
            repair=repaired,
            **({"testChanges": report} if report is not None else {}),
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
    if hold_reason is not None:
        result["holdReason"] = hold_reason
    if hold_reasons:
        detail, lines = change_report.summarize_hold(hold_reasons)
        result["holdReasons"] = lines
        result["holdDetail"] = detail
    if report is not None:
        result["testChanges"] = report
    return result
