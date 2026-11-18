"""Cells: registering one claims its issues on GitHub and assigns it a plan.

Registration is reserve, then start: the foreman calls ``cell-register`` before
``delegate_task``, so a refusal costs nothing, then ``cell-attach`` with the thread. Every limit
is checked before anything is written, under the state lock, so two registrations cannot both
take the last seat or issue. ``lane-drop`` releases the claims and forgets the cell;
``gate-allow`` records a diagnosis that lets a repair edit a gate.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from botcore_factory import dials, records
from botcore_factory.claims import Claim, claim_body, format_time, parse_time, release_body
from botcore_factory.events import answer, emit
from botcore_factory.intake import not_dispatchable_reasons, read_backlog
from botcore_factory.labels import IN_PROGRESS, PLANNED
from botcore_factory.lane_base import counted_ejections
from botcore_factory.records import last_ejection
from botcore_factory.runtime import Factory, Refusal
from botcore_factory.world import Plan, WorldError

#: Cell states that hold a seat; a parked cell (waiting on the owner) frees its seat.
SEATED_STATES = frozenset({"registered", "working", "queued", "held", "validating", "ejected"})


@dataclass(frozen=True)
class PlanChoice:
    plan: Plan | None
    next_reset: str | None
    ceiling: float
    now: datetime | None = None


#: Days in a plan's window, for a plan that names no reset (the share elapsed says how far in).
WINDOW_DAYS = 7.0
#: The least time to a reset a pace is computed over, so a window about to reset (or a cache
#: whose reset has passed) has a large pace rather than an infinite one.
MIN_DAYS = 1 / 24


def days_to_reset(plan: Plan, now: datetime) -> float:
    """Days until the plan's window resets: from ``resetsAt``, else from the share elapsed."""
    if plan.resets_at:
        days = (parse_time(plan.resets_at) - now).total_seconds() / 86400
    else:
        days = WINDOW_DAYS * (100 - plan.elapsed) / 100
    return max(MIN_DAYS, days)


def pace(plan: Plan, ceiling: float, now: datetime) -> float:
    """How much of the plan's remaining room must be spent a day to use it by its reset: the room
    below ``plans.ceiling`` (percent of the window) over the days until the reset.

    The plan with the highest pace is the one whose allowance most needs spending before it resets
    (the owner's rule): 10% left with four days to go (2.5 a day) loses to 100% left with five
    (20 a day), so every plan tracks to its ceiling around its own reset.
    """
    return max(0.0, ceiling - plan.used) / days_to_reset(plan, now)


def choose_plan(plans: list[Plan], ceiling: float, now: datetime) -> PlanChoice:
    """The plan with the highest pace (room below the ceiling per day to its reset) below the
    ceiling.

    A plan at or above ``plans.ceiling`` is skipped. With none left, ``next_reset`` says when
    the first window resets.
    """
    open_plans = [plan for plan in plans if plan.used < ceiling]
    if open_plans:
        best = max(open_plans, key=lambda plan: (pace(plan, ceiling, now), -plan.used, plan.id))
        return PlanChoice(best, None, ceiling, now)
    resets = sorted(plan.resets_at for plan in plans if plan.resets_at)
    return PlanChoice(None, resets[0] if resets else None, ceiling, now)


def describe_plan(plan: Plan, ceiling: float, now: datetime) -> dict:
    return {
        "id": plan.id,
        "provider": plan.provider,
        "used": plan.used,
        "elapsed": plan.elapsed,
        "room": plan.room,
        # The room pace spends: percent of the window left below plans.ceiling.
        "left": round(max(0.0, ceiling - plan.used), 2),
        # Percent of the window to spend a day to reach the ceiling at the reset; highest first.
        "pace": round(pace(plan, ceiling, now), 2),
        "daysToReset": round(days_to_reset(plan, now), 2),
        "aboveCeiling": plan.used >= ceiling,
        "resetsAt": plan.resets_at,
    }


def read_plans(factory: Factory) -> list[Plan]:
    try:
        plans = factory.world.plans.read()
        if not plans:
            raise WorldError("no weekly plan windows")
        return plans
    except WorldError as exc:
        raise Refusal(
            "PLANS_UNREADABLE",
            f"Cannot read the plans' weekly windows: {exc}",
            "Open T3 Code so it refreshes its usage caches, then retry",
        ) from exc


#: Providers whose plans run Claude Code: T3 Code's cache name, and the provider's own name.
CLAUDE_PROVIDERS = frozenset({"claudeAgent", "anthropic"})


def cell_plans(plans: list[Plan], overrides: dict) -> list[Plan]:
    """The plans a cell may start on: only Claude's while ``cells.claudeOnly`` is on, since
    cells implement on Opus (the owner's route of 2026-11-17)."""
    if dials.value(overrides, "cells.claudeOnly"):
        return [plan for plan in plans if plan.provider in CLAUDE_PROVIDERS]
    return plans


def no_plan_reason(plans: list[Plan], choice: PlanChoice, overrides: dict) -> tuple[str, str, str]:
    """Why no plan was chosen, as a refusal code, message and suggestion: no Claude plan at
    all, or every plan a cell may take at its ceiling."""
    if not plans and dials.value(overrides, "cells.claudeOnly"):
        return (
            "NO_CLAUDE_PLAN",
            "No Claude plan is signed in on this host, and cells.claudeOnly keeps cells on Claude",
            "Sign in to Claude in T3 Code on the lane host, or dial-set cells.claudeOnly false to "
            "start cells on any plan",
        )
    which = "Claude plan" if dials.value(overrides, "cells.claudeOnly") else "plan"
    return (
        "PLAN_ABOVE_CEILING",
        f"Every {which} is at or above plans.ceiling ({_percent(choice.ceiling)})",
        f"Start nothing until the next window resets at "
        f"{choice.next_reset or 'an unknown time'}; lane-status says when canStartCell returns",
    )


def seated(state: dict) -> list[dict]:
    return [cell for cell in state["cells"] if cell.get("state", "working") in SEATED_STATES]


def _validate(issues: list[int], branch: str, route: str) -> None:
    problems = []
    if not issues:
        problems.append("issues is empty")
    if any(not isinstance(n, int) or isinstance(n, bool) or n < 1 for n in issues):
        problems.append("issues must be issue numbers")
    if len(set(issues)) != len(issues):
        problems.append("issues lists an issue twice")
    if not branch.strip() or any(c.isspace() for c in branch) or branch.startswith("-"):
        problems.append("branch must be a branch name")
    if not route.strip():
        problems.append("route must name a model route, e.g. opus/medium")
    if problems:
        raise Refusal(
            "VALIDATION_ERROR",
            "; ".join(problems),
            "Pass issues (one issue number by default), the cell's branch and its route",
        )


def _check_issue_count(issues: list[int], overrides: dict, related_because: str | None) -> None:
    most = dials.value(overrides, "cells.issuesMax")
    if len(issues) > most:
        raise Refusal(
            "TOO_MANY_ISSUES",
            f"{len(issues)} issues for one cell; cells.issuesMax is {most}",
            "Register one cell per issue, or raise cells.issuesMax with dial-set for a package "
            "of issues that share files and pass related_because",
        )
    if len(issues) > 1 and not (related_because or "").strip():
        raise Refusal(
            "TOO_MANY_ISSUES",
            f"Issues {', '.join(f'#{n}' for n in issues)} share a cell without a reason",
            "Pass related_because, saying what the issues share (the files or the change), or "
            "register one cell per issue",
        )


def _check_issues(factory: Factory, issues: list[int]):
    backlog = read_backlog(factory, issues)
    by_number = {issue.number: issue for issue in backlog.issues}
    for number in issues:
        issue = by_number[number]
        if number in backlog.claims:
            claim = backlog.claims[number]
            holder = (
                f"{claim.branch} ({claim.machine}, lease until {claim.lease_until}"
                f"{', expired' if claim.expired(backlog.now) else ''})"
                if claim
                else "an unknown holder (status:in-progress without a claim comment)"
            )
            raise Refusal(
                "ALREADY_CLAIMED",
                f"Issue #{number} is claimed by {holder}",
                "Take another issue from issue-check's dispatchable list; an expired or "
                "unrecorded claim shows in issue-check's staleClaims for the foreman to release",
                holder=claim.describe() if claim else None,
            )
        reasons = not_dispatchable_reasons(backlog, issue)
        if reasons:
            raise Refusal(
                "NOT_DISPATCHABLE",
                f"Issue #{number} cannot be taken: {'; '.join(reasons)}",
                "Run triage-issues to plan it (one execution profile, no open owner question), "
                "or take an issue from issue-check's dispatchable list",
                reasons=reasons,
            )
    return backlog


def _check_capacity(factory: Factory, state: dict) -> PlanChoice:
    overrides = state["dials"]
    most = dials.value(overrides, "cells.max")
    if len(seated(state)) >= most:
        raise Refusal(
            "CELLS_FULL",
            f"{len(seated(state))} cells hold seats; cells.max is {most}",
            "Start the cell when a seat frees: lane-wait reports merged and queue-room events, "
            "and lane-status says canStartCell",
        )
    plans = cell_plans(read_plans(factory), overrides)
    choice = choose_plan(plans, dials.value(overrides, "plans.ceiling"), factory.world.clock.now())
    if choice.plan is None:
        code, message, suggestion = no_plan_reason(plans, choice, overrides)
        raise Refusal(
            code,
            message,
            suggestion,
            nextReset=choice.next_reset,
        )
    floor = dials.value(overrides, "host.minFreeGb")
    free = factory.world.machine.free_memory_gb()
    if free < floor:
        raise Refusal(
            "HOST_LOADED",
            f"{free:g} GB of memory is free on {factory.world.machine.id()}; host.minFreeGb is "
            f"{floor:g}",
            "Wait for running work to finish (lane-wait), or lower host.minFreeGb with dial-set "
            "if the host can spare it",
        )
    return choice


def register(
    factory: Factory,
    issues: list[int],
    branch: str,
    route: str,
    thread: str | None,
    related_because: str | None = None,
):
    """Claim ``issues`` for a new cell on ``branch`` and record it; the cell is returned.

    More than one issue is a package the foreman names: ``related_because`` says why they share
    a cell, and ``cells.issuesMax`` caps the count.
    """
    _validate(issues, branch, route)
    with factory.store.update(f"cell-register {branch}") as state:
        _check_issue_count(issues, state["dials"], related_because)
        if any(cell["branch"] == branch for cell in state["cells"]):
            raise Refusal(
                "ALREADY_EXISTS",
                f"A cell is already registered for {branch}",
                f"Register under another branch name, or lane-drop {branch} first",
            )
        # The host's limits first: a loaded host refuses before anything is read from GitHub.
        choice = _check_capacity(factory, state)
        backlog = _check_issues(factory, issues)
        world = factory.world
        now = world.clock.now()
        hours = dials.value(state["dials"], "claims.leaseHours")
        claim = Claim(branch, world.machine.id(), format_time(now + timedelta(hours=hours)))
        _claim(factory, issues, claim)
        cell = {
            "branch": branch,
            "issues": list(issues),
            "route": route,
            "thread": thread,
            "plan": choice.plan.id,
            "state": "registered",
            "ejections": 0,
            "registeredAt": format_time(now),
            "leaseUntil": claim.lease_until,
            "machine": claim.machine,
        }
        package = {"relatedBecause": (related_because or "").strip()} if len(issues) > 1 else {}
        cell.update(package)
        state["cells"].append(cell)
        answer(state, "cell-register", format_time(now))
        profiles = [
            label.removeprefix("execution:")
            for issue in backlog.issues
            for label in issue.labels
            if label.startswith("execution:")
        ]
        factory.store.append_record(
            records.make(
                "cell-registered",
                format_time(now),
                state["lane"].get("runId"),
                branch=branch,
                issues=list(issues),
                plan=choice.plan.id,
                route=route,
                profile=profiles[0] if profiles else "unknown",
                **package,
            )
        )
    return cell


def find(state: dict, branch: str) -> dict:
    cell = next((c for c in state["cells"] if c.get("branch") == branch), None)
    if cell is None:
        raise Refusal(
            "NOT_FOUND",
            f"No cell is registered for {branch}",
            "lane-status lists the cells; register one with cell-register",
        )
    return cell


def attach(factory: Factory, branch: str, thread: str) -> dict:
    """Record the T3 Code thread delegate_task returned for a registered cell."""
    if not thread.strip():
        raise Refusal(
            "VALIDATION_ERROR", "thread is empty", "Pass the thread delegate_task returned"
        )
    with factory.store.update(f"cell-attach {branch}") as state:
        cell = find(state, branch)
        cell["thread"] = thread
        if cell.get("state") == "registered":
            cell["state"] = "working"
    return cell


def gate_allow(factory: Factory, branch: str, reason: str) -> dict:
    """Record that a diagnosis found the repair's gate edit to be the right one.

    Only the foreman calls it (the factory host), after a diagnosis on the stronger route;
    there is no caller-supplied bypass on lane-enqueue itself.
    """
    if not reason.strip():
        raise Refusal("VALIDATION_ERROR", "reason is empty", "Say what the diagnosis found")
    with factory.store.update(f"gate-allow {branch}") as state:
        cell = find(state, branch)
        cell["gateAllowed"] = {"reason": reason, "at": format_time(factory.world.clock.now())}
    return {"allowed": True, "branch": branch}


def ejection_excuse(factory: Factory, branch: str, reason: str) -> dict:
    """Record that the cell's latest ejection was not its branch's fault, so it stops counting
    toward ``cells.maxEjections``.

    The foreman's call after a diagnosis, for a known flake (a check that fails on main too) or
    trouble outside the branch the lane could not tell apart. Ejections whose cause is already
    excused (``conflict`` and the push, PR and merge plumbing) need none. Excusing the ejection
    that reached the limit answers the open ``ejection-limit`` event; the ``ejected`` event is
    still answered by a re-enqueue or a drop.
    """
    if not reason.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "reason is empty",
            "Say why the ejection was not the branch's fault, e.g. the flake's issue",
        )
    with factory.store.update(f"ejection-excuse {branch}") as state:
        cell = find(state, branch)
        latest = cell.get("lastEjection")
        if latest is None and int(cell.get("ejections", 0)) > 0:
            # Ejected before the lane kept the latest ejection on the cell: read it back.
            found = last_ejection(factory.store.read_records(), branch) or {}
            if "attempt" in found:
                latest = {"attempt": found["attempt"], "cause": found.get("cause")}
                latest["excused"] = None if found.get("counted", True) else found.get("excuse")
        if latest is None:
            raise Refusal(
                "NOT_FOUND",
                f"{branch} has no ejection to excuse",
                "lane-status shows each cell's ejections; excuse one after it is ejected",
            )
        if latest.get("excused"):
            raise Refusal(
                "ALREADY_EXCUSED",
                f"{branch}'s latest ejection (attempt {latest['attempt']}, {latest.get('cause')}) "
                f"is already excused: {latest['excused']}",
                "Nothing to do: it does not count toward cells.maxEjections",
            )
        now = format_time(factory.world.clock.now())
        latest = {**latest, "excused": reason, "excusedAt": now}
        cell["lastEjection"] = latest
        cell["excused"] = int(cell.get("excused", 0)) + 1
        limit = dials.value(state["dials"], "cells.maxEjections")
        counted = counted_ejections(cell)
        answered = answer(state, "ejection-excuse", now, branch=branch) if counted < limit else []
        factory.store.append_record(
            records.make(
                "ejection-excused",
                now,
                state["lane"].get("runId"),
                branch=branch,
                attempt=latest["attempt"],
                cause=latest.get("cause") or "unknown",
                reason=reason,
            )
        )
    return {
        "branch": branch,
        "attempt": latest["attempt"],
        "cause": latest.get("cause"),
        "ejections": int(cell.get("ejections", 0)),
        "excused": cell["excused"],
        "counted": counted,
        "limit": limit,
        "answered": answered,
    }


def drop(factory: Factory, branch: str, reason: str) -> dict:
    """Dequeue the branch, release its claims and forget the cell; its worktree is left alone.

    Each issue goes back to ``status:planned`` with one release comment. A drop that frees the
    last seat opens a ``queue-room`` event; the ejections it answers are closed.
    """
    if not reason.strip():
        raise Refusal("VALIDATION_ERROR", "reason is empty", "Say why the cell is dropped")
    with factory.store.update(f"lane-drop {branch}") as state:
        cell = find(state, branch)
        was_full = len(seated(state)) >= dials.value(state["dials"], "cells.max")
        held_seat = cell in seated(state)
        for entry in [*state["queue"], *state["held"]]:
            if entry["branch"] == branch:
                if entry.get("run"):
                    factory.world.processes.kill(entry["run"])
                factory.world.git.delete_queue_ref(branch, entry["head"])
        released = _release(factory, cell, reason)
        now = format_time(factory.world.clock.now())
        state["cells"].remove(cell)
        for listing in (state["queue"], state["held"]):
            listing[:] = [entry for entry in listing if entry.get("branch") != branch]
        answered = answer(state, "lane-drop", now, branch=branch)
        if was_full and held_seat:
            emit(
                state, now, "queue-room", branch=branch, detail=f"A seat is free: {branch} dropped"
            )
        factory.store.append_record(
            records.make("dropped", now, state["lane"].get("runId"), branch=branch, reason=reason)
        )
    return {"dropped": True, "released": released, "answered": answered}


def _release(factory: Factory, cell: dict, reason: str) -> list[int]:
    """Put each issue the cell claimed back to status:planned, with one release comment."""
    released: list[int] = []
    github = factory.world.github
    for number in cell.get("issues", []):
        try:
            github.edit_labels(number, add=[PLANNED], remove=[IN_PROGRESS])
            github.add_comment(number, release_body(cell["branch"], reason))
        except WorldError as exc:
            raise Refusal(
                "WRITE_FAILED",
                f"Releasing #{number} from {cell['branch']} failed: {exc}. Released before it: "
                f"{', '.join(f'#{n}' for n in released) or 'none'}",
                "The cell was kept. Check `gh auth status`, then lane-drop again",
                released=released,
            ) from exc
        released.append(number)
    return released


def _claim(factory: Factory, issues: list[int], claim: Claim) -> None:
    """Label each issue and post its claim comment.

    A failed write puts back what this call wrote, so a package that failed on its second issue
    leaves no live claim on the first; the refusal names anything it could not put back.
    """
    github = factory.world.github
    labelled: list[int] = []
    commented: list[int] = []
    for number in issues:
        try:
            # A dispatchable issue carries status:planned and no other status label.
            github.edit_labels(number, add=[IN_PROGRESS], remove=[PLANNED])
            labelled.append(number)
            github.add_comment(number, claim_body(claim))
            commented.append(number)
        except WorldError as exc:
            left = _unclaim(factory, labelled, commented, claim.branch)
            raise Refusal(
                "WRITE_FAILED",
                f"Claiming #{number} for {claim.branch} failed: {exc}. "
                + (
                    f"Could not put back: {', '.join(left)}"
                    if left
                    else "Every claim it wrote was put back"
                ),
                "No cell was recorded. Check `gh auth status`, then register again"
                + (
                    "; issue-check lists what was left claimed in staleClaims once its lease "
                    "runs out, or release it by hand"
                    if left
                    else ""
                ),
                left=left,
            ) from exc


def _unclaim(factory: Factory, labelled: list[int], commented: list[int], branch: str) -> list[str]:
    """Undo a failed registration's claims; what could not be undone is returned."""
    github = factory.world.github
    left: list[str] = []
    for number in labelled:
        try:
            if number in commented:
                github.add_comment(number, release_body(branch, "registration failed"))
            github.edit_labels(number, add=[PLANNED], remove=[IN_PROGRESS])
        except WorldError:
            left.append(f"#{number}")
    return left


def _percent(value: float) -> str:
    return f"{value:g}%"
