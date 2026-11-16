"""The stores: the JSON files (seeding, atomic writes, corrupt files, deleted todos and history
beside the main file), the SQLite database in the local-db adapter's layout (shared with the
TypeScript backend), and choosing one from the environment."""

from __future__ import annotations

import json
import re
import sqlite3

import pytest
from afd.testing import assert_error

from todo_backend import FileStore, MemoryStore, SqliteStore, StoreCorruptError, create_app
from todo_backend.shared import Stamp
from todo_backend.store import DEFAULT_SEED_PATH, EXAMPLE_ROOT, create_store

ADAPTER = EXAMPLE_ROOT.parents[1] / "local-db" / "src" / "sqlite-adapter.ts"

# ─── JSON files ────────────────────────────────────────────────────────────────


def test_custom_path_starts_empty(tmp_path):
    path = tmp_path / "nested" / "todos.json"
    store = FileStore(path)

    assert store.count() == 0
    assert json.loads(path.read_text()) == []


def test_missing_file_is_created_from_the_seed(tmp_path):
    path = tmp_path / "todos.json"
    store = FileStore(path, seed_path=DEFAULT_SEED_PATH)
    seed = json.loads(DEFAULT_SEED_PATH.read_text())

    assert len(seed) > 0
    assert store.count() == len(seed)
    assert json.loads(path.read_text()) == seed


def test_existing_file_is_not_reseeded(tmp_path):
    path = tmp_path / "todos.json"
    path.write_text("[]")

    assert FileStore(path, seed_path=DEFAULT_SEED_PATH).count() == 0


def test_changes_persist_without_leaving_temp_files(tmp_path):
    path = tmp_path / "todos.json"
    created = FileStore(path).create("Persisted", priority="high")

    reopened = FileStore(path)
    assert reopened.get(created.id).title == "Persisted"
    assert sorted(entry.name for entry in tmp_path.iterdir()) == [
        "todos.deleted.json",
        "todos.history.json",
        "todos.json",
    ]


def test_deleted_todos_and_history_live_beside_the_main_file(tmp_path):
    """The main file holds only live todos, so a reader of todos.json alone never sees a
    deleted one as live (the TypeScript file store's layout)."""
    path = tmp_path / "todos.json"
    store = FileStore(path)
    kept = store.create("Kept")
    gone = store.create("Gone")
    store.delete(gone.id, "2026-11-15T09:00:00.000Z")
    store.record({"at": "t", "actor": {"kind": "test"}, "command": "todo-delete", "ids": [gone.id]})

    assert [todo["id"] for todo in json.loads(path.read_text())] == [kept.id]
    deleted = json.loads((tmp_path / "todos.deleted.json").read_text())
    assert [(todo["id"], todo["deletedAt"]) for todo in deleted] == [
        (gone.id, "2026-11-15T09:00:00.000Z")
    ]
    assert json.loads((tmp_path / "todos.history.json").read_text())[0]["seq"] == 1


def test_a_todo_in_both_files_counts_as_live(tmp_path):
    path = tmp_path / "todos.json"
    store = FileStore(path)
    todo = store.create("Both")
    (tmp_path / "todos.deleted.json").write_text(
        json.dumps([{**todo.model_dump(mode="json"), "deletedAt": "t"}])
    )

    assert store.get(todo.id) is not None
    assert store.list(deleted=True) == []


def test_reads_the_older_object_format(tmp_path):
    path = tmp_path / "todos.json"
    todo = {
        "id": "todo-1",
        "title": "Legacy",
        "priority": "low",
        "completed": False,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
    }
    path.write_text(json.dumps({"todo-1": todo}))

    assert FileStore(path).get("todo-1").model_dump(mode="json") == todo


@pytest.mark.parametrize(
    "content",
    ['[{"id": "todo-1", "title": "trunc', '"a string"', '[{"title": "no id"}]', ""],
)
def test_refuses_to_start_on_a_corrupt_file(tmp_path, content):
    path = tmp_path / "todos.json"
    path.write_text(content)

    with pytest.raises(StoreCorruptError):
        FileStore(path)
    assert path.read_text() == content


def test_refuses_a_corrupt_history_file(tmp_path):
    (tmp_path / "todos.history.json").write_text('[{"seq": "one"}]')

    with pytest.raises(StoreCorruptError, match="invalid change at index 0"):
        FileStore(tmp_path / "todos.json")


async def test_corruption_while_running_fails_the_command_without_erasing_data(tmp_path):
    path = tmp_path / "todos.json"
    server = create_app(FileStore(path), {"APPROVALS": "off"})
    assert (await server.call_tool("todo-create", {"title": "Keep me"})).success
    path.write_text("not json")

    result = await server.call_tool("todo-create", {"title": "Overwrite?"})

    assert_error(result, "COMMAND_EXECUTION_ERROR")
    assert path.read_text() == "not json"


def test_file_deleted_while_running_starts_empty(tmp_path):
    path = tmp_path / "todos.json"
    store = FileStore(path)
    store.create("Gone")
    path.unlink()

    assert store.count() == 0
    store.create("Fresh")
    assert FileStore(path).count() == 1


# ─── SQLite ────────────────────────────────────────────────────────────────────


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "todos.db"


@pytest.fixture
def open_store(db_path):
    opened: list[SqliteStore] = []

    def open_one(**options) -> SqliteStore:
        store = SqliteStore(db_path, **options)
        opened.append(store)
        return store

    yield open_one
    for store in opened:
        store.close()


def raw(db_path, sql, *args):
    with sqlite3.connect(db_path) as db:
        return db.execute(sql, args).fetchall()


def test_sqlite_writes_the_local_db_adapter_layout(open_store, db_path):
    """The table, version and pragmas the TypeScript adapter creates and accepts, read from its
    source, and the todo store's records as the TypeScript store writes them."""
    store = open_store()
    todo = store.create("Laid out", "With a note", "high")
    store.record({"at": "t", "actor": {"kind": "test"}, "command": "todo-create", "ids": [todo.id]})

    schema = re.search(r"const SCHEMA = `([^`]+)`", ADAPTER.read_text(encoding="utf-8"))
    assert schema, f"No SCHEMA in {ADAPTER}"
    assert raw(db_path, "SELECT sql FROM sqlite_master WHERE type = 'table'") == [
        (schema.group(1),)
    ]
    assert re.search(r"const SCHEMA_VERSION = 1;", ADAPTER.read_text(encoding="utf-8"))
    assert raw(db_path, "PRAGMA user_version") == [(1,)]
    assert raw(db_path, "PRAGMA journal_mode") == [("wal",)]

    rows = {
        tbl: (record_id, json.loads(value))
        for tbl, record_id, value in raw(db_path, "SELECT tbl, id, value FROM records")
    }
    record_id, value = rows["todos"]
    assert record_id == todo.id
    assert value == {**todo.model_dump(mode="json"), "_order": value["_order"]}
    assert isinstance(value["_order"], int)
    assert rows["changes"] == (
        "000000000001",
        {
            "seq": 1,
            "at": "t",
            "actor": {"kind": "test"},
            "command": "todo-create",
            "ids": [todo.id],
            "id": "000000000001",
        },
    )


@pytest.mark.parametrize(
    "prepare",
    [
        "CREATE TABLE other (x)",
        "PRAGMA user_version = 7",
    ],
)
def test_sqlite_refuses_a_database_it_did_not_create(db_path, prepare):
    with sqlite3.connect(db_path) as db:
        db.execute(prepare)
    before = db_path.read_bytes()

    with pytest.raises(StoreCorruptError, match="was not created by SqliteAdapter"):
        SqliteStore(db_path)
    assert db_path.read_bytes() == before
    assert raw(db_path, "PRAGMA journal_mode") == [("delete",)]


def test_sqlite_shares_todos_deleted_todos_and_history_across_connections(open_store):
    first, second = open_store(), open_store()
    kept = first.create("Kept")
    gone = first.create("Gone")
    first.delete(gone.id, "2026-11-15T09:00:00.000Z")
    first.record({"at": "t", "actor": {"kind": "test"}, "command": "todo-delete", "ids": [gone.id]})

    assert second.get(kept.id).title == "Kept"
    assert second.get(gone.id) is None
    assert second.get_deleted(gone.id).deletedAt == "2026-11-15T09:00:00.000Z"
    assert len(second.history()) == 1


def test_sqlite_changes_nothing_on_a_todo_another_process_removed(open_store):
    """A write reads its row inside its transaction, so a todo removed meanwhile is reported
    missing and does not come back."""
    mine, theirs = open_store(), open_store()
    todo = mine.create("Contested")
    assert mine.get(todo.id) is not None

    theirs.delete(todo.id)
    assert mine.update(todo.id, title="Too late") is None
    assert mine.toggle(todo.id) is None
    assert mine.delete(todo.id) is None
    assert mine.get(todo.id) is None
    assert mine.get_deleted(todo.id).title == "Contested"

    theirs.clear_deleted()
    assert mine.restore(todo.id) is None
    assert mine.count() == 0


def test_sqlite_restores_a_todo_as_it_was_and_after_the_others(open_store):
    store = open_store()
    first = store.create("First", "Note", "high")
    store.create("Second")
    store.delete(first.id, "2026-11-15T09:00:00.000Z")

    assert store.restore(first.id) == first
    assert store.get_deleted(first.id) is None
    # Ties on createdAt (none here) and the default order keep the order rows entered the table
    assert [todo.title for todo in store.list(sort_order="asc", sort_by="title")] == [
        "First",
        "Second",
    ]


def test_sqlite_ties_keep_the_order_todos_entered(open_store):
    """As the in-memory store: todos created at the same moment list in creation order."""
    store, memory = open_store(), MemoryStore()
    for title in ["One", "Two", "Three"]:
        stamp = Stamp(now="2026-11-15T09:00:00.000Z", new_id=lambda title=title: f"todo-{title}")
        store.create(title, stamp=stamp)
        memory.create(title, stamp=stamp)

    for order in ("asc", "desc"):
        assert [t.title for t in store.list(sort_order=order)] == [
            t.title for t in memory.list(sort_order=order)
        ]
    assert [t.title for t in store.list()] == ["One", "Two", "Three"]


def test_sqlite_clears(open_store):
    store = open_store()
    done = store.create("Done")
    live = store.create("Live")
    gone = store.create("Gone")
    store.toggle(done.id)
    store.delete(gone.id)

    assert store.clear_completed().cleared_ids == [done.id]
    result = store.clear_deleted()
    assert (result.cleared_ids, result.remaining) == ([gone.id], 1)
    assert store.clear_all().cleared_ids == [live.id]
    assert store.count() == 0


def test_sqlite_seeds_only_the_database_it_creates(open_store, db_path):
    seed = json.loads(DEFAULT_SEED_PATH.read_text())

    seeded = open_store(seed_path=DEFAULT_SEED_PATH)
    assert [todo.model_dump(mode="json") for todo in seeded.list(sort_order="asc")] == seed
    seeded.clear_all()

    assert open_store(seed_path=DEFAULT_SEED_PATH).count() == 0


# ─── Choosing a store ──────────────────────────────────────────────────────────


def test_create_store_follows_the_environment(tmp_path):
    assert type(create_store({"TODO_STORE_TYPE": "memory"})) is MemoryStore

    path = tmp_path / "custom.json"
    store = create_store({"TODO_STORE_TYPE": "file", "TODO_STORE_PATH": str(path)})
    assert isinstance(store, FileStore)
    assert store.path == path
    assert store.count() == 0

    db = tmp_path / "custom.db"
    sqlite = create_store({"TODO_STORE_TYPE": "sqlite", "TODO_STORE_PATH": str(db)})
    assert isinstance(sqlite, SqliteStore)
    assert sqlite.path == db
    assert sqlite.count() == 0
    sqlite.close()

    with pytest.raises(ValueError, match="TODO_STORE_TYPE must be memory, file or sqlite"):
        create_store({"TODO_STORE_TYPE": "postgres"})


def test_the_default_is_the_seeded_database_typescript_also_opens(tmp_path, monkeypatch):
    """data/todos.db beside data/todos.json, the path TypeScript's DEFAULT_SQLITE_PATH names."""
    import todo_backend.store as stores

    assert stores.DEFAULT_SQLITE_PATH == EXAMPLE_ROOT / "data" / "todos.db"
    assert stores.DEFAULT_SQLITE_PATH.with_suffix(".json") == stores.DEFAULT_STORE_PATH
    ts_index = EXAMPLE_ROOT / "backends" / "typescript" / "src" / "store" / "index.ts"
    assert "DEFAULT_STORE_PATH.replace(/\\.json$/, '.db')" in ts_index.read_text(encoding="utf-8")
    assert "env.TODO_STORE_TYPE ?? 'sqlite'" in ts_index.read_text(encoding="utf-8")

    # Opening the real default would create it in the repository: point it elsewhere
    monkeypatch.setattr(stores, "DEFAULT_SQLITE_PATH", tmp_path / "todos.db")
    store = create_store({})
    assert isinstance(store, SqliteStore)
    assert store.count() == len(json.loads(DEFAULT_SEED_PATH.read_text()))
    store.close()
