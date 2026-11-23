"""Shared MCP tool call routing for AFD servers."""

from __future__ import annotations

import copy
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from afd.core.actor import Actor
from afd.core.batch import create_failed_batch_result
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.pipeline import create_pipeline_failure
from afd.core.result import CommandResult, error, failure as command_failure
from afd.server.approval_relay import (
    NEVER_ASKS,
    UpFrontApproval,
    bind_approval_relay,
    current_approval_relay,
)
from afd.server.confirmations import (
    ConfirmationGate,
    ConfirmationStep,
    declares_confirm_input,
    named_acknowledgement,
    without_confirm,
)
from afd.core.similarity import truncate_name
from afd.server.auth import credentials_actor
from afd.server.context_fields import current_context_field_values
from afd.server.context_hook import copy_extra, current_hook_outcome
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
    # For the up-front approval of afd-batch and afd-pipe over the MCP approval relay: whether
    # an MCP caller can run a command, and one step's validated input as it will run.
    can_run: Callable[[str], bool] | None = None
    validate_step: Callable[[str, Any], tuple[bool, Any]] | None = None
    # MCP Tasks (spec/command-metadata.md, "Tasks"): single-command dispatch and composite refusal.
    dispatch_task: Callable[[CommandDefinition, Any, CommandContext], Awaitable[Any]] | None = None
    refuse_composite_task: Callable[[Literal["afd-batch", "afd-pipe"], str], Any] | None = None
    # Verified credentials admitted by AFD's HTTP auth layer for the current request, if any.
    get_admitted_credentials: Callable[[], Any] | None = None

NOT_IN_CONTEXT_SUGGESTION = (
    "Use afd-context-list to see available contexts, or afd-context-enter to switch."
)
"""The ``COMMAND_NOT_IN_CONTEXT`` suggestion (spec/error-codes.md)."""

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
        # Precedence (spec/context-fields.md, "Trusted code wins"):
        # 1. Declared context fields from the request's _meta (caller claims)
        # 2. The host's context_hook values (trusted code wins over _meta)
        # 3. The server's own invariants (interface, remote, active_context, credentials)
        admitted = (
            deps.get_admitted_credentials() if deps.get_admitted_credentials is not None else None
        )
        default_actor = (
            credentials_actor(admitted) if admitted is not None else (deps.actor or _MCP_ACTOR)
        )
        outcome = current_hook_outcome()
        hook_ctx = outcome.context if outcome is not None else None
        if hook_ctx is not None:
            return CommandContext(
                trace_id=hook_ctx.trace_id or new_trace_id(prefix),
                timeout=hook_ctx.timeout,
                extra={
                    **current_context_field_values(),
                    **copy_extra(hook_ctx.extra),
                    "interface": "mcp",
                    "remote": True,
                    "active_context": active_context,
                },
                actor=copy.copy(hook_ctx.actor)
                if hook_ctx.actor is not None
                else copy.copy(default_actor),
                clock=hook_ctx.clock,
                random=hook_ctx.random,
                approval=hook_ctx.approval,
                credentials=admitted,
            )
        return CommandContext(
            trace_id=new_trace_id(prefix),
            extra={
                **current_context_field_values(),
                "interface": "mcp",
                "remote": True,
                "active_context": active_context,
            },
            actor=copy.copy(default_actor),
            credentials=admitted,
        )

    def not_in_context(name: str, active_context: str | None) -> CommandResult[Any]:
        return error(
            "COMMAND_NOT_IN_CONTEXT",
            f"Command '{name}' is not available in context '{active_context}'",
            suggestion=NOT_IN_CONTEXT_SUGGESTION,
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

    def routed(command_name: str) -> None:
        """Name the one command this tool call routes to: only it may ask for approval."""
        relay = current_approval_relay()
        if relay is not None:
            relay.route(command_name)

    async def approved_up_front(
        tool: Literal["afd-batch", "afd-pipe"],
        request: Any,
        run: Callable[[], Awaitable[Any]],
        refused: Callable[[Any], Any],
    ) -> Any:
        """Run an ``afd-batch`` or ``afd-pipe``. On a call that can carry a form elicitation,
        its steps never ask one at a time (asking mid-run would run the earlier steps again on
        the retry): the approval middleware approves the whole call up front, before any step
        runs (#459), and a refusal answers the call instead of the run."""
        relay = current_approval_relay()
        if relay is None or deps.can_run is None or deps.validate_step is None:
            return await run()
        up_front = UpFrontApproval(
            relay, tool, request, deps.can_run, deps.validate_step, commands_by_name.get
        )
        with bind_approval_relay(NEVER_ASKS, up_front):
            result = await run()
        if up_front.refusal is not None:
            return refused(up_front.refusal)
        return result

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

            routed(command_name)
            ctx = mcp_context("afd-call", active_context)
            if deps.dispatch_task is not None:
                task_result = await deps.dispatch_task(command, command_input, ctx)
                if task_result is not None:
                    return task_result
            return await deps.execute_command(
                command_name,
                command_input,
                ctx,
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
            if deps.refuse_composite_task is not None:
                required_task = _first_required_task(args, "commands", commands_by_name)
                if required_task is not None:
                    return create_failed_batch_result(
                        deps.refuse_composite_task("afd-batch", required_task)
                    )
            refused = await unconfirmed(
                _steps(args, "commands"),
                named_acknowledgement(args.get("confirm") if isinstance(args, dict) else None),
                "repeat the afd-batch with confirm: [the command names]",
                lambda failure: create_failed_batch_result(failure),
            )
            if refused is not None:
                return refused
            request = without_confirm(args)
            return await approved_up_front(
                "afd-batch",
                request,
                lambda: deps.execute_batch(request, mcp_context("batch", active_context)),
                create_failed_batch_result,
            )

        if tool_name == "afd-pipe":
            if deps.refuse_composite_task is not None:
                required_task = _first_required_task(args, "steps", commands_by_name)
                if required_task is not None:
                    return create_pipeline_failure(
                        deps.refuse_composite_task("afd-pipe", required_task)
                    )
            refused = await unconfirmed(
                _steps(args, "steps"),
                named_acknowledgement(args.get("confirm") if isinstance(args, dict) else None),
                "repeat the afd-pipe with confirm: [the command names]",
                lambda failure: create_pipeline_failure(failure),
            )
            if refused is not None:
                return refused
            request = without_confirm(args)
            return await approved_up_front(
                "afd-pipe",
                request,
                lambda: deps.execute_pipeline(request, mcp_context("pipeline", active_context)),
                create_pipeline_failure,
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
                        suggestion=NOT_IN_CONTEXT_SUGGESTION,
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
                        suggestion="Use afd-discover or afd-detail to inspect available actions.",
                    )
                params = payload.get("params", {})
                refused = await unconfirmed(
                    [ConfirmationStep(command.name, params)],
                    payload.get("confirm") is True,
                    f"repeat the {tool_name} call with confirm: true",
                )
                if refused is not None:
                    return refused
                routed(command.name)
                ctx = mcp_context("trace", active_context)
                if deps.dispatch_task is not None:
                    task_result = await deps.dispatch_task(command, params, ctx)
                    if task_result is not None:
                        return task_result
                return await deps.execute_command(
                    command.name,
                    params,
                    ctx,
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

        routed(tool_name)
        ctx = mcp_context("trace", active_context)
        if command is not None and deps.dispatch_task is not None:
            task_result = await deps.dispatch_task(command, command_input, ctx)
            if task_result is not None:
                return task_result
        return await deps.execute_command(
            tool_name,
            command_input,
            ctx,
        )

    return route_tool_call


def _first_required_task(
    args: Any, key: str, commands_by_name: dict[str, CommandDefinition]
) -> str | None:
    """First MCP-exposed command in an ``afd-batch`` or ``afd-pipe`` that declares ``task='required'``."""
    items = args.get(key) if isinstance(args, dict) else None
    if not isinstance(items, list):
        return None
    for item in items:
        if not isinstance(item, dict):
            continue
        name = item.get("command")
        if not isinstance(name, str):
            continue
        cmd = commands_by_name.get(name)
        if cmd is not None and cmd.task == "required":
            return cmd.name
    return None


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
