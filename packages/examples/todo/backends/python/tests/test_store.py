"""Tests for the JSON file store: seeding, atomic writes and corrupt files."""

from __future__ import annotations

import json

import pytest

from todo_backend import FileStore, MemoryStore, StoreCorruptError, create_app, create_store
from todo_backend.store import DEFAULT_SEED_PATH


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
    assert [entry.name for entry in tmp_path.iterdir()] == ["todos.json"]


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


async def test_corruption_while_running_fails_the_command_without_erasing_data(tmp_path):
    path = tmp_path / "todos.json"
    server = create_app(FileStore(path))
    assert (await server.call_tool("todo-create", {"title": "Keep me"})).success
    path.write_text("not json")

    result = await server.call_tool("todo-create", {"title": "Overwrite?"})

    assert result.success is False
    assert result.error.code == "COMMAND_EXECUTION_ERROR"
    assert path.read_text() == "not json"


def test_file_deleted_while_running_starts_empty(tmp_path):
    path = tmp_path / "todos.json"
    store = FileStore(path)
    store.create("Gone")
    path.unlink()

    assert store.count() == 0
    store.create("Fresh")
    assert FileStore(path).count() == 1


def test_create_store_follows_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("TODO_STORE_TYPE", "memory")
    assert type(create_store()) is MemoryStore

    path = tmp_path / "custom.json"
    monkeypatch.setenv("TODO_STORE_TYPE", "file")
    monkeypatch.setenv("TODO_STORE_PATH", str(path))
    store = create_store()
    assert isinstance(store, FileStore)
    assert store.path == path
    assert store.count() == 0

    monkeypatch.setenv("TODO_STORE_TYPE", "sqlite")
    with pytest.raises(ValueError):
        create_store()
