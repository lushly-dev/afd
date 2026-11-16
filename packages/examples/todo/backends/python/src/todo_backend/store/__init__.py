"""Todo stores: in memory, the shared SQLite database, and the shared JSON files.

Environment variables (read by :func:`create_store`), as the TypeScript backend's
``src/store/index.ts`` reads them:
    TODO_STORE_TYPE - "sqlite", "file" or "memory" (default: "sqlite")
    TODO_STORE_PATH - The SQLite database (default: data/todos.db) or the JSON file (default:
                      data/todos.json). Both defaults are gitignored and start from the committed
                      seed, data/todos.seed.json; a custom path starts empty.

Both backends resolve the same defaults in ``packages/examples/todo/data``, so by default they
share one database.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from pathlib import Path

from todo_backend.store.file import FileStore, StoreCorruptError
from todo_backend.store.memory import HISTORY_LIMIT, ClearResult, MemoryStore, TodoState
from todo_backend.store.sqlite import SqliteStore

# store/__init__.py -> store -> todo_backend -> src -> python -> backends -> todo
EXAMPLE_ROOT = Path(__file__).resolve().parents[5]
DEFAULT_STORE_PATH = EXAMPLE_ROOT / "data" / "todos.json"
DEFAULT_SQLITE_PATH = EXAMPLE_ROOT / "data" / "todos.db"
DEFAULT_SEED_PATH = EXAMPLE_ROOT / "data" / "todos.seed.json"

Store = MemoryStore | SqliteStore
"""Any todo store; ``FileStore`` is a ``MemoryStore``."""

STORE_TYPES = ("sqlite", "file", "memory")


def create_store(env: Mapping[str, str] | None = None) -> Store:
    """Create the store ``TODO_STORE_TYPE`` and ``TODO_STORE_PATH`` select (default: the shared
    SQLite database)."""
    env = os.environ if env is None else env
    store_type = env.get("TODO_STORE_TYPE", "sqlite")
    custom_path = env.get("TODO_STORE_PATH") or None
    if store_type == "memory":
        print("[Store] Using in-memory storage (isolated per process)", file=sys.stderr)
        return MemoryStore()
    if store_type == "sqlite":
        sqlite = (
            SqliteStore(custom_path)
            if custom_path
            else SqliteStore(DEFAULT_SQLITE_PATH, seed_path=DEFAULT_SEED_PATH)
        )
        print(
            f"[Store] Using SQLite storage at {sqlite.path} (shared across processes)",
            file=sys.stderr,
        )
        return sqlite
    if store_type != "file":
        raise ValueError(f'TODO_STORE_TYPE must be memory, file or sqlite, not "{store_type}"')
    store = (
        FileStore(custom_path)
        if custom_path
        else FileStore(DEFAULT_STORE_PATH, seed_path=DEFAULT_SEED_PATH)
    )
    print(f"[Store] Using file storage at {store.path} (shared across processes)", file=sys.stderr)
    return store


__all__ = [
    "DEFAULT_SEED_PATH",
    "DEFAULT_SQLITE_PATH",
    "DEFAULT_STORE_PATH",
    "EXAMPLE_ROOT",
    "HISTORY_LIMIT",
    "STORE_TYPES",
    "ClearResult",
    "FileStore",
    "MemoryStore",
    "SqliteStore",
    "Store",
    "StoreCorruptError",
    "TodoState",
    "create_store",
]
