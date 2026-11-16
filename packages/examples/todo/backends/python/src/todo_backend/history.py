"""The change history: a middleware that records every todo change from its result, and
todo-history, which reads it. As ``backends/typescript/src/history.ts`` and
``src/commands/history.ts``.

Each entry says who made the change (the context's actor, kind and id), when (the context's
clock), which todos it touched, and the undo the result named. Recording it from the result in
middleware, rather than in each handler, keeps the commands unaware of it and records exactly
what a caller was told. An entry offers its undo only while it is the latest change to each of
its todos, so undoing an old entry never overwrites a later edit.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from afd import CommandResult, success
from afd.core.clock import system_clock
from afd.server import CommandMiddleware, NextFn, define_command
from pydantic import BaseModel

from todo_backend.contexts import READ_CONTEXTS
from todo_backend.models import HistoryInput, HistoryOutput
from todo_backend.shared import MCP, actor_from, iso_time
from todo_backend.store import Store

Data = dict[str, Any]


def _plain(value: Any) -> Any:
    """A result's data as JSON values, as a client receives it."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


def _ids(values: Any) -> list[str]:
    return [value for value in values if isinstance(value, str)] if isinstance(values, list) else []


def _ids_of(todos: Any) -> list[str]:
    if not isinstance(todos, list):
        return []
    return _ids([todo.get("id") if isinstance(todo, dict) else None for todo in todos])


CHANGED_IDS: dict[str, Callable[[Data], list[str]]] = {
    "todo-create": lambda data: _ids([data.get("id")]),
    "todo-update": lambda data: _ids([data.get("id")]),
    "todo-toggle": lambda data: _ids([data.get("id")]),
    "todo-delete": lambda data: _ids([data.get("id")]),
    "todo-create-batch": lambda data: _ids_of(data.get("succeeded")),
    "todo-toggle-batch": lambda data: _ids_of(data.get("succeeded")),
    "todo-delete-batch": lambda data: _ids(data.get("deletedIds")),
    "todo-restore": lambda data: _ids(data.get("restoredIds")),
    "todo-clear": lambda data: _ids(data.get("clearedIds")),
}
"""The todos a successful change touched, read from its result; by command name."""

RECORDED_COMMANDS = list(CHANGED_IDS)
"""The commands whose successful results are recorded."""


def create_history_middleware(store: Store) -> CommandMiddleware:
    """Record each successful todo change that touched at least one todo. Place it inside the
    approval middleware, so a held call, which never runs, is never recorded."""

    async def history(command_name: str, input: Any, context: Any, next_fn: NextFn) -> Any:
        result = await next_fn()
        changed = CHANGED_IDS.get(command_name)
        if not isinstance(result, CommandResult) or not result.success or changed is None:
            return result
        data = _plain(result.data)
        if not isinstance(data, dict):
            return result
        touched = changed(data)
        if not touched:
            return result
        clock = getattr(context, "clock", None) or system_clock
        entry: Data = {
            "at": iso_time(clock.now()),
            "actor": actor_from(context),
            "command": command_name,
            "ids": touched,
        }
        if result.undo_command:
            entry["undoCommand"] = result.undo_command
        if result.undo_args:
            entry["undoArgs"] = _plain(result.undo_args)
        store.record(entry)
        return result

    return history


def with_current_undo(changes: list[Data]) -> list[Data]:
    """Newest first, each entry's undo kept only while no later change touched its todos."""
    touched_later: set[str] = set()
    entries: list[Data] = []
    for change in reversed(changes):
        superseded = any(todo_id in touched_later for todo_id in change["ids"])
        touched_later.update(change["ids"])
        if superseded and change.get("undoCommand"):
            rest = {
                key: value
                for key, value in change.items()
                if key not in ("undoCommand", "undoArgs")
            }
            entries.append({**rest, "superseded": True})
        else:
            entries.append(dict(change))
    return entries


def history_command(store: Store) -> Callable[..., Any]:
    """todo-history, bound to ``store``."""

    @define_command(
        name="todo-history",
        title="Todo change history",
        # States HISTORY_LIMIT, which the tests check.
        description=(
            "List the recent changes to the todos, newest first: what changed, who changed it, "
            "when, and the undo command and arguments for each change that is still the latest "
            "to its todos. Keeps the latest 1000 changes"
        ),
        category="todo",
        input_schema=HistoryInput,
        output_schema=HistoryOutput,
        tags=["todo", "history", "read", "undo"],
        version="1.0.0",
        contexts=READ_CONTEXTS,
        expose=MCP,
        examples=[
            {"title": "The last five changes", "input": {"limit": 5}},
            {"title": "What agents changed", "input": {"actor": "agent"}},
        ],
    )
    async def get_history(input: HistoryInput) -> CommandResult[Data]:
        matching = [
            entry
            for entry in with_current_undo(store.history())
            if (input.actor is None or entry["actor"].get("kind") == input.actor)
            and (input.todoId is None or input.todoId in entry["ids"])
        ]
        entries = matching[input.offset : input.offset + input.limit]
        total = len(matching)
        if total == 0:
            reasoning = "No changes recorded that match"
        else:
            reasoning = f"{total} change{'' if total == 1 else 's'} recorded"
            if entries:
                latest = entries[0]
                reasoning += (
                    f"; the latest shown is {latest['command']} by {latest['actor']['kind']} "
                    f"at {latest['at']}"
                )
        return success(
            {
                "entries": entries,
                "total": total,
                "hasMore": input.offset + len(entries) < total,
            },
            reasoning=reasoning,
            confidence=1.0,
        )

    return get_history
