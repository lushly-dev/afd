"""Tests for afd.core.batch module."""

import pytest

from afd.core.batch import (
    BatchCommand,
    BatchCommandResult,
    BatchOptions,
    BatchRequest,
    BatchResult,
    BatchSummary,
    BatchTiming,
    BatchWarning,
    calculate_batch_confidence,
    create_batch_request,
    create_batch_result,
    create_failed_batch_result,
    is_batch_command,
    is_batch_request,
    is_batch_result,
)
from afd.core.errors import CommandError
from afd.core.metadata import Warning
from afd.core.result import CommandResult, error as result_error, success as result_success


def _make_success_result(confidence=None, warnings=None):
    """Helper to create a successful CommandResult."""
    return result_success(
        {"id": "1"},
        confidence=confidence,
        warnings=warnings,
    )


def _make_failure_result():
    """Helper to create a failed CommandResult."""
    return result_error("FAIL", "Something failed")


def _make_batch_command_result(id, index, command, result, duration_ms=10):
    """Helper to create a BatchCommandResult."""
    return BatchCommandResult(
        id=id, index=index, command=command, result=result, duration_ms=duration_ms,
    )


def _make_timing():
    """Helper to create a BatchTiming."""
    return BatchTiming(
        total_ms=100,
        average_ms=50,
        started_at="2026-01-01T00:00:00Z",
        completed_at="2026-01-01T00:00:01Z",
    )


class TestBatchCommand:
    """Tests for BatchCommand Pydantic model."""

    def test_minimal_batch_command(self):
        cmd = BatchCommand(command="todo-create", input={"title": "Test"})
        assert cmd.command == "todo-create"
        assert cmd.input == {"title": "Test"}
        assert cmd.id is None

    def test_batch_command_with_id(self):
        cmd = BatchCommand(id="my-cmd", command="todo-list", input={})
        assert cmd.id == "my-cmd"

    def test_batch_command_no_input(self):
        cmd = BatchCommand(command="todo-list")
        assert cmd.input is None


class TestBatchOptions:
    """Tests for BatchOptions Pydantic model."""

    def test_defaults(self):
        opts = BatchOptions()
        assert opts.stop_on_error is False
        assert opts.timeout is None
        assert opts.parallelism == 1

    def test_custom_options(self):
        opts = BatchOptions(stop_on_error=True, timeout=5000, parallelism=4)
        assert opts.stop_on_error is True
        assert opts.timeout == 5000
        assert opts.parallelism == 4


class TestCreateBatchRequest:
    """Tests for create_batch_request factory."""

    def test_auto_assigns_ids(self):
        request = create_batch_request([
            {"command": "todo-create", "input": {"title": "A"}},
            {"command": "todo-create", "input": {"title": "B"}},
        ])
        assert len(request.commands) == 2
        assert request.commands[0].id == "cmd-0"
        assert request.commands[1].id == "cmd-1"

    def test_preserves_explicit_ids(self):
        request = create_batch_request([
            {"id": "my-id", "command": "todo-create", "input": {}},
        ])
        assert request.commands[0].id == "my-id"

    def test_passes_options(self):
        opts = BatchOptions(stop_on_error=True)
        request = create_batch_request(
            [{"command": "todo-list", "input": {}}],
            options=opts,
        )
        assert request.options is not None
        assert request.options.stop_on_error is True

    def test_empty_commands(self):
        request = create_batch_request([])
        assert len(request.commands) == 0

    def test_returns_batch_request_instance(self):
        request = create_batch_request([{"command": "test", "input": {}}])
        assert isinstance(request, BatchRequest)


class TestCalculateBatchConfidence:
    """Tests for calculate_batch_confidence."""

    def test_empty_results(self):
        assert calculate_batch_confidence([]) == 1.0

    def test_all_successful_default_confidence(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result()),
            _make_batch_command_result("1", 1, "b", _make_success_result()),
        ]
        # successRatio = 1.0, avgConfidence = 1.0 (default)
        # (1.0 * 0.5) + (1.0 * 0.5) = 1.0
        assert calculate_batch_confidence(results) == 1.0

    def test_all_successful_with_confidence(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result(confidence=0.8)),
            _make_batch_command_result("1", 1, "b", _make_success_result(confidence=0.6)),
        ]
        # successRatio = 1.0, avgConfidence = 0.7
        # (1.0 * 0.5) + (0.7 * 0.5) = 0.85
        assert calculate_batch_confidence(results) == pytest.approx(0.85)

    def test_mixed_results(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result(confidence=0.8)),
            _make_batch_command_result("1", 1, "b", _make_failure_result()),
        ]
        # successRatio = 0.5, avgConfidence = 0.8
        # (0.5 * 0.5) + (0.8 * 0.5) = 0.65
        assert calculate_batch_confidence(results) == pytest.approx(0.65)

    def test_all_failed(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_failure_result()),
            _make_batch_command_result("1", 1, "b", _make_failure_result()),
        ]
        # successRatio = 0, avgConfidence = 0
        # (0 * 0.5) + (0 * 0.5) = 0
        assert calculate_batch_confidence(results) == 0.0


class TestCreateBatchResult:
    """Tests for create_batch_result factory."""

    def test_all_successful(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result()),
            _make_batch_command_result("1", 1, "b", _make_success_result()),
        ]
        timing = _make_timing()
        batch = create_batch_result(results, timing)

        assert batch.success is True
        assert len(batch.results) == 2
        assert batch.summary.total == 2
        assert batch.summary.success_count == 2
        assert batch.summary.failure_count == 0
        assert batch.summary.skipped_count == 0
        assert batch.confidence == 1.0
        assert "all succeeded" in batch.reasoning

    def test_partial_failure(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result()),
            _make_batch_command_result("1", 1, "b", _make_failure_result()),
        ]
        timing = _make_timing()
        batch = create_batch_result(results, timing)

        assert batch.success is True
        assert batch.summary.success_count == 1
        assert batch.summary.failure_count == 1
        assert "1 succeeded" in batch.reasoning
        assert "1 failed" in batch.reasoning

    def test_collects_warnings(self):
        warning = Warning(code="SLOW", message="Command was slow")
        results = [
            _make_batch_command_result(
                "0", 0, "a",
                _make_success_result(warnings=[warning]),
            ),
        ]
        timing = _make_timing()
        batch = create_batch_result(results, timing)

        assert batch.warnings is not None
        assert len(batch.warnings) == 1
        assert batch.warnings[0].command_id == "0"
        assert batch.warnings[0].code == "SLOW"

    def test_no_warnings_when_none(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result()),
        ]
        timing = _make_timing()
        batch = create_batch_result(results, timing)
        assert batch.warnings is None

    def test_empty_results(self):
        timing = _make_timing()
        batch = create_batch_result([], timing)
        assert batch.success is True
        assert batch.summary.total == 0
        assert batch.confidence == 1.0

    def test_with_metadata(self):
        from afd.core.result import ResultMetadata
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result()),
        ]
        timing = _make_timing()
        meta = ResultMetadata(trace_id="trace-123")
        batch = create_batch_result(results, timing, metadata=meta)
        assert batch.metadata is not None
        assert batch.metadata.trace_id == "trace-123"


class TestCreateFailedBatchResult:
    """Tests for create_failed_batch_result factory."""

    def test_basic_failure(self):
        err = CommandError(code="TIMEOUT", message="Batch timed out")
        batch = create_failed_batch_result(err)

        assert batch.success is False
        assert len(batch.results) == 0
        assert batch.summary.total == 0
        assert batch.confidence == 0
        assert batch.error is not None
        assert batch.error.code == "TIMEOUT"
        assert "Batch execution failed" in batch.reasoning

    def test_with_timing(self):
        err = CommandError(code="ERROR", message="Failed")
        batch = create_failed_batch_result(
            err,
            total_ms=500,
            started_at="2026-01-01T00:00:00Z",
            completed_at="2026-01-01T00:00:01Z",
        )
        assert batch.timing.total_ms == 500
        assert batch.timing.started_at == "2026-01-01T00:00:00Z"
        assert batch.timing.completed_at == "2026-01-01T00:00:01Z"

    def test_default_timing_uses_now(self):
        err = CommandError(code="ERROR", message="Failed")
        batch = create_failed_batch_result(err)
        # Should have valid ISO timestamps
        assert batch.timing.started_at is not None
        assert batch.timing.completed_at is not None
        assert "T" in batch.timing.started_at  # ISO format check


class TestBatchTypeGuards:
    """Tests for batch type guard functions."""

    def test_is_batch_request_with_instance(self):
        request = BatchRequest(commands=[BatchCommand(command="test")])
        assert is_batch_request(request) is True

    def test_is_batch_request_with_dict(self):
        assert is_batch_request({"commands": [{"command": "test"}]}) is True

    def test_is_batch_request_with_invalid_dict(self):
        assert is_batch_request({"invalid": "data"}) is False

    def test_is_batch_request_with_non_list_commands(self):
        assert is_batch_request({"commands": "not-a-list"}) is False

    def test_is_batch_request_with_non_dict(self):
        assert is_batch_request("string") is False
        assert is_batch_request(None) is False
        assert is_batch_request(123) is False

    def test_is_batch_result_with_instance(self):
        err = CommandError(code="E", message="e")
        batch = create_failed_batch_result(err)
        assert is_batch_result(batch) is True

    def test_is_batch_result_with_dict(self):
        assert is_batch_result({
            "success": True,
            "results": [],
            "summary": {},
            "timing": {},
        }) is True

    def test_is_batch_result_with_missing_fields(self):
        assert is_batch_result({"success": True}) is False
        assert is_batch_result({"success": True, "results": []}) is False

    def test_is_batch_result_with_non_list_results(self):
        assert is_batch_result({
            "success": True,
            "results": "not-a-list",
            "summary": {},
            "timing": {},
        }) is False

    def test_is_batch_command_with_instance(self):
        cmd = BatchCommand(command="test")
        assert is_batch_command(cmd) is True

    def test_is_batch_command_with_dict(self):
        assert is_batch_command({"command": "todo-create", "input": {}}) is True

    def test_is_batch_command_with_non_string_command(self):
        assert is_batch_command({"command": 123}) is False

    def test_is_batch_command_with_non_dict(self):
        assert is_batch_command("string") is False
        assert is_batch_command(None) is False


class TestBatchReasoning:
    """Tests for batch reasoning generation."""

    def test_single_command_reasoning(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result()),
        ]
        timing = _make_timing()
        batch = create_batch_result(results, timing)
        assert batch.reasoning == "Executed 1 command: all succeeded"

    def test_multiple_commands_reasoning(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result()),
            _make_batch_command_result("1", 1, "b", _make_success_result()),
            _make_batch_command_result("2", 2, "c", _make_success_result()),
        ]
        timing = _make_timing()
        batch = create_batch_result(results, timing)
        assert batch.reasoning == "Executed 3 commands: all succeeded"

    def test_mixed_reasoning(self):
        results = [
            _make_batch_command_result("0", 0, "a", _make_success_result()),
            _make_batch_command_result("1", 1, "b", _make_failure_result()),
            _make_batch_command_result("2", 2, "c", _make_success_result()),
        ]
        timing = _make_timing()
        batch = create_batch_result(results, timing)
        assert "3 commands" in batch.reasoning
        assert "2 succeeded" in batch.reasoning
        assert "1 failed" in batch.reasoning
