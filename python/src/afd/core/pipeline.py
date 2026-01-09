"""Pipeline types for chaining AFD commands.

Pipelines enable declarative composition of commands where the output of one
becomes the input of the next. Key features:
- Variable resolution ($prev, $first, $steps[n], $steps.alias)
- Conditional execution with when clauses
- Trust signal propagation (confidence, reasoning, sources)
- Error propagation with actionable suggestions

Example:
    >>> from afd.core.pipeline import PipelineRequest, PipelineStep
    >>>
    >>> request = PipelineRequest(
    ...     steps=[
    ...         PipelineStep(command="user-get", input={"id": 123}, as_="user"),
    ...         PipelineStep(command="order-list", input={"userId": "$prev.id"}),
    ...     ]
    ... )
"""

import re
import time
from enum import Enum
from typing import Any, Callable, Dict, Generic, List, Optional, TypeVar, Union

from pydantic import BaseModel, Field

from afd.core.metadata import Alternative, Source, Warning
from afd.core.result import CommandError, ResultMetadata

T = TypeVar("T")


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE REQUEST TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class PipelineStep(BaseModel):
    """A single step in a pipeline.

    Attributes:
        command: Command name to execute.
        input: Input for this step. Can reference outputs from previous steps
            using variables: $prev, $prev.field, $first, $steps[n], $steps.alias, $input
        as_: Optional alias for referencing this step's output (use as_ to avoid
            Python keyword collision with 'as').
        when: Condition for running this step. If the condition evaluates to
            false, the step is skipped.
        stream: Enable streaming for this step.

    Example:
        >>> step = PipelineStep(
        ...     command="order-list",
        ...     input={"userId": "$prev.id", "status": "active"},
        ...     as_="orders",
        ...     when={"$exists": "$prev.id"},
        ... )
    """

    command: str
    input: Optional[Dict[str, Any]] = None
    as_: Optional[str] = Field(default=None, alias="as")
    when: Optional["PipelineCondition"] = None
    stream: Optional[bool] = None

    model_config = {"populate_by_name": True}


class PipelineOptions(BaseModel):
    """Options for pipeline execution.

    Attributes:
        continue_on_failure: Continue on failure or stop immediately.
            False (default): Pipeline stops on first failure
            True: Continue executing, collect all errors
        timeout_ms: Timeout for entire pipeline in milliseconds.
        parallel: Execute steps in parallel where dependencies allow.
            Steps that don't reference $prev can potentially run in parallel.
    """

    continue_on_failure: bool = False
    timeout_ms: Optional[int] = None
    parallel: bool = False


class PipelineRequest(BaseModel):
    """Request to execute a pipeline of chained commands.

    Attributes:
        id: Unique identifier for the pipeline execution. Auto-generated if not provided.
        steps: Ordered list of pipeline steps to execute. Steps are executed
            sequentially unless parallel is enabled.
        options: Pipeline-level options.
        input: Optional input data available as $input in variable resolution.

    Example:
        >>> request = PipelineRequest(
        ...     id="my-pipeline",
        ...     steps=[
        ...         PipelineStep(command="user-get", input={"id": 123}, as_="user"),
        ...         PipelineStep(command="order-list", input={"userId": "$prev.id"}),
        ...     ],
        ...     options=PipelineOptions(timeout_ms=30000),
        ... )
    """

    id: Optional[str] = None
    steps: List[PipelineStep]
    options: Optional[PipelineOptions] = None
    input: Optional[Dict[str, Any]] = None


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE CONDITION TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class PipelineConditionExists(BaseModel):
    """Check if a field exists in the context."""

    exists: str = Field(alias="$exists")
    model_config = {"populate_by_name": True}


class PipelineConditionEq(BaseModel):
    """Check if a field equals a value."""

    eq: tuple[str, Any] = Field(alias="$eq")
    model_config = {"populate_by_name": True}


class PipelineConditionNe(BaseModel):
    """Check if a field does not equal a value."""

    ne: tuple[str, Any] = Field(alias="$ne")
    model_config = {"populate_by_name": True}


class PipelineConditionGt(BaseModel):
    """Check if a field is greater than a value."""

    gt: tuple[str, float] = Field(alias="$gt")
    model_config = {"populate_by_name": True}


class PipelineConditionGte(BaseModel):
    """Check if a field is greater than or equal to a value."""

    gte: tuple[str, float] = Field(alias="$gte")
    model_config = {"populate_by_name": True}


class PipelineConditionLt(BaseModel):
    """Check if a field is less than a value."""

    lt: tuple[str, float] = Field(alias="$lt")
    model_config = {"populate_by_name": True}


class PipelineConditionLte(BaseModel):
    """Check if a field is less than or equal to a value."""

    lte: tuple[str, float] = Field(alias="$lte")
    model_config = {"populate_by_name": True}


class PipelineConditionAnd(BaseModel):
    """Logical AND - all conditions must be true."""

    and_: List["PipelineCondition"] = Field(alias="$and")
    model_config = {"populate_by_name": True}


class PipelineConditionOr(BaseModel):
    """Logical OR - any condition must be true."""

    or_: List["PipelineCondition"] = Field(alias="$or")
    model_config = {"populate_by_name": True}


class PipelineConditionNot(BaseModel):
    """Logical NOT - negates a condition."""

    not_: "PipelineCondition" = Field(alias="$not")
    model_config = {"populate_by_name": True}


# Union type for all condition types
PipelineCondition = Union[
    PipelineConditionExists,
    PipelineConditionEq,
    PipelineConditionNe,
    PipelineConditionGt,
    PipelineConditionGte,
    PipelineConditionLt,
    PipelineConditionLte,
    PipelineConditionAnd,
    PipelineConditionOr,
    PipelineConditionNot,
    Dict[str, Any],
]


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE RESULT TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class StepStatus(str, Enum):
    """Possible statuses for a pipeline step."""

    SUCCESS = "success"
    FAILURE = "failure"
    SKIPPED = "skipped"


class StepConfidence(BaseModel):
    """Confidence information for a single step."""

    step: int
    alias: Optional[str] = None
    command: str
    confidence: float
    reasoning: Optional[str] = None


class StepReasoning(BaseModel):
    """Reasoning from a single step."""

    step_index: int
    command: str
    reasoning: str


class PipelineWarning(Warning):
    """Warning from a pipeline step."""

    step_index: int
    step_alias: Optional[str] = None


class PipelineSource(Source):
    """Source used by a pipeline step."""

    step_index: int


class PipelineAlternative(BaseModel, Generic[T]):
    """Alternative suggested by a pipeline step."""

    data: T
    reason: str
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    label: Optional[str] = None
    step_index: int


class StepResult(BaseModel):
    """Result of a single pipeline step."""

    index: int
    alias: Optional[str] = None
    command: str
    status: StepStatus
    data: Optional[Any] = None
    error: Optional[CommandError] = None
    execution_time_ms: float = 0
    metadata: Optional[ResultMetadata] = None


class PipelineMetadata(ResultMetadata):
    """Aggregated metadata from pipeline execution."""

    confidence: float = 1.0
    confidence_breakdown: List[StepConfidence] = Field(default_factory=list)
    reasoning_steps: List[StepReasoning] = Field(default_factory=list)
    pipeline_warnings: List[PipelineWarning] = Field(default_factory=list)
    pipeline_sources: List[PipelineSource] = Field(default_factory=list)
    pipeline_alternatives: List[PipelineAlternative[Any]] = Field(default_factory=list)
    completed_steps: int = 0
    total_steps: int = 0


class PipelineResult(BaseModel, Generic[T]):
    """Result of executing a pipeline."""

    data: Optional[T] = None
    metadata: PipelineMetadata
    steps: List[StepResult]


class PipelineContext(BaseModel):
    """Context available during pipeline execution."""

    pipeline_input: Optional[Dict[str, Any]] = None
    previous_result: Optional[StepResult] = None
    steps: List[StepResult] = Field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════════════
# TYPE GUARDS
# ═══════════════════════════════════════════════════════════════════════════════


def is_pipeline_request(value: Any) -> bool:
    """Type guard to check if a value is a PipelineRequest."""
    if isinstance(value, PipelineRequest):
        return True
    if isinstance(value, dict):
        if "steps" not in value:
            return False
        steps = value.get("steps")
        if not isinstance(steps, list):
            return False
        return all(is_pipeline_step(s) for s in steps)
    return False


def is_pipeline_step(value: Any) -> bool:
    """Type guard to check if a value is a PipelineStep."""
    if isinstance(value, PipelineStep):
        return True
    if isinstance(value, dict):
        return "command" in value and isinstance(value.get("command"), str)
    return False


def is_pipeline_result(value: Any) -> bool:
    """Type guard to check if a value is a PipelineResult."""
    if isinstance(value, PipelineResult):
        return True
    if isinstance(value, dict):
        return (
            "data" in value
            and "metadata" in value
            and "steps" in value
            and isinstance(value.get("steps"), list)
        )
    return False


def is_pipeline_condition(value: Any) -> bool:
    """Type guard to check if a value is a PipelineCondition."""
    if isinstance(
        value,
        (
            PipelineConditionExists,
            PipelineConditionEq,
            PipelineConditionNe,
            PipelineConditionGt,
            PipelineConditionGte,
            PipelineConditionLt,
            PipelineConditionLte,
            PipelineConditionAnd,
            PipelineConditionOr,
            PipelineConditionNot,
        ),
    ):
        return True
    if isinstance(value, dict):
        keys = list(value.keys())
        if len(keys) != 1:
            return False
        valid_keys = {
            "$exists",
            "$eq",
            "$ne",
            "$gt",
            "$gte",
            "$lt",
            "$lte",
            "$and",
            "$or",
            "$not",
        }
        return keys[0] in valid_keys
    return False


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════


def create_pipeline(
    steps: List[PipelineStep],
    options: Optional[PipelineOptions] = None,
    input: Optional[Dict[str, Any]] = None,
) -> PipelineRequest:
    """Create a PipelineRequest from an array of steps."""
    return PipelineRequest(steps=steps, options=options, input=input)


def get_nested_value(obj: Any, path: str) -> Any:
    """Get a nested value from an object using dot notation."""
    if obj is None:
        return None

    parts = path.split(".")
    current = obj

    for part in parts:
        if current is None:
            return None

        array_match = re.match(r"^(\w+)\[(\d+)\]$", part)
        if array_match:
            prop = array_match.group(1)
            index = int(array_match.group(2))
            if isinstance(current, dict):
                arr = current.get(prop)
            else:
                arr = getattr(current, prop, None)
            if not isinstance(arr, list) or index >= len(arr):
                return None
            current = arr[index]
        else:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                current = getattr(current, part, None)

    return current


def resolve_variable(ref: str, context: PipelineContext) -> Any:
    """Resolve a single variable reference to its value from pipeline context."""
    if not ref.startswith("$"):
        return ref

    if ref == "$prev":
        return context.previous_result.data if context.previous_result else None

    if ref == "$first":
        return context.steps[0].data if context.steps else None

    if ref == "$input":
        return context.pipeline_input

    if ref.startswith("$steps["):
        match = re.match(r"^\$steps\[(\d+)\]", ref)
        if match:
            index = int(match.group(1))
            if index < len(context.steps):
                step = context.steps[index]
                remaining = ref[len(match.group(0)) :]
                if remaining.startswith("."):
                    return get_nested_value(step.data, remaining[1:])
                return step.data
        return None

    if ref.startswith("$steps."):
        rest = ref[7:]
        dot_index = rest.find(".")
        alias = rest[:dot_index] if dot_index >= 0 else rest
        step = next((s for s in context.steps if s.alias == alias), None)
        if step:
            if dot_index >= 0:
                return get_nested_value(step.data, rest[dot_index + 1 :])
            return step.data
        return None

    if ref.startswith("$prev."):
        if context.previous_result:
            return get_nested_value(context.previous_result.data, ref[6:])
        return None

    if ref.startswith("$first."):
        if context.steps:
            return get_nested_value(context.steps[0].data, ref[7:])
        return None

    if ref.startswith("$input."):
        return get_nested_value(context.pipeline_input, ref[7:])

    return None


def resolve_variables(input: Any, context: PipelineContext) -> Any:
    """Resolve all variable references in an input object."""
    if isinstance(input, str) and input.startswith("$"):
        return resolve_variable(input, context)

    if isinstance(input, list):
        return [resolve_variables(item, context) for item in input]

    if isinstance(input, dict):
        return {key: resolve_variables(value, context) for key, value in input.items()}

    return input


def evaluate_condition(condition: PipelineCondition, context: PipelineContext) -> bool:
    """Evaluate a pipeline condition against the current context."""
    if isinstance(condition, PipelineConditionExists):
        value = resolve_variable(condition.exists, context)
        return value is not None

    if isinstance(condition, PipelineConditionEq):
        ref, expected = condition.eq
        value = resolve_variable(ref, context)
        return value == expected

    if isinstance(condition, PipelineConditionNe):
        ref, expected = condition.ne
        value = resolve_variable(ref, context)
        return value != expected

    if isinstance(condition, PipelineConditionGt):
        ref, threshold = condition.gt
        value = resolve_variable(ref, context)
        return isinstance(value, (int, float)) and value > threshold

    if isinstance(condition, PipelineConditionGte):
        ref, threshold = condition.gte
        value = resolve_variable(ref, context)
        return isinstance(value, (int, float)) and value >= threshold

    if isinstance(condition, PipelineConditionLt):
        ref, threshold = condition.lt
        value = resolve_variable(ref, context)
        return isinstance(value, (int, float)) and value < threshold

    if isinstance(condition, PipelineConditionLte):
        ref, threshold = condition.lte
        value = resolve_variable(ref, context)
        return isinstance(value, (int, float)) and value <= threshold

    if isinstance(condition, PipelineConditionAnd):
        return all(evaluate_condition(c, context) for c in condition.and_)

    if isinstance(condition, PipelineConditionOr):
        return any(evaluate_condition(c, context) for c in condition.or_)

    if isinstance(condition, PipelineConditionNot):
        return not evaluate_condition(condition.not_, context)

    # Handle raw dicts
    if isinstance(condition, dict):
        if "$exists" in condition:
            value = resolve_variable(condition["$exists"], context)
            return value is not None

        if "$eq" in condition:
            ref, expected = condition["$eq"]
            value = resolve_variable(ref, context)
            return value == expected

        if "$ne" in condition:
            ref, expected = condition["$ne"]
            value = resolve_variable(ref, context)
            return value != expected

        if "$gt" in condition:
            ref, threshold = condition["$gt"]
            value = resolve_variable(ref, context)
            return isinstance(value, (int, float)) and value > threshold

        if "$gte" in condition:
            ref, threshold = condition["$gte"]
            value = resolve_variable(ref, context)
            return isinstance(value, (int, float)) and value >= threshold

        if "$lt" in condition:
            ref, threshold = condition["$lt"]
            value = resolve_variable(ref, context)
            return isinstance(value, (int, float)) and value < threshold

        if "$lte" in condition:
            ref, threshold = condition["$lte"]
            value = resolve_variable(ref, context)
            return isinstance(value, (int, float)) and value <= threshold

        if "$and" in condition:
            return all(evaluate_condition(c, context) for c in condition["$and"])

        if "$or" in condition:
            return any(evaluate_condition(c, context) for c in condition["$or"])

        if "$not" in condition:
            return not evaluate_condition(condition["$not"], context)

    return False


# ═══════════════════════════════════════════════════════════════════════════════
# AGGREGATION HELPERS
# ═══════════════════════════════════════════════════════════════════════════════


def aggregate_pipeline_confidence(steps: List[StepResult]) -> float:
    """Calculate aggregated confidence from step results (weakest link)."""
    confidences = []
    for s in steps:
        if s.status == StepStatus.SUCCESS:
            if s.metadata and s.metadata.confidence is not None:
                confidences.append(s.metadata.confidence)
            else:
                confidences.append(1.0)

    return min(confidences) if confidences else 0.0


def aggregate_pipeline_reasoning(steps: List[StepResult]) -> List[StepReasoning]:
    """Aggregate reasoning from all steps."""
    result = []
    for s in steps:
        if s.status == StepStatus.SUCCESS and s.metadata and s.metadata.reasoning:
            result.append(
                StepReasoning(
                    step_index=s.index,
                    command=s.command,
                    reasoning=s.metadata.reasoning,
                )
            )
    return result


def aggregate_pipeline_warnings(steps: List[StepResult]) -> List[PipelineWarning]:
    """Aggregate warnings from all steps."""
    warnings: List[PipelineWarning] = []
    for step in steps:
        if step.metadata and step.metadata.warnings:
            for warning in step.metadata.warnings:
                warnings.append(
                    PipelineWarning(
                        code=warning.code,
                        message=warning.message,
                        severity=warning.severity,
                        details=warning.details,
                        step_index=step.index,
                        step_alias=step.alias,
                    )
                )
    return warnings


def aggregate_pipeline_sources(steps: List[StepResult]) -> List[PipelineSource]:
    """Aggregate sources from all steps."""
    sources: List[PipelineSource] = []
    for step in steps:
        if step.metadata and step.metadata.sources:
            for source in step.metadata.sources:
                sources.append(
                    PipelineSource(
                        type=source.type,
                        id=source.id,
                        title=source.title,
                        url=source.url,
                        location=source.location,
                        accessed_at=source.accessed_at,
                        relevance=source.relevance,
                        step_index=step.index,
                    )
                )
    return sources


def aggregate_pipeline_alternatives(
    steps: List[StepResult],
) -> List[PipelineAlternative[Any]]:
    """Aggregate alternatives from all steps."""
    alternatives: List[PipelineAlternative[Any]] = []
    for step in steps:
        if step.metadata and step.metadata.alternatives:
            for alt in step.metadata.alternatives:
                alternatives.append(
                    PipelineAlternative(
                        data=alt.data,
                        reason=alt.reason,
                        confidence=alt.confidence,
                        label=alt.label,
                        step_index=step.index,
                    )
                )
    return alternatives


def build_confidence_breakdown(
    steps: List[StepResult],
    step_defs: Optional[List[PipelineStep]] = None,
) -> List[StepConfidence]:
    """Build confidence breakdown from step results."""
    breakdown: List[StepConfidence] = []
    for s in steps:
        if s.status == StepStatus.SUCCESS:
            confidence = 1.0
            reasoning = None
            if s.metadata:
                # Access confidence from metadata extra fields or direct attribute
                conf = getattr(s.metadata, "confidence", None)
                if conf is not None:
                    confidence = conf
                elif s.metadata.model_extra and "confidence" in s.metadata.model_extra:
                    confidence = s.metadata.model_extra["confidence"]

                # Access reasoning from metadata extra fields
                reason = getattr(s.metadata, "reasoning", None)
                if reason is not None:
                    reasoning = reason
                elif s.metadata.model_extra and "reasoning" in s.metadata.model_extra:
                    reasoning = s.metadata.model_extra["reasoning"]

            alias = s.alias
            if not alias and step_defs and s.index < len(step_defs):
                alias = step_defs[s.index].as_

            breakdown.append(
                StepConfidence(
                    step=s.index,
                    alias=alias,
                    command=s.command,
                    confidence=confidence,
                    reasoning=reasoning,
                )
            )
    return breakdown


def build_pipeline_metadata(
    steps: List[StepResult],
    step_defs: Optional[List[PipelineStep]] = None,
    total_execution_time_ms: float = 0,
) -> PipelineMetadata:
    """Build complete pipeline metadata from step results."""
    completed = sum(1 for s in steps if s.status == StepStatus.SUCCESS)
    total = len(steps)

    return PipelineMetadata(
        confidence=aggregate_pipeline_confidence(steps),
        confidence_breakdown=build_confidence_breakdown(steps, step_defs),
        reasoning_steps=aggregate_pipeline_reasoning(steps),
        pipeline_warnings=aggregate_pipeline_warnings(steps),
        pipeline_sources=aggregate_pipeline_sources(steps),
        pipeline_alternatives=aggregate_pipeline_alternatives(steps),
        execution_time_ms=total_execution_time_ms,
        completed_steps=completed,
        total_steps=total,
    )


# Update forward references for recursive types
PipelineConditionAnd.model_rebuild()
PipelineConditionOr.model_rebuild()
PipelineConditionNot.model_rebuild()


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE EXECUTION
# ═══════════════════════════════════════════════════════════════════════════════


async def execute_pipeline(
    request: PipelineRequest,
    executor: Callable[[str, Dict[str, Any]], Any],
) -> PipelineResult[Any]:
    """Execute a pipeline of chained commands.

    This is a standalone function that executes a pipeline using the provided
    executor function. The executor should be an async function that takes
    a command name and input dict, and returns a CommandResult.

    Args:
        request: The pipeline request with steps and options.
        executor: Async function to execute individual commands.
            Signature: async def executor(command: str, input: dict) -> CommandResult

    Returns:
        The pipeline result with aggregated metadata.

    Example:
        >>> from afd.core.pipeline import execute_pipeline, PipelineRequest, PipelineStep
        >>> from afd.core.commands import create_command_registry
        >>>
        >>> registry = create_command_registry()
        >>> # ... register commands ...
        >>>
        >>> request = PipelineRequest(steps=[
        ...     PipelineStep(command="user-get", input={"id": 123}, as_="user"),
        ...     PipelineStep(command="order-list", input={"userId": "$prev.id"}),
        ... ])
        >>> result = await execute_pipeline(request, registry.execute)
    """
    step_results: List[StepResult] = []
    pipeline_context = PipelineContext(
        pipeline_input=request.input,
        previous_result=None,
        steps=[],
    )

    options = request.options
    continue_on_failure = options.continue_on_failure if options else False
    total_start_time = time.perf_counter()

    for i, step in enumerate(request.steps):
        step_start_time = time.perf_counter()

        # Check condition if present
        if step.when is not None:
            should_run = evaluate_condition(step.when, pipeline_context)
            if not should_run:
                step_result = StepResult(
                    index=i,
                    alias=step.as_,
                    command=step.command,
                    status=StepStatus.SKIPPED,
                    execution_time_ms=0,
                )
                step_results.append(step_result)
                pipeline_context.steps.append(step_result)
                continue

        # Resolve variable references in input
        resolved_input = (
            resolve_variables(step.input, pipeline_context) if step.input else {}
        )

        # Execute the command
        result = await executor(step.command, resolved_input)

        step_end_time = time.perf_counter()
        execution_time_ms = (step_end_time - step_start_time) * 1000

        if result.success:
            step_result = StepResult(
                index=i,
                alias=step.as_,
                command=step.command,
                status=StepStatus.SUCCESS,
                data=result.data,
                execution_time_ms=execution_time_ms,
                metadata=ResultMetadata(
                    confidence=result.confidence,
                    reasoning=result.reasoning,
                    sources=result.sources,
                    warnings=result.warnings,
                    alternatives=result.alternatives,
                    execution_time_ms=execution_time_ms,
                )
                if (
                    result.confidence is not None
                    or result.reasoning is not None
                    or result.sources is not None
                    or result.warnings is not None
                    or result.alternatives is not None
                )
                else None,
            )
        else:
            step_result = StepResult(
                index=i,
                alias=step.as_,
                command=step.command,
                status=StepStatus.FAILURE,
                error=result.error,
                execution_time_ms=execution_time_ms,
            )

        step_results.append(step_result)
        pipeline_context.steps.append(step_result)
        pipeline_context.previous_result = step_result

        # Stop on failure unless continue_on_failure is set
        if not result.success and not continue_on_failure:
            # Mark remaining steps as skipped
            for j in range(i + 1, len(request.steps)):
                remaining_step = request.steps[j]
                skipped_result = StepResult(
                    index=j,
                    alias=remaining_step.as_,
                    command=remaining_step.command,
                    status=StepStatus.SKIPPED,
                    execution_time_ms=0,
                )
                step_results.append(skipped_result)
            break

    total_end_time = time.perf_counter()
    total_execution_time_ms = (total_end_time - total_start_time) * 1000

    # Get the final data (from last successful step)
    final_data = None
    for step_result in reversed(step_results):
        if step_result.status == StepStatus.SUCCESS:
            final_data = step_result.data
            break

    # Build aggregated metadata
    metadata = build_pipeline_metadata(
        step_results,
        request.steps,
        total_execution_time_ms,
    )

    return PipelineResult(
        data=final_data,
        metadata=metadata,
        steps=step_results,
    )
