"""Result parsing and call-error classification for :mod:`afd.client`.

Mirrors ``packages/client/src/client-errors.ts`` so ``McpClient.call()`` fails
closed with non-retryable ``OUTCOME_UNKNOWN`` whenever an ambiguous failure
occurs on a tool not positively declared read-only.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from afd.core.result import CommandResult
from afd.core.result import error as result_error
from afd.transports.base import (
    HttpStatusError,
    JsonRpcError,
    ToolExecutionError,
    ToolInfo,
    ToolNotFoundError,
    TransportError,
)
from afd.transports.base import TimeoutError as TransportTimeoutError

_SDK_REFUSAL_CODES = frozenset({-32600, -32601, -32602, -32001, -32021})


def _is_tool_info_read_only(tool: ToolInfo) -> bool:
    """Whether ``tool`` positively declares ``_meta.mutation is False`` without contradictions."""
    meta = tool.meta if isinstance(tool.meta, dict) else None
    if meta is None or meta.get("mutation") is not False:
        return False
    if meta.get("destructive") is True:
        return False
    annotations = tool.annotations if isinstance(tool.annotations, dict) else None
    if annotations is not None:
        if annotations.get("destructiveHint") is True:
            return False
        if annotations.get("readOnlyHint") is False:
            return False
    return True


def _exception_chain(exc: BaseException) -> tuple[Any, ...]:
    """Return ``exc`` together with its explicit ``cause`` attribute and ``__cause__``."""
    return (exc, getattr(exc, "cause", None), exc.__cause__)


def _is_mcp_error(candidate: Any) -> bool:
    """Whether ``candidate`` is an ``mcp.MCPError`` (or subclass) without importing ``mcp``."""
    return candidate is not None and any(
        cls.__name__ == "MCPError" for cls in type(candidate).__mro__
    )


def _extract_http_status(exc: BaseException) -> int | None:
    """Return the HTTP status code for ``HttpStatusError`` or an httpx-style error."""
    if isinstance(exc, HttpStatusError):
        return exc.status
    for candidate in _exception_chain(exc):
        if candidate is None:
            continue
        if isinstance(candidate, HttpStatusError):
            return candidate.status
        status = getattr(getattr(candidate, "response", None), "status_code", None)
        if isinstance(status, int) and not isinstance(status, bool):
            return status
    return None


def _is_timeout_cause(exc: BaseException) -> bool:
    """Whether ``exc`` or its cause represents a request timeout."""
    for candidate in _exception_chain(exc):
        if candidate is None:
            continue
        if isinstance(candidate, (TimeoutError, TransportTimeoutError)):
            return True
        if _is_mcp_error(candidate) and getattr(candidate, "code", None) == 408:
            return True
        if any(cls.__name__ == "TimeoutException" for cls in type(candidate).__mro__):
            return True
    return False


def _extract_mcp_error(exc: BaseException) -> tuple[int, str, Any] | None:
    """Return ``(code, message, data)`` for an ``MCPError`` (or subclass) in ``exc``'s chain."""
    for candidate in _exception_chain(exc):
        if not _is_mcp_error(candidate):
            continue
        code = getattr(candidate, "code", None)
        if isinstance(code, int) and not isinstance(code, bool):
            return (
                code,
                str(getattr(candidate, "message", "") or candidate),
                getattr(candidate, "data", None),
            )
    return None


def _classify_call_exception(exc: Exception) -> tuple[CommandResult[Any], bool]:
    """Convert an exception raised during ``call_tool()`` to ``(cause_result, outcome_unknown)``."""
    if isinstance(exc, ToolExecutionError):
        return (
            result_error(
                code="TOOL_ERROR",
                message=str(exc),
                suggestion="Check the command input and try again",
                retryable=False,
            ),
            False,
        )
    if isinstance(exc, ToolNotFoundError):
        return (
            result_error(
                code="TRANSPORT_ERROR",
                message=str(exc),
                suggestion="Check the server connection and try again",
                retryable=False,
            ),
            False,
        )
    if isinstance(exc, JsonRpcError):
        if exc.code == -32021:
            return (
                result_error(
                    code="MISSING_CLIENT_CAPABILITY",
                    message=exc.rpc_message,
                    suggestion=(
                        "Enable the required MCP client capability (for example tasks=True) "
                        "and retry"
                    ),
                    retryable=False,
                    details=exc.data if isinstance(exc.data, dict) else None,
                ),
                False,
            )
        if exc.code == -32603:
            return (
                result_error(
                    code="INTERNAL_ERROR",
                    message=exc.rpc_message,
                    suggestion="Retry the call later or contact the server operator",
                    retryable=True,
                    details={"jsonRpcCode": exc.code},
                ),
                True,
            )
        return (
            result_error(
                code="TRANSPORT_ERROR",
                message=str(exc),
                suggestion="Check the server connection and try again",
                retryable=exc.code == -32001,
                details={"jsonRpcCode": exc.code},
            ),
            False,
        )
    if _is_timeout_cause(exc):
        return (
            result_error(
                code="TIMEOUT",
                message=str(exc) or "MCP request timed out",
                suggestion="Retry with a larger timeout",
                retryable=True,
            ),
            True,
        )
    status = _extract_http_status(exc)
    if status is not None:
        server_side = status >= 500 or status == 429
        return (
            result_error(
                code=f"HTTP_{status}",
                message=str(exc) or f"HTTP error: {status}",
                suggestion=(
                    "The server is unavailable or overloaded; retry later"
                    if server_side
                    else (
                        "The server refused the request; check that the URL points to "
                        "an AFD MCP server endpoint"
                    )
                ),
                retryable=server_side,
            ),
            status < 400 or status >= 500,
        )
    mcp_error = _extract_mcp_error(exc)
    if mcp_error is not None:
        cause_code, cause_msg, cause_data = mcp_error
        if cause_code == -32021:
            return (
                result_error(
                    code="MISSING_CLIENT_CAPABILITY",
                    message=cause_msg,
                    suggestion=(
                        "Enable the required MCP client capability (for example tasks=True) "
                        "and retry"
                    ),
                    retryable=False,
                    details=cause_data if isinstance(cause_data, dict) else None,
                ),
                False,
            )
        if cause_code == -32603:
            return (
                result_error(
                    code="INTERNAL_ERROR",
                    message=cause_msg,
                    suggestion="Retry the call later or contact the server operator",
                    retryable=True,
                    details={"jsonRpcCode": cause_code},
                ),
                True,
            )
        if cause_code in _SDK_REFUSAL_CODES:
            return (
                result_error(
                    code="TRANSPORT_ERROR",
                    message=str(exc),
                    suggestion="Check the server connection and try again",
                    retryable=cause_code == -32001,
                    details={"jsonRpcCode": cause_code},
                ),
                False,
            )
        # -32000 is the Python MCP SDK's synthetic CONNECTION_CLOSED constant,
        # not a server-sent JSON-RPC error code.
        details = None if cause_code == -32000 else {"jsonRpcCode": cause_code}
        return (
            result_error(
                code="TRANSPORT_ERROR",
                message=str(exc),
                suggestion="Check the server connection and try again",
                retryable=True,
                details=details,
            ),
            True,
        )
    if isinstance(exc, (TransportError, OSError)):
        return (
            result_error(
                code="TRANSPORT_ERROR",
                message=str(exc),
                suggestion="Check the server connection and try again",
                retryable=True,
            ),
            True,
        )
    return (
        result_error(
            code="CLIENT_ERROR",
            message=str(exc),
            suggestion="Check the command name and arguments",
            retryable=False,
        ),
        True,
    )


def _outcome_unknown_result(cause: CommandResult[Any]) -> CommandResult[Any]:
    """Wrap an ambiguous call failure in a non-retryable ``OUTCOME_UNKNOWN`` result."""
    err = cause.error
    assert err is not None
    details: dict[str, Any] = dict(err.details) if isinstance(err.details, dict) else {}
    details["cause"] = err.code
    return result_error(
        code="OUTCOME_UNKNOWN",
        message=(
            f"No command result was received ({err.message}). The server may have run the command."
        ),
        suggestion=(
            "Check the effect of the command before retrying: running it again "
            "can repeat a write that already happened."
        ),
        retryable=False,
        details=details,
    )


def _parse_command_result(data: dict[str, Any]) -> CommandResult[Any]:
    """Parse a CommandResult dict, keeping sources, plan, metadata and the rest."""
    try:
        return CommandResult.model_validate(data)
    except ValidationError as exc:
        return result_error(
            code="INVALID_RESULT",
            message="The server returned a malformed CommandResult",
            suggestion="Check that the server returns AFD CommandResult JSON",
            details={
                "errors": [
                    {
                        "path": ".".join(str(part) for part in issue.get("loc", ())),
                        "message": issue.get("msg", "Invalid value"),
                    }
                    for issue in exc.errors()
                ]
            },
        )
