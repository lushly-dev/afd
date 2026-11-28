"""MCP Tasks runtime: creation, background execution, cancellation, deadlines and
``tasks/get``, ``tasks/update``, ``tasks/cancel`` handlers (``spec/command-metadata.md``,
"Tasks"; SEP-2663).
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager, suppress
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, cast

from afd.core.actor import Actor
from afd.core.clock import Clock, system_clock
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.errors import CommandError, ErrorCodes, Recovery
from afd.core.idempotency_keys import idempotency_fields
from afd.core.result import failure
from afd.core.similarity import truncate_name
from afd.server.approval_relay import bind_approval_relay
from afd.server.auth import credentials_actor
from afd.server.auth_rules import (
    Credentials,
    _clone_verified_credentials,
    _unbrand_verified_credentials,
)
from afd.server.auth_view import ScopeView, scope_view_of
from afd.server.confirmations import bind_confirmation_channel
from afd.server.context_hook import HookOutcome, copy_extra, current_hook_outcome
from afd.server.principal import (
    IncompleteCredentials,
    principal_binding,
    sdk_access_token,
    sdk_credentials,
)
from afd.server.session_context import is_modern_protocol
from afd.server.tasks import (
    TASKS_EXTENSION_ID,
    InMemoryTaskStore,
    TaskCall,
    TaskCancelledChange,
    TaskCancelRequestedChange,
    TaskChange,
    TaskCompletedChange,
    TaskFailedChange,
    TaskOptions,
    TaskProgressChange,
    TaskRecord,
    TaskRpcError,
    TaskStatus,
    TaskStore,
    TaskStoreError,
    finished_task_ttl_for,
    is_task_expired,
    is_task_id,
    is_terminal_task_status,
    new_task_id,
    task_owner_matches,
    task_tool_result,
    task_ttl_for,
)

logger = logging.getLogger("afd.server")

StopReason = Literal["cancelled", "token-expired", "ttl-ended", "run-timeout", "lost"]
StopStage = Literal["not-started", "running", "finished"]


@dataclass
class _CreatedTaskSentinel:
    """Returned through the tool router when ``tools/call`` started an MCP task."""

    wire_result: Any


@dataclass
class _TaskCallSlot:
    """Per-request slot shared between ``TasksExtension.intercept_tool_call`` and ``TaskRuntime``."""

    request_context: Any
    created_task: Any = None


_TASK_CALL_SLOT: ContextVar[_TaskCallSlot | None] = ContextVar("afd_task_call_slot", default=None)


@contextmanager
def bind_task_slot(slot: _TaskCallSlot | None) -> Iterator[None]:
    token = _TASK_CALL_SLOT.set(slot)
    try:
        yield
    finally:
        _TASK_CALL_SLOT.reset(token)


def current_task_slot() -> _TaskCallSlot | None:
    return _TASK_CALL_SLOT.get()


def is_created_task_sentinel(value: Any) -> bool:
    return isinstance(value, _CreatedTaskSentinel)


# ═══════════════════════════════════════════════════════════════════════════════
# WIRE HELPERS & PROTOCOL ERRORS
# ═══════════════════════════════════════════════════════════════════════════════


def iso_timestamp(ms: int) -> str:
    """Format epoch milliseconds as UTC ISO-8601 with millisecond precision (``...Z``)."""
    seconds, millis = divmod(int(ms), 1000)
    dt = datetime.fromtimestamp(seconds, tz=UTC)
    return f"{dt.strftime('%Y-%m-%dT%H:%M:%S')}.{millis:03d}Z"


def request_declares_tasks(request_context: Any) -> bool:
    """Whether ``request_context`` is an MCP 2026-07-28 request declaring the Tasks extension.

    A 2025-era request never does, whatever its session declared at ``initialize``.
    """
    if request_context is None:
        return False
    if not is_modern_protocol(getattr(request_context, "protocol_version", None)):
        return False
    params = getattr(request_context, "params", None)
    if isinstance(params, Mapping):
        meta = params.get("_meta")
        if isinstance(meta, Mapping):
            caps = meta.get("io.modelcontextprotocol/clientCapabilities")
            if isinstance(caps, Mapping):
                extensions = caps.get("extensions")
                return isinstance(extensions, Mapping) and isinstance(
                    extensions.get(TASKS_EXTENSION_ID), Mapping
                )
    session = getattr(request_context, "session", None)
    capabilities = getattr(session, "client_capabilities", None) if session is not None else None
    extensions = getattr(capabilities, "extensions", None) if capabilities is not None else None
    return isinstance(extensions, Mapping) and isinstance(
        extensions.get(TASKS_EXTENSION_ID), Mapping
    )


def missing_tasks_capability() -> Exception:
    """JSON-RPC ``-32021`` naming ``io.modelcontextprotocol/tasks``."""
    from mcp import MCPError
    from mcp_types import (
        MISSING_REQUIRED_CLIENT_CAPABILITY,
        ClientCapabilities,
        MissingRequiredClientCapabilityErrorData,
    )

    data = MissingRequiredClientCapabilityErrorData(
        required_capabilities=ClientCapabilities(extensions={TASKS_EXTENSION_ID: {}})
    ).model_dump(by_alias=True, mode="json", exclude_none=True)
    return MCPError(
        code=MISSING_REQUIRED_CLIENT_CAPABILITY,
        message=f"Client does not declare required capability: {TASKS_EXTENSION_ID}",
        data=data,
    )


def _method_not_found(method: str) -> Exception:
    from mcp import MCPError
    from mcp_types import METHOD_NOT_FOUND

    return MCPError(code=METHOD_NOT_FOUND, message="Method not found", data=method)


def _task_not_found() -> Exception:
    from mcp import MCPError
    from mcp_types import INVALID_PARAMS

    return MCPError(code=INVALID_PARAMS, message="Task not found")


def _internal_rpc_error() -> Exception:
    from mcp import MCPError
    from mcp_types import INTERNAL_ERROR

    return MCPError(code=INTERNAL_ERROR, message="Internal error")


def _internal_error_object() -> TaskRpcError:
    return TaskRpcError(code=-32603, message="Internal error")


def task_limit_error() -> CommandError:
    return CommandError(
        code=ErrorCodes.RATE_LIMITED,
        message="The task could not start: a task limit was reached, so nothing ran",
        suggestion="Wait for one of your tasks to finish or expire, then call again.",
        retryable=True,
        recovery=Recovery(kind="retry"),
    )


def composite_task_error(tool: Literal["afd-batch", "afd-pipe"], command_name: str) -> CommandError:
    shown = truncate_name(command_name)
    return CommandError(
        code=(
            ErrorCodes.INVALID_BATCH_REQUEST
            if tool == "afd-batch"
            else ErrorCodes.INVALID_PIPELINE_REQUEST
        ),
        message=f"Command '{shown}' requires MCP Tasks and cannot run inside {tool}",
        suggestion=(
            f"Call '{shown}' directly or through afd-call on an MCP 2026-07-28 client "
            f"declaring {TASKS_EXTENSION_ID}"
        ),
        retryable=False,
    )


def unidentified_callers_error(command_name: str) -> CommandError:
    shown = truncate_name(command_name)
    return CommandError(
        code=ErrorCodes.UNAUTHORIZED,
        message=(
            f"Command '{shown}' runs only as a task, and this server cannot tell its callers "
            "apart, so it starts no task"
        ),
        suggestion=(
            "Nothing ran. The server's operator must configure authorization, or declare that "
            "the server's context hook identifies every caller; calling again will not help "
            "until then."
        ),
        retryable=False,
    )


def due_task_stop(
    token_deadline_ms: int | None,
    ttl_deadline_ms: int,
    now_ms: int,
    run_deadline_ms: int | None = None,
) -> StopReason | None:
    """What deadline is due at ``now_ms``: token expiry first, then TTL, then optional run budget."""
    if token_deadline_ms is not None and now_ms >= token_deadline_ms:
        return "token-expired"
    if now_ms >= ttl_deadline_ms:
        return "ttl-ended"
    if run_deadline_ms is not None and now_ms >= run_deadline_ms:
        return "run-timeout"
    return None


def task_run_timeout_error(stage: StopStage, mutation: bool) -> CommandError:
    """Build ``TIMEOUT`` for a task whose run budget elapsed, retryable unless a mutation may have run."""
    if stage == "not-started":
        return CommandError(
            code=ErrorCodes.TIMEOUT,
            message="The task did not start before its run budget elapsed",
            suggestion=(
                "Nothing ran. Increase the task run budget or simplify the request and start it again."
            ),
            retryable=True,
        )
    return CommandError(
        code=ErrorCodes.TIMEOUT,
        message="The task stopped because its run budget elapsed",
        suggestion=(
            "The command may have made part of its change before it stopped: check its effect "
            "before starting it again."
            if mutation
            else "Simplify or narrow the request, or increase the task run budget, and start it again."
        ),
        retryable=not mutation,
    )


def token_expired_error(stage: StopStage, mutation: bool) -> CommandError:
    """Build ``TASK_TOKEN_EXPIRED``, retryable unless a mutation may have started."""
    if stage == "not-started":
        message = "The task did not start: the access token that started it had expired"
        suggestion = "Nothing ran. Obtain a new access token and start the task again."
    elif stage == "running":
        message = "The task stopped because the access token that started it expired"
        suggestion = (
            "The command may have made part of its change before it stopped: check its effect, "
            "then start it again with a new access token if it is still needed."
            if mutation
            else "Obtain a new access token and start the task again."
        )
    else:
        message = (
            "The task finished after the access token that started it expired, so its result "
            "is not delivered"
        )
        suggestion = (
            "The command ran to the end and made its change: check its effect before starting "
            "it again with a new access token."
            if mutation
            else "Obtain a new access token and start the task again."
        )
    return CommandError(
        code=ErrorCodes.TASK_TOKEN_EXPIRED,
        message=message,
        suggestion=suggestion,
        retryable=stage == "not-started" or not mutation,
    )


def completion_change(
    result: Any, max_result_bytes: int, at: int, ttl_ms: int | None = None
) -> TaskChange:
    """Build a ``TaskCompletedChange`` (or ``TaskFailedChange`` / size-capped failure)."""
    try:
        tool_result = task_tool_result(result)
        serialized = json.dumps(tool_result)
    except Exception:
        return TaskFailedChange(error=_internal_error_object(), at=at, ttl_ms=ttl_ms)
    size = len(serialized.encode("utf-8"))
    if size <= max_result_bytes:
        return TaskCompletedChange(result=tool_result, at=at, ttl_ms=ttl_ms)
    too_large = CommandError(
        code=ErrorCodes.INTERNAL_ERROR,
        message="The command ran, but its result is larger than this server keeps for a task",
        suggestion=(
            "The command ran: check its effect before running it again. For a read, ask for "
            "less (narrow the request or set an output budget)."
        ),
        details={"limitBytes": max_result_bytes, "actualBytes": size},
        retryable=False,
    )
    return TaskCompletedChange(
        result=task_tool_result(failure(too_large), is_error=True), at=at, ttl_ms=ttl_ms
    )


# ═══════════════════════════════════════════════════════════════════════════════
# WIRE MODELS (LAZY IMPORT OF OPTIONAL `mcp_types`)
# ═══════════════════════════════════════════════════════════════════════════════


_WIRE_MODELS: tuple[Any, ...] | None = None


def _get_wire_models() -> tuple[Any, Any, Any, Any]:
    global _WIRE_MODELS
    if _WIRE_MODELS is None:
        from mcp_types import RequestParams, Result
        from pydantic import ConfigDict, Field

        class TaskIdParams(RequestParams):
            model_config = ConfigDict(populate_by_name=True, extra="ignore")
            task_id: str = Field(alias="taskId")

        class UpdateTaskParams(RequestParams):
            model_config = ConfigDict(populate_by_name=True, extra="ignore")
            task_id: str = Field(alias="taskId")
            input_responses: dict[str, Any] | None = Field(default=None, alias="inputResponses")

        class WireCreateTaskResult(Result):
            model_config = ConfigDict(populate_by_name=True, extra="allow")
            result_type: Literal["task"] = Field(default="task", alias="resultType")
            task_id: str = Field(alias="taskId")
            status: Literal["working"] = "working"
            status_message: str | None = Field(default=None, alias="statusMessage")
            created_at: str = Field(alias="createdAt")
            last_updated_at: str = Field(alias="lastUpdatedAt")
            ttl_ms: int = Field(alias="ttlMs")
            poll_interval_ms: int = Field(alias="pollIntervalMs")

        class WireDetailedTask(Result):
            model_config = ConfigDict(populate_by_name=True, extra="allow")
            task_id: str = Field(alias="taskId")
            status: TaskStatus
            status_message: str | None = Field(default=None, alias="statusMessage")
            created_at: str = Field(alias="createdAt")
            last_updated_at: str = Field(alias="lastUpdatedAt")
            ttl_ms: int = Field(alias="ttlMs")
            poll_interval_ms: int = Field(alias="pollIntervalMs")
            result: dict[str, Any] | None = None
            error: dict[str, Any] | None = None

        _WIRE_MODELS = (TaskIdParams, UpdateTaskParams, WireCreateTaskResult, WireDetailedTask)
    return _WIRE_MODELS


def _wire_create_task(record: TaskRecord) -> Any:
    _, _, wire_create_task_result, _ = _get_wire_models()
    return wire_create_task_result(
        taskId=record.id,
        status="working",
        statusMessage=record.status_message,
        createdAt=iso_timestamp(record.created_at),
        lastUpdatedAt=iso_timestamp(record.last_updated_at),
        ttlMs=record.ttl_ms,
        pollIntervalMs=record.poll_interval_ms,
    )


def _wire_detailed_task(record: TaskRecord) -> Any:
    _, _, _, wire_detailed_task = _get_wire_models()
    result_payload: dict[str, Any] | None = None
    error_payload: dict[str, Any] | None = None
    if record.status == "completed":
        result_payload = (
            copy.deepcopy(record.result)
            if record.result is not None
            else {"content": [], "isError": False}
        )
    elif record.status == "failed":
        error_payload = (
            record.error.to_wire()
            if record.error is not None
            else _internal_error_object().to_wire()
        )
    return wire_detailed_task(
        taskId=record.id,
        status=record.status,
        statusMessage=record.status_message,
        createdAt=iso_timestamp(record.created_at),
        lastUpdatedAt=iso_timestamp(record.last_updated_at),
        ttlMs=record.ttl_ms,
        pollIntervalMs=record.poll_interval_ms,
        result=result_payload,
        error=error_payload,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# RUNNING TASK STATE & RUNTIME
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class _RunningTask:
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    stop_event: asyncio.Event = field(default_factory=asyncio.Event)
    reason: StopReason | None = None
    exec_task: asyncio.Task[Any] | None = None
    driver_task: asyncio.Task[None] | None = None

    def stop(self, reason: StopReason) -> None:
        if self.reason is None:
            self.reason = reason
        self.cancel_event.set()
        self.stop_event.set()
        if self.exec_task is not None and not self.exec_task.done():
            self.exec_task.cancel()


class TaskRuntime:
    """Manages MCP task lifecycle, store access, background execution and ``tasks/*`` handlers."""

    def __init__(
        self,
        *,
        get_exposed_commands: Callable[[], Sequence[CommandDefinition]],
        execute_command: Callable[[str, Any, CommandContext | None], Awaitable[Any]],
        store: TaskStore | None = None,
        options: TaskOptions | None = None,
        clock: Clock | None = None,
        actor: Actor | None = None,
        has_context_hook: bool = False,
        run_context_hook: Callable[[str, Any], Awaitable[HookOutcome]] | None = None,
        get_admitted_credentials: Callable[[], Credentials | None] | None = None,
        get_scope_view: Callable[[], ScopeView | None] | None = None,
    ) -> None:
        self._get_exposed_commands = get_exposed_commands
        self._execute_command = execute_command
        self.store: TaskStore = store if store is not None else InMemoryTaskStore()
        self.options: TaskOptions = options if options is not None else TaskOptions()
        self._clock: Clock = clock if clock is not None else system_clock
        self._actor = actor
        self._has_context_hook = has_context_hook
        self._run_context_hook = run_context_hook
        self._get_admitted_credentials = get_admitted_credentials
        self._get_scope_view = get_scope_view
        self._running: dict[str, _RunningTask] = {}

    @property
    def serves_tasks(self) -> bool:
        """Whether at least one MCP-exposed command declares ``task`` as optional or required."""
        return any(cmd.task in ("optional", "required") for cmd in self._get_exposed_commands())

    @property
    def _hook_identifies_callers(self) -> bool:
        return self.options.callers_identified_by_hook and self._has_context_hook

    def _admitted_credentials(self) -> Credentials | None:
        return (
            self._get_admitted_credentials() if self._get_admitted_credentials is not None else None
        )

    def _current_scope_view(self) -> ScopeView | None:
        return self._get_scope_view() if self._get_scope_view is not None else None

    def identifies_caller(self, request_context: Any) -> bool:
        """Whether callers can be told apart on the transport of ``request_context``."""
        is_http = getattr(request_context, "request", None) is not None
        if not is_http:
            return True
        if self._hook_identifies_callers:
            return True
        if self._admitted_credentials() is not None:
            return True
        return sdk_access_token() is not None

    def declares_tasks_for(self, request_context: Any) -> bool:
        """Whether the server advertises and serves ``io.modelcontextprotocol/tasks`` for ``request_context``."""
        return self.serves_tasks and self.identifies_caller(request_context)

    def dispose(self) -> None:
        """Abort all locally running tasks without overwriting shared store state."""
        for running in list(self._running.values()):
            running.stop("lost")
        self._running.clear()

    async def dispatch_command(
        self,
        command: CommandDefinition,
        command_input: Any,
        context: CommandContext,
    ) -> Any:
        """Decide whether a single-command MCP call runs inline, fails, or starts a task.

        Returns ``None`` to run inline, a ``CommandResult`` failure (e.g. ``UNAUTHORIZED`` or
        ``RATE_LIMITED``), or a :class:`_CreatedTaskSentinel` when a task was started. Raises
        ``MCPError(-32021)`` when ``task == "required"`` and the client did not declare the
        extension.
        """
        if command.task not in ("optional", "required"):
            return None
        slot = current_task_slot()
        if slot is None:
            # Outside an MCP `tools/call` (e.g. direct `route_tool_call` or `server.execute`):
            # run inline.
            return None
        req_ctx = slot.request_context
        if not self.identifies_caller(req_ctx):
            if command.task == "required":
                return failure(unidentified_callers_error(command.name))
            return None
        if not request_declares_tasks(req_ctx):
            if command.task == "required":
                raise missing_tasks_capability()
            return None
        return await self._start_task(command, command_input, context, slot)

    async def _start_task(
        self,
        command: CommandDefinition,
        command_input: Any,
        context: CommandContext,
        slot: _TaskCallSlot,
    ) -> Any:
        outcome = current_hook_outcome()
        admitted = self._admitted_credentials()
        default_actor = (
            credentials_actor(admitted)
            if admitted is not None
            else (self._actor or Actor(kind="agent"))
        )
        actor = (
            outcome.actor_at_start
            if outcome is not None and outcome.actor_at_start is not None
            else context.actor or default_actor
        )
        token = None if admitted is not None else sdk_access_token()
        try:
            credentials = admitted if admitted is not None else sdk_credentials()
            owner = principal_binding(actor, credentials)
        except (IncompleteCredentials, TypeError):
            logger.warning("refusing task start for '%s': incomplete credentials", command.name)
            raise _internal_rpc_error() from None

        now = int(self._clock.now())
        with suppress(Exception):
            await self.store.expire(now)

        if admitted is not None:
            expires_at_seconds: int | None = admitted.expires_at
        else:
            raw_exp = getattr(token, "expires_at", None) if token is not None else None
            expires_at_seconds = (
                raw_exp if isinstance(raw_exp, int) and not isinstance(raw_exp, bool) else None
            )
        ttl_ms = task_ttl_for(self.options, now, expires_at_seconds)
        task_id = new_task_id()
        record = TaskRecord(
            id=task_id,
            owner=owner,
            command=command.name,
            status="working",
            created_at=now,
            last_updated_at=now,
            ttl_ms=ttl_ms,
            poll_interval_ms=self.options.poll_interval_ms,
            cancel_requested=False,
        )

        if len(self._running) >= self.options.max_running:
            return failure(task_limit_error())

        running = _RunningTask()
        self._running[task_id] = running
        transferred = False
        task_credentials: Credentials | None = None
        try:
            try:
                await self.store.create(
                    record, TaskCall(command=command, input=command_input, context=context)
                )
            except TaskStoreError as exc:
                if exc.kind in ("owner-limit", "total-limit"):
                    return failure(task_limit_error())
                return failure(
                    CommandError(
                        code=ErrorCodes.INTERNAL_ERROR,
                        message="The task could not be recorded, so nothing ran",
                        suggestion="Retry later.",
                        retryable=True,
                    )
                )
            except Exception:
                return failure(
                    CommandError(
                        code=ErrorCodes.INTERNAL_ERROR,
                        message="The task could not be recorded, so nothing ran",
                        suggestion="Retry later.",
                        retryable=True,
                    )
                )

            progress_state: dict[str, Any] = {"pending": False, "message": None}
            progress_event = asyncio.Event()

            def report_progress(message: str) -> None:
                if isinstance(message, str):
                    progress_state["message"] = message
                    progress_state["pending"] = True
                    progress_event.set()

            def take_progress() -> str | None:
                if not progress_state["pending"]:
                    return None
                progress_state["pending"] = False
                progress_event.clear()
                msg = progress_state["message"]
                progress_state["message"] = None
                return str(msg) if msg is not None else None

            if admitted is not None:
                task_credentials = _clone_verified_credentials(admitted) or admitted

            call_view = scope_view_of(context) or self._current_scope_view()
            task_view = (
                call_view.with_credentials(task_credentials)
                if call_view is not None and task_credentials is not None
                else call_view
            )

            task_context = CommandContext(
                trace_id=context.trace_id,
                # MCP Tasks are bounded by their own run budget (default 1 h), TTL and cancel_event
                # rather than the inline server default_timeout_ms; keep an explicit timeout if set.
                timeout=context.timeout if context.timeout is not None else 0,
                extra=copy_extra(context.extra) if isinstance(context.extra, Mapping) else {},
                actor=copy.copy(actor) if actor is not None else None,
                clock=context.clock,
                random=context.random,
                approval=None,
                credentials=task_credentials,
                report_progress=report_progress,
                cancel=running.cancel_event,
                signal=running.cancel_event,
                _output_budget_ask=getattr(context, "_output_budget_ask", None),
                _scope_view=task_view,
                # The handler still gets the call's key (K3), but nothing acts on it: neither
                # the idempotency step nor the retry middleware (spec/idempotency.md, S11).
                **{**idempotency_fields(context), "_task_run": True},
            )
            token_deadline_ms = (
                expires_at_seconds * 1000 if expires_at_seconds is not None else None
            )
            ttl_deadline_ms = record.created_at + record.ttl_ms
            run_deadline_ms = record.created_at + self.options.max_run_ms

            driver = asyncio.create_task(
                self._run_task(
                    task_id=task_id,
                    owner=owner,
                    command_name=command.name,
                    mutation=bool(command.mutation),
                    created_at=record.created_at,
                    expires_at_seconds=expires_at_seconds,
                    command_input=command_input,
                    task_context=task_context,
                    running=running,
                    take_progress=take_progress,
                    progress_event=progress_event,
                    token_deadline_ms=token_deadline_ms,
                    ttl_deadline_ms=ttl_deadline_ms,
                    run_deadline_ms=run_deadline_ms,
                )
            )
            running.driver_task = driver
            driver.add_done_callback(_consume_task_exception)
            transferred = True
        finally:
            if not transferred:
                self._running.pop(task_id, None)
                if task_credentials is not None:
                    _unbrand_verified_credentials(task_credentials)

        wire = _wire_create_task(record)
        slot.created_task = wire
        return _CreatedTaskSentinel(wire)

    async def _run_task(
        self,
        *,
        task_id: str,
        owner: str,
        command_name: str,
        mutation: bool,
        created_at: int,
        expires_at_seconds: int | None,
        command_input: Any,
        task_context: CommandContext,
        running: _RunningTask,
        take_progress: Callable[[], str | None],
        progress_event: asyncio.Event,
        token_deadline_ms: int | None,
        ttl_deadline_ms: int,
        run_deadline_ms: int,
    ) -> None:
        outcome_kind: str
        outcome_payload: Any = None
        outcome_stage: StopStage = "running"

        try:
            with bind_confirmation_channel(None), bind_approval_relay(None), bind_task_slot(None):
                outcome_kind, outcome_payload, outcome_stage = await self._drive_task(
                    task_id=task_id,
                    owner=owner,
                    command_name=command_name,
                    command_input=command_input,
                    task_context=task_context,
                    running=running,
                    take_progress=take_progress,
                    progress_event=progress_event,
                    token_deadline_ms=token_deadline_ms,
                    ttl_deadline_ms=ttl_deadline_ms,
                    run_deadline_ms=run_deadline_ms,
                )
        except asyncio.CancelledError:
            outcome_kind = "stopped"
            outcome_payload = running.reason or "lost"
        except Exception:
            outcome_kind = "internal"
        finally:
            self._running.pop(task_id, None)
            if isinstance(task_context.credentials, Credentials):
                _unbrand_verified_credentials(task_context.credentials)

        now = int(self._clock.now())
        final_ttl_ms = finished_task_ttl_for(self.options, created_at, now, expires_at_seconds)
        change: TaskChange
        if outcome_kind == "finished":
            change = completion_change(
                outcome_payload, self.options.max_result_bytes, now, final_ttl_ms
            )
        elif outcome_kind == "internal":
            change = TaskFailedChange(error=_internal_error_object(), at=now, ttl_ms=final_ttl_ms)
        elif outcome_payload == "cancelled":
            change = TaskCancelledChange(at=now, ttl_ms=final_ttl_ms)
        elif outcome_payload == "token-expired":
            change = TaskCompletedChange(
                result=task_tool_result(
                    failure(token_expired_error(outcome_stage, mutation)),
                    is_error=True,
                ),
                at=now,
                ttl_ms=final_ttl_ms,
            )
        elif outcome_payload == "run-timeout":
            change = TaskCompletedChange(
                result=task_tool_result(
                    failure(task_run_timeout_error(outcome_stage, mutation)),
                    is_error=True,
                ),
                at=now,
                ttl_ms=final_ttl_ms,
            )
        elif outcome_payload == "ttl-ended":
            with suppress(Exception):
                await self.store.expire(now)
            return
        else:
            # 'lost': another process or server shutdown ended it; write nothing.
            return

        for attempt in range(3):
            try:
                await self.store.update(task_id, owner, change)
                break
            except Exception:
                if attempt < 2:
                    await asyncio.sleep(self.options.check_interval_ms / 1000.0)

    async def _drive_task(
        self,
        *,
        task_id: str,
        owner: str,
        command_name: str,
        command_input: Any,
        task_context: CommandContext,
        running: _RunningTask,
        take_progress: Callable[[], str | None],
        progress_event: asyncio.Event,
        token_deadline_ms: int | None,
        ttl_deadline_ms: int,
        run_deadline_ms: int,
    ) -> tuple[str, Any, StopStage]:
        initial_stop = (
            due_task_stop(
                token_deadline_ms, ttl_deadline_ms, int(self._clock.now()), run_deadline_ms
            )
            or running.reason
        )
        if initial_stop is not None:
            return ("stopped", initial_stop, "not-started")

        async def _run_command() -> Any:
            return await self._execute_command(command_name, command_input, task_context)

        exec_task: asyncio.Task[Any] = asyncio.create_task(_run_command())
        running.exec_task = exec_task
        exec_task.add_done_callback(_consume_task_exception)

        while True:
            if running.reason == "lost":
                if not exec_task.done():
                    exec_task.cancel()
                return ("stopped", "lost", "running")

            if exec_task.done():
                if exec_task.cancelled():
                    return ("stopped", running.reason or "cancelled", "running")
                exc = exec_task.exception()
                if exc is not None:
                    return ("internal", None, "finished")
                result = exec_task.result()
                # A handler that already returned keeps its result unless token or TTL expired.
                due = due_task_stop(token_deadline_ms, ttl_deadline_ms, int(self._clock.now()))
                if due is not None:
                    return ("stopped", due, "finished")
                final_msg = take_progress()
                if final_msg is not None:
                    with suppress(Exception):
                        await self.store.update(
                            task_id,
                            owner,
                            TaskProgressChange(message=final_msg, at=int(self._clock.now())),
                        )
                return ("finished", result, "finished")

            now = int(self._clock.now())
            due = due_task_stop(token_deadline_ms, ttl_deadline_ms, now, run_deadline_ms)
            if due is not None:
                running.stop(due)

            if running.reason is None:
                msg = take_progress()
                if msg is not None:
                    with suppress(Exception):
                        await self.store.update(
                            task_id, owner, TaskProgressChange(message=msg, at=now)
                        )
                heartbeat = getattr(self.store, "heartbeat", None)
                if callable(heartbeat):
                    with suppress(Exception):
                        await heartbeat(task_id, owner, now)
                try:
                    current = await self.store.get(task_id, owner)
                    if current is None or is_task_expired(current, now):
                        running.stop("ttl-ended")
                    elif is_terminal_task_status(current.status):
                        running.stop("lost")
                    elif current.cancel_requested:
                        running.stop("cancelled")
                except Exception:
                    # Transient store read failure: try again on the next check.
                    pass

            reason = running.reason
            if reason in ("lost", "ttl-ended"):
                if not exec_task.done():
                    exec_task.cancel()
                return ("stopped", reason, "running")
            if exec_task.done():
                continue
            if reason is not None:
                if not exec_task.done():
                    exec_task.cancel()
                return ("stopped", reason, "running")

            hard_deadline = min(ttl_deadline_ms, run_deadline_ms)
            nearest = (
                min(token_deadline_ms, hard_deadline)
                if token_deadline_ms is not None
                else hard_deadline
            )
            until_ms = max(1, nearest - now)
            wait_s = min(self.options.check_interval_ms, until_ms) / 1000.0

            stop_waiter = asyncio.create_task(running.stop_event.wait())
            progress_waiter = asyncio.create_task(progress_event.wait())
            try:
                await asyncio.wait(
                    {exec_task, stop_waiter, progress_waiter},
                    timeout=wait_s,
                    return_when=asyncio.FIRST_COMPLETED,
                )
            finally:
                for waiter in (stop_waiter, progress_waiter):
                    if not waiter.done():
                        waiter.cancel()
                    else:
                        _consume_task_exception(waiter)

    # ── tasks/* handlers & SDK Extension ──────────────────────────────────

    def _check_mcp_name(self, ctx: Any, task_id: str) -> None:
        """Enforce ``Mcp-Name == params.taskId`` on MCP 2026-07-28 Streamable HTTP (``-32020``)."""
        if not is_modern_protocol(getattr(ctx, "protocol_version", None)):
            return
        request = getattr(ctx, "request", None)
        if request is None:
            return
        headers = getattr(request, "headers", None)
        if headers is None:
            return
        from mcp import MCPError
        from mcp.shared.inbound import MCP_NAME_HEADER, decode_header_value
        from mcp_types import HEADER_MISMATCH

        getlist = getattr(headers, "getlist", None)
        if callable(getlist):
            values = list(getlist(MCP_NAME_HEADER))
        else:
            raw = headers.get(MCP_NAME_HEADER)
            values = [raw] if raw is not None else []
        if len(values) > 1:
            raise MCPError(
                code=HEADER_MISMATCH,
                message=f"{MCP_NAME_HEADER} header appears more than once",
            )
        if not values or decode_header_value(values[0]) != task_id:
            raise MCPError(
                code=HEADER_MISMATCH,
                message=f"{MCP_NAME_HEADER} header does not match the request body's 'taskId' parameter",
            )

    async def _resolve_caller(
        self, method: str, ctx: Any, task_id: str
    ) -> tuple[str, ScopeView | None, CommandContext]:
        from mcp import MCPError
        from mcp_types import INTERNAL_ERROR, INVALID_REQUEST

        if not self.declares_tasks_for(ctx):
            raise _method_not_found(method)
        self._check_mcp_name(ctx, task_id)
        if not request_declares_tasks(ctx):
            raise missing_tasks_capability()

        view = self._current_scope_view()
        if view is not None:
            req_dec = view.decide_request()
            if req_dec != "proceed":
                err = view.insufficient_scope(req_dec.forbidden)
                raise MCPError(
                    code=INVALID_REQUEST,
                    message=err.message,
                    data={
                        "code": err.code,
                        "suggestion": err.suggestion,
                        "scopes": list(req_dec.forbidden),
                        "retryable": False,
                    },
                )

        admitted = self._admitted_credentials()
        default_actor = (
            credentials_actor(admitted)
            if admitted is not None
            else copy.copy(self._actor or Actor(kind="agent"))
        )
        if self._run_context_hook is not None:
            outcome = await self._run_context_hook(method, ctx)
            if outcome.refusal is not None:
                if outcome.refusal.code == ErrorCodes.INTERNAL_ERROR:
                    raise MCPError(code=INTERNAL_ERROR, message="Internal error")
                data: dict[str, Any] = {"code": outcome.refusal.code}
                if outcome.refusal.suggestion is not None:
                    data["suggestion"] = outcome.refusal.suggestion
                if outcome.refusal.retryable is not None:
                    data["retryable"] = outcome.refusal.retryable
                raise MCPError(
                    code=INVALID_REQUEST,
                    message=outcome.refusal.message,
                    data=data,
                )
            actor = outcome.actor_at_start if outcome.actor_at_start is not None else default_actor
            hooked = outcome.context
        else:
            actor = default_actor
            hooked = None

        try:
            credentials = admitted if admitted is not None else sdk_credentials()
            owner = principal_binding(actor, credentials)
        except (IncompleteCredentials, TypeError):
            logger.warning("refusing %s: incomplete credentials", method)
            raise _internal_rpc_error() from None
        # The context the caller's request runs with, which the store's ``get_for`` receives:
        # the actor the binding was made from, and only the credentials the server verified itself
        # (``afd.server.Credentials``), never the SDK path's bare identity, which binds the owner
        # but is not one.
        context = copy.copy(hooked) if hooked is not None else CommandContext()
        context.actor = actor
        context.credentials = admitted
        return owner, view, context

    async def _find_task(
        self,
        owner: str,
        view: ScopeView | None,
        task_id: str,
        *,
        needs_command: bool,
        caller: CommandContext | None = None,
    ) -> TaskRecord:
        if not is_task_id(task_id):
            raise _task_not_found()
        try:
            get_for = getattr(self.store, "get_for", None)
            record: TaskRecord | None
            if callable(get_for) and caller is not None:
                record = cast("TaskRecord | None", await get_for(task_id, owner, caller))
            else:
                record = await self.store.get(task_id, owner)
        except Exception:
            raise _internal_rpc_error() from None
        now = int(self._clock.now())
        exposed_names = {cmd.name for cmd in self._get_exposed_commands()}
        if (
            record is None
            or record.id != task_id
            or not task_owner_matches(record.owner, owner)
            or is_task_expired(record, now)
            or record.command not in exposed_names
            or (view is not None and not view.known(record.command))
        ):
            raise _task_not_found()
        if needs_command and view is not None:
            decision = view.decide_task(record.command)
            if decision != "proceed":
                from mcp import MCPError
                from mcp_types import INVALID_REQUEST

                err = view.insufficient_scope(decision.forbidden)
                raise MCPError(
                    code=INVALID_REQUEST,
                    message=err.message,
                    data={
                        "code": err.code,
                        "suggestion": err.suggestion,
                        "scopes": list(decision.forbidden),
                        "retryable": False,
                    },
                )
        return record

    async def handle_get(self, ctx: Any, params: Any) -> Any:
        owner, view, caller = await self._resolve_caller("tasks/get", ctx, params.task_id)
        record = await self._find_task(
            owner, view, params.task_id, needs_command=True, caller=caller
        )
        return _wire_detailed_task(record)

    async def handle_update(self, ctx: Any, params: Any) -> Any:
        from mcp_types import EmptyResult

        owner, view, caller = await self._resolve_caller("tasks/update", ctx, params.task_id)
        await self._find_task(owner, view, params.task_id, needs_command=True, caller=caller)
        return EmptyResult()

    async def handle_cancel(self, ctx: Any, params: Any) -> Any:
        from mcp_types import EmptyResult

        owner, view, caller = await self._resolve_caller("tasks/cancel", ctx, params.task_id)
        record = await self._find_task(
            owner, view, params.task_id, needs_command=False, caller=caller
        )
        if is_terminal_task_status(record.status):
            running = self._running.get(record.id)
            if running is not None:
                running.stop("lost")
            return EmptyResult()
        try:
            await self.store.update(record.id, owner, TaskCancelRequestedChange())
        except Exception:
            raise _internal_rpc_error() from None
        running = self._running.get(record.id)
        if running is not None:
            running.stop("cancelled")
        return EmptyResult()

    def create_extension(self) -> Any:
        """Build the ``mcp.server.extension.Extension`` binding ``tasks/*`` and ``tools/call``."""
        from mcp.server.extension import Extension, MethodBinding

        task_id_params, update_task_params, _, _ = _get_wire_models()
        runtime = self

        class _AfdTasksExtension(Extension):
            identifier = TASKS_EXTENSION_ID

            def methods(self) -> Sequence[MethodBinding]:
                return (
                    MethodBinding(
                        method="tasks/get",
                        params_type=task_id_params,
                        handler=runtime.handle_get,
                        protocol_versions=None,
                    ),
                    MethodBinding(
                        method="tasks/update",
                        params_type=update_task_params,
                        handler=runtime.handle_update,
                        protocol_versions=None,
                    ),
                    MethodBinding(
                        method="tasks/cancel",
                        params_type=task_id_params,
                        handler=runtime.handle_cancel,
                        protocol_versions=None,
                    ),
                )

            async def intercept_tool_call(
                self,
                params: Any,
                ctx: Any,
                call_next: Any,
            ) -> Any:
                slot = _TaskCallSlot(request_context=ctx)
                with bind_task_slot(slot):
                    result = await call_next(ctx)
                if slot.created_task is not None:
                    return slot.created_task
                return result

        return _AfdTasksExtension()


def _consume_task_exception(task: asyncio.Task[Any]) -> None:
    if not task.cancelled():
        with suppress(Exception):
            task.exception()


__all__ = [
    "TaskRuntime",
    "bind_task_slot",
    "completion_change",
    "composite_task_error",
    "current_task_slot",
    "due_task_stop",
    "is_created_task_sentinel",
    "iso_timestamp",
    "missing_tasks_capability",
    "request_declares_tasks",
    "task_limit_error",
    "task_run_timeout_error",
    "token_expired_error",
    "unidentified_callers_error",
]
