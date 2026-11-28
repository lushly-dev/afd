"""Transport-agnostic batch and stream command executors.

Mirrors ``packages/core/src/command-execution.ts``: ``execute_batch()`` and
``execute_stream()`` hold batch and buffered-stream semantics in one place
(envelope validation, limits, deadlines, bounded parallelism, ``stop_on_error``,
cancellation and error redaction) and take a single-command ``CommandExecutor``
callback so the core registry, MCP server, DirectClient and testing harnesses
all run the same code.
"""

from __future__ import annotations

import asyncio
import contextlib
import copy
import dataclasses
import inspect
import logging
import math
import time
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError as PydanticValidationError

from afd.core.batch import (
    DEFAULT_MAX_BATCH_PARALLELISM,
    DEFAULT_MAX_BATCH_SIZE,
    BatchCommandResult,
    BatchOptions,
    BatchRequest,
    BatchResult,
    BatchTiming,
    batch_limit_problems,
    create_batch_result,
    create_failed_batch_result,
)
from afd.core.builtin_names import AFD_META_TOOL_NAMES
from afd.core.errors import CommandError
from afd.core.idempotency_keys import with_derived_idempotency_key
from afd.core.result import (
    CommandResult,
    ResultMetadata,
    coerce_command_result,
    execution_failure,
)
from afd.core.streaming import (
    ErrorChunk,
    StreamChunk,
    create_complete_chunk,
    create_data_chunk,
    create_error_chunk,
)
from afd.core.wire import WIRE_ENVELOPE

if TYPE_CHECKING:
    from afd.core.clock import Clock, RandomSource
    from afd.core.commands import CallGrant, CommandContext, CommandMiddleware

logger = logging.getLogger("afd.core")

_MAX_TIMEOUT_MS = 2_147_483_647

CommandExecutor = Callable[..., Awaitable[CommandResult[Any]]]
"""Async callback that executes a single command: ``(name, input, context) -> CommandResult``
(or a legacy two-argument ``(name, input) -> CommandResult``)."""


@dataclass
class ExecutorOptions:
    """Options shared by the core executors (``execute_batch``, ``execute_stream``)."""

    dev_mode: bool = False
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE
    max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM


@dataclass
class StreamExecutorOptions(ExecutorOptions):
    """Options for :func:`execute_stream`."""

    timeout: int | float | None = None


@dataclass
class CommandRegistryOptions:
    """Options for :func:`afd.core.commands.create_command_registry`."""

    dev_mode: bool = False
    call_grant: CallGrant | None = None
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE
    max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM
    middleware: Sequence[CommandMiddleware] | None = None
    clock: Clock | None = None
    random: RandomSource | None = None
    idempotency: Any = None
    """The idempotency step (``afd.server.create_idempotency_step``), or ``None``."""


def resolve_batch_limit(value: int | None, fallback: int, name: str) -> int:
    """Validate a configured batch ceiling as a positive integer."""
    if value is None:
        return fallback
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def copy_extra(extra: Mapping[str, Any]) -> dict[str, Any]:
    """Copy ``extra`` and nested plain dicts/lists (depth-capped) without copying host objects."""
    return {key: _copy_extra_value(value, 0) for key, value in extra.items()}


def _copy_extra_value(value: Any, depth: int) -> Any:
    if depth >= 16:
        return value
    if type(value) is dict:
        return {k: _copy_extra_value(v, depth + 1) for k, v in value.items()}
    if type(value) is list:
        return [_copy_extra_value(item, depth + 1) for item in value]
    return value


def _accepts_context(executor: Callable[..., Any]) -> bool:
    """Whether ``executor`` accepts a third positional ``context`` argument."""
    try:
        sig = inspect.signature(executor)
    except (TypeError, ValueError):
        return True
    positional = 0
    for param in sig.parameters.values():
        if param.kind is inspect.Parameter.VAR_POSITIONAL:
            return True
        if param.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ):
            positional += 1
    return positional >= 3


async def invoke_executor(
    executor: CommandExecutor,
    command_name: str,
    payload: Any,
    context: CommandContext,
) -> Any:
    """Invoke ``executor`` with ``(name, payload, context)`` or legacy ``(name, payload)``."""
    if _accepts_context(executor):
        return await executor(command_name, payload, context)
    return await executor(command_name, payload)


def _consume_task_exception(task: asyncio.Task[Any]) -> None:
    if not task.cancelled():
        with contextlib.suppress(Exception):
            task.exception()


def clone_context_with(context: Any, **updates: Any) -> Any:
    """Clone ``context`` with updates, safely handling custom dataclasses and objects.

    For dataclasses, only declared fields are passed to ``dataclasses.replace``;
    any remaining keys are applied with ``setattr`` when supported.
    """
    if dataclasses.is_dataclass(context) and not isinstance(context, type):
        known = {item.name for item in dataclasses.fields(context) if item.init}
        dc_updates = {key: value for key, value in updates.items() if key in known}
        extra_updates = {key: value for key, value in updates.items() if key not in known}
        cloned: Any = dataclasses.replace(context, **dc_updates)
        for key, value in extra_updates.items():
            with contextlib.suppress(AttributeError, TypeError):
                setattr(cloned, key, value)
        return cloned
    cloned = copy.copy(context)
    for key, value in updates.items():
        with contextlib.suppress(AttributeError, TypeError):
            setattr(cloned, key, value)
    return cloned


def deadline_signal_updates(
    base_context: Any,
    deadline_event: asyncio.Event,
) -> dict[str, Any]:
    """Build signal/cancel updates while preserving journal digest neutrality."""
    updates: dict[str, Any] = {
        "signal": deadline_event,
        "cancel": deadline_event,
    }
    base_signal = getattr(base_context, "signal", None)
    base_cancel = getattr(base_context, "cancel", None)
    prev_server_signal = getattr(base_context, "_server_signal", None)
    prev_server_fields = set(getattr(base_context, "_server_signal_fields", ()) or ())
    synthesized: list[str] = []
    if base_signal is None or (
        prev_server_signal is not None
        and base_signal is prev_server_signal
        and "signal" in prev_server_fields
    ):
        synthesized.append("signal")
    if base_cancel is None or (
        prev_server_signal is not None
        and base_cancel is prev_server_signal
        and "cancel" in prev_server_fields
    ):
        synthesized.append("cancel")
    if synthesized:
        updates["_server_signal"] = deadline_event
        updates["_server_signal_fields"] = tuple(synthesized)
    return updates


_CANCEL_GRACE_SECONDS = 0.05


async def _cancel_and_wait(tasks: Iterable[asyncio.Task[Any]]) -> None:
    """Cancel tasks and wait until every one of them has finished."""
    task_list = list(tasks)
    for task in task_list:
        task.cancel()
    if task_list:
        await asyncio.gather(*task_list, return_exceptions=True)


async def _cancel_timed_out(
    tasks: Iterable[asyncio.Task[Any]],
    *,
    grace_s: float = _CANCEL_GRACE_SECONDS,
) -> None:
    """Cancel timed-out tasks with a bounded grace window for cooperative cleanup.

    Well-behaved tasks (including subprocess kill/reap in ``exec_command``) settle
    immediately; handlers that swallow ``CancelledError`` and linger are detached
    with their late exceptions consumed so callers never hang past the deadline.
    """
    task_list = list(tasks)
    if not task_list:
        return
    for task in task_list:
        task.add_done_callback(_consume_task_exception)
        if not task.done():
            task.cancel()
    pending = [task for task in task_list if not task.done()]
    if pending:
        await asyncio.wait(pending, timeout=grace_s)


def describe_validation_error(exc: PydanticValidationError) -> list[dict[str, Any]]:
    """Field paths and messages of a pydantic error, without input values."""
    return [
        {
            "path": ".".join(str(part) for part in issue.get("loc", ())) or "(root)",
            "message": issue.get("msg", "Invalid value"),
            "code": issue.get("type", "validation_error"),
        }
        for issue in exc.errors()
    ]


def batch_problems(
    request: BatchRequest,
    *,
    max_batch_size: int,
    max_batch_parallelism: int,
    reject_meta_tools: bool = True,
) -> list[dict[str, Any]]:
    """Envelope problems that reject a whole batch before any command runs."""
    problems: list[dict[str, Any]] = []
    count = len(request.commands)
    if count == 0:
        problems.append(
            {
                "path": "commands",
                "message": "A batch needs at least one command",
                "code": "too_short",
            }
        )
    parallelism = request.options.parallelism if request.options else 1
    problems.extend(
        batch_limit_problems(
            count,
            parallelism,
            max_batch_size=max_batch_size,
            max_batch_parallelism=max_batch_parallelism,
        )
    )
    if reject_meta_tools:
        for index, item in enumerate(request.commands):
            if item.command in AFD_META_TOOL_NAMES:
                problems.append(
                    {
                        "path": f"commands.{index}.command",
                        "message": (
                            f"'{item.command}' is a built-in tool, not a command, "
                            "and cannot run inside a batch"
                        ),
                        "code": "reserved_tool",
                    }
                )
    return problems


def _invalid_batch(problem: Any, *, suggestion: str | None = None) -> BatchResult[Any]:
    return create_failed_batch_result(
        CommandError(
            code="INVALID_BATCH_REQUEST",
            message="Invalid batch request envelope",
            suggestion=suggestion
            or (
                "Provide { commands: [{ command, input }], options: { stopOnError, "
                "timeout (or timeoutMs), parallelism } }"
            ),
            retryable=False,
            details={"errors": problem if isinstance(problem, list) else [{"message": problem}]},
        )
    )


def _caller_cancelled(context: Any) -> bool:
    cancel = getattr(context, "cancel", None)
    signal = getattr(context, "signal", None)
    return bool(
        (cancel is not None and cancel.is_set()) or (signal is not None and signal.is_set())
    )


def _link_deadline_signal(
    caller_context: Any,
) -> tuple[asyncio.Event, asyncio.Task[None] | None]:
    """Create a fresh Event that also sets when caller ``signal`` or ``cancel`` fires."""
    deadline_event = asyncio.Event()
    caller_events = [
        ev
        for ev in (getattr(caller_context, "signal", None), getattr(caller_context, "cancel", None))
        if ev is not None
    ]
    if any(ev.is_set() for ev in caller_events):
        deadline_event.set()
        return deadline_event, None
    if not caller_events:
        return deadline_event, None

    async def _mirror() -> None:
        waits = [asyncio.create_task(ev.wait()) for ev in caller_events]
        try:
            await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
            deadline_event.set()
        finally:
            for wait_task in waits:
                if not wait_task.done():
                    wait_task.cancel()

    watcher = asyncio.create_task(_mirror())
    watcher.add_done_callback(_consume_task_exception)
    return deadline_event, watcher


async def _settle_batch_item(
    executor: CommandExecutor,
    command_name: str,
    payload: Any,
    context: CommandContext,
    dev_mode: bool,
) -> CommandResult[Any]:
    try:
        raw = await invoke_executor(executor, command_name, payload, context)
    except Exception as exc:
        logger.error("Batch command '%s' raised an unhandled exception", command_name, exc_info=exc)
        return execution_failure(exc, dev_mode)
    return coerce_command_result(raw, command_name)


async def execute_batch(
    request: Any,
    executor: CommandExecutor,
    context: CommandContext | None = None,
    options: ExecutorOptions | None = None,
    *,
    reject_meta_tools: bool = True,
) -> BatchResult[Any]:
    """Execute a batch of commands with partial-success semantics.

    - Validates the request envelope (``WIRE_ENVELOPE``), limits and reserved
      meta-tools before any command runs.
    - Enforces ``options.timeout`` as a whole-batch deadline at any
      ``parallelism``: in-flight items are cancelled and reported as
      ``BATCH_TIMEOUT``, and unstarted items are not run.
    - With ``options.stop_on_error``, a failure stops scheduling new items
      (``COMMAND_SKIPPED``) while already-started items finish normally.
    - Caller cancellation (``context.signal`` or ``context.cancel``) stops
      scheduling queued items (``COMMAND_CANCELLED``).
    - Exceptions thrown by ``executor`` are caught and redacted unless
      ``options.dev_mode`` is ``True``.
    """
    from afd.core.commands import CommandContext as CoreCommandContext

    exec_opts = options or ExecutorOptions()
    max_batch_size = resolve_batch_limit(
        exec_opts.max_batch_size, DEFAULT_MAX_BATCH_SIZE, "max_batch_size"
    )
    max_batch_parallelism = resolve_batch_limit(
        exec_opts.max_batch_parallelism, DEFAULT_MAX_BATCH_PARALLELISM, "max_batch_parallelism"
    )
    dev_mode = exec_opts.dev_mode is True

    start_time = time.perf_counter()
    started_at = datetime.now(UTC).isoformat()
    base_context = context if context is not None else CoreCommandContext()

    if not isinstance(request, BatchRequest):
        payload = request
        raw_options = request.get("options") if isinstance(request, dict) else None
        if isinstance(raw_options, dict) and "timeoutMs" in raw_options:
            if "timeout" in raw_options:
                return _invalid_batch("Specify only one of timeout or timeoutMs")
            raw_options = dict(raw_options)
            raw_options["timeout"] = raw_options.pop("timeoutMs")
            payload = {**request, "options": raw_options}
        try:
            request = BatchRequest.model_validate(payload, context=WIRE_ENVELOPE)
        except PydanticValidationError as exc:
            return _invalid_batch(describe_validation_error(exc))

    problems = batch_problems(
        request,
        max_batch_size=max_batch_size,
        max_batch_parallelism=max_batch_parallelism,
        reject_meta_tools=reject_meta_tools,
    )
    if problems:
        return _invalid_batch(
            problems,
            suggestion=(
                f"Send 1 to {max_batch_size} commands with parallelism at most "
                f"{max_batch_parallelism}. Batch only commands: call afd-batch, "
                "afd-pipe, afd-call, afd-discover and afd-detail as separate tool calls."
            ),
        )

    batch_opts = request.options or BatchOptions()
    commands = request.commands
    total = len(commands)
    parallelism = min(batch_opts.parallelism, total)
    deadline = None if batch_opts.timeout is None else start_time + batch_opts.timeout / 1000.0
    batch_trace_id = getattr(base_context, "trace_id", None) or f"batch-{uuid.uuid4().hex[:12]}"
    results: list[BatchCommandResult[Any] | None] = [None] * total
    in_flight: dict[asyncio.Task[CommandResult[Any]], tuple[int, float]] = {}
    next_index = 0
    stopped = False
    timed_out = False
    timeout_error = CommandError(
        code="BATCH_TIMEOUT",
        message=f"Batch timeout exceeded ({batch_opts.timeout}ms)",
        suggestion="Increase timeout or reduce the number of commands",
        retryable=True,
    )
    cancelled_error = CommandError(
        code="COMMAND_CANCELLED",
        message="Command cancelled before starting",
        suggestion="Start the command again if the result is still needed",
        retryable=False,
    )

    def record(index: int, result: CommandResult[Any], started: float) -> None:
        item = commands[index]
        results[index] = BatchCommandResult(
            id=item.id or f"cmd-{index}",
            index=index,
            command=item.command,
            result=result,
            duration_ms=(time.perf_counter() - started) * 1000,
        )

    batch_deadline_event: asyncio.Event | None = None
    batch_watcher: asyncio.Task[None] | None = None
    if deadline is not None:
        batch_deadline_event, batch_watcher = _link_deadline_signal(base_context)

    try:
        while True:
            while (
                not stopped
                and not timed_out
                and not _caller_cancelled(base_context)
                and next_index < total
                and len(in_flight) < parallelism
            ):
                if deadline is not None and time.perf_counter() >= deadline:
                    timed_out = True
                    break
                index = next_index
                next_index += 1
                extra_src = getattr(base_context, "extra", None)
                actor_src = getattr(base_context, "actor", None)
                item_updates: dict[str, Any] = {
                    "trace_id": f"{batch_trace_id}-{index}",
                    "extra": copy_extra(extra_src) if isinstance(extra_src, Mapping) else {},
                    "actor": copy.copy(actor_src) if actor_src is not None else None,
                }
                if batch_deadline_event is not None:
                    item_updates.update(deadline_signal_updates(base_context, batch_deadline_event))
                # Each item runs under the key derived from the request's (K4).
                item_context = with_derived_idempotency_key(
                    clone_context_with(base_context, **item_updates), "batch", index
                )
                item = commands[index]
                task = asyncio.ensure_future(
                    _settle_batch_item(executor, item.command, item.input, item_context, dev_mode)
                )
                in_flight[task] = (index, time.perf_counter())
            if not in_flight or timed_out:
                break
            wait_s = None if deadline is None else max(0.0, deadline - time.perf_counter())
            done, _ = await asyncio.wait(
                in_flight, timeout=wait_s, return_when=asyncio.FIRST_COMPLETED
            )
            if not done:
                timed_out = True
                break
            for task in done:
                index, started = in_flight.pop(task)
                result = task.result()
                record(index, result, started)
                if batch_opts.stop_on_error and not result.success:
                    stopped = True

        if in_flight:
            pending = dict(in_flight)
            in_flight.clear()
            if batch_deadline_event is not None:
                batch_deadline_event.set()
            await _cancel_timed_out(pending)
            for _task, (index, started) in pending.items():
                record(index, CommandResult(success=False, error=timeout_error), started)
    finally:
        if in_flight:
            if batch_deadline_event is not None:
                batch_deadline_event.set()
            await _cancel_and_wait(in_flight)
        if batch_watcher is not None and not batch_watcher.done():
            batch_watcher.cancel()

    final: list[BatchCommandResult[Any]] = []
    for index, item_result in enumerate(results):
        if item_result is None:
            item = commands[index]
            skipped = (
                timeout_error
                if timed_out
                else cancelled_error
                if _caller_cancelled(base_context)
                else CommandError(
                    code="COMMAND_SKIPPED",
                    message="Command skipped because batch execution stopped after a failure",
                    suggestion="Disable stopOnError to execute every command",
                )
            )
            item_result = BatchCommandResult(
                id=item.id or f"cmd-{index}",
                index=index,
                command=item.command,
                result=CommandResult(success=False, error=skipped),
                duration_ms=0,
            )
        final.append(item_result)

    total_ms = (time.perf_counter() - start_time) * 1000
    timing = BatchTiming(
        total_ms=total_ms,
        average_ms=total_ms / len(final),
        started_at=started_at,
        completed_at=datetime.now(UTC).isoformat(),
    )
    return create_batch_result(final, timing, metadata=ResultMetadata(trace_id=batch_trace_id))


# ═══════════════════════════════════════════════════════════════════════════════
# STREAM
# ═══════════════════════════════════════════════════════════════════════════════


def _aborted_chunk(phase: str, chunks_emitted: int) -> ErrorChunk:
    message = (
        "Stream was aborted before starting"
        if phase == "starting"
        else "Stream was aborted during execution"
        if phase == "execution"
        else "Stream was aborted"
    )
    return create_error_chunk(
        CommandError(
            code="STREAM_ABORTED",
            message=message,
            suggestion="Start the stream again if the result is still needed",
            retryable=True,
        ),
        chunks_emitted,
        recoverable=True,
        resume_from=chunks_emitted if phase == "data" else None,
    )


def _timeout_chunk(
    timeout_ms: int | float,
    chunks_emitted: int,
    *,
    resume_from: int | None = None,
) -> ErrorChunk:
    return create_error_chunk(
        CommandError(
            code="STREAM_TIMEOUT",
            message=f"Stream timed out after {timeout_ms}ms",
            suggestion="Increase the stream timeout, or request less data, and retry",
            retryable=True,
        ),
        chunks_emitted,
        recoverable=True,
        resume_from=resume_from,
    )


async def execute_stream(
    command_name: str,
    input: Any,
    executor: CommandExecutor,
    context: CommandContext | None = None,
    options: StreamExecutorOptions | None = None,
) -> AsyncGenerator[StreamChunk, None]:
    """Execute a command and yield its final result as stream chunks.

    Mirrors TypeScript's ``executeStream()``: this is buffered streaming, not
    incremental streaming. The command runs once through ``executor`` with
    ``context`` (skipping B5 output-budget checks per ``spec/output-budgets.md``
    B7); a list result becomes one ``DataChunk`` per item, any other data
    becomes a single ``DataChunk``, followed by a ``CompleteChunk``. Failures
    yield an ``ErrorChunk``; ``context.signal``/``context.cancel`` yields
    ``STREAM_ABORTED`` and ``options.timeout`` yields ``STREAM_TIMEOUT``.
    """
    from afd.core.commands import CommandContext as CoreCommandContext

    exec_opts = options or StreamExecutorOptions()
    timeout = exec_opts.timeout
    if timeout is not None and (
        isinstance(timeout, bool)
        or not isinstance(timeout, (int, float))
        or (isinstance(timeout, float) and not math.isfinite(timeout))
        or timeout < 0
    ):
        yield create_error_chunk(
            CommandError(
                code="VALIDATION_ERROR",
                message="Stream timeout must be a nonnegative finite number of milliseconds",
                suggestion="Pass a timeout such as 30000, or omit it for no deadline",
                retryable=False,
            ),
            0,
            recoverable=False,
        )
        return

    base_context = context if context is not None else CoreCommandContext()
    if _caller_cancelled(base_context):
        yield _aborted_chunk("starting", 0)
        return

    start_time = time.perf_counter()
    deadline = None if timeout is None else start_time + min(timeout, _MAX_TIMEOUT_MS) / 1000.0
    deadline_expired = False

    deadline_event: asyncio.Event | None = None
    watcher: asyncio.Task[None] | None = None
    timer_handle: asyncio.TimerHandle | None = None
    if timeout is not None:
        deadline_event, watcher = _link_deadline_signal(base_context)

        def _on_stream_timeout() -> None:
            nonlocal deadline_expired
            deadline_expired = True
            if deadline_event is not None:
                deadline_event.set()

        timeout_seconds = min(timeout, _MAX_TIMEOUT_MS) / 1000.0
        timer_handle = asyncio.get_running_loop().call_later(timeout_seconds, _on_stream_timeout)

    updates: dict[str, Any] = {"_skip_output_budget": True}
    if deadline_event is not None:
        updates.update(deadline_signal_updates(base_context, deadline_event))
    stream_context = clone_context_with(base_context, **updates)

    def _stopped(phase: str, chunks_emitted: int) -> ErrorChunk:
        if deadline_expired:
            assert timeout is not None
            return _timeout_chunk(
                timeout,
                chunks_emitted,
                resume_from=chunks_emitted if phase == "data" else None,
            )
        return _aborted_chunk(phase, chunks_emitted)

    def _check_deadline() -> bool:
        nonlocal deadline_expired
        if deadline is not None and time.perf_counter() >= deadline:
            deadline_expired = True
            if deadline_event is not None:
                deadline_event.set()
            return True
        return deadline_expired

    def _is_stopped() -> bool:
        if _check_deadline():
            return True
        return _caller_cancelled(base_context) or (
            deadline_event is not None and deadline_event.is_set()
        )

    try:
        try:
            if deadline is None:
                raw_result = await invoke_executor(executor, command_name, input, stream_context)
            else:
                remaining = max(0.0, deadline - time.perf_counter())
                task = asyncio.create_task(
                    invoke_executor(executor, command_name, input, stream_context)
                )
                try:
                    done, _ = await asyncio.wait({task}, timeout=remaining)
                    if task in done:
                        if task.cancelled():
                            yield _stopped("execution", 0)
                            return
                        task_exc = task.exception()
                        if task_exc is not None:
                            raise task_exc
                        raw_result = task.result()
                    else:
                        deadline_expired = True
                        if deadline_event is not None:
                            deadline_event.set()
                        task.cancel()
                        task.add_done_callback(_consume_task_exception)
                        await asyncio.sleep(0)
                        yield _stopped("execution", 0)
                        return
                except asyncio.CancelledError:
                    if deadline_event is not None:
                        deadline_event.set()
                    if not task.done():
                        task.cancel()
                        await asyncio.gather(task, return_exceptions=True)
                    raise
        except Exception as exc:
            logger.error(
                "Stream command '%s' raised an unhandled exception", command_name, exc_info=exc
            )
            yield create_error_chunk(
                CommandError(
                    code="STREAM_ERROR",
                    message=str(exc) if exec_opts.dev_mode else "Stream execution failed",
                    suggestion="Retry the stream; contact support if this persists",
                    retryable=True,
                ),
                0,
                recoverable=True,
            )
            return

        if _is_stopped():
            yield _stopped("execution", 0)
            return

        result = coerce_command_result(raw_result, command_name)
        if not result.success:
            err = result.error or CommandError(
                code="COMMAND_FAILED",
                message="Command execution failed",
                suggestion="Check the command input and try again",
            )
            yield create_error_chunk(
                err,
                0,
                recoverable=bool(err.retryable),
            )
            return

        items: list[Any] = result.data if isinstance(result.data, list) else [result.data]
        chunks_emitted = 0
        total_items = len(items)
        for index, item in enumerate(items):
            if _is_stopped():
                yield _stopped("data", chunks_emitted)
                return
            yield create_data_chunk(item, index=index, is_last=(index == total_items - 1))
            chunks_emitted += 1

        elapsed_ms = (time.perf_counter() - start_time) * 1000
        yield create_complete_chunk(
            chunks_emitted,
            elapsed_ms,
            confidence=result.confidence,
            reasoning=result.reasoning,
            metadata=result.metadata,
        )
    finally:
        if timer_handle is not None:
            timer_handle.cancel()
        if watcher is not None and not watcher.done():
            watcher.cancel()
