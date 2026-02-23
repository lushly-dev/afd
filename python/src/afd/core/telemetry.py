"""Telemetry types for AFD command execution tracking.

This module provides types for capturing and storing telemetry data
about command executions, enabling monitoring, debugging, and analytics.

Example:
    >>> from afd.core.telemetry import create_telemetry_event, is_telemetry_event
    >>>
    >>> event = create_telemetry_event(
    ...     command_name="todo-create",
    ...     started_at="2024-01-15T10:30:00.000Z",
    ...     completed_at="2024-01-15T10:30:00.150Z",
    ...     success=True,
    ... )
    >>> event.duration_ms
    150.0
    >>> is_telemetry_event(event)
    True
"""

import json
import sys
from datetime import datetime
from typing import Any, Optional, Protocol, runtime_checkable

from pydantic import BaseModel

from afd.core.errors import CommandError


class TelemetryEvent(BaseModel):
    """Telemetry event representing a single command execution.

    Contains all relevant information about the command invocation,
    including timing, outcome, and optional context.

    Attributes:
        command_name: Name of the command that was executed.
        started_at: ISO timestamp when command execution started.
        completed_at: ISO timestamp when command execution completed.
        duration_ms: Duration of execution in milliseconds.
        success: Whether the command executed successfully.
        error: Error details if the command failed.
        trace_id: Trace ID for correlating related events.
        confidence: Confidence score from the result (0-1), if provided.
        metadata: Additional metadata from the command result.
        input: Input provided to the command (may be redacted for security).
        command_version: Command version that was executed.

    Example:
        >>> event = TelemetryEvent(
        ...     command_name="todo-create",
        ...     started_at="2024-01-15T10:30:00.000Z",
        ...     completed_at="2024-01-15T10:30:00.150Z",
        ...     duration_ms=150,
        ...     success=True,
        ...     trace_id="trace-abc123",
        ... )
    """

    command_name: str
    started_at: str
    completed_at: str
    duration_ms: float
    success: bool
    error: Optional[CommandError] = None
    trace_id: Optional[str] = None
    confidence: Optional[float] = None
    metadata: Optional[dict[str, Any]] = None
    input: Optional[Any] = None
    command_version: Optional[str] = None


@runtime_checkable
class TelemetrySink(Protocol):
    """Interface for pluggable telemetry storage backends.

    Implement this protocol to send telemetry events to your preferred
    storage or monitoring system (console, file, database, cloud service).

    Example:
        >>> class MyCustomSink:
        ...     def record(self, event: TelemetryEvent) -> None:
        ...         # Send to monitoring service
        ...         pass
        ...     def flush(self) -> None:
        ...         pass
    """

    def record(self, event: TelemetryEvent) -> None:
        """Record a telemetry event.

        This method should be non-blocking when possible.
        Errors should be handled internally (log and continue).
        """
        ...

    def flush(self) -> None:
        """Flush any pending events to storage.

        Called during graceful shutdown to ensure all events are persisted.
        """
        ...


class ConsoleTelemetrySink:
    """Default telemetry sink that logs events to the console.

    Supports two output formats: human-readable text and JSON.

    Args:
        format: Output format, either "text" or "json". Defaults to "text".

    Example:
        >>> sink = ConsoleTelemetrySink(format="text")
        >>> sink.record(event)
        [TELEMETRY] todo-create success=True duration=150.0ms
    """

    def __init__(self, format: str = "text") -> None:
        self.format = format

    def record(self, event: TelemetryEvent) -> None:
        """Record a telemetry event to console."""
        if self.format == "json":
            print(
                json.dumps(event.model_dump(exclude_none=True), default=str),
                file=sys.stderr,
            )
        else:
            parts = [
                f"[TELEMETRY] {event.command_name}",
                f"success={event.success}",
                f"duration={event.duration_ms}ms",
            ]
            if event.trace_id:
                parts.append(f"trace={event.trace_id}")
            if event.error:
                parts.append(f"error={event.error.code}")
            print(" ".join(parts), file=sys.stderr)

    def flush(self) -> None:
        """Flush stderr."""
        sys.stderr.flush()


def create_telemetry_event(
    *,
    command_name: str,
    started_at: str,
    completed_at: str,
    success: bool,
    duration_ms: Optional[float] = None,
    error: Optional[CommandError] = None,
    trace_id: Optional[str] = None,
    confidence: Optional[float] = None,
    metadata: Optional[dict[str, Any]] = None,
    input: Optional[Any] = None,
    command_version: Optional[str] = None,
) -> TelemetryEvent:
    """Create a telemetry event from command execution data.

    Automatically calculates duration_ms from timestamps if not provided.

    Args:
        command_name: Name of the command that was executed.
        started_at: ISO timestamp when execution started.
        completed_at: ISO timestamp when execution completed.
        success: Whether the command executed successfully.
        duration_ms: Duration in ms (auto-calculated from timestamps if omitted).
        error: Error details if the command failed.
        trace_id: Trace ID for correlating related events.
        confidence: Confidence score from the result (0-1).
        metadata: Additional metadata from the command result.
        input: Input provided to the command.
        command_version: Command version that was executed.

    Returns:
        A TelemetryEvent instance.

    Example:
        >>> event = create_telemetry_event(
        ...     command_name="todo-create",
        ...     started_at="2024-01-15T10:30:00.000Z",
        ...     completed_at="2024-01-15T10:30:00.150Z",
        ...     success=True,
        ... )
        >>> event.duration_ms
        150.0
    """
    if duration_ms is None:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        duration_ms = (end - start).total_seconds() * 1000

    kwargs: dict[str, Any] = {
        "command_name": command_name,
        "started_at": started_at,
        "completed_at": completed_at,
        "duration_ms": duration_ms,
        "success": success,
    }
    if error is not None:
        kwargs["error"] = error
    if trace_id is not None:
        kwargs["trace_id"] = trace_id
    if confidence is not None:
        kwargs["confidence"] = confidence
    if metadata is not None:
        kwargs["metadata"] = metadata
    if input is not None:
        kwargs["input"] = input
    if command_version is not None:
        kwargs["command_version"] = command_version

    return TelemetryEvent(**kwargs)


def is_telemetry_event(value: Any) -> bool:
    """Type guard to check if an object is a valid TelemetryEvent.

    Works with both TelemetryEvent instances and plain dicts.

    Args:
        value: Any value to check.

    Returns:
        True if the value has all required TelemetryEvent fields with correct types.

    Example:
        >>> from afd.core.telemetry import is_telemetry_event
        >>> is_telemetry_event({"command_name": "test", "started_at": "...", "completed_at": "...", "duration_ms": 100, "success": True})
        True
        >>> is_telemetry_event(None)
        False
    """
    if isinstance(value, TelemetryEvent):
        return True

    if not isinstance(value, dict):
        return False

    return (
        isinstance(value.get("command_name"), str)
        and isinstance(value.get("started_at"), str)
        and isinstance(value.get("completed_at"), str)
        and isinstance(value.get("duration_ms"), (int, float))
        and isinstance(value.get("success"), bool)
    )
