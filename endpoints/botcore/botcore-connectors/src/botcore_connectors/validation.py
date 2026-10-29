"""Input validation helpers for connector commands."""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

MAX_IDENTIFIER_LENGTH = 256
MAX_BODY_SIZE = 65_536
MAX_ITEMS_DEFAULT = 100

_OWNER_REPO_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]+$")


class InputValidationResult(BaseModel, extra="forbid"):
    """Aggregated result of input validation checks."""

    valid: bool
    violations: list[str] = Field(default_factory=list)


def check_max_length(
    value: str, *, field_name: str, limit: int = MAX_IDENTIFIER_LENGTH
) -> list[str]:
    """Return violations if *value* exceeds *limit* characters."""
    if len(value) > limit:
        return [f"{field_name}: length {len(value)} exceeds limit {limit}"]
    return []


def check_max_body_size(
    value: str | bytes, *, field_name: str, limit: int = MAX_BODY_SIZE
) -> list[str]:
    """Return violations if *value* exceeds *limit* bytes."""
    size = len(value.encode("utf-8")) if isinstance(value, str) else len(value)
    if size > limit:
        return [f"{field_name}: size {size} bytes exceeds limit {limit}"]
    return []


def check_max_items(
    items: list | tuple | set | frozenset,
    *,
    field_name: str,
    limit: int = MAX_ITEMS_DEFAULT,
) -> list[str]:
    """Return violations if *items* count exceeds *limit*."""
    if len(items) > limit:
        return [f"{field_name}: {len(items)} items exceeds limit {limit}"]
    return []


def check_no_path_traversal(value: str, *, field_name: str) -> list[str]:
    """Return violations if *value* contains path traversal sequences."""
    if value == "..":
        return [f"{field_name}: path traversal detected"]
    if "../" in value or "..\\" in value:
        return [f"{field_name}: path traversal detected"]
    return []


def check_owner_repo(value: str, *, field_name: str) -> list[str]:
    """Return violations if *value* is not a valid ``owner/repo`` identifier."""
    if not _OWNER_REPO_RE.match(value):
        return [f"{field_name}: invalid owner/repo format"]
    return []


class PaginationParams:
    """Immutable pagination parameters."""

    __slots__ = ("_page", "_page_size")

    def __init__(self, page: int = 1, page_size: int = 30) -> None:
        object.__setattr__(self, "_page", max(1, page))
        object.__setattr__(self, "_page_size", max(1, min(page_size, 100)))

    def __setattr__(self, _name: str, _value: object) -> None:
        raise AttributeError("PaginationParams is frozen")

    @property
    def page(self) -> int:
        return self._page

    @property
    def page_size(self) -> int:
        return self._page_size

    def to_github_params(self) -> dict[str, str]:
        return {"page": str(self._page), "per_page": str(self._page_size)}


_VALID_REVIEW_EVENTS = frozenset({"APPROVE", "REQUEST_CHANGES", "COMMENT"})


def check_review_event(value: str, *, field_name: str = "event") -> list[str]:
    """Return violations if *value* is not a valid PR review event."""
    if value not in _VALID_REVIEW_EVENTS:
        return [f"{field_name}: must be one of {sorted(_VALID_REVIEW_EVENTS)}"]
    return []


def validate_inputs(**checks: list[str]) -> InputValidationResult:
    """Aggregate violations from multiple check calls.

    Usage::

        result = validate_inputs(
            repo=check_owner_repo(repo, field_name="repo"),
            path=check_no_path_traversal(path, field_name="path"),
        )
    """
    violations: list[str] = []
    for field_violations in checks.values():
        violations.extend(field_violations)
    return InputValidationResult(valid=len(violations) == 0, violations=violations)
