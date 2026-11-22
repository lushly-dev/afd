"""Command handlers for Teams messages and card actions."""

from __future__ import annotations

import logging
from typing import Any

from afd.core.result import CommandResult, error

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
            return error(
                "MISSING_CONTEXT",
                "No original message to retry.",
                suggestion="Send the message again in Teams.",
                retryable=False,
            )
        return await teams_handle_message(original_text, user_id, "", "")

    if action == "followup":
        followup_text = data.get("text", "")
        if not followup_text:
            return error(
                "MISSING_CONTEXT",
                "No followup text provided.",
                suggestion="Send a follow-up message in Teams.",
                retryable=False,
            )
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
    """Dispatch a parsed Teams intent through botcore's DirectClient.

    Never fabricates a stub response when the command is missing or dispatch fails.
    """
    del user_id, user_name
    try:
        from botcore.registry import get_client

        client = get_client()
    except (ImportError, AttributeError):
        return error(
            "DISPATCH_UNAVAILABLE",
            f"Command dispatcher is not available for '{command}'.",
            suggestion=(
                "Ensure lushly-botcore is installed and its command registry is initialized."
            ),
            retryable=False,
        )

    try:
        result = await client.call(command, args)
    except Exception:
        logger.exception("DirectClient dispatch failed for %s", command)
        return error(
            "DISPATCH_FAILED",
            f"Command '{command}' failed while communicating with the botcore host.",
            suggestion=(
                "Check task status and the botcore host logs before retrying to avoid "
                "duplicate actions."
            ),
            retryable=False,
        )

    if result.success:
        return result

    err = result.error
    if err is None:
        return error(
            "COMMAND_FAILED",
            f"Command '{command}' failed.",
            suggestion="Check the botcore host logs and try again.",
            retryable=False,
        )
    if err.code in {"UNKNOWN_TOOL", "UNKNOWN_COMMAND"}:
        return error(
            err.code,
            f"Command '{command}' is not registered in this botcore host.",
            suggestion=(
                f"Install and register the plugin that provides '{command}' "
                "(such as botcore-agents) before calling it from Teams."
            ),
            retryable=False,
        )
    if not err.suggestion:
        return error(
            err.code,
            err.message,
            suggestion=(
                f"Check the inputs for '{command}' or review the botcore host logs and try again."
            ),
            retryable=err.retryable,
            details=err.details,
        )
    return result
