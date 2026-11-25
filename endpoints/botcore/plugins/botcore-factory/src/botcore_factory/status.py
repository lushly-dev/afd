"""The lane's status, and its dials.

``lane-status`` is the foreman's whole memory: the foreman keeps no state of its own. It
carries the fields the proposal names; those whose machinery later PRs build (``orphans``, the
lane process's own liveness) are left out rather than reported empty.
"""

from __future__ import annotations

import difflib
from typing import Any

from botcore_factory import dials, foreman
from botcore_factory.cells import (
    cell_plans,
    choose_plan,
    describe_plan,
    disk_short,
    holding_seats,
    no_plan_reason,
    read_plans,
    waits_on_owner,
)
from botcore_factory.events import open_events, view
from botcore_factory.intake import Backlog, dispatchable, read_backlog
from botcore_factory.labels import NEEDS_OWNER
from botcore_factory.lane_base import counted_ejections
from botcore_factory.runtime import EXTERNAL, Factory, Refusal, call, fix_input, paginate
from botcore_factory.world import LANE_HOST_VARIABLE, WorldError

CELL_FIELDS = (
    "branch",
    "issues",
    "relatedBecause",
    "state",
    "plan",
    "route",
    "ejections",
    "excused",
    "lastEjection",
    "thread",
    "testChanges",
)


def _cell_view(cell: dict[str, Any]) -> dict[str, Any]:
    view = {key: cell.get(key) for key in CELL_FIELDS if key in cell}
    issues = cell.get("issues") or []
    view["issue"] = issues[0] if issues else None
    view.setdefault("ejections", 0)
    view.setdefault("excused", 0)
    # What counts toward cells.maxEjections: the branch's own failures only.
    view["countedEjections"] = counted_ejections(cell)
    return view


def can_start(factory: Factory, state: dict[str, Any], ready: list[int]) -> dict[str, Any]:
    """Whether the foreman may start a cell now: on which plan and issue, or why not."""
    overrides = state["dials"]
    if state["lane"].get("draining"):
        return {"canStartCell": False, "reason": "The lane is draining to move hosts: no new cells"}
    most = dials.value(overrides, "cells.max")
    if len(holding_seats(state)) >= most:
        return {"canStartCell": False, "reason": f"Every seat is taken (cells.max is {most})"}
    try:
        plans = cell_plans(read_plans(factory), overrides)
    except Refusal as refusal:
        return {"canStartCell": False, "reason": refusal.message}
    choice = choose_plan(plans, dials.value(overrides, "plans.ceiling"), factory.world.clock.now())
    if choice.plan is None:
        return {
            "canStartCell": False,
            "reason": no_plan_reason(plans, choice, overrides)[1],
            "nextReset": choice.next_reset,
        }
    floor = dials.value(overrides, "host.minFreeGb")
    free = factory.world.machine.free_memory_gb()
    if free < floor:
        return {
            "canStartCell": False,
            "reason": f"The host is loaded: {free:g} GB free, host.minFreeGb is {floor:g}",
        }
    try:
        short = disk_short(factory, overrides)
    except Refusal as refusal:
        return {"canStartCell": False, "reason": refusal.message}
    if short is not None:
        return {"canStartCell": False, "reason": f"The disk is short: {short.message}"}
    if not ready:
        return {"canStartCell": False, "reason": "Nothing is dispatchable: run triage-issues"}
    return {
        "canStartCell": True,
        "plan": describe_plan(choice.plan, choice.ceiling, choice.now or factory.world.clock.now()),
        "nextIssue": ready[0],
    }


def waiting_on_owner(state: dict[str, Any], backlog: Backlog) -> int:
    """Items only the owner can answer: decision and operator issues (a parked cell's issue
    among them), parked cells and ejected cells at ``cells.maxEjections``, and open events
    that need the owner (a sign-in)."""
    issues = {
        issue.number
        for issue in backlog.open_issues()
        if any(label in issue.labels for label in NEEDS_OWNER)
    }
    issues |= {
        n
        for cell in state["cells"]
        if cell.get("state") == "parked" or waits_on_owner(cell, state["dials"])
        for n in cell["issues"]
    }
    return len(issues) + sum(1 for event in open_events(state) if event.get("needsOwner"))


def lane_status(factory: Factory, limit: int | None, cursor: str | None) -> dict[str, Any]:
    world = factory.world
    state = factory.store.read()
    backlog = read_backlog(factory)
    host_id = world.machine.id()
    lane_host = world.github.get_variable(LANE_HOST_VARIABLE)
    lane = state["lane"]
    lists = {
        "queue": state["queue"],
        "held": state["held"],
        "cells": [_cell_view(cell) for cell in state["cells"] if cell.get("state") != "parked"],
        "openEvents": [view(event) for event in open_events(state)],
    }
    return {
        "runId": lane.get("runId"),
        "host": {"id": host_id, "isLaneHost": lane_host == host_id, "laneHost": lane_host},
        "running": bool(lane.get("running")),
        "paused": bool(lane.get("paused")),
        "pauseReason": lane.get("pauseReason"),
        "waitingOnHostLock": lane.get("waitingOnHostLock"),
        "hostLock": world.validation_lock.status() if world.validation_lock is not None else None,
        "foreman": lane.get("foreman"),
        "draining": bool(lane.get("draining")),
        "slots": {
            "total": dials.value(state["dials"], "lane.slots"),
            # A validated branch that gave its slot up keeps its validation but no slot.
            "busy": sum(
                1
                for entry in state["queue"]
                if entry.get("state") in ("validating", "validated") and entry.get("slot")
            ),
        },
        **paginate(lists, limit, cursor),
        "waitingOnOwner": waiting_on_owner(state, backlog),
        "dials": dials.values(state["dials"]),
        "diskWarnings": world.machine.disk_warnings(),
        **can_start(factory, state, dispatchable(backlog)),
    }


def compact_status(factory: Factory) -> dict[str, Any]:
    """What a woken foreman needs first, carried by every event lane-wait returns.

    The queue length always comes from the lane's state; when GitHub cannot be read, the rest
    is replaced by ``unavailable`` rather than withholding the events.
    """
    state = factory.store.read()
    compact = {"queueLength": len(state["queue"]), "held": len(state["held"])}
    try:
        backlog = read_backlog(factory)
    except (Refusal, WorldError) as exc:
        return {**compact, "unavailable": str(exc)}
    try:
        start = can_start(factory, state, dispatchable(backlog))
    except (Refusal, WorldError) as exc:  # Delivered events are never lost to a failed read.
        return {**compact, "unavailable": str(exc)}
    return {**compact, **start, "waitingOnOwner": waiting_on_owner(state, backlog)}


def plan_list(factory: Factory) -> dict[str, Any]:
    overrides = factory.store.read()["dials"]
    ceiling = dials.value(overrides, "plans.ceiling")
    plans, now = read_plans(factory), factory.world.clock.now()
    described = [describe_plan(plan, ceiling, now) for plan in plans]
    # Every plan is listed; the next is the one a cell would start on.
    chosen = choose_plan(cell_plans(plans, overrides), ceiling, now).plan
    return {"plans": described, "ceiling": ceiling, "next": chosen.id if chosen else None}


def find_dial(key: str) -> dials.Dial:
    if key in dials.DIALS:
        return dials.DIALS[key]
    close = difflib.get_close_matches(key, list(dials.DIALS), n=3)
    raise Refusal(
        "NOT_FOUND",
        f"No dial named {key}",
        f"Use one of: {', '.join(close)}; dial-get with no key lists every dial"
        if close
        else "dial-get with no key lists every dial",
        recovery=call("dial-get"),
    )


def slots_ceiling(factory: Factory) -> tuple[int, str]:
    """The most validation slots the lane host can carry: its record's suggestedSlots."""
    world = factory.world
    host = world.github.get_variable(LANE_HOST_VARIABLE) or world.machine.id()
    for record in world.git.host_records():
        if record.id == host:
            return max(1, record.suggested_slots), host
    return 1, host  # Until a host has been measured, suggestedSlots is 1.


def dial_get(factory: Factory, key: str | None) -> dict[str, Any]:
    overrides = factory.store.read()["dials"]
    if key is None:
        return {
            "dials": [dial.describe(dials.value(overrides, k)) for k, dial in dials.DIALS.items()]
        }
    dial = find_dial(key)
    return dial.describe(dials.value(overrides, key))


def dial_set(factory: Factory, key: str, value: Any, session: str | None = None) -> dict[str, Any]:
    foreman.hold(factory, session, "dial-set", owner_may=True)
    dial = find_dial(key)
    if dial.owner_only:
        raise Refusal(
            "CONFIRMATION_REQUIRED",
            f"{key} is the owner's dial: setting it needs a person's confirmation",
            "Ask the owner to set it; botcore's host does not carry confirmations yet",
            recovery=EXTERNAL,
        )
    maximum, note = None, ""
    if key == "lane.slots":
        maximum, host = slots_ceiling(factory)
        note = f" ({host}'s suggestedSlots is {maximum})"
    problem = dials.check(dial, value, maximum)
    if problem:
        raise Refusal(
            "DIAL_OUT_OF_RANGE",
            problem + note,
            "Pass a value in range; dial-get shows the current value and default",
            recovery=fix_input("value"),
        )
    value = dials.normalize(dial, value)
    with factory.store.update(f"dial-set {key}") as state:
        foreman.check(state, session, "dial-set", factory.world.clock.now(), owner_may=True)
        previous = dials.value(state["dials"], key)
        state["dials"][key] = value
        factory.store.log({"kind": "dial-set", "key": key, "value": value, "previous": previous})
    return {**dial.describe(value), "previous": previous}
