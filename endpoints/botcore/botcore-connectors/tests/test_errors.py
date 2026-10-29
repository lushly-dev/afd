"""Tests for error factory functions not covered by other test files."""

from __future__ import annotations

from botcore_connectors.errors import (
    GITHUB_ERROR_REMAP,
    audit_write_failed,
    config_invalid_connector,
    config_missing_required,
    github_not_found,
    github_rate_limited,
    github_search_rate_limited,
    github_validation_error,
    input_too_large,
    invalid_repo,
    path_traversal_blocked,
)


class TestConfigInvalidConnector:
    def test_returns_error(self) -> None:
        result = config_invalid_connector(["bad"], frozenset({"github"}))
        assert result.error is not None
        assert result.error.code == "CONFIG_INVALID_CONNECTOR"

    def test_message_includes_names(self) -> None:
        result = config_invalid_connector(["x", "y"], frozenset({"github"}))
        assert "x" in result.error.message
        assert "y" in result.error.message

    def test_suggestion_includes_valid(self) -> None:
        result = config_invalid_connector(["bad"], frozenset({"github", "email"}))
        assert "github" in result.error.suggestion


class TestInputTooLarge:
    def test_returns_error(self) -> None:
        result = input_too_large("body", 70_000, 65_536)
        assert result.error is not None
        assert result.error.code == "INPUT_TOO_LARGE"

    def test_message_includes_size_and_limit(self) -> None:
        result = input_too_large("title", 500, 256)
        assert "500" in result.error.message
        assert "256" in result.error.message

    def test_not_retryable(self) -> None:
        result = input_too_large("x", 10, 5)
        assert result.error.retryable is False


class TestPathTraversalBlocked:
    def test_returns_error(self) -> None:
        result = path_traversal_blocked("path")
        assert result.error is not None
        assert result.error.code == "PATH_TRAVERSAL_BLOCKED"

    def test_suggestion_no_double_space(self) -> None:
        result = path_traversal_blocked("file")
        assert "  " not in result.error.suggestion

    def test_not_retryable(self) -> None:
        result = path_traversal_blocked("x")
        assert result.error.retryable is False


class TestAuditWriteFailed:
    def test_returns_error(self) -> None:
        result = audit_write_failed("disk full")
        assert result.error is not None
        assert result.error.code == "AUDIT_WRITE_FAILED"

    def test_message_includes_detail(self) -> None:
        result = audit_write_failed("connection timeout")
        assert "connection timeout" in result.error.message

    def test_retryable(self) -> None:
        result = audit_write_failed("transient")
        assert result.error.retryable is True


class TestGitHubErrorHelpers:
    def test_invalid_repo(self) -> None:
        result = invalid_repo("badrepo")
        assert result.error.code == "INVALID_REPO"
        assert "badrepo" in result.error.message

    def test_github_not_found(self) -> None:
        result = github_not_found("org/repo")
        assert result.error.code == "GITHUB_NOT_FOUND"
        assert "org/repo" in result.error.message

    def test_github_rate_limited_with_reset(self) -> None:
        result = github_rate_limited(1700000000.0)
        assert result.error.code == "GITHUB_RATE_LIMITED"
        assert "1700000000" in result.error.suggestion

    def test_github_rate_limited_without_reset(self) -> None:
        result = github_rate_limited(None)
        assert result.error.code == "GITHUB_RATE_LIMITED"
        assert result.error.retryable is True

    def test_github_search_rate_limited(self) -> None:
        result = github_search_rate_limited()
        assert result.error.code == "GITHUB_SEARCH_RATE_LIMITED"
        assert "30" in result.error.message

    def test_github_validation_error(self) -> None:
        result = github_validation_error("title too long")
        assert result.error.code == "GITHUB_VALIDATION_ERROR"
        assert "title too long" in result.error.message

    def test_config_missing_required_with_context(self) -> None:
        result = config_missing_required("repo", "no default_repo in config")
        assert result.error.code == "CONFIG_MISSING_REQUIRED"
        assert "no default_repo" in result.error.message

    def test_config_missing_required_without_context(self) -> None:
        result = config_missing_required("repo")
        assert result.error.code == "CONFIG_MISSING_REQUIRED"


class TestGitHubErrorRemap:
    def test_remap_dict_keys(self) -> None:
        assert "NOT_FOUND" in GITHUB_ERROR_REMAP
        assert "RATE_LIMITED" in GITHUB_ERROR_REMAP
        assert "VALIDATION_ERROR" in GITHUB_ERROR_REMAP

    def test_remap_values(self) -> None:
        assert GITHUB_ERROR_REMAP["NOT_FOUND"] == "GITHUB_NOT_FOUND"
        assert GITHUB_ERROR_REMAP["RATE_LIMITED"] == "GITHUB_RATE_LIMITED"
        assert GITHUB_ERROR_REMAP["VALIDATION_ERROR"] == "GITHUB_VALIDATION_ERROR"
