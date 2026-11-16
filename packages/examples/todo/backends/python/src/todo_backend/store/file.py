"""The JSON file store, the same files as ``backends/typescript/src/store/file.ts``.

The live todos are in the main file (``data/todos.json`` by default), an array of todos. Deleted
todos and the change history are kept beside it (``todos.deleted.json``, ``todos.history.json``),
so a backend that knows nothing of them never shows a deleted todo as live. Every operation
re-reads the files, so several processes (the TypeScript and Python backends among them) see the
same data.

Each file's write is atomic (a temporary file renamed over it), but the three are separate
writes, not one transaction. The file a todo moves into is written first, so a crash between the
writes leaves it in both files rather than neither, and loading keeps the live copy of a todo
found in both. The SQLite store has transactions; this one is kept for the JSON files.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from todo_backend.models import Todo
from todo_backend.store.memory import MemoryStore, TodoState


class StoreCorruptError(RuntimeError):
    """A data file exists but cannot be read.

    Raised instead of treating the file as empty, so a later write cannot overwrite data that is
    merely unreadable.
    """


def deleted_path_for(path: Path) -> Path:
    """The deleted todos' file beside a todo file: ``todos.json`` -> ``todos.deleted.json``."""
    return path.with_name(re.sub(r"(\.json)?$", ".deleted.json", path.name, count=1))


def history_path_for(path: Path) -> Path:
    """The change history's file beside a todo file: ``todos.json`` -> ``todos.history.json``."""
    return path.with_name(re.sub(r"(\.json)?$", ".history.json", path.name, count=1))


class FileStore(MemoryStore):
    """Todo store persisted to JSON files, shared with the TypeScript backend's file store."""

    def __init__(self, path: str | Path, seed_path: str | Path | None = None):
        super().__init__()
        self.path = Path(path)
        self.deleted_path = deleted_path_for(self.path)
        self.history_path = history_path_for(self.path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            seed = Path(seed_path) if seed_path is not None else None
            initial = read_todos(seed) if seed is not None and seed.exists() else {}
            _write_json(self.path, [todo.model_dump(mode="json") for todo in initial.values()])
        # Fail at startup, not on the first command, when a file is unreadable.
        self._load()

    def _load(self) -> TodoState:
        todos = _read_or_empty(lambda: read_todos(self.path), dict)
        deleted = _read_or_empty(lambda: read_todos(self.deleted_path), dict)
        # In both files only after a crash between the writes of a delete or restore: keep it live
        for todo_id in todos:
            deleted.pop(todo_id, None)
        history = _read_or_empty(lambda: read_history(self.history_path), list)
        return TodoState(todos=todos, deleted=deleted, history=history)

    @contextmanager
    def _state(self, write: bool = False) -> Iterator[TodoState]:
        state = self._load()
        deleted_before = set(state.deleted)
        yield state
        if not write:
            return
        live = [todo.model_dump(mode="json") for todo in state.todos.values()]
        deleted = [todo.model_dump(mode="json") for todo in state.deleted.values()]
        # Write the file a todo moved into first (see the module comment)
        if any(todo_id not in deleted_before for todo_id in state.deleted):
            _write_json(self.deleted_path, deleted)
            _write_json(self.path, live)
        else:
            _write_json(self.path, live)
            _write_json(self.deleted_path, deleted)
        _write_json(self.history_path, state.history)


def _read_or_empty(read: Any, empty: Any) -> Any:
    """A file's contents, or ``empty()`` when it does not exist (yet, or any more)."""
    try:
        return read()
    except FileNotFoundError:
        return empty()


def _parse_json(path: Path) -> Any:
    raw = path.read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise StoreCorruptError(
            f"Todo store {path} is not valid JSON ({exc}). The file was left unchanged: "
            "fix it, or delete it to start from the seed data."
        ) from exc


def read_todos(path: Path) -> dict[str, Todo]:
    """Read todos from a JSON file: an array of todos, or the older ``{id: todo}`` map.

    Raises:
        FileNotFoundError: When the file does not exist.
        StoreCorruptError: When it is not valid JSON or not a list of todos.
    """
    data = _parse_json(path)
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


def read_history(path: Path) -> list[dict[str, Any]]:
    """Read the change history, a JSON array of changes, oldest first.

    Raises:
        FileNotFoundError: When the file does not exist.
        StoreCorruptError: When it is not valid JSON or not a list of changes.
    """
    data = _parse_json(path)
    if not isinstance(data, list):
        raise StoreCorruptError(f"Todo store {path} must contain a JSON array of changes")
    for index, entry in enumerate(data):
        valid = (
            isinstance(entry, dict)
            and isinstance(entry.get("seq"), int)
            and isinstance(entry.get("command"), str)
            and isinstance(entry.get("ids"), list)
        )
        if not valid:
            raise StoreCorruptError(
                f'Todo store {path} has an invalid change at index {index} (expected number "seq", '
                'string "command" and array "ids"). The file was left unchanged.'
            )
    return data


def _write_json(path: Path, value: Any) -> None:
    """Write ``value`` as JSON atomically: a temporary sibling file renamed over ``path``."""
    payload = json.dumps(value, indent=2, ensure_ascii=False)
    # A sibling file, so the rename stays on one filesystem. Opening it with "x" (not mkstemp)
    # keeps the usual umask-based permissions.
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with open(temp_path, "x", encoding="utf-8") as handle:
            handle.write(payload + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise
