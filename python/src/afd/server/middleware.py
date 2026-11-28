"""Command middleware for AFD servers.

Middleware functions wrap command execution to add cross-cutting concerns
like logging, tracing, rate limiting, retry, and telemetry.

The server runs middleware only for a call that will reach a handler: an
unknown, unexposed or out-of-context command, or invalid input, is rejected
before the chain starts. ``input`` is the validated input the handler
receives, so for a command with an input schema it is that schema's model
instance, not the raw arguments. An exception from the handler passes out
through the chain before the server turns it into COMMAND_EXECUTION_ERROR.

Example:
    >>> from afd.server import create_server, default_middleware
    >>> server = create_server("my-app", middleware=default_middleware())
"""

import asyncio
import logging
import math
import random
import time
from collections import OrderedDict
from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import UTC
from typing import (
    Any,
    Protocol,
    runtime_checkable,
)
from uuid import uuid4

from afd.core.actor import actor_kind_of
from afd.core.clock import system_clock
from afd.core.commands import (
    CommandContext,
)
from afd.core.commands import (
    CommandMiddleware as CommandMiddleware,
)
from afd.core.commands import (
    NextFn as NextFn,
)
from afd.core.errors import Recovery, _retry_after
from afd.core.result import CommandError, CommandResult
from afd.core.running_command import RunningCommand, pass_on_binding, running_command_entry
from afd.core.telemetry import TelemetryError as _TelemetryError
from afd.core.telemetry import TelemetryEvent as _TelemetryEvent
from afd.core.telemetry import TelemetrySink as _TelemetrySink
from afd.core.wire import to_wire
from afd.server.auth_middleware_check import carry_auth_middleware_mark
from afd.server.instance_state import carry_approval_process_state

# =============================================================================
# TELEMETRY TYPES
# =============================================================================

# The telemetry event, sink protocol and console sink are afd.core.telemetry's (#1760). This
# module defined its own copies before; the names still resolve here, with a
# DeprecationWarning (see __getattr__ at the end of the module).
_DEPRECATED_TELEMETRY_NAMES = frozenset({"TelemetryEvent", "TelemetrySink", "ConsoleTelemetrySink"})


# =============================================================================
# TRACING TYPES (OpenTelemetry-compatible)
# =============================================================================


@runtime_checkable
class Span(Protocol):
    """Span interface compatible with OpenTelemetry."""

    def set_attribute(self, key: str, value: str | int | float | bool) -> None: ...
    def set_status(self, status: dict[str, Any]) -> None: ...
    def end(self) -> None: ...


@runtime_checkable
class Tracer(Protocol):
    """Tracer interface compatible with OpenTelemetry Python SDK.

    Uses context manager pattern (start_as_current_span) matching the
    real OpenTelemetry Python API, not the JS callback pattern.
    """

    def start_as_current_span(self, name: str) -> AbstractContextManager[Span]: ...


# =============================================================================
# AUTO TRACE ID MIDDLEWARE
# =============================================================================


def create_auto_trace_id_middleware(
    generate: Callable[[], str] | None = None,
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
    log: Callable[..., None] | None = None,
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
                log_fn(f"[{trace_id}] Completed: {command_name} ({duration_ms:.0f}ms) - {status}")

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
    on_slow: Callable[[str, float], None] | None = None,
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
        # The context clock, so a test can drive a slow command with fixed_clock().
        clock = getattr(context, "clock", None) or system_clock
        start = clock.now()
        result = await next_fn()
        duration_ms = max(0, clock.now() - start)

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


def _may_repeat(entry: RunningCommand | None) -> bool:
    """Whether R1 lets the retry middleware repeat the call ``entry`` describes."""
    if entry is None:
        return False
    if entry.idempotency == "natural":
        return True
    if entry.idempotency == "keyed":
        return entry.has_key
    return entry.mutation is False


def create_retry_middleware(
    *,
    max_retries: int = 3,
    retry_delay: float = 100,
    should_retry: Callable[[str], bool] | None = None,
    max_delay: float = 5000,
    jitter: bool = True,
    retry_mutations: bool = False,
) -> CommandMiddleware:
    """Create retry middleware for transient failures.

    A failure whose error code passes ``should_retry`` is retried up to
    ``max_retries`` times with capped exponential backoff, as in TypeScript's
    ``createRetryMiddleware``: retry ``n`` backs off
    ``min(max_delay, retry_delay * 2 ** (n - 1))`` ms. Cancelling the call
    (``asyncio.CancelledError``) during a wait stops retrying at once.

    What it may repeat follows the command's declaration (``spec/idempotency.md``,
    R1), in this order: a command that declares ``idempotency="natural"`` is
    repeated; one that declares ``idempotency="keyed"`` is repeated only when the
    call carries an idempotency key and is not an MCP task run; any other command
    is repeated unless it declares ``mutation=True``. A failed mutation, such as
    one whose handler returned ``TIMEOUT`` after a downstream write, may already
    have applied its change. The declaration is read from the command the engine
    runs, never from its name; a call whose declaration cannot be read (outside
    the engine, or behind an outside engine's ``open_dispatch`` that does not
    declare it) counts as a mutation that declares nothing.

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
        retry_mutations: Retry every command, whatever it declares (R2).
            Default False. Set it only when every mutation the middleware wraps
            is safe to repeat.

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
    _should_retry = should_retry or (lambda code: code in ("TRANSIENT_ERROR", "TIMEOUT"))

    async def middleware(
        command_name: str,
        input: Any,
        context: CommandContext,
        next_fn: NextFn,
    ) -> CommandResult[Any]:
        # Read before the first attempt, while the engine's dispatch is open.
        repeatable = retry_mutations or _may_repeat(running_command_entry(context, next_fn))
        result = await next_fn()
        if not repeatable:
            return result
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
                span.set_status(
                    {
                        "code": 2,
                        "message": str(exc),
                    }
                )
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
    key_fn: Callable[[CommandContext], str] | None = None,
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
    windows: OrderedDict[str, list[float]] = OrderedDict()

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
                        # The limiter cannot say when a key's window frees: no minimum wait.
                        recovery=Recovery(kind="retry"),
                    ),
                )
            window = [0, now + window_ms]
            windows[key] = window

        if window[0] >= max_requests:
            remaining = (window[1] - now) / 1000
            # An endless window (window_ms=inf) has no wait the suggestion can give.
            retry_secs = max(1, math.ceil(remaining)) if math.isfinite(remaining) else None
            return CommandResult(
                success=False,
                error=CommandError(
                    code="RATE_LIMITED",
                    message="Too many requests",
                    suggestion=(
                        f"Try again in {retry_secs} seconds"
                        if retry_secs is not None
                        else "Retry after the current rate limit window expires"
                    ),
                    retryable=True,
                    # The same whole seconds the suggestion gives (spec/recovery.md).
                    recovery=_retry_after(retry_secs),
                ),
            )

        window[0] += 1
        return await next_fn()

    middleware._windows = windows  # type: ignore[attr-defined]  # for tests
    return middleware


# =============================================================================
# TELEMETRY MIDDLEWARE
# =============================================================================


def _iso_from_ms(ms: float) -> str:
    """An epoch-milliseconds instant as an ISO 8601 UTC timestamp."""
    from datetime import datetime, timedelta

    # Epoch plus a delta, not fromtimestamp(), which rejects negative instants on Windows.
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    return (epoch + timedelta(milliseconds=ms)).isoformat()


def create_telemetry_middleware(
    sink: _TelemetrySink,
    *,
    include_input: bool = False,
    include_metadata: bool = True,
    filter_fn: Callable[[str], bool] | None = None,
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

        clock = getattr(context, "clock", None) or system_clock
        start_time = clock.now()
        started_at = _iso_from_ms(start_time)

        result: CommandResult[Any] | None = None
        thrown_error: Exception | None = None

        try:
            result = await next_fn()
        except Exception as exc:
            thrown_error = exc
            raise
        finally:
            end_time = clock.now()
            completed_at = _iso_from_ms(end_time)
            duration_ms = max(0, end_time - start_time)

            event_error = None
            if thrown_error:
                event_error = _TelemetryError(code="UNHANDLED_ERROR", message=str(thrown_error))
            elif result and not result.success and result.error:
                event_error = _TelemetryError(code=result.error.code, message=result.error.message)

            metadata_dict = None
            if not thrown_error and result and include_metadata and result.metadata:
                # The wire form, as TypeScript records it: camelCase, unset fields left out.
                metadata_dict = to_wire(result.metadata)

            event = _TelemetryEvent(
                command_name=command_name,
                started_at=started_at,
                completed_at=completed_at,
                duration_ms=duration_ms,
                success=False if thrown_error else (result.success if result else False),
                error=event_error,
                trace_id=context.trace_id,
                actor_kind=actor_kind_of(getattr(context, "actor", None)),
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
        def step(i: int) -> NextFn:
            async def proceed() -> CommandResult[Any]:
                return await dispatch(i)

            # A continuation of an engine-built `next` is one too (`afd.core.running_command`).
            pass_on_binding(next_fn, proceed)
            return proceed

        async def dispatch(i: int = 0) -> CommandResult[Any]:
            if i >= len(middlewares):
                return await next_fn()
            mw = middlewares[i]
            return await mw(command_name, input, context, step(i + 1))

        return await dispatch()

    carry_approval_process_state(composed, middlewares)
    carry_auth_middleware_mark(composed, middlewares)
    # A composition holding AFD's journal is one too, for engines that check (`run_off_tape`).
    if any(getattr(middleware, "__afd_journal__", False) is True for middleware in middlewares):
        composed.__afd_journal__ = True  # type: ignore[attr-defined]
    return composed


def default_middleware(
    *,
    trace_id: bool | dict[str, Any] | None = None,
    logging_mw: bool | dict[str, Any] | None = None,
    timing: bool | dict[str, Any] | None = None,
) -> list[CommandMiddleware]:
    """Returns pre-configured middleware for common observability needs.

    Returns [trace_id, logging, timing] by default. Each can be disabled
    with False or configured with a dict of kwargs.

    Args:
        trace_id: False to disable, dict to configure, None for defaults.
        logging_mw: False to disable, dict to configure, None for defaults.
        timing: False to disable, dict to configure, None for defaults.
    """
    stack: list[CommandMiddleware] = []

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


def __getattr__(name: str) -> Any:
    if name in _DEPRECATED_TELEMETRY_NAMES:
        import warnings

        from afd.core import telemetry

        warnings.warn(
            f"afd.server.middleware.{name} is deprecated: it is afd.core.telemetry.{name}, the "
            f"one telemetry type. Import it from afd (or afd.core, or afd.server) instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return getattr(telemetry, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
