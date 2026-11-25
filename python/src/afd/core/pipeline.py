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

import asyncio
import logging
import math
import time
from collections.abc import Callable
from enum import Enum
from typing import Any, Generic, Optional, TypeVar

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    SerializationInfo,
    SerializerFunctionWrapHandler,
    StrictBool,
    ValidationInfo,
    field_serializer,
    field_validator,
    model_serializer,
)

from afd.core.errors import _omit_unset_cause
from afd.core.metadata import Alternative, Source, Warning
from afd.core.pipeline_variables import (
    ABSENT,
    MAX_INPUT_DEPTH,
    MAX_REFERENCE_LENGTH,  # noqa: F401 - re-exported
    MAX_RESOLVED_CHARS,  # noqa: F401 - re-exported
    MAX_RESOLVED_NODES,  # noqa: F401 - re-exported
    PipelineResolutionLimitError,
    VariableReference,
    exceeds_depth,
    get_nested_value,  # noqa: F401 - re-exported
    is_number,
    json_equals,
    pipeline_view,
    resolve_input,
    resolve_operand,
    resolve_string,
)
from afd.core.result import (
    CommandError,
    CommandResult,
    ResultMetadata,
    coerce_command_result,
    execution_failure,
    failure,
)
from afd.core.wire import (
    WIRE_MODEL_CONFIG,
    WireModel,
    json_number,
    keep_null_data,
    omitted_not_null,
)

logger = logging.getLogger("afd.core")

T = TypeVar("T")


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE REQUEST TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class PipelineStep(WireModel):
    """A single step in a pipeline.

    Attributes:
        command: Command name to execute. A blank name is rejected.
        input: Input for this step. Can reference outputs from previous steps
            using variables: $prev, $prev.field, $first, $steps[n], $steps.alias, $input
        as_: Optional alias for referencing this step's output (use as_ to avoid
            Python keyword collision with 'as').
        when: Condition for running this step. If the condition evaluates to
            false, the step is skipped.
        stream: Deprecated, not implemented. ``True`` is rejected with
            UNSUPPORTED_OPTION on this step before any step runs; ``False``
            is accepted.

    Example:
        >>> step = PipelineStep(
        ...     command="order-list",
        ...     input={"userId": "$prev.id", "status": "active"},
        ...     as_="orders",
        ...     when={"$exists": "$prev.id"},
        ... )
    """

    command: str
    input: dict[str, Any] | None = None
    as_: str | None = Field(default=None, alias="as")
    when: Optional["PipelineCondition"] = None
    stream: StrictBool | None = None

    @field_validator("command")
    @classmethod
    def _command_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("command must be a nonempty command name")
        return value

    @field_validator("input", "as_", "stream", mode="before")
    @classmethod
    def _not_null(cls, value: Any, info: ValidationInfo) -> Any:
        return omitted_not_null(value, info)

    @field_validator("when", mode="before")
    @classmethod
    def _check_when(cls, value: Any, info: ValidationInfo) -> Any:
        """Reject a malformed ``when`` with the exact problem, before any step runs."""
        if value is None:
            return omitted_not_null(value, info)
        problem = condition_error(value)
        if problem:
            raise ValueError(f"invalid when condition: {problem}")
        return value


class PipelineOptions(WireModel):
    """Options for pipeline execution.

    Attributes:
        continue_on_failure: Continue on failure or stop immediately.
            False (default): Pipeline stops on first failure
            True: Continue executing, collect all errors
        timeout_ms: Timeout for entire pipeline in milliseconds.
        parallel: Reserved for dependency-aware parallel execution. True is
            rejected with UNSUPPORTED_OPTION.

    The booleans accept only booleans, as in TypeScript.
    """

    continue_on_failure: StrictBool = False
    timeout_ms: int | float | None = Field(default=None, ge=0, allow_inf_nan=False)
    parallel: StrictBool = False

    model_config = ConfigDict(**WIRE_MODEL_CONFIG, extra="forbid")

    @field_validator("timeout_ms", mode="before")
    @classmethod
    def _timeout_is_a_number(cls, value: Any, info: ValidationInfo) -> Any:
        return json_number(value, info)


class PipelineRequest(WireModel):
    """Request to execute a pipeline of chained commands.

    Attributes:
        id: Unique identifier for the pipeline execution. Auto-generated if not provided.
        steps: Ordered list of pipeline steps to execute. Steps are executed
            sequentially unless parallel is enabled.
        options: Pipeline-level options.
        input: Optional input data, referenced as ``$input`` in step inputs and
            conditions. Nothing else (trace IDs, auth, host context) is
            reachable through ``$input``.

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

    id: str | None = None
    steps: list[PipelineStep]
    options: PipelineOptions | None = None
    input: dict[str, Any] | None = None

    @field_validator("id", "options", mode="before")
    @classmethod
    def _not_null(cls, value: Any, info: ValidationInfo) -> Any:
        return omitted_not_null(value, info)


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE CONDITION TYPES
# ═══════════════════════════════════════════════════════════════════════════════


# A condition object has exactly one operator key; any other key is an error.
_CONDITION_CONFIG = ConfigDict(populate_by_name=True, extra="forbid")


class PipelineConditionExists(BaseModel):
    """Check if a field exists in the context."""

    exists: str = Field(alias="$exists")
    model_config = _CONDITION_CONFIG


class PipelineConditionEq(BaseModel):
    """Check if a field equals a value."""

    eq: tuple[str, Any] = Field(alias="$eq")
    model_config = _CONDITION_CONFIG


class PipelineConditionNe(BaseModel):
    """Check if a field does not equal a value."""

    ne: tuple[str, Any] = Field(alias="$ne")
    model_config = _CONDITION_CONFIG


class PipelineConditionGt(BaseModel):
    """Check if a field is greater than a value."""

    gt: tuple[str, float] = Field(alias="$gt")
    model_config = _CONDITION_CONFIG


class PipelineConditionGte(BaseModel):
    """Check if a field is greater than or equal to a value."""

    gte: tuple[str, float] = Field(alias="$gte")
    model_config = _CONDITION_CONFIG


class PipelineConditionLt(BaseModel):
    """Check if a field is less than a value."""

    lt: tuple[str, float] = Field(alias="$lt")
    model_config = _CONDITION_CONFIG


class PipelineConditionLte(BaseModel):
    """Check if a field is less than or equal to a value."""

    lte: tuple[str, float] = Field(alias="$lte")
    model_config = _CONDITION_CONFIG


class PipelineConditionAnd(BaseModel):
    """Logical AND - all conditions must be true."""

    and_: list["PipelineCondition"] = Field(alias="$and")
    model_config = _CONDITION_CONFIG


class PipelineConditionOr(BaseModel):
    """Logical OR - any condition must be true."""

    or_: list["PipelineCondition"] = Field(alias="$or")
    model_config = _CONDITION_CONFIG


class PipelineConditionNot(BaseModel):
    """Logical NOT - negates a condition."""

    not_: "PipelineCondition" = Field(alias="$not")
    model_config = _CONDITION_CONFIG


# Union type for all condition types. There is no catch-all branch: a
# PipelineStep rejects a malformed or unknown operator (``$exist``) when it is
# validated, so no step of a pipeline with a bad condition ever runs.
PipelineCondition = (
    PipelineConditionExists
    | PipelineConditionEq
    | PipelineConditionNe
    | PipelineConditionGt
    | PipelineConditionGte
    | PipelineConditionLt
    | PipelineConditionLte
    | PipelineConditionAnd
    | PipelineConditionOr
    | PipelineConditionNot
)


# ═══════════════════════════════════════════════════════════════════════════════
# PIPELINE RESULT TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class StepStatus(str, Enum):  # noqa: UP042
    """Possible statuses for a pipeline step."""

    SUCCESS = "success"
    FAILURE = "failure"
    SKIPPED = "skipped"


class StepConfidence(WireModel):
    """Confidence information for a single step."""

    step: int
    alias: str | None = None
    command: str
    confidence: float
    reasoning: str | None = None


class StepReasoning(WireModel):
    """Reasoning from a single step."""

    step_index: int
    command: str
    reasoning: str


class PipelineWarning(Warning):
    """Warning from a pipeline step."""

    step_index: int
    step_alias: str | None = None


class PipelineSource(Source):
    """Source used by a pipeline step."""

    step_index: int


class PipelineAlternative(WireModel, Generic[T]):
    """Alternative suggested by a pipeline step."""

    data: T
    reason: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    label: str | None = None
    step_index: int


class StepResult(WireModel):
    """Result of a single pipeline step."""

    index: int
    alias: str | None = None
    command: str
    status: StepStatus
    data: Any | None = None
    error: CommandError | None = None
    execution_time_ms: float = 0
    metadata: ResultMetadata | None = None

    @field_serializer("error", mode="wrap")
    def _serialize_error(
        self, value: CommandError | None, handler: SerializerFunctionWrapHandler
    ) -> Any:
        return _omit_unset_cause(handler(value))

    @model_serializer(mode="wrap")
    def _serialize_null_data(
        self, handler: SerializerFunctionWrapHandler, info: SerializationInfo
    ) -> Any:
        return keep_null_data(self, handler, info)


class PipelineMetadata(ResultMetadata):
    """Aggregated metadata from pipeline execution.

    On the wire the aggregated lists are named ``reasoning``, ``warnings``,
    ``sources`` and ``alternatives``, as in TypeScript. In Python they are
    ``reasoning_steps``, ``pipeline_warnings``, ``pipeline_sources`` and
    ``pipeline_alternatives``; either name is accepted when parsing.
    """

    confidence: float = 1.0
    confidence_breakdown: list[StepConfidence] = Field(default_factory=list)
    reasoning_steps: list[StepReasoning] = Field(default_factory=list, alias="reasoning")
    pipeline_warnings: list[PipelineWarning] = Field(default_factory=list, alias="warnings")
    pipeline_sources: list[PipelineSource] = Field(default_factory=list, alias="sources")
    pipeline_alternatives: list[PipelineAlternative[Any]] = Field(
        default_factory=list, alias="alternatives"
    )
    completed_steps: int = 0
    total_steps: int = 0


class PipelineResult(WireModel, Generic[T]):
    """Result of executing a pipeline."""

    data: T | None = None
    metadata: PipelineMetadata
    steps: list[StepResult]

    @model_serializer(mode="wrap")
    def _serialize_null_data(
        self, handler: SerializerFunctionWrapHandler, info: SerializationInfo
    ) -> Any:
        return keep_null_data(self, handler, info)


class PipelineContext(WireModel):
    """Context available during pipeline execution.

    Attributes:
        pipeline_input: The pipeline request's ``input`` (``$input``).
        previous_result: The most recent successful step (``$prev``).
        steps: Results of the steps run or skipped so far, by index.
    """

    pipeline_input: dict[str, Any] | None = None
    previous_result: StepResult | None = None
    steps: list[StepResult] = Field(default_factory=list)

    # JSON views of step data, keyed by id(step): (step, view).
    _views: dict[int, tuple[Any, Any]] = PrivateAttr(default_factory=dict)


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
    steps: list[PipelineStep],
    options: PipelineOptions | None = None,
    input: dict[str, Any] | None = None,
) -> PipelineRequest:
    """Create a PipelineRequest from an array of steps."""
    return PipelineRequest(steps=steps, options=options, input=input)


# Variable resolution follows spec/pipeline-variables.md; the grammar and the
# JSON-only traversal live in afd.core.pipeline_variables.


def step_data(result: CommandResult[Any]) -> dict[str, Any]:
    """The ``data`` keyword of a successful step built from ``result``: ``None`` set explicitly
    when the result's data was set to ``None``, nothing when the result has no data, so a
    reference reads the first as ``null`` and the second as absent."""
    return {"data": result.data} if "data" in result.model_fields_set else {}


def _step_view(step: StepResult | None, context: PipelineContext) -> Any:
    """JSON view of a successful step's data, or ABSENT for any other step."""
    # A successful step's data is `null` when it was set to None, and absent only when it was
    # never set, as in TypeScript, where `data: null` and `data: undefined` differ (#1961).
    if step is None or step.status != StepStatus.SUCCESS or "data" not in step.model_fields_set:
        return ABSENT
    cached = context._views.get(id(step))
    if cached is not None and cached[0] is step:
        return cached[1]
    view = pipeline_view(step.data)
    context._views[id(step)] = (step, view)
    return view


def _lookup_root(reference: VariableReference, context: PipelineContext) -> Any:
    """Return the JSON view of the data a reference starts from, or ABSENT."""
    if reference.root == "prev":
        return _step_view(context.previous_result, context)
    if reference.root == "first":
        return _step_view(context.steps[0] if context.steps else None, context)
    if reference.root == "input":
        if context.pipeline_input is None:
            return ABSENT
        return pipeline_view(context.pipeline_input)
    if reference.index is not None:
        if reference.index < len(context.steps):
            return _step_view(context.steps[reference.index], context)
        return ABSENT
    alias = reference.alias
    if alias is None or alias.startswith("__"):
        return ABSENT
    step = next((s for s in context.steps if s.alias == alias), None)
    return _step_view(step, context)


def resolve_variable(ref: str, context: PipelineContext) -> Any:
    """Resolve a single string from a step input or condition.

    Strings that are not references (``"$9.99"``, ``"$HOME"``, ``"text"``) are
    returned unchanged, and ``"$$x"`` returns the literal ``"$x"``.

    Returns:
        The resolved value, the literal, or None when the reference cannot be
        resolved.
    """
    value = resolve_string(ref, lambda reference: _lookup_root(reference, context))
    return None if value is ABSENT else value


def resolve_variables(input: Any, context: PipelineContext) -> Any:
    """Resolve every variable reference in a step input.

    Unresolved references are omitted from objects and become None in lists.
    Referenced values are copies.

    Raises:
        PipelineResolutionLimitError: If the input, or a value copied into it,
            is nested deeper than MAX_INPUT_DEPTH levels, or repeated expansion
            exceeds the budget (``spec/pipeline-variables.md``, Limits). It is
            a ValueError.
    """
    # One view of $input per step input, so repeated references to it are
    # recognized as repeats.
    input_view: list[Any] = []

    def lookup(reference: VariableReference) -> Any:
        if reference.root != "input":
            return _lookup_root(reference, context)
        if not input_view:
            input_view.append(_lookup_root(reference, context))
        return input_view[0]

    value = resolve_input(input, lookup)
    return None if value is ABSENT else value


_CONDITION_FIELDS: dict[type, tuple[str, str]] = {
    PipelineConditionExists: ("$exists", "exists"),
    PipelineConditionEq: ("$eq", "eq"),
    PipelineConditionNe: ("$ne", "ne"),
    PipelineConditionGt: ("$gt", "gt"),
    PipelineConditionGte: ("$gte", "gte"),
    PipelineConditionLt: ("$lt", "lt"),
    PipelineConditionLte: ("$lte", "lte"),
    PipelineConditionAnd: ("$and", "and_"),
    PipelineConditionOr: ("$or", "or_"),
    PipelineConditionNot: ("$not", "not_"),
}

_COMPARISONS: dict[str, Callable[[Any, Any], bool]] = {
    "$gt": lambda value, threshold: value > threshold,
    "$gte": lambda value, threshold: value >= threshold,
    "$lt": lambda value, threshold: value < threshold,
    "$lte": lambda value, threshold: value <= threshold,
}


def _condition_parts(condition: Any) -> tuple[str, Any] | None:
    """Return a condition's (operator, operand), for models and raw dicts."""
    fields = _CONDITION_FIELDS.get(type(condition))
    if fields is not None:
        return fields[0], getattr(condition, fields[1])
    if isinstance(condition, dict) and len(condition) == 1:
        ((operator, operand),) = condition.items()
        return operator, operand
    return None


def _is_ref_pair(operand: Any) -> bool:
    return isinstance(operand, (list, tuple)) and len(operand) == 2 and isinstance(operand[0], str)


def condition_error(condition: Any, depth: int = 1) -> str | None:
    """Describe why a ``when`` condition is malformed, or return None if it is valid."""
    if depth > MAX_INPUT_DEPTH:
        return f"conditions are nested deeper than {MAX_INPUT_DEPTH} levels"
    parts = _condition_parts(condition)
    if parts is None:
        return "a condition is an object with exactly one operator"
    operator, operand = parts
    if operator == "$exists":
        return None if isinstance(operand, str) else "$exists takes a reference string"
    if operator in ("$eq", "$ne"):
        return None if _is_ref_pair(operand) else f"{operator} takes [reference, value]"
    if operator in _COMPARISONS:
        if _is_ref_pair(operand) and is_number(operand[1]) and math.isfinite(operand[1]):
            return None
        return f"{operator} takes [reference, finite number]"
    if operator in ("$and", "$or"):
        if not isinstance(operand, (list, tuple)):
            return f"{operator} takes a list of conditions"
        for item in operand:
            problem = condition_error(item, depth + 1)
            if problem:
                return problem
        return None
    if operator == "$not":
        return condition_error(operand, depth + 1)
    return f"unknown operator {operator!r}"


def evaluate_condition(condition: PipelineCondition, context: PipelineContext) -> bool:
    """Evaluate a pipeline condition against the current context.

    The first operand of every comparison is a reference. A string that is not
    a reference (``"$$prev"``, ``"text"``) or a reference that cannot be
    resolved is absent: ``$exists`` is False and every comparison with an
    absent operand is False. Malformed conditions are False.
    """
    parts = _condition_parts(condition)
    if parts is None:
        return False
    operator, operand = parts

    def lookup(reference: VariableReference) -> Any:
        return _lookup_root(reference, context)

    if operator == "$exists":
        value = resolve_operand(operand, lookup)
        return value is not ABSENT and value is not None

    if operator in ("$eq", "$ne") or operator in _COMPARISONS:
        if not _is_ref_pair(operand):
            return False
        value = resolve_operand(operand[0], lookup)
        if value is ABSENT:
            return False
        expected = operand[1]
        if operator == "$eq":
            return json_equals(value, expected)
        if operator == "$ne":
            return not json_equals(value, expected)
        return is_number(value) and is_number(expected) and _COMPARISONS[operator](value, expected)

    if operator in ("$and", "$or"):
        if not isinstance(operand, (list, tuple)):
            return False
        results = (evaluate_condition(item, context) for item in operand)
        return all(results) if operator == "$and" else any(results)

    if operator == "$not":
        return not evaluate_condition(operand, context)

    return False


def _input_too_deep_error() -> CommandError:
    return CommandError(
        code="VALIDATION_ERROR",
        message=f"Pipeline input is nested deeper than {MAX_INPUT_DEPTH} levels",
        suggestion=f"Reduce the nesting of the pipeline input to at most {MAX_INPUT_DEPTH} levels",
        retryable=False,
        details={"maxDepth": MAX_INPUT_DEPTH},
    )


def resolution_limit_failure(
    error: PipelineResolutionLimitError, step_index: int
) -> CommandResult[Any]:
    """The failed result of a step whose resolved input exceeded the limits."""
    return failure(
        CommandError(
            code="VALIDATION_ERROR",
            message=str(error),
            suggestion=(
                "Reduce pipeline input size, repeated reference fan-out, or nesting depth "
                "so the resolved step input stays within the limits"
            ),
            retryable=False,
            details={"stepIndex": step_index, "limit": error.limit},
        )
    )


def validate_pipeline_request(request: PipelineRequest) -> CommandError | None:
    """Check limits and conditions before any step runs.

    Returns:
        A VALIDATION_ERROR CommandError, or None when the request is valid.
    """
    if request.input is not None and exceeds_depth(request.input):
        return _input_too_deep_error()
    for index, step in enumerate(request.steps):
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
        if step.when is not None:
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


def create_pipeline_failure(error: CommandError) -> "PipelineResult[Any]":
    """A PipelineResult for a request rejected before any step ran.

    It has the shape of the TypeScript server's invalid-request result: one
    failed pseudo-step with index -1 that carries the error.
    """
    return PipelineResult(
        metadata=PipelineMetadata(confidence=0, execution_time_ms=0),
        steps=[
            StepResult(
                index=-1,
                command="",
                status=StepStatus.FAILURE,
                error=error,
                execution_time_ms=0,
            )
        ],
    )


# ═══════════════════════════════════════════════════════════════════════════════
# AGGREGATION HELPERS
# ═══════════════════════════════════════════════════════════════════════════════


def _step_meta(step: StepResult, key: str) -> Any:
    """Read a trust signal (confidence, reasoning, ...) from a step's metadata."""
    if step.metadata is None:
        return None
    extra = step.metadata.model_extra or {}
    if key in extra:
        return extra[key]
    if key in type(step.metadata).model_fields:
        return getattr(step.metadata, key)
    return None


def aggregate_pipeline_confidence(steps: list[StepResult]) -> float:
    """Calculate aggregated confidence from step results (weakest link)."""
    confidences = []
    for s in steps:
        if s.status == StepStatus.SUCCESS:
            confidence = _step_meta(s, "confidence")
            confidences.append(confidence if confidence is not None else 1.0)

    return min(confidences) if confidences else 0.0


def aggregate_pipeline_reasoning(steps: list[StepResult]) -> list[StepReasoning]:
    """Aggregate reasoning from all steps."""
    result = []
    for s in steps:
        reasoning = _step_meta(s, "reasoning")
        if s.status == StepStatus.SUCCESS and reasoning:
            result.append(
                StepReasoning(
                    step_index=s.index,
                    command=s.command,
                    reasoning=reasoning,
                )
            )
    return result


def aggregate_pipeline_warnings(steps: list[StepResult]) -> list[PipelineWarning]:
    """Aggregate warnings from all steps."""
    warnings: list[PipelineWarning] = []
    for step in steps:
        for raw in _step_meta(step, "warnings") or []:
            warning = raw if isinstance(raw, Warning) else Warning.model_validate(raw)
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


def aggregate_pipeline_sources(steps: list[StepResult]) -> list[PipelineSource]:
    """Aggregate sources from all steps."""
    sources: list[PipelineSource] = []
    for step in steps:
        for raw in _step_meta(step, "sources") or []:
            source = raw if isinstance(raw, Source) else Source.model_validate(raw)
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
    steps: list[StepResult],
) -> list[PipelineAlternative[Any]]:
    """Aggregate alternatives from all steps."""
    alternatives: list[PipelineAlternative[Any]] = []
    for step in steps:
        for raw in _step_meta(step, "alternatives") or []:
            alt = raw if isinstance(raw, Alternative) else Alternative[Any].model_validate(raw)
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
    steps: list[StepResult],
    step_defs: list[PipelineStep] | None = None,
) -> list[StepConfidence]:
    """Build confidence breakdown from step results."""
    breakdown: list[StepConfidence] = []
    for s in steps:
        if s.status == StepStatus.SUCCESS:
            conf = _step_meta(s, "confidence")
            confidence = conf if conf is not None else 1.0
            reasoning = _step_meta(s, "reasoning")

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
    steps: list[StepResult],
    step_defs: list[PipelineStep] | None = None,
    total_execution_time_ms: float = 0,
) -> PipelineMetadata:
    """Build complete pipeline metadata from step results."""
    completed = sum(1 for s in steps if s.status == StepStatus.SUCCESS)
    total = len(steps)

    return PipelineMetadata(
        confidence=aggregate_pipeline_confidence(steps),
        confidence_breakdown=build_confidence_breakdown(steps, step_defs),
        reasoning=aggregate_pipeline_reasoning(steps),
        warnings=aggregate_pipeline_warnings(steps),
        sources=aggregate_pipeline_sources(steps),
        alternatives=aggregate_pipeline_alternatives(steps),
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


def _stream_unsupported_error(index: int) -> CommandError:
    """The ``UNSUPPORTED_OPTION`` error for step ``index``, which sets ``stream: true``."""
    return CommandError(
        code="UNSUPPORTED_OPTION",
        message=f"Streaming pipeline steps are not supported (step {index} sets stream: true)",
        suggestion=(
            "Remove stream or set it to false; to stream one command, "
            "use the /stream endpoint or McpClient.stream()"
        ),
    )


def _unsupported_option(request: PipelineRequest) -> tuple[int, CommandError] | None:
    """An option the request sets that the executor does not implement.

    Returns the index of the step to blame and the ``UNSUPPORTED_OPTION``
    error: step 0 for ``options.parallel``, otherwise the first step with
    ``stream: true``. None when the request uses neither. Mirrors the
    TypeScript ``executePipeline()``.
    """
    if request.options and request.options.parallel:
        return 0, CommandError(
            code="UNSUPPORTED_OPTION",
            message="Parallel pipeline execution is not supported",
            suggestion="Remove parallel or set it to false to execute steps sequentially",
        )
    for index, step in enumerate(request.steps):
        if step.stream is True:
            return index, _stream_unsupported_error(index)
    return None


async def _call_step(
    executor: Callable[..., Any],
    command: str,
    payload: Any,
    context: Any,
    dev_mode: bool,
    *,
    deadline_event: asyncio.Event | None = None,
) -> Any:
    """Run one step. An exception from the executor becomes a failed result
    whose message is redacted unless ``dev_mode`` is set."""
    from collections.abc import Mapping

    from afd.core.command_execution import (
        clone_context_with,
        copy_extra,
        deadline_signal_updates,
        invoke_executor,
    )
    from afd.core.commands import CommandContext as CoreCommandContext

    per_step: Any
    if context is not None:
        import copy as _copy

        extra_src = getattr(context, "extra", None)
        actor = getattr(context, "actor", None)
        updates: dict[str, Any] = {
            "extra": copy_extra(extra_src) if isinstance(extra_src, Mapping) else {},
            "actor": _copy.copy(actor) if actor is not None else None,
            "output_budget": None,
        }
        if deadline_event is not None:
            updates.update(deadline_signal_updates(context, deadline_event))
        per_step = clone_context_with(context, **updates)
    else:
        per_step = CoreCommandContext()
        if deadline_event is not None:
            per_step = clone_context_with(
                per_step, **deadline_signal_updates(per_step, deadline_event)
            )

    try:
        return await invoke_executor(executor, command, payload, per_step)
    except Exception as exc:
        logger.error("Pipeline step '%s' raised an unhandled exception", command, exc_info=exc)
        return execution_failure(exc, dev_mode)


async def execute_pipeline(
    request: PipelineRequest,
    executor: Callable[..., Any],
    context: Any = None,
    *,
    dev_mode: bool = False,
    _when_overrides: dict[int, Callable[[PipelineContext], bool]] | None = None,
    _raw_results: dict[int, CommandResult[Any]] | None = None,
    _preserve_none_input: bool = False,
) -> PipelineResult[Any]:
    """Execute a pipeline of chained commands.

    This is a standalone function that executes a pipeline using the provided
    executor function. The executor should be an async function that takes
    ``(command, input)`` or ``(command, input, context)`` and returns a
    CommandResult.

    Options the request accepts but the executor does not implement,
    ``options.parallel`` and a step's ``stream: true``, fail that step (step 0
    for ``parallel``) with UNSUPPORTED_OPTION and skip every other step, so no
    command runs.

    An exception the executor raises fails its step with
    COMMAND_EXECUTION_ERROR and the generic message "An internal error
    occurred"; the exception is logged to the ``afd.core`` logger.

    Args:
        request: The pipeline request with steps and options.
        executor: Async function to execute individual commands.
            Signature: ``async def executor(command, input[, context]) -> CommandResult``
        context: Optional CommandContext passed to three-argument executors per step
            (never exposed to ``$input`` variable resolution).
        dev_mode: Put the exception text in a raising step's error message
            instead of the generic one.

    Returns:
        The pipeline result with aggregated metadata.
    """
    invalid = validate_pipeline_request(request)
    if invalid is not None:
        return create_pipeline_failure(invalid)

    step_results: list[StepResult] = []
    pipeline_context = PipelineContext(
        pipeline_input=request.input,
        previous_result=None,
        steps=[],
    )

    options = request.options
    continue_on_failure = options.continue_on_failure if options else False
    total_start_time = time.perf_counter()

    unsupported = _unsupported_option(request) if request.steps else None
    if unsupported is not None:
        # Blame one step and skip the rest, so no command runs.
        failed_index, unsupported_error = unsupported
        for i, step in enumerate(request.steps):
            step_results.append(
                StepResult(
                    index=i,
                    alias=step.as_,
                    command=step.command,
                    status=StepStatus.FAILURE if i == failed_index else StepStatus.SKIPPED,
                    error=unsupported_error if i == failed_index else None,
                    execution_time_ms=0,
                )
            )
        return PipelineResult(
            metadata=build_pipeline_metadata(step_results, request.steps, 0),
            steps=step_results,
        )

    from afd.core.command_execution import (
        _caller_cancelled,
        _cancel_timed_out,
        _link_deadline_signal,
    )

    pipeline_deadline_event: asyncio.Event | None = None
    pipeline_watcher: asyncio.Task[None] | None = None
    if options and options.timeout_ms is not None:
        pipeline_deadline_event, pipeline_watcher = _link_deadline_signal(context)

    try:
        for i, step in enumerate(request.steps):
            if _caller_cancelled(context):
                cancelled_error = CommandError(
                    code="COMMAND_CANCELLED",
                    message="Command cancelled before starting",
                    suggestion="Start the command again if the result is still needed",
                    retryable=False,
                )
                for j, remaining_step in enumerate(request.steps[i:], i):
                    step_results.append(
                        StepResult(
                            index=j,
                            alias=remaining_step.as_,
                            command=remaining_step.command,
                            status=StepStatus.SKIPPED,
                            error=cancelled_error,
                            execution_time_ms=0,
                        )
                    )
                break

            step_start_time = time.perf_counter()

            # Check condition if present (including DirectClient.pipe string references)
            override_when = _when_overrides.get(i) if _when_overrides else None
            if override_when is not None:
                should_run = override_when(pipeline_context)
            elif step.when is not None:
                should_run = evaluate_condition(step.when, pipeline_context)
            else:
                should_run = True

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

            # Resolve variable references in input. A step input over the limits
            # fails the step without running the command.
            resolution_failure: CommandResult[Any] | None = None
            resolved_input: Any = None if (_preserve_none_input and step.input is None) else {}
            try:
                if step.input is not None:
                    resolved_input = resolve_variables(step.input, pipeline_context)
            except PipelineResolutionLimitError as exc:
                resolution_failure = resolution_limit_failure(exc, i)

            # Execute the command. _call_step never raises (except on cancellation),
            # so a TimeoutError here is always the pipeline deadline, never one
            # the command raised itself.
            try:
                if resolution_failure is not None:
                    raw_result = resolution_failure
                elif options and options.timeout_ms is not None:
                    elapsed_ms = (time.perf_counter() - total_start_time) * 1000
                    remaining_s = (options.timeout_ms - elapsed_ms) / 1000
                    if remaining_s <= 0:
                        if pipeline_deadline_event is not None:
                            pipeline_deadline_event.set()
                        raise TimeoutError
                    step_task: asyncio.Task[Any] = asyncio.create_task(
                        _call_step(
                            executor,
                            step.command,
                            resolved_input,
                            context,
                            dev_mode,
                            deadline_event=pipeline_deadline_event,
                        )
                    )
                    try:
                        done, _ = await asyncio.wait({step_task}, timeout=remaining_s)
                        if step_task not in done:
                            if pipeline_deadline_event is not None:
                                pipeline_deadline_event.set()
                            await _cancel_timed_out([step_task])
                            raise TimeoutError
                        if step_task.cancelled():
                            raise asyncio.CancelledError
                        raw_result = step_task.result()
                    except asyncio.CancelledError:
                        if pipeline_deadline_event is not None:
                            pipeline_deadline_event.set()
                        if not step_task.done():
                            step_task.cancel()
                            await asyncio.gather(step_task, return_exceptions=True)
                        raise
                else:
                    raw_result = await _call_step(
                        executor, step.command, resolved_input, context, dev_mode
                    )
            except TimeoutError:
                timeout_error = CommandError(
                    code="PIPELINE_TIMEOUT",
                    message=f"Pipeline timeout exceeded ({options.timeout_ms if options else 0}ms)",
                    suggestion="Increase timeout_ms or reduce the number of pipeline steps",
                    retryable=True,
                )
                step_results.append(
                    StepResult(
                        index=i,
                        alias=step.as_,
                        command=step.command,
                        status=StepStatus.FAILURE,
                        error=timeout_error,
                        execution_time_ms=(time.perf_counter() - step_start_time) * 1000,
                    )
                )
                for j, remaining_step in enumerate(request.steps[i + 1 :], i + 1):
                    step_results.append(
                        StepResult(
                            index=j,
                            alias=remaining_step.as_,
                            command=remaining_step.command,
                            status=StepStatus.SKIPPED,
                            error=timeout_error,
                            execution_time_ms=0,
                        )
                    )
                break

            # The command has run: from here on nothing may raise. A handler that
            # returned a plain dict (or anything else) becomes a failed step.
            result = coerce_command_result(raw_result, step.command)
            if _raw_results is not None:
                _raw_results[i] = result

            step_end_time = time.perf_counter()
            execution_time_ms = (step_end_time - step_start_time) * 1000

            if result.success:
                # Step metadata carries the result's trust signals, as in TypeScript.
                step_metadata: dict[str, Any] = {
                    key: value
                    for key, value in (
                        ("confidence", result.confidence),
                        ("reasoning", result.reasoning),
                        ("warnings", result.warnings),
                        ("sources", result.sources),
                        ("alternatives", result.alternatives),
                    )
                    if value is not None
                }
                step_result = StepResult(
                    index=i,
                    alias=step.as_,
                    command=step.command,
                    status=StepStatus.SUCCESS,
                    execution_time_ms=execution_time_ms,
                    metadata=ResultMetadata(**step_metadata),
                    **step_data(result),
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
            if step_result.status == StepStatus.SUCCESS:
                # $prev is the data of the most recent successful step.
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
    finally:
        if pipeline_watcher is not None and not pipeline_watcher.done():
            pipeline_watcher.cancel()

    total_end_time = time.perf_counter()
    total_execution_time_ms = (total_end_time - total_start_time) * 1000

    # The final data is the last successful step's: `null` when that step's data was set to
    # None, and left unset when it has none, as TypeScript's `lastSuccessfulStep?.data` (#2073).
    final_data: dict[str, Any] = {}
    for step_result in reversed(step_results):
        if step_result.status == StepStatus.SUCCESS:
            if "data" in step_result.model_fields_set:
                final_data = {"data": step_result.data}
            break

    # Build aggregated metadata
    metadata = build_pipeline_metadata(
        step_results,
        request.steps,
        total_execution_time_ms,
    )

    return PipelineResult(
        metadata=metadata,
        **final_data,
        steps=step_results,
    )
