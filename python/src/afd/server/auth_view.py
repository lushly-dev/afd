"""The scope authority and per-request :class:`ScopeView` of a server with MCP authorization
(``spec/authorization.md``, M6): which commands exist for the caller and which it is shown,
decided once as the request arrives, and the scope decision on every call it names, before
dispatch, after routing, at execution and on ``tasks/*``.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypeVar

from afd.core.commands import CommandContext, CommandDefinition
from afd.core.errors import CommandError, ErrorCodes
from afd.server.auth_resource import ProtectedResource
from afd.server.auth_rules import Credentials
from afd.server.auth_scopes import (
    RequestDecision,
    RequestForbidden,
    ScopeDecision,
    ScopeMissing,
    ScopeResolver,
    ScopeWarning,
    checked_decision,
    merge_decisions,
    request_decision,
    static_decision,
)
from afd.server.tools import derive_group_action, derive_group_name
from afd.server.types import GroupByFn, ToolStrategy


class _Named(Protocol):
    name: str


_T = TypeVar("_T", bound=_Named)


@dataclass(frozen=True)
class GroupedSelection:
    """Result of resolving a grouped tool call, shared by scope enforcement and routing."""

    kind: Literal[
        "command",
        "ambiguous",
        "not_in_context_action",
        "not_in_context_group",
        "missing_action",
        "unknown_action",
        "fallthrough",
    ]
    command: CommandDefinition | None = None
    available_actions: tuple[str, ...] = ()


def _command_in_context(command: CommandDefinition, active_context: str | None) -> bool:
    if not active_context or not command.contexts:
        return True
    return active_context in command.contexts


def select_grouped_call(
    members: Sequence[CommandDefinition],
    *,
    active_context: str | None,
    action: Any,
    is_shown: Callable[[CommandDefinition], bool],
) -> GroupedSelection:
    """Resolve a grouped-strategy tool call identically for scope checks and tool routing.

    ``members`` must already be filtered to commands in the group that exist for this caller.
    Every result other than ``"command"`` and ``"fallthrough"`` answers an error without running
    any handler.
    """
    if not members:
        return GroupedSelection(kind="fallthrough")

    accessible = [cmd for cmd in members if _command_in_context(cmd, active_context)]
    if not accessible:
        if isinstance(action, str):
            hidden_in_ctx = next(
                (cmd for cmd in members if derive_group_action(cmd) == action),
                None,
            )
            if hidden_in_ctx is not None:
                return GroupedSelection(kind="not_in_context_action", command=hidden_in_ctx)
        return GroupedSelection(kind="not_in_context_group")

    if not isinstance(action, str):
        shown_group = [cmd for cmd in accessible if is_shown(cmd)]
        if shown_group:
            return GroupedSelection(
                kind="missing_action",
                available_actions=tuple(derive_group_action(cmd) for cmd in shown_group),
            )
        return GroupedSelection(kind="fallthrough")

    candidates = [cmd for cmd in accessible if derive_group_action(cmd) == action]
    if len(candidates) > 1:
        return GroupedSelection(kind="ambiguous")
    if len(candidates) == 1:
        return GroupedSelection(kind="command", command=candidates[0])

    hidden_in_ctx = next(
        (cmd for cmd in members if derive_group_action(cmd) == action),
        None,
    )
    if hidden_in_ctx is not None:
        return GroupedSelection(kind="not_in_context_action", command=hidden_in_ctx)
    return GroupedSelection(kind="unknown_action")


@dataclass(frozen=True)
class _NamedCall:
    kind: Literal["command", "tool", "unresolved"]
    name: str = ""
    input: Any = None


def _input_or_empty(value: Any) -> Any:
    return {} if value is None else value


def _steps_of(items: Any) -> list[_NamedCall] | None:
    if not isinstance(items, list) or not items:
        return None
    calls: list[_NamedCall] = []
    for item in items:
        if not isinstance(item, Mapping) or not isinstance(item.get("command"), str):
            return None
        calls.append(
            _NamedCall(
                kind="command",
                name=item["command"],
                input=_input_or_empty(item.get("input")),
            )
        )
    return calls


class ScopeView:
    """What one admitted request may see and do (``spec/authorization.md``, M6).

    Its ``known`` and ``shown`` sets (and per-command task visibility) are decided once when the
    request arrives and stay fixed for the entire request, including any background task the
    request starts.
    """

    def __init__(
        self,
        *,
        credentials: Credentials,
        filtered: bool,
        required: ScopeDecision,
        by_name: Mapping[str, CommandDefinition],
        known_set: frozenset[str],
        shown_set: frozenset[str],
        task_allowed: frozenset[str],
        resolver: ScopeResolver | None,
        tool_strategy: ToolStrategy,
        group_by_fn: GroupByFn | None,
        resource: ProtectedResource,
        warn: ScopeWarning | None,
    ) -> None:
        self._credentials = credentials
        self._filtered = filtered
        self._required = required
        self._by_name = by_name
        self._known_set = known_set
        self._shown_set = shown_set
        self._task_allowed = task_allowed
        self._resolver = resolver
        self._tool_strategy = tool_strategy
        self._group_by_fn = group_by_fn
        self._resource = resource
        self._warn = warn

    @property
    def credentials(self) -> Credentials:
        return self._credentials

    @property
    def filtered(self) -> bool:
        """Whether listings are filtered by scope (``filter_tools_by_scope``)."""
        return self._filtered

    @property
    def has_resolver(self) -> bool:
        """Whether this view decides calls with a host :class:`ScopeResolver`."""
        return self._resolver is not None

    def with_credentials(self, credentials: Credentials) -> ScopeView:
        """A view sharing the exact request-arrival visibility snapshot with a cloned
        ``credentials`` object (for queued 202 dispatches and background MCP tasks)."""
        return ScopeView(
            credentials=credentials,
            filtered=self._filtered,
            required=self._required,
            by_name=self._by_name,
            known_set=self._known_set,
            shown_set=self._shown_set,
            task_allowed=self._task_allowed,
            resolver=self._resolver,
            tool_strategy=self._tool_strategy,
            group_by_fn=self._group_by_fn,
            resource=self._resource,
            warn=self._warn,
        )

    def known(self, name: str) -> bool:
        """Whether ``name`` is an MCP-exposed command that exists for this caller (M6)."""
        return name in self._known_set

    def shown(self, name: str) -> bool:
        """Whether this caller is shown a command on listings and in suggestions."""
        return name in self._shown_set

    def _is_known_command(self, name: str) -> bool:
        return name in self._by_name and name in self._known_set

    def _ask_resolve(self, name: str, input: Any) -> ScopeDecision:
        assert self._resolver is not None
        try:
            return checked_decision(self._resolver.resolve(name, input, self._credentials))
        except Exception:
            # A resolver that raises refuses the call, failing closed.
            return ScopeMissing(())

    def _decide_one(self, call: _NamedCall) -> ScopeDecision:
        decision: ScopeDecision = "allowed"
        if call.kind == "command":
            command = self._by_name.get(call.name) if self._is_known_command(call.name) else None
            # A name that does not exist for the caller needs the required scopes alone,
            # and the resolver is never asked about it.
            if command is not None:
                if self._resolver is not None:
                    decision = self._ask_resolve(call.name, call.input)
                else:
                    decision = static_decision((), command.scopes, self._credentials.scopes)
        elif call.kind == "tool" and self._resolver is not None:
            decision = self._ask_resolve(call.name, call.input)
        return merge_decisions(self._required, decision)

    def _named_calls(
        self, tool: str, args: Any, *, active_context: str | None = None
    ) -> list[_NamedCall]:
        record: Mapping[str, Any] = args if isinstance(args, Mapping) else {}
        own = [_NamedCall(kind="tool", name=tool, input=_input_or_empty(args))]
        if tool == "afd-call":
            cmd_name = record.get("command")
            if isinstance(cmd_name, str):
                return [
                    _NamedCall(
                        kind="command",
                        name=cmd_name,
                        input=_input_or_empty(record.get("input")),
                    )
                ]
            return own
        if tool == "afd-batch":
            steps = _steps_of(record.get("commands"))
            return steps if steps is not None else own
        if tool == "afd-pipe":
            steps = _steps_of(record.get("steps"))
            return steps if steps is not None else own
        if tool in ("afd-discover", "afd-detail"):
            return own

        if self._tool_strategy == "grouped":
            get_group = self._group_by_fn or derive_group_name
            members = [
                command
                for command in self._by_name.values()
                if (get_group(command) or "general") == tool and command.name in self._known_set
            ]
            selection = select_grouped_call(
                members,
                active_context=active_context,
                action=record.get("action"),
                is_shown=lambda command: command.name in self._shown_set,
            )
            if selection.kind == "command" and selection.command is not None:
                return [
                    _NamedCall(
                        kind="command",
                        name=selection.command.name,
                        input=_input_or_empty(record.get("params")),
                    )
                ]
            if selection.kind != "fallthrough":
                return [_NamedCall(kind="unresolved")]

        return [_NamedCall(kind="command", name=tool, input=_input_or_empty(args))]

    def decide_call(
        self, tool: str, args: Any, *, active_context: str | None = None
    ) -> RequestDecision:
        """The decision on a ``tools/call`` of ``tool`` with ``args``, over every call it names."""
        calls = self._named_calls(tool, args, active_context=active_context)
        return request_decision([self._decide_one(call) for call in calls], self._warn)

    def decide_commands(self, calls: Sequence[tuple[str, Any]]) -> RequestDecision:
        """The decision on calls of ``(command, input)`` pairs."""
        return request_decision(
            [
                self._decide_one(
                    _NamedCall(kind="command", name=name, input=_input_or_empty(payload))
                )
                for name, payload in calls
            ],
            self._warn,
        )

    def decide_request(self) -> RequestDecision:
        """The decision on a request that names no command: the required scopes."""
        return request_decision([self._required], self._warn)

    def decide_execution(self, command: str, input: Any) -> RequestDecision:
        """The decision on one command about to run, on its validated input.

        Applies both the server's ``required_scopes`` and either the host resolver (on the
        validated input) or the command's static ``scopes`` (so nested in-process calls that
        bypass tool routing are still scope-checked).
        """
        if not self._is_known_command(command):
            return "proceed"
        if self._resolver is not None:
            decision = self._ask_resolve(command, _input_or_empty(input))
        else:
            cmd = self._by_name[command]
            decision = static_decision((), cmd.scopes, self._credentials.scopes)
        return request_decision([merge_decisions(self._required, decision)], self._warn)

    def decide_task(self, command: str) -> RequestDecision:
        """The decision on reading or updating a task that runs ``command`` (``tasks/get``,
        ``tasks/update``)."""
        if command not in self._by_name:
            return "proceed"
        if self._resolver is not None:
            return "proceed" if command in self._task_allowed else RequestForbidden(())
        cmd = self._by_name[command]
        return request_decision(
            [static_decision((), cmd.scopes, self._credentials.scopes)],
            self._warn,
        )

    def insufficient_scope(self, missing: Sequence[str]) -> CommandError:
        """The ``INSUFFICIENT_SCOPE`` failure naming ``missing``."""
        return CommandError(
            code=ErrorCodes.INSUFFICIENT_SCOPE,
            message="The access token lacks a scope this call needs",
            suggestion=self._resource.forbidden_body(missing)["suggestion"],
            details={"scopes": list(missing)},
            retryable=False,
        )


class ScopeAuthority:
    """Makes each admitted request's :class:`ScopeView` for one server."""

    def __init__(
        self,
        *,
        required_scopes: Sequence[str],
        resolver: ScopeResolver | None,
        filter_tools_by_scope: bool,
        commands: Sequence[CommandDefinition],
        tool_strategy: ToolStrategy,
        group_by_fn: GroupByFn | None,
        resource: ProtectedResource,
        warn: ScopeWarning | None = None,
    ) -> None:
        self._required_scopes = tuple(required_scopes)
        self._resolver = resolver
        self._filter_tools_by_scope = filter_tools_by_scope
        self._by_name: dict[str, CommandDefinition] = {}
        for command in commands:
            self._by_name.setdefault(command.name, command)
        self._tool_strategy = tool_strategy
        self._group_by_fn = group_by_fn
        self._resource = resource
        self._warn = warn

    def view(self, credentials: Credentials) -> ScopeView:
        """Decide ``known``, ``shown`` and task visibility once for ``credentials``."""
        held = credentials.scopes
        held_set = set(held)
        required = static_decision(self._required_scopes, (), held)
        resolver = self._resolver
        # Only a resolver on a server that filters its listings hides commands.
        hider = resolver if self._filter_tools_by_scope else None
        known_fn: Callable[[str, Credentials], bool] | None = (
            getattr(resolver, "known", None) if resolver is not None else None
        )

        def ask_bool(fn: Callable[[str, Credentials], bool], name: str) -> bool:
            try:
                return fn(name, credentials) is True
            except Exception:
                return False

        known_set: set[str] = set()
        shown_set: set[str] = set()
        task_allowed: set[str] = set()

        for name, command in self._by_name.items():
            if resolver is not None:
                r_visible = ask_bool(resolver.visible, name)
                r_known = ask_bool(known_fn, name) if known_fn is not None else r_visible
                exists = True if hider is None else r_known
                if r_visible and r_known:
                    task_allowed.add(name)
                visible = required == "allowed" and r_visible and exists
            else:
                exists = True
                visible = required == "allowed" and all(
                    scope in held_set for scope in command.scopes
                )

            if exists:
                known_set.add(name)
            if not self._filter_tools_by_scope or (visible and exists):
                shown_set.add(name)

        return ScopeView(
            credentials=credentials,
            filtered=self._filter_tools_by_scope,
            required=required,
            by_name=self._by_name,
            known_set=frozenset(known_set),
            shown_set=frozenset(shown_set),
            task_allowed=frozenset(task_allowed),
            resolver=resolver,
            tool_strategy=self._tool_strategy,
            group_by_fn=self._group_by_fn,
            resource=self._resource,
            warn=self._warn,
        )


def scope_view_of(context: CommandContext | None) -> ScopeView | None:
    """The :class:`ScopeView` bound to ``context``, if any."""
    view = getattr(context, "_scope_view", None) if context is not None else None
    return view if isinstance(view, ScopeView) else None


def known_only(items: Sequence[_T], view: ScopeView | None) -> list[_T]:
    """``items`` whose ``.name`` exists for ``view`` (all of them without a view)."""
    if view is None:
        return list(items)
    return [item for item in items if view.known(item.name)]


def shown_only(items: Sequence[_T], view: ScopeView | None) -> list[_T]:
    """``items`` whose ``.name`` is shown by ``view`` (all of them without a view)."""
    if view is None:
        return list(items)
    return [item for item in items if view.shown(item.name)]


def listed_commands(
    commands: Sequence[CommandDefinition],
    view: ScopeView | None,
) -> list[CommandDefinition]:
    """Commands as the caller of ``view`` may see them listed: those it is shown, with each
    command's ``requires`` naming only commands that exist for it (M6, "Hidden commands")."""
    if view is None:
        return list(commands)
    result: list[CommandDefinition] = []
    for command in commands:
        if not view.shown(command.name):
            continue
        if command.requires and any(not view.known(req) for req in command.requires):
            filtered_reqs = [req for req in command.requires if view.known(req)]
            result.append(dataclasses.replace(command, requires=filtered_reqs))
        else:
            result.append(command)
    return result


__all__ = [
    "GroupedSelection",
    "ScopeAuthority",
    "ScopeView",
    "known_only",
    "listed_commands",
    "scope_view_of",
    "select_grouped_call",
    "shown_only",
]
