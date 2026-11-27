"""Cells: registering one claims its issues on GitHub and assigns it a plan.

Registration is reserve, then start: the foreman calls ``cell-register`` before
``delegate_task``, so a refusal costs nothing, then ``cell-attach`` with the thread. Every limit
is checked before anything is written, under the state lock, so two registrations cannot both
take the last seat or issue. ``lane-drop`` releases the claims and forgets the cell;
``gate-allow`` records a diagnosis that lets a repair edit a gate.
"""

from __future__ import annotations

import contextlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import PurePath
from typing import Any, cast

from botcore_factory import change_report, dials, records
from botcore_factory.claims import (
    Claim,
    claim_body,
    format_time,
    live_claim_beside,
    parse_time,
    release_body,
)
from botcore_factory.events import answer, emit
from botcore_factory.intake import Backlog, not_dispatchable_reasons, read_backlog
from botcore_factory.labels import IN_PROGRESS, PLANNED
from botcore_factory.lane_base import MERGE_QUEUED, counted_ejections
from botcore_factory.lock import HostLock
from botcore_factory.runtime import EXTERNAL, STOP, Factory, Refusal, call, fix_input
from botcore_factory.world import Plan, WorldError

#: Cell states that hold a seat; a parked cell (waiting on the owner) frees its seat, and so
#: does an ejected one that waits on the owner toward ``cells.max`` (``holding_seats``).
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


def describe_plan(plan: Plan, ceiling: float, now: datetime) -> dict[str, Any]:
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
            recovery=EXTERNAL,
        ) from exc


#: Providers whose plans run Claude Code: T3 Code's cache name, and the provider's own name.
CLAUDE_PROVIDERS = frozenset({"claudeAgent", "anthropic"})


def cell_plans(plans: list[Plan], overrides: dict[str, Any]) -> list[Plan]:
    """The plans a cell may start on: only Claude's while ``cells.claudeOnly`` is on, since
    cells implement on Opus (the owner's route of 2026-11-17)."""
    if dials.value(overrides, "cells.claudeOnly"):
        return [plan for plan in plans if plan.provider in CLAUDE_PROVIDERS]
    return plans


def no_plan_reason(
    plans: list[Plan], choice: PlanChoice, overrides: dict[str, Any]
) -> tuple[str, str, str]:
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


def waits_on_owner(cell: dict[str, Any], overrides: dict[str, Any]) -> bool:
    """An ejected cell whose own failures reached ``cells.maxEjections``: its foreman stops
    and the owner decides (an ``ejection-excuse``, a re-enqueue or a drop), so it frees its
    seat until then (lushly-dev/afd#1593). An ejected cell under the limit, which its foreman
    is repairing, keeps its seat; an excuse that brings it under the limit seats it again."""
    return cell.get("state") == "ejected" and counted_ejections(cell) >= dials.value(
        overrides, "cells.maxEjections"
    )


def seated(state: dict[str, Any]) -> list[dict[str, Any]]:
    """The cells still active: not parked. The lane is idle, and its host free to move, only
    with none."""
    return [cell for cell in state["cells"] if cell.get("state", "working") in SEATED_STATES]


def holding_seats(state: dict[str, Any]) -> list[dict[str, Any]]:
    """The cells that count toward ``cells.max``: the active ones, less those that wait on the
    owner."""
    return [cell for cell in seated(state) if not waits_on_owner(cell, state["dials"])]


#: Where the lane's slots keep their build output; empty keeps it beside the slots.
BUILD_DIR_DIAL = "host.buildDir"


@dataclass(frozen=True)
class DiskShort:
    """Free disk below ``host.minFreeDiskGb`` where cells and the lane's slots build."""

    free: float
    floor: float
    where: str
    machine: str

    @property
    def message(self) -> str:
        return (
            f"{self.free:g} GB of disk is free on {self.machine} at {self.where}; "
            f"host.minFreeDiskGb is {self.floor:g}"
        )

    @property
    def suggestion(self) -> str:
        return (
            f"Free disk on that volume: {self.where} holds the lane's slots or their build "
            "output (Rust target directories reach tens of GB: `du -sh` them; a slot's is "
            "removed when it takes another branch), point host.buildDir at a data volume, or "
            "lower host.minFreeDiskGb with dial-set if the host can spare it"
        )


def build_root(factory: Factory, overrides: dict[str, Any]) -> str:
    """Where the lane's slots keep their build output (lushly-dev/afd#1641): under
    ``host.buildDir`` when set (a data volume), in ``<slots' folder name>-build``, else
    ``.build`` in the slots' directory. Never the slots' directory itself: with the repository
    on that volume, ``<host.buildDir>/<slots' folder name>`` is where its slots are checked out.
    A ``host.buildDir`` that is not a directory raises WorldError: an unmounted volume's mount
    point would put the build on the system disk."""
    slots = factory.world.git.slots_dir()
    chosen = dials.value(overrides, BUILD_DIR_DIAL)
    if chosen:
        if not factory.world.machine.is_dir(chosen):
            raise WorldError(
                f"host.buildDir {chosen} is not a directory on {factory.world.machine.id()}: "
                "mount its volume or create it, or set host.buildDir to an empty string with "
                "dial-set, then lane-resume"
            )
        return str(PurePath(chosen) / f"{PurePath(slots).name}-build")
    return str(PurePath(slots) / ".build")


def build_dir(factory: Factory, overrides: dict[str, Any], slot: str) -> str:
    """The slot's own build directory, which its jobs get as ``CARGO_TARGET_DIR``."""
    return str(PurePath(build_root(factory, overrides)) / slot)


def disk_short(factory: Factory, overrides: dict[str, Any]) -> DiskShort | None:
    """Whether free disk where the lane's slots build is below ``host.minFreeDiskGb``: a full
    disk ejected a good branch mid-build (lushly-dev/afd#1565), so it refuses work instead.
    Both the slots' directory and, when ``host.buildDir`` names another, the build output's are
    read; the shorter is reported. A floor of 0 reads nothing; a failed read refuses
    ``DISK_UNREADABLE``."""
    floor = dials.value(overrides, "host.minFreeDiskGb")
    if floor <= 0:
        return None
    world = factory.world
    try:
        places = [world.git.slots_dir()]
        if dials.value(overrides, BUILD_DIR_DIAL):
            places.append(build_root(factory, overrides))
        free, where = min((world.machine.free_disk_gb(place), place) for place in places)
    except WorldError as exc:
        raise Refusal(
            "DISK_UNREADABLE",
            f"Cannot read free disk where the lane's slots build: {exc}",
            "Fix what the message names (the lane's slots go beside the checkout, so a checkout "
            "at a filesystem root or inside a submodule has none; host.buildDir must be on a "
            "mounted volume), or set host.minFreeDiskGb to 0 with dial-set to skip the check",
            recovery=EXTERNAL,
        ) from exc
    if free >= floor:
        return None
    return DiskShort(round(free, 1), floor, where, world.machine.id())


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
            recovery=fix_input("issues", "branch", "route"),
        )


def _check_issue_count(
    issues: list[int], overrides: dict[str, Any], related_because: str | None
) -> None:
    most = dials.value(overrides, "cells.issuesMax")
    if len(issues) > most:
        raise Refusal(
            "TOO_MANY_ISSUES",
            f"{len(issues)} issues for one cell; cells.issuesMax is {most}",
            "Register one cell per issue, or raise cells.issuesMax with dial-set for a package "
            "of issues that share files and pass related_because",
            recovery=fix_input("issues"),
        )
    if len(issues) > 1 and not (related_because or "").strip():
        raise Refusal(
            "TOO_MANY_ISSUES",
            f"Issues {', '.join(f'#{n}' for n in issues)} share a cell without a reason",
            "Pass related_because, saying what the issues share (the files or the change), or "
            "register one cell per issue",
            recovery=fix_input("related_because"),
        )


def _check_issues(factory: Factory, issues: list[int]) -> Backlog:
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
                recovery=call("issue-check"),
                holder=claim.describe() if claim else None,
            )
        reasons = not_dispatchable_reasons(backlog, issue)
        if reasons:
            raise Refusal(
                "NOT_DISPATCHABLE",
                f"Issue #{number} cannot be taken: {'; '.join(reasons)}",
                "Run triage-issues to plan it (one execution profile, no open owner question), "
                "or take an issue from issue-check's dispatchable list",
                recovery=call("issue-check"),
                reasons=reasons,
            )
    return backlog


def _check_capacity(factory: Factory, state: dict[str, Any]) -> PlanChoice:
    overrides = state["dials"]
    most = dials.value(overrides, "cells.max")
    if len(holding_seats(state)) >= most:
        raise Refusal(
            "CELLS_FULL",
            f"{len(holding_seats(state))} cells hold seats; cells.max is {most}",
            "Start the cell when a seat frees: lane-wait reports merged and queue-room events, "
            "and lane-status says canStartCell",
            recovery=call("lane-status"),
        )
    plans = cell_plans(read_plans(factory), overrides)
    choice = choose_plan(plans, dials.value(overrides, "plans.ceiling"), factory.world.clock.now())
    if choice.plan is None:
        code, message, suggestion = no_plan_reason(plans, choice, overrides)
        raise Refusal(
            code,
            message,
            suggestion,
            recovery=EXTERNAL,
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
            recovery=EXTERNAL,
        )
    short = disk_short(factory, overrides)
    if short is not None:
        raise Refusal(
            "DISK_LOW", short.message, short.suggestion, recovery=EXTERNAL, freeDiskGb=short.free
        )
    return choice


def register(
    factory: Factory,
    issues: list[int],
    branch: str,
    route: str,
    thread: str | None,
    related_because: str | None = None,
    guard: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Claim ``issues`` for a new cell on ``branch`` and record it; the cell is returned.

    More than one issue is a package the foreman names: ``related_because`` says why they share
    a cell, and ``cells.issuesMax`` caps the count. ``guard`` (the foreman's session check) runs
    first inside the transaction.
    """
    _validate(issues, branch, route)
    with factory.store.update(f"cell-register {branch}") as state:
        if guard is not None:
            guard(state)
        _check_issue_count(issues, state["dials"], related_because)
        if any(cell["branch"] == branch for cell in state["cells"]):
            raise Refusal(
                "ALREADY_EXISTS",
                f"A cell is already registered for {branch}",
                f"Register under another branch name, or lane-drop {branch} first",
                recovery=fix_input("branch"),
            )
        # The host's limits first: a loaded host refuses before anything is read from GitHub.
        choice = _check_capacity(factory, state)
        if choice.plan is None:
            raise RuntimeError("capacity check returned without a selected plan")
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
            # every thread that works on the cell, for the fold's Factory-session trailers
            "threads": [thread] if thread and thread.strip() else [],
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


def threads(cell: dict[str, Any] | None) -> list[str]:
    """Every T3 Code thread that has worked on a cell, first to last: the lane names each in
    the commit it folds the branch into (``Factory-session:``, lushly-dev/afd#1887). None for a
    cell registered before the list was kept, whose earlier threads are not known: naming only
    its latest could make another thread's change read as a miss."""
    found = cell.get("threads") if cell else None
    out: list[str] = []
    for thread in found if isinstance(found, list) else []:
        if isinstance(thread, str) and thread.strip() and thread not in out:
            out.append(thread)
    return out


def find(state: dict[str, Any], branch: str) -> dict[str, Any]:
    cell = next((c for c in state["cells"] if c.get("branch") == branch), None)
    if cell is None:
        raise Refusal(
            "NOT_FOUND",
            f"No cell is registered for {branch}",
            "lane-status lists the cells; register one with cell-register",
            recovery=call("lane-status"),
        )
    return cast("dict[str, Any]", cell)


def attach(factory: Factory, branch: str, thread: str) -> dict[str, Any]:
    """Record the T3 Code thread delegate_task returned for a registered cell."""
    if not thread.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "thread is empty",
            "Pass the thread delegate_task returned",
            recovery=fix_input("thread"),
        )
    with factory.store.update(f"cell-attach {branch}") as state:
        cell = find(state, branch)
        cell["thread"] = thread
        # A cell registered before the list was kept may have had other threads: its history
        # stays unknown, and its fold names nobody rather than only some (lushly-dev/afd#1887).
        if isinstance(cell.get("threads"), list) and thread not in cell["threads"]:
            cell["threads"].append(thread)
        if cell.get("state") == "registered":
            cell["state"] = "working"
    return cell


def gate_allow(
    factory: Factory,
    branch: str,
    reason: str,
    guard: Callable[[dict[str, Any]], None] | None,
    head: str,
) -> dict[str, Any]:
    """Record that a diagnosis found the repair's gate edit to be the right one, for one head.

    Only the live foreman calls it (the factory host), after a diagnosis on the stronger route.
    It covers ``head``, the commit it diagnosed (the cell's ``GATE_EDIT_IN_REPAIR`` names it),
    and no other: never the worktree's head now, which the cell may have moved since, and a later
    commit needs a new diagnosis.
    """
    if not reason.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "reason is empty",
            "Say what the diagnosis found",
            recovery=fix_input("reason"),
        )
    if not head.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "head is empty",
            "Pass the commit you diagnosed, which the cell's GATE_EDIT_IN_REPAIR names",
            recovery=fix_input("head"),
        )
    head = head.strip()
    with factory.store.update(f"gate-allow {branch}") as state:
        if guard is not None:
            guard(state)
        cell = find(state, branch)
        cell["gateAllowed"] = {
            "reason": reason,
            "head": head,
            "at": format_time(factory.world.clock.now()),
        }
    return {"allowed": True, "branch": branch, "head": head}


def measure_approve(factory: Factory, branch: str, reason: str) -> dict[str, Any]:
    """Release a branch held for ``gate-change`` or ``measure-change`` to the queue.

    Only served on the ``factory`` host (never ``factory-cell``); approves the exact held
    head so a later commit on the branch re-triggers the hold. When the queue is full at
    approval time, the entry converts to a ``queue-full`` hold so ``queue_held`` promotes it
    as soon as room opens.
    """
    if not reason.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "reason is empty",
            "Say why the change is approved",
            recovery=fix_input("reason"),
        )
    with factory.store.update(f"measure-approve {branch}") as state:
        held = next(
            (
                entry
                for entry in state["held"]
                if entry.get("branch") == branch
                and entry.get("holdReason") in change_report.OWNER_HOLD_REASONS
            ),
            None,
        )
        if held is None:
            raise Refusal(
                "NOT_FOUND",
                f"{branch} is not held for gate-change or measure-change",
                "lane-status lists held branches and their holdReason",
                recovery=call("lane-status"),
            )
        now = format_time(factory.world.clock.now())
        head = held.get("head", "")
        state["held"].remove(held)
        for key in ("holdReason", "holdReasons", "holdDetail"):
            held.pop(key, None)
        cell = next((c for c in state["cells"] if c.get("branch") == branch), None)
        if cell is not None:
            cell["gateChangeApproved"] = {"head": head, "reason": reason.strip(), "at": now}
        most = dials.value(state["dials"], "lane.queueMax")
        if len(state["queue"]) < most:
            held["state"] = "queued"
            state["queue"].append(held)
            if cell is not None:
                cell["state"] = "queued"
            placed = "queued"
            factory.store.append_record(
                records.make(
                    "queued",
                    now,
                    state["lane"].get("runId"),
                    branch=branch,
                    attempt=held.get("attempt", 1),
                )
            )
        else:
            held["state"] = "held"
            held["holdReason"] = "queue-full"
            state["held"].append(held)
            if cell is not None:
                cell["state"] = "held"
            placed = "held"
        answered = answer(state, "measure-approve", now, branch=branch)
    result = {
        "approved": True,
        "branch": branch,
        "head": head,
        "state": placed,
        "answered": answered,
    }
    if placed == "held":
        result["holdReason"] = "queue-full"
    return result


def ejection_excuse(
    factory: Factory,
    branch: str,
    reason: str,
    guard: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
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
            recovery=fix_input("reason"),
        )
    with factory.store.update(f"ejection-excuse {branch}") as state:
        if guard is not None:
            guard(state)
        cell = find(state, branch)
        latest = cell.get("lastEjection")
        if latest is None and int(cell.get("ejections", 0)) > 0:
            # Ejected before the lane kept the latest ejection on the cell: read it back.
            found = factory.store.last_ejection(branch) or {}
            if "attempt" in found:
                latest = {"attempt": found["attempt"], "cause": found.get("cause")}
                latest["excused"] = None if found.get("counted", True) else found.get("excuse")
        if latest is None:
            raise Refusal(
                "NOT_FOUND",
                f"{branch} has no ejection to excuse",
                "lane-status shows each cell's ejections; excuse one after it is ejected",
                recovery=call("lane-status"),
            )
        if latest.get("excused"):
            raise Refusal(
                "ALREADY_EXCUSED",
                f"{branch}'s latest ejection (attempt {latest['attempt']}, {latest.get('cause')}) "
                f"is already excused: {latest['excused']}",
                "Nothing to do: it does not count toward cells.maxEjections",
                recovery=STOP,
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


def drop(
    factory: Factory,
    branch: str,
    reason: str,
    guard: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Dequeue the branch, release its claims and forget the cell; its worktree is left alone.

    Each issue gets one release comment and goes back to ``status:planned``, unless another
    branch's live claim still holds it. A drop that frees the last seat opens a ``queue-room``
    event; the ejections it answers are closed.
    """
    if not reason.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "reason is empty",
            "Say why the cell is dropped",
            recovery=fix_input("reason"),
        )
    with factory.store.update(f"lane-drop {branch}") as state:
        if guard is not None:
            guard(state)
        cell = find(state, branch)
        for entry in state["queue"]:
            if entry["branch"] != branch:
                continue
            entry_state = entry.get("state")
            if entry_state == MERGE_QUEUED:
                raise Refusal(
                    "MERGE_QUEUED",
                    f"{branch} is in GitHub's merge queue as PR {entry.get('pr')}: it would "
                    "merge there after the lane forgot it",
                    "Wait: the lane lands it when it merges and ejects it when it leaves the "
                    "queue. To stop it, remove the pull request from the merge queue on "
                    "GitHub, lane-resume if the lane is paused, wait for its `ejected` event "
                    "(a minute or two), then lane-drop",
                    recovery=EXTERNAL,
                )
            if entry_state == "merging" and entry.get("pr"):
                pr = entry["pr"]
                progress = factory.world.github.merge_progress(pr)
                settling_merged = (
                    progress.state == "OPEN" and progress.removal_reason.strip().lower() == "merged"
                )
                if progress.state == "MERGED" or settling_merged:
                    raise Refusal(
                        "MERGE_QUEUED",
                        f"{branch} has already merged (or is settling as merged) on GitHub as "
                        f"PR {pr}: dropping it would lose its landing record and reopen its "
                        "issues",
                        "Wait for the lane to land it (lane-resume if paused); do not drop a "
                        "merged pull request",
                        recovery=EXTERNAL,
                    )
                if progress.pending:
                    if progress.queued:
                        why = (
                            f"{branch} is in GitHub's merge queue as PR {pr}: it would merge "
                            "there after the lane forgot it"
                        )
                        hint = (
                            "Wait: the lane lands it when it merges and ejects it when it "
                            "leaves the queue. To stop it, remove the pull request from the "
                            "merge queue on GitHub, lane-resume if the lane is paused, wait "
                            "for its `ejected` event (a minute or two), then lane-drop"
                        )
                    else:
                        why = (
                            f"{branch} has auto-merge enabled on GitHub as PR {pr}: GitHub "
                            "could merge it after the lane forgot it"
                        )
                        hint = (
                            "Wait for the lane to track it, or disable auto-merge on GitHub "
                            "first, then lane-drop"
                        )
                    raise Refusal("MERGE_QUEUED", why, hint, recovery=EXTERNAL)
        was_full = len(holding_seats(state)) >= dials.value(state["dials"], "cells.max")
        held_seat = cell in holding_seats(state)
        dropped_slots = [
            entry["slot"]
            for entry in state["queue"]
            if entry["branch"] == branch
            and entry.get("state") == "validating"
            and entry.get("slot")
        ]
        for entry in [*state["queue"], *state["held"]]:
            if entry["branch"] == branch:
                if entry.get("run"):
                    factory.world.processes.kill(entry["run"])
                factory.world.git.delete_queue_ref(branch, entry["head"])
        released = _release(factory, cell, reason)
        if dropped_slots and factory.world.validation_lock is not None:
            lane_pid = state["lane"].get("pid")
            if lane_pid is None:
                holder = HostLock(
                    factory.store.root.parent / "lane.lock", factory.world.processes
                ).live_holder()
                repo = factory.world.github.repository()
                if holder is not None and holder.get("repository") in (None, repo):
                    lane_pid = holder.get("pid")
            if isinstance(lane_pid, int) and not isinstance(lane_pid, bool):
                with contextlib.suppress(WorldError):
                    repo = factory.world.github.repository()
                    for slot in dropped_slots:
                        factory.world.validation_lock.release(f"slot:{slot}", repo, lane_pid)
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


def _open_pr_branches(factory: Factory) -> frozenset[str]:
    return frozenset(pr.branch for pr in factory.world.github.open_pull_requests() if pr.branch)


def _held_beside(factory: Factory, number: int, branch: str, with_pr: frozenset[str]) -> bool:
    """Whether another branch's live claim holds ``number`` once ``branch`` lets go.

    The label is then that holder's and stays: without it neither this plugin nor
    scripts/issue-claim.mjs reads the claim, and the issue would be dispatched a second time.
    ``with_pr`` names the branches with an open pull request, read once per release.
    """
    comments = factory.world.github.comments(number)
    return live_claim_beside(comments, branch, factory.world.clock.now(), with_pr) is not None


def _release(factory: Factory, cell: dict[str, Any], reason: str) -> list[int]:
    """Release each issue the cell claimed: one release comment, and status:planned again
    unless another branch's live claim still holds the issue."""
    released: list[int] = []
    github = factory.world.github
    with_pr: frozenset[str] | None = None
    for number in cell.get("issues", []):
        try:
            # The comment first: a label taken off while the claim still stands would let the
            # issue be dispatched with this cell's claim still ahead of the next one.
            github.add_comment(number, release_body(cell["branch"], reason))
            if with_pr is None:
                with_pr = _open_pr_branches(factory)
            if not _held_beside(factory, number, cell["branch"], with_pr):
                github.edit_labels(number, add=[PLANNED], remove=[IN_PROGRESS])
        except WorldError as exc:
            raise Refusal(
                "WRITE_FAILED",
                f"Releasing #{number} from {cell['branch']} failed: {exc}. Released before it: "
                f"{', '.join(f'#{n}' for n in released) or 'none'}",
                "The cell was kept. Check `gh auth status`, then lane-drop again",
                recovery=EXTERNAL,
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
                recovery=EXTERNAL,
                left=left,
            ) from exc


def _unclaim(factory: Factory, labelled: list[int], commented: list[int], branch: str) -> list[str]:
    """Undo a failed registration's claims; what could not be undone is returned."""
    github = factory.world.github
    left: list[str] = []
    with_pr: frozenset[str] | None = None
    for number in labelled:
        try:
            if number in commented:
                github.add_comment(number, release_body(branch, "registration failed"))
            if with_pr is None:
                with_pr = _open_pr_branches(factory)
            if not _held_beside(factory, number, branch, with_pr):
                github.edit_labels(number, add=[PLANNED], remove=[IN_PROGRESS])
        except WorldError:
            left.append(f"#{number}")
    return left


def _percent(value: float) -> str:
    return f"{value:g}%"
