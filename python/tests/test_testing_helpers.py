"""Tests for the AFD testing helpers."""

import pytest
from afd.core import CommandResult, success, failure, error, CommandDefinition, CommandParameter
from afd.core.errors import CommandError, wrap_error
from afd.testing.helpers import (
    CommandTestResult,
    create_test_context,
    test_command as run_test_command,
    test_command_definition as run_test_command_definition,
    test_command_multiple as run_test_command_multiple,
    create_mock_command,
    create_success_command,
    create_failure_command,
)


# ==============================================================================
# Test create_test_context
# ==============================================================================

class TestCreateTestContext:
    """Tests for create_test_context helper."""

    def test_creates_context_with_defaults(self):
        """Should create a context with trace_id, timeout, and extra."""
        ctx = create_test_context()
        assert ctx.trace_id is not None
        assert ctx.trace_id.startswith("test-")
        assert ctx.timeout == 5000
        assert ctx.extra["environment"] == "test"

    def test_overrides_fields(self):
        """Should allow overriding individual fields."""
        ctx = create_test_context({"timeout": 10000, "trace_id": "custom-trace"})
        assert ctx.timeout == 10000
        assert ctx.trace_id == "custom-trace"
        assert ctx.extra["environment"] == "test"

    def test_merges_extra(self):
        """Should merge extra dict rather than replacing."""
        ctx = create_test_context({"extra": {"user_id": "u1"}})
        assert ctx.extra["environment"] == "test"
        assert ctx.extra["user_id"] == "u1"

    def test_unique_trace_ids(self):
        """Each call should produce a unique trace_id."""
        ctx1 = create_test_context()
        ctx2 = create_test_context()
        assert ctx1.trace_id != ctx2.trace_id


# ==============================================================================
# Test test_command
# ==============================================================================

class TestTestCommand:
    """Tests for test_command helper."""

    @pytest.mark.asyncio
    async def test_success_handler(self):
        """Should capture successful handler result."""
        async def handler(input, context=None):
            return success({"id": input["id"]})

        tr = await run_test_command(handler, {"id": 42})
        assert tr.is_success
        assert not tr.is_failure
        assert tr.result.data["id"] == 42
        assert tr.execution_time_ms >= 0

    @pytest.mark.asyncio
    async def test_failure_handler(self):
        """Should capture failure handler result."""
        async def handler(input, context=None):
            return error("BAD_INPUT", "Nope")

        tr = await run_test_command(handler, {})
        assert tr.is_failure
        assert not tr.is_success
        assert tr.result.error.code == "BAD_INPUT"

    @pytest.mark.asyncio
    async def test_exception_wrapped(self):
        """Should wrap exceptions in failure result."""
        async def handler(input, context=None):
            raise ValueError("Boom")

        tr = await run_test_command(handler, {})
        assert tr.is_failure
        assert "Boom" in tr.result.error.message

    @pytest.mark.asyncio
    async def test_timing(self):
        """Should measure execution time."""
        import asyncio

        async def handler(input, context=None):
            await asyncio.sleep(0.05)
            return success("done")

        tr = await run_test_command(handler, {})
        assert tr.execution_time_ms >= 40  # at least ~50ms minus jitter

    @pytest.mark.asyncio
    async def test_validation_runs(self):
        """Should run validate_result on the output."""
        async def handler(input, context=None):
            return success({"id": 1})

        tr = await run_test_command(handler, {})
        assert tr.is_valid
        assert tr.validation.valid

    @pytest.mark.asyncio
    async def test_custom_context(self):
        """Should pass custom context to handler."""
        received_ctx = {}

        async def handler(input, context=None):
            received_ctx["trace_id"] = context.trace_id if context else None
            return success("ok")

        ctx = create_test_context({"trace_id": "custom-123"})
        await run_test_command(handler, {}, context=ctx)
        assert received_ctx["trace_id"] == "custom-123"


# ==============================================================================
# Test test_command_definition
# ==============================================================================

class TestTestCommandDefinition:
    """Tests for test_command_definition helper."""

    @pytest.mark.asyncio
    async def test_validates_definition_and_result(self):
        """Should validate both definition metadata and result."""
        async def handler(input, context=None):
            return success({"id": 1})

        cmd = CommandDefinition(
            name="todo-create",
            description="Create a new todo item",
            handler=handler,
            parameters=[
                CommandParameter(
                    name="title", type="string",
                    description="The todo title", required=True,
                ),
            ],
        )

        r = await run_test_command_definition(cmd, {"title": "Test"})
        assert r["definition_validation"].valid
        assert r["result_validation"].valid
        assert r["result"].success
        assert r["execution_time_ms"] >= 0

    @pytest.mark.asyncio
    async def test_catches_definition_errors(self):
        """Should report definition validation errors."""
        async def handler(input, context=None):
            return success("ok")

        # Invalid: single-word name (not kebab-case domain-action)
        cmd = CommandDefinition(
            name="x",
            description="Short",
            handler=handler,
            parameters=[],
        )

        r = await run_test_command_definition(cmd, {})
        # Definition has warnings (name format, short description)
        assert len(r["definition_validation"].warnings) > 0


# ==============================================================================
# Test test_command_multiple
# ==============================================================================

class TestTestCommandMultiple:
    """Tests for test_command_multiple helper."""

    @pytest.mark.asyncio
    async def test_batch_success(self):
        """Should test multiple inputs in batch."""
        async def handler(input, context=None):
            if "title" not in input:
                return error("VALIDATION_ERROR", "title required")
            return success({"title": input["title"]})

        cases = [
            {"input": {"title": "A"}, "expect_success": True, "description": "valid input"},
            {"input": {}, "expect_success": False, "expect_error": "VALIDATION_ERROR", "description": "missing title"},
        ]

        results = await run_test_command_multiple(handler, cases)
        assert len(results) == 2
        assert results[0]["passed"]
        assert results[0]["description"] == "valid input"
        assert results[1]["passed"]
        assert results[1]["description"] == "missing title"

    @pytest.mark.asyncio
    async def test_reports_failure_when_expectation_wrong(self):
        """Should report passed=False when expectation doesn't match."""
        async def handler(input, context=None):
            return success("always ok")

        cases = [
            {"input": {}, "expect_success": False},  # Wrong: handler always succeeds
        ]

        results = await run_test_command_multiple(handler, cases)
        assert not results[0]["passed"]


# ==============================================================================
# Test create_mock_command
# ==============================================================================

class TestCreateMockCommand:
    """Tests for create_mock_command helper."""

    @pytest.mark.asyncio
    async def test_wraps_return_in_success(self):
        """Should wrap handler return value in success()."""
        cmd = create_mock_command("user-get", lambda inp: {"id": inp.get("id", 1)})
        result = await cmd.handler({"id": 5}, None)
        assert result.success
        assert result.data["id"] == 5

    @pytest.mark.asyncio
    async def test_wraps_exception_in_failure(self):
        """Should wrap handler exceptions in failure()."""
        def broken(inp):
            raise RuntimeError("Boom")

        cmd = create_mock_command("broken-cmd", broken)
        result = await cmd.handler({}, None)
        assert not result.success
        assert "Boom" in result.error.message

    def test_metadata(self):
        """Should set name, description, and category."""
        cmd = create_mock_command("test-cmd", lambda inp: None)
        assert cmd.name == "test-cmd"
        assert "Mock command" in cmd.description
        assert cmd.category == "mock"

    @pytest.mark.asyncio
    async def test_async_mock_handler(self):
        """Should support async mock handlers."""
        async def async_handler(inp):
            return {"async": True}

        cmd = create_mock_command("async-cmd", async_handler)
        result = await cmd.handler({}, None)
        assert result.success
        assert result.data["async"] is True


# ==============================================================================
# Test create_success_command / create_failure_command
# ==============================================================================

class TestCreateSuccessCommand:
    """Tests for create_success_command helper."""

    @pytest.mark.asyncio
    async def test_always_succeeds(self):
        """Should always return success with fixed data."""
        cmd = create_success_command("health-check", {"status": "ok"})
        result = await cmd.handler({}, None)
        assert result.success
        assert result.data == {"status": "ok"}

    @pytest.mark.asyncio
    async def test_ignores_input(self):
        """Should return same data regardless of input."""
        cmd = create_success_command("echo", "hello")
        r1 = await cmd.handler({"a": 1}, None)
        r2 = await cmd.handler({"b": 2}, None)
        assert r1.data == r2.data == "hello"


class TestCreateFailureCommand:
    """Tests for create_failure_command helper."""

    @pytest.mark.asyncio
    async def test_always_fails(self):
        """Should always return failure with fixed error."""
        cmd = create_failure_command("broken", {"code": "BROKEN", "message": "Oops"})
        result = await cmd.handler({}, None)
        assert not result.success
        assert result.error.code == "BROKEN"
        assert result.error.message == "Oops"

    @pytest.mark.asyncio
    async def test_ignores_input(self):
        """Should return same error regardless of input."""
        cmd = create_failure_command("fail", {"code": "FAIL", "message": "No"})
        r1 = await cmd.handler({"x": 1}, None)
        r2 = await cmd.handler({"y": 2}, None)
        assert r1.error.code == r2.error.code == "FAIL"
