"""Lane events: what the foreman is woken for, and what answers each one.

An event lives in the lane state with an id (``ev-<n>``), its type and detail, the consumers it
was delivered to and whether it is open. ``lane-wait`` returns open events the consumer has yet to
receive and marks them delivered. Reading leaves them open. An event stays open until the
action that answers it happens (``ANSWERED_BY``) or ``event-resolve`` records a decision, so a
foreman that dies between reading and acting loses nothing: the next one finds it in
``lane-status``.
"""

from __future__ import annotations

import contextlib
import re
import time
from collections.abc import Callable
from typing import Any

from botcore_factory.records import make
from botcore_factory.runtime import Factory, Refusal, call, fix_input
from botcore_factory.world import WorldError

EVENT_FIELDS = (
    "id",
    "type",
    "branch",
    "reason",
    "detail",
    "lines",
    "logPath",
    "suspects",
    "excused",
    "needsOwner",
    "at",
    "open",
)
#: Which action answers which event type (event-resolve answers any of them).
ANSWERED_BY = {
    "ejected": ("lane-enqueue", "lane-drop"),
    "ejection-limit": ("lane-enqueue", "lane-drop", "ejection-excuse"),
    "gate-change-held": ("lane-enqueue", "lane-drop", "measure-approve"),
    "lane-error": ("lane-resume",),
    "queue-room": ("cell-register",),
}
POLL_SECONDS = 0.25
_ID = re.compile(r"ev-(\d+)")


def view(event: dict[str, Any]) -> dict[str, Any]:
    return {key: event[key] for key in EVENT_FIELDS if key in event}


def is_open(event: dict[str, Any]) -> bool:
    return bool(event.get("open", True))


def open_events(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [event for event in state["events"] if is_open(event)]


def emit(state: dict[str, Any], at: str, kind: str, **fields: Any) -> dict[str, Any]:
    """Add an open event to ``state`` and return it."""
    numbers = [int(m[1]) for e in state["events"] if (m := _ID.fullmatch(str(e.get("id"))))]
    number = max([state.get("eventSeq", 0), *numbers]) + 1
    state["eventSeq"] = number
    event = {"id": f"ev-{number}", "type": kind, "at": at, "open": True, "deliveredTo": []}
    event.update({key: value for key, value in fields.items() if value is not None})
    state["events"].append(event)
    return event


def answer(state: dict[str, Any], action: str, at: str, *, branch: str | None = None) -> list[str]:
    """Close the open events ``action`` answers (for ``branch`` when given); their ids."""
    closed = []
    for event in state["events"]:
        if not is_open(event) or action not in ANSWERED_BY.get(event.get("type"), ()):
            continue
        if branch is not None and event.get("branch") != branch:
            continue
        event["open"] = False
        event["resolution"] = {"by": action, "at": at}
        closed.append(event["id"])
    return closed


def lane_wait(
    factory: Factory,
    consumer: str,
    timeout_ms: int | None,
    status: Callable[[], dict[str, Any]],
    keep: Callable[[], None] | None = None,
    guard: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """The open events ``consumer`` has not been given, each with a compact status, or a timeout.

    ``status`` computes the compact status; it is called once, after delivery is recorded, so a
    failed GitHub read never loses an event. ``keep``, when given, runs on each poll while waiting
    (a foreman's lease is renewed so). ``guard``, when given, runs on the state inside the
    transaction that marks events delivered, before it does: a foreman's session is checked
    again there, so a wait its session no longer holds the lane for refuses and leaves the
    events to its successor (lushly-dev/afd#1633).
    """
    if not consumer.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "consumer is empty",
            "Name the consumer, e.g. foreman",
            recovery=fix_input("consumer"),
        )
    if timeout_ms is not None and timeout_ms < 0:
        raise Refusal(
            "VALIDATION_ERROR",
            f"timeout_ms must not be negative; got {timeout_ms}",
            "Pass a timeout in milliseconds, or leave it out to wait until an event arrives",
            recovery=fix_input("timeout_ms"),
        )
    deadline = None if timeout_ms is None else time.monotonic() + timeout_ms / 1000

    def pending_for_consumer(event: dict[str, Any]) -> bool:
        return is_open(event) and consumer not in event.get("deliveredTo", [])

    while True:
        if any(pending_for_consumer(e) for e in factory.store.read()["events"]):
            with factory.store.update(f"lane-wait {consumer}") as state:
                if guard is not None:
                    guard(state)
                pending = [e for e in state["events"] if pending_for_consumer(e)]
                for event in pending:
                    event.setdefault("deliveredTo", []).append(consumer)
                delivered = [view(event) for event in pending]
            if delivered:
                at = _now(factory)
                run_id = factory.store.read()["lane"].get("runId")
                factory.store.append_record(
                    make("wake", at, run_id, consumer=consumer, events=len(delivered))
                )
                compact = status()
                return {"events": [{**event, "status": compact} for event in delivered]}
        remaining = None if deadline is None else deadline - time.monotonic()
        if remaining is not None and remaining <= 0:
            return {"events": [], "timedOut": True}
        if keep is not None:
            keep()
        time.sleep(POLL_SECONDS if remaining is None else min(POLL_SECONDS, remaining))


def event_resolve(factory: Factory, event_id: str, note: str) -> dict[str, Any]:
    if not note.strip():
        raise Refusal(
            "VALIDATION_ERROR",
            "note is empty",
            "Say what was decided, e.g. ci-ok passed on the merged head",
            recovery=fix_input("note"),
        )
    at = _now(factory)
    with factory.store.update(f"event-resolve {event_id}") as state:
        event = next((e for e in state["events"] if e.get("id") == event_id), None)
        if event is None:
            raise Refusal(
                "NOT_FOUND",
                f"No event {event_id}",
                "lane-status lists the open events with their ids",
                recovery=call("lane-status"),
            )
        was_open = is_open(event)
        if was_open:
            event["open"] = False
            event["resolution"] = {"by": "event-resolve", "at": at, "note": note}
    return {"resolved": True, "id": event_id, "wasOpen": was_open}


def lane_pause(factory: Factory, reason: str | None) -> dict[str, Any]:
    with factory.store.update(f"lane-pause: {reason}" if reason else "lane-pause") as state:
        state["lane"]["paused"] = True
        state["lane"]["pauseReason"] = reason or state["lane"].get("pauseReason")
        state["lane"].pop("waitingOnHostLock", None)
        pid = state["lane"].get("pid")
        if (
            factory.world.validation_lock is not None
            and isinstance(pid, int)
            and not isinstance(pid, bool)
        ):
            with contextlib.suppress(WorldError):
                factory.world.validation_lock.withdraw_waiter(
                    factory.world.github.repository(), pid
                )
    return {"paused": True, "pauseReason": state["lane"]["pauseReason"]}


def lane_resume(factory: Factory, reason: str | None) -> dict[str, Any]:
    """Resume the lane; this answers its open ``lane-error`` events."""
    at = _now(factory)
    with factory.store.update(f"lane-resume: {reason}" if reason else "lane-resume") as state:
        state["lane"]["paused"] = False
        state["lane"]["pauseReason"] = None
        resolved = answer(state, "lane-resume", at)
    return {"paused": False, "resolved": resolved}


def _now(factory: Factory) -> str:
    return factory.world.clock.now().isoformat().replace("+00:00", "Z")
