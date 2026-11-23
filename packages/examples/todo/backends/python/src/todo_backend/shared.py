"""What the todo commands share, as ``backends/typescript/src/commands/shared.ts``: the stamp from
the command context, who made a change, and the not-found error that says where deleted todos
are.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from afd import CommandResult, ExposeOptions, error
from afd.core.clock import Clock, RandomSource, system_clock, system_random

# AFD commands are private to MCP clients by default: each one opts in.
MCP = ExposeOptions(mcp=True)

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def iso_time(epoch_ms: float) -> str:
    """Epoch milliseconds as JavaScript's ``new Date(ms).toISOString()`` writes them."""
    moment = _EPOCH + timedelta(milliseconds=math.floor(epoch_ms))
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _base36(value: int) -> str:
    digits = ""
    while True:
        value, rest = divmod(value, 36)
        digits = _BASE36[rest] + digits
        if value == 0:
            return digits


@dataclass(frozen=True)
class Stamp:
    """The time and id source for one change."""

    now: str
    """ISO 8601 time of the change."""
    new_id: Callable[[], str]
    """A new todo id."""


def stamp_from(context: Any = None) -> Stamp:
    """The stamp for a change, from the context's clock and random (the system's when it has
    neither), so tests and replays control both. Ids are ``todo-<ms>-<7 base-36 digits>``, as
    TypeScript makes them, so a seeded random gives the same ids in both languages."""
    clock: Clock = getattr(context, "clock", None) or system_clock
    random: RandomSource = getattr(context, "random", None) or system_random
    at = math.floor(clock.now())

    def new_id() -> str:
        return f"todo-{at}-{_base36(math.floor(random.next() * 36**7)).rjust(7, '0')}"

    return Stamp(now=iso_time(at), new_id=new_id)


def actor_from(context: Any = None) -> dict[str, str]:
    """Who is calling, from ``context.actor``; ``unknown`` when the surface set none."""
    actor = getattr(context, "actor", None)
    if actor is None:
        return {"kind": "unknown"}
    who = {"kind": str(actor.kind)}
    if actor.id is not None:
        who["id"] = actor.id
    return who


NOT_FOUND_SUGGESTION = (
    "Use todo-list to see available todos. If it was deleted, find it with "
    "todo-list { deleted: true } and bring it back with todo-restore."
)
"""How to find a todo that is not live: the list, or the deleted list and todo-restore."""


def not_found_item(todo_id: str) -> dict[str, str]:
    """The error for an id with no live todo, as a batch item reports it."""
    return {
        "code": "NOT_FOUND",
        "message": f'Todo with ID "{todo_id}" not found',
        "suggestion": NOT_FOUND_SUGGESTION,
    }


def not_found(todo_id: str) -> CommandResult[Any]:
    """The failure for an id with no live todo."""
    item = not_found_item(todo_id)
    return error(item["code"], item["message"], suggestion=item["suggestion"])
