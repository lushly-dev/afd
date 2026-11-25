"""Shared MCP tool call routing for AFD servers."""

from __future__ import annotations

import copy
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

from afd.core.actor import Actor
from afd.core.batch import (
    DEFAULT_MAX_BATCH_PARALLELISM,
    DEFAULT_MAX_BATCH_SIZE,
    check_batch_limits,
    create_failed_batch_result,
)
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.output_budget import current_output_budget_ask
from afd.core.pipeline import create_pipeline_failure
from afd.core.result import CommandResult, error
from afd.core.result import failure as command_failure
from afd.core.similarity import truncate_name
from afd.server.approval_relay import (
    NEVER_ASKS,
    UpFrontApproval,
    bind_approval_relay,
    current_approval_relay,
)
from afd.server.auth import credentials_actor
from afd.server.auth_view import (
    ScopeView,
    known_only,
    listed_commands,
    scope_view_of,
    select_grouped_call,
    shown_only,
)
from afd.server.config import refuse_apps_tool_call
from afd.server.confirmations import (
    ConfirmationGate,
    ConfirmationStep,
    declares_confirm_input,
    named_acknowledgement,
    without_confirm,
)
from afd.server.context_fields import current_context_field_values
from afd.server.context_hook import copy_extra, current_hook_outcome
from afd.server.human_relay import HumanRelayGate, host_verified_unrelayable
from afd.server.lazy_tools import execute_detail, execute_discover, not_found_suggestion
from afd.server.tools import derive_group_name


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
    # Host-verified confirmation gate (always enforced on MCP regardless of `confirmations`).
    human_relay: HumanRelayGate | None = None
    # For the up-front approval of afd-batch and afd-pipe over the MCP approval relay: whether
    # an MCP caller can run a command, and one step's validated input as it will run.
    can_run: Callable[[str], bool] | None = None
    validate_step: Callable[[str, Any], tuple[bool, Any]] | None = None
    # MCP Tasks (spec/command-metadata.md, "Tasks"): single-command dispatch and composite refusal.
    dispatch_task: Callable[[CommandDefinition, Any, CommandContext], Awaitable[Any]] | None = None
    refuse_composite_task: Callable[[Literal["afd-batch", "afd-pipe"], str], Any] | None = None
    # Verified credentials and per-request ScopeView admitted by AFD's HTTP auth layer, if any.
    get_admitted_credentials: Callable[[], Any] | None = None
    get_scope_view: Callable[[], ScopeView | None] | None = None
    # Batch execution limits enforced before confirmations/approvals (spec/execution-controls.md).
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE
    max_batch_parallelism: int = DEFAULT_MAX_BATCH_PARALLELISM


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


def create_tool_router(deps: ToolRouterDeps) -> Callable[..., Awaitable[Any]]:
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
    if deps.tool_strategy == "grouped":
        for command in deps.commands:
            commands_by_group.setdefault(get_group(command) or "general", []).append(command)

    def mcp_context(
        prefix: str,
        active_context: str | None,
        view: ScopeView | None = None,
        caller_context: CommandContext | None = None,
    ) -> CommandContext:
        # Precedence (spec/context-fields.md, "Trusted code wins"):
        # 1. Declared context fields from the request's _meta (caller claims)
        # 2. The host's context_hook values (trusted code wins over _meta)
        # 3. The server's own invariants (interface, remote, active_context, credentials, scope view)
        ambient_creds = (
            deps.get_admitted_credentials() if deps.get_admitted_credentials is not None else None
        )
        # When a background task or nested call forwards its explicit CommandContext into a
        # meta-tool, keep its credentials and ScopeView even after the HTTP request has closed.
        admitted = (
            caller_context.credentials
            if caller_context is not None and caller_context.credentials is not None
            else (
                view.credentials
                if caller_context is not None and view is not None
                else ambient_creds
            )
        )
        default_actor = (
            credentials_actor(admitted) if admitted is not None else (deps.actor or _MCP_ACTOR)
        )
        if caller_context is not None:
            caller_budget = (
                current_output_budget_ask()
                if current_output_budget_ask() is not None
                else getattr(caller_context, "_output_budget_ask", None)
            )
            return CommandContext(
                trace_id=caller_context.trace_id or new_trace_id(prefix),
                timeout=caller_context.timeout,
                extra={
                    **current_context_field_values(),
                    **copy_extra(caller_context.extra),
                    "interface": "mcp",
                    "remote": True,
                    "active_context": active_context,
                },
                actor=copy.copy(caller_context.actor)
                if caller_context.actor is not None
                else copy.copy(default_actor),
                clock=caller_context.clock,
                random=caller_context.random,
                approval=caller_context.approval,
                credentials=admitted,
                report_progress=caller_context.report_progress,
                cancel=caller_context.cancel,
                _output_budget_ask=caller_budget,
                _scope_view=view,
            )
        outcome = current_hook_outcome()
        hook_ctx = outcome.context if outcome is not None else None
        if hook_ctx is not None:
            budget_ask = (
                hook_ctx._output_budget_ask
                if hook_ctx._output_budget_ask is not None
                else current_output_budget_ask()
            )
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
                cancel=hook_ctx.cancel,
                signal=hook_ctx.signal,
                credentials=admitted,
                _output_budget_ask=budget_ask,
                _scope_view=view,
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
            _output_budget_ask=current_output_budget_ask(),
            _scope_view=view,
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
        if refusal is None:
            raise RuntimeError("confirmation gate refused without an error")
        return command_failure(refusal)

    def refuse_host_verified_steps(
        steps: list[ConfirmationStep], known: dict[str, CommandDefinition]
    ) -> Any:
        if deps.human_relay is not None:
            return deps.human_relay.refuse_steps(steps)
        names: list[str] = []
        for step in steps:
            cmd = known.get(step.command)
            if (
                cmd is not None
                and getattr(cmd, "confirmation_mode", None) == "host-verified"
                and step.command not in names
            ):
                names.append(step.command)
        return host_verified_unrelayable(names, has_relay=False) if names else None

    async def dispatch_host_verified(
        command: CommandDefinition,
        command_input: Any,
        ctx: CommandContext,
    ) -> Any:
        """Gate and dispatch a single host-verified command (never form-elicited or acknowledged)."""
        if deps.human_relay is None:
            return command_failure(host_verified_unrelayable([command.name], has_relay=False))
        outcome = await deps.human_relay.check(command, command_input, ctx)
        if outcome.kind == "input-required":
            return outcome.result
        if outcome.kind == "error":
            if outcome.error is None:
                raise RuntimeError("human relay gate refused without an error")
            return command_failure(outcome.error)
        with bind_approval_relay(NEVER_ASKS):
            return await deps.execute_command(
                command.name,
                command_input,
                outcome.context if outcome.context is not None else ctx,
            )

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

    async def route_tool_call(
        tool_name: str, args: Any, caller_context: CommandContext | None = None
    ) -> Any:
        # App-to-app calls (spec/command-metadata.md, "App-to-app calls") are never routed
        # through MCP tools or meta-tools, and must not be overwritten with interface="mcp".
        refused = refuse_apps_tool_call(tool_name, caller_context)
        if refused is not None:
            return refused

        active_context = deps.context_state.get_active() if deps.context_state else None
        view = scope_view_of(caller_context) if caller_context is not None else None
        if view is None and deps.get_scope_view is not None:
            view = deps.get_scope_view()

        # M6: after routing (and context_hook) and before the confirmation gate, every call
        # carrying credentials is decided again; a batch or pipeline fails as a whole.
        if view is not None:
            decision = view.decide_call(tool_name, args, active_context=active_context)
            if decision != "proceed":
                insufficient = view.insufficient_scope(decision.forbidden)
                if tool_name == "afd-batch":
                    return create_failed_batch_result(insufficient)
                if tool_name == "afd-pipe":
                    return create_pipeline_failure(insufficient)
                return command_failure(insufficient)

        # M6 ("Hidden commands"): commands the caller does not know do not exist on any route.
        known_commands = known_only(deps.commands, view)
        known_all_commands = known_only(all_commands, view)
        known_by_name = commands_by_name if view is None else _index_by_name(known_commands)

        if tool_name == "afd-call":
            payload = {} if args is None else args
            command_name = payload.get("command") if isinstance(payload, dict) else None
            if not command_name or not isinstance(command_name, str):
                return error(
                    "VALIDATION_ERROR",
                    "Missing required field: command",
                    suggestion="Provide { command: 'command-name', input: {...} }.",
                )

            command = known_by_name.get(command_name)
            if command is None:
                # An unexposed or hidden command gets the same answer as an unknown one, so a
                # remote caller cannot learn that it exists (spec/error-codes.md, D4; M6).
                callable_names = [
                    item.name
                    for item in shown_only(known_commands, view)
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
            if getattr(command, "confirmation_mode", None) == "host-verified":
                ctx = mcp_context("afd-call", active_context, view, caller_context)
                return await dispatch_host_verified(command, command_input, ctx)

            refused = await unconfirmed(
                [ConfirmationStep(command_name, command_input)],
                payload.get("confirm") is True,
                "repeat the afd-call with confirm: true",
            )
            if refused is not None:
                return refused

            routed(command_name)
            ctx = mcp_context("afd-call", active_context, view, caller_context)
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
            visible_commands = listed_commands(
                [
                    command
                    for command in known_commands
                    if is_command_accessible(command, active_context)
                ],
                view,
            )
            return execute_discover(visible_commands, {} if args is None else args)

        if tool_name == "afd-detail":
            visible_all_commands = listed_commands(
                [
                    command
                    for command in known_all_commands
                    if is_command_accessible(command, active_context)
                ],
                view,
            )
            return execute_detail(
                visible_all_commands, exposed_command_names, {} if args is None else args
            )

        if tool_name == "afd-batch":
            limit_error = check_batch_limits(
                args,
                max_batch_size=deps.max_batch_size,
                max_batch_parallelism=deps.max_batch_parallelism,
            )
            if limit_error is not None:
                return create_failed_batch_result(limit_error)
            if deps.refuse_composite_task is not None:
                required_task = _first_required_task(args, "commands", known_by_name)
                if required_task is not None:
                    return create_failed_batch_result(
                        deps.refuse_composite_task("afd-batch", required_task)
                    )
            batch_steps = [
                step
                for step in _steps(args, "commands")
                if view is None or view.known(step.command)
            ]
            hv_refused = refuse_host_verified_steps(batch_steps, known_by_name)
            if hv_refused is not None:
                return create_failed_batch_result(hv_refused)
            refused = await unconfirmed(
                batch_steps,
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
                lambda: deps.execute_batch(
                    request, mcp_context("batch", active_context, view, caller_context)
                ),
                create_failed_batch_result,
            )

        if tool_name == "afd-pipe":
            if deps.refuse_composite_task is not None:
                required_task = _first_required_task(args, "steps", known_by_name)
                if required_task is not None:
                    return create_pipeline_failure(
                        deps.refuse_composite_task("afd-pipe", required_task)
                    )
            pipe_steps = [
                step for step in _steps(args, "steps") if view is None or view.known(step.command)
            ]
            hv_refused = refuse_host_verified_steps(pipe_steps, known_by_name)
            if hv_refused is not None:
                return create_pipeline_failure(hv_refused)
            refused = await unconfirmed(
                pipe_steps,
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
                lambda: deps.execute_pipeline(
                    request, mcp_context("pipeline", active_context, view, caller_context)
                ),
                create_pipeline_failure,
            )

        if deps.tool_strategy == "grouped":
            payload = {} if args is None else args
            action = payload.get("action") if isinstance(payload, dict) else None
            members = known_only(commands_by_group.get(tool_name, []), view)
            selection = select_grouped_call(
                members,
                active_context=active_context,
                action=action,
                is_shown=lambda cmd: view is None or view.shown(cmd.name),
            )
            if selection.kind == "not_in_context_action" and selection.command is not None:
                return not_in_context(selection.command.name, active_context)
            if selection.kind == "not_in_context_group":
                return error(
                    "COMMAND_NOT_IN_CONTEXT",
                    f"Grouped tool '{tool_name}' is not available in context '{active_context}'",
                    suggestion=NOT_IN_CONTEXT_SUGGESTION,
                )
            if selection.kind == "missing_action":
                return error(
                    "INVALID_GROUPED_CALL",
                    f"Grouped tool '{tool_name}' requires an action parameter",
                    suggestion=(
                        "Provide { action: '<action>', params: {...} }. "
                        f"Available actions: {', '.join(selection.available_actions)}"
                    ),
                )
            if selection.kind == "ambiguous":
                return error(
                    "AMBIGUOUS_ACTION",
                    f"Action '{truncate_name(str(action))}' does not identify one command in group '{truncate_name(tool_name)}'",
                    suggestion="Use afd-call with the full command name, or list tools to find a valid action.",
                )
            if selection.kind == "unknown_action":
                return error(
                    "COMMAND_NOT_FOUND",
                    f"Action '{action}' is not available for grouped tool '{tool_name}'",
                    suggestion="Use afd-discover or afd-detail to inspect available actions.",
                )
            if selection.kind == "command" and selection.command is not None:
                command = selection.command
                params = payload.get("params", {})
                if getattr(command, "confirmation_mode", None) == "host-verified":
                    ctx = mcp_context("trace", active_context, view, caller_context)
                    return await dispatch_host_verified(command, params, ctx)
                refused = await unconfirmed(
                    [ConfirmationStep(command.name, params)],
                    payload.get("confirm") is True,
                    f"repeat the {tool_name} call with confirm: true",
                )
                if refused is not None:
                    return refused
                routed(command.name)
                ctx = mcp_context("trace", active_context, view, caller_context)
                if deps.dispatch_task is not None:
                    task_result = await deps.dispatch_task(command, params, ctx)
                    if task_result is not None:
                        return task_result
                return await deps.execute_command(
                    command.name,
                    params,
                    ctx,
                )

        command = known_by_name.get(tool_name)
        if not is_command_accessible(command, active_context):
            return not_in_context(tool_name, active_context)

        # A confirm-gated tool advertises an optional `confirm` argument, removed here before
        # the command validates its input, unless the command's own schema declares it.
        # Host-verified commands never advertise or accept `confirm`.
        command_input = {} if args is None else args
        if command is not None and getattr(command, "confirmation_mode", None) == "host-verified":
            ctx = mcp_context("trace", active_context, view, caller_context)
            return await dispatch_host_verified(command, command_input, ctx)
        acknowledged = False
        if (
            gate is not None
            and command is not None
            and command.confirm_prompt
            and isinstance(command_input, dict)
        ):
            acknowledged = command_input.get("confirm") is True
            if not declares_confirm_input(command):
                command_input = without_confirm(command_input)
        if command is not None:
            refused = await unconfirmed(
                [ConfirmationStep(tool_name, command_input)],
                acknowledged,
                "repeat the call with confirm: true",
            )
            if refused is not None:
                return refused

        routed(tool_name)
        ctx = mcp_context("trace", active_context, view, caller_context)
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
