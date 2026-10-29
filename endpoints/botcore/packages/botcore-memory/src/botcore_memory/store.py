"""Abstract base class for memory stores."""

from __future__ import annotations

from abc import ABC, abstractmethod

from .models import MemoryEntry


class MemoryScopeFullError(Exception):
    """Raised when a scope has reached its configured maximum entry count."""


class MemoryStore(ABC):
    """Interface for memory storage backends."""

    @abstractmethod
    async def set(
        self,
        entry: MemoryEntry,
        max_entries_per_scope: int | None = None,
    ) -> MemoryEntry:
        """Store or update a memory entry (upsert by key). Returns the stored entry."""

    @abstractmethod
    async def get(self, scope: str, scope_id: str, key: str) -> MemoryEntry | None:
        """Retrieve a single entry by scope + key. Returns None if not found."""

    @abstractmethod
    async def search(
        self,
        scope: str,
        scope_id: str | None,
        query: str,
        tags: list[str] | None,
        limit: int,
    ) -> list[MemoryEntry]:
        """Search entries by substring match on key/value and optional tag intersection."""

    @abstractmethod
    async def delete(self, scope: str, scope_id: str, key: str) -> bool:
        """Delete an entry. Returns True if deleted, False if not found."""

    @abstractmethod
    async def list_entries(
        self,
        scope: str,
        scope_id: str,
        prefix: str | None,
        offset: int,
        limit: int,
    ) -> list[MemoryEntry]:
        """List entries with optional key prefix filter and pagination."""
