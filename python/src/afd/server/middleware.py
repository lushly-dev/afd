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
import math
import random
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import (
    Any,
    Awaitable,
    Callable,
    ContextManager,
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


def _write_stderr(message: str) -> None:
    """Write a line to stderr (stdout carries JSON-RPC on the stdio transport)."""
    print(message, file=sys.stderr, flush=True)


class ConsoleTelemetrySink:
    """Default telemetry sink that logs events to the console.

    Events go to stderr by default, never stdout: on the stdio transport,
    stdout carries the JSON-RPC stream and any other line corrupts it.

    Example:
        >>> sink = ConsoleTelemetrySink()  # human-readable, to stderr
        >>> sink = ConsoleTelemetrySink(json_mode=True)  # JSON output
        >>> sink = ConsoleTelemetrySink(log=logging.getLogger("telemetry").info)
    """

    def __init__(
        self,
        *,
        log: Optional[Callable[[str], None]] = None,
        json_mode: bool = False,
        prefix: str = "[Telemetry]",
    ):
        self._log = log or _write_stderr
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
    """Tracer interface compatible with OpenTelemetry Python SDK.

    Uses context manager pattern (start_as_current_span) matching the
    real OpenTelemetry Python API, not the JS callback pattern.
    """

    def start_as_current_span(self, name: str) -> ContextManager[Span]: ...


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


def _retry_wait_ms(retry: int, base_ms: float, max_ms: float, jitter: bool) -> float:
    """The wait before retry ``retry`` (1-based), in milliseconds.

    Exponential from ``base_ms``, capped at ``max_ms``, and with jitter a
    uniform value in ``[backoff / 2, backoff]``. The exponent is bounded so a
    large retry count cannot overflow the float conversion.
    """
    backoff = min(max_ms, base_ms * 2.0 ** min(retry - 1, 1023))
    return random.uniform(backoff / 2, backoff) if jitter else backoff


def create_retry_middleware(
    *,
    max_retries: int = 3,
    retry_delay: float = 100,
    should_retry: Optional[Callable[[str], bool]] = None,
    max_delay: float = 5000,
    jitter: bool = True,
) -> CommandMiddleware:
    """Create retry middleware for transient failures.

    A failure whose error code passes ``should_retry`` is retried up to
    ``max_retries`` times with capped exponential backoff, as in TypeScript's
    ``createRetryMiddleware``: retry ``n`` backs off
    ``min(max_delay, retry_delay * 2 ** (n - 1))`` ms. Cancelling the call
    (``asyncio.CancelledError``) during a wait stops retrying at once.

    Args:
        max_retries: Maximum number of retries after the first attempt. Default 3.
        retry_delay: Base backoff in ms, doubled for each retry. Default 100ms.
        should_retry: Predicate for retryable error codes.
            Defaults to TRANSIENT_ERROR and TIMEOUT.
        max_delay: Upper bound on the backoff of any retry in ms, before
            jitter. Default 5000ms.
        jitter: Randomize each wait to between half and all of the backoff,
            so clients that failed together do not retry in lockstep. Default
            True; False waits exactly the backoff.

    Raises:
        ValueError: If ``max_retries`` is not a nonnegative integer, or
            ``retry_delay`` or ``max_delay`` is negative, or ``max_delay`` is
            not finite.
    """
    if isinstance(max_retries, bool) or not isinstance(max_retries, int) or max_retries < 0:
        raise ValueError("Retry max_retries must be a nonnegative integer")
    if not (retry_delay >= 0 and max_delay >= 0 and math.isfinite(max_delay)):
        raise ValueError(
            "Retry retry_delay and max_delay must be nonnegative, and max_delay finite"
        )
    _should_retry = should_retry or (
        lambda code: code in ("TRANSIENT_ERROR", "TIMEOUT")
    )

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        result = await next_fn()
        for retry in range(1, max_retries + 1):
            if result.success or not result.error or not _should_retry(result.error.code):
                return result
            await asyncio.sleep(_retry_wait_ms(retry, retry_delay, max_delay, jitter) / 1000)
            result = await next_fn()
        return result

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
        with tracer.start_as_current_span(f"{span_prefix}.{command_name}") as span:
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

                return result
            except Exception as exc:
                span.set_attribute("error", True)
                span.set_status({
                    "code": 2,
                    "message": str(exc),
                })
                raise

    return middleware


# =============================================================================
# RATE LIMITING MIDDLEWARE
# =============================================================================


DEFAULT_RATE_LIMIT_MAX_KEYS = 10_000
"""Default number of distinct clients the rate limiter tracks at once."""


def create_rate_limit_middleware(
    max_requests: int,
    window_ms: float,
    *,
    key_fn: Optional[Callable[[CommandContext], str]] = None,
    max_keys: int = DEFAULT_RATE_LIMIT_MAX_KEYS,
) -> CommandMiddleware:
    """Create in-memory fixed-window rate limiting middleware.

    Each key may make ``max_requests`` calls per window. A key's window
    starts at its first call and ends ``window_ms`` later, when its count
    resets. This is a fixed window, not a sliding one: a client can make up
    to ``2 * max_requests`` calls across a window boundary.

    Memory is bounded. Expired windows are evicted as calls arrive, so idle
    keys do not accumulate, and at most ``max_keys`` keys are tracked at
    once: a new key beyond that is rejected with ``RATE_LIMITED`` until a
    window expires (tracked keys are never evicted early, which would reset
    their budget). Same behavior as the TypeScript middleware.

    Args:
        max_requests: Maximum requests per window.
        window_ms: Window size in milliseconds.
        key_fn: Key function for client identification. Defaults to 'global'
            (one budget shared by everyone). Key on a caller identity; a
            per-call value such as ``trace_id`` never limits anything.
        max_keys: Maximum distinct keys tracked at once (default 10,000).

    Raises:
        ValueError: If ``window_ms`` or ``max_keys`` is not positive, or
            ``max_requests`` is negative (0 rejects every call).
    """
    if max_requests < 0 or window_ms <= 0 or max_keys < 1:
        raise ValueError(
            "Rate limit window_ms and max_keys must be positive and max_requests not negative"
        )
    _key_fn = key_fn or (lambda _ctx: "global")
    # key -> [count, reset_at]. Every window has the same length and starts at
    # a monotonic "now", so insertion order is expiry order.
    windows: "OrderedDict[str, List[float]]" = OrderedDict()

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        key = _key_fn(context)
        now = time.monotonic() * 1000  # convert to ms

        while windows:
            _, oldest = next(iter(windows.items()))
            if oldest[1] > now:
                break
            windows.popitem(last=False)

        window = windows.get(key)
        if window is None:
            if len(windows) >= max_keys:
                return CommandResult(
                    success=False,
                    error=CommandError(
                        code="RATE_LIMITED",
                        message="Rate limit client capacity reached",
                        suggestion="Retry after the current rate limit window expires",
                        retryable=True,
                    ),
                )
            window = [0, now + window_ms]
            windows[key] = window

        if window[0] >= max_requests:
            retry_secs = max(1, math.ceil((window[1] - now) / 1000))
            return CommandResult(
                success=False,
                error=CommandError(
                    code="RATE_LIMITED",
                    message="Too many requests",
                    suggestion=f"Try again in {retry_secs} seconds",
                    retryable=True,
                ),
            )

        window[0] += 1
        return await next_fn()

    middleware._windows = windows  # type: ignore[attr-defined]  # for tests
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

            # A failing sink must not change the command result, but is logged.
            try:
                record_result = sink.record(event)
                if asyncio.isfuture(record_result) or asyncio.iscoroutine(record_result):
                    await record_result
            except Exception:
                logging.getLogger("afd.middleware").warning(
                    "Telemetry sink failed to record '%s'", command_name, exc_info=True
                )

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
        async def dispatch(i: int = 0) -> CommandResult[Any]:
            if i >= len(middlewares):
                return await next_fn()
            mw = middlewares[i]
            return await mw(command_name, input, context, lambda: dispatch(i + 1))

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
