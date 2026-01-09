"""Tests for afd.core.result module."""

import pytest

from afd.core.result import (
    CommandError,
    CommandResult,
    ResultMetadata,
    error,
    failure,
    is_failure,
    is_success,
    success,
)


class TestCommandResult:
    """Tests for CommandResult type."""

    def test_success_result_has_data(self):
        result: CommandResult[dict] = CommandResult(
            success=True,
            data={"id": "123"},
        )
        assert result.success is True
        assert result.data == {"id": "123"}
        assert result.error is None

    def test_failure_result_has_error(self):
        result: CommandResult[dict] = CommandResult(
            success=False,
            error=CommandError(
                code="NOT_FOUND",
                message="Resource not found",
            ),
        )
        assert result.success is False
        assert result.data is None
        assert result.error is not None
        assert result.error.code == "NOT_FOUND"

    def test_ux_enabling_fields(self):
        result: CommandResult[str] = CommandResult(
            success=True,
            data="test",
            confidence=0.95,
            reasoning="High confidence match",
        )
        assert result.confidence == 0.95
        assert result.reasoning == "High confidence match"

    def test_confidence_validation(self):
        # Valid confidence
        result = CommandResult(success=True, data="x", confidence=0.5)
        assert result.confidence == 0.5

        # Boundary values
        result = CommandResult(success=True, data="x", confidence=0.0)
        assert result.confidence == 0.0

        result = CommandResult(success=True, data="x", confidence=1.0)
        assert result.confidence == 1.0

        # Invalid confidence (outside 0-1)
        with pytest.raises(ValueError):
            CommandResult(success=True, data="x", confidence=1.5)

        with pytest.raises(ValueError):
            CommandResult(success=True, data="x", confidence=-0.1)


class TestSuccessHelper:
    """Tests for success() helper function."""

    def test_basic_success(self):
        result = success({"id": "123"})
        assert result.success is True
        assert result.data == {"id": "123"}

    def test_success_with_reasoning(self):
        result = success(
            data={"name": "Test"},
            reasoning="Created with default values",
        )
        assert result.reasoning == "Created with default values"

    def test_success_with_confidence(self):
        result = success(data="matched", confidence=0.87)
        assert result.confidence == 0.87

    def test_success_with_metadata(self):
        metadata = ResultMetadata(
            execution_time_ms=125.5,
            trace_id="abc-123",
        )
        result = success(data={}, metadata=metadata)
        assert result.metadata is not None
        assert result.metadata.execution_time_ms == 125.5
        assert result.metadata.trace_id == "abc-123"


class TestFailureHelper:
    """Tests for failure() helper function."""

    def test_failure_from_command_error(self):
        err = CommandError(
            code="VALIDATION_ERROR",
            message="Invalid input",
            suggestion="Check required fields",
        )
        result = failure(err)
        assert result.success is False
        assert result.error is not None
        assert result.error.code == "VALIDATION_ERROR"

    def test_failure_with_metadata(self):
        err = CommandError(code="ERROR", message="Failed")
        metadata = ResultMetadata(execution_time_ms=50)
        result = failure(err, metadata=metadata)
        assert result.metadata is not None
        assert result.metadata.execution_time_ms == 50


class TestErrorHelper:
    """Tests for error() helper function."""

    def test_basic_error(self):
        result = error("NOT_FOUND", "Resource not found")
        assert result.success is False
        assert result.error is not None
        assert result.error.code == "NOT_FOUND"
        assert result.error.message == "Resource not found"

    def test_error_with_suggestion(self):
        result = error(
            "NOT_FOUND",
            "Resource not found",
            suggestion="Check the ID and try again",
        )
        assert result.error.suggestion == "Check the ID and try again"

    def test_error_with_retryable(self):
        result = error(
            "RATE_LIMITED",
            "Too many requests",
            retryable=True,
        )
        assert result.error.retryable is True

    def test_error_with_details(self):
        result = error(
            "VALIDATION_ERROR",
            "Invalid field",
            details={"field": "email", "constraint": "format"},
        )
        assert result.error.details == {"field": "email", "constraint": "format"}

    def test_error_with_all_fields(self):
        """Test error() helper with all fields (AFD compliance)."""
        result = error(
            "NOT_FOUND",
            "Todo not found",
            suggestion="Use todo.list to see available todos",
            retryable=False,
            details={"resource": "todo", "id": "abc123"},
        )
        assert result.success is False
        assert result.error.code == "NOT_FOUND"
        assert result.error.message == "Todo not found"
        assert result.error.suggestion == "Use todo.list to see available todos"
        assert result.error.retryable is False
        assert result.error.details == {"resource": "todo", "id": "abc123"}


class TestIsSuccess:
    """Tests for is_success() type guard."""

    def test_returns_true_for_success(self):
        result = success({"id": "123"})
        assert is_success(result) is True

    def test_returns_false_for_failure(self):
        result = error("ERROR", "Failed")
        assert is_success(result) is False

    def test_returns_false_when_data_is_none(self):
        result: CommandResult[None] = CommandResult(success=True, data=None)
        assert is_success(result) is False


class TestIsFailure:
    """Tests for is_failure() type guard."""

    def test_returns_true_for_failure(self):
        result = error("ERROR", "Failed")
        assert is_failure(result) is True

    def test_returns_false_for_success(self):
        result = success({"id": "123"})
        assert is_failure(result) is False

    def test_returns_false_when_error_is_none(self):
        result: CommandResult[None] = CommandResult(success=False, error=None)
        assert is_failure(result) is False


class TestResultMetadata:
    """Tests for ResultMetadata type."""

    def test_basic_metadata(self):
        metadata = ResultMetadata(
            execution_time_ms=100.5,
            command_version="1.0.0",
            trace_id="trace-123",
            timestamp="2024-01-15T10:30:00Z",
        )
        assert metadata.execution_time_ms == 100.5
        assert metadata.command_version == "1.0.0"
        assert metadata.trace_id == "trace-123"
        assert metadata.timestamp == "2024-01-15T10:30:00Z"

    def test_allows_extra_fields(self):
        metadata = ResultMetadata(
            execution_time_ms=50,
            custom_field="custom_value",  # type: ignore
        )
        assert metadata.execution_time_ms == 50
        # Extra fields are allowed due to Config.extra = "allow"
