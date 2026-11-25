"""Pure MCP wire-result and execution-metadata helpers for :mod:`afd.server.factory`."""

from __future__ import annotations

import json
from typing import Any

from afd.core.batch import BatchResult
from afd.core.errors import CommandError, ErrorCodes
from afd.core.pipeline import PipelineResult, StepStatus
from afd.core.result import CommandResult, ResultMetadata, failure
from afd.core.wire import to_wire


def approval_unavailable(command_name: str, admission: str) -> CommandResult[Any]:
    """``APPROVAL_UNAVAILABLE`` for a gated dispatch no approval step admitted.

    ``admission`` is ``"missing"`` (no approval step admitted this call) or ``"mismatch"``: an
    approval step ran, but this dispatch is not the one it admitted (a retry placed after it, or
    the input changed after it), so the operator fixes the order.
    """
    if admission == "missing":
        reason = "no-approval-step"
        suggestion = (
            f"Tell the user that {command_name} needs their approval and this server has no "
            "approval step; do not retry. The operator adds the approval middleware "
            "(create_approval_middleware) or removes the command's approval policy."
        )
    else:
        reason = "admission-mismatch"
        suggestion = (
            "Do not retry: this call is not the one approved. The operator moves middleware "
            "that retries or changes input before the approval middleware."
        )
    return failure(
        CommandError(
            code=ErrorCodes.APPROVAL_UNAVAILABLE,
            message=f"{command_name} needs a person's approval, and this server cannot ask for it",
            suggestion=suggestion,
            retryable=False,
            details={"reason": reason},
        )
    )


def with_execution_metadata(
    result: CommandResult[Any],
    *,
    execution_time_ms: float,
    command_version: str | None,
    trace_id: str | None,
    actor_kind: str | None = None,
) -> CommandResult[Any]:
    """A copy of ``result`` whose metadata carries the server's execution fields.

    The handler's own result object is never mutated (it may be shared).
    """
    updates: dict[str, Any] = {"execution_time_ms": round(execution_time_ms, 2)}
    if command_version:
        updates["command_version"] = command_version
    if trace_id:
        updates["trace_id"] = trace_id
    if actor_kind:
        updates["actor_kind"] = actor_kind
    metadata = (
        result.metadata.model_copy(update=updates)
        if result.metadata is not None
        else ResultMetadata(**updates)
    )
    return result.model_copy(update={"metadata": metadata})


def is_error_result(result: Any) -> bool:
    """Return the MCP ``isError`` flag for a routed tool result.

    Matches the TypeScript server: a failed CommandResult or BatchResult, or a
    pipeline with a failed step, is an error.
    """
    if isinstance(result, (CommandResult, BatchResult)):
        return not result.success
    if isinstance(result, PipelineResult):
        return any(step.status == StepStatus.FAILURE for step in result.steps)
    if isinstance(result, dict) and isinstance(result.get("success"), bool):
        return not result["success"]
    return False


def is_input_required(result: Any) -> bool:
    return type(result).__name__ == "InputRequiredResult"


def is_mcp_error(exc: BaseException) -> bool:
    try:
        from mcp import MCPError
    except ImportError:  # pragma: no cover - optional dependency
        return False
    return isinstance(exc, MCPError)


def unanswered_approval(tool_name: str) -> CommandResult[Any]:
    """The result when a 2025 client asked in band gave no answer."""
    return failure(
        CommandError(
            code=ErrorCodes.APPROVAL_REQUIRED,
            message=f"{tool_name} needs approval before it runs",
            suggestion="The client did not answer the approval question. Ask the user, then call again.",
            retryable=False,
        )
    )


def tool_call_result(result: Any) -> Any:
    """Wrap a routed result in an MCP CallToolResult in the AFD wire format: the whole result
    as ``structuredContent`` and the same JSON as text (``spec/command-metadata.md``,
    "Structured results")."""
    from mcp.types import CallToolResult, TextContent

    wire = to_wire(result)
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(wire))],
        structured_content=wire if isinstance(wire, dict) else None,
        is_error=is_error_result(result),
    )
