"""Shared MCP tool call routing for AFD servers."""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from afd.core.batch import BatchRequest, is_batch_request
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.pipeline import PipelineRequest, is_pipeline_request
from afd.core.result import CommandResult, error
from afd.server.lazy_tools import execute_detail, execute_discover
from afd.server.tools import derive_group_action, derive_group_name


@dataclass
class ToolRouterDeps:
    execute_command: Callable[[str, Any, CommandContext | None], Awaitable[CommandResult[Any]]]
    execute_batch: Callable[[BatchRequest | dict[str, Any], CommandContext | None], Awaitable[Any]]
    execute_pipeline: Callable[[PipelineRequest | dict[str, Any], CommandContext | None], Awaitable[Any]]
    commands: list[CommandDefinition]
    tool_strategy: str
    group_by_fn: Callable[[CommandDefinition], str | None] | None = None
    all_commands: list[CommandDefinition] | None = None
    exposed_command_names: set[str] | None = None
    context_state: Any = None


def new_trace_id(prefix: str) -> str:
    """A unique trace ID for one tool call, like the TypeScript server's."""
    return f"{prefix}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:10]}"


def is_command_accessible(
    command: CommandDefinition | None,
    active_context: str | None,
) -> bool:
    """Return whether the command is visible in the active context."""
    if not active_context or command is None:
        return True
    if not command.contexts:
        return True
    return active_context in command.contexts


def _index_by_name(commands: list[CommandDefinition]) -> dict[str, CommandDefinition]:
    """Name -> command; the first command with a name wins, as a linear search would."""
    index: dict[str, CommandDefinition] = {}
    for command in commands:
        index.setdefault(command.name, command)
    return index


def create_tool_router(deps: ToolRouterDeps):
    """Create a router that dispatches built-in, grouped, or direct MCP tools.

    Lookups are precomputed when the router is created, so a call costs the
    same at 10 or 1,000 commands. The active context is read on every call.
    """
    all_commands = deps.all_commands or deps.commands
    exposed_command_names = deps.exposed_command_names or {
        command.name for command in deps.commands
    }
    commands_by_name = _index_by_name(deps.commands)
    all_commands_by_name = _index_by_name(all_commands)
    get_group = deps.group_by_fn or derive_group_name
    commands_by_group: dict[str, list[CommandDefinition]] = {}
    all_commands_by_group: dict[str, list[CommandDefinition]] = {}
    if deps.tool_strategy == "grouped":
        for command in deps.commands:
            commands_by_group.setdefault(get_group(command) or "general", []).append(command)
        for command in all_commands:
            all_commands_by_group.setdefault(get_group(command) or "general", []).append(command)

    def mcp_context(prefix: str, active_context: str | None) -> CommandContext:
        return CommandContext(
            trace_id=new_trace_id(prefix),
            extra={"interface": "mcp", "active_context": active_context},
        )

    def not_in_context(name: str, active_context: str | None) -> CommandResult[Any]:
        return error(
            "COMMAND_NOT_IN_CONTEXT",
            f"Command '{name}' is not available in context '{active_context}'",
            suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
        )

    async def route_tool_call(tool_name: str, args: Any) -> Any:
        active_context = deps.context_state.get_active() if deps.context_state else None

        if tool_name == "afd-call":
            payload = args or {}
            command_name = payload.get("command") if isinstance(payload, dict) else None
            if not command_name or not isinstance(command_name, str):
                return error(
                    "VALIDATION_ERROR",
                    "Missing required field: command",
                    suggestion="Provide { command: 'command-name', input: {...} }.",
                )

            command = commands_by_name.get(command_name)
            if command is None:
                registered = all_commands_by_name.get(command_name)
                if registered is not None:
                    if not is_command_accessible(registered, active_context):
                        return not_in_context(command_name, active_context)
                    return error(
                        "COMMAND_NOT_EXPOSED",
                        f"Command '{command_name}' exists but is not exposed via this server",
                        suggestion="Enable MCP exposure for the command or use a different interface.",
                    )
                return error(
                    "COMMAND_NOT_FOUND",
                    f"Command '{command_name[:128]}' not found",
                    suggestion="Use afd-discover or afd-help to list available commands.",
                )

            if not is_command_accessible(command, active_context):
                return not_in_context(command_name, active_context)

            return await deps.execute_command(
                command_name,
                payload.get("input", {}),
                mcp_context("afd-call", active_context),
            )

        if tool_name == "afd-discover":
            visible_commands = [
                command
                for command in deps.commands
                if is_command_accessible(command, active_context)
            ]
            return execute_discover(visible_commands, args or {})

        if tool_name == "afd-detail":
            visible_all_commands = [
                command
                for command in all_commands
                if is_command_accessible(command, active_context)
            ]
            return execute_detail(visible_all_commands, exposed_command_names, args or {})

        if tool_name == "afd-batch":
            if not is_batch_request(args):
                return error(
                    "INVALID_BATCH_REQUEST",
                    "Invalid batch request format",
                    suggestion="Provide { commands: [...] } with command objects.",
                )
            return await deps.execute_batch(args, mcp_context("batch", active_context))

        if tool_name == "afd-pipe":
            if not is_pipeline_request(args):
                return error(
                    "INVALID_PIPELINE_REQUEST",
                    "Invalid pipeline request format",
                    suggestion="Provide { steps: [...] } with pipeline step objects.",
                )
            return await deps.execute_pipeline(args, mcp_context("pipeline", active_context))

        if deps.tool_strategy == "grouped":
            payload = args or {}
            action = payload.get("action") if isinstance(payload, dict) else None
            all_group_commands = all_commands_by_group.get(tool_name, [])
            group_commands = [
                command
                for command in commands_by_group.get(tool_name, [])
                if is_command_accessible(command, active_context)
            ]

            if not group_commands and all_group_commands:
                if isinstance(action, str):
                    hidden_command = next(
                        (
                            item
                            for item in all_group_commands
                            if derive_group_action(item) == action
                            and not is_command_accessible(item, active_context)
                        ),
                        None,
                    )
                    if hidden_command is not None:
                        return not_in_context(hidden_command.name, active_context)

                inaccessible_commands = [
                    item for item in all_group_commands if not is_command_accessible(item, active_context)
                ]
                if inaccessible_commands:
                    return error(
                        "COMMAND_NOT_IN_CONTEXT",
                        f"Grouped tool '{tool_name}' is not available in context '{active_context}'",
                        suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
                    )

            if group_commands and not isinstance(action, str):
                available_actions = [derive_group_action(command) for command in group_commands]
                return error(
                    "INVALID_GROUPED_CALL",
                    f"Grouped tool '{tool_name}' requires an action parameter",
                    suggestion=(
                        "Provide { action: '<action>', params: {...} }. "
                        f"Available actions: {', '.join(available_actions)}"
                    ),
                )

            if group_commands and isinstance(action, str):
                command = next(
                    (
                        item
                        for item in group_commands
                        if derive_group_action(item) == action
                    ),
                    None,
                )
                if command is None:
                    hidden_command = next(
                        (
                            item
                            for item in all_group_commands
                            if derive_group_action(item) == action
                            and not is_command_accessible(item, active_context)
                        ),
                        None,
                    )
                    if hidden_command is not None:
                        return not_in_context(hidden_command.name, active_context)
                    return error(
                        "COMMAND_NOT_FOUND",
                        f"Action '{action}' is not available for grouped tool '{tool_name}'",
                        suggestion="Use afd-discover or afd-help to inspect available actions.",
                    )
                return await deps.execute_command(
                    command.name,
                    payload.get("params", {}),
                    mcp_context("trace", active_context),
                )

        command = commands_by_name.get(tool_name)
        if not is_command_accessible(command, active_context):
            return not_in_context(tool_name, active_context)

        return await deps.execute_command(
            tool_name,
            args or {},
            mcp_context("trace", active_context),
        )

    return route_tool_call
