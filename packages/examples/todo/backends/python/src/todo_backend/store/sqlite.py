"""The SQLite todo store on the standard library's ``sqlite3``: the same database file as the
TypeScript backend's ``SqliteStore`` (``backends/typescript/src/store/sqlite.ts``), so the two
servers share their todos (the to-do reference plan's D4).

The file's layout is the one ``@lushly-dev/local-db``'s SQLite adapter owns
(``packages/local-db/src/sqlite-adapter.ts``), which the TypeScript store writes through:

- one table, ``records(tbl, id, value)`` keyed by ``(tbl, id)``, ``WITHOUT ROWID``, each value the
  record's JSON including its ``id``;
- ``PRAGMA user_version = 1``. The table is created inside ``BEGIN IMMEDIATE`` only when the
  version is 0 and the file has no tables; any other file is refused, untouched;
- then ``journal_mode = WAL``, ``synchronous = FULL`` and a 5-second ``busy_timeout``.

The todo store's records, as TypeScript writes them: the tables ``todos`` (live), ``deleted_todos``
(what todo-restore brings back) and ``changes`` (the history todo-history reads). Each todo row
keeps a hidden ``_order``, the time in microseconds when it entered its table, so a table reads
back in that order and ties in a sort come out as in the in-memory store. A change's record id is
its ``seq`` zero-padded to 12 digits, and the latest :data:`HISTORY_LIMIT` are kept.

Every write is one ``BEGIN IMMEDIATE`` transaction that reads the rows it changes inside it, so a
change to a todo another process removed meanwhile changes nothing and reports the todo missing,
as the TypeScript store's guarded batches do, and a delete or restore moves its todo all or
nothing. A history entry is a separate transaction after the change it records. Filtering,
sorting and statistics are the in-memory store's, run on the rows read.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from pathlib import Path
from typing import Any, TypeVar

from todo_backend.models import Priority, Todo
from todo_backend.shared import Stamp, stamp_from
from todo_backend.store.file import StoreCorruptError, read_todos
from todo_backend.store.memory import (
    HISTORY_LIMIT,
    ClearResult,
    list_todos,
    stats_of,
    updated_todo,
)

TODOS = "todos"
DELETED = "deleted_todos"
CHANGES = "changes"

SCHEMA_VERSION = 1
SCHEMA = """CREATE TABLE records (
	tbl TEXT NOT NULL,
	id TEXT NOT NULL,
	value TEXT NOT NULL,
	PRIMARY KEY (tbl, id)
) WITHOUT ROWID"""

T = TypeVar("T")


def change_id(seq: int) -> str:
    """A change's record id: its sequence number, zero-padded so ids sort as numbers do."""
    return str(seq).rjust(12, "0")


def _storable(todo_id: str) -> bool:
    """Whether the adapter can store a record under this id ("", "." and ".." it refuses)."""
    return todo_id not in ("", ".", "..")


def rollback_quietly(db: sqlite3.Connection) -> bool:
    """Roll back without raising an error of its own, since SQLite may already have rolled the
    transaction back (a full disk, an I/O error), as the local-db adapter's ``rollbackQuietly``.
    Returns whether the connection is now outside a transaction."""
    if not db.in_transaction:
        return True
    with suppress(sqlite3.Error):
        db.execute("ROLLBACK")
    return not db.in_transaction


def _dumps(value: Any) -> str:
    """JSON as JavaScript's ``JSON.stringify`` writes it: compact, non-ASCII kept."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _todo_of(row: dict[str, Any]) -> Todo:
    """The todo without the store's bookkeeping."""
    return Todo.model_validate({key: value for key, value in row.items() if key != "_order"})


class SqliteStore:
    """SQLite todo store, shared with the TypeScript backend's ``SqliteStore``.

    Args:
        path: The database file. Its directory is created.
        seed_path: A JSON file of todos to add when this call creates the database (the default
            database is seeded from ``data/todos.seed.json``, as the JSON file was).
        busy_timeout_ms: How long a write waits for another connection's write to finish.
    """

    def __init__(
        self,
        path: str | Path,
        seed_path: str | Path | None = None,
        busy_timeout_ms: int = 5000,
    ) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._last_order = 0
        self._busy_timeout_ms = busy_timeout_ms
        self._db: sqlite3.Connection | None = self._open(Path(seed_path) if seed_path else None)

    # ─── The database ──────────────────────────────────────────────────────────

    def _open(self, seed_path: Path | None = None) -> sqlite3.Connection:
        # isolation_level=None: no implicit transactions; every write begins its own.
        db = sqlite3.connect(
            str(self.path),
            timeout=self._busy_timeout_ms / 1000,
            isolation_level=None,
            check_same_thread=False,
        )
        try:
            db.execute(f"PRAGMA busy_timeout = {int(self._busy_timeout_ms)}")
            # Decide ownership before WAL: switching a file to WAL is persistent, and a refused
            # file must be left as it was found.
            self._prepare_schema(db, seed_path)
            self._switch_to_wal(db)
            db.execute("PRAGMA synchronous = FULL")
        except BaseException:
            db.close()
            raise
        return db

    def _switch_to_wal(self, db: sqlite3.Connection) -> None:
        """Switch the file to WAL, waiting up to the busy timeout for the lock. The switch takes an
        exclusive lock, and while another connection holds a write lock SQLite refuses it at once
        without calling its busy handler (its deadlock rule), so ``busy_timeout`` does not cover
        it: two processes that open one new file together would fail as ``database is locked``
        (lushly-dev/afd#2250). The TypeScript adapter retries the same way."""
        deadline = time.monotonic() + self._busy_timeout_ms / 1000
        while True:
            try:
                db.execute("PRAGMA journal_mode = WAL")
                return
            except sqlite3.OperationalError as error:
                left = deadline - time.monotonic()
                if (error.sqlite_errorcode & 0xFF) != sqlite3.SQLITE_BUSY or left <= 0:
                    raise
                time.sleep(min(0.01, left))

    def _prepare_schema(self, db: sqlite3.Connection, seed_path: Path | None) -> None:
        """Create the table in a new database, inside one write transaction so two processes
        opening a new file at once create it once, and refuse a database the adapter did not
        create. The seed todos go in the same transaction."""

        def version() -> int:
            return int(db.execute("PRAGMA user_version").fetchone()[0])

        if version() == SCHEMA_VERSION:
            return
        db.execute("BEGIN IMMEDIATE")
        try:
            found = version()
            if found != SCHEMA_VERSION:
                (tables,) = db.execute(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table'"
                ).fetchone()
                if found != 0 or tables != 0:
                    raise StoreCorruptError(
                        f"SQLite database {json.dumps(str(self.path))} was not created by "
                        f"SqliteAdapter (schema version {found}, {tables} tables). Use another file."
                    )
                db.execute(SCHEMA)
                db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                if seed_path is not None and seed_path.exists():
                    for todo in read_todos(seed_path).values():
                        self._put(db, TODOS, self._row(todo))
            db.execute("COMMIT")
        except BaseException:
            # The error reported stays the one raised; _open closes the connection.
            rollback_quietly(db)
            raise

    def close(self) -> None:
        """Close the database. The next call opens it again."""
        with self._lock:
            self._close()

    def _close(self) -> None:
        db, self._db = self._db, None
        if db is not None:
            db.close()

    def _connection(self) -> sqlite3.Connection:
        if self._db is None:
            self._db = self._open()
        return self._db

    @contextmanager
    def _read(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            yield self._connection()

    def _write(self, work: Callable[[sqlite3.Connection], T]) -> T:
        """Run ``work`` in one ``BEGIN IMMEDIATE`` transaction and commit it. When ``work`` or
        the commit fails, the transaction is rolled back quietly and the original error raised;
        a connection left inside a transaction would refuse every later ``BEGIN``, so it is
        closed, and the next call opens the file again (as the local-db adapter does)."""
        with self._lock:
            db = self._connection()
            db.execute("BEGIN IMMEDIATE")
            try:
                result = work(db)
                db.execute("COMMIT")
            except BaseException:
                if not rollback_quietly(db):
                    self._close()
                raise
            return result

    def _next_order(self) -> int:
        """A position after every row this process wrote: the time in microseconds, or one past
        the last position when the clock has not moved on, as the TypeScript store's."""
        self._last_order = max(time.time_ns() // 1_000_000 * 1000, self._last_order + 1)
        return self._last_order

    def _row(self, todo: Todo, order: int | None = None) -> dict[str, Any]:
        return {**todo.model_dump(mode="json"), "_order": order or self._next_order()}

    @staticmethod
    def _get(db: sqlite3.Connection, table: str, todo_id: str) -> dict[str, Any] | None:
        if not _storable(todo_id):
            return None
        found = db.execute(
            "SELECT value FROM records WHERE tbl = ? AND id = ?", (table, todo_id)
        ).fetchone()
        return json.loads(found[0]) if found else None

    @staticmethod
    def _rows(db: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
        """A table's rows in the order they entered it (ties in id order, as the adapter lists)."""
        rows = [
            json.loads(value)
            for (value,) in db.execute(
                "SELECT value FROM records WHERE tbl = ? ORDER BY id", (table,)
            )
        ]
        return sorted(rows, key=lambda row: row.get("_order") or 0)

    @staticmethod
    def _put(db: sqlite3.Connection, table: str, record: dict[str, Any]) -> None:
        db.execute(
            "INSERT OR REPLACE INTO records (tbl, id, value) VALUES (?, ?, ?)",
            (table, record["id"], _dumps(record)),
        )

    @staticmethod
    def _remove(db: sqlite3.Connection, table: str, record_id: str) -> None:
        db.execute("DELETE FROM records WHERE tbl = ? AND id = ?", (table, record_id))

    def _snapshot(self) -> tuple[list[Todo], list[Todo]]:
        """The live and deleted todos. A todo in both tables (only after another process's race)
        counts as live."""
        with self._read() as db:
            live = self._rows(db, TODOS)
            deleted = self._rows(db, DELETED)
        live_ids = {row["id"] for row in live}
        return (
            [_todo_of(row) for row in live],
            [_todo_of(row) for row in deleted if row["id"] not in live_ids],
        )

    # ─── The store ─────────────────────────────────────────────────────────────

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
        self._write(lambda db: self._put(db, TODOS, self._row(todo)))
        return todo

    def get(self, todo_id: str) -> Todo | None:
        with self._read() as db:
            row = self._get(db, TODOS, todo_id)
        return _todo_of(row) if row else None

    def get_deleted(self, todo_id: str) -> Todo | None:
        with self._read() as db:
            row = self._get(db, DELETED, todo_id)
        return _todo_of(row) if row else None

    def list(self, *, deleted: bool | None = None, **query: Any) -> list[Todo]:
        live, removed = self._snapshot()
        return list_todos(removed if deleted else live, **query)

    def count_matching(self, *, deleted: bool | None = None, **filters: Any) -> int:
        return len(self.list(deleted=deleted, **filters))

    def _change(self, todo_id: str, apply: Callable[[Todo], Todo]) -> Todo | None:
        """Apply one change to a live todo, read and written in the same transaction."""

        def work(db: sqlite3.Connection) -> Todo | None:
            current = self._get(db, TODOS, todo_id)
            if current is None:
                return None
            updated = apply(_todo_of(current))
            self._put(db, TODOS, self._row(updated, current.get("_order")))
            return updated

        return self._write(work)

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
        when = now or stamp_from().now
        return self._change(
            todo_id,
            lambda todo: updated_todo(
                todo,
                title=title,
                description=description,
                priority=priority,
                completed=completed,
                now=when,
            ),
        )

    def toggle(self, todo_id: str, now: str | None = None) -> Todo | None:
        when = now or stamp_from().now
        return self._change(
            todo_id, lambda todo: updated_todo(todo, completed=not todo.completed, now=when)
        )

    def delete(self, todo_id: str, now: str | None = None) -> Todo | None:
        when = now or stamp_from().now

        def work(db: sqlite3.Connection) -> Todo | None:
            current = self._get(db, TODOS, todo_id)
            if current is None:
                return None
            deleted = _todo_of(current).model_copy(update={"deletedAt": when})
            self._remove(db, TODOS, todo_id)
            self._put(db, DELETED, self._row(deleted))
            return deleted

        return self._write(work)

    def restore(self, todo_id: str) -> Todo | None:
        def work(db: sqlite3.Connection) -> Todo | None:
            current = self._get(db, DELETED, todo_id)
            if current is None:
                return None
            todo = _todo_of(current).model_copy(update={"deletedAt": None})
            self._remove(db, DELETED, todo_id)
            self._put(db, TODOS, self._row(todo))
            return todo

        return self._write(work)

    def _clear(self, tables: list[str], keep: Callable[[dict[str, Any]], bool]) -> ClearResult:
        """Remove the rows of ``tables`` that ``keep`` rejects, read inside the transaction."""

        def work(db: sqlite3.Connection) -> ClearResult:
            cleared: list[str] = []
            for table in tables:
                for row in self._rows(db, table):
                    if not keep(row):
                        self._remove(db, table, row["id"])
                        cleared.append(row["id"])
            (remaining,) = db.execute(
                "SELECT count(*) FROM records WHERE tbl = ?", (TODOS,)
            ).fetchone()
            return ClearResult(cleared, int(remaining))

        return self._write(work)

    def clear_completed(self) -> ClearResult:
        return self._clear([TODOS], lambda row: not row.get("completed"))

    def clear_deleted(self) -> ClearResult:
        return self._clear([DELETED], lambda row: False)

    def clear_all(self) -> ClearResult:
        return self._clear([TODOS, DELETED], lambda row: False)

    def stats(self) -> dict[str, Any]:
        return stats_of(self._snapshot()[0])

    def record(self, change: dict[str, Any]) -> dict[str, Any]:
        """Add a change, keeping the latest :data:`HISTORY_LIMIT`. The next ``seq`` is read in
        the same transaction as the write, so two Python writers never take the same one. The
        TypeScript store reads it before its write
        (https://github.com/lushly-dev/afd/issues/1317), so when a TypeScript and another writer
        record at the same moment both can take one ``seq``, and the later entry replaces the
        earlier one."""

        def work(db: sqlite3.Connection) -> dict[str, Any]:
            latest = db.execute(
                "SELECT value FROM records WHERE tbl = ? ORDER BY id DESC LIMIT 1", (CHANGES,)
            ).fetchone()
            seq = (json.loads(latest[0])["seq"] if latest else 0) + 1
            entry = {"seq": seq, **change}
            self._put(db, CHANGES, {**entry, "id": change_id(seq)})
            if seq - HISTORY_LIMIT > 0:
                self._remove(db, CHANGES, change_id(seq - HISTORY_LIMIT))
            return entry

        return self._write(work)

    def history(self) -> list[dict[str, Any]]:
        """The recorded changes, oldest first."""
        with self._read() as db:
            rows = [
                json.loads(value)
                for (value,) in db.execute(
                    "SELECT value FROM records WHERE tbl = ? ORDER BY id", (CHANGES,)
                )
            ]
        rows.sort(key=lambda row: row["seq"])
        return [{key: value for key, value in row.items() if key != "id"} for row in rows]

    def clear(self) -> None:
        """Remove everything: live and deleted todos and the history (for tests)."""
        self._write(
            lambda db: db.execute(
                "DELETE FROM records WHERE tbl IN (?, ?, ?)", (TODOS, DELETED, CHANGES)
            )
        )

    def count(self) -> int:
        with self._read() as db:
            (count,) = db.execute("SELECT count(*) FROM records WHERE tbl = ?", (TODOS,)).fetchone()
        return int(count)
