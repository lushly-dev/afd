"""MCP Tasks store, record model and options (``spec/command-metadata.md``, "Tasks"; SEP-2663).

Keeps the store contract, bounded in-memory default and configuration independent of the
optional ``mcp`` SDK so custom stores and unit tests can import the data model directly.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import json
import os
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

from afd.core.commands import CommandContext, CommandDefinition, validate_task_declaration
from afd.core.errors import CommandError
from afd.core.result import CommandResult, failure
from afd.core.wire import to_wire

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks"
"""Extension identifier for MCP Tasks (SEP-2663)."""

DEFAULT_TASK_TTL_MS = 3_600_000
"""A task's default post-completion retention (``TaskOptions.ttl_ms``): one hour."""

DEFAULT_TASK_MAX_RUN_MS = 3_600_000
"""A task's default execution run budget (``TaskOptions.max_run_ms``): one hour."""

DEFAULT_TASK_POLL_INTERVAL_MS = 1_000
"""A task's default ``pollIntervalMs``: one second."""

DEFAULT_TASK_CHECK_INTERVAL_MS = 1_000
"""How often a running task checks deadlines, progress and store cancellation by default."""

DEFAULT_MAX_TASK_RESULT_BYTES = 1024 * 1024
"""Largest serialized ``CallToolResult`` a task keeps by default: 1 MiB."""

DEFAULT_MAX_TASKS_PER_OWNER = 32
"""Default per-owner limit for :class:`InMemoryTaskStore`."""

DEFAULT_MAX_TASKS = 256
"""Default total limit across all owners for :class:`InMemoryTaskStore`."""

DEFAULT_MAX_RUNNING_TASKS = 64
"""Default maximum number of concurrently running tasks in one server process."""

_TASK_ID_LENGTH = 26
_TASK_ID_RE = re.compile(r"^[a-z2-7]{26}$")


# ═══════════════════════════════════════════════════════════════════════════════
# RECORD & STATE MODEL
# ═══════════════════════════════════════════════════════════════════════════════

TaskStatus = Literal["working", "completed", "failed", "cancelled"]
"""A task's status (SEP-2663). AFD tasks never pause for user input, so never ``input_required``."""


def is_terminal_task_status(status: str) -> bool:
    """Whether a task status is terminal (``completed``, ``failed`` or ``cancelled``)."""
    return status != "working"


@dataclass
class TaskRpcError:
    """JSON-RPC error object stored on a ``failed`` task."""

    code: int
    message: str
    data: Any = None

    def to_wire(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            payload["data"] = copy.deepcopy(self.data)
        return payload


@dataclass
class TaskRecord:
    """One task as a :class:`TaskStore` keeps it.

    Holds no token, credentials or input: only the owner's principal binding, the command name,
    the status, timestamps and the result or error once finished. Times are epoch milliseconds
    from the server's clock.
    """

    id: str = field(repr=False)
    owner: str = field(repr=False)
    command: str
    status: TaskStatus
    created_at: int
    last_updated_at: int
    ttl_ms: int
    poll_interval_ms: int
    status_message: str | None = None
    cancel_requested: bool = False
    result: dict[str, Any] | None = field(default=None, repr=False)
    error: TaskRpcError | None = field(default=None, repr=False)


@dataclass(frozen=True)
class TaskProgressChange:
    """Update a working task's ``statusMessage`` and ``lastUpdatedAt``."""

    message: str
    at: int
    kind: Literal["progress"] = "progress"


@dataclass(frozen=True)
class TaskCancelRequestedChange:
    """Mark a working task as having cooperative cancellation requested."""

    kind: Literal["cancel-requested"] = "cancel-requested"


@dataclass(frozen=True)
class TaskCompletedChange:
    """Move a working task to ``completed`` with its wire ``CallToolResult``."""

    result: dict[str, Any]
    at: int
    kind: Literal["completed"] = "completed"
    ttl_ms: int | None = field(default=None, kw_only=True)


@dataclass(frozen=True)
class TaskFailedChange:
    """Move a working task to ``failed`` with its JSON-RPC error object."""

    error: TaskRpcError
    at: int
    kind: Literal["failed"] = "failed"
    ttl_ms: int | None = field(default=None, kw_only=True)


@dataclass(frozen=True)
class TaskCancelledChange:
    """Move a working task to ``cancelled``."""

    at: int
    kind: Literal["cancelled"] = "cancelled"
    ttl_ms: int | None = field(default=None, kw_only=True)


TaskChange = (
    TaskProgressChange
    | TaskCancelRequestedChange
    | TaskCompletedChange
    | TaskFailedChange
    | TaskCancelledChange
)
"""A change applied atomically to a working task record."""


def new_task_id() -> str:
    """Generate a 128-bit cryptographic random task id in unpadded lowercase RFC 4648 base32."""
    return base64.b32encode(os.urandom(16)).decode("ascii").rstrip("=").lower()


def is_task_id(value: Any) -> bool:
    """Whether ``value`` could be a task id issued by this server."""
    return (
        isinstance(value, str)
        and len(value) == _TASK_ID_LENGTH
        and bool(_TASK_ID_RE.fullmatch(value))
    )


def is_task_expired(record: TaskRecord, now: int) -> bool:
    """Whether ``record``'s ``ttl_ms`` has elapsed at ``now`` (epoch milliseconds)."""
    return now >= record.created_at + record.ttl_ms


def task_owner_matches(a: str, b: str) -> bool:
    """Compare two owner bindings in constant time via SHA-256 + ``hmac.compare_digest``."""
    digest_a = hashlib.sha256(a.encode("utf-8")).digest()
    digest_b = hashlib.sha256(b.encode("utf-8")).digest()
    return hmac.compare_digest(digest_a, digest_b)


def apply_task_change(record: TaskRecord, change: TaskChange) -> bool:
    """Apply ``change`` to ``record`` in place following store rules.

    A finished task is unchanged, and only the changed fields move. Returns ``True`` if
    ``record`` was updated.
    """
    if is_terminal_task_status(record.status):
        return False
    if isinstance(change, TaskProgressChange):
        record.status_message = change.message
        record.last_updated_at = change.at
        return True
    if isinstance(change, TaskCancelRequestedChange):
        record.cancel_requested = True
        return True
    if isinstance(change, TaskCompletedChange):
        record.status = "completed"
        record.result = copy.deepcopy(change.result)
        record.last_updated_at = change.at
        if change.ttl_ms is not None:
            record.ttl_ms = min(record.ttl_ms, max(1, change.ttl_ms))
        return True
    if isinstance(change, TaskFailedChange):
        record.status = "failed"
        record.error = copy.deepcopy(change.error)
        record.last_updated_at = change.at
        if change.ttl_ms is not None:
            record.ttl_ms = min(record.ttl_ms, max(1, change.ttl_ms))
        return True
    if isinstance(change, TaskCancelledChange):
        record.status = "cancelled"
        record.last_updated_at = change.at
        if change.ttl_ms is not None:
            record.ttl_ms = min(record.ttl_ms, max(1, change.ttl_ms))
        return True
    return False


def task_tool_result(result: Any, *, is_error: bool | None = None) -> dict[str, Any]:
    """Build the wire ``CallToolResult`` dict an inline call returns for ``result``."""
    wire = to_wire(result)
    if is_error is None:
        if isinstance(result, CommandResult):
            is_error = not result.success
        elif isinstance(wire, dict) and isinstance(wire.get("success"), bool):
            is_error = not wire["success"]
        else:
            is_error = False
    payload: dict[str, Any] = {
        "content": [{"type": "text", "text": json.dumps(wire)}],
        "isError": bool(is_error),
    }
    if isinstance(wire, dict):
        payload["structuredContent"] = wire
    return payload


def task_failure_result(error: CommandError) -> dict[str, Any]:
    """Build the ``CallToolResult`` an inline call returns for a failed command."""
    return task_tool_result(failure(error), is_error=True)


# ═══════════════════════════════════════════════════════════════════════════════
# STORE CONTRACT & DEFAULT IN-MEMORY STORE
# ═══════════════════════════════════════════════════════════════════════════════

TaskStoreErrorKind = Literal["owner-limit", "total-limit", "duplicate-id", "unavailable"]
"""Failure kind raised by a :class:`TaskStore`."""


class TaskStoreError(Exception):
    """Error raised by a :class:`TaskStore` when an operation cannot be completed."""

    def __init__(self, kind: TaskStoreErrorKind, message: str) -> None:
        super().__init__(message)
        self.kind: TaskStoreErrorKind = kind


@dataclass(frozen=True)
class TaskCall:
    """The call that created a task, passed to :meth:`TaskStore.create`."""

    command: CommandDefinition
    input: Any = field(repr=False)
    context: CommandContext = field(repr=False)


@runtime_checkable
class TaskStore(Protocol):
    """Durable store for MCP task records (``spec/command-metadata.md``, "Tasks").

    Implementations may also define an optional ``async def heartbeat(self, task_id: str,
    owner: str, now: int) -> None`` method for lease renewal while a task runs.
    """

    async def create(self, record: TaskRecord, call: TaskCall) -> None: ...

    async def get(self, task_id: str, owner: str) -> TaskRecord | None: ...

    async def update(self, task_id: str, owner: str, change: TaskChange) -> None: ...

    async def expire(self, now: int) -> int: ...


def _positive_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _clone_record(record: TaskRecord) -> TaskRecord:
    return TaskRecord(
        id=record.id,
        owner=record.owner,
        command=record.command,
        status=record.status,
        status_message=record.status_message,
        created_at=record.created_at,
        last_updated_at=record.last_updated_at,
        ttl_ms=record.ttl_ms,
        poll_interval_ms=record.poll_interval_ms,
        cancel_requested=record.cancel_requested,
        result=copy.deepcopy(record.result) if record.result is not None else None,
        error=copy.deepcopy(record.error) if record.error is not None else None,
    )


class InMemoryTaskStore:
    """Default in-process :class:`TaskStore`, bounded per owner and globally.

    Single-instance only: hosts serving one URL from multiple processes supply a shared store.
    When a limit is reached, finished tasks are evicted before their TTL (oldest finished for
    the owner limit; oldest finished of the owner holding the most finished tasks for the total
    limit). Only when all tasks blocking capacity are still ``working`` is creation refused with
    :class:`TaskStoreError` (``"owner-limit"`` or ``"total-limit"``).
    """

    def __init__(
        self,
        *,
        max_per_owner: int = DEFAULT_MAX_TASKS_PER_OWNER,
        max_total: int = DEFAULT_MAX_TASKS,
    ) -> None:
        self._max_per_owner = _positive_int(max_per_owner, "InMemoryTaskStore max_per_owner")
        self._max_total = _positive_int(max_total, "InMemoryTaskStore max_total")
        self._records: dict[str, TaskRecord] = {}

    async def create(self, record: TaskRecord, call: TaskCall | None = None) -> None:
        self._purge_expired(record.created_at)
        if record.id in self._records:
            raise TaskStoreError("duplicate-id", "Task id already exists")

        # Per-owner capacity check, evicting this owner's oldest finished task.
        owner_count = 0
        oldest_owner_finished: TaskRecord | None = None
        for existing in self._records.values():
            if not task_owner_matches(existing.owner, record.owner):
                continue
            owner_count += 1
            if is_terminal_task_status(existing.status) and (
                oldest_owner_finished is None
                or (existing.last_updated_at, existing.id)
                < (oldest_owner_finished.last_updated_at, oldest_owner_finished.id)
            ):
                oldest_owner_finished = existing
        if owner_count >= self._max_per_owner:
            if oldest_owner_finished is None:
                raise TaskStoreError("owner-limit", "Owner task limit reached")
            del self._records[oldest_owner_finished.id]

        # Global capacity check, evicting the oldest finished task of the owner with the most finished.
        if len(self._records) >= self._max_total:
            finished_by_owner: dict[str, tuple[int, TaskRecord]] = {}
            for existing in self._records.values():
                if not is_terminal_task_status(existing.status):
                    continue
                bucket = finished_by_owner.get(existing.owner)
                if bucket is None:
                    finished_by_owner[existing.owner] = (1, existing)
                else:
                    count, oldest = bucket
                    if (existing.last_updated_at, existing.id) < (
                        oldest.last_updated_at,
                        oldest.id,
                    ):
                        oldest = existing
                    finished_by_owner[existing.owner] = (count + 1, oldest)
            victim: tuple[int, TaskRecord] | None = None
            for bucket in finished_by_owner.values():
                if victim is None:
                    victim = bucket
                else:
                    b_count, b_oldest = bucket
                    v_count, v_oldest = victim
                    if b_count > v_count or (
                        b_count == v_count
                        and (b_oldest.last_updated_at, b_oldest.id)
                        < (v_oldest.last_updated_at, v_oldest.id)
                    ):
                        victim = bucket
            if victim is None:
                raise TaskStoreError("total-limit", "Global task limit reached")
            del self._records[victim[1].id]

        self._records[record.id] = _clone_record(record)

    async def get(self, task_id: str, owner: str) -> TaskRecord | None:
        existing = self._records.get(task_id)
        if existing is None or not task_owner_matches(existing.owner, owner):
            return None
        return _clone_record(existing)

    async def update(self, task_id: str, owner: str, change: TaskChange) -> None:
        existing = self._records.get(task_id)
        if existing is None or not task_owner_matches(existing.owner, owner):
            return
        apply_task_change(existing, change)

    async def expire(self, now: int) -> int:
        return self._purge_expired(now)

    @property
    def size(self) -> int:
        """Current number of stored records."""
        return len(self._records)

    def _purge_expired(self, now: int) -> int:
        expired_ids = [
            task_id for task_id, record in self._records.items() if is_task_expired(record, now)
        ]
        for task_id in expired_ids:
            del self._records[task_id]
        return len(expired_ids)


# ═══════════════════════════════════════════════════════════════════════════════
# OPTIONS & VALIDATION
# ═══════════════════════════════════════════════════════════════════════════════


_MAX_SAFE_TTL_MS = 9_007_199_254_740_991
"""JSON safe-integer ceiling (2^53 - 1) shared across TypeScript, Python, and Rust."""


@dataclass(frozen=True)
class TaskOptions:
    """Server-level MCP Tasks configuration (``create_server(..., task_options=...)``)."""

    ttl_ms: int = DEFAULT_TASK_TTL_MS
    poll_interval_ms: int = DEFAULT_TASK_POLL_INTERVAL_MS
    check_interval_ms: int = DEFAULT_TASK_CHECK_INTERVAL_MS
    max_result_bytes: int = DEFAULT_MAX_TASK_RESULT_BYTES
    max_running: int = DEFAULT_MAX_RUNNING_TASKS
    token_expiry_grace_ms: int | None = None
    callers_identified_by_hook: bool = False
    max_run_ms: int = field(default=DEFAULT_TASK_MAX_RUN_MS, kw_only=True)

    def __post_init__(self) -> None:
        _positive_int(self.ttl_ms, "task_options.ttl_ms")
        _positive_int(self.max_run_ms, "task_options.max_run_ms")
        _positive_int(self.poll_interval_ms, "task_options.poll_interval_ms")
        _positive_int(self.check_interval_ms, "task_options.check_interval_ms")
        _positive_int(self.max_result_bytes, "task_options.max_result_bytes")
        _positive_int(self.max_running, "task_options.max_running")
        if self.token_expiry_grace_ms is not None and (
            isinstance(self.token_expiry_grace_ms, bool)
            or not isinstance(self.token_expiry_grace_ms, int)
            or self.token_expiry_grace_ms < 0
        ):
            raise ValueError("task_options.token_expiry_grace_ms must be a non-negative integer")
        if not isinstance(self.callers_identified_by_hook, bool):
            raise ValueError("task_options.callers_identified_by_hook must be a boolean")


def _cap_ttl_at_token_expiry(
    options: TaskOptions,
    created_at_ms: int,
    uncapped_ttl_ms: int,
    expires_at_seconds: int | None = None,
) -> int:
    clamped = max(1, min(_MAX_SAFE_TTL_MS, uncapped_ttl_ms))
    if options.token_expiry_grace_ms is None or expires_at_seconds is None:
        return clamped
    end_ms = expires_at_seconds * 1000 + options.token_expiry_grace_ms
    remaining = max(0, end_ms - created_at_ms)
    return max(1, min(clamped, remaining))


def task_ttl_for(
    options: TaskOptions,
    now_ms: int,
    expires_at_seconds: int | None = None,
) -> int:
    """Compute initial ``ttl_ms`` (from ``created_at``): ``max_run_ms + ttl_ms``, capped at
    token expiry plus grace when configured."""
    total = min(_MAX_SAFE_TTL_MS, options.max_run_ms + options.ttl_ms)
    return _cap_ttl_at_token_expiry(options, now_ms, total, expires_at_seconds)


def finished_task_ttl_for(
    options: TaskOptions,
    created_at_ms: int,
    finished_at_ms: int,
    expires_at_seconds: int | None = None,
) -> int:
    """Compute final ``ttl_ms`` (from ``created_at_ms``) when a task reaches a terminal state
    at ``finished_at_ms``: ``min(options.max_run_ms, max(0, finished_at_ms - created_at_ms)) +
    options.ttl_ms``, capped at token expiry plus grace when configured (never wider than
    initial ``ttl_ms``)."""
    elapsed = min(options.max_run_ms, max(0, finished_at_ms - created_at_ms))
    total = min(_MAX_SAFE_TTL_MS, elapsed + options.ttl_ms)
    return _cap_ttl_at_token_expiry(options, created_at_ms, total, expires_at_seconds)


def assert_valid_task_commands(commands: Sequence[CommandDefinition]) -> None:
    """Validate ``task`` metadata on every command in ``commands``."""
    for command in commands:
        validate_task_declaration(
            command.name,
            command.task,
            confirm_prompt=command.confirm_prompt,
            approval=command.approval,
            confirmation_mode=getattr(command, "confirmation_mode", None),
        )


__all__ = [
    "TASKS_EXTENSION_ID",
    "DEFAULT_TASK_TTL_MS",
    "DEFAULT_TASK_MAX_RUN_MS",
    "DEFAULT_TASK_POLL_INTERVAL_MS",
    "DEFAULT_TASK_CHECK_INTERVAL_MS",
    "DEFAULT_MAX_TASK_RESULT_BYTES",
    "DEFAULT_MAX_TASKS_PER_OWNER",
    "DEFAULT_MAX_TASKS",
    "DEFAULT_MAX_RUNNING_TASKS",
    "TaskStatus",
    "TaskRpcError",
    "TaskRecord",
    "TaskProgressChange",
    "TaskCancelRequestedChange",
    "TaskCompletedChange",
    "TaskFailedChange",
    "TaskCancelledChange",
    "TaskChange",
    "TaskStoreErrorKind",
    "TaskStoreError",
    "TaskCall",
    "TaskStore",
    "InMemoryTaskStore",
    "TaskOptions",
    "is_terminal_task_status",
    "is_task_expired",
    "task_owner_matches",
    "apply_task_change",
    "task_tool_result",
    "task_failure_result",
    "task_ttl_for",
    "finished_task_ttl_for",
    "new_task_id",
    "is_task_id",
    "assert_valid_task_commands",
]
