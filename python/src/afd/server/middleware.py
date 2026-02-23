"""Command middleware for AFD servers.

Middleware functions wrap command execution to add cross-cutting concerns
like logging, tracing, rate limiting, retry, and telemetry.

Example:
    >>> from afd.server import create_server, default_middleware
    >>> server = create_server("my-app", middleware=default_middleware())
"""

import asyncio
import json
import logging
import time

from dataclasses import dataclass, field
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Optional,
    Protocol,
    Union,
    runtime_checkable,
)
from uuid import uuid4

from afd.core.commands import CommandContext
from afd.core.result import CommandError, CommandResult

# Type aliases matching TS CommandMiddleware pattern
NextFn = Callable[[], Awaitable[CommandResult[Any]]]
CommandMiddleware = Callable[
    [str, Any, CommandContext, NextFn],
    Awaitable[CommandResult[Any]],
]


# =============================================================================
# TELEMETRY TYPES
# =============================================================================


@dataclass
class TelemetryEvent:
    """Telemetry event recorded for each command execution.

    Attributes:
        command_name: Name of the executed command.
        started_at: ISO timestamp when execution started.
        completed_at: ISO timestamp when execution completed.
        duration_ms: Execution duration in milliseconds.
        success: Whether the command succeeded.
        error: Error details if the command failed.
        trace_id: Trace ID for correlation.
        input: Command input (if include_input enabled).
        confidence: Result confidence score.
        metadata: Result metadata.
        command_version: Version of the command.
    """

    command_name: str
    started_at: str
    completed_at: str
    duration_ms: float
    success: bool
    error: Optional[Dict[str, Any]] = None
    trace_id: Optional[str] = None
    input: Optional[Any] = None
    confidence: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None
    command_version: Optional[str] = None


@runtime_checkable
class TelemetrySink(Protocol):
    """Protocol for telemetry event sinks."""

    def record(self, event: TelemetryEvent) -> Union[None, Awaitable[None]]:
        """Record a telemetry event. May be sync or async."""
        ...

    def flush(self) -> None:
        """Flush any buffered events."""
        ...


class ConsoleTelemetrySink:
    """Default telemetry sink that logs events to the console.

    Example:
        >>> sink = ConsoleTelemetrySink()  # human-readable
        >>> sink = ConsoleTelemetrySink(json_mode=True)  # JSON output
    """

    def __init__(
        self,
        *,
        log: Optional[Callable[[str], None]] = None,
        json_mode: bool = False,
        prefix: str = "[Telemetry]",
    ):
        self._log = log or print
        self._json_mode = json_mode
        self._prefix = prefix

    def record(self, event: TelemetryEvent) -> None:
        if self._json_mode:
            event_dict = {
                "command_name": event.command_name,
                "started_at": event.started_at,
                "completed_at": event.completed_at,
                "duration_ms": event.duration_ms,
                "success": event.success,
                "_prefix": self._prefix,
            }
            if event.error is not None:
                event_dict["error"] = event.error
            if event.trace_id is not None:
                event_dict["trace_id"] = event.trace_id
            if event.confidence is not None:
                event_dict["confidence"] = event.confidence
            self._log(json.dumps(event_dict))
        else:
            status = "SUCCESS" if event.success else "FAILURE"
            trace_info = f" [{event.trace_id}]" if event.trace_id else ""
            confidence_info = (
                f" (confidence: {event.confidence})"
                if event.confidence is not None
                else ""
            )
            error_info = ""
            if event.error:
                error_info = f" - {event.error.get('code', 'UNKNOWN')}: {event.error.get('message', '')}"
            self._log(
                f"{self._prefix}{trace_info} {event.command_name} "
                f"{status} in {event.duration_ms}ms{confidence_info}{error_info}"
            )

    def flush(self) -> None:
        pass


# =============================================================================
# TRACING TYPES (OpenTelemetry-compatible)
# =============================================================================


@runtime_checkable
class Span(Protocol):
    """Span interface compatible with OpenTelemetry."""

    def set_attribute(self, key: str, value: Union[str, int, float, bool]) -> None: ...
    def set_status(self, status: Dict[str, Any]) -> None: ...
    def end(self) -> None: ...


@runtime_checkable
class Tracer(Protocol):
    """Tracer interface compatible with OpenTelemetry."""

    async def start_active_span(
        self,
        name: str,
        fn: Callable[[Span], Awaitable[Any]],
    ) -> Any: ...


# =============================================================================
# AUTO TRACE ID MIDDLEWARE
# =============================================================================


def create_auto_trace_id_middleware(
    generate: Optional[Callable[[], str]] = None,
) -> CommandMiddleware:
    """Create middleware that auto-generates context.trace_id when missing.

    Must be outermost middleware so logging/timing see the generated trace ID.

    Args:
        generate: Custom ID generator. Defaults to uuid4().
    """
    gen = generate or (lambda: str(uuid4()))

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        if not context.trace_id:
            context.trace_id = gen()
        return await next_fn()

    return middleware


# =============================================================================
# LOGGING MIDDLEWARE
# =============================================================================


def create_logging_middleware(
    *,
    log: Optional[Callable[..., None]] = None,
    log_input: bool = False,
    log_result: bool = False,
) -> CommandMiddleware:
    """Create structured logging middleware.

    Args:
        log: Log function. Defaults to logging.getLogger("afd.middleware").info.
        log_input: Include input in logs (may contain sensitive data).
        log_result: Include full result in logs.
    """
    logger = logging.getLogger("afd.middleware")
    log_fn = log or logger.info

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        start = time.monotonic()
        trace_id = context.trace_id or "no-trace"

        if log_input:
            log_fn(f"[{trace_id}] Executing: {command_name}", {"input": input})
        else:
            log_fn(f"[{trace_id}] Executing: {command_name}")

        try:
            result = await next_fn()
            duration_ms = (time.monotonic() - start) * 1000
            status = "SUCCESS" if result.success else "FAILURE"

            if log_result:
                log_fn(
                    f"[{trace_id}] Completed: {command_name} ({duration_ms:.0f}ms) - {status}",
                    {"result": result},
                )
            else:
                log_fn(
                    f"[{trace_id}] Completed: {command_name} ({duration_ms:.0f}ms) - {status}"
                )

            return result
        except Exception as exc:
            duration_ms = (time.monotonic() - start) * 1000
            log_fn(f"[{trace_id}] Error: {command_name} ({duration_ms:.0f}ms)", {"error": exc})
            raise

    return middleware


# =============================================================================
# TIMING MIDDLEWARE
# =============================================================================


def create_timing_middleware(
    *,
    slow_threshold: float = 1000,
    on_slow: Optional[Callable[[str, float], None]] = None,
) -> CommandMiddleware:
    """Create timing middleware that warns on slow commands.

    Args:
        slow_threshold: Threshold in milliseconds. Default 1000ms.
        on_slow: Callback when threshold exceeded. Defaults to logging.warning.
    """
    default_on_slow = on_slow or (
        lambda name, ms: logging.getLogger("afd.middleware").warning(
            f"Slow command: {name} took {ms:.0f}ms"
        )
    )

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        start = time.monotonic()
        result = await next_fn()
        duration_ms = (time.monotonic() - start) * 1000

        if duration_ms > slow_threshold:
            default_on_slow(command_name, duration_ms)

        return result

    return middleware


# =============================================================================
# RETRY MIDDLEWARE
# =============================================================================


def create_retry_middleware(
    *,
    max_retries: int = 3,
    retry_delay: float = 100,
    should_retry: Optional[Callable[[str], bool]] = None,
) -> CommandMiddleware:
    """Create retry middleware for transient failures.

    Args:
        max_retries: Maximum number of retries. Default 3.
        retry_delay: Base delay between retries in ms. Default 100ms.
        should_retry: Predicate for retryable error codes.
            Defaults to TRANSIENT_ERROR and TIMEOUT.
    """
    _should_retry = should_retry or (
        lambda code: code in ("TRANSIENT_ERROR", "TIMEOUT")
    )

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        last_result: Optional[CommandResult[Any]] = None
        attempts = 0

        while attempts <= max_retries:
            result = await next_fn()

            if result.success:
                return result

            last_result = result

            if result.error and _should_retry(result.error.code):
                attempts += 1
                if attempts <= max_retries:
                    await asyncio.sleep(retry_delay * attempts / 1000)
                    continue

            break

        if last_result is None:
            from afd.core.result import failure

            return failure(
                CommandError(
                    code="RETRY_EXHAUSTED",
                    message="No result after retry attempts",
                    suggestion="Check the command implementation",
                )
            )
        return last_result

    return middleware


# =============================================================================
# TRACING MIDDLEWARE (OpenTelemetry-compatible)
# =============================================================================


def create_tracing_middleware(
    tracer: Tracer,
    *,
    span_prefix: str = "command",
) -> CommandMiddleware:
    """Create tracing middleware for OpenTelemetry integration.

    Args:
        tracer: OpenTelemetry-compatible tracer instance.
        span_prefix: Span name prefix. Default "command".
    """

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        async def span_fn(span: Span) -> CommandResult[Any]:
            span.set_attribute("command.name", command_name)
            span.set_attribute("command.trace_id", context.trace_id or "none")

            try:
                result = await next_fn()

                span.set_attribute("command.success", result.success)
                if not result.success and result.error:
                    span.set_attribute("error.code", result.error.code)
                    span.set_status({"code": 2, "message": result.error.message})
                else:
                    span.set_status({"code": 1})

                if result.confidence is not None:
                    span.set_attribute("command.confidence", result.confidence)

                span.end()
                return result
            except Exception as exc:
                span.set_attribute("error", True)
                span.set_status({
                    "code": 2,
                    "message": str(exc),
                })
                span.end()
                raise

        return await tracer.start_active_span(
            f"{span_prefix}.{command_name}", span_fn
        )

    return middleware


# =============================================================================
# RATE LIMITING MIDDLEWARE
# =============================================================================


def create_rate_limit_middleware(
    max_requests: int,
    window_ms: float,
    *,
    key_fn: Optional[Callable[[CommandContext], str]] = None,
) -> CommandMiddleware:
    """Create in-memory sliding window rate limiting middleware.

    Args:
        max_requests: Maximum requests per window.
        window_ms: Window size in milliseconds.
        key_fn: Key function for client identification. Defaults to 'global'.
    """
    _key_fn = key_fn or (lambda _ctx: "global")
    windows: Dict[str, Dict[str, Any]] = {}

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        key = _key_fn(context)
        now = time.monotonic() * 1000  # convert to ms

        window = windows.get(key)
        if window is None or now >= window["reset_at"]:
            window = {"count": 0, "reset_at": now + window_ms}
            windows[key] = window

        if window["count"] >= max_requests:
            retry_secs = max(1, int((window["reset_at"] - now) / 1000))
            return CommandResult(
                success=False,
                error=CommandError(
                    code="RATE_LIMITED",
                    message="Too many requests",
                    suggestion=f"Try again in {retry_secs} seconds",
                    retryable=True,
                ),
            )

        window["count"] += 1
        return await next_fn()

    return middleware


# =============================================================================
# TELEMETRY MIDDLEWARE
# =============================================================================


def create_telemetry_middleware(
    sink: TelemetrySink,
    *,
    include_input: bool = False,
    include_metadata: bool = True,
    filter_fn: Optional[Callable[[str], bool]] = None,
) -> CommandMiddleware:
    """Create telemetry middleware that records command execution events.

    Args:
        sink: Telemetry sink to record events.
        include_input: Include command input in events. Default False.
        include_metadata: Include result metadata in events. Default True.
        filter_fn: Filter function (return True to track). Default: track all.
    """
    _filter = filter_fn or (lambda _name: True)

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        if not _filter(command_name):
            return await next_fn()

        from datetime import datetime, timezone

        started_at = datetime.now(timezone.utc).isoformat()
        start_time = time.monotonic()

        result: Optional[CommandResult[Any]] = None
        thrown_error: Optional[Exception] = None

        try:
            result = await next_fn()
        except Exception as exc:
            thrown_error = exc
            raise
        finally:
            completed_at = datetime.now(timezone.utc).isoformat()
            duration_ms = (time.monotonic() - start_time) * 1000

            error_dict = None
            if thrown_error:
                error_dict = {
                    "code": "UNHANDLED_ERROR",
                    "message": str(thrown_error),
                }
            elif result and not result.success and result.error:
                error_dict = {
                    "code": result.error.code,
                    "message": result.error.message,
                }

            metadata_dict = None
            if (
                not thrown_error
                and result
                and include_metadata
                and result.metadata
            ):
                metadata_dict = result.metadata.model_dump()

            event = TelemetryEvent(
                command_name=command_name,
                started_at=started_at,
                completed_at=completed_at,
                duration_ms=duration_ms,
                success=False if thrown_error else (result.success if result else False),
                error=error_dict,
                trace_id=context.trace_id,
                input=input if include_input else None,
                confidence=(
                    result.confidence
                    if not thrown_error and result and result.confidence is not None
                    else None
                ),
                metadata=metadata_dict,
                command_version=(
                    result.metadata.command_version
                    if not thrown_error
                    and result
                    and result.metadata
                    and result.metadata.command_version
                    else None
                ),
            )

            try:
                record_result = sink.record(event)
                if asyncio.isfuture(record_result) or asyncio.iscoroutine(record_result):
                    try:
                        await record_result
                    except Exception:
                        pass
            except Exception:
                pass

        if result is None:
            from afd.core.result import failure

            return failure(
                CommandError(
                    code="TELEMETRY_NO_RESULT",
                    message="Command did not produce a result",
                    suggestion="Check the command implementation",
                )
            )
        return result

    return middleware


# =============================================================================
# COMPOSITION
# =============================================================================


def compose_middleware(*middlewares: CommandMiddleware) -> CommandMiddleware:
    """Compose multiple middleware functions into one.

    Middleware executes in order: first middleware is outermost.

    Args:
        *middlewares: Middleware functions to compose.
    """

    async def composed(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        index = 0

        async def dispatch() -> CommandResult[Any]:
            nonlocal index
            if index >= len(middlewares):
                return await next_fn()
            mw = middlewares[index]
            index += 1
            return await mw(command_name, input, context, dispatch)

        return await dispatch()

    return composed


def default_middleware(
    *,
    trace_id: Union[bool, Dict[str, Any], None] = None,
    logging_mw: Union[bool, Dict[str, Any], None] = None,
    timing: Union[bool, Dict[str, Any], None] = None,
) -> List[CommandMiddleware]:
    """Returns pre-configured middleware for common observability needs.

    Returns [trace_id, logging, timing] by default. Each can be disabled
    with False or configured with a dict of kwargs.

    Args:
        trace_id: False to disable, dict to configure, None for defaults.
        logging_mw: False to disable, dict to configure, None for defaults.
        timing: False to disable, dict to configure, None for defaults.
    """
    stack: List[CommandMiddleware] = []

    if trace_id is not False:
        kwargs = trace_id if isinstance(trace_id, dict) else {}
        stack.append(create_auto_trace_id_middleware(**kwargs))

    if logging_mw is not False:
        kwargs = logging_mw if isinstance(logging_mw, dict) else {}
        stack.append(create_logging_middleware(**kwargs))

    if timing is not False:
        kwargs = timing if isinstance(timing, dict) else {}
        stack.append(create_timing_middleware(**kwargs))

    return stack
