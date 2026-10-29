"""Tests for scope enforcement — spec 04."""

from __future__ import annotations

from botcore_connectors.errors import check_scope, scope_violation

# ---------------------------------------------------------------------------
# check_scope
# ---------------------------------------------------------------------------


class TestCheckScope:
    def test_allowed_returns_none(self) -> None:
        assert check_scope("github", ["github", "azure"]) is None

    def test_denied_returns_error(self) -> None:
        result = check_scope("github", ["azure"])
        assert result is not None
        assert result.success is False

    def test_empty_list_denies_all(self) -> None:
        result = check_scope("github", [])
        assert result is not None
        assert result.success is False

    def test_error_code(self) -> None:
        result = check_scope("github", ["azure"])
        assert result.error.code == "SCOPE_VIOLATION"

    def test_suggestion_includes_allowed_list(self) -> None:
        result = check_scope("github", ["azure", "email"])
        assert "azure" in result.error.suggestion
        assert "email" in result.error.suggestion

    def test_frozenset_accepted(self) -> None:
        assert check_scope("github", frozenset({"github"})) is None

    def test_set_accepted(self) -> None:
        assert check_scope("github", {"github"}) is None

    def test_denied_with_frozenset(self) -> None:
        result = check_scope("slack", frozenset({"github"}))
        assert result is not None
        assert result.error.code == "SCOPE_VIOLATION"


# ---------------------------------------------------------------------------
# scope_violation helper
# ---------------------------------------------------------------------------


class TestScopeViolationHelper:
    def test_returns_command_result_error(self) -> None:
        result = scope_violation("github", ["azure"])
        assert result.success is False
        assert result.error.code == "SCOPE_VIOLATION"
        assert "github" in result.error.message
