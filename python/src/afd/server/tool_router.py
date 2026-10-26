"""Shared MCP tool call routing for AFD servers."""

from __future__ import annotations

import copy
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from afd.core.actor import Actor
from afd.core.batch import create_failed_batch_result
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.pipeline import create_pipeline_failure
from afd.core.result import CommandResult, error, failure as command_failure
from afd.server.confirmations import (
    ConfirmationGate,
    ConfirmationStep,
    declares_confirm_input,
    named_acknowledgement,
    without_confirm,
)
from afd.core.similarity import truncate_name
from afd.server.lazy_tools import execute_detail, execute_discover, not_found_suggestion
from afd.server.tools import derive_group_action, derive_group_name


@dataclass
class ToolRouterDeps:
    execute_command: Callable[[str, Any, CommandContext | None], Awaitable[CommandResult[Any]]]
    # The batch and pipeline executors validate the whole envelope themselves
    # and return a failed BatchResult or PipelineResult for an invalid one.
    execute_batch: Callable[[Any, CommandContext | None], Awaitable[Any]]
    execute_pipeline: Callable[[Any, CommandContext | None], Awaitable[Any]]
    commands: list[CommandDefinition]
    tool_strategy: str
    group_by_fn: Callable[[CommandDefinition], str | None] | None = None
    all_commands: list[CommandDefinition] | None = None
    exposed_command_names: set[str] | None = None
    context_state: Any = None
    # The actor of MCP calls; each call gets its own copy.
    actor: Actor | None = None
    # Confirmation enforcement (`confirmations` server option); None means off.
    confirmations: ConfirmationGate | None = None

_MCP_ACTOR = Actor(kind="agent")
"""The default actor of a call over MCP."""


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
            extra={"interface": "mcp", "remote": True, "active_context": active_context},
            actor=copy.copy(deps.actor or _MCP_ACTOR),
        )

    def not_in_context(name: str, active_context: str | None) -> CommandResult[Any]:
        return error(
            "COMMAND_NOT_IN_CONTEXT",
            f"Command '{name}' is not available in context '{active_context}'",
            suggestion="Use afd-context-list to see contexts or afd-context-enter to switch.",
        )

    gate = deps.confirmations if deps.confirmations and deps.confirmations.mode != "off" else None

    async def unconfirmed(
        steps: list[ConfirmationStep],
        acknowledged: bool | set[str] | None,
        how: str,
        to_result: Callable[[Any], Any] | None = None,
    ) -> Any:
        """``None`` when the call may run; otherwise its result (an error, or an
        ``input_required`` result for a request that can elicit)."""
        if gate is None:
            return None
        outcome = await gate.check(steps, acknowledged, how)
        if outcome.kind == "proceed":
            return None
        if outcome.kind == "input-required":
            return outcome.result
        refusal = outcome.error
        if to_result is not None:
            return to_result(refusal)
        return command_failure(refusal)

    async def route_tool_call(tool_name: str, args: Any) -> Any:
        active_context = deps.context_state.get_active() if deps.context_state else None

        if tool_name == "afd-call":
            payload = {} if args is None else args
            command_name = payload.get("command") if isinstance(payload, dict) else None
            if not command_name or not isinstance(command_name, str):
                return error(
                    "VALIDATION_ERROR",
                    "Missing required field: command",
                    suggestion="Provide { command: 'command-name', input: {...} }.",
                )

            command = commands_by_name.get(command_name)
            if command is None:
                # An unexposed command gets the same answer as an unknown one, so a
                # remote caller cannot learn that a private command exists
                # (spec/error-codes.md, D4).
                callable_names = [
                    item.name
                    for item in deps.commands
                    if is_command_accessible(item, active_context)
                ]
                return error(
                    "COMMAND_NOT_FOUND",
                    f"Command '{truncate_name(command_name)}' not found",
                    suggestion=not_found_suggestion(command_name, callable_names),
                )

            if not is_command_accessible(command, active_context):
                return not_in_context(command_name, active_context)

            command_input = payload.get("input", {})
            refused = await unconfirmed(
                [ConfirmationStep(command_name, command_input)],
                payload.get("confirm") is True,
                "repeat the afd-call with confirm: true",
            )
            if refused is not None:
                return refused

            return await deps.execute_command(
                command_name,
                command_input,
                mcp_context("afd-call", active_context),
            )

        if tool_name == "afd-discover":
            visible_commands = [
                command
                for command in deps.commands
                if is_command_accessible(command, active_context)
            ]
            return execute_discover(visible_commands, {} if args is None else args)

        if tool_name == "afd-detail":
            visible_all_commands = [
                command
                for command in all_commands
                if is_command_accessible(command, active_context)
            ]
            return execute_detail(visible_all_commands, exposed_command_names, {} if args is None else args)

        if tool_name == "afd-batch":
            refused = await unconfirmed(
                _steps(args, "commands"),
                named_acknowledgement(args.get("confirm") if isinstance(args, dict) else None),
                "repeat the afd-batch with confirm: [the command names]",
                lambda failure: create_failed_batch_result(failure),
            )
            if refused is not None:
                return refused
            return await deps.execute_batch(without_confirm(args), mcp_context("batch", active_context))

        if tool_name == "afd-pipe":
            refused = await unconfirmed(
                _steps(args, "steps"),
                named_acknowledgement(args.get("confirm") if isinstance(args, dict) else None),
                "repeat the afd-pipe with confirm: [the command names]",
                lambda failure: create_pipeline_failure(failure),
            )
            if refused is not None:
                return refused
            return await deps.execute_pipeline(
                without_confirm(args), mcp_context("pipeline", active_context)
            )

        if deps.tool_strategy == "grouped":
            payload = {} if args is None else args
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
                params = payload.get("params", {})
                refused = await unconfirmed(
                    [ConfirmationStep(command.name, params)],
                    payload.get("confirm") is True,
                    f"repeat the {tool_name} call with confirm: true",
                )
                if refused is not None:
                    return refused
                return await deps.execute_command(
                    command.name,
                    params,
                    mcp_context("trace", active_context),
                )

        command = commands_by_name.get(tool_name)
        if not is_command_accessible(command, active_context):
            return not_in_context(tool_name, active_context)

        # A confirm-gated tool advertises an optional `confirm` argument, removed here before
        # the command validates its input, unless the command's own schema declares it.
        command_input = {} if args is None else args
        acknowledged = False
        if gate is not None and command is not None and command.confirm_prompt and isinstance(command_input, dict):
            acknowledged = command_input.get("confirm") is True
            if not declares_confirm_input(command):
                command_input = without_confirm(command_input)
        refused = await unconfirmed(
            [ConfirmationStep(tool_name, command_input)],
            acknowledged,
            "repeat the call with confirm: true",
        )
        if refused is not None:
            return refused

        return await deps.execute_command(
            tool_name,
            command_input,
            mcp_context("trace", active_context),
        )

    return route_tool_call


def _steps(args: Any, key: str) -> list[ConfirmationStep]:
    """The commands of an ``afd-batch`` (``commands``) or ``afd-pipe`` (``steps``) request."""
    items = args.get(key) if isinstance(args, dict) else None
    if not isinstance(items, list):
        return []
    return [
        ConfirmationStep(item["command"], item.get("input", {}))
        for item in items
        if isinstance(item, dict) and isinstance(item.get("command"), str)
    ]
