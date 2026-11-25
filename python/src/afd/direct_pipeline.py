"""Public-shape adapter for ``DirectClient.pipe()`` over the core pipeline executor.

All pipeline semantics — depth validation, ``stream: true`` rejection,
variable resolution (``$prev``, ``$first``, ``$steps[N]``, ``$steps.alias``,
``$input``), ``when`` condition evaluation, resolution limits, result coercion,
and fail-fast stepping — live in :func:`afd.core.pipeline.execute_pipeline`.
This module only normalizes ``DirectPipelineStep`` / ``dict`` inputs (including
legacy string ``when`` references) and adapts the ``PipelineResult`` into the
documented :class:`DirectPipelineResult` shape.
"""

from __future__ import annotations

import time
import warnings
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError as PydanticValidationError

from afd.core.errors import CommandError
from afd.core.pipeline import (
    PipelineContext as _PipelineContext,
)
from afd.core.pipeline import (
    PipelineRequest as _PipelineRequest,
)
from afd.core.pipeline import (
    PipelineStep as _PipelineStep,
)
from afd.core.pipeline import (
    StepStatus as _StepStatus,
)
from afd.core.pipeline import (
    condition_error,
    execute_pipeline,
    resolve_variable,
)
from afd.core.pipeline_variables import MAX_INPUT_DEPTH, exceeds_depth
from afd.core.result import CommandResult, failure, success


@dataclass
class DirectPipelineStep:
    """A step in a direct-client command pipeline.

    Attributes:
        command: Command name to execute
        input: Arguments for the command (can include variable references)
        alias: Name to store result as (referenced as ``$steps.<alias>``)
        when: Optional condition for execution: a pipeline condition such as
            ``{'$exists': '$prev.id'}``, or a reference string that must
            resolve to a truthy value (e.g. ``'$steps.user.active'``)
        stream: Not implemented. ``True`` fails this step with
            UNSUPPORTED_OPTION before any step runs, as in ``afd-pipe``
    """

    command: str
    input: dict[str, Any] | None = None
    alias: str | None = None
    when: str | dict[str, Any] | None = None
    stream: bool | None = None


@dataclass
class DirectPipelineStepResult:
    """Result of a single direct-client pipeline step."""

    command: str
    alias: str | None
    result: CommandResult[Any]
    duration_ms: float
    skipped: bool = False


@dataclass
class DirectPipelineResult:
    """Result of executing a direct-client command pipeline.

    Attributes:
        success: True if all steps succeeded
        steps: Individual step results
        outputs: Named outputs from steps with aliases
        final: The final step's result
        total_duration_ms: Total pipeline duration
    """

    success: bool
    steps: list[DirectPipelineStepResult]
    outputs: dict[str, Any]
    final: CommandResult[Any] | None
    total_duration_ms: float


async def run_direct_pipeline(
    steps: list[DirectPipelineStep | dict[str, Any]],
    input: dict[str, Any] | None,
    *,
    call: Callable[[str, dict[str, Any] | None], Awaitable[Any]],
    debug: Callable[[str], None],
    trace_id: str,
    start_time: float,
) -> DirectPipelineResult:
    """Run ``steps`` through :func:`afd.core.pipeline.execute_pipeline` and adapt the result."""
    debug(f"[{trace_id}] Starting pipeline with {len(steps)} steps")

    normalized_steps: list[DirectPipelineStep] = []
    for step in steps:
        if isinstance(step, dict):
            normalized_steps.append(
                DirectPipelineStep(
                    command=step.get("command", ""),
                    input=step.get("input"),
                    alias=step.get("as") or step.get("alias"),
                    when=step.get("when"),
                    stream=step.get("stream"),
                )
            )
        else:
            normalized_steps.append(step)

    invalid = _validate_steps(normalized_steps, input)
    if invalid is not None:
        debug(f"[{trace_id}] Pipeline rejected: {invalid.message}")
        return DirectPipelineResult(
            success=False,
            steps=[],
            outputs={},
            final=failure(invalid),
            total_duration_ms=(time.perf_counter() - start_time) * 1000,
        )

    def _make_string_when(expression: str) -> Callable[[_PipelineContext], bool]:
        return lambda ctx: bool(resolve_variable(expression, ctx))

    when_overrides: dict[int, Callable[[_PipelineContext], bool]] = {}
    core_steps: list[_PipelineStep] = []
    for index, step in enumerate(normalized_steps):
        core_when: Any = None
        if isinstance(step.when, str):
            if step.when:
                when_overrides[index] = _make_string_when(step.when)
        elif step.when:
            core_when = step.when
        try:
            core_steps.append(
                _PipelineStep.model_construct(
                    command=step.command,
                    input=step.input,
                    as_=step.alias,
                    when=_PipelineStep(command="x", when=core_when).when
                    if core_when is not None
                    else None,
                    stream=step.stream,
                )
            )
        except PydanticValidationError as exc:
            from afd.core.command_execution import describe_validation_error

            err = CommandError(
                code="VALIDATION_ERROR",
                message=f"Step {index} has an invalid when condition",
                suggestion="Provide valid command names, object inputs, and conditions",
                retryable=False,
                details={"stepIndex": index, "errors": describe_validation_error(exc)},
            )
            return DirectPipelineResult(
                success=False,
                steps=[],
                outputs={},
                final=failure(err),
                total_duration_ms=(time.perf_counter() - start_time) * 1000,
            )

    raw_results: dict[int, CommandResult[Any]] = {}
    request = _PipelineRequest.model_construct(steps=core_steps, input=input)

    async def step_executor(command: str, payload: dict[str, Any] | None) -> Any:
        return await call(command, payload)

    pipeline_result = await execute_pipeline(
        request,
        step_executor,
        dev_mode=False,
        _when_overrides=when_overrides or None,
        _raw_results=raw_results,
        _preserve_none_input=True,
    )

    total_duration = (time.perf_counter() - start_time) * 1000

    # Handle whole-pipeline preflight failure (index -1) from core execute_pipeline.
    if len(pipeline_result.steps) == 1 and pipeline_result.steps[0].index == -1:
        err = pipeline_result.steps[0].error or CommandError(
            code="VALIDATION_ERROR",
            message="Invalid pipeline request",
            suggestion="Check pipeline step inputs and conditions",
        )
        return DirectPipelineResult(
            success=False,
            steps=[],
            outputs={},
            final=failure(err),
            total_duration_ms=total_duration,
        )

    # Check if the core pipeline rejected a streaming step before running any command.
    streaming_index = next(
        (
            step.index
            for step in pipeline_result.steps
            if step.status == _StepStatus.FAILURE
            and step.error is not None
            and step.error.code == "UNSUPPORTED_OPTION"
            and not raw_results
        ),
        None,
    )
    if streaming_index is not None:
        streaming_error = pipeline_result.steps[streaming_index].error
        assert streaming_error is not None
        skipped_result = success(
            {
                "skipped": True,
                "reason": f"Pipeline rejected: step {streaming_index} sets stream: true",
            }
        )
        return DirectPipelineResult(
            success=False,
            steps=[
                DirectPipelineStepResult(
                    command=step.command,
                    alias=step.alias,
                    result=failure(streaming_error)
                    if step.index == streaming_index
                    else skipped_result,
                    duration_ms=0,
                    skipped=step.index != streaming_index,
                )
                for step in pipeline_result.steps
            ],
            outputs={},
            final=failure(streaming_error),
            total_duration_ms=total_duration,
        )

    step_results: list[DirectPipelineStepResult] = []
    outputs: dict[str, Any] = {}
    final_result: CommandResult[Any] | None = None
    all_success = True

    for core_step in pipeline_result.steps:
        orig_step = normalized_steps[core_step.index]
        if core_step.status == _StepStatus.SKIPPED:
            if not all_success:
                # Trailing steps skipped after an earlier failure are omitted from
                # DirectPipelineResult.steps to preserve the historical public shape.
                break
            debug(f"[{trace_id}] Skipped due to condition: {orig_step.when}")
            step_results.append(
                DirectPipelineStepResult(
                    command=core_step.command,
                    alias=core_step.alias,
                    result=success(
                        {"skipped": True, "reason": f"Condition not met: {orig_step.when}"}
                    ),
                    duration_ms=0,
                    skipped=True,
                )
            )
            continue

        result = raw_results.get(core_step.index)
        if result is None:
            result = (
                success(core_step.data)
                if core_step.status == _StepStatus.SUCCESS
                else failure(
                    core_step.error
                    or CommandError(
                        code="COMMAND_EXECUTION_ERROR",
                        message="An internal error occurred",
                        suggestion="Contact support if this persists",
                    )
                )
            )

        step_results.append(
            DirectPipelineStepResult(
                command=core_step.command,
                alias=core_step.alias,
                result=result,
                duration_ms=core_step.execution_time_ms,
            )
        )
        if core_step.alias:
            outputs[core_step.alias] = result.data if result.success else None
        final_result = result
        if not result.success:
            all_success = False
            debug(f"[{trace_id}] Step failed: {core_step.command}")

    debug(f"[{trace_id}] Pipeline complete in {total_duration:.2f}ms, success={all_success}")
    return DirectPipelineResult(
        success=all_success,
        steps=step_results,
        outputs=outputs,
        final=final_result,
        total_duration_ms=total_duration,
    )


def _validate_steps(
    steps: list[DirectPipelineStep],
    pipeline_input: dict[str, Any] | None = None,
) -> CommandError | None:
    """Reject over-deep inputs and malformed conditions before any step runs."""
    if pipeline_input is not None and exceeds_depth(pipeline_input):
        return CommandError(
            code="VALIDATION_ERROR",
            message=f"Pipeline input is nested deeper than {MAX_INPUT_DEPTH} levels",
            suggestion=(
                f"Reduce the nesting of the pipeline input to at most {MAX_INPUT_DEPTH} levels"
            ),
            retryable=False,
            details={"maxDepth": MAX_INPUT_DEPTH},
        )
    for index, step in enumerate(steps):
        if step.input is not None and exceeds_depth(step.input):
            return CommandError(
                code="VALIDATION_ERROR",
                message=f"Step {index} input is nested deeper than {MAX_INPUT_DEPTH} levels",
                suggestion=(
                    f"Reduce the nesting of the step input to at most {MAX_INPUT_DEPTH} levels"
                ),
                retryable=False,
                details={"stepIndex": index, "maxDepth": MAX_INPUT_DEPTH},
            )
        if step.when and not isinstance(step.when, str):
            problem = condition_error(step.when)
            if problem:
                return CommandError(
                    code="VALIDATION_ERROR",
                    message=f"Step {index} has an invalid when condition: {problem}",
                    suggestion=(
                        "Use one operator per condition object: $exists, $eq, $ne, "
                        "$gt, $gte, $lt, $lte, $and, $or or $not"
                    ),
                    retryable=False,
                    details={"stepIndex": index},
                )
    return None


_DEPRECATED_NAMES = {
    "PipelineStep": DirectPipelineStep,
    "PipelineStepResult": DirectPipelineStepResult,
    "PipelineResult": DirectPipelineResult,
}


def __getattr__(name: str) -> Any:
    target = _DEPRECATED_NAMES.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    warnings.warn(
        f"afd.direct_pipeline.{name} is deprecated and will be removed in the next minor "
        f"release; use afd.direct_pipeline.{target.__name__} instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return target
