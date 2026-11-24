"""How an AFD server runs ``afd-batch`` and ``afd-pipe`` requests.

The server supplies ``run_command``, which runs one command and returns its
CommandResult without raising (except when cancelled); this module owns the
envelope checks, limits, scheduling, timeouts and aggregation around it.
"""

from __future__ import annotations

import asyncio
import copy
import dataclasses
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError as PydanticValidationError

from afd.core.batch import (
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
from afd.core.commands import CommandContext
from afd.core.errors import CommandError
from afd.core.pipeline import (
    PipelineRequest,
    PipelineResult,
    create_pipeline_failure,
    execute_pipeline,
)
from afd.core.result import CommandResult, ResultMetadata
from afd.core.wire import WIRE_ENVELOPE
from afd.server.context_hook import copy_extra
from afd.server.tool_router import new_trace_id

RunCommand = Callable[[str, Any, CommandContext], Awaitable[CommandResult[Any]]]
"""Runs one command by name with its input and context. Never raises, except when cancelled."""


def batch_problems(
    request: BatchRequest, *, max_batch_size: int, max_batch_parallelism: int
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


async def execute_batch(
    request: Any,
    context: CommandContext | None,
    *,
    run_command: RunCommand,
    max_batch_size: int,
    max_batch_parallelism: int,
) -> BatchResult[Any]:
    """Run a batch with partial-success semantics.

    Any request that is not a valid envelope (see ``WIRE_ENVELOPE``), is
    empty or exceeds the server's limits returns a failed BatchResult with
    ``INVALID_BATCH_REQUEST`` before any command runs, as TypeScript's
    ``executeBatch()`` does.

    A stopOnError failure prevents new starts; commands already in flight
    finish normally. A timeout or cancellation cancels and awaits them.
    Every item is coerced to a CommandResult, so aggregation never raises
    after commands have run.
    """
    start_time = time.perf_counter()
    started_at = datetime.now(UTC).isoformat()
    context = context or CommandContext()
    if not isinstance(request, BatchRequest):
        payload = request
        options = request.get("options") if isinstance(request, dict) else None
        if isinstance(options, dict) and "timeoutMs" in options:
            if "timeout" in options:
                return _invalid_batch("Specify only one of timeout or timeoutMs")
            options = dict(options)
            options["timeout"] = options.pop("timeoutMs")
            payload = {**request, "options": options}
        try:
            request = BatchRequest.model_validate(payload, context=WIRE_ENVELOPE)
        except PydanticValidationError as exc:
            return _invalid_batch(describe_validation_error(exc))

    problems = batch_problems(
        request, max_batch_size=max_batch_size, max_batch_parallelism=max_batch_parallelism
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

    options = request.options or BatchOptions()
    commands = request.commands
    total = len(commands)
    parallelism = min(options.parallelism, total)
    deadline = None if options.timeout is None else start_time + options.timeout / 1000
    batch_trace_id = context.trace_id or new_trace_id("batch")
    results: list[BatchCommandResult[Any] | None] = [None] * total
    in_flight: dict[asyncio.Task[CommandResult[Any]], tuple[int, float]] = {}
    next_index = 0
    stopped = False
    timed_out = False
    timeout_error = CommandError(
        code="BATCH_TIMEOUT",
        message=f"Batch timeout exceeded ({options.timeout}ms)",
        suggestion="Increase timeout or reduce the number of commands",
        retryable=True,
    )
    cancelled_error = CommandError(
        code="COMMAND_CANCELLED",
        message="Command cancelled before starting",
        suggestion="Start the command again if the result is still needed",
        retryable=False,
    )

    def caller_cancelled() -> bool:
        cancel = getattr(context, "cancel", None)
        signal = getattr(context, "signal", None)
        return bool(
            (cancel is not None and cancel.is_set()) or (signal is not None and signal.is_set())
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

    try:
        while True:
            while (
                not stopped
                and not timed_out
                and not caller_cancelled()
                and next_index < total
                and len(in_flight) < parallelism
            ):
                if deadline is not None and time.perf_counter() >= deadline:
                    timed_out = True
                    break
                index = next_index
                next_index += 1
                item_context = CommandContext(
                    trace_id=f"{batch_trace_id}-{index}",
                    timeout=context.timeout,
                    extra=copy_extra(context.extra),
                    actor=copy.copy(context.actor) if context.actor is not None else None,
                    clock=context.clock,
                    random=context.random,
                    approval=getattr(context, "approval", None),
                    cancel=getattr(context, "cancel", None),
                    signal=getattr(context, "signal", None),
                    credentials=getattr(context, "credentials", None),
                    _output_budget_ask=getattr(context, "_output_budget_ask", None),
                    _scope_view=getattr(context, "_scope_view", None),
                )
                item = commands[index]
                task = asyncio.ensure_future(run_command(item.command, item.input, item_context))
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
                if options.stop_on_error and not result.success:
                    stopped = True

        # The batch has stopped: cancel what is still running and wait for
        # it, so that no command keeps running after the result is sent.
        if in_flight:
            pending = dict(in_flight)
            in_flight.clear()
            await _cancel_and_wait(pending)
            for task, (index, started) in pending.items():
                if not task.cancelled() and task.exception() is None:
                    record(index, task.result(), started)  # finished first
                else:
                    failed = timeout_error
                    record(index, CommandResult(success=False, error=failed), started)
    finally:
        # Reached with tasks in flight only when the batch itself is
        # cancelled (for example, the client went away).
        if in_flight:
            await _cancel_and_wait(in_flight)

    final: list[BatchCommandResult[Any]] = []
    for index, item_result in enumerate(results):
        if item_result is None:
            item = commands[index]
            skipped = (
                timeout_error
                if timed_out
                else cancelled_error
                if caller_cancelled()
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


async def execute_pipeline_request(
    request: Any,
    context: CommandContext | None,
    *,
    run_command: RunCommand,
    dev_mode: bool,
) -> PipelineResult[Any]:
    """Run a pipeline of commands.

    An invalid envelope (see ``WIRE_ENVELOPE``) returns a PipelineResult
    whose one synthetic step (index -1, command "") carries
    ``INVALID_PIPELINE_REQUEST``, before any step runs, as in TypeScript.
    """
    if not isinstance(request, PipelineRequest):
        # Options accept camelCase (continueOnFailure, timeoutMs) and snake_case.
        # Conditions are validated here too, so a malformed `when` rejects
        # the whole pipeline before any step runs.
        try:
            request = PipelineRequest.model_validate(request, context=WIRE_ENVELOPE)
        except PydanticValidationError as exc:
            return create_pipeline_failure(
                CommandError(
                    code="INVALID_PIPELINE_REQUEST",
                    message="Invalid pipeline request envelope",
                    suggestion=(
                        "Provide steps with nonempty command names, object inputs, "
                        "valid conditions, and correctly typed options"
                    ),
                    retryable=False,
                    details={"errors": describe_validation_error(exc)},
                )
            )

    reserved = [
        {
            "path": f"steps.{index}.command",
            "message": (
                f"'{step.command}' is a built-in tool, not a command, "
                "and cannot run as a pipeline step"
            ),
            "code": "reserved_tool",
        }
        for index, step in enumerate(request.steps)
        if step.command in AFD_META_TOOL_NAMES
    ]
    if reserved:
        return create_pipeline_failure(
            CommandError(
                code="INVALID_PIPELINE_REQUEST",
                message="Pipeline steps cannot call built-in tools",
                suggestion=(
                    "Use command names in steps. Call afd-batch, afd-pipe, afd-call, "
                    "afd-discover and afd-detail as separate tool calls."
                ),
                retryable=False,
                details={"errors": reserved},
            )
        )

    step_context = context or CommandContext()

    async def executor(command_name: str, payload: dict[str, Any]) -> CommandResult[Any]:
        per_step = (
            dataclasses.replace(
                step_context,
                extra=copy_extra(step_context.extra),
                actor=copy.copy(step_context.actor) if step_context.actor is not None else None,
                output_budget=None,
            )
            if dataclasses.is_dataclass(step_context)
            else step_context
        )
        return await run_command(command_name, payload, per_step)

    return await execute_pipeline(request, executor, dev_mode=dev_mode)


async def _cancel_and_wait(tasks: dict[asyncio.Task[Any], Any]) -> None:
    """Cancel tasks and wait until every one of them has finished."""
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


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


def _invalid_batch(problem: Any, *, suggestion: str | None = None) -> BatchResult[Any]:
    """A failed BatchResult for a request whose envelope is invalid."""
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
