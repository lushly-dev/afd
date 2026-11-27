"""Error types and factory functions for AFD commands.

Errors should be actionable - they tell the user what went wrong
AND what they can do about it.

Example:
    >>> from afd.core.errors import not_found_error, validation_error
    >>>
    >>> # Specific error factories
    >>> err = not_found_error("Document", "doc-123")
    >>> err.code
    'NOT_FOUND'
    >>>
    >>> # Generic error creation
    >>> err = create_error("CUSTOM_ERROR", "Something went wrong")
"""

import math
from dataclasses import dataclass
from typing import Any, Literal, Union

from pydantic import (
    StrictBool,
    StrictStr,
    ValidationError,
    field_validator,
    model_validator,
)

from afd.core.wire import WIRE_MODEL_CONFIG, WireModel

RecoveryKind = Literal["call", "fix-input", "retry", "external", "stop"]
RECOVERY_KINDS: tuple[str, ...] = ("call", "fix-input", "retry", "external", "stop")
"""The kinds of :class:`Recovery`, in ``spec/recovery.md`` order."""

_RECOVERY_WIRE_MEMBERS = frozenset({"kind", "command", "input", "needs", "thenRetry", "afterMs"})
MAX_AFTER_MS = 2**53 - 1
"""The largest ``afterMs``: the largest integer every language reads exactly."""


class Recovery(WireModel):
    """The step a failed command's ``suggestion`` describes, structured (``spec/recovery.md``).

    It sits beside the prose ``suggestion``, never in its place: agents read the prose, and tools
    and tests read this.

    Kinds:
        call: call ``command`` next; with ``then_retry``, repeat the failed call once it succeeds.
        fix-input: call the same command again with ``input``'s values, choosing ``needs``.
        retry: call the same command again unchanged, after ``after_ms``; the error is retryable.
        external: a step outside the command surface, described only in the suggestion.
        stop: no step makes the call succeed; do something else.

    A recovery built in Python that breaks the specification's rules raises ``ValueError``; one
    read from the wire that breaks them is read as none (``CommandError.recovery``, rule 7).

    Example:
        >>> Recovery(kind="call", command="issue-check").kind
        'call'
    """

    model_config = {**WIRE_MODEL_CONFIG, "extra": "forbid"}

    kind: RecoveryKind
    command: StrictStr | None = None
    input: dict[str, Any] | None = None
    needs: list[StrictStr] | None = None
    then_retry: StrictBool | None = None
    after_ms: int | None = None

    @field_validator("after_ms", mode="before")
    @classmethod
    def _whole_number(cls, value: Any) -> Any:
        """A JSON integer, or a number with a zero fraction such as ``30000.0``; never a
        boolean or a string, which Python would otherwise coerce."""
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("afterMs is an integer")
        if isinstance(value, float):
            if not value.is_integer():
                raise ValueError("afterMs is an integer")
            value = int(value)
        if value > MAX_AFTER_MS:
            raise ValueError("afterMs is at most 2^53 - 1")
        return value

    @model_validator(mode="after")
    def _fields_belong_to_their_kind(self) -> "Recovery":
        if self.kind == "call" and not self.command:
            raise ValueError("A call recovery names its command")
        if self.kind != "call" and (self.command is not None or self.then_retry is not None):
            raise ValueError("command and thenRetry belong to a call recovery only")
        if self.kind != "retry" and self.after_ms is not None:
            raise ValueError("afterMs belongs to a retry recovery only")
        if self.kind not in ("call", "fix-input") and (
            self.input is not None or self.needs is not None
        ):
            raise ValueError("input and needs belong to call and fix-input recoveries only")
        if self.after_ms is not None and self.after_ms < 0:
            raise ValueError("afterMs is at least 0")
        if self.needs is not None and (
            not self.needs or len(set(self.needs)) != len(self.needs) or not all(self.needs)
        ):
            raise ValueError("needs holds at least one distinct, non-empty field name")
        if self.input is not None and (not self.input or "confirm" in self.input):
            raise ValueError(
                "input has at least one member and never confirm: an acknowledgement goes in needs"
            )
        if self.kind == "fix-input" and self.input is None and self.needs is None:
            raise ValueError("A fix-input recovery sets input or needs")
        return self


class CommandError(WireModel):
    """Structured error with recovery guidance.

    All errors should be actionable - users should know what to do next.

    Attributes:
        code: Machine-readable error code (SCREAMING_SNAKE_CASE).
        message: Human-readable error description.
        suggestion: What the user can do about this error.
        retryable: Whether retrying the same request might succeed.
        recovery: The step ``suggestion`` describes, structured (``spec/recovery.md``).
        details: Additional technical details for debugging.
        cause: Original error that caused this error.

    Example:
        >>> error = CommandError(
        ...     code="RATE_LIMITED",
        ...     message="API rate limit exceeded",
        ...     suggestion="Wait 60 seconds and try again",
        ...     retryable=True,
        ...     details={"retryAfterSeconds": 60},
        ... )

    On the wire, ``details`` keys use camelCase like the TypeScript package.
    """

    code: str
    message: str
    suggestion: str | None = None
    retryable: bool | None = None
    recovery: Recovery | None = None
    details: dict[str, Any] | None = None
    cause: Union["CommandError", str] | None = None

    @field_validator("recovery", mode="before")
    @classmethod
    def _read_recovery_leniently(cls, value: Any) -> Recovery | None:
        """A recovery this version cannot read is no recovery (``spec/recovery.md``, rule 7):
        the error keeps its ``suggestion``, and new kinds may arrive without a breaking change."""
        if value is None or isinstance(value, Recovery):
            return value
        return _read_wire_recovery(value)


def _read_wire_recovery(value: Any) -> Recovery | None:
    """``value`` as a recovery if it matches ``$defs/recovery``, else None (rule 7)."""
    if not isinstance(value, dict) or (
        any(member is None for member in value.values()) or not set(value) <= _RECOVERY_WIRE_MEMBERS
    ):
        # No member is null on the wire, and every member is spelled as the specification
        # spells it: snake_case aliases are for Python callers, never for the wire.
        return None
    try:
        return Recovery.model_validate(value)
    except ValidationError:
        return None


def is_command_recovery(value: Any) -> bool:
    """Whether ``value`` is a recovery a reader keeps: a :class:`Recovery`, or a wire object that
    matches ``$defs/recovery`` in ``spec/schema/error.json`` (``spec/recovery.md``, rule 7).

    The same test as TypeScript's ``isCommandRecovery``. A recovery that fails it is read as none.

    Example:
        >>> is_command_recovery({"kind": "call", "command": "issue-check"})
        True
        >>> is_command_recovery({"kind": "fix-input", "input": {"confirm": True}})
        False
    """
    if isinstance(value, Recovery):
        # Checked in its wire form: a Recovery changed after it was built may break the rules.
        value = value.model_dump(by_alias=True, exclude_none=True)
    return _read_wire_recovery(value) is not None


def _omit_unset_cause(data: Any) -> Any:
    """Drop an unset ``cause`` and ``recovery`` from a serialized CommandError.

    ``CommandResult.error`` used to hold a CommandError without either field.
    Result serializers call this so their output keeps that shape.
    """
    if isinstance(data, dict):
        for name in ("cause", "recovery"):
            if data.get(name) is None:
                data.pop(name, None)
        if isinstance(data.get("cause"), dict):
            _omit_unset_cause(data["cause"])
    return data


ErrorCode = str
"""An error code: any string.

This is a typing alias, not a closed enum. Use the shared codes in
:class:`ErrorCodes` where one fits, and define your own string codes (for
example ``"QUOTA_PLAN_LIMIT"``) for application-specific failures; both are
valid ``CommandError.code`` values. TypeScript narrows its ``ErrorCode`` to the
catalog's values but still accepts any string as ``CommandError.code``.
"""


class ErrorCodes:
    """Standard error codes for common scenarios.

    Use these for consistency across AFD applications. This is the shared
    catalog in ``spec/error-codes.md``: TypeScript, Rust and C++ define the
    same codes.

    Example:
        >>> from afd.core.errors import ErrorCodes
        >>> ErrorCodes.NOT_FOUND
        'NOT_FOUND'
    """

    # Validation Errors
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INVALID_INPUT = "INVALID_INPUT"
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD"
    INVALID_FORMAT = "INVALID_FORMAT"

    # Resource Errors
    NOT_FOUND = "NOT_FOUND"
    ALREADY_EXISTS = "ALREADY_EXISTS"
    CONFLICT = "CONFLICT"

    # Authorization Errors
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"

    # Rate Limiting
    RATE_LIMITED = "RATE_LIMITED"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"

    # Network/Service Errors
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    TIMEOUT = "TIMEOUT"
    CONNECTION_ERROR = "CONNECTION_ERROR"

    # Internal Errors
    INTERNAL_ERROR = "INTERNAL_ERROR"
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"
    UNKNOWN_ERROR = "UNKNOWN_ERROR"

    # Command-specific
    COMMAND_NOT_FOUND = "COMMAND_NOT_FOUND"
    INVALID_COMMAND_ARGS = "INVALID_COMMAND_ARGS"
    COMMAND_CANCELLED = "COMMAND_CANCELLED"
    COMMAND_EXECUTION_ERROR = "COMMAND_EXECUTION_ERROR"

    # Routing and access
    COMMAND_NOT_EXPOSED = "COMMAND_NOT_EXPOSED"
    COMMAND_NOT_IN_CONTEXT = "COMMAND_NOT_IN_CONTEXT"
    COMMAND_NOT_ALLOWED = "COMMAND_NOT_ALLOWED"
    UNKNOWN_TOOL = "UNKNOWN_TOOL"
    AMBIGUOUS_ACTION = "AMBIGUOUS_ACTION"
    INVALID_GROUPED_CALL = "INVALID_GROUPED_CALL"

    # Contexts
    SESSION_REQUIRED = "SESSION_REQUIRED"
    CONTEXT_NOT_FOUND = "CONTEXT_NOT_FOUND"
    CONTEXT_DEPTH_EXCEEDED = "CONTEXT_DEPTH_EXCEEDED"

    # Batch and pipeline
    INVALID_BATCH_REQUEST = "INVALID_BATCH_REQUEST"
    BATCH_TIMEOUT = "BATCH_TIMEOUT"
    COMMAND_SKIPPED = "COMMAND_SKIPPED"
    INVALID_PIPELINE_REQUEST = "INVALID_PIPELINE_REQUEST"
    PIPELINE_TIMEOUT = "PIPELINE_TIMEOUT"
    UNSUPPORTED_OPTION = "UNSUPPORTED_OPTION"

    # Streaming
    STREAM_ABORTED = "STREAM_ABORTED"
    STREAM_TIMEOUT = "STREAM_TIMEOUT"
    STREAM_ERROR = "STREAM_ERROR"
    STREAM_ENDED_UNEXPECTEDLY = "STREAM_ENDED_UNEXPECTEDLY"
    COMMAND_FAILED = "COMMAND_FAILED"

    # Confirmations (spec/command-metadata.md, "Confirmations")
    CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
    CONFIRMATION_DECLINED = "CONFIRMATION_DECLINED"

    # Approvals (spec/command-metadata.md, "Approvals")
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    # A declared approval policy with no approval step to admit the call.
    APPROVAL_UNAVAILABLE = "APPROVAL_UNAVAILABLE"

    # Output budgets (spec/output-budgets.md, B5)
    OUTPUT_BUDGET_EXCEEDED = "OUTPUT_BUDGET_EXCEEDED"

    # Authorization (spec/authorization.md, M6)
    INSUFFICIENT_SCOPE = "INSUFFICIENT_SCOPE"

    # Tasks (spec/command-metadata.md, "Tasks")
    TASK_TOKEN_EXPIRED = "TASK_TOKEN_EXPIRED"

    # App calls (spec/command-metadata.md, "App-to-app calls")
    CALL_NOT_GRANTED = "CALL_NOT_GRANTED"

    # Idempotency keys (spec/idempotency.md, "Errors"); no Python engine sends them yet (#2676)
    IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED"
    IDEMPOTENCY_IN_PROGRESS = "IDEMPOTENCY_IN_PROGRESS"
    OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN"


HOST_ERROR_CODE_PREFIX: str = "HOST_"
"""Reserved prefix for host-defined error codes (``spec/error-codes.md``)."""


@dataclass(frozen=True)
class ErrorCodeInfo:
    """Metadata for one entry in the shared error-code catalog."""

    code: str
    retryable: bool | Literal["varies"]
    profile: str


ERROR_CODE_CATALOG: tuple[ErrorCodeInfo, ...] = (
    ErrorCodeInfo(ErrorCodes.VALIDATION_ERROR, False, "core"),
    ErrorCodeInfo(ErrorCodes.INVALID_INPUT, False, "core"),
    ErrorCodeInfo(ErrorCodes.MISSING_REQUIRED_FIELD, False, "core"),
    ErrorCodeInfo(ErrorCodes.INVALID_FORMAT, False, "core"),
    ErrorCodeInfo(ErrorCodes.NOT_FOUND, False, "core"),
    ErrorCodeInfo(ErrorCodes.ALREADY_EXISTS, False, "core"),
    ErrorCodeInfo(ErrorCodes.CONFLICT, False, "core"),
    ErrorCodeInfo(ErrorCodes.UNAUTHORIZED, False, "core"),
    ErrorCodeInfo(ErrorCodes.FORBIDDEN, False, "core"),
    ErrorCodeInfo(ErrorCodes.TOKEN_EXPIRED, False, "core"),
    ErrorCodeInfo(ErrorCodes.RATE_LIMITED, True, "core"),
    ErrorCodeInfo(ErrorCodes.QUOTA_EXCEEDED, False, "core"),
    ErrorCodeInfo(ErrorCodes.SERVICE_UNAVAILABLE, True, "core"),
    ErrorCodeInfo(ErrorCodes.TIMEOUT, True, "core"),
    ErrorCodeInfo(ErrorCodes.CONNECTION_ERROR, True, "core"),
    ErrorCodeInfo(ErrorCodes.INTERNAL_ERROR, "varies", "core"),
    ErrorCodeInfo(ErrorCodes.NOT_IMPLEMENTED, False, "core"),
    ErrorCodeInfo(ErrorCodes.UNKNOWN_ERROR, True, "core"),
    ErrorCodeInfo(ErrorCodes.COMMAND_NOT_FOUND, False, "core"),
    ErrorCodeInfo(ErrorCodes.INVALID_COMMAND_ARGS, False, "core"),
    ErrorCodeInfo(ErrorCodes.COMMAND_CANCELLED, False, "core"),
    ErrorCodeInfo(ErrorCodes.COMMAND_EXECUTION_ERROR, False, "core"),
    ErrorCodeInfo(ErrorCodes.COMMAND_NOT_EXPOSED, False, "core"),
    ErrorCodeInfo(ErrorCodes.COMMAND_NOT_IN_CONTEXT, False, "contexts"),
    ErrorCodeInfo(ErrorCodes.COMMAND_NOT_ALLOWED, False, "core"),
    ErrorCodeInfo(ErrorCodes.UNKNOWN_TOOL, False, "core"),
    ErrorCodeInfo(ErrorCodes.AMBIGUOUS_ACTION, False, "core"),
    ErrorCodeInfo(ErrorCodes.INVALID_GROUPED_CALL, False, "core"),
    ErrorCodeInfo(ErrorCodes.SESSION_REQUIRED, False, "contexts"),
    ErrorCodeInfo(ErrorCodes.CONTEXT_NOT_FOUND, False, "contexts"),
    ErrorCodeInfo(ErrorCodes.CONTEXT_DEPTH_EXCEEDED, False, "contexts"),
    ErrorCodeInfo(ErrorCodes.INVALID_BATCH_REQUEST, False, "core"),
    ErrorCodeInfo(ErrorCodes.BATCH_TIMEOUT, True, "core"),
    ErrorCodeInfo(ErrorCodes.COMMAND_SKIPPED, False, "core"),
    ErrorCodeInfo(ErrorCodes.INVALID_PIPELINE_REQUEST, False, "core"),
    ErrorCodeInfo(ErrorCodes.PIPELINE_TIMEOUT, True, "core"),
    ErrorCodeInfo(ErrorCodes.UNSUPPORTED_OPTION, False, "core"),
    ErrorCodeInfo(ErrorCodes.STREAM_ABORTED, True, "streaming"),
    ErrorCodeInfo(ErrorCodes.STREAM_TIMEOUT, True, "streaming"),
    ErrorCodeInfo(ErrorCodes.STREAM_ERROR, "varies", "streaming"),
    ErrorCodeInfo(ErrorCodes.STREAM_ENDED_UNEXPECTEDLY, True, "streaming"),
    ErrorCodeInfo(ErrorCodes.COMMAND_FAILED, False, "streaming"),
    ErrorCodeInfo(ErrorCodes.CONFIRMATION_REQUIRED, "varies", "confirmations"),
    ErrorCodeInfo(ErrorCodes.CONFIRMATION_DECLINED, False, "confirmations"),
    ErrorCodeInfo(ErrorCodes.APPROVAL_REQUIRED, False, "approvals"),
    ErrorCodeInfo(ErrorCodes.APPROVAL_UNAVAILABLE, False, "approvals"),
    ErrorCodeInfo(ErrorCodes.OUTPUT_BUDGET_EXCEEDED, False, "output-budgets"),
    ErrorCodeInfo(ErrorCodes.INSUFFICIENT_SCOPE, False, "authorization"),
    ErrorCodeInfo(ErrorCodes.TASK_TOKEN_EXPIRED, "varies", "tasks"),
    ErrorCodeInfo(ErrorCodes.CALL_NOT_GRANTED, False, "app-calls"),
    ErrorCodeInfo(ErrorCodes.IDEMPOTENCY_KEY_REUSED, False, "idempotency"),
    ErrorCodeInfo(ErrorCodes.IDEMPOTENCY_IN_PROGRESS, True, "idempotency"),
    ErrorCodeInfo(ErrorCodes.OUTCOME_UNKNOWN, False, "idempotency"),
)


def create_error(
    code: str,
    message: str,
    *,
    suggestion: str | None = None,
    retryable: bool | None = None,
    details: dict[str, Any] | None = None,
    cause: CommandError | Exception | str | None = None,
    recovery: Recovery | None = None,
) -> CommandError:
    """Create a CommandError with standard fields.

    Args:
        code: Machine-readable error code.
        message: Human-readable error description.
        suggestion: Recovery guidance.
        retryable: Whether retry might succeed.
        details: Additional debugging info.
        cause: Original error that caused this.
        recovery: The step ``suggestion`` describes, structured (``spec/recovery.md``).

    Returns:
        A CommandError instance.

    Example:
        >>> err = create_error(
        ...     "CUSTOM_ERROR",
        ...     "Something went wrong",
        ...     suggestion="Try again later",
        ... )
    """
    cause_value: CommandError | str | None = None
    if isinstance(cause, CommandError):
        cause_value = cause
    elif isinstance(cause, Exception):
        cause_value = str(cause)
    elif cause is not None:
        cause_value = cause

    return CommandError(
        code=code,
        message=message,
        suggestion=suggestion,
        retryable=retryable,
        recovery=recovery,
        details=details,
        cause=cause_value,
    )


def validation_error(
    message: str,
    *,
    details: dict[str, Any] | None = None,
) -> CommandError:
    """Create a validation error.

    Args:
        message: Description of what validation failed.
        details: Field-specific validation errors.

    Returns:
        A CommandError with code VALIDATION_ERROR.

    Example:
        >>> err = validation_error(
        ...     "Title is required",
        ...     details={"field": "title", "constraint": "required"},
        ... )
    """
    return create_error(
        ErrorCodes.VALIDATION_ERROR,
        message,
        suggestion="Check the input and try again",
        retryable=False,
        details=details,
    )


def not_found_error(
    resource_type: str,
    resource_id: str,
) -> CommandError:
    """Create a not found error.

    Args:
        resource_type: Type of resource (e.g., "Document", "User").
        resource_id: ID that was not found.

    Returns:
        A CommandError with code NOT_FOUND.

    Example:
        >>> err = not_found_error("Document", "doc-123")
        >>> err.message
        "Document with ID 'doc-123' not found"
    """
    return create_error(
        ErrorCodes.NOT_FOUND,
        f"{resource_type} with ID '{resource_id}' not found",
        suggestion=f"Verify the {resource_type.lower()} ID exists and try again",
        retryable=False,
        details={"resourceType": resource_type, "resourceId": resource_id},
    )


def _retry_after(seconds: Any) -> Recovery:
    """``{kind: "retry"}`` with ``after_ms`` of ``seconds`` rounded up to whole milliseconds, so
    the wait is never shorter than the suggestion's, when that is a finite wait in
    ``0..MAX_AFTER_MS``; otherwise with no minimum wait. It never raises."""
    if seconds is not None and not isinstance(seconds, bool):
        try:
            if math.isfinite(seconds):
                after_ms = math.ceil(seconds * 1000)
                if 0 <= after_ms <= MAX_AFTER_MS:
                    return Recovery(kind="retry", after_ms=after_ms)
        except (TypeError, ValueError, OverflowError):
            pass
    return Recovery(kind="retry")


def rate_limit_error(
    retry_after_seconds: float | None = None,
) -> CommandError:
    """Create a rate limit error.

    Args:
        retry_after_seconds: When to retry, if known.

    Returns:
        A CommandError with code RATE_LIMITED.

    Example:
        >>> err = rate_limit_error(60)
        >>> err.suggestion
        'Wait 60 seconds and try again'
    """
    suggestion = (
        f"Wait {retry_after_seconds} seconds and try again"
        if retry_after_seconds
        else "Wait a moment and try again"
    )
    return create_error(
        ErrorCodes.RATE_LIMITED,
        "Rate limit exceeded",
        suggestion=suggestion,
        retryable=True,
        details={"retryAfterSeconds": retry_after_seconds} if retry_after_seconds else None,
        # The wait the suggestion gives, when known (spec/recovery.md, "Engine errors").
        # No seconds, or 0, is no known wait, as in TypeScript.
        recovery=_retry_after(retry_after_seconds or None),
    )


def timeout_error(
    operation_name: str,
    timeout_ms: int,
) -> CommandError:
    """Create a timeout error.

    Args:
        operation_name: Name of the operation that timed out.
        timeout_ms: Timeout duration in milliseconds.

    Returns:
        A CommandError with code TIMEOUT.

    Example:
        >>> err = timeout_error("fetch_data", 5000)
        >>> "timed out" in err.message
        True
    """
    return create_error(
        ErrorCodes.TIMEOUT,
        f"Operation '{operation_name}' timed out after {timeout_ms}ms",
        suggestion="Try again with a simpler request or contact support if this persists",
        retryable=True,
        details={"operationName": operation_name, "timeoutMs": timeout_ms},
    )


def internal_error(
    message: str,
    *,
    cause: Exception | None = None,
) -> CommandError:
    """Create an internal error (use sparingly - prefer specific errors).

    Args:
        message: Error description.
        cause: Original exception that caused this.

    Returns:
        A CommandError with code INTERNAL_ERROR.

    Example:
        >>> try:
        ...     raise ValueError("oops")
        ... except Exception as e:
        ...     err = internal_error("Processing failed", cause=e)
    """
    return create_error(
        ErrorCodes.INTERNAL_ERROR,
        message,
        suggestion="Please try again. If this persists, contact support.",
        retryable=True,
        cause=cause,
    )


def wrap_error(error: Any) -> CommandError:
    """Wrap an unknown error in a CommandError.

    Use this to safely convert any exception to a CommandError.

    Args:
        error: Any error value (Exception, CommandError, or other).

    Returns:
        A CommandError wrapping the original error.

    Example:
        >>> try:
        ...     raise ValueError("Something went wrong")
        ... except Exception as e:
        ...     err = wrap_error(e)
        >>> err.code
        'INTERNAL_ERROR'
    """
    if isinstance(error, CommandError):
        return error

    if isinstance(error, Exception):
        return create_error(
            ErrorCodes.INTERNAL_ERROR,
            str(error),
            suggestion="Please try again. If this persists, contact support.",
            retryable=True,
            cause=error,
            details={"errorType": type(error).__name__},
        )

    return create_error(
        ErrorCodes.UNKNOWN_ERROR,
        str(error),
        suggestion="Please try again. If this persists, contact support.",
        retryable=True,
    )


def is_command_error(value: Any) -> bool:
    """Check if a value is a CommandError.

    Args:
        value: Any value to check.

    Returns:
        True if value is a CommandError instance.

    Example:
        >>> err = not_found_error("Doc", "123")
        >>> is_command_error(err)
        True
        >>> is_command_error({"code": "ERROR"})
        False
    """
    return isinstance(value, CommandError)
