"""Batch execution types for AFD commands.

Batch operations allow executing multiple commands in a single roundtrip,
reducing network overhead for complex UI operations. Results use partial
success semantics with aggregated confidence scores.

Example:
    >>> from afd.core.batch import create_batch_request, create_batch_result
    >>>
    >>> # Create a batch request
    >>> request = create_batch_request([
    ...     {"command": "todo-create", "input": {"title": "Task 1"}},
    ...     {"command": "todo-create", "input": {"title": "Task 2"}},
    ... ])
    >>> assert len(request.commands) == 2
    >>> assert request.commands[0].id == "cmd-0"
"""

from datetime import datetime, timezone
from typing import Any, Generic, List, Optional, TypeVar

from pydantic import BaseModel, Field

from afd.core.errors import CommandError
from afd.core.result import CommandResult, ResultMetadata

T = TypeVar("T")


# ═══════════════════════════════════════════════════════════════════════════════
# BATCH REQUEST TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class BatchCommand(BaseModel):
    """A single command within a batch request.

    Attributes:
        id: Optional client-provided ID for correlating results.
        command: The command name to execute.
        input: Input parameters for the command.

    Example:
        >>> cmd = BatchCommand(command="todo-create", input={"title": "Buy groceries"})
        >>> cmd.id is None
        True
    """

    id: Optional[str] = None
    command: str
    input: Any = None


class BatchOptions(BaseModel):
    """Options for batch execution.

    Attributes:
        stop_on_error: Whether to stop execution on first error.
        timeout: Timeout in milliseconds for the entire batch.
        parallelism: Maximum number of commands to execute in parallel.

    Example:
        >>> opts = BatchOptions(stop_on_error=True, parallelism=4)
    """

    stop_on_error: bool = False
    timeout: Optional[int] = Field(default=None, ge=0)
    parallelism: int = Field(default=1, ge=1)


class BatchRequest(BaseModel):
    """A batch request containing multiple commands to execute.

    Attributes:
        commands: Array of commands to execute.
        options: Batch execution options.

    Example:
        >>> request = BatchRequest(
        ...     commands=[
        ...         BatchCommand(command="todo-create", input={"title": "Task 1"}),
        ...         BatchCommand(command="todo-list", input={}),
        ...     ],
        ... )
    """

    commands: List[BatchCommand]
    options: Optional[BatchOptions] = None


# ═══════════════════════════════════════════════════════════════════════════════
# BATCH RESULT TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class BatchCommandResult(BaseModel, Generic[T]):
    """Result of a single command within a batch.

    Attributes:
        id: ID correlating to the BatchCommand.id or index.
        index: Index position in the original batch request.
        command: The command that was executed.
        result: The full command result.
        duration_ms: Execution time for this command in milliseconds.

    Example:
        >>> from afd.core.result import success
        >>> bcr = BatchCommandResult(
        ...     id="cmd-0", index=0, command="todo-create",
        ...     result=success({"id": "1"}), duration_ms=15,
        ... )
    """

    id: str
    index: int = Field(ge=0)
    command: str
    result: CommandResult[T]
    duration_ms: float = Field(ge=0)


class BatchSummary(BaseModel):
    """Summary statistics for a batch execution.

    Attributes:
        total: Total number of commands in the batch.
        success_count: Number of successfully executed commands.
        failure_count: Number of failed commands.
        skipped_count: Number of skipped commands (when stop_on_error is true).
    """

    total: int = Field(ge=0)
    success_count: int = Field(ge=0)
    failure_count: int = Field(ge=0)
    skipped_count: int = Field(ge=0)


class BatchTiming(BaseModel):
    """Timing information for the batch execution.

    Attributes:
        total_ms: Total time for the entire batch in milliseconds.
        average_ms: Average time per command in milliseconds.
        started_at: ISO timestamp when batch execution started.
        completed_at: ISO timestamp when batch execution completed.
    """

    total_ms: float = Field(ge=0)
    average_ms: float = Field(ge=0)
    started_at: str
    completed_at: str


class BatchWarning(BaseModel):
    """Warning from a command within a batch.

    Attributes:
        command_id: ID of the command that produced the warning.
        code: Machine-readable warning code.
        message: Human-readable warning message.
    """

    command_id: str
    code: str
    message: str


class BatchResult(BaseModel, Generic[T]):
    """Result of a batch execution.

    Uses partial success semantics — success is true even if some commands fail.
    The aggregated confidence reflects the overall success rate combined with
    individual command confidence scores.

    Attributes:
        success: Whether the batch execution completed.
        results: Results for each command in the batch.
        summary: Summary statistics.
        timing: Timing information.
        confidence: Aggregated confidence score (0-1).
        reasoning: Human-readable summary of the batch execution.
        warnings: Warnings from any of the commands.
        error: Error if the batch itself failed to execute.
        metadata: Execution metadata.

    Example:
        >>> # A batch result with partial success
        >>> # result.success == True (batch completed)
        >>> # result.summary.failure_count == 1 (one command failed)
        >>> # result.confidence == 0.67 (2/3 succeeded)
    """

    success: bool
    results: List[BatchCommandResult[T]]
    summary: BatchSummary
    timing: BatchTiming
    confidence: float = Field(ge=0, le=1)
    reasoning: str
    warnings: Optional[List[BatchWarning]] = None
    error: Optional[CommandError] = None
    metadata: Optional[ResultMetadata] = None


# ═══════════════════════════════════════════════════════════════════════════════
# FACTORY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════


def create_batch_request(
    commands: List[dict],
    *,
    options: Optional[BatchOptions] = None,
) -> BatchRequest:
    """Create a batch request, auto-assigning IDs to commands that lack them.

    Args:
        commands: List of command dicts with 'command' and 'input' keys.
        options: Batch execution options.

    Returns:
        A BatchRequest with IDs assigned.

    Example:
        >>> request = create_batch_request([
        ...     {"command": "todo-create", "input": {"title": "Task 1"}},
        ...     {"command": "todo-create", "input": {"title": "Task 2"}},
        ... ])
        >>> request.commands[0].id
        'cmd-0'
        >>> request.commands[1].id
        'cmd-1'
    """
    batch_commands = []
    for index, cmd in enumerate(commands):
        batch_commands.append(
            BatchCommand(
                id=cmd.get("id") if cmd.get("id") is not None else f"cmd-{index}",
                command=cmd["command"],
                input=cmd.get("input"),
            )
        )
    return BatchRequest(commands=batch_commands, options=options)


def calculate_batch_confidence(results: List[BatchCommandResult]) -> float:
    """Calculate aggregated confidence for a batch result.

    Formula: (successRatio * 0.5) + (avgCommandConfidence * 0.5)

    Args:
        results: Array of command results.

    Returns:
        Confidence score between 0 and 1.

    Example:
        >>> calculate_batch_confidence([])
        1.0
    """
    if len(results) == 0:
        return 1.0  # Empty batch is considered fully successful

    # Calculate success ratio
    success_count = sum(1 for r in results if r.result.success)
    success_ratio = success_count / len(results)

    # Calculate average confidence from successful commands
    successful_results = [r for r in results if r.result.success]
    if successful_results:
        avg_command_confidence = sum(
            r.result.confidence if r.result.confidence is not None else 1.0
            for r in successful_results
        ) / len(successful_results)
    else:
        avg_command_confidence = 0.0

    # Weighted average: 50% success ratio, 50% command confidence
    return success_ratio * 0.5 + avg_command_confidence * 0.5


def _generate_batch_reasoning(summary: BatchSummary) -> str:
    """Generate human-readable reasoning for a batch result."""
    parts: List[str] = []

    suffix = "" if summary.total == 1 else "s"
    parts.append(f"Executed {summary.total} command{suffix}")

    if summary.success_count == summary.total:
        parts.append("all succeeded")
    else:
        details: List[str] = []
        if summary.success_count > 0:
            details.append(f"{summary.success_count} succeeded")
        if summary.failure_count > 0:
            details.append(f"{summary.failure_count} failed")
        if summary.skipped_count > 0:
            details.append(f"{summary.skipped_count} skipped")
        parts.append(", ".join(details))

    return ": ".join(parts)


def create_batch_result(
    results: List[BatchCommandResult],
    timing: BatchTiming,
    *,
    metadata: Optional[ResultMetadata] = None,
) -> BatchResult:
    """Create a batch result from command results.

    Args:
        results: Array of individual command results.
        timing: Timing information.
        metadata: Optional execution metadata.

    Returns:
        A complete BatchResult object.
    """
    success_count = sum(1 for r in results if r.result.success)
    failure_count = sum(1 for r in results if not r.result.success)
    skipped_count = len(results) - success_count - failure_count

    summary = BatchSummary(
        total=len(results),
        success_count=success_count,
        failure_count=failure_count,
        skipped_count=skipped_count,
    )

    confidence = calculate_batch_confidence(results)

    # Collect warnings from all commands
    warnings: List[BatchWarning] = []
    for r in results:
        if r.result.warnings:
            for w in r.result.warnings:
                warnings.append(
                    BatchWarning(
                        command_id=r.id,
                        code=w.code,
                        message=w.message,
                    )
                )

    reasoning = _generate_batch_reasoning(summary)

    return BatchResult(
        success=True,
        results=results,
        summary=summary,
        timing=timing,
        confidence=confidence,
        reasoning=reasoning,
        warnings=warnings if warnings else None,
        metadata=metadata,
    )


def create_failed_batch_result(
    error: CommandError,
    *,
    total_ms: float = 0,
    started_at: Optional[str] = None,
    completed_at: Optional[str] = None,
) -> BatchResult:
    """Create a failed batch result (batch-level failure, not command failure).

    Args:
        error: The error that caused the batch to fail.
        total_ms: Total execution time in milliseconds.
        started_at: ISO timestamp when batch started.
        completed_at: ISO timestamp when batch completed.

    Returns:
        A failed BatchResult object.
    """
    now = datetime.now(timezone.utc).isoformat()
    return BatchResult(
        success=False,
        results=[],
        summary=BatchSummary(
            total=0,
            success_count=0,
            failure_count=0,
            skipped_count=0,
        ),
        timing=BatchTiming(
            total_ms=total_ms,
            average_ms=0,
            started_at=started_at or now,
            completed_at=completed_at or now,
        ),
        confidence=0,
        reasoning=f"Batch execution failed: {error.message}",
        error=error,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# TYPE GUARDS
# ═══════════════════════════════════════════════════════════════════════════════


def is_batch_request(value: Any) -> bool:
    """Type guard to check if a value is a BatchRequest.

    Args:
        value: Value to check.

    Returns:
        True if value is a BatchRequest instance or dict with 'commands' array.

    Example:
        >>> is_batch_request({"commands": [{"command": "todo-list", "input": {}}]})
        True
        >>> is_batch_request({"invalid": "data"})
        False
    """
    if isinstance(value, BatchRequest):
        return True
    if isinstance(value, dict):
        commands = value.get("commands")
        return isinstance(commands, list)
    return False


def is_batch_result(value: Any) -> bool:
    """Type guard to check if a value is a BatchResult.

    Args:
        value: Value to check.

    Returns:
        True if value is a BatchResult instance or dict with batch result shape.

    Example:
        >>> is_batch_result({"success": True, "results": [], "summary": {}, "timing": {}})
        True
    """
    if isinstance(value, BatchResult):
        return True
    if isinstance(value, dict):
        return (
            "success" in value
            and "results" in value
            and "summary" in value
            and "timing" in value
            and isinstance(value.get("results"), list)
        )
    return False


def is_batch_command(value: Any) -> bool:
    """Type guard to check if a value is a BatchCommand.

    Args:
        value: Value to check.

    Returns:
        True if value is a BatchCommand instance or dict with 'command' string.

    Example:
        >>> is_batch_command({"command": "todo-create", "input": {}})
        True
        >>> is_batch_command({"command": 123})
        False
    """
    if isinstance(value, BatchCommand):
        return True
    if isinstance(value, dict):
        command = value.get("command")
        return isinstance(command, str)
    return False
