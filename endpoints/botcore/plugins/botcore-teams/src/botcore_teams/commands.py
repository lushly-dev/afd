"""Command handlers for Teams messages and card actions."""

from __future__ import annotations

import logging
from typing import Any

from afd.core.metadata import PlanStep, PlanStepStatus, Source
from afd.core.result import CommandResult, error, success

from .intent import parse_intent

logger = logging.getLogger(__name__)


async def teams_handle_message(
    text: str,
    user_id: str,
    user_name: str,
    conversation_id: str,
) -> CommandResult[dict[str, Any]]:
    """Parse a Teams message and dispatch to the appropriate command."""
    intent = parse_intent(text)

    if intent.command == "unknown":
        return error(
            "UNKNOWN_INTENT",
            f"I didn't understand: {text}",
            suggestion="Try 'assign <task> to @agent', 'team status', or 'list tasks'.",
            retryable=False,
        )

    return await _dispatch_command(intent.command, intent.args, user_id, user_name)


async def teams_handle_card_action(
    action: str,
    data: dict[str, Any],
    user_id: str,
) -> CommandResult[dict[str, Any]]:
    """Handle an Adaptive Card Action.Submit callback."""
    if action == "retry":
        original_text = data.get("original_text", "")
        if not original_text:
            return error("MISSING_CONTEXT", "No original message to retry.")
        return await teams_handle_message(original_text, user_id, "", "")

    if action == "followup":
        followup_text = data.get("text", "")
        if not followup_text:
            return error("MISSING_CONTEXT", "No followup text provided.")
        return await teams_handle_message(followup_text, user_id, "", "")

    return error(
        "UNKNOWN_ACTION",
        f"Unknown card action: {action}",
        suggestion="This action is not supported.",
    )


async def _dispatch_command(
    command: str,
    args: dict[str, Any],
    user_id: str,
    user_name: str,
) -> CommandResult[dict[str, Any]]:
    """Dispatch to botcore command, falling back to stubs.

    Tries DirectClient first (for when botcore-agents is installed),
    then falls back to stub responses with realistic data shapes.
    """
    # Try real dispatch via botcore client
    try:
        from botcore.registry import get_client

        client = get_client()
        result = await client.call(command, args)
        if result.success:
            return result

        err = result.error
        if err and err.code not in {"UNKNOWN_TOOL", "UNKNOWN_COMMAND"}:
            return result
    except (ImportError, AttributeError):
        pass
    except Exception:
        logger.debug("DirectClient dispatch failed for %s, using stub", command, exc_info=True)

    # Stub fallback for Phase 1
    return _stub_response(command, args, user_id, user_name)


def _stub_response(
    command: str,
    args: dict[str, Any],
    user_id: str,
    user_name: str,
) -> CommandResult[dict[str, Any]]:
    """Generate stub CommandResult with realistic data shapes."""
    if command == "task_assign":
        agent = args.get("agent", "default-agent")
        description = args.get("description", "task")
        return success(
            {"task_id": "task-001", "agent": agent, "description": description, "status": "queued"},
            reasoning=f"Task assigned to {agent}",
            confidence=0.95,
            plan=[
                PlanStep(
                    id="1", action="parse", status=PlanStepStatus.COMPLETE,
                    description="Parse task description",
                ),
                PlanStep(
                    id="2", action="assign", status=PlanStepStatus.COMPLETE,
                    description=f"Assign to {agent}",
                ),
                PlanStep(
                    id="3", action="execute", status=PlanStepStatus.PENDING,
                    description="Execute task",
                ),
            ],
            suggestions=["Check status", "Cancel task"],
        )

    if command == "task_status":
        return success(
            {"task_id": "task-001", "status": "in_progress", "progress": 45},
            reasoning="Task is in progress",
            confidence=0.9,
        )

    if command == "team_status":
        return success(
            {
                "agents": [
                    {"name": "researcher", "status": "idle"},
                    {"name": "coder", "status": "busy"},
                    {"name": "reviewer", "status": "idle"},
                ],
                "total": 3,
                "active": 1,
            },
            reasoning="Team overview",
            confidence=1.0,
            sources=[
                Source(type="api", title="Agent Registry", url=None),
            ],
        )

    if command == "task_cancel":
        query = args.get("query", "")
        return success(
            {"cancelled": True, "query": query},
            reasoning=f"Cancelled task matching '{query}'" if query else "Cancelled current task",
        )

    if command == "task_list":
        return success(
            {
                "tasks": [
                    {"id": "task-001", "description": "Research Azure SDK",
                     "status": "in_progress"},
                    {"id": "task-002", "description": "Write unit tests",
                     "status": "queued"},
                ],
                "total": 2,
            },
            reasoning="Active tasks",
            confidence=1.0,
        )

    return error(
        "UNKNOWN_COMMAND",
        f"Unknown command: {command}",
        suggestion=(
            "Available commands: task_assign, task_status, team_status, task_cancel, task_list"
        ),
    )
