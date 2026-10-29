"""Tests for MemoryEntry and MemoryConfig models."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from botcore_memory.models import (
    MemoryConfig,
    MemoryEntry,
    validate_key,
    validate_scope,
    validate_scope_id,
)


class TestMemoryEntry:
    def test_create_defaults(self):
        entry = MemoryEntry(scope="agent", scope_id="bot-1", key="greeting", value="hello")
        assert entry.scope == "agent"
        assert entry.scope_id == "bot-1"
        assert entry.key == "greeting"
        assert entry.value == "hello"
        assert entry.id.startswith("mem_")
        assert entry.tags == []
        assert entry.created_at
        assert entry.updated_at
        assert entry.created_by == ""
        assert entry.ttl is None

    def test_to_dict(self):
        entry = MemoryEntry(scope="team", scope_id="alpha", key="config/theme", value="dark")
        d = entry.to_dict()
        assert d["scope"] == "team"
        assert d["scope_id"] == "alpha"
        assert d["key"] == "config/theme"
        assert d["value"] == "dark"
        assert "id" in d
        assert "tags" in d
        assert "created_at" in d
        assert "updated_at" in d

    def test_from_dict_roundtrip(self):
        entry = MemoryEntry(
            scope="task",
            scope_id="task-42",
            key="progress",
            value="50%",
            tags=["status"],
            created_by="agent-x",
            ttl=3600,
        )
        d = entry.to_dict()
        restored = MemoryEntry.from_dict(d)
        assert restored.id == entry.id
        assert restored.scope == entry.scope
        assert restored.scope_id == entry.scope_id
        assert restored.key == entry.key
        assert restored.value == entry.value
        assert restored.tags == entry.tags
        assert restored.created_by == entry.created_by
        assert restored.ttl == entry.ttl

    def test_from_dict_missing_optional_fields(self):
        d = {
            "id": "mem_abc",
            "scope": "agent",
            "scope_id": "bot-1",
            "key": "test",
            "value": "val",
        }
        entry = MemoryEntry.from_dict(d)
        assert entry.tags == []
        assert entry.created_by == ""
        assert entry.ttl is None

    def test_unique_ids(self):
        e1 = MemoryEntry(scope="agent", scope_id="a", key="k", value="v")
        e2 = MemoryEntry(scope="agent", scope_id="a", key="k", value="v")
        assert e1.id != e2.id


class TestValidateKey:
    def test_valid_simple(self):
        assert validate_key("hello") is None

    def test_valid_with_slashes(self):
        assert validate_key("config/theme/dark") is None

    def test_valid_with_dashes_underscores(self):
        assert validate_key("my-key_v2") is None

    def test_valid_numeric_start(self):
        assert validate_key("1abc") is None

    def test_empty(self):
        assert validate_key("") is not None

    def test_too_long(self):
        assert validate_key("a" * 257) is not None

    def test_starts_with_slash(self):
        assert validate_key("/bad") is not None

    def test_starts_with_dash(self):
        assert validate_key("-bad") is not None

    def test_special_characters(self):
        assert validate_key("no spaces") is not None
        assert validate_key("no@special") is not None


class TestValidateScope:
    def test_valid_scopes(self):
        assert validate_scope("agent") is None
        assert validate_scope("team") is None
        assert validate_scope("task") is None

    def test_invalid_scope(self):
        assert validate_scope("global") is not None
        assert validate_scope("") is not None
        assert validate_scope("AGENT") is not None


class TestValidateScopeId:
    def test_valid_simple(self):
        assert validate_scope_id("agent-1") is None

    def test_valid_with_underscores(self):
        assert validate_scope_id("team_alpha") is None

    def test_valid_numeric(self):
        assert validate_scope_id("123abc") is None

    def test_empty(self):
        assert validate_scope_id("") is not None

    def test_too_long(self):
        assert validate_scope_id("a" * 129) is not None

    def test_rejects_path_traversal_dots(self):
        assert validate_scope_id("..") is not None
        assert validate_scope_id("../etc") is not None

    def test_rejects_slashes(self):
        assert validate_scope_id("foo/bar") is not None
        assert validate_scope_id("a/b/c") is not None

    def test_rejects_special_chars(self):
        assert validate_scope_id("no spaces") is not None
        assert validate_scope_id("no@at") is not None

    def test_rejects_starts_with_dash(self):
        assert validate_scope_id("-bad") is not None


class TestMemoryConfig:
    def test_defaults(self):
        config = MemoryConfig()
        assert config.store == "local"
        assert config.local_path == "~/.botcore/memory"
        assert config.task_ttl_days == 7
        assert config.max_entries_per_scope == 1000
        assert config.max_entry_size_bytes == 10240

    def test_custom_values(self):
        config = MemoryConfig(local_path="/tmp/mem", max_entry_size_bytes=2048)
        assert config.local_path == "/tmp/mem"
        assert config.max_entry_size_bytes == 2048

    def test_extra_fields_forbidden(self):
        with pytest.raises(ValidationError):
            MemoryConfig(unknown_field="bad")
