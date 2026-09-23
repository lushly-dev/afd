"""afd-context bootstrap commands for dynamic tool scoping."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional

from pydantic import BaseModel, Field, ValidationError

from afd.core.commands import CommandContext, CommandDefinition, ExposeOptions
from afd.core.result import CommandResult, error, success
from afd.server.validation import _input_validation_failure


@dataclass(frozen=True)
class ContextConfig:
    """Configuration for a named tool context."""

    name: str
    description: Optional[str] = None
    triggers: List[str] = field(default_factory=list)
    priority: Optional[int] = None


class ContextState:
    """Mutable stack-based state for the currently active context."""

    def __init__(self) -> None:
        self.stack: List[str] = []

    def get_active(self) -> Optional[str]:
        return self.stack[-1] if self.stack else None

    def enter(self, name: str) -> None:
        self.stack.append(name)

    def exit(self) -> Optional[str]:
        return self.stack.pop() if self.stack else None


def create_context_state() -> ContextState:
    """Create a fresh mutable context state container."""
    return ContextState()


class AfdContextListInput(BaseModel):
    """Input for afd-context-list."""

    pass


class ContextInfo(BaseModel):
    """Metadata about a configured context."""

    name: str
    description: Optional[str] = None
    triggers: Optional[List[str]] = None
    priority: Optional[int] = None


class AfdContextListOutput(BaseModel):
    """Output for afd-context-list."""

    contexts: List[ContextInfo]
    active_context: Optional[str] = None


class AfdContextEnterInput(BaseModel):
    """Input for afd-context-enter."""

    context: str = Field(..., description="Context name to enter")


class AfdContextEnterOutput(BaseModel):
    """Output for afd-context-enter."""

    entered: str
    previous: Optional[str] = None


class AfdContextExitInput(BaseModel):
    """Input for afd-context-exit."""

    pass


class AfdContextExitOutput(BaseModel):
    """Output for afd-context-exit."""

    exited: Optional[str] = None
    current: Optional[str] = None


BOOTSTRAP_EXPOSE = ExposeOptions(mcp=True, cli=True)


def create_afd_context_list_command(
    get_contexts: Callable[[], List[ContextConfig]],
    context_state: ContextState,
) -> CommandDefinition:
    """Create the afd-context-list bootstrap command."""

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
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
        returns=AfdContextListOutput.model_json_schema(),
        expose=BOOTSTRAP_EXPOSE,
    )


def create_afd_context_enter_command(
    get_contexts: Callable[[], List[ContextConfig]],
    context_state: ContextState,
) -> CommandDefinition:
    """Create the afd-context-enter bootstrap command."""

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[AfdContextEnterOutput]:
        _ = context
        try:
            parsed = (
                input
                if isinstance(input, AfdContextEnterInput)
                else AfdContextEnterInput.model_validate(input or {})
            )
        except ValidationError as exc:
            return _input_validation_failure(AfdContextEnterInput, input, exc)
        context_names = {item.name for item in get_contexts()}
        if parsed.context not in context_names:
            return error(
                "CONTEXT_NOT_FOUND",
                f"Context '{parsed.context}' is not configured",
                suggestion=(
                    "Use afd-context-list to see available contexts."
                ),
            )

        previous = context_state.get_active()
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
        returns=AfdContextEnterOutput.model_json_schema(),
        expose=BOOTSTRAP_EXPOSE,
    )


def create_afd_context_exit_command(
    context_state: ContextState,
) -> CommandDefinition:
    """Create the afd-context-exit bootstrap command."""

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[AfdContextExitOutput]:
        _ = input, context
        exited = context_state.exit()
        current = context_state.get_active()
        return success(
            AfdContextExitOutput(exited=exited, current=current),
            reasoning=(
                f"Exited context '{exited}'"
                if exited
                else "No active context to exit"
            ),
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
        returns=AfdContextExitOutput.model_json_schema(),
        expose=BOOTSTRAP_EXPOSE,
    )
