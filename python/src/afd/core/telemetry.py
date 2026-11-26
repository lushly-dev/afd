"""Telemetry types for AFD command execution tracking.

This module provides types for capturing and storing telemetry data
about command executions, enabling monitoring, debugging, and analytics.

There is one event type, :class:`TelemetryEvent`, which serializes in camelCase like
TypeScript's, and one sink protocol, :class:`TelemetrySink`.
``afd.server.middleware`` re-exports both under deprecated aliases.

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
import warnings
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any, Protocol, runtime_checkable

from afd.core.errors import CommandError
from afd.core.wire import WireModel, to_wire


class TelemetryEvent(WireModel):
    """Telemetry event representing a single command execution.

    The one telemetry event type: ``create_telemetry_middleware`` records it and
    ``create_telemetry_event`` builds it. It serializes in camelCase, as TypeScript's
    ``TelemetryEvent`` does (``to_wire(event)`` or ``model_dump(by_alias=True)``:
    ``commandName``, ``startedAt``, ``durationMs`` and so on), and accepts the snake_case
    field names or the camelCase keys when built.

    Attributes:
        command_name: Name of the command that was executed.
        started_at: ISO timestamp when command execution started.
        completed_at: ISO timestamp when command execution completed.
        duration_ms: Duration of execution in milliseconds.
        success: Whether the command executed successfully.
        error: Error details if the command failed. A dict with ``code`` and ``message`` is
            accepted and read as a ``CommandError``.
        trace_id: Trace ID for correlating related events.
        confidence: Confidence score from the result (0-1), if provided.
        metadata: Additional metadata from the command result.
        input: Input provided to the command (may be redacted for security).
        command_version: Command version that was executed.
        actor_kind: Kind of principal that called the command
            (``context.actor.kind``), never its id.

    Example:
        >>> event = TelemetryEvent(
        ...     command_name="todo-create",
        ...     started_at="2024-01-15T10:30:00.000Z",
        ...     completed_at="2024-01-15T10:30:00.150Z",
        ...     duration_ms=150,
        ...     success=True,
        ...     trace_id="trace-abc123",
        ... )
        >>> to_wire(event)["commandName"]
        'todo-create'
    """

    command_name: str
    started_at: str
    completed_at: str
    duration_ms: int | float
    success: bool
    error: CommandError | None = None
    trace_id: str | None = None
    confidence: float | None = None
    metadata: dict[str, Any] | None = None
    input: Any | None = None
    command_version: str | None = None
    actor_kind: str | None = None


class TelemetryError(CommandError):
    """The ``error`` of an event that ``create_telemetry_middleware`` records.

    A ``CommandError``. Events from the middleware used to carry a plain dict, so reading
    ``event.error["code"]`` or ``event.error.get("code")`` still works, with a
    ``DeprecationWarning``: read ``event.error.code`` instead.
    """

    def _mapping_access(self, key: str) -> Any:
        warnings.warn(
            "Reading a telemetry event's error as a dict is deprecated: the event's error is "
            f"a CommandError, so read event.error.{key} instead of event.error[{key!r}].",
            DeprecationWarning,
            stacklevel=3,
        )
        if key not in type(self).model_fields:
            raise KeyError(key)
        return getattr(self, key)

    def __getitem__(self, key: str) -> Any:
        return self._mapping_access(key)

    def get(self, key: str, default: Any = None) -> Any:
        try:
            value = self._mapping_access(key)
        except KeyError:
            return default
        return default if value is None else value


@runtime_checkable
class TelemetrySink(Protocol):
    """Interface for pluggable telemetry storage backends.

    Implement this protocol to send telemetry events to your preferred
    storage or monitoring system (console, file, database, cloud service).
    ``record`` may be synchronous or a coroutine; ``create_telemetry_middleware``
    awaits one that returns an awaitable.

    Example:
        >>> class MyCustomSink:
        ...     def record(self, event: TelemetryEvent) -> None:
        ...         # Send to monitoring service
        ...         pass
        ...     def flush(self) -> None:
        ...         pass
    """

    def record(self, event: TelemetryEvent) -> None | Awaitable[None]:
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


def _write_stderr(message: str) -> None:
    """Write a line to stderr (stdout carries JSON-RPC on the stdio transport)."""
    print(message, file=sys.stderr, flush=True)


class ConsoleTelemetrySink:
    """Default telemetry sink that logs events to the console, as TypeScript's does.

    Events go to stderr by default, never stdout: on the stdio transport, stdout carries the
    JSON-RPC stream and any other line corrupts it. The text line is
    ``"<prefix> [<traceId>] <command> SUCCESS in <ms>ms (confidence: <c>) - <code>: <message>"``
    (the bracketed trace, confidence and error parts only when present); the JSON line is the
    event in camelCase with ``_prefix`` added.

    Args:
        format: ``"text"`` (the default) or ``"json"``.
        log: Where each line goes. Defaults to stderr.
        json_mode: ``True`` is the same as ``format="json"``.
        prefix: The text line's first word, and the JSON line's ``_prefix``.

    Example:
        >>> sink = ConsoleTelemetrySink()  # human-readable, to stderr
        >>> sink = ConsoleTelemetrySink(format="json")  # JSON output
        >>> sink = ConsoleTelemetrySink(log=logging.getLogger("telemetry").info)
    """

    def __init__(
        self,
        format: str = "text",
        *,
        log: Callable[[str], None] | None = None,
        json_mode: bool = False,
        prefix: str = "[Telemetry]",
    ) -> None:
        if format not in ("text", "json"):
            raise ValueError('format must be "text" or "json"')
        self.format = "json" if json_mode else format
        self._log = log or _write_stderr
        self._prefix = prefix

    def record(self, event: TelemetryEvent) -> None:
        """Record a telemetry event to the console."""
        if self.format == "json":
            self._log(json.dumps({**to_wire(event), "_prefix": self._prefix}, default=str))
            return
        status = "SUCCESS" if event.success else "FAILURE"
        trace_info = f" [{event.trace_id}]" if event.trace_id else ""
        confidence_info = (
            f" (confidence: {event.confidence})" if event.confidence is not None else ""
        )
        error_info = f" - {event.error.code}: {event.error.message}" if event.error else ""
        self._log(
            f"{self._prefix}{trace_info} {event.command_name} "
            f"{status} in {event.duration_ms}ms{confidence_info}{error_info}"
        )

    def flush(self) -> None:
        """Nothing is buffered; flushes stderr when that is where lines go."""
        if self._log is _write_stderr:
            sys.stderr.flush()


def create_telemetry_event(
    *,
    command_name: str,
    started_at: str,
    completed_at: str,
    success: bool,
    duration_ms: float | None = None,
    error: CommandError | None = None,
    trace_id: str | None = None,
    confidence: float | None = None,
    metadata: dict[str, Any] | None = None,
    input: Any | None = None,
    command_version: str | None = None,
    actor_kind: str | None = None,
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
        actor_kind: Kind of principal that called the command.

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
    if actor_kind is not None:
        kwargs["actor_kind"] = actor_kind

    return TelemetryEvent(**kwargs)


def is_telemetry_event(value: Any) -> bool:
    """Type guard to check if an object is a valid TelemetryEvent.

    Works with TelemetryEvent instances and plain dicts, with camelCase keys (the wire form)
    or snake_case ones.

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

    def field(name: str, alias: str) -> Any:
        return value[alias] if alias in value else value.get(name)

    duration = field("duration_ms", "durationMs")
    return (
        isinstance(field("command_name", "commandName"), str)
        and isinstance(field("started_at", "startedAt"), str)
        and isinstance(field("completed_at", "completedAt"), str)
        and isinstance(duration, (int, float))
        and not isinstance(duration, bool)
        and isinstance(value.get("success"), bool)
    )
