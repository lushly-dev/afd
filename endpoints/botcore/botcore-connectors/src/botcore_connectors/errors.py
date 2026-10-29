"""HTTP status-to-error-code mapping for connectors."""

from __future__ import annotations

from typing import Any

from afd import CommandResult, error

# (error_code, suggestion, retryable)
STATUS_CODE_MAP: dict[int, tuple[str, str, bool]] = {
    400: (
        "BAD_REQUEST",
        "Fix request parameters per API docs",
        False,
    ),
    401: (
        "AUTH_FAILED",
        "Re-authenticate; check credentials are valid and not expired",
        False,
    ),
    403: (
        "FORBIDDEN",
        "Check required permissions for this operation",
        False,
    ),
    404: (
        "NOT_FOUND",
        "Verify resource identifier (repo, ID, path)",
        False,
    ),
    409: (
        "CONFLICT",
        "Fetch current state and reconcile",
        False,
    ),
    422: (
        "VALIDATION_ERROR",
        "Review field values against API constraints",
        False,
    ),
    429: (
        "RATE_LIMITED",
        "Automatic retry via middleware; no user action needed",
        True,
    ),
    500: (
        "SERVICE_ERROR",
        "Automatic retry; if persistent, check service status",
        True,
    ),
    502: (
        "SERVICE_ERROR",
        "Automatic retry; if persistent, check service status",
        True,
    ),
    503: (
        "SERVICE_ERROR",
        "Automatic retry; if persistent, check service status",
        True,
    ),
    504: (
        "SERVICE_ERROR",
        "Automatic retry; if persistent, check service status",
        True,
    ),
}

RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({429, 500, 502, 503, 504})


def map_status_to_error(
    status_code: int,
    response_body: dict[str, Any] | str | None = None,
) -> CommandResult[dict[str, Any]]:
    """Map an HTTP status code to a ``CommandResult`` error.

    Falls back to ``CLIENT_ERROR`` for unknown 4xx and ``SERVICE_ERROR``
    for unknown 5xx.
    """
    if status_code in STATUS_CODE_MAP:
        code, suggestion, retryable = STATUS_CODE_MAP[status_code]
    elif 400 <= status_code < 500:
        code = "CLIENT_ERROR"
        suggestion = "Inspect response body for details"
        retryable = False
    else:
        code = "SERVICE_ERROR"
        suggestion = "Automatic retry; if persistent, check service status"
        retryable = True

    message = f"HTTP {status_code}"
    if isinstance(response_body, dict) and "message" in response_body:
        message = f"HTTP {status_code}: {response_body['message']}"
    elif isinstance(response_body, str) and response_body:
        message = f"HTTP {status_code}: {response_body[:200]}"

    return error(code, message, suggestion=suggestion, retryable=retryable)


def network_error(exc: Exception) -> CommandResult[dict[str, Any]]:
    """Wrap an httpx network/timeout exception into a ``CommandResult``."""
    return error(
        "NETWORK_ERROR",
        f"Network error: {exc}",
        suggestion="Check network connectivity and service availability",
        retryable=True,
    )


def github_auth_missing() -> CommandResult[dict[str, Any]]:
    """No GitHub credentials could be resolved."""
    return error(
        "GITHUB_AUTH_MISSING",
        "No GitHub token found",
        suggestion="Set GH_TOKEN environment variable or run `gh auth login`",
        retryable=False,
    )


def auth_refresh_failed(provider: str) -> CommandResult[dict[str, Any]]:
    """Credential refresh after 401 produced no valid token."""
    return error(
        "AUTH_REFRESH_FAILED",
        f"Failed to refresh credentials for {provider}",
        suggestion=f"Re-authenticate for {provider}; check credentials are valid",
        retryable=False,
    )


def config_invalid_connector(
    names: list[str] | set[str],
    valid: frozenset[str] | set[str],
) -> CommandResult[dict[str, Any]]:
    """Unknown connector name(s) in config."""
    return error(
        "CONFIG_INVALID_CONNECTOR",
        f"Unknown connector(s): {sorted(names)}",
        suggestion=f"Valid connectors: {sorted(valid)}",
        retryable=False,
    )


def input_validation_failed(
    violations: list[str],
) -> CommandResult[dict[str, Any]]:
    """One or more input validation checks failed."""
    return error(
        "INPUT_VALIDATION_FAILED",
        f"Input validation failed: {'; '.join(violations)}",
        suggestion="Fix the listed field violations and retry",
        retryable=False,
    )


def input_too_large(
    field: str, size: int, limit: int
) -> CommandResult[dict[str, Any]]:
    """A string or collection field exceeded its maximum size."""
    return error(
        "INPUT_TOO_LARGE",
        f"{field}: size {size} exceeds limit {limit}",
        suggestion=f"Reduce {field} to at most {limit}",
        retryable=False,
    )


def path_traversal_blocked(field: str) -> CommandResult[dict[str, Any]]:
    """Path traversal sequence detected in an input field."""
    return error(
        "PATH_TRAVERSAL_BLOCKED",
        f"{field}: path traversal blocked",
        suggestion="Remove '../' or '..\\\\' sequences from the path",
        retryable=False,
    )


def scope_violation(
    connector: str,
    allowed: list[str] | set[str] | frozenset[str],
) -> CommandResult[dict[str, Any]]:
    """Agent attempted to use a connector outside its allowed scope."""
    return error(
        "SCOPE_VIOLATION",
        f"Connector '{connector}' is not in the allowed scope",
        suggestion=f"Allowed connectors: {sorted(allowed)}",
        retryable=False,
    )


def audit_write_failed(detail: str) -> CommandResult[dict[str, Any]]:
    """Audit log write failed (may be retried)."""
    return error(
        "AUDIT_WRITE_FAILED",
        f"Audit log write failed: {detail}",
        suggestion="Check logging configuration and storage availability",
        retryable=True,
    )


def invalid_repo(value: str) -> CommandResult[dict[str, Any]]:
    """Bad ``owner/repo`` format."""
    return error(
        "INVALID_REPO",
        f"Invalid repository format: {value!r}",
        suggestion="Use 'owner/repo' format (e.g. 'octocat/hello-world')",
        retryable=False,
    )


def github_not_found(resource: str) -> CommandResult[dict[str, Any]]:
    """GitHub 404 with contextual suggestion."""
    return error(
        "GITHUB_NOT_FOUND",
        f"GitHub resource not found: {resource}",
        suggestion="Check repository name, issue/PR number, and permissions",
        retryable=False,
    )


def github_rate_limited(reset_at: float | None = None) -> CommandResult[dict[str, Any]]:
    """GitHub API rate limit exceeded."""
    msg = "GitHub API rate limit exceeded"
    suggestion = "Wait for rate limit reset"
    if reset_at is not None:
        suggestion = f"Rate limit resets at timestamp {reset_at}"
    return error(
        "GITHUB_RATE_LIMITED",
        msg,
        suggestion=suggestion,
        retryable=True,
    )


def github_search_rate_limited() -> CommandResult[dict[str, Any]]:
    """GitHub search endpoint rate limit (30/min)."""
    return error(
        "GITHUB_SEARCH_RATE_LIMITED",
        "GitHub search rate limit exceeded (30 requests/min)",
        suggestion="Reduce search frequency; wait before retrying",
        retryable=True,
    )


def github_validation_error(message: str) -> CommandResult[dict[str, Any]]:
    """GitHub 422 validation error."""
    return error(
        "GITHUB_VALIDATION_ERROR",
        f"GitHub validation error: {message}",
        suggestion="Review field values against GitHub API constraints",
        retryable=False,
    )


def config_missing_required(
    field: str, context: str = ""
) -> CommandResult[dict[str, Any]]:
    """Required config field missing."""
    msg = f"Missing required config: {field}"
    if context:
        msg = f"{msg} ({context})"
    return error(
        "CONFIG_MISSING_REQUIRED",
        msg,
        suggestion=f"Set {field} in connector config or pass explicitly",
        retryable=False,
    )


GITHUB_ERROR_REMAP: dict[str, str] = {
    "NOT_FOUND": "GITHUB_NOT_FOUND",
    "RATE_LIMITED": "GITHUB_RATE_LIMITED",
    "VALIDATION_ERROR": "GITHUB_VALIDATION_ERROR",
}


def check_scope(
    connector: str,
    allowed: list[str] | set[str] | frozenset[str],
) -> CommandResult[dict[str, Any]] | None:
    """Return ``None`` if *connector* is within *allowed* scope, else an error.

    An empty *allowed* collection denies everything.
    """
    if connector in allowed:
        return None
    return scope_violation(connector, allowed)
