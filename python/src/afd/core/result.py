"""CommandResult and helper functions for structured command responses.

All commands return a CommandResult with UX-enabling metadata following
Agent-First Development (AFD) principles.

Example:
    >>> from afd.core.result import success, error
    >>> 
    >>> # Successful result
    >>> result = success({"id": "123"}, reasoning="Created successfully")
    >>> assert result.success is True
    >>> 
    >>> # Error result  
    >>> result = error("NOT_FOUND", "Resource not found")
    >>> assert result.success is False
"""

from typing import Any, Generic, List, Optional, TypeVar

from pydantic import ConfigDict, Field, SerializerFunctionWrapHandler, field_serializer

# CommandError is defined once, in afd.core.errors, and re-exported here so
# ``afd.core.result.CommandError`` and ``afd.core.errors.CommandError`` are the
# same class.
from afd.core.errors import CommandError, _omit_unset_cause
from afd.core.metadata import Alternative, PlanStep, Source, Warning
from afd.core.wire import WIRE_MODEL_CONFIG, WireModel

T = TypeVar("T")


class ResultMetadata(WireModel):
    """Execution metadata for debugging and monitoring.
    
    Attributes:
        execution_time_ms: Time taken to execute the command in milliseconds.
        command_version: Version of the command that produced this result.
        trace_id: Unique trace ID for debugging and correlation.
        timestamp: ISO timestamp when the command was executed.

    Additional metadata fields are allowed and serialized under their own
    names. The declared fields use camelCase on the wire (``executionTimeMs``).
    """

    model_config = ConfigDict(**WIRE_MODEL_CONFIG, extra="allow")

    execution_time_ms: Optional[float] = None
    command_version: Optional[str] = None
    trace_id: Optional[str] = None
    timestamp: Optional[str] = None


class CommandResult(WireModel, Generic[T]):
    """Standard response type for all AFD commands.
    
    All commands return this structure, enabling consistent handling across
    CLI, MCP, and REST API surfaces.
    
    Attributes:
        success: Whether the command completed successfully.
        data: The command output (generic type T) when success=True.
        error: Structured error when success=False.
        confidence: Agent's confidence in this result (0-1).
        reasoning: Human-readable explanation of what happened.
        sources: Information sources used to produce this result.
        plan: Steps in a multi-step operation.
        alternatives: Other options the agent considered.
        warnings: Non-fatal warnings to surface to user.
        metadata: Execution metadata for debugging.
    
    Example:
        >>> result: CommandResult[dict] = CommandResult(
        ...     success=True,
        ...     data={"id": "123", "title": "My Document"},
        ...     confidence=0.95,
        ...     reasoning="Document created with all required fields",
        ... )

    Wire format: fields serialize as camelCase (``undoCommand``) and unset
    fields are omitted; use :func:`afd.core.wire.to_wire`. Parsing accepts
    camelCase and snake_case keys.
    """

    success: bool
    data: Optional[T] = None
    error: Optional[CommandError] = None

    # UX-enabling fields (AFD standard)
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    reasoning: Optional[str] = None
    sources: Optional[List[Source]] = None
    plan: Optional[List[PlanStep]] = None
    alternatives: Optional[List[Alternative[T]]] = None
    warnings: Optional[List[Warning]] = None
    suggestions: Optional[List[str]] = None  # Helpful next steps for user
    
    # Execution metadata
    metadata: Optional[ResultMetadata] = None

    # Undo fields (for serializable undo over MCP)
    undo_command: Optional[str] = None
    undo_args: Optional[dict[str, Any]] = None

    @field_serializer("error", mode="wrap")
    def _serialize_error(
        self, value: Optional[CommandError], handler: SerializerFunctionWrapHandler
    ) -> Any:
        return _omit_unset_cause(handler(value))


def success(
    data: T,
    *,
    confidence: Optional[float] = None,
    reasoning: Optional[str] = None,
    sources: Optional[List[Source]] = None,
    plan: Optional[List[PlanStep]] = None,
    alternatives: Optional[List[Alternative[T]]] = None,
    warnings: Optional[List[Warning]] = None,
    suggestions: Optional[List[str]] = None,
    metadata: Optional[ResultMetadata] = None,
    undo_command: Optional[str] = None,
    undo_args: Optional[dict[str, Any]] = None,
) -> CommandResult[T]:
    """Create a successful command result.
    
    Args:
        data: The command output.
        confidence: Quality confidence score (0-1).
        reasoning: Human-readable explanation.
        sources: Information sources used.
        plan: Steps in multi-step operation.
        alternatives: Other options considered.
        warnings: Non-fatal warnings.
        suggestions: Helpful next steps for the user.
        metadata: Execution metadata.
        undo_command: Command name for undoing this operation.
        undo_args: Arguments to pass to the undo command.

    Returns:
        CommandResult with success=True.
    
    Example:
        >>> result = success(
        ...     data={"id": "123"},
        ...     reasoning="Created successfully",
        ...     confidence=0.95,
        ... )
    """
    return CommandResult(
        success=True,
        data=data,
        confidence=confidence,
        reasoning=reasoning,
        sources=sources,
        plan=plan,
        alternatives=alternatives,
        warnings=warnings,
        suggestions=suggestions,
        metadata=metadata,
        undo_command=undo_command,
        undo_args=undo_args,
    )


def failure(
    err: CommandError,
    *,
    warnings: Optional[List[Warning]] = None,
    metadata: Optional[ResultMetadata] = None,
) -> CommandResult[Any]:
    """Create a failed command result from a CommandError.
    
    Args:
        err: The error details.
        warnings: Non-fatal warnings to include.
        metadata: Execution metadata.
        
    Returns:
        CommandResult with success=False.
    
    Example:
        >>> from afd.core.errors import not_found_error
        >>> result = failure(not_found_error("Document", "doc-123"))
    """
    return CommandResult(
        success=False,
        error=err,
        warnings=warnings,
        metadata=metadata,
    )


def error(
    code: str,
    message: str,
    *,
    suggestion: Optional[str] = None,
    retryable: Optional[bool] = None,
    details: Optional[dict[str, Any]] = None,
) -> CommandResult[Any]:
    """Create an error command result.
    
    This is a convenience function that creates both the CommandError
    and wraps it in a failed CommandResult.
    
    Args:
        code: Error code (e.g., "NOT_FOUND", "VALIDATION_ERROR").
        message: Human-readable error description.
        suggestion: Recovery guidance for the user.
        retryable: Whether retrying might succeed.
        details: Additional technical details.
        
    Returns:
        CommandResult with success=False.
    
    Example:
        >>> result = error(
        ...     "NOT_FOUND",
        ...     "Document not found",
        ...     suggestion="Check the document ID and try again",
        ... )
    """
    return CommandResult(
        success=False,
        error=CommandError(
            code=code,
            message=message,
            suggestion=suggestion,
            retryable=retryable,
            details=details,
        ),
    )


INVALID_COMMAND_RESULT = "INVALID_COMMAND_RESULT"
"""Error code for a handler that returned something other than a CommandResult."""


def coerce_command_result(value: Any, command: str) -> CommandResult[Any]:
    """Return ``value`` as a CommandResult, or a failure explaining why it is not one.

    Batches and pipelines aggregate CommandResults after the commands have run,
    so aggregation must never raise. A dict with a boolean ``success`` is
    parsed (camelCase or snake_case keys). Anything else, or a dict that does
    not parse, becomes an ``INVALID_COMMAND_RESULT`` failure. The command may
    already have had side effects, so that failure is not retryable.

    Args:
        value: What the command (or its middleware) returned.
        command: The command name, for the error message.

    Returns:
        ``value`` itself when it is a CommandResult, otherwise a CommandResult.

    Example:
        >>> coerce_command_result({"success": True, "data": 1}, "x").data
        1
        >>> coerce_command_result([1], "x").error.code
        'INVALID_COMMAND_RESULT'
    """
    if isinstance(value, CommandResult):
        return value
    if isinstance(value, dict) and isinstance(value.get("success"), bool):
        try:
            return CommandResult.model_validate(value)
        except ValueError:
            pass
    return CommandResult(
        success=False,
        error=CommandError(
            code=INVALID_COMMAND_RESULT,
            message=(
                f"Command '{command[:128]}' returned {type(value).__name__} "
                "instead of a CommandResult"
            ),
            suggestion=(
                "The command may have run: check its effects before retrying. "
                "Its handler must return success(...) or error(...)."
            ),
            retryable=False,
        ),
    )


def is_success(result: CommandResult[T]) -> bool:
    """Check if a result is successful.
    
    Args:
        result: The CommandResult to check.
        
    Returns:
        True if success=True and data is present.
    
    Example:
        >>> result = success({"id": "123"})
        >>> is_success(result)
        True
    """
    return result.success is True and result.data is not None


def is_failure(result: CommandResult[T]) -> bool:
    """Check if a result is a failure.
    
    Args:
        result: The CommandResult to check.
        
    Returns:
        True if success=False and error is present.
    
    Example:
        >>> result = error("NOT_FOUND", "Not found")
        >>> is_failure(result)
        True
    """
    return result.success is False and result.error is not None
