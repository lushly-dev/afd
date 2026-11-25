"""Host-verified MCP wire helpers: pre-boundary ``requestState`` pass-through,
``elicitationId`` preservation, target resolution, and validated-input conversion."""

from __future__ import annotations

import dataclasses
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any

from pydantic import BaseModel

from afd.core.builtin_names import AFD_META_TOOL_NAMES
from afd.core.commands import CommandDefinition
from afd.server.auth import claim_admitted_dispatch
from afd.server.auth_view import ScopeView, select_grouped_call
from afd.server.bootstrap.afd_context import AFD_CONTEXT_META_KEY
from afd.server.context_fields import ContextField
from afd.server.context_hook import HookOutcome, bind_hook_outcome
from afd.server.human_relay import RELAY_INPUT_KEY, RelayWireBox, bind_relay_wire
from afd.server.meta_argument import lift_meta_argument, meta_argument_keys
from afd.server.principal import IncompleteCredentials
from afd.server.tools import derive_group_name
from afd.server.types import GroupByFn, ToolStrategy

logger = logging.getLogger("afd.server")


def in_context(command: CommandDefinition, active_context: str | None) -> bool:
    """Whether a command is visible in the active context (universal commands always are)."""
    return not active_context or not command.contexts or active_context in command.contexts


def request_meta(request: Any) -> Any:
    """The raw ``_meta`` of an SDK request (``ServerRequestContext.params``), or ``None``."""
    params = getattr(request, "params", None)
    return params.get("_meta") if isinstance(params, Mapping) else None


def targets_host_verified(
    *,
    tool_name: Any,
    arguments: Any,
    meta: Any,
    view: ScopeView | None,
    context_fields: Sequence[ContextField],
    context_names: set[str],
    exposed_commands: Sequence[CommandDefinition],
    tool_strategy: ToolStrategy,
    group_by: GroupByFn | None,
) -> bool:
    """Whether a ``tools/call`` uniquely resolves (using the router's effective context,
    exposure, scope visibility, and grouped-action selection rules) to a command with
    ``confirmation_mode == "host-verified"``."""
    if not isinstance(tool_name, str):
        return False
    lifted = lift_meta_argument(tool_name, arguments, meta, meta_argument_keys(context_fields))
    if lifted.error is not None:
        return False
    effective_args = lifted.arguments
    raw_ctx = lifted.meta.get(AFD_CONTEXT_META_KEY) if isinstance(lifted.meta, Mapping) else None
    if isinstance(raw_ctx, str) and raw_ctx in context_names:
        active_context: str | None = raw_ctx
    elif raw_ctx is not None:
        # Unknown context will fail before routing; never strip SDK requestState for it.
        return False
    else:
        active_context = None

    known = [cmd for cmd in exposed_commands if view is None or view.known(cmd.name)]
    by_name = {cmd.name: cmd for cmd in known}
    if tool_name == "afd-call":
        cmd_name = effective_args.get("command") if isinstance(effective_args, Mapping) else None
        cmd = by_name.get(cmd_name) if isinstance(cmd_name, str) else None
        return (
            cmd is not None
            and in_context(cmd, active_context)
            and cmd.confirmation_mode == "host-verified"
        )
    if tool_name in AFD_META_TOOL_NAMES:
        return False
    if tool_strategy == "grouped":
        get_group = group_by or derive_group_name
        members = [cmd for cmd in known if (get_group(cmd) or "general") == tool_name]
        action = effective_args.get("action") if isinstance(effective_args, Mapping) else None
        selection = select_grouped_call(
            members,
            active_context=active_context,
            action=action,
            is_shown=lambda cmd: view is None or view.shown(cmd.name),
        )
        if selection.kind == "command" and selection.command is not None:
            return selection.command.confirmation_mode == "host-verified"
        if selection.kind != "fallthrough":
            return False
    cmd = by_name.get(tool_name)
    return (
        cmd is not None
        and in_context(cmd, active_context)
        and cmd.confirmation_mode == "host-verified"
    )


async def call_with_relay_wire(
    ctx: Any,
    call_next: Callable[[Any], Awaitable[Any]],
    *,
    is_host_verified: Callable[[Any, Any, Any], bool],
    check_bindable_principal: Callable[[Any], None],
) -> Any:
    """Carry ``HumanRelay``'s own ``requestState`` verbatim across the SDK's
    ``RequestStateBoundary`` and preserve ``elicitationId`` on the 2026-07-28 URL elicitation
    wire payload."""
    params = getattr(ctx, "params", None)
    wire = RelayWireBox()
    raw_state = params.get("requestState") if isinstance(params, Mapping) else None
    if (
        isinstance(params, Mapping)
        and isinstance(raw_state, str)
        and is_host_verified(params.get("name"), params.get("arguments"), params.get("_meta"))
    ):
        check_bindable_principal("tools/call")
        wire.inbound_state = raw_state
        cleaned = {key: value for key, value in params.items() if key != "requestState"}
        ctx = dataclasses.replace(ctx, params=cleaned)
    elif isinstance(params, Mapping) and raw_state is not None:
        check_bindable_principal("tools/call")
    with bind_relay_wire(wire):
        result = await call_next(ctx)
    if (
        wire.outbound_state is not None
        and isinstance(result, Mapping)
        and result.get("resultType") == "input_required"
    ):
        requests = result.get("inputRequests")
        relay_req = requests.get(RELAY_INPUT_KEY) if isinstance(requests, Mapping) else None
        relay_params = relay_req.get("params") if isinstance(relay_req, Mapping) else None
        if (
            isinstance(requests, Mapping)
            and isinstance(relay_req, Mapping)
            and isinstance(relay_params, Mapping)
            and relay_params.get("mode") == "url"
            and relay_params.get("url") == wire.outbound_url
        ):
            patched: dict[str, Any] = {**result, "requestState": wire.outbound_state}
            if wire.outbound_elicitation_id is not None:
                patched["inputRequests"] = {
                    **requests,
                    RELAY_INPUT_KEY: {
                        **relay_req,
                        "params": {
                            **relay_params,
                            "elicitationId": wire.outbound_elicitation_id,
                        },
                    },
                }
            return patched
    return result


def validated_input_for_resolver(data: Any) -> Any:
    """Build a plain dict of validated input fields using their input names (ignoring output
    ``exclude``, ``serialization_alias``, and ``field_serializer``) so a :class:`ScopeResolver`
    at execution sees the exact validated values the handler receives."""
    if isinstance(data, BaseModel):
        out: dict[str, Any] = {}
        for field_name, field_info in type(data).model_fields.items():
            key = field_name
            if isinstance(field_info.validation_alias, str):
                key = field_info.validation_alias
            elif field_info.validation_alias is None and isinstance(field_info.alias, str):
                key = field_info.alias
            out[key] = validated_input_for_resolver(getattr(data, field_name))
        extras = data.__pydantic_extra__
        if extras:
            for extra_key, extra_val in extras.items():
                out[extra_key] = validated_input_for_resolver(extra_val)
        return out
    if isinstance(data, list):
        return [validated_input_for_resolver(item) for item in data]
    if isinstance(data, tuple):
        return tuple(validated_input_for_resolver(item) for item in data)
    if isinstance(data, dict):
        return {k: validated_input_for_resolver(v) for k, v in data.items()}
    return data


def install_pre_boundary_middleware(server: Any) -> None:
    """Install middleware immediately before the SDK's ``RequestStateBoundary``.

    1. Runs ``context_hook`` once per ``tools/call`` before request-state unsealing,
       confirmation checks, context selection or command lookup, binding the hook's
       snapshotted actor so ``RequestStateSecurity(bind_principal=...)`` binds the
       actor the commands actually run with. On refusal, ``requestState`` is stripped
       from the forwarded params so the boundary neither unseals nor leaks state
       validity before ``call_tool`` returns the refusal through normal serialization.
    2. Refuses any ``requestState`` retry whose verified credentials are incomplete
       (``IncompleteCredentials``) with JSON-RPC ``INTERNAL_ERROR`` naming no one,
       before the boundary would answer ``-32602``.
    3. For host-verified ``tools/call`` requests, carries ``HumanRelay``'s own
       integrity-protected ``requestState`` verbatim across ``RequestStateBoundary`` and
       preserves ``elicitationId`` on the 2026-07-28 URL elicitation wire payload.

    Without the boundary where it is expected, the server refuses to start rather than
    accept requests without these guards.
    """
    from mcp import MCPError
    from mcp.server.request_state import RequestStateBoundary
    from mcp_types import INTERNAL_ERROR
    from mcp_types.methods import INPUT_REQUIRED_METHODS

    def check_bindable_principal(method: Any) -> None:
        try:
            server._request_principal()
        except IncompleteCredentials:
            # The reason only, never who: the credentials name the caller.
            logger.warning("refusing requestState on %s: incomplete credentials", method)
            raise MCPError(code=INTERNAL_ERROR, message="Internal error") from None

    async def _call_with_relay_wire(ctx: Any, call_next: Any, view: ScopeView | None) -> Any:
        return await call_with_relay_wire(
            ctx,
            call_next,
            is_host_verified=lambda name, args, meta: server._targets_host_verified(
                name, args, meta, view
            ),
            check_bindable_principal=check_bindable_principal,
        )

    async def pre_boundary(ctx: Any, call_next: Any) -> Any:
        with claim_admitted_dispatch(server._auth_layer):
            params = getattr(ctx, "params", None)
            method = getattr(ctx, "method", None)
            # M1 fail closed: when authorization is configured, refuse any request whose
            # credentials were not admitted by this server's own HTTP layer (unless stdio or
            # explicitly marked trusted), before context_hook, requestState or lookup.
            if not server._is_auth_admitted():
                if method == "tools/call":
                    if isinstance(params, Mapping) and (
                        params.get("requestState") is not None or "inputResponses" in params
                    ):
                        cleaned = {
                            key: value
                            for key, value in params.items()
                            if key not in ("requestState", "inputResponses")
                        }
                        ctx = dataclasses.replace(ctx, params=cleaned)
                    with bind_hook_outcome(HookOutcome(refusal=server._unauthorized_error())):
                        return await call_next(ctx)
                raise server._unauthorized_rpc_error()

            # M6: non-tool methods (tools/list, server/discover, resources/*, tasks/*, ...)
            # require the server's required_scopes even when pre-dispatch could not decide.
            view = server._current_scope_view()
            if (
                view is not None
                and method != "tools/call"
                and not (isinstance(method, str) and method.startswith("notifications/"))
            ):
                req_dec = view.decide_request()
                if req_dec != "proceed":
                    raise server._insufficient_scope_rpc_error(view, req_dec.forbidden)

            if server.config.context_hook is not None and method == "tools/call":
                raw_name = params.get("name") if isinstance(params, Mapping) else None
                tool_name = raw_name if isinstance(raw_name, str) else ""
                outcome = await server._run_context_hook(tool_name, ctx)
                if outcome.refusal is not None:
                    if isinstance(params, Mapping) and (
                        params.get("requestState") is not None or "inputResponses" in params
                    ):
                        cleaned = {
                            key: value
                            for key, value in params.items()
                            if key not in ("requestState", "inputResponses")
                        }
                        ctx = dataclasses.replace(ctx, params=cleaned)
                    with bind_hook_outcome(outcome):
                        return await call_next(ctx)
                with bind_hook_outcome(outcome):
                    return await _call_with_relay_wire(ctx, call_next, view)

            if method == "tools/call":
                return await _call_with_relay_wire(ctx, call_next, view)

            if (
                method in INPUT_REQUIRED_METHODS
                and isinstance(params, Mapping)
                and params.get("requestState") is not None
            ):
                check_bindable_principal(method)
            return await call_next(ctx)

    lowlevel = getattr(server._mcp_server, "_lowlevel_server", None)
    chain = getattr(lowlevel, "middleware", None)
    boundary = next(
        (index for index, item in enumerate(chain or ()) if isinstance(item, RequestStateBoundary)),
        None,
    )
    if boundary is None or chain is None:
        raise RuntimeError("the MCP SDK's request-state boundary was not found")
    chain.insert(boundary, pre_boundary)
