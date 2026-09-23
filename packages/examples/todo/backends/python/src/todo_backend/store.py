"""Todo stores: in-memory, and a JSON file shared with the TypeScript backend.

Environment variables (read by :func:`create_store`):
    TODO_STORE_TYPE - "memory" or "file" (default: "file")
    TODO_STORE_PATH - JSON file path (default: packages/examples/todo/data/todos.json)

The default data file is gitignored. When it is missing, it is created from
the committed seed ``data/todos.seed.json``. A custom ``TODO_STORE_PATH``
starts empty.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from pydantic import ValidationError

from todo_backend.models import Priority, SortBy, SortOrder, Todo

# store.py -> todo_backend -> src -> python -> backends -> todo
EXAMPLE_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_STORE_PATH = EXAMPLE_ROOT / "data" / "todos.json"
DEFAULT_SEED_PATH = EXAMPLE_ROOT / "data" / "todos.seed.json"

_PRIORITY_ORDER = {"low": 1, "medium": 2, "high": 3}


class StoreCorruptError(RuntimeError):
    """The data file exists but cannot be read as a list of todos.

    Raised instead of treating the file as empty, so a later write cannot
    overwrite data that is merely unreadable.
    """


def _now() -> str:
    """Current UTC time in the same format as JavaScript's toISOString()."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _generate_id() -> str:
    return f"todo-{int(time.time() * 1000)}-{uuid.uuid4().hex[:7]}"


class MemoryStore:
    """In-memory todo store, isolated per process.

    Every operation loads the current todos, changes them and saves them.
    ``FileStore`` overrides ``_load``/``_save`` to persist them to disk.
    """

    def __init__(self) -> None:
        self._todos: Dict[str, Todo] = {}

    def _load(self) -> Dict[str, Todo]:
        return self._todos

    def _save(self, todos: Dict[str, Todo]) -> None:
        self._todos = todos

    def create(
        self,
        title: str,
        description: Optional[str] = None,
        priority: Priority = "medium",
    ) -> Todo:
        todos = self._load()
        timestamp = _now()
        todo = Todo(
            id=_generate_id(),
            title=title,
            description=description,
            priority=priority,
            completed=False,
            createdAt=timestamp,
            updatedAt=timestamp,
        )
        todos[todo.id] = todo
        self._save(todos)
        return todo

    def get(self, todo_id: str) -> Optional[Todo]:
        return self._load().get(todo_id)

    def list(
        self,
        *,
        completed: Optional[bool] = None,
        priority: Optional[Priority] = None,
        search: Optional[str] = None,
        sort_by: SortBy = "createdAt",
        sort_order: SortOrder = "desc",
        limit: int = 100,
        offset: int = 0,
    ) -> List[Todo]:
        results = list(self._load().values())

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

        def sort_key(todo: Todo) -> Any:
            if sort_by == "priority":
                return _PRIORITY_ORDER[todo.priority]
            if sort_by == "title":
                return todo.title.casefold()
            if sort_by == "updatedAt":
                return todo.updatedAt
            return todo.createdAt

        # sorted() is stable in both directions, like Array.prototype.sort.
        results = sorted(results, key=sort_key, reverse=sort_order == "desc")
        return results[offset : offset + limit]

    def count_matching(
        self,
        *,
        completed: Optional[bool] = None,
        priority: Optional[Priority] = None,
        search: Optional[str] = None,
    ) -> int:
        return len(
            self.list(
                completed=completed,
                priority=priority,
                search=search,
                limit=sys.maxsize,
            )
        )

    def update(
        self,
        todo_id: str,
        *,
        title: Optional[str] = None,
        description: Optional[str] = None,
        priority: Optional[Priority] = None,
        completed: Optional[bool] = None,
    ) -> Optional[Todo]:
        todos = self._load()
        todo = todos.get(todo_id)
        if todo is None:
            return None

        changes: Dict[str, Any] = {"updatedAt": _now()}
        if title is not None:
            changes["title"] = title
        if description is not None:
            changes["description"] = description
        if priority is not None:
            changes["priority"] = priority
        if completed is not None:
            changes["completed"] = completed
            if completed and not todo.completed:
                changes["completedAt"] = _now()
            elif not completed and todo.completed:
                changes["completedAt"] = None

        updated = todo.model_copy(update=changes)
        todos[todo_id] = updated
        self._save(todos)
        return updated

    def toggle(self, todo_id: str) -> Optional[Todo]:
        todos = self._load()
        todo = todos.get(todo_id)
        if todo is None:
            return None

        completed = not todo.completed
        timestamp = _now()
        updated = todo.model_copy(
            update={
                "completed": completed,
                "completedAt": timestamp if completed else None,
                "updatedAt": timestamp,
            }
        )
        todos[todo_id] = updated
        self._save(todos)
        return updated

    def delete(self, todo_id: str) -> bool:
        todos = self._load()
        if todo_id not in todos:
            return False
        del todos[todo_id]
        self._save(todos)
        return True

    def clear_completed(self) -> Dict[str, int]:
        todos = self._load()
        remaining = {todo_id: todo for todo_id, todo in todos.items() if not todo.completed}
        cleared = len(todos) - len(remaining)
        self._save(remaining)
        return {"cleared": cleared, "remaining": len(remaining)}

    def clear(self) -> None:
        self._save({})

    def count(self) -> int:
        return len(self._load())

    def stats(self) -> Dict[str, Any]:
        todos = list(self._load().values())
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


class FileStore(MemoryStore):
    """Todo store persisted to a JSON file (an array of todos).

    The file is re-read on every operation, so several processes (the HTTP
    and stdio servers, or the TS and Python backends) see the same data.
    Writes go to a temporary file that is then renamed over the data file, so
    a crash never leaves a half-written file behind.
    """

    def __init__(self, path: Union[str, Path], seed_path: Optional[Union[str, Path]] = None):
        super().__init__()
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            seed = Path(seed_path) if seed_path is not None else None
            initial = _read_todos(seed) if seed is not None and seed.exists() else {}
            self._save(initial)
        # Fail at startup, not on the first command, when the file is unreadable.
        self._load()

    def _load(self) -> Dict[str, Todo]:
        try:
            return _read_todos(self.path)
        except FileNotFoundError:
            # Deleted while the server runs: start again from an empty store.
            return {}

    def _save(self, todos: Dict[str, Todo]) -> None:
        payload = json.dumps([todo.model_dump(mode="json") for todo in todos.values()], indent=2)
        # A sibling file, so the rename stays on one filesystem. Opening it with
        # "x" (not mkstemp) keeps the usual umask-based permissions.
        temp_path = self.path.with_name(
            f".{self.path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
        )
        try:
            with open(temp_path, "x", encoding="utf-8") as handle:
                handle.write(payload + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, self.path)
        except BaseException:
            temp_path.unlink(missing_ok=True)
            raise


def _read_todos(path: Path) -> Dict[str, Todo]:
    """Read todos from a JSON file, raising StoreCorruptError if it is unreadable."""

    raw = path.read_text(encoding="utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise StoreCorruptError(
            f"Todo store {path} is not valid JSON ({exc}). The file was left unchanged: "
            "fix it, or delete it to start from the seed data."
        ) from exc

    # Accept the array format both backends write, and the older {id: todo} map.
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = list(data.values())
    else:
        raise StoreCorruptError(
            f"Todo store {path} must contain a JSON array of todos, "
            f"found {type(data).__name__}. The file was left unchanged."
        )

    try:
        todos = [Todo.model_validate(item) for item in items]
    except ValidationError as exc:
        raise StoreCorruptError(
            f"Todo store {path} contains an invalid todo: {exc}. The file was left unchanged."
        ) from exc
    return {todo.id: todo for todo in todos}


def create_store() -> MemoryStore:
    """Create the store selected by TODO_STORE_TYPE and TODO_STORE_PATH."""

    store_type = os.environ.get("TODO_STORE_TYPE", "file")
    if store_type == "memory":
        print("[Store] Using in-memory storage (isolated per process)", file=sys.stderr)
        return MemoryStore()
    if store_type != "file":
        raise ValueError(f"TODO_STORE_TYPE must be 'memory' or 'file', got {store_type!r}")

    custom_path = os.environ.get("TODO_STORE_PATH")
    if custom_path:
        store = FileStore(custom_path)
    else:
        store = FileStore(DEFAULT_STORE_PATH, seed_path=DEFAULT_SEED_PATH)
    print(f"[Store] Using file storage at {store.path}", file=sys.stderr)
    return store
