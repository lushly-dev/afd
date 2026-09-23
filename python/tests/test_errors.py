"""Tests for afd.core.errors module."""

import pytest

from afd.core.errors import (
    CommandError,
    ErrorCodes,
    create_error,
    internal_error,
    is_command_error,
    not_found_error,
    rate_limit_error,
    timeout_error,
    validation_error,
    wrap_error,
)


class TestCommandError:
    """Tests for CommandError type."""

    def test_basic_error(self):
        err = CommandError(code="TEST_ERROR", message="Test message")
        assert err.code == "TEST_ERROR"
        assert err.message == "Test message"
        assert err.suggestion is None

    def test_full_error(self):
        err = CommandError(
            code="RATE_LIMITED",
            message="Too many requests",
            suggestion="Wait 60 seconds",
            retryable=True,
            details={"retry_after": 60},
        )
        assert err.code == "RATE_LIMITED"
        assert err.suggestion == "Wait 60 seconds"
        assert err.retryable is True
        assert err.details == {"retry_after": 60}

    def test_error_with_cause(self):
        cause = CommandError(code="ORIGINAL", message="Original error")
        err = CommandError(
            code="WRAPPED",
            message="Wrapped error",
            cause=cause,
        )
        assert err.cause is not None
        assert isinstance(err.cause, CommandError)
        assert err.cause.code == "ORIGINAL"


class TestErrorCodes:
    """Tests for ErrorCodes constants."""

    def test_validation_errors(self):
        assert ErrorCodes.VALIDATION_ERROR == "VALIDATION_ERROR"
        assert ErrorCodes.INVALID_INPUT == "INVALID_INPUT"
        assert ErrorCodes.MISSING_REQUIRED_FIELD == "MISSING_REQUIRED_FIELD"

    def test_resource_errors(self):
        assert ErrorCodes.NOT_FOUND == "NOT_FOUND"
        assert ErrorCodes.ALREADY_EXISTS == "ALREADY_EXISTS"
        assert ErrorCodes.CONFLICT == "CONFLICT"

    def test_auth_errors(self):
        assert ErrorCodes.UNAUTHORIZED == "UNAUTHORIZED"
        assert ErrorCodes.FORBIDDEN == "FORBIDDEN"

    def test_rate_limiting(self):
        assert ErrorCodes.RATE_LIMITED == "RATE_LIMITED"
        assert ErrorCodes.QUOTA_EXCEEDED == "QUOTA_EXCEEDED"

    def test_network_errors(self):
        assert ErrorCodes.SERVICE_UNAVAILABLE == "SERVICE_UNAVAILABLE"
        assert ErrorCodes.TIMEOUT == "TIMEOUT"

    def test_internal_errors(self):
        assert ErrorCodes.INTERNAL_ERROR == "INTERNAL_ERROR"
        assert ErrorCodes.NOT_IMPLEMENTED == "NOT_IMPLEMENTED"


class TestCreateError:
    """Tests for create_error() factory function."""

    def test_basic_error(self):
        err = create_error("CUSTOM_ERROR", "Something went wrong")
        assert err.code == "CUSTOM_ERROR"
        assert err.message == "Something went wrong"

    def test_error_with_all_fields(self):
        err = create_error(
            "CUSTOM",
            "Failed",
            suggestion="Try again",
            retryable=True,
            details={"key": "value"},
        )
        assert err.suggestion == "Try again"
        assert err.retryable is True
        assert err.details == {"key": "value"}

    def test_error_with_exception_cause(self):
        try:
            raise ValueError("Original error")
        except ValueError as e:
            err = create_error("WRAPPED", "Wrapped", cause=e)
            assert err.cause == "Original error"

    def test_error_with_command_error_cause(self):
        cause = CommandError(code="ORIGINAL", message="Original")
        err = create_error("WRAPPED", "Wrapped", cause=cause)
        assert isinstance(err.cause, CommandError)
        assert err.cause.code == "ORIGINAL"


class TestValidationError:
    """Tests for validation_error() factory function."""

    def test_basic_validation_error(self):
        err = validation_error("Title is required")
        assert err.code == ErrorCodes.VALIDATION_ERROR
        assert err.message == "Title is required"
        assert err.suggestion == "Check the input and try again"
        assert err.retryable is False

    def test_validation_error_with_details(self):
        err = validation_error(
            "Invalid email format",
            details={"field": "email", "value": "not-an-email"},
        )
        assert err.details == {"field": "email", "value": "not-an-email"}


class TestNotFoundError:
    """Tests for not_found_error() factory function."""

    def test_basic_not_found(self):
        err = not_found_error("Document", "doc-123")
        assert err.code == ErrorCodes.NOT_FOUND
        assert err.message == "Document with ID 'doc-123' not found"
        assert "document id" in err.suggestion.lower()
        assert err.retryable is False

    def test_not_found_details(self):
        err = not_found_error("User", "user-456")
        assert err.details == {"resourceType": "User", "resourceId": "user-456"}


class TestRateLimitError:
    """Tests for rate_limit_error() factory function."""

    def test_basic_rate_limit(self):
        err = rate_limit_error()
        assert err.code == ErrorCodes.RATE_LIMITED
        assert err.message == "Rate limit exceeded"
        assert err.retryable is True

    def test_rate_limit_with_retry_after(self):
        err = rate_limit_error(60)
        assert "60 seconds" in err.suggestion
        assert err.details == {"retryAfterSeconds": 60}

    def test_rate_limit_without_retry_after(self):
        err = rate_limit_error()
        assert "wait a moment" in err.suggestion.lower()
        assert err.details is None


class TestTimeoutError:
    """Tests for timeout_error() factory function."""

    def test_basic_timeout(self):
        err = timeout_error("fetch_data", 5000)
        assert err.code == ErrorCodes.TIMEOUT
        assert "fetch_data" in err.message
        assert "5000ms" in err.message
        assert err.retryable is True

    def test_timeout_details(self):
        err = timeout_error("api_call", 3000)
        assert err.details == {"operationName": "api_call", "timeoutMs": 3000}


class TestInternalError:
    """Tests for internal_error() factory function."""

    def test_basic_internal(self):
        err = internal_error("Processing failed")
        assert err.code == ErrorCodes.INTERNAL_ERROR
        assert err.message == "Processing failed"
        assert err.retryable is True
        assert "try again" in err.suggestion.lower()

    def test_internal_with_cause(self):
        try:
            raise RuntimeError("Database connection failed")
        except RuntimeError as e:
            err = internal_error("Query failed", cause=e)
            assert err.cause == "Database connection failed"


class TestWrapError:
    """Tests for wrap_error() function."""

    def test_wrap_command_error_returns_same(self):
        original = CommandError(code="ORIGINAL", message="Original")
        wrapped = wrap_error(original)
        assert wrapped is original

    def test_wrap_exception(self):
        try:
            raise ValueError("Bad value")
        except ValueError as e:
            wrapped = wrap_error(e)
            assert wrapped.code == ErrorCodes.INTERNAL_ERROR
            assert wrapped.message == "Bad value"
            assert wrapped.details == {"errorType": "ValueError"}

    def test_wrap_string(self):
        wrapped = wrap_error("Something went wrong")
        assert wrapped.code == ErrorCodes.UNKNOWN_ERROR
        assert wrapped.message == "Something went wrong"


class TestIsCommandError:
    """Tests for is_command_error() type guard."""

    def test_returns_true_for_command_error(self):
        err = CommandError(code="TEST", message="Test")
        assert is_command_error(err) is True

    def test_returns_false_for_dict(self):
        err = {"code": "TEST", "message": "Test"}
        assert is_command_error(err) is False

    def test_returns_false_for_none(self):
        assert is_command_error(None) is False

    def test_returns_false_for_exception(self):
        assert is_command_error(ValueError("test")) is False
