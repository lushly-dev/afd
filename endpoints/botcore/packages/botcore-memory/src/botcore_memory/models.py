"""Memory data models — MemoryEntry and MemoryConfig."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

KEY_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9/_-]*$")
SCOPE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
MAX_KEY_LENGTH = 256
MAX_SCOPE_ID_LENGTH = 128
VALID_SCOPES = frozenset({"agent", "team", "task"})


@dataclass
class MemoryEntry:
    """A single memory entry stored by an agent."""

    scope: str
    scope_id: str
    key: str
    value: str
    id: str = field(default_factory=lambda: f"mem_{uuid.uuid4().hex[:12]}")
    tags: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    created_by: str = ""
    ttl: int | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict."""
        return {
            "id": self.id,
            "scope": self.scope,
            "scope_id": self.scope_id,
            "key": self.key,
            "value": self.value,
            "tags": self.tags,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "created_by": self.created_by,
            "ttl": self.ttl,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MemoryEntry:
        """Deserialize from a dict."""
        return cls(
            id=data["id"],
            scope=data["scope"],
            scope_id=data["scope_id"],
            key=data["key"],
            value=data["value"],
            tags=data.get("tags", []),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
            created_by=data.get("created_by", ""),
            ttl=data.get("ttl"),
        )


def validate_key(key: str) -> str | None:
    """Return an error message if key is invalid, None if OK."""
    if not key:
        return "Key must not be empty"
    if len(key) > MAX_KEY_LENGTH:
        return f"Key exceeds maximum length of {MAX_KEY_LENGTH} characters"
    if not KEY_PATTERN.match(key):
        return "Key must start with alphanumeric and contain only alphanumeric, '/', '_', '-'"
    return None


def validate_scope_id(scope_id: str) -> str | None:
    """Return an error message if scope_id is invalid, None if OK.

    Scope IDs are used as filesystem path components, so they must not contain
    path separators or traversal sequences.
    """
    if not scope_id:
        return "scope_id must not be empty"
    if len(scope_id) > MAX_SCOPE_ID_LENGTH:
        return f"scope_id exceeds maximum length of {MAX_SCOPE_ID_LENGTH} characters"
    if not SCOPE_ID_PATTERN.match(scope_id):
        return (
            "scope_id must start with alphanumeric and contain only"
            " alphanumeric, '_', '-' (no '/' or '..')"
        )
    return None


def validate_scope(scope: str) -> str | None:
    """Return an error message if scope is invalid, None if OK."""
    if scope not in VALID_SCOPES:
        return f"Invalid scope '{scope}'. Must be one of: {', '.join(sorted(VALID_SCOPES))}"
    return None


class MemoryConfig(BaseModel):
    """Configuration for the memory plugin."""

    model_config = ConfigDict(extra="forbid")

    store: Literal["local"] = "local"
    local_path: str = "~/.botcore/memory"
    task_ttl_days: int = 7
    max_entries_per_scope: int = 1000
    max_entry_size_bytes: int = 10240
