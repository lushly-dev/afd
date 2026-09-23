"""The eight single-item todo commands, mirroring backends/typescript/src/commands."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from afd import Alternative, CommandResult, ExposeOptions, Warning, error, success
from afd.server import MCPServer

from todo_backend.models import (
    ClearTodosInput,
    CreateTodoInput,
    EmptyInput,
    IdInput,
    ListTodosInput,
    Todo,
    UpdateTodoInput,
)
from todo_backend.store import MemoryStore

# AFD commands are private to MCP clients by default: each one opts in.
MCP = ExposeOptions(mcp=True)

LIST_SUGGESTION = "Use todo-list to see available todos"


def not_found(todo_id: str) -> CommandResult[Any]:
    return error(
        "NOT_FOUND",
        f'Todo with ID "{todo_id}" not found',
        suggestion=LIST_SUGGESTION,
    )


def not_found_item(todo_id: str) -> Dict[str, str]:
    return {
        "code": "NOT_FOUND",
        "message": f'Todo with ID "{todo_id}" not found',
        "suggestion": LIST_SUGGESTION,
    }


def permanent_warning() -> Warning:
    return Warning(code="PERMANENT", message="This action cannot be undone", severity="info")


def register_commands(server: MCPServer, store: MemoryStore) -> None:
    """Register todo-create, -list, -get, -update, -toggle, -delete, -clear and -stats."""

    @server.command(
        name="todo-create",
        description="Create a new todo item",
        category="todo",
        input_schema=CreateTodoInput,
        tags=["todo", "create", "write", "single"],
        mutation=True,
        contexts=["todo-editing"],
        expose=MCP,
    )
    async def create_todo(input: CreateTodoInput) -> CommandResult[Todo]:
        todo = store.create(input.title, input.description, input.priority)
        return success(
            todo,
            reasoning=f'Created todo "{todo.title}" with {input.priority} priority',
            confidence=1.0,
        )

    @server.command(
        name="todo-list",
        description="List todos with optional filtering and pagination",
        category="todo",
        input_schema=ListTodosInput,
        tags=["todo", "list", "read"],
        contexts=["todo-editing", "todo-reading"],
        expose=MCP,
    )
    async def list_todos(input: ListTodosInput) -> CommandResult[Dict[str, Any]]:
        def page(completed: Optional[bool], priority: Any, search: Optional[str]) -> Dict[str, Any]:
            todos = store.list(
                completed=completed,
                priority=priority,
                search=search,
                sort_by=input.sortBy,
                sort_order=input.sortOrder,
                limit=input.limit,
                offset=input.offset,
            )
            total = store.count_matching(completed=completed, priority=priority, search=search)
            return {
                "todos": todos,
                "total": total,
                "hasMore": input.offset + len(todos) < total,
            }

        result = page(input.completed, input.priority, input.search)

        filters: List[str] = []
        if input.completed is not None:
            filters.append("completed" if input.completed else "pending")
        if input.priority:
            filters.append(f"{input.priority} priority")
        if input.search:
            filters.append(f'matching "{input.search}"')
        filter_text = f" ({', '.join(filters)})" if filters else ""

        # AFD alternatives pattern: when filtered, also offer the unfiltered
        # view and, for a completion filter, the opposite one.
        alternatives: List[Alternative[Dict[str, Any]]] = []
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

    @server.command(
        name="todo-get",
        description="Get a single todo by ID",
        category="todo",
        input_schema=IdInput,
        tags=["todo", "get", "read", "single"],
        contexts=["todo-editing", "todo-reading"],
        expose=MCP,
    )
    async def get_todo(input: IdInput) -> CommandResult[Todo]:
        todo = store.get(input.id)
        if todo is None:
            return not_found(input.id)
        return success(todo, reasoning=f'Retrieved todo "{todo.title}"', confidence=1.0)

    @server.command(
        name="todo-update",
        description="Update a todo item",
        category="todo",
        input_schema=UpdateTodoInput,
        tags=["todo", "update", "write", "single"],
        mutation=True,
        expose=MCP,
    )
    async def update_todo(input: UpdateTodoInput) -> CommandResult[Todo]:
        fields = (input.title, input.description, input.completed, input.priority)
        if all(value is None for value in fields):
            return error(
                "NO_CHANGES",
                "No fields to update",
                suggestion="Provide at least one of: title, description, completed, priority",
            )

        updated = store.update(
            input.id,
            title=input.title,
            description=input.description,
            completed=input.completed,
            priority=input.priority,
        )
        if updated is None:
            return not_found(input.id)

        changes: List[str] = []
        if input.title:
            changes.append(f'title to "{input.title}"')
        if input.description is not None:
            changes.append("description")
        if input.priority:
            changes.append(f"priority to {input.priority}")
        return success(
            updated,
            reasoning=f'Updated {", ".join(changes)} for todo "{updated.title}"',
            confidence=1.0,
        )

    @server.command(
        name="todo-toggle",
        description="Toggle the completion status of a todo",
        category="todo",
        input_schema=IdInput,
        tags=["todo", "toggle", "write", "single"],
        mutation=True,
        expose=MCP,
    )
    async def toggle_todo(input: IdInput) -> CommandResult[Todo]:
        updated = store.toggle(input.id)
        if updated is None:
            return not_found(input.id)
        action = "Marked as completed" if updated.completed else "Marked as pending"
        return success(updated, reasoning=f'{action}: "{updated.title}"', confidence=1.0)

    @server.command(
        name="todo-delete",
        description="Delete a todo item",
        category="todo",
        input_schema=IdInput,
        tags=["todo", "delete", "write", "single", "destructive"],
        mutation=True,
        expose=MCP,
    )
    async def delete_todo(input: IdInput) -> CommandResult[Dict[str, Any]]:
        existing = store.get(input.id)
        if existing is None or not store.delete(input.id):
            return not_found(input.id)
        return success(
            {"deleted": True, "id": input.id},
            reasoning=f'Deleted todo "{existing.title}"',
            confidence=1.0,
            warnings=[permanent_warning()],
        )

    @server.command(
        name="todo-clear",
        description="Clear completed todos (or all if specified)",
        category="todo",
        input_schema=ClearTodosInput,
        tags=["todo", "clear", "write", "batch", "destructive"],
        mutation=True,
        expose=MCP,
    )
    async def clear_todos(input: ClearTodosInput) -> CommandResult[Dict[str, int]]:
        if input.all:
            count = store.count()
            store.clear()
            return success(
                {"cleared": count, "remaining": 0},
                reasoning=f"Cleared all {count} todos",
                confidence=1.0,
            )

        result = store.clear_completed()
        cleared, remaining = result["cleared"], result["remaining"]
        if cleared > 0:
            plural = "" if cleared == 1 else "s"
            reasoning = f"Cleared {cleared} completed todo{plural}, {remaining} remaining"
        else:
            reasoning = f"No completed todos to clear, {remaining} remaining"
        return success(
            result,
            reasoning=reasoning,
            confidence=1.0,
            warnings=[permanent_warning()] if cleared > 0 else None,
        )

    @server.command(
        name="todo-stats",
        description="Get todo statistics",
        category="todo",
        input_schema=EmptyInput,
        tags=["todo", "stats", "read", "safe"],
        requires=["todo-list"],
        expose=MCP,
    )
    async def todo_stats(input: EmptyInput) -> CommandResult[Dict[str, Any]]:
        stats = store.stats()
        if stats["total"] == 0:
            reasoning = "No todos yet"
        else:
            reasoning = (
                f"{stats['total']} total todos, {stats['completed']} completed, "
                f"{stats['pending']} pending, "
                f"{round(stats['completionRate'] * 100)}% completion rate"
            )
        return success(stats, reasoning=reasoning, confidence=1.0)
