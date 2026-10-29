"""Tests for LocalMemoryStore — CRUD, search, pagination, concurrency."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from botcore_memory.local_store import LocalMemoryStore
from botcore_memory.models import MemoryEntry
from botcore_memory.store import MemoryScopeFullError


@pytest.fixture()
def store(tmp_path: Path) -> LocalMemoryStore:
    return LocalMemoryStore(tmp_path)


def _entry(key: str = "test-key", value: str = "test-value", **kw) -> MemoryEntry:
    defaults = {"scope": "agent", "scope_id": "bot-1", "key": key, "value": value}
    defaults.update(kw)
    return MemoryEntry(**defaults)


class TestSet:
    async def test_basic_set_and_get(self, store: LocalMemoryStore):
        entry = _entry()
        await store.set(entry)
        result = await store.get("agent", "bot-1", "test-key")
        assert result is not None
        assert result.key == "test-key"
        assert result.value == "test-value"

    async def test_upsert_preserves_id_and_created_at(self, store: LocalMemoryStore):
        e1 = _entry(value="v1")
        await store.set(e1)
        original = await store.get("agent", "bot-1", "test-key")

        e2 = _entry(value="v2")
        await store.set(e2)
        updated = await store.get("agent", "bot-1", "test-key")

        assert updated is not None
        assert updated.value == "v2"
        assert updated.id == original.id
        assert updated.created_at == original.created_at

    async def test_creates_directory_structure(self, store: LocalMemoryStore, tmp_path: Path):
        await store.set(_entry())
        assert (tmp_path / "agent" / "bot-1.json").exists()

    async def test_different_scope_ids_are_separate(self, store: LocalMemoryStore):
        await store.set(_entry(scope_id="bot-1", key="k", value="v1"))
        await store.set(_entry(scope_id="bot-2", key="k", value="v2"))

        r1 = await store.get("agent", "bot-1", "k")
        r2 = await store.get("agent", "bot-2", "k")
        assert r1.value == "v1"
        assert r2.value == "v2"

    async def test_respects_max_entries_per_scope(self, store: LocalMemoryStore):
        await store.set(_entry(key="k1"), max_entries_per_scope=1)

        with pytest.raises(MemoryScopeFullError):
            await store.set(_entry(key="k2"), max_entries_per_scope=1)

    async def test_upsert_ignored_for_scope_limit(self, store: LocalMemoryStore):
        await store.set(_entry(key="k1", value="v1"), max_entries_per_scope=1)

        updated = await store.set(_entry(key="k1", value="v2"), max_entries_per_scope=1)
        assert updated.value == "v2"


class TestGet:
    async def test_returns_none_for_missing(self, store: LocalMemoryStore):
        result = await store.get("agent", "bot-1", "nonexistent")
        assert result is None

    async def test_returns_none_for_missing_file(self, store: LocalMemoryStore):
        result = await store.get("agent", "no-such-agent", "key")
        assert result is None


class TestSearch:
    async def test_search_by_value(self, store: LocalMemoryStore):
        await store.set(_entry(key="k1", value="hello world"))
        await store.set(_entry(key="k2", value="goodbye"))

        results = await store.search("agent", "bot-1", "hello", None, 10)
        assert len(results) == 1
        assert results[0].key == "k1"

    async def test_search_by_key(self, store: LocalMemoryStore):
        await store.set(_entry(key="config/theme", value="dark"))
        await store.set(_entry(key="status", value="ok"))

        results = await store.search("agent", "bot-1", "config", None, 10)
        assert len(results) == 1
        assert results[0].key == "config/theme"

    async def test_search_case_insensitive(self, store: LocalMemoryStore):
        await store.set(_entry(key="k1", value="Hello World"))

        results = await store.search("agent", "bot-1", "hello world", None, 10)
        assert len(results) == 1

    async def test_search_with_tags(self, store: LocalMemoryStore):
        await store.set(_entry(key="k1", value="data", tags=["important"]))
        await store.set(_entry(key="k2", value="data", tags=["temp"]))

        results = await store.search("agent", "bot-1", "data", ["important"], 10)
        assert len(results) == 1
        assert results[0].key == "k1"

    async def test_search_limit(self, store: LocalMemoryStore):
        for i in range(5):
            await store.set(_entry(key=f"k{i}", value="match"))

        results = await store.search("agent", "bot-1", "match", None, 3)
        assert len(results) == 3

    async def test_search_all_scope_ids(self, store: LocalMemoryStore):
        await store.set(_entry(scope_id="bot-1", key="k1", value="shared"))
        await store.set(_entry(scope_id="bot-2", key="k2", value="shared"))

        results = await store.search("agent", None, "shared", None, 10)
        assert len(results) == 2

    async def test_search_empty_scope(self, store: LocalMemoryStore):
        results = await store.search("agent", "bot-1", "anything", None, 10)
        assert results == []


class TestDelete:
    async def test_delete_existing(self, store: LocalMemoryStore):
        await store.set(_entry())
        assert await store.delete("agent", "bot-1", "test-key") is True
        assert await store.get("agent", "bot-1", "test-key") is None

    async def test_delete_nonexistent(self, store: LocalMemoryStore):
        assert await store.delete("agent", "bot-1", "nope") is False


class TestListEntries:
    async def test_list_all(self, store: LocalMemoryStore):
        await store.set(_entry(key="a"))
        await store.set(_entry(key="b"))
        await store.set(_entry(key="c"))

        results = await store.list_entries("agent", "bot-1", None, 0, 10)
        assert len(results) == 3
        # Sorted by key
        assert [e.key for e in results] == ["a", "b", "c"]

    async def test_list_with_prefix(self, store: LocalMemoryStore):
        await store.set(_entry(key="config/a"))
        await store.set(_entry(key="config/b"))
        await store.set(_entry(key="status"))

        results = await store.list_entries("agent", "bot-1", "config/", 0, 10)
        assert len(results) == 2
        assert all(e.key.startswith("config/") for e in results)

    async def test_list_pagination(self, store: LocalMemoryStore):
        for i in range(5):
            await store.set(_entry(key=f"k{i}"))

        page1 = await store.list_entries("agent", "bot-1", None, 0, 2)
        page2 = await store.list_entries("agent", "bot-1", None, 2, 2)
        page3 = await store.list_entries("agent", "bot-1", None, 4, 2)

        assert len(page1) == 2
        assert len(page2) == 2
        assert len(page3) == 1
        all_keys = [e.key for e in page1 + page2 + page3]
        assert len(set(all_keys)) == 5

    async def test_list_empty(self, store: LocalMemoryStore):
        results = await store.list_entries("agent", "bot-1", None, 0, 10)
        assert results == []


class TestConcurrency:
    async def test_concurrent_writes(self, store: LocalMemoryStore):
        """Multiple concurrent writes to the same scope should not corrupt data."""

        async def write(i: int):
            await store.set(_entry(key=f"key-{i}", value=f"value-{i}"))

        await asyncio.gather(*(write(i) for i in range(20)))

        results = await store.list_entries("agent", "bot-1", None, 0, 100)
        assert len(results) == 20
