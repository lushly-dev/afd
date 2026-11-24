"""How ``DirectClient.pipe()`` runs a pipeline of commands in-process.

The client supplies ``call``, which runs one command the way ``DirectClient.call``
does; this module owns step normalization, validation, conditions, variable
resolution and the result. ``afd.direct`` re-exports the pipeline types.
"""

from __future__ import annotations

import time
import warnings
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from afd.core.errors import CommandError
from afd.core.pipeline import (
    PipelineContext as _PipelineContext,
)
from afd.core.pipeline import (
    StepResult as _StepResult,
)
from afd.core.pipeline import (
    StepStatus as _StepStatus,
)
from afd.core.pipeline import (
    _stream_unsupported_error,
    condition_error,
    evaluate_condition,
    resolution_limit_failure,
    resolve_variable,
    resolve_variables,
    step_data,
)
from afd.core.pipeline_variables import (
    MAX_INPUT_DEPTH,
    PipelineResolutionLimitError,
    exceeds_depth,
)
from afd.core.result import CommandResult, coerce_command_result, failure, success


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
    """Run ``steps`` with ``call``; see ``DirectClient.pipe`` for the semantics.

    ``start_time`` is the ``time.perf_counter()`` reading the pipeline's duration counts from.
    """
    debug(f"[{trace_id}] Starting pipeline with {len(steps)} steps")

    # Normalize steps to DirectPipelineStep objects
    normalized_steps = []
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
    streaming = next(
        (index for index, step in enumerate(normalized_steps) if step.stream is True),
        None,
    )
    if streaming is not None:
        debug(f"[{trace_id}] Pipeline rejected: step {streaming} sets stream")
        return _reject_streaming_step(normalized_steps, streaming, start_time)

    step_results: list[DirectPipelineStepResult] = []
    outputs: dict[str, Any] = {}
    prev_result: CommandResult[Any] | None = None
    all_success = True
    variables = _PipelineContext(pipeline_input=input)

    for i, step in enumerate(normalized_steps):
        step_start = time.perf_counter()

        debug(f"[{trace_id}] Step {i + 1}/{len(normalized_steps)}: {step.command}")

        # Check 'when' condition
        if step.when:
            should_run = _evaluate_condition(step.when, variables)
            if not should_run:
                debug(f"[{trace_id}] Skipped due to condition: {step.when}")
                step_results.append(
                    DirectPipelineStepResult(
                        command=step.command,
                        alias=step.alias,
                        result=success(
                            {"skipped": True, "reason": f"Condition not met: {step.when}"}
                        ),
                        duration_ms=0,
                        skipped=True,
                    )
                )
                variables.steps.append(
                    _StepResult(
                        index=i,
                        alias=step.alias,
                        command=step.command,
                        status=_StepStatus.SKIPPED,
                    )
                )
                continue

        # Resolve variables in input. A step input over the limits fails
        # the step without running the command.
        try:
            resolved_input = (
                resolve_variables(step.input, variables) if step.input is not None else None
            )
        except PipelineResolutionLimitError as exc:
            result = resolution_limit_failure(exc, i)
        else:
            # Execute the command. A handler that returned something other
            # than a CommandResult is a failed step, never an exception.
            result = coerce_command_result(await call(step.command, resolved_input), step.command)

        step_duration = (time.perf_counter() - step_start) * 1000

        step_results.append(
            DirectPipelineStepResult(
                command=step.command,
                alias=step.alias,
                result=result,
                duration_ms=step_duration,
            )
        )
        step_record = _StepResult(
            index=i,
            alias=step.alias,
            command=step.command,
            status=_StepStatus.SUCCESS if result.success else _StepStatus.FAILURE,
            execution_time_ms=step_duration,
            **(step_data(result) if result.success else {}),
        )
        variables.steps.append(step_record)
        if result.success:
            variables.previous_result = step_record

        # Store in outputs if aliased
        if step.alias:
            outputs[step.alias] = result.data if result.success else None

        prev_result = result

        # Track overall success
        if not result.success:
            all_success = False
            debug(f"[{trace_id}] Step failed: {step.command}")
            break  # Stop pipeline on first failure

    total_duration = (time.perf_counter() - start_time) * 1000

    debug(f"[{trace_id}] Pipeline complete in {total_duration:.2f}ms, success={all_success}")

    return DirectPipelineResult(
        success=all_success,
        steps=step_results,
        outputs=outputs,
        final=prev_result,
        total_duration_ms=total_duration,
    )


def _evaluate_condition(
    condition: str | dict[str, Any],
    variables: _PipelineContext,
) -> bool:
    """Evaluate a step's ``when`` condition.

    A dict is a pipeline condition (``$exists``, ``$eq``, ``$and``, ...).
    A string is resolved as a reference and must be truthy; an unresolved
    reference is false.
    """
    if isinstance(condition, str):
        return bool(resolve_variable(condition, variables))
    return evaluate_condition(condition, variables)  # type: ignore[arg-type]


def _reject_streaming_step(
    steps: list[DirectPipelineStep],
    failed_index: int,
    start_time: float,
) -> DirectPipelineResult:
    """Fail the streaming step with UNSUPPORTED_OPTION and skip the others, as
    ``afd-pipe`` does. No command runs."""
    error = _stream_unsupported_error(failed_index)
    skipped = success(
        {"skipped": True, "reason": f"Pipeline rejected: step {failed_index} sets stream: true"}
    )
    return DirectPipelineResult(
        success=False,
        steps=[
            DirectPipelineStepResult(
                command=step.command,
                alias=step.alias,
                result=failure(error) if index == failed_index else skipped,
                duration_ms=0,
                skipped=index != failed_index,
            )
            for index, step in enumerate(steps)
        ],
        outputs={},
        final=failure(error),
        total_duration_ms=(time.perf_counter() - start_time) * 1000,
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
