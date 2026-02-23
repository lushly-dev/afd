"""Tests for the middleware module."""

import asyncio
from contextlib import contextmanager
import json

import pytest

from afd import success, error
from afd.core.commands import CommandContext
from afd.core.result import CommandError, CommandResult
from afd.server import create_server
from afd.server.middleware import (
    CommandMiddleware,
    ConsoleTelemetrySink,
    NextFn,
    TelemetryEvent,
    compose_middleware,
    create_auto_trace_id_middleware,
    create_logging_middleware,
    create_rate_limit_middleware,
    create_retry_middleware,
    create_telemetry_middleware,
    create_timing_middleware,
    create_tracing_middleware,
    default_middleware,
)


# =============================================================================
# Helpers
# =============================================================================


def make_context(**kwargs) -> CommandContext:
    return CommandContext(**kwargs)


async def success_handler() -> CommandResult:
    return success({"ok": True}, confidence=0.9, reasoning="test")


async def failure_handler() -> CommandResult:
    return error("TEST_ERROR", "something went wrong", suggestion="try again")


async def slow_handler() -> CommandResult:
    await asyncio.sleep(0.05)  # 50ms
    return success({"ok": True})


async def raising_handler() -> CommandResult:
    raise RuntimeError("boom")


# =============================================================================
# Auto Trace ID Middleware
# =============================================================================


class TestAutoTraceIdMiddleware:
    @pytest.mark.asyncio
    async def test_generates_trace_id_when_missing(self):
        mw = create_auto_trace_id_middleware()
        ctx = make_context()
        assert ctx.trace_id is None

        result = await mw("test-cmd", {}, ctx, success_handler)
        assert result.success is True
        assert ctx.trace_id is not None
        assert len(ctx.trace_id) > 0

    @pytest.mark.asyncio
    async def test_preserves_existing_trace_id(self):
        mw = create_auto_trace_id_middleware()
        ctx = make_context(trace_id="existing-123")

        await mw("test-cmd", {}, ctx, success_handler)
        assert ctx.trace_id == "existing-123"

    @pytest.mark.asyncio
    async def test_custom_generator(self):
        counter = [0]

        def gen():
            counter[0] += 1
            return f"custom-{counter[0]}"

        mw = create_auto_trace_id_middleware(generate=gen)
        ctx = make_context()

        await mw("test-cmd", {}, ctx, success_handler)
        assert ctx.trace_id == "custom-1"

    @pytest.mark.asyncio
    async def test_propagates_errors(self):
        mw = create_auto_trace_id_middleware()
        ctx = make_context()

        with pytest.raises(RuntimeError, match="boom"):
            await mw("test-cmd", {}, ctx, raising_handler)

        # Trace ID should still be set even on error
        assert ctx.trace_id is not None

    @pytest.mark.asyncio
    async def test_passes_through_failure_result(self):
        mw = create_auto_trace_id_middleware()
        ctx = make_context()

        result = await mw("test-cmd", {}, ctx, failure_handler)
        assert result.success is False
        assert result.error.code == "TEST_ERROR"


# =============================================================================
# Logging Middleware
# =============================================================================


class TestLoggingMiddleware:
    @pytest.mark.asyncio
    async def test_logs_start_and_complete(self):
        messages = []
        mw = create_logging_middleware(log=lambda msg, *args: messages.append(msg))
        ctx = make_context(trace_id="trace-1")

        await mw("test-cmd", {}, ctx, success_handler)
        assert len(messages) == 2
        assert "Executing: test-cmd" in messages[0]
        assert "Completed: test-cmd" in messages[1]
        assert "SUCCESS" in messages[1]

    @pytest.mark.asyncio
    async def test_includes_trace_id(self):
        messages = []
        mw = create_logging_middleware(log=lambda msg, *args: messages.append(msg))
        ctx = make_context(trace_id="my-trace")

        await mw("test-cmd", {}, ctx, success_handler)
        assert "[my-trace]" in messages[0]
        assert "[my-trace]" in messages[1]

    @pytest.mark.asyncio
    async def test_log_input_option(self):
        calls = []
        mw = create_logging_middleware(
            log=lambda msg, *args: calls.append((msg, args)),
            log_input=True,
        )
        ctx = make_context(trace_id="t1")

        await mw("test-cmd", {"key": "val"}, ctx, success_handler)
        # First call should include input
        assert len(calls[0][1]) > 0
        assert calls[0][1][0]["input"] == {"key": "val"}

    @pytest.mark.asyncio
    async def test_log_result_option(self):
        calls = []
        mw = create_logging_middleware(
            log=lambda msg, *args: calls.append((msg, args)),
            log_result=True,
        )
        ctx = make_context(trace_id="t1")

        await mw("test-cmd", {}, ctx, success_handler)
        # Second call (complete) should include result
        assert len(calls[1][1]) > 0
        assert "result" in calls[1][1][0]

    @pytest.mark.asyncio
    async def test_logs_errors(self):
        messages = []
        mw = create_logging_middleware(log=lambda msg, *args: messages.append(msg))
        ctx = make_context(trace_id="t1")

        with pytest.raises(RuntimeError):
            await mw("test-cmd", {}, ctx, raising_handler)

        assert len(messages) == 2
        assert "Error: test-cmd" in messages[1]


# =============================================================================
# Timing Middleware
# =============================================================================


class TestTimingMiddleware:
    @pytest.mark.asyncio
    async def test_no_warning_below_threshold(self):
        warnings = []
        mw = create_timing_middleware(
            slow_threshold=1000,
            on_slow=lambda name, ms: warnings.append((name, ms)),
        )
        ctx = make_context()

        await mw("test-cmd", {}, ctx, success_handler)
        assert len(warnings) == 0

    @pytest.mark.asyncio
    async def test_warns_above_threshold(self):
        warnings = []
        mw = create_timing_middleware(
            slow_threshold=10,  # 10ms threshold
            on_slow=lambda name, ms: warnings.append((name, ms)),
        )
        ctx = make_context()

        await mw("test-cmd", {}, ctx, slow_handler)  # 50ms sleep
        assert len(warnings) == 1
        assert warnings[0][0] == "test-cmd"
        assert warnings[0][1] >= 10

    @pytest.mark.asyncio
    async def test_custom_callback(self):
        recorded = []

        def custom_cb(name, ms):
            recorded.append({"command": name, "duration": ms})

        mw = create_timing_middleware(slow_threshold=1, on_slow=custom_cb)
        ctx = make_context()

        await mw("test-cmd", {}, ctx, slow_handler)
        assert len(recorded) == 1
        assert recorded[0]["command"] == "test-cmd"

    @pytest.mark.asyncio
    async def test_custom_threshold(self):
        warnings = []
        mw = create_timing_middleware(
            slow_threshold=100,  # 100ms threshold
            on_slow=lambda name, ms: warnings.append((name, ms)),
        )
        ctx = make_context()

        # 50ms sleep should NOT trigger 100ms threshold
        await mw("test-cmd", {}, ctx, slow_handler)
        assert len(warnings) == 0


# =============================================================================
# Retry Middleware
# =============================================================================


class TestRetryMiddleware:
    @pytest.mark.asyncio
    async def test_success_first_try(self):
        call_count = [0]

        async def handler():
            call_count[0] += 1
            return success({"ok": True})

        mw = create_retry_middleware(max_retries=3, retry_delay=1)
        ctx = make_context()

        result = await mw("test-cmd", {}, ctx, handler)
        assert result.success is True
        assert call_count[0] == 1

    @pytest.mark.asyncio
    async def test_retries_on_transient_error(self):
        call_count = [0]

        async def handler():
            call_count[0] += 1
            if call_count[0] < 3:
                return error("TRANSIENT_ERROR", "temporary", suggestion="retry")
            return success({"ok": True})

        mw = create_retry_middleware(max_retries=3, retry_delay=1)
        ctx = make_context()

        result = await mw("test-cmd", {}, ctx, handler)
        assert result.success is True
        assert call_count[0] == 3

    @pytest.mark.asyncio
    async def test_max_retries_exhausted(self):
        call_count = [0]

        async def handler():
            call_count[0] += 1
            return error("TRANSIENT_ERROR", "always fails", suggestion="retry")

        mw = create_retry_middleware(max_retries=2, retry_delay=1)
        ctx = make_context()

        result = await mw("test-cmd", {}, ctx, handler)
        assert result.success is False
        assert result.error.code == "TRANSIENT_ERROR"
        # 1 initial + 2 retries = 3
        assert call_count[0] == 3

    @pytest.mark.asyncio
    async def test_custom_should_retry(self):
        call_count = [0]

        async def handler():
            call_count[0] += 1
            return error("CUSTOM_ERROR", "custom", suggestion="retry")

        mw = create_retry_middleware(
            max_retries=2,
            retry_delay=1,
            should_retry=lambda code: code == "CUSTOM_ERROR",
        )
        ctx = make_context()

        result = await mw("test-cmd", {}, ctx, handler)
        assert result.success is False
        assert call_count[0] == 3  # 1 initial + 2 retries

    @pytest.mark.asyncio
    async def test_no_retry_for_non_retryable(self):
        call_count = [0]

        async def handler():
            call_count[0] += 1
            return error("VALIDATION_ERROR", "bad input", suggestion="fix input")

        mw = create_retry_middleware(max_retries=3, retry_delay=1)
        ctx = make_context()

        result = await mw("test-cmd", {}, ctx, handler)
        assert result.success is False
        assert call_count[0] == 1  # No retries


# =============================================================================
# Tracing Middleware
# =============================================================================


class MockSpan:
    def __init__(self):
        self.attributes = {}
        self.status = None
        self.ended = False

    def set_attribute(self, key, value):
        self.attributes[key] = value

    def set_status(self, status):
        self.status = status

    def end(self):
        self.ended = True


class MockTracer:
    def __init__(self):
        self.spans = []

    @contextmanager
    def start_as_current_span(self, name):
        span = MockSpan()
        span.name = name
        self.spans.append(span)
        try:
            yield span
        finally:
            span.end()


class TestTracingMiddleware:
    @pytest.mark.asyncio
    async def test_creates_span(self):
        tracer = MockTracer()
        mw = create_tracing_middleware(tracer)
        ctx = make_context(trace_id="trace-1")

        await mw("test-cmd", {}, ctx, success_handler)

        assert len(tracer.spans) == 1
        span = tracer.spans[0]
        assert span.name == "command.test-cmd"
        assert span.ended is True

    @pytest.mark.asyncio
    async def test_sets_attributes(self):
        tracer = MockTracer()
        mw = create_tracing_middleware(tracer)
        ctx = make_context(trace_id="trace-1")

        await mw("test-cmd", {}, ctx, success_handler)

        span = tracer.spans[0]
        assert span.attributes["command.name"] == "test-cmd"
        assert span.attributes["command.trace_id"] == "trace-1"
        assert span.attributes["command.success"] is True
        assert span.attributes["command.confidence"] == 0.9

    @pytest.mark.asyncio
    async def test_error_status(self):
        tracer = MockTracer()
        mw = create_tracing_middleware(tracer)
        ctx = make_context()

        await mw("test-cmd", {}, ctx, failure_handler)

        span = tracer.spans[0]
        assert span.attributes["command.success"] is False
        assert span.attributes["error.code"] == "TEST_ERROR"
        assert span.status["code"] == 2

    @pytest.mark.asyncio
    async def test_exception_handling(self):
        tracer = MockTracer()
        mw = create_tracing_middleware(tracer)
        ctx = make_context()

        with pytest.raises(RuntimeError, match="boom"):
            await mw("test-cmd", {}, ctx, raising_handler)

        span = tracer.spans[0]
        assert span.attributes["error"] is True
        assert span.status["code"] == 2
        assert span.ended is True


# =============================================================================
# Rate Limit Middleware
# =============================================================================


class TestRateLimitMiddleware:
    @pytest.mark.asyncio
    async def test_allows_under_limit(self):
        mw = create_rate_limit_middleware(max_requests=5, window_ms=60000)
        ctx = make_context()

        for _ in range(5):
            result = await mw("test-cmd", {}, ctx, success_handler)
            assert result.success is True

    @pytest.mark.asyncio
    async def test_blocks_over_limit(self):
        mw = create_rate_limit_middleware(max_requests=2, window_ms=60000)
        ctx = make_context()

        await mw("test-cmd", {}, ctx, success_handler)
        await mw("test-cmd", {}, ctx, success_handler)
        result = await mw("test-cmd", {}, ctx, success_handler)

        assert result.success is False
        assert result.error.code == "RATE_LIMITED"
        assert result.error.retryable is True

    @pytest.mark.asyncio
    async def test_window_reset(self):
        mw = create_rate_limit_middleware(max_requests=1, window_ms=1)  # 1ms window
        ctx = make_context()

        await mw("test-cmd", {}, ctx, success_handler)
        # Wait for window to expire
        await asyncio.sleep(0.01)  # 10ms

        result = await mw("test-cmd", {}, ctx, success_handler)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_custom_key_fn(self):
        mw = create_rate_limit_middleware(
            max_requests=1,
            window_ms=60000,
            key_fn=lambda ctx: ctx.trace_id or "anon",
        )

        # Different keys should have separate limits
        ctx1 = make_context(trace_id="user-1")
        ctx2 = make_context(trace_id="user-2")

        r1 = await mw("test-cmd", {}, ctx1, success_handler)
        r2 = await mw("test-cmd", {}, ctx2, success_handler)
        assert r1.success is True
        assert r2.success is True

        # Same key should be rate limited
        r3 = await mw("test-cmd", {}, ctx1, success_handler)
        assert r3.success is False

    @pytest.mark.asyncio
    async def test_error_format(self):
        mw = create_rate_limit_middleware(max_requests=0, window_ms=60000)
        ctx = make_context()

        result = await mw("test-cmd", {}, ctx, success_handler)
        assert result.error.code == "RATE_LIMITED"
        assert "Too many requests" in result.error.message
        assert "Try again in" in result.error.suggestion


# =============================================================================
# Telemetry Middleware
# =============================================================================


class RecordingSink:
    def __init__(self, *, raise_on_record=False):
        self.events: list[TelemetryEvent] = []
        self._raise = raise_on_record

    def record(self, event: TelemetryEvent) -> None:
        if self._raise:
            raise RuntimeError("sink error")
        self.events.append(event)

    def flush(self) -> None:
        pass


class AsyncRecordingSink:
    def __init__(self):
        self.events: list[TelemetryEvent] = []

    async def record(self, event: TelemetryEvent) -> None:
        self.events.append(event)

    def flush(self) -> None:
        pass


class TestTelemetryMiddleware:
    @pytest.mark.asyncio
    async def test_records_success(self):
        sink = RecordingSink()
        mw = create_telemetry_middleware(sink)
        ctx = make_context(trace_id="t1")

        await mw("test-cmd", {}, ctx, success_handler)

        assert len(sink.events) == 1
        event = sink.events[0]
        assert event.command_name == "test-cmd"
        assert event.success is True
        assert event.trace_id == "t1"
        assert event.duration_ms >= 0
        assert event.confidence == 0.9

    @pytest.mark.asyncio
    async def test_records_failure(self):
        sink = RecordingSink()
        mw = create_telemetry_middleware(sink)
        ctx = make_context()

        await mw("test-cmd", {}, ctx, failure_handler)

        event = sink.events[0]
        assert event.success is False
        assert event.error["code"] == "TEST_ERROR"

    @pytest.mark.asyncio
    async def test_sink_errors_are_swallowed(self):
        sink = RecordingSink(raise_on_record=True)
        mw = create_telemetry_middleware(sink)
        ctx = make_context()

        # Should not raise despite sink error
        result = await mw("test-cmd", {}, ctx, success_handler)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_include_input(self):
        sink = RecordingSink()
        mw = create_telemetry_middleware(sink, include_input=True)
        ctx = make_context()

        await mw("test-cmd", {"key": "val"}, ctx, success_handler)

        assert sink.events[0].input == {"key": "val"}

    @pytest.mark.asyncio
    async def test_exclude_input_by_default(self):
        sink = RecordingSink()
        mw = create_telemetry_middleware(sink)
        ctx = make_context()

        await mw("test-cmd", {"key": "val"}, ctx, success_handler)

        assert sink.events[0].input is None

    @pytest.mark.asyncio
    async def test_filter_fn(self):
        sink = RecordingSink()
        mw = create_telemetry_middleware(
            sink, filter_fn=lambda name: name != "internal-cmd"
        )
        ctx = make_context()

        await mw("public-cmd", {}, ctx, success_handler)
        await mw("internal-cmd", {}, ctx, success_handler)

        assert len(sink.events) == 1
        assert sink.events[0].command_name == "public-cmd"

    @pytest.mark.asyncio
    async def test_async_sink(self):
        sink = AsyncRecordingSink()
        mw = create_telemetry_middleware(sink)
        ctx = make_context()

        await mw("test-cmd", {}, ctx, success_handler)

        assert len(sink.events) == 1
        assert sink.events[0].success is True

    @pytest.mark.asyncio
    async def test_records_on_exception(self):
        sink = RecordingSink()
        mw = create_telemetry_middleware(sink)
        ctx = make_context()

        with pytest.raises(RuntimeError):
            await mw("test-cmd", {}, ctx, raising_handler)

        assert len(sink.events) == 1
        event = sink.events[0]
        assert event.success is False
        assert event.error["code"] == "UNHANDLED_ERROR"
        assert "boom" in event.error["message"]


# =============================================================================
# Console Telemetry Sink
# =============================================================================


class TestConsoleTelemetrySink:
    def test_human_readable_success(self):
        messages = []
        sink = ConsoleTelemetrySink(log=messages.append)

        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="2024-01-01T00:00:00Z",
            completed_at="2024-01-01T00:00:01Z",
            duration_ms=42,
            success=True,
        )
        sink.record(event)

        assert len(messages) == 1
        assert "test-cmd" in messages[0]
        assert "SUCCESS" in messages[0]
        assert "42" in messages[0]

    def test_human_readable_failure(self):
        messages = []
        sink = ConsoleTelemetrySink(log=messages.append)

        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="2024-01-01T00:00:00Z",
            completed_at="2024-01-01T00:00:01Z",
            duration_ms=10,
            success=False,
            error={"code": "FAIL", "message": "oops"},
        )
        sink.record(event)

        assert "FAILURE" in messages[0]
        assert "FAIL: oops" in messages[0]

    def test_json_mode(self):
        messages = []
        sink = ConsoleTelemetrySink(log=messages.append, json_mode=True)

        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="2024-01-01T00:00:00Z",
            completed_at="2024-01-01T00:00:01Z",
            duration_ms=42,
            success=True,
        )
        sink.record(event)

        parsed = json.loads(messages[0])
        assert parsed["command_name"] == "test-cmd"
        assert parsed["success"] is True
        assert parsed["_prefix"] == "[Telemetry]"

    def test_includes_trace_id(self):
        messages = []
        sink = ConsoleTelemetrySink(log=messages.append)

        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="",
            completed_at="",
            duration_ms=0,
            success=True,
            trace_id="trace-abc",
        )
        sink.record(event)

        assert "[trace-abc]" in messages[0]

    def test_includes_confidence(self):
        messages = []
        sink = ConsoleTelemetrySink(log=messages.append)

        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="",
            completed_at="",
            duration_ms=0,
            success=True,
            confidence=0.95,
        )
        sink.record(event)

        assert "(confidence: 0.95)" in messages[0]

    def test_custom_prefix(self):
        messages = []
        sink = ConsoleTelemetrySink(log=messages.append, prefix="[CMD]")

        event = TelemetryEvent(
            command_name="test-cmd",
            started_at="",
            completed_at="",
            duration_ms=0,
            success=True,
        )
        sink.record(event)

        assert messages[0].startswith("[CMD]")


# =============================================================================
# Compose Middleware
# =============================================================================


class TestComposeMiddleware:
    @pytest.mark.asyncio
    async def test_empty_composition(self):
        composed = compose_middleware()
        ctx = make_context()

        result = await composed("test-cmd", {}, ctx, success_handler)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_single_middleware(self):
        mw = create_auto_trace_id_middleware()
        composed = compose_middleware(mw)
        ctx = make_context()

        await composed("test-cmd", {}, ctx, success_handler)
        assert ctx.trace_id is not None

    @pytest.mark.asyncio
    async def test_multiple_ordering(self):
        order = []

        async def mw_a(name, input, ctx, next_fn):
            order.append("a-before")
            result = await next_fn()
            order.append("a-after")
            return result

        async def mw_b(name, input, ctx, next_fn):
            order.append("b-before")
            result = await next_fn()
            order.append("b-after")
            return result

        composed = compose_middleware(mw_a, mw_b)
        ctx = make_context()

        await composed("test-cmd", {}, ctx, success_handler)
        assert order == ["a-before", "b-before", "b-after", "a-after"]


# =============================================================================
# Default Middleware
# =============================================================================


class TestDefaultMiddleware:
    def test_returns_three_by_default(self):
        stack = default_middleware()
        assert len(stack) == 3

    def test_disable_trace_id(self):
        stack = default_middleware(trace_id=False)
        assert len(stack) == 2

    def test_disable_logging(self):
        stack = default_middleware(logging_mw=False)
        assert len(stack) == 2

    def test_disable_timing(self):
        stack = default_middleware(timing=False)
        assert len(stack) == 2

    def test_all_disabled(self):
        stack = default_middleware(trace_id=False, logging_mw=False, timing=False)
        assert len(stack) == 0

    @pytest.mark.asyncio
    async def test_custom_options(self):
        messages = []
        stack = default_middleware(
            logging_mw={"log": lambda msg, *args: messages.append(msg)},
        )
        ctx = make_context()

        # Compose and run
        composed = compose_middleware(*stack)
        await composed("test-cmd", {}, ctx, success_handler)

        assert ctx.trace_id is not None
        assert any("Executing" in m for m in messages)


# =============================================================================
# Integration Tests
# =============================================================================


class TestMiddlewareIntegration:
    @pytest.mark.asyncio
    async def test_server_with_middleware(self):
        messages = []
        server = create_server(
            "test-app",
            middleware=[
                create_auto_trace_id_middleware(),
                create_logging_middleware(
                    log=lambda msg, *args: messages.append(msg)
                ),
            ],
        )

        @server.command(name="echo", description="Echo input")
        async def echo(input):
            return success({"echo": input.get("message", "")})

        result = await server.execute("echo", {"message": "hello"})
        assert result.success is True
        assert result.data["echo"] == "hello"
        assert len(messages) >= 2  # start + complete

    @pytest.mark.asyncio
    async def test_onion_order(self):
        order = []

        async def outer_mw(name, input, ctx, next_fn):
            order.append("outer-in")
            result = await next_fn()
            order.append("outer-out")
            return result

        async def inner_mw(name, input, ctx, next_fn):
            order.append("inner-in")
            result = await next_fn()
            order.append("inner-out")
            return result

        server = create_server(
            "test-app",
            middleware=[outer_mw, inner_mw],
        )

        @server.command(name="ping", description="Ping")
        async def ping(input):
            order.append("handler")
            return success({"pong": True})

        await server.execute("ping", {})
        assert order == ["outer-in", "inner-in", "handler", "inner-out", "outer-out"]

    @pytest.mark.asyncio
    async def test_middleware_with_no_middleware(self):
        """Server without middleware should work normally."""
        server = create_server("test-app")

        @server.command(name="ping", description="Ping")
        async def ping(input):
            return success({"pong": True})

        result = await server.execute("ping", {})
        assert result.success is True

    @pytest.mark.asyncio
    async def test_full_default_stack(self):
        """Test with default_middleware() applied to server."""
        server = create_server(
            "test-app",
            middleware=default_middleware(
                logging_mw={"log": lambda msg, *args: None},
            ),
        )

        @server.command(name="test-cmd", description="Test")
        async def test_cmd(input):
            return success({"ok": True})

        result = await server.execute("test-cmd", {})
        assert result.success is True
