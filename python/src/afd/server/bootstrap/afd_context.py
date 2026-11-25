"""afd-context bootstrap commands for dynamic tool scoping."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from afd.core.commands import CommandContext, CommandDefinition, ExposeOptions
from afd.core.direct_allow import _is_allowed
from afd.core.errors import Recovery
from afd.core.result import CommandResult, error, success
from afd.core.wire import WireModel
from afd.server.auth_view import scope_view_of
from afd.server.types import ContextConfig
from afd.server.validation import _input_validation_failure

DEFAULT_CONTEXT_MAX_DEPTH = 16

AFD_CONTEXT_META_KEY = "dev.afd/context"
"""`_meta` key that selects the active context of one MCP 2026-07-28 request."""

_STATELESS_CONTEXT_HINT = (
    "Context changes do not persist between stateless MCP requests. Send "
    f'_meta["{AFD_CONTEXT_META_KEY}"] with the context name on each tools/list and '
    "tools/call request instead."
)


class ContextState:
    """Mutable stack-based state for the currently active context.

    ``persistent`` is ``False`` for the per-request state of a stateless MCP
    2026-07-28 request: the active context comes from the request's
    ``_meta["dev.afd/context"]``, and ``afd-context-enter``/``afd-context-exit``
    validate but never change it.
    """

    session_available = True
    persistent = True

    def __init__(
        self, max_depth: int = DEFAULT_CONTEXT_MAX_DEPTH, *, persistent: bool = True
    ) -> None:
        if isinstance(max_depth, bool) or not isinstance(max_depth, int) or max_depth < 1:
            raise ValueError("Context max_depth must be a positive integer")
        self.max_depth = max_depth
        self.persistent = persistent
        self.stack: list[str] = []

    def get_active(self) -> str | None:
        return self.stack[-1] if self.stack else None

    def enter(self, name: str) -> None:
        if self.get_active() == name:
            return
        if len(self.stack) >= self.max_depth:
            raise ValueError(f"Context stack is limited to {self.max_depth} levels")
        self.stack.append(name)

    def exit(self) -> str | None:
        return self.stack.pop() if self.stack else None


def create_context_state(
    max_depth: int = DEFAULT_CONTEXT_MAX_DEPTH, *, persistent: bool = True
) -> ContextState:
    """Create a fresh mutable context state container."""
    return ContextState(max_depth, persistent=persistent)


def _can_call_context_command(context: CommandContext | None, name: str) -> bool:
    """Whether the caller of ``context`` can call the context command ``name``
    (spec/recovery.md, "Engine errors"). The three are registered together, with one exposure and
    no contexts of their own, so a caller that reached one can call another unless its ``allow``
    list or its scope view refuses it."""
    view = scope_view_of(context)
    return (context is None or _is_allowed(context, name)) and (view is None or view.shown(name))


def _session_required() -> CommandResult[Any]:
    return error(
        "SESSION_REQUIRED",
        "Context changes require a persistent MCP session",
        suggestion=(
            "Connect with a stateful MCP transport before entering or exiting a context, "
            f'or send _meta["{AFD_CONTEXT_META_KEY}"] on each MCP 2026-07-28 request.'
        ),
    )


class AfdContextListInput(BaseModel):
    """Input for afd-context-list."""

    pass


class ContextInfo(WireModel):
    """Metadata about a configured context."""

    name: str
    description: str | None = None
    triggers: list[str] | None = None
    priority: int | None = None


class AfdContextListOutput(WireModel):
    """Output for afd-context-list."""

    contexts: list[ContextInfo]
    active_context: str | None = None


class AfdContextEnterInput(BaseModel):
    """Input for afd-context-enter."""

    context: str = Field(..., description="Context name to enter")


class AfdContextEnterOutput(WireModel):
    """Output for afd-context-enter."""

    entered: str
    previous: str | None = None
    persisted: bool | None = None
    """``False`` on a stateless request: nothing was stored."""


class AfdContextExitInput(BaseModel):
    """Input for afd-context-exit."""

    pass


class AfdContextExitOutput(WireModel):
    """Output for afd-context-exit."""

    exited: str | None = None
    current: str | None = None
    persisted: bool | None = None
    """``False`` on a stateless request: nothing was changed."""


BOOTSTRAP_EXPOSE = ExposeOptions(mcp=True, cli=True)


def create_afd_context_list_command(
    get_contexts: Callable[[], list[ContextConfig]],
    context_state: ContextState,
) -> CommandDefinition:
    """Create the afd-context-list bootstrap command."""

    async def handler(
        input: Any,
        context: CommandContext | None = None,
    ) -> CommandResult[AfdContextListOutput]:
        _ = context
        configs = sorted(
            get_contexts(),
            key=lambda item: item.priority or 0,
            reverse=True,
        )
        contexts = [
            ContextInfo(
                name=item.name,
                description=item.description,
                triggers=item.triggers or None,
                priority=item.priority,
            )
            for item in configs
        ]
        return success(
            AfdContextListOutput(
                contexts=contexts,
                active_context=context_state.get_active(),
            ),
            reasoning=f"Found {len(contexts)} configured contexts",
            confidence=1.0,
        )

    return CommandDefinition(
        name="afd-context-list",
        description="List all configured contexts with descriptions, priorities, and triggers",
        handler=handler,
        category="bootstrap",
        tags=["bootstrap", "read", "safe", "context"],
        mutation=False,
        version="1.0.0",
        input_schema=AfdContextListInput.model_json_schema(),
        returns=AfdContextListOutput.model_json_schema(mode="serialization"),
        expose=BOOTSTRAP_EXPOSE,
    )


def create_afd_context_enter_command(
    get_contexts: Callable[[], list[ContextConfig]],
    context_state: ContextState,
) -> CommandDefinition:
    """Create the afd-context-enter bootstrap command."""

    async def handler(
        input: Any,
        context: CommandContext | None = None,
    ) -> CommandResult[AfdContextEnterOutput]:
        if not context_state.session_available:
            return _session_required()
        try:
            parsed = (
                input
                if isinstance(input, AfdContextEnterInput)
                else AfdContextEnterInput.model_validate(input or {})
            )
        except ValidationError as exc:
            return _input_validation_failure(AfdContextEnterInput, input, exc)
        context_names = [item.name for item in get_contexts()]
        if parsed.context not in context_names:
            available = f"Available contexts: {', '.join(context_names)}."
            listed = _can_call_context_command(context, "afd-context-list")
            return error(
                "CONTEXT_NOT_FOUND",
                f"Context '{parsed.context}' is not configured",
                suggestion=(
                    f"{available} Use afd-context-list to see all contexts."
                    if listed
                    else available
                ),
                recovery=Recovery(kind="call", command="afd-context-list") if listed else None,
            )

        previous = context_state.get_active()
        if not context_state.persistent:
            return success(
                AfdContextEnterOutput(entered=parsed.context, previous=previous, persisted=False),
                reasoning=_STATELESS_CONTEXT_HINT,
                confidence=1.0,
            )
        if previous != parsed.context and len(context_state.stack) >= context_state.max_depth:
            exit_callable = _can_call_context_command(context, "afd-context-exit")
            return error(
                "CONTEXT_DEPTH_EXCEEDED",
                f"Context stack is limited to {context_state.max_depth} levels",
                suggestion=(
                    "Call afd-context-exit to leave a context before entering another"
                    if exit_callable
                    else "Leave a context before entering another"
                ),
                recovery=(
                    Recovery(kind="call", command="afd-context-exit", then_retry=True)
                    if exit_callable
                    else None
                ),
            )
        context_state.enter(parsed.context)
        return success(
            AfdContextEnterOutput(entered=parsed.context, previous=previous),
            reasoning=f"Entered context '{parsed.context}'",
            confidence=1.0,
        )

    return CommandDefinition(
        name="afd-context-enter",
        description="Enter a context to scope available tools",
        handler=handler,
        category="bootstrap",
        tags=["bootstrap", "write", "context"],
        mutation=True,
        version="1.0.0",
        input_schema=AfdContextEnterInput.model_json_schema(),
        returns=AfdContextEnterOutput.model_json_schema(mode="serialization"),
        expose=BOOTSTRAP_EXPOSE,
    )


def create_afd_context_exit_command(
    context_state: ContextState,
) -> CommandDefinition:
    """Create the afd-context-exit bootstrap command."""

    async def handler(
        input: Any,
        context: CommandContext | None = None,
    ) -> CommandResult[AfdContextExitOutput]:
        _ = input, context
        if not context_state.session_available:
            return _session_required()
        if not context_state.persistent:
            return success(
                AfdContextExitOutput(
                    exited=None, current=context_state.get_active(), persisted=False
                ),
                reasoning=_STATELESS_CONTEXT_HINT,
                confidence=1.0,
            )
        exited = context_state.exit()
        current = context_state.get_active()
        return success(
            AfdContextExitOutput(exited=exited, current=current),
            reasoning=(f"Exited context '{exited}'" if exited else "No active context to exit"),
            confidence=1.0,
        )

    return CommandDefinition(
        name="afd-context-exit",
        description="Exit the current context, popping back to the previous one",
        handler=handler,
        category="bootstrap",
        tags=["bootstrap", "write", "context"],
        mutation=True,
        version="1.0.0",
        input_schema=AfdContextExitInput.model_json_schema(),
        returns=AfdContextExitOutput.model_json_schema(mode="serialization"),
        expose=BOOTSTRAP_EXPOSE,
    )
