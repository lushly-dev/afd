"""Local JSON file-based memory store."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
from pathlib import Path

from .models import MemoryEntry
from .store import MemoryScopeFullError, MemoryStore


class LocalMemoryStore(MemoryStore):
    """Stores memory entries as JSON files on the local filesystem.

    Layout: ``{base_path}/{scope}/{scope_id}.json``
    Each file is a JSON dict keyed by ``key`` → ``MemoryEntry.to_dict()``.
    """

    def __init__(self, base_path: Path) -> None:
        self._base_path = base_path
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock_key(self, scope: str, scope_id: str) -> str:
        return f"{scope}/{scope_id}"

    def _get_lock(self, scope: str, scope_id: str) -> asyncio.Lock:
        key = self._lock_key(scope, scope_id)
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    def _file_path(self, scope: str, scope_id: str) -> Path:
        return self._base_path / scope / f"{scope_id}.json"

    def _read_file(self, path: Path) -> dict[str, dict]:
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {}
        return json.loads(text) if text.strip() else {}

    @staticmethod
    def _replace_file(tmp_path: Path, target_path: Path) -> None:
        max_attempts = 5 if os.name == "nt" else 1
        for attempt in range(max_attempts):
            try:
                os.replace(tmp_path, target_path)
                return
            except PermissionError:
                if attempt + 1 >= max_attempts:
                    raise
                time.sleep(0.01 * (2**attempt))

    def _write_file(self, path: Path, data: dict[str, dict]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(data, indent=2, ensure_ascii=False)
        fd, tmp_name = tempfile.mkstemp(
            dir=path.parent,
            prefix=f".{path.stem}.",
            suffix=".tmp",
        )
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            self._replace_file(tmp_path, path)
        except BaseException:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    async def set(
        self,
        entry: MemoryEntry,
        max_entries_per_scope: int | None = None,
    ) -> MemoryEntry:
        """Store or update a memory entry (upsert by key). Returns the stored entry."""
        async with self._get_lock(entry.scope, entry.scope_id):
            path = self._file_path(entry.scope, entry.scope_id)
            data = self._read_file(path)

            if (
                entry.key not in data
                and max_entries_per_scope is not None
                and len(data) >= max_entries_per_scope
            ):
                raise MemoryScopeFullError(
                    f"Scope {entry.scope}/{entry.scope_id} reached "
                    f"max_entries_per_scope={max_entries_per_scope}"
                )

            if entry.key in data:
                # Upsert: preserve original id and created_at
                existing = data[entry.key]
                entry = MemoryEntry(
                    id=existing["id"],
                    scope=entry.scope,
                    scope_id=entry.scope_id,
                    key=entry.key,
                    value=entry.value,
                    tags=entry.tags,
                    created_at=existing["created_at"],
                    updated_at=entry.updated_at,
                    created_by=entry.created_by,
                    ttl=entry.ttl,
                )

            data[entry.key] = entry.to_dict()
            self._write_file(path, data)
            return entry

    async def get(self, scope: str, scope_id: str, key: str) -> MemoryEntry | None:
        """Retrieve a single entry by scope + key."""
        async with self._get_lock(scope, scope_id):
            path = self._file_path(scope, scope_id)
            data = self._read_file(path)
            raw = data.get(key)
            return MemoryEntry.from_dict(raw) if raw else None

    async def search(
        self,
        scope: str,
        scope_id: str | None,
        query: str,
        tags: list[str] | None,
        limit: int,
    ) -> list[MemoryEntry]:
        """Search entries by substring match on key/value and optional tag intersection."""
        results: list[MemoryEntry] = []
        query_lower = query.lower()
        scope_dir = self._base_path / scope

        if not scope_dir.exists():
            return []

        # Determine which files to search
        if scope_id:
            files = [self._file_path(scope, scope_id)]
        else:
            files = list(scope_dir.glob("*.json"))

        for file_path in files:
            async with self._get_lock(scope, file_path.stem):
                data = self._read_file(file_path)
            for raw in data.values():
                entry = MemoryEntry.from_dict(raw)
                # Substring match on key or value
                if query_lower not in entry.key.lower() and query_lower not in entry.value.lower():
                    continue
                # Tag intersection
                if tags and not set(tags).intersection(entry.tags):
                    continue
                results.append(entry)
                if len(results) >= limit:
                    return results

        return results

    async def delete(self, scope: str, scope_id: str, key: str) -> bool:
        """Delete an entry. Returns True if deleted, False if not found."""
        async with self._get_lock(scope, scope_id):
            path = self._file_path(scope, scope_id)
            data = self._read_file(path)
            if key not in data:
                return False
            del data[key]
            self._write_file(path, data)
            return True

    async def list_entries(
        self,
        scope: str,
        scope_id: str,
        prefix: str | None,
        offset: int,
        limit: int,
    ) -> list[MemoryEntry]:
        """List entries with optional key prefix filter and pagination."""
        async with self._get_lock(scope, scope_id):
            path = self._file_path(scope, scope_id)
            data = self._read_file(path)

            entries = [MemoryEntry.from_dict(raw) for raw in data.values()]

            if prefix:
                entries = [e for e in entries if e.key.startswith(prefix)]

            # Sort by key for deterministic pagination
            entries.sort(key=lambda e: e.key)
            return entries[offset : offset + limit]
