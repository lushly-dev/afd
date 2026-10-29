"""Memory CRUD commands — memory_set, memory_get, memory_search, memory_delete, memory_list."""

from __future__ import annotations

from pathlib import Path

from afd import CommandResult, error, success

from .access import check_scope_access, current_agent, resolve_scope_id
from .local_store import LocalMemoryStore
from .models import MemoryConfig, MemoryEntry, validate_key, validate_scope, validate_scope_id
from .store import MemoryScopeFullError, MemoryStore

# Module-level singleton store, lazily initialized.
_store: MemoryStore | None = None
_config: MemoryConfig = MemoryConfig()


def configure(config: MemoryConfig) -> None:
    """Set plugin configuration (called during plugin init)."""
    global _config, _store
    _config = config
    _store = None  # Reset so next access re-creates with new config


def reset() -> None:
    """Reset module state (store + config). For testing only."""
    global _config, _store
    _config = MemoryConfig()
    _store = None


def get_store() -> MemoryStore:
    """Get or create the memory store singleton."""
    global _store
    if _store is None:
        path = Path(_config.local_path).expanduser()
        _store = LocalMemoryStore(path)
    return _store


def _check_limit(limit: int) -> CommandResult | None:
    """Return an error if limit is out of range, None if OK."""
    if limit < 1 or limit > 100:
        return error(
            "MEMORY_INVALID_LIMIT",
            f"Limit must be between 1 and 100, got {limit}",
        )
    return None


async def memory_set(
    key: str,
    value: str,
    scope: str = "agent",
    scope_id: str | None = None,
    tags: list[str] | None = None,
) -> CommandResult[dict]:
    """Store a memory entry (upsert by key).

    Args:
        key: Memory key (alphanumeric, '/', '_', '-'; max 256 chars).
        value: Value to store (max 10KB by default).
        scope: One of 'agent', 'team', 'task'.
        scope_id: Scope identifier. Defaults to caller agent name for agent scope.
        tags: Optional list of tags for search filtering.
    """
    # Validate scope
    if err := validate_scope(scope):
        return error("MEMORY_INVALID_SCOPE", err)

    # Validate key
    if err := validate_key(key):
        return error("MEMORY_INVALID_KEY", err)

    # Validate value size
    if len(value.encode("utf-8")) > _config.max_entry_size_bytes:
        return error(
            "MEMORY_VALUE_TOO_LARGE",
            f"Value exceeds maximum size of {_config.max_entry_size_bytes} bytes",
            suggestion="Reduce value size or increase max_entry_size_bytes in config",
        )

    resolved_scope_id = resolve_scope_id(scope, scope_id)
    if err := validate_scope_id(resolved_scope_id):
        return error("MEMORY_INVALID_SCOPE_ID", err)

    # Access check
    caller = current_agent.get() or "default"
    if access_err := check_scope_access(caller, scope, resolved_scope_id, "write"):
        return error(access_err.code, access_err.message, suggestion=access_err.suggestion)

    store = get_store()
    previous = await store.get(scope, resolved_scope_id, key)

    entry = MemoryEntry(
        scope=scope,
        scope_id=resolved_scope_id,
        key=key,
        value=value,
        tags=tags or [],
        created_by=caller,
    )

    try:
        stored = await store.set(entry, max_entries_per_scope=_config.max_entries_per_scope)
    except MemoryScopeFullError:
        return error(
            "MEMORY_SCOPE_FULL",
            (
                "Memory scope reached entry limit "
                f"({_config.max_entries_per_scope}) for {scope}/{resolved_scope_id}"
            ),
            suggestion="Delete old entries or raise max_entries_per_scope in config",
        )

    if previous:
        undo_command = "memory_set"
        undo_args = {
            "key": previous.key,
            "value": previous.value,
            "scope": previous.scope,
            "scope_id": previous.scope_id,
            "tags": previous.tags,
        }
    else:
        undo_command = "memory_delete"
        undo_args = {
            "key": stored.key,
            "scope": stored.scope,
            "scope_id": stored.scope_id,
        }

    return success(
        data=stored.to_dict(),
        undo_command=undo_command,
        undo_args=undo_args,
    )


async def memory_get(
    key: str,
    scope: str = "agent",
    scope_id: str | None = None,
) -> CommandResult[dict]:
    """Retrieve a memory entry by key.

    Args:
        key: Memory key to look up.
        scope: One of 'agent', 'team', 'task'.
        scope_id: Scope identifier. Defaults to caller agent name for agent scope.
    """
    if err := validate_scope(scope):
        return error("MEMORY_INVALID_SCOPE", err)

    resolved_scope_id = resolve_scope_id(scope, scope_id)
    if err := validate_scope_id(resolved_scope_id):
        return error("MEMORY_INVALID_SCOPE_ID", err)

    caller = current_agent.get() or "default"
    if access_err := check_scope_access(caller, scope, resolved_scope_id, "read"):
        return error(access_err.code, access_err.message, suggestion=access_err.suggestion)

    store = get_store()
    entry = await store.get(scope, resolved_scope_id, key)

    if not entry:
        return error(
            "MEMORY_NOT_FOUND",
            f"No memory entry found for key '{key}' in {scope}/{resolved_scope_id}",
        )

    return success(data=entry.to_dict())


async def memory_search(
    query: str,
    scope: str = "agent",
    scope_id: str | None = None,
    tags: list[str] | None = None,
    limit: int = 10,
) -> CommandResult[dict]:
    """Search memory entries by substring match on key/value.

    Args:
        query: Search string (case-insensitive substring match).
        scope: One of 'agent', 'team', 'task'.
        scope_id: Scope identifier. None searches all scope_ids within the scope.
        tags: Optional tag filter (entries must have at least one matching tag).
        limit: Max results (1-100, default 10).
    """
    if err := validate_scope(scope):
        return error("MEMORY_INVALID_SCOPE", err)

    if limit_err := _check_limit(limit):
        return limit_err

    # For agent scope, always resolve to the caller's own scope_id to prevent
    # cross-agent memory leakage. For team/task scopes, None means "search all".
    if scope == "agent":
        resolved_scope_id = resolve_scope_id(scope, scope_id)
    else:
        resolved_scope_id = scope_id

    if resolved_scope_id:
        if err := validate_scope_id(resolved_scope_id):
            return error("MEMORY_INVALID_SCOPE_ID", err)
        caller = current_agent.get() or "default"
        if access_err := check_scope_access(caller, scope, resolved_scope_id, "read"):
            return error(access_err.code, access_err.message, suggestion=access_err.suggestion)

    store = get_store()
    entries = await store.search(scope, resolved_scope_id, query, tags, limit)

    return success(data=[e.to_dict() for e in entries])


async def memory_delete(
    key: str,
    scope: str = "agent",
    scope_id: str | None = None,
) -> CommandResult[dict]:
    """Delete a memory entry by key.

    Args:
        key: Memory key to delete.
        scope: One of 'agent', 'team', 'task'.
        scope_id: Scope identifier. Defaults to caller agent name for agent scope.
    """
    if err := validate_scope(scope):
        return error("MEMORY_INVALID_SCOPE", err)

    resolved_scope_id = resolve_scope_id(scope, scope_id)
    if err := validate_scope_id(resolved_scope_id):
        return error("MEMORY_INVALID_SCOPE_ID", err)

    caller = current_agent.get() or "default"
    if access_err := check_scope_access(caller, scope, resolved_scope_id, "write"):
        return error(access_err.code, access_err.message, suggestion=access_err.suggestion)

    store = get_store()
    existing = await store.get(scope, resolved_scope_id, key)

    if not existing:
        return error(
            "MEMORY_NOT_FOUND",
            f"No memory entry found for key '{key}' in {scope}/{resolved_scope_id}",
        )

    await store.delete(scope, resolved_scope_id, key)

    return success(
        data={
            "deleted": True,
            "key": key,
            "scope": scope,
            "scope_id": resolved_scope_id,
        },
        undo_command="memory_set",
        undo_args={
            "key": existing.key,
            "value": existing.value,
            "scope": existing.scope,
            "scope_id": existing.scope_id,
            "tags": existing.tags,
        },
    )


async def memory_list(
    scope: str = "agent",
    scope_id: str | None = None,
    prefix: str | None = None,
    offset: int = 0,
    limit: int = 10,
) -> CommandResult[dict]:
    """List memory entries with optional prefix filter and pagination.

    Args:
        scope: One of 'agent', 'team', 'task'.
        scope_id: Scope identifier. Defaults to caller agent name for agent scope.
        prefix: Optional key prefix filter.
        offset: Pagination offset (default 0).
        limit: Max results per page (1-100, default 10).
    """
    if err := validate_scope(scope):
        return error("MEMORY_INVALID_SCOPE", err)

    if limit_err := _check_limit(limit):
        return limit_err

    resolved_scope_id = resolve_scope_id(scope, scope_id)
    if err := validate_scope_id(resolved_scope_id):
        return error("MEMORY_INVALID_SCOPE_ID", err)

    caller = current_agent.get() or "default"
    if access_err := check_scope_access(caller, scope, resolved_scope_id, "read"):
        return error(access_err.code, access_err.message, suggestion=access_err.suggestion)

    store = get_store()
    entries = await store.list_entries(scope, resolved_scope_id, prefix, offset, limit)

    return success(data={
        "entries": [e.to_dict() for e in entries],
        "scope": scope,
        "scope_id": resolved_scope_id,
        "offset": offset,
        "limit": limit,
    })


MEMORY_COMMANDS = [memory_set, memory_get, memory_search, memory_delete, memory_list]

MEMORY_DOCS = """\
# Memory Commands

Persistent memory for agents across tasks and sessions.

## Commands

### memory_set(key, value, scope?, scope_id?, tags?)
Store a memory entry (upsert by key).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| key | str | required | Memory key (alphanumeric, `/`, `_`, `-`; max 256 chars) |
| value | str | required | Value to store (max 10KB) |
| scope | str | "agent" | One of `agent`, `team`, `task` |
| scope_id | str | caller agent | Scope identifier |
| tags | list[str] | [] | Tags for search filtering |

### memory_get(key, scope?, scope_id?)
Retrieve a memory entry by key.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| key | str | required | Memory key to look up |
| scope | str | "agent" | One of `agent`, `team`, `task` |
| scope_id | str | caller agent | Scope identifier |

### memory_search(query, scope?, scope_id?, tags?, limit?)
Search entries by substring match on key/value.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| query | str | required | Case-insensitive substring match |
| scope | str | "agent" | One of `agent`, `team`, `task` |
| scope_id | str | None | None = search all scope_ids |
| tags | list[str] | None | Tag filter (intersection) |
| limit | int | 10 | Max results (1-100) |

### memory_delete(key, scope?, scope_id?)
Delete a memory entry.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| key | str | required | Memory key to delete |
| scope | str | "agent" | One of `agent`, `team`, `task` |
| scope_id | str | caller agent | Scope identifier |

### memory_list(scope?, scope_id?, prefix?, offset?, limit?)
List entries with pagination.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| scope | str | "agent" | One of `agent`, `team`, `task` |
| scope_id | str | caller agent | Scope identifier |
| prefix | str | None | Key prefix filter |
| offset | int | 0 | Pagination offset |
| limit | int | 10 | Max results (1-100) |

## Scopes

- **agent**: Private to one agent. scope_id = agent name.
- **team**: Shared across agents in a team. scope_id = team name.
- **task**: Scoped to a task. scope_id = task identifier.

## Access Control

- Agent scope: only the owning agent can read/write.
- Team/task scopes: open access (Phase 1).
"""
