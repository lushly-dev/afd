"""The single-item todo commands, mirroring ``backends/typescript/src/commands``: create, list,
get, update, toggle, delete and stats. Each matches its TypeScript twin's metadata, inputs, error
codes, suggestions, result shapes and undo.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from afd import Alternative, CommandResult, Warning, error, success
from afd.server import define_command

from todo_backend.contexts import EDIT_CONTEXTS, READ_CONTEXTS
from todo_backend.models import (
    CreateTodoInput,
    DeleteOutput,
    EmptyInput,
    IdInput,
    ListOutput,
    ListTodosInput,
    StatsOutput,
    Todo,
    UpdateTodoInput,
)
from todo_backend.shared import MCP, not_found, stamp_from
from todo_backend.store import Store

EXAMPLE_ID = "todo-1700000000000-abc1234"


def single_commands(store: Store) -> list[Callable[..., Any]]:
    """todo-create, -list, -get, -update, -toggle, -delete and -stats, bound to ``store``."""

    @define_command(
        name="todo-create",
        title="Create a todo",
        description="Create a new todo item",
        category="todo",
        input_schema=CreateTodoInput,
        output_schema=Todo,
        tags=["todo", "create", "write", "single"],
        mutation=True,
        idempotency="keyed",
        undoable=True,
        approval="not-required",
        version="1.0.0",
        contexts=EDIT_CONTEXTS,
        expose=MCP,
        examples=[
            {
                "title": "A todo with a priority",
                "input": {"title": "Order seed potatoes", "priority": "high"},
            }
        ],
    )
    async def create_todo(input: CreateTodoInput, context: Any = None) -> CommandResult[Todo]:
        todo = store.create(input.title, input.description, input.priority, stamp_from(context))
        return success(
            todo,
            reasoning=f'Created todo "{todo.title}" with {input.priority} priority',
            confidence=1.0,
            undo_command="todo-delete",
            undo_args={"id": todo.id},
        )

    @define_command(
        name="todo-list",
        title="List todos",
        description="List todos with optional filtering and pagination",
        category="todo",
        input_schema=ListTodosInput,
        output_schema=ListOutput,
        tags=["todo", "list", "read"],
        version="1.0.0",
        contexts=READ_CONTEXTS,
        expose=MCP,
        examples=[
            {
                "title": "Open high-priority todos",
                "input": {"completed": False, "priority": "high"},
            },
            {
                "title": "Deleted todos, most recent first",
                "input": {"deleted": True, "sortBy": "deletedAt"},
            },
        ],
    )
    async def list_todos(input: ListTodosInput) -> CommandResult[dict[str, Any]]:
        def page(completed: bool | None, priority: Any, search: str | None) -> dict[str, Any]:
            filters = {"completed": completed, "priority": priority, "search": search}
            todos = store.list(
                deleted=input.deleted,
                **filters,
                sort_by=input.sortBy,
                sort_order=input.sortOrder,
                limit=input.limit,
                offset=input.offset,
            )
            total = store.count_matching(deleted=input.deleted, **filters)
            return {"todos": todos, "total": total, "hasMore": input.offset + len(todos) < total}

        result = page(input.completed, input.priority, input.search)

        filters: list[str] = []
        if input.deleted:
            filters.append("deleted")
        if input.completed is not None:
            filters.append("completed" if input.completed else "pending")
        if input.priority:
            filters.append(f"{input.priority} priority")
        if input.search:
            filters.append(f'matching "{input.search}"')
        filter_text = f" ({', '.join(filters)})" if filters else ""

        # AFD alternatives pattern: when filtered, also offer the unfiltered view and, for a
        # completion filter, the opposite one.
        alternatives: list[Alternative[dict[str, Any]]] = []
        filtered = any(
            value is not None for value in (input.completed, input.priority, input.search)
        )
        if filtered:
            everything = page(None, None, None)
            alternatives.append(
                Alternative(
                    data=everything,
                    reason=f"View all {everything['total']} todos without filters",
                    confidence=1.0,
                )
            )
            if input.completed is not None:
                opposite = page(not input.completed, input.priority, input.search)
                if opposite["total"] > 0:
                    label = "pending" if input.completed else "completed"
                    alternatives.append(
                        Alternative(
                            data=opposite,
                            reason=f"View {label} todos instead ({opposite['total']})",
                            confidence=1.0,
                        )
                    )

        return success(
            result,
            reasoning=(
                f"Found {result['total']} todos{filter_text}, returning "
                f"{len(result['todos'])} starting at offset {input.offset}"
            ),
            confidence=1.0,
            alternatives=alternatives or None,
        )

    @define_command(
        name="todo-get",
        title="Get a todo",
        description="Get a single todo by ID",
        category="todo",
        input_schema=IdInput,
        output_schema=Todo,
        tags=["todo", "get", "read", "single"],
        version="1.0.0",
        contexts=READ_CONTEXTS,
        expose=MCP,
        examples=[{"title": "One todo by id", "input": {"id": EXAMPLE_ID}}],
    )
    async def get_todo(input: IdInput) -> CommandResult[Todo]:
        todo = store.get(input.id)
        if todo is None:
            return not_found(input.id)
        return success(todo, reasoning=f'Retrieved todo "{todo.title}"', confidence=1.0)

    @define_command(
        name="todo-update",
        title="Update a todo",
        description=(
            "Update a todo's title, description, priority or completion; the result names the undo"
        ),
        category="todo",
        input_schema=UpdateTodoInput,
        output_schema=Todo,
        tags=["todo", "update", "write", "single"],
        mutation=True,
        idempotency="keyed",
        undoable=True,
        approval="not-required",
        version="1.0.0",
        contexts=EDIT_CONTEXTS,
        expose=MCP,
        examples=[
            {
                "title": "Rename and reprioritise",
                "input": {
                    "id": EXAMPLE_ID,
                    "title": "Order seed potatoes and onions",
                    "priority": "high",
                },
            }
        ],
    )
    async def update_todo(input: UpdateTodoInput, context: Any = None) -> CommandResult[Todo]:
        fields = (input.title, input.description, input.completed, input.priority)
        if all(value is None for value in fields):
            return error(
                "NO_CHANGES",
                "No fields to update",
                suggestion="Provide at least one of: title, description, completed, priority",
            )

        existing = store.get(input.id)
        if existing is None:
            return not_found(input.id)
        updated = store.update(
            input.id,
            title=input.title,
            description=input.description,
            completed=input.completed,
            priority=input.priority,
            now=stamp_from(context).now,
        )
        if updated is None:
            return not_found(input.id)

        changes: list[str] = []
        if input.title:
            changes.append(f'title to "{input.title}"')
        if input.description is not None:
            changes.append("description")
        if input.priority:
            changes.append(f"priority to {input.priority}")

        # The undo sets each changed field back; a description that was absent comes back as "",
        # which the store treats as none.
        previous: dict[str, Any] = {"id": input.id}
        if input.title is not None:
            previous["title"] = existing.title
        if input.description is not None:
            previous["description"] = existing.description or ""
        if input.completed is not None:
            previous["completed"] = existing.completed
        if input.priority is not None:
            previous["priority"] = existing.priority

        return success(
            updated,
            reasoning=f'Updated {", ".join(changes)} for todo "{updated.title}"',
            confidence=1.0,
            undo_command="todo-update",
            undo_args=previous,
        )

    @define_command(
        name="todo-toggle",
        title="Toggle a todo",
        description=(
            "Set an open todo to done, or a done todo back to open; the result names the undo"
        ),
        category="todo",
        input_schema=IdInput,
        output_schema=Todo,
        tags=["todo", "toggle", "write", "single"],
        mutation=True,
        idempotency="keyed",
        undoable=True,
        approval="not-required",
        version="1.0.0",
        contexts=EDIT_CONTEXTS,
        expose=MCP,
        examples=[{"title": "Mark a todo done, or open again", "input": {"id": EXAMPLE_ID}}],
    )
    async def toggle_todo(input: IdInput, context: Any = None) -> CommandResult[Todo]:
        existing = store.get(input.id)
        if existing is None:
            return not_found(input.id)
        updated = store.toggle(input.id, stamp_from(context).now)
        if updated is None:
            return not_found(input.id)
        action = "Marked as completed" if updated.completed else "Marked as pending"
        return success(
            updated,
            reasoning=f'{action}: "{updated.title}"',
            confidence=1.0,
            # Setting the previous value back is safe to repeat; toggling again is not
            undo_command="todo-update",
            undo_args={"id": updated.id, "completed": existing.completed},
        )

    @define_command(
        name="todo-delete",
        title="Delete a todo",
        description=(
            "Delete one todo by its id. It is kept with the deleted todos, and todo-restore "
            "brings it back until todo-clear empties them"
        ),
        category="todo",
        input_schema=IdInput,
        output_schema=DeleteOutput,
        tags=["todo", "delete", "write", "single", "destructive"],
        mutation=True,
        idempotency="natural",
        destructive=True,
        undoable=True,
        # It can be undone, so it is not held for approval
        approval="not-required",
        version="1.0.0",
        contexts=EDIT_CONTEXTS,
        expose=MCP,
        examples=[
            {
                "title": "Delete one todo; todo-restore brings it back",
                "input": {"id": EXAMPLE_ID},
            }
        ],
    )
    async def delete_todo(input: IdInput, context: Any = None) -> CommandResult[dict[str, Any]]:
        deleted = store.delete(input.id, stamp_from(context).now)
        if deleted is None:
            return not_found(input.id)
        return success(
            {"deleted": True, "id": input.id},
            reasoning=f'Deleted todo "{deleted.title}"; todo-restore brings it back',
            confidence=1.0,
            warnings=[
                Warning(
                    code="RESTORABLE",
                    message=(
                        "Kept with the deleted todos: todo-restore brings it back until "
                        "todo-clear empties them"
                    ),
                    severity="info",
                )
            ],
            undo_command="todo-restore",
            undo_args={"ids": [input.id]},
        )

    @define_command(
        name="todo-stats",
        title="Todo statistics",
        description=(
            "Compute counts of the live todos by status and priority, and the completion rate"
        ),
        category="todo",
        input_schema=EmptyInput,
        output_schema=StatsOutput,
        tags=["todo", "stats", "read", "safe"],
        requires=["todo-list"],
        version="1.0.0",
        contexts=READ_CONTEXTS,
        expose=MCP,
        examples=[{"title": "Counts by status and priority", "input": {}}],
    )
    async def todo_stats(input: EmptyInput) -> CommandResult[dict[str, Any]]:
        stats = store.stats()
        if stats["total"] == 0:
            reasoning = "No todos yet"
        else:
            reasoning = (
                f"{stats['total']} total todos, {stats['completed']} completed, "
                f"{stats['pending']} pending, "
                # Rounded half up, as JavaScript's Math.round
                f"{math.floor(stats['completionRate'] * 100 + 0.5)}% completion rate"
            )
        return success(stats, reasoning=reasoning, confidence=1.0)

    return [
        create_todo,
        list_todos,
        get_todo,
        update_todo,
        toggle_todo,
        delete_todo,
        todo_stats,
    ]
