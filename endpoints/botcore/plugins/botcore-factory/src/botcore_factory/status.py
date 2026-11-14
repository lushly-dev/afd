"""The lane's status, and its dials.

``lane-status`` is the foreman's whole memory: the foreman keeps no state of its own. It
carries the fields the proposal names; those whose machinery later PRs build (``orphans``, the
lane process's own liveness) are left out rather than reported empty.
"""

from __future__ import annotations

import difflib

from botcore_factory import dials
from botcore_factory.cells import choose_plan, describe_plan, read_plans, seated
from botcore_factory.intake import dispatchable, read_backlog
from botcore_factory.labels import NEEDS_OWNER
from botcore_factory.runtime import Factory, Refusal, paginate
from botcore_factory.world import LANE_HOST_VARIABLE

EVENT_FIELDS = ("id", "type", "branch", "reason", "detail", "logPath", "needsOwner")
CELL_FIELDS = ("branch", "issues", "state", "plan", "route", "ejections", "thread")


def _cell_view(cell: dict) -> dict:
    view = {key: cell.get(key) for key in CELL_FIELDS if key in cell}
    issues = cell.get("issues") or []
    view["issue"] = issues[0] if issues else None
    view.setdefault("ejections", 0)
    return view


def _event_view(event: dict) -> dict:
    return {key: event[key] for key in EVENT_FIELDS if key in event}


def open_events(state: dict) -> list[dict]:
    return [event for event in state["events"] if event.get("open", True)]


def can_start(factory: Factory, state: dict, ready: list[int]) -> dict:
    """Whether the foreman may start a cell now: on which plan and issue, or why not."""
    overrides = state["dials"]
    if state["lane"].get("draining"):
        return {"canStartCell": False, "reason": "The lane is draining to move hosts: no new cells"}
    most = dials.value(overrides, "cells.max")
    if len(seated(state)) >= most:
        return {"canStartCell": False, "reason": f"Every seat is taken (cells.max is {most})"}
    try:
        choice = choose_plan(read_plans(factory), dials.value(overrides, "plans.ceiling"))
    except Refusal as refusal:
        return {"canStartCell": False, "reason": refusal.message}
    if choice.plan is None:
        return {
            "canStartCell": False,
            "reason": f"Every plan is at or above plans.ceiling ({choice.ceiling:g}%)",
            "nextReset": choice.next_reset,
        }
    floor = dials.value(overrides, "host.minFreeGb")
    free = factory.world.machine.free_memory_gb()
    if free < floor:
        return {
            "canStartCell": False,
            "reason": f"The host is loaded: {free:g} GB free, host.minFreeGb is {floor:g}",
        }
    if not ready:
        return {"canStartCell": False, "reason": "Nothing is dispatchable: run triage-issues"}
    return {
        "canStartCell": True,
        "plan": describe_plan(choice.plan, choice.ceiling),
        "nextIssue": ready[0],
    }


def lane_status(factory: Factory, limit: int | None, cursor: str | None) -> dict:
    world = factory.world
    state = factory.store.read()
    backlog = read_backlog(factory)
    ready = dispatchable(backlog)
    host_id = world.machine.id()
    lane_host = world.github.get_variable(LANE_HOST_VARIABLE)
    lane = state["lane"]
    events = open_events(state)
    owner_issues = [
        issue.number
        for issue in backlog.open_issues()
        if any(label in issue.labels for label in NEEDS_OWNER)
    ]
    parked = [cell for cell in state["cells"] if cell.get("state") == "parked"]
    lists = {
        "queue": state["queue"],
        "held": state["held"],
        "cells": [_cell_view(cell) for cell in state["cells"] if cell.get("state") != "parked"],
        "openEvents": [_event_view(event) for event in events],
    }
    return {
        "runId": lane.get("runId"),
        "host": {"id": host_id, "isLaneHost": lane_host == host_id, "laneHost": lane_host},
        "running": bool(lane.get("running")),
        "paused": bool(lane.get("paused")),
        "pauseReason": lane.get("pauseReason"),
        "draining": bool(lane.get("draining")),
        "slots": {
            "total": dials.value(state["dials"], "lane.slots"),
            "busy": sum(1 for entry in state["queue"] if entry.get("state") == "validating"),
        },
        **paginate(lists, limit, cursor),
        "waitingOnOwner": len(owner_issues)
        + len(parked)
        + sum(1 for event in events if event.get("needsOwner")),
        "dials": dials.values(state["dials"]),
        **can_start(factory, state, ready),
    }


def find_dial(key: str) -> dials.Dial:
    if key in dials.DIALS:
        return dials.DIALS[key]
    close = difflib.get_close_matches(key, list(dials.DIALS), n=3)
    raise Refusal(
        "NOT_FOUND",
        f"No dial named {key}",
        f"Use one of: {', '.join(close)}" if close else "dial-get with no key lists every dial",
    )


def slots_ceiling(factory: Factory) -> tuple[int, str]:
    """The most validation slots the lane host can carry: its record's suggestedSlots."""
    world = factory.world
    host = world.github.get_variable(LANE_HOST_VARIABLE) or world.machine.id()
    for record in world.git.host_records():
        if record.id == host:
            return max(1, record.suggested_slots), host
    return 1, host  # Until a host has been measured, suggestedSlots is 1.


def dial_get(factory: Factory, key: str | None) -> dict:
    overrides = factory.store.read()["dials"]
    if key is None:
        return {
            "dials": [dial.describe(dials.value(overrides, k)) for k, dial in dials.DIALS.items()]
        }
    dial = find_dial(key)
    return dial.describe(dials.value(overrides, key))


def dial_set(factory: Factory, key: str, value) -> dict:
    dial = find_dial(key)
    if dial.owner_only:
        raise Refusal(
            "CONFIRMATION_REQUIRED",
            f"{key} is the owner's dial: setting it needs a person's confirmation",
            "Ask the owner to set it; botcore's host does not carry confirmations yet",
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
        )
    value = dials.normalize(dial, value)
    with factory.store.update(f"dial-set {key}") as state:
        previous = dials.value(state["dials"], key)
        state["dials"][key] = value
        factory.store.log({"kind": "dial-set", "key": key, "value": value, "previous": previous})
    return {**dial.describe(value), "previous": previous}
