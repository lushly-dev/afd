"""Tests for memory commands — success and error paths."""

from __future__ import annotations

from afd.testing import assert_error, assert_success

from botcore_memory.commands import (
    configure,
    get_store,
    memory_delete,
    memory_get,
    memory_list,
    memory_search,
    memory_set,
)
from botcore_memory.local_store import LocalMemoryStore
from botcore_memory.models import MemoryConfig


class TestMemorySet:
    async def test_basic_set(self):
        result = await memory_set(key="hello", value="world")
        data = assert_success(result)
        assert data["key"] == "hello"
        assert data["value"] == "world"
        assert data["scope"] == "agent"
        assert result.undo_command == "memory_delete"
        assert result.undo_args == {
            "key": "hello",
            "scope": "agent",
            "scope_id": "test-agent",
        }

    async def test_set_with_tags(self):
        result = await memory_set(key="tagged", value="data", tags=["a", "b"])
        data = assert_success(result)
        assert data["tags"] == ["a", "b"]

    async def test_set_with_explicit_scope(self):
        result = await memory_set(key="shared", value="info", scope="team", scope_id="alpha")
        data = assert_success(result)
        assert data["scope"] == "team"
        assert data["scope_id"] == "alpha"

    async def test_set_invalid_key_empty(self):
        result = await memory_set(key="", value="v")
        assert_error(result, "MEMORY_INVALID_KEY")

    async def test_set_invalid_key_format(self):
        result = await memory_set(key="/bad-key", value="v")
        assert_error(result, "MEMORY_INVALID_KEY")

    async def test_set_invalid_scope(self):
        result = await memory_set(key="k", value="v", scope="global")
        assert_error(result, "MEMORY_INVALID_SCOPE")

    async def test_set_value_too_large(self):
        big_value = "x" * 20000
        result = await memory_set(key="big", value=big_value)
        assert_error(result, "MEMORY_VALUE_TOO_LARGE")

    async def test_upsert(self):
        await memory_set(key="counter", value="1")
        result = await memory_set(key="counter", value="2")
        assert_success(result)
        assert result.undo_command == "memory_set"
        assert result.undo_args == {
            "key": "counter",
            "value": "1",
            "scope": "agent",
            "scope_id": "test-agent",
            "tags": [],
        }

        get_result = await memory_get(key="counter")
        assert get_result.data["value"] == "2"


class TestMemoryGet:
    async def test_get_existing(self):
        await memory_set(key="exists", value="yes")
        result = await memory_get(key="exists")
        data = assert_success(result)
        assert data["value"] == "yes"

    async def test_get_not_found(self):
        result = await memory_get(key="nope")
        assert_error(result, "MEMORY_NOT_FOUND")

    async def test_get_invalid_scope(self):
        result = await memory_get(key="k", scope="bad")
        assert_error(result, "MEMORY_INVALID_SCOPE")

    async def test_get_defaults_scope_id_to_agent(self):
        await memory_set(key="mine", value="v")
        result = await memory_get(key="mine")
        data = assert_success(result)
        assert data["scope_id"] == "test-agent"


class TestMemorySearch:
    async def test_search_finds_match(self):
        await memory_set(key="greet", value="hello world")
        result = await memory_search(query="hello")
        data = assert_success(result)
        assert len(data) >= 1

    async def test_search_no_match(self):
        result = await memory_search(query="nonexistent-xyz")
        assert_success(result) == []

    async def test_search_with_tags(self):
        await memory_set(key="t1", value="data", tags=["important"])
        await memory_set(key="t2", value="data", tags=["temp"])
        result = await memory_search(query="data", tags=["important"])
        data = assert_success(result)
        assert len(data) == 1

    async def test_search_invalid_limit(self):
        result = await memory_search(query="q", limit=0)
        assert_error(result, "MEMORY_INVALID_LIMIT")

        result = await memory_search(query="q", limit=101)
        assert_error(result, "MEMORY_INVALID_LIMIT")

    async def test_search_invalid_scope(self):
        result = await memory_search(query="q", scope="bad")
        assert_error(result, "MEMORY_INVALID_SCOPE")


class TestMemoryDelete:
    async def test_delete_existing(self):
        await memory_set(key="doomed", value="v")
        result = await memory_delete(key="doomed")
        data = assert_success(result)
        assert data["deleted"] is True
        assert result.undo_command == "memory_set"
        assert result.undo_args == {
            "key": "doomed",
            "value": "v",
            "scope": "agent",
            "scope_id": "test-agent",
            "tags": [],
        }

        # Verify it's gone
        get_result = await memory_get(key="doomed")
        assert_error(get_result, "MEMORY_NOT_FOUND")

    async def test_delete_not_found(self):
        result = await memory_delete(key="ghost")
        assert_error(result, "MEMORY_NOT_FOUND")

    async def test_delete_invalid_scope(self):
        result = await memory_delete(key="k", scope="bad")
        assert_error(result, "MEMORY_INVALID_SCOPE")


class TestMemoryList:
    async def test_list_entries(self):
        await memory_set(key="a", value="1")
        await memory_set(key="b", value="2")
        result = await memory_list()
        data = assert_success(result)
        assert len(data["entries"]) == 2

    async def test_list_with_prefix(self):
        await memory_set(key="config/a", value="1")
        await memory_set(key="config/b", value="2")
        await memory_set(key="status", value="ok")
        result = await memory_list(prefix="config/")
        data = assert_success(result)
        assert len(data["entries"]) == 2

    async def test_list_pagination(self):
        for i in range(5):
            await memory_set(key=f"item{i}", value=str(i))
        result = await memory_list(offset=0, limit=2)
        data = assert_success(result)
        assert len(data["entries"]) == 2
        assert data["offset"] == 0
        assert data["limit"] == 2

    async def test_list_empty(self):
        result = await memory_list()
        data = assert_success(result)
        assert len(data["entries"]) == 0

    async def test_list_invalid_limit(self):
        result = await memory_list(limit=0)
        assert_error(result, "MEMORY_INVALID_LIMIT")

    async def test_list_invalid_scope(self):
        result = await memory_list(scope="bad")
        assert_error(result, "MEMORY_INVALID_SCOPE")


class TestScopeIdValidation:
    """Path traversal and invalid scope_id rejection."""

    async def test_set_rejects_path_traversal(self):
        result = await memory_set(
            key="k", value="v", scope="team", scope_id="../../escape",
        )
        assert_error(result, "MEMORY_INVALID_SCOPE_ID")

    async def test_get_rejects_path_traversal(self):
        result = await memory_get(key="k", scope="team", scope_id="../etc")
        assert_error(result, "MEMORY_INVALID_SCOPE_ID")

    async def test_delete_rejects_path_traversal(self):
        result = await memory_delete(key="k", scope="team", scope_id="foo/bar")
        assert_error(result, "MEMORY_INVALID_SCOPE_ID")

    async def test_list_rejects_path_traversal(self):
        result = await memory_list(scope="team", scope_id="..")
        assert_error(result, "MEMORY_INVALID_SCOPE_ID")

    async def test_search_rejects_path_traversal(self):
        result = await memory_search(
            query="q", scope="team", scope_id="../../passwd",
        )
        assert_error(result, "MEMORY_INVALID_SCOPE_ID")

    async def test_valid_scope_ids_accepted(self):
        result = await memory_set(key="k", value="v", scope="team", scope_id="team-alpha")
        assert_success(result)

        result = await memory_set(key="k2", value="v", scope="team", scope_id="team_beta")
        assert_success(result)

        result = await memory_set(key="k3", value="v", scope="team", scope_id="Team123")
        assert_success(result)


class TestConfigApplication:
    async def test_applies_local_path_from_config(self, tmp_path):
        custom_path = tmp_path / "custom-memory-root"
        configure(MemoryConfig(local_path=str(custom_path)))

        result = await memory_set(key="cfg", value="ok")
        assert_success(result)

        assert (custom_path / "agent" / "test-agent.json").exists()

    async def test_enforces_max_entries_per_scope(self):
        configure(MemoryConfig(max_entries_per_scope=1))

        first = await memory_set(key="k1", value="v1")
        assert_success(first)

        second = await memory_set(key="k2", value="v2")
        assert_error(second, "MEMORY_SCOPE_FULL")

    async def test_upsert_does_not_count_against_scope_limit(self):
        configure(MemoryConfig(max_entries_per_scope=1))

        first = await memory_set(key="k1", value="v1")
        assert_success(first)

        update = await memory_set(key="k1", value="v2")
        assert_success(update)

        check = await memory_get(key="k1")
        data = assert_success(check)
        assert data["value"] == "v2"

    def test_configure_recreates_store_singleton(self, tmp_path):
        first_path = tmp_path / "a"
        second_path = tmp_path / "b"

        configure(MemoryConfig(local_path=str(first_path)))
        store_a = get_store()
        assert isinstance(store_a, LocalMemoryStore)

        configure(MemoryConfig(local_path=str(second_path)))
        store_b = get_store()
        assert isinstance(store_b, LocalMemoryStore)
        assert store_a is not store_b
