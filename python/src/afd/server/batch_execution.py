"""Server wrappers for ``afd-batch`` and ``afd-pipe`` over the core executors.

Delegates batch scheduling, limits, deadlines, cancellation and error redaction
to :func:`afd.core.command_execution.execute_batch` and pipeline execution to
:func:`afd.core.pipeline.execute_pipeline` so server and core share one engine.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import ValidationError as PydanticValidationError

from afd.core.batch import BatchResult
from afd.core.builtin_names import AFD_META_TOOL_NAMES
from afd.core.command_execution import (
    ExecutorOptions,
    batch_problems,
    describe_validation_error,
)
from afd.core.command_execution import (
    execute_batch as _execute_core_batch,
)
from afd.core.commands import CommandContext
from afd.core.errors import CommandError
from afd.core.pipeline import (
    PipelineRequest,
    PipelineResult,
    create_pipeline_failure,
    execute_pipeline,
)
from afd.core.result import CommandResult
from afd.core.wire import WIRE_ENVELOPE

RunCommand = Callable[[str, Any, CommandContext], Awaitable[CommandResult[Any]]]
"""Runs one command by name with its input and context. Never raises, except when cancelled."""

__all__ = [
    "RunCommand",
    "batch_problems",
    "describe_validation_error",
    "execute_batch",
    "execute_pipeline_request",
]


async def execute_batch(
    request: Any,
    context: CommandContext | None,
    *,
    run_command: RunCommand,
    max_batch_size: int,
    max_batch_parallelism: int,
    dev_mode: bool = False,
) -> BatchResult[Any]:
    """Run a batch with partial-success semantics via the shared core batch executor."""
    return await _execute_core_batch(
        request,
        run_command,
        context,
        ExecutorOptions(
            dev_mode=dev_mode,
            max_batch_size=max_batch_size,
            max_batch_parallelism=max_batch_parallelism,
        ),
        reject_meta_tools=True,
    )


async def execute_pipeline_request(
    request: Any,
    context: CommandContext | None,
    *,
    run_command: RunCommand,
    dev_mode: bool,
) -> PipelineResult[Any]:
    """Run a pipeline of commands via the shared core pipeline executor.

    An invalid envelope (see ``WIRE_ENVELOPE``) returns a PipelineResult
    whose one synthetic step (index -1, command "") carries
    ``INVALID_PIPELINE_REQUEST``, before any step runs, as in TypeScript.
    """
    if not isinstance(request, PipelineRequest):
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

    return await execute_pipeline(
        request, run_command, context or CommandContext(), dev_mode=dev_mode
    )
