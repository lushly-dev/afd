"""The in-memory todo store, as ``backends/typescript/src/store/memory.ts``.

It holds the live todos, the deleted ones (which todo-restore brings back) and the change history
that todo-history reads. All the store logic is here: ``FileStore`` loads this state from its
files, runs the same methods and saves the result, and ``SqliteStore`` reuses the filtering,
sorting and statistics on the rows it reads.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from todo_backend.models import Priority, SortBy, SortOrder, Todo
from todo_backend.shared import Stamp, stamp_from

HISTORY_LIMIT = 1000
"""How many changes the history keeps; older ones drop off."""

_PRIORITY_ORDER = {"low": 1, "medium": 2, "high": 3}


@dataclass
class TodoState:
    """What a store holds: live todos and deleted ones by id, in the order they entered, and the
    history, oldest first. Each change is a dict in the wire's camelCase."""

    todos: dict[str, Todo] = field(default_factory=dict)
    deleted: dict[str, Todo] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class ClearResult:
    cleared_ids: list[str]
    """The todos removed for good."""
    remaining: int
    """Live todos left."""


def _sort_key(sort_by: SortBy) -> Any:
    if sort_by == "priority":
        return lambda todo: _PRIORITY_ORDER[todo.priority]
    if sort_by == "title":
        return lambda todo: todo.title.casefold()
    if sort_by == "updatedAt":
        return lambda todo: todo.updatedAt
    if sort_by == "deletedAt":
        return lambda todo: todo.deletedAt or ""
    return lambda todo: todo.createdAt


def list_todos(
    todos: list[Todo],
    *,
    completed: bool | None = None,
    priority: Priority | None = None,
    search: str | None = None,
    sort_by: SortBy = "createdAt",
    sort_order: SortOrder = "desc",
    limit: int | None = None,
    offset: int = 0,
) -> list[Todo]:
    """Filter, sort and page ``todos``. No limit means every match, so a caller can count."""
    results = todos
    if completed is not None:
        results = [todo for todo in results if todo.completed == completed]
    if priority:
        results = [todo for todo in results if todo.priority == priority]
    if search:
        needle = search.lower()
        results = [
            todo
            for todo in results
            if needle in todo.title.lower()
            or (todo.description is not None and needle in todo.description.lower())
        ]
    # sorted() is stable in both directions, like Array.prototype.sort with a negated comparison,
    # so ties keep the order the todos entered the store.
    results = sorted(results, key=_sort_key(sort_by), reverse=sort_order == "desc")
    return results[offset:] if limit is None else results[offset : offset + limit]


def stats_of(todos: list[Todo]) -> dict[str, Any]:
    """Statistics over ``todos``."""
    total = len(todos)
    completed = sum(1 for todo in todos if todo.completed)
    return {
        "total": total,
        "completed": completed,
        "pending": total - completed,
        "byPriority": {
            level: sum(1 for todo in todos if todo.priority == level)
            for level in ("low", "medium", "high")
        },
        "completionRate": completed / total if total > 0 else 0,
    }


def updated_todo(
    todo: Todo,
    *,
    title: str | None = None,
    description: str | None = None,
    priority: Priority | None = None,
    completed: bool | None = None,
    now: str,
) -> Todo:
    """``todo`` with the given fields changed. An empty description is none: an undo of an edit
    that added one sends ``""``."""
    changes: dict[str, Any] = {"updatedAt": now}
    if title is not None:
        changes["title"] = title
    if description is not None:
        changes["description"] = description or None
    if priority is not None:
        changes["priority"] = priority
    if completed is not None:
        changes["completed"] = completed
        if completed and not todo.completed:
            changes["completedAt"] = now
        elif not completed and todo.completed:
            changes["completedAt"] = None
    return todo.model_copy(update=changes)


class MemoryStore:
    """In-memory todo store, isolated per process.

    Every operation runs inside :meth:`_state`, which ``FileStore`` overrides to load the state
    from its files and save it after a change.
    """

    def __init__(self, state: TodoState | None = None) -> None:
        self._memory = state or TodoState()

    @contextmanager
    def _state(self, write: bool = False) -> Iterator[TodoState]:
        yield self._memory

    def create(
        self,
        title: str,
        description: str | None = None,
        priority: Priority = "medium",
        stamp: Stamp | None = None,
    ) -> Todo:
        stamp = stamp or stamp_from()
        todo = Todo(
            id=stamp.new_id(),
            title=title,
            description=description,
            priority=priority,
            completed=False,
            createdAt=stamp.now,
            updatedAt=stamp.now,
        )
        with self._state(write=True) as state:
            state.todos[todo.id] = todo
        return todo

    def get(self, todo_id: str) -> Todo | None:
        """A live todo. A deleted one is not returned: see :meth:`get_deleted`."""
        with self._state() as state:
            return state.todos.get(todo_id)

    def get_deleted(self, todo_id: str) -> Todo | None:
        with self._state() as state:
            return state.deleted.get(todo_id)

    def list(self, *, deleted: bool | None = None, **query: Any) -> list[Todo]:
        """Live todos, or deleted ones with ``deleted=True``, filtered, sorted and paged
        (:func:`list_todos`)."""
        with self._state() as state:
            todos = list((state.deleted if deleted else state.todos).values())
        return list_todos(todos, **query)

    def count_matching(self, *, deleted: bool | None = None, **filters: Any) -> int:
        return len(self.list(deleted=deleted, **filters))

    def update(
        self,
        todo_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
        priority: Priority | None = None,
        completed: bool | None = None,
        now: str | None = None,
    ) -> Todo | None:
        with self._state(write=True) as state:
            todo = state.todos.get(todo_id)
            if todo is None:
                return None
            updated = updated_todo(
                todo,
                title=title,
                description=description,
                priority=priority,
                completed=completed,
                now=now or stamp_from().now,
            )
            state.todos[todo_id] = updated
            return updated

    def toggle(self, todo_id: str, now: str | None = None) -> Todo | None:
        with self._state(write=True) as state:
            todo = state.todos.get(todo_id)
            if todo is None:
                return None
            updated = updated_todo(todo, completed=not todo.completed, now=now or stamp_from().now)
            state.todos[todo_id] = updated
            return updated

    def delete(self, todo_id: str, now: str | None = None) -> Todo | None:
        """Move a live todo to the deleted todos, from which :meth:`restore` brings it back,
        until :meth:`clear_deleted` or :meth:`clear_all` removes it for good. Returns the deleted
        todo, or None when no live todo has this id."""
        with self._state(write=True) as state:
            todo = state.todos.pop(todo_id, None)
            if todo is None:
                return None
            deleted = todo.model_copy(update={"deletedAt": now or stamp_from().now})
            state.deleted[todo_id] = deleted
            return deleted

    def restore(self, todo_id: str) -> Todo | None:
        """Bring a deleted todo back exactly as it was before the delete. Returns it, or None when
        no deleted todo has this id."""
        with self._state(write=True) as state:
            deleted = state.deleted.pop(todo_id, None)
            if deleted is None:
                return None
            todo = deleted.model_copy(update={"deletedAt": None})
            state.todos[todo_id] = todo
            return todo

    def clear_completed(self) -> ClearResult:
        """Remove the completed live todos for good."""
        with self._state(write=True) as state:
            cleared = [todo_id for todo_id, todo in state.todos.items() if todo.completed]
            for todo_id in cleared:
                del state.todos[todo_id]
            return ClearResult(cleared, len(state.todos))

    def clear_deleted(self) -> ClearResult:
        """Remove every deleted todo for good."""
        with self._state(write=True) as state:
            cleared = list(state.deleted)
            state.deleted.clear()
            return ClearResult(cleared, len(state.todos))

    def clear_all(self) -> ClearResult:
        """Remove every todo, live and deleted, for good."""
        with self._state(write=True) as state:
            cleared = [*state.todos, *state.deleted]
            state.todos.clear()
            state.deleted.clear()
            return ClearResult(cleared, 0)

    def stats(self) -> dict[str, Any]:
        """Statistics over the live todos."""
        with self._state() as state:
            return stats_of(list(state.todos.values()))

    def record(self, change: dict[str, Any]) -> dict[str, Any]:
        """Add a change to the history, keeping the latest :data:`HISTORY_LIMIT`."""
        with self._state(write=True) as state:
            last = state.history[-1]["seq"] if state.history else 0
            entry = {"seq": last + 1, **change}
            state.history.append(entry)
            del state.history[: max(0, len(state.history) - HISTORY_LIMIT)]
            return entry

    def history(self) -> list[dict[str, Any]]:
        """The recorded changes, oldest first."""
        with self._state() as state:
            return list(state.history)

    def clear(self) -> None:
        """Remove everything: live and deleted todos and the history (for tests)."""
        with self._state(write=True) as state:
            state.todos.clear()
            state.deleted.clear()
            state.history.clear()

    def count(self) -> int:
        """Count of live todos."""
        with self._state() as state:
            return len(state.todos)
