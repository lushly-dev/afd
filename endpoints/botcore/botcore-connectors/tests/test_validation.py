"""Tests for input validation — spec 04."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from botcore_connectors.validation import (
    MAX_BODY_SIZE,
    MAX_IDENTIFIER_LENGTH,
    MAX_ITEMS_DEFAULT,
    InputValidationResult,
    PaginationParams,
    check_max_body_size,
    check_max_items,
    check_max_length,
    check_no_path_traversal,
    check_owner_repo,
    check_review_event,
    validate_inputs,
)

# ---------------------------------------------------------------------------
# check_max_length
# ---------------------------------------------------------------------------


class TestCheckMaxLength:
    def test_within_limit(self) -> None:
        assert check_max_length("short", field_name="name") == []

    def test_at_limit(self) -> None:
        value = "a" * MAX_IDENTIFIER_LENGTH
        assert check_max_length(value, field_name="name") == []

    def test_over_limit(self) -> None:
        value = "a" * (MAX_IDENTIFIER_LENGTH + 1)
        violations = check_max_length(value, field_name="name")
        assert len(violations) == 1
        assert "name" in violations[0]
        assert str(MAX_IDENTIFIER_LENGTH) in violations[0]

    def test_custom_limit(self) -> None:
        assert check_max_length("abcde", field_name="x", limit=5) == []
        violations = check_max_length("abcdef", field_name="x", limit=5)
        assert len(violations) == 1

    def test_custom_field_name(self) -> None:
        violations = check_max_length("a" * 10, field_name="my_field", limit=5)
        assert "my_field" in violations[0]

    def test_empty_string(self) -> None:
        assert check_max_length("", field_name="name") == []


# ---------------------------------------------------------------------------
# check_max_body_size
# ---------------------------------------------------------------------------


class TestCheckMaxBodySize:
    def test_small_string(self) -> None:
        assert check_max_body_size("hello", field_name="body") == []

    def test_bytes_input(self) -> None:
        assert check_max_body_size(b"hello", field_name="body") == []

    def test_at_limit(self) -> None:
        value = "a" * MAX_BODY_SIZE
        assert check_max_body_size(value, field_name="body") == []

    def test_over_limit(self) -> None:
        value = "a" * (MAX_BODY_SIZE + 1)
        violations = check_max_body_size(value, field_name="body")
        assert len(violations) == 1
        assert "body" in violations[0]

    def test_utf8_multibyte(self) -> None:
        # Each emoji is 4 bytes in UTF-8; 3 chars = 12 bytes
        value = "\U0001f600" * 3
        violations = check_max_body_size(value, field_name="body", limit=10)
        assert len(violations) == 1
        assert "12" in violations[0]


# ---------------------------------------------------------------------------
# check_max_items
# ---------------------------------------------------------------------------


class TestCheckMaxItems:
    def test_under_limit(self) -> None:
        assert check_max_items([1, 2, 3], field_name="ids") == []

    def test_at_limit(self) -> None:
        items = list(range(MAX_ITEMS_DEFAULT))
        assert check_max_items(items, field_name="ids") == []

    def test_over_limit(self) -> None:
        items = list(range(MAX_ITEMS_DEFAULT + 1))
        violations = check_max_items(items, field_name="ids")
        assert len(violations) == 1
        assert "ids" in violations[0]

    def test_custom_limit(self) -> None:
        assert check_max_items([1, 2], field_name="x", limit=2) == []
        violations = check_max_items([1, 2, 3], field_name="x", limit=2)
        assert len(violations) == 1

    def test_empty_list(self) -> None:
        assert check_max_items([], field_name="ids") == []


# ---------------------------------------------------------------------------
# check_no_path_traversal
# ---------------------------------------------------------------------------


class TestCheckNoPathTraversal:
    def test_clean_path(self) -> None:
        assert check_no_path_traversal("src/main.py", field_name="path") == []

    def test_dot_dot_slash(self) -> None:
        violations = check_no_path_traversal("../etc/passwd", field_name="path")
        assert len(violations) == 1
        assert "path traversal" in violations[0]

    def test_dot_dot_backslash(self) -> None:
        violations = check_no_path_traversal("..\\windows\\system32", field_name="path")
        assert len(violations) == 1

    def test_middle_traversal(self) -> None:
        violations = check_no_path_traversal("foo/../bar", field_name="path")
        assert len(violations) == 1

    def test_bare_dot_dot(self) -> None:
        violations = check_no_path_traversal("..", field_name="path")
        assert len(violations) == 1

    def test_single_dot_ok(self) -> None:
        assert check_no_path_traversal(".", field_name="path") == []

    def test_file_with_double_dot_in_name_ok(self) -> None:
        assert check_no_path_traversal("file..name.txt", field_name="path") == []


# ---------------------------------------------------------------------------
# check_owner_repo
# ---------------------------------------------------------------------------


class TestCheckOwnerRepo:
    def test_valid(self) -> None:
        assert check_owner_repo("octocat/hello-world", field_name="repo") == []

    def test_missing_slash(self) -> None:
        violations = check_owner_repo("octocat", field_name="repo")
        assert len(violations) == 1
        assert "owner/repo" in violations[0]

    def test_empty(self) -> None:
        violations = check_owner_repo("", field_name="repo")
        assert len(violations) == 1

    def test_multiple_slashes(self) -> None:
        violations = check_owner_repo("a/b/c", field_name="repo")
        assert len(violations) == 1

    def test_special_chars_in_segments(self) -> None:
        assert check_owner_repo("my-org/my_repo.v2", field_name="repo") == []

    def test_owner_with_space_invalid(self) -> None:
        violations = check_owner_repo("my org/repo", field_name="repo")
        assert len(violations) == 1

    def test_repo_with_space_invalid(self) -> None:
        violations = check_owner_repo("my-org/repo name", field_name="repo")
        assert len(violations) == 1


# ---------------------------------------------------------------------------
# validate_inputs
# ---------------------------------------------------------------------------


class TestValidateInputs:
    def test_all_valid(self) -> None:
        result = validate_inputs(
            repo=check_owner_repo("a/b", field_name="repo"),
            path=check_no_path_traversal("src/x.py", field_name="path"),
        )
        assert result.valid is True
        assert result.violations == []

    def test_single_violation(self) -> None:
        result = validate_inputs(
            repo=check_owner_repo("bad", field_name="repo"),
        )
        assert result.valid is False
        assert len(result.violations) == 1

    def test_multiple_aggregated(self) -> None:
        result = validate_inputs(
            repo=check_owner_repo("bad", field_name="repo"),
            path=check_no_path_traversal("../x", field_name="path"),
        )
        assert result.valid is False
        assert len(result.violations) == 2

    def test_empty_checks(self) -> None:
        result = validate_inputs()
        assert result.valid is True
        assert result.violations == []


# ---------------------------------------------------------------------------
# InputValidationResult — model constraints
# ---------------------------------------------------------------------------


class TestInputValidationResult:
    def test_extra_forbid(self) -> None:
        with pytest.raises(ValidationError):
            InputValidationResult(valid=True, extra_field="nope")


# ---------------------------------------------------------------------------
# PaginationParams
# ---------------------------------------------------------------------------


class TestPaginationParams:
    def test_defaults(self) -> None:
        p = PaginationParams()
        assert p.page == 1
        assert p.page_size == 30

    def test_custom_values(self) -> None:
        p = PaginationParams(page=3, page_size=50)
        assert p.page == 3
        assert p.page_size == 50

    def test_page_clamped_to_min_1(self) -> None:
        assert PaginationParams(page=0).page == 1
        assert PaginationParams(page=-5).page == 1

    def test_page_size_clamped_to_min_1(self) -> None:
        assert PaginationParams(page_size=0).page_size == 1
        assert PaginationParams(page_size=-1).page_size == 1

    def test_page_size_clamped_to_max_100(self) -> None:
        assert PaginationParams(page_size=200).page_size == 100
        assert PaginationParams(page_size=101).page_size == 100

    def test_page_size_at_100(self) -> None:
        assert PaginationParams(page_size=100).page_size == 100

    def test_to_github_params(self) -> None:
        p = PaginationParams(page=2, page_size=10)
        params = p.to_github_params()
        assert params == {"page": "2", "per_page": "10"}

    def test_frozen_raises_on_setattr(self) -> None:
        p = PaginationParams()
        with pytest.raises(AttributeError, match="frozen"):
            p.page = 5  # type: ignore[misc]

    def test_frozen_raises_on_page_size_setattr(self) -> None:
        p = PaginationParams()
        with pytest.raises(AttributeError, match="frozen"):
            p.page_size = 10  # type: ignore[misc]


# ---------------------------------------------------------------------------
# check_review_event
# ---------------------------------------------------------------------------


class TestCheckReviewEvent:
    def test_approve(self) -> None:
        assert check_review_event("APPROVE") == []

    def test_request_changes(self) -> None:
        assert check_review_event("REQUEST_CHANGES") == []

    def test_comment(self) -> None:
        assert check_review_event("COMMENT") == []

    def test_invalid_event(self) -> None:
        violations = check_review_event("INVALID")
        assert len(violations) == 1
        assert "event" in violations[0]

    def test_lowercase_rejected(self) -> None:
        violations = check_review_event("approve")
        assert len(violations) == 1

    def test_custom_field_name(self) -> None:
        violations = check_review_event("bad", field_name="review_event")
        assert "review_event" in violations[0]
