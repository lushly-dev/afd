"""``afd-help`` bootstrap command."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, Field, ValidationError

from afd.core.commands import (
    CommandContext,
    CommandDefinition,
    CommandExample,
    CommandParameter,
)
from afd.core.result import CommandResult, success
from afd.core.wire import WireModel
from afd.server.bootstrap.afd_context import BOOTSTRAP_EXPOSE
from afd.server.validation import _input_validation_failure


class AfdHelpInput(BaseModel):
    """Input for ``afd-help``."""

    filter: Optional[str] = Field(default=None, description="Filter by tag, category, or command name")
    format: str = Field(default="brief", description='Output format: "brief" or "full"')


class CommandInfo(WireModel):
    """Information about a single command."""

    name: str
    description: str
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    mutation: Optional[bool] = None
    requires: Optional[List[str]] = None
    contexts: Optional[List[str]] = None
    examples: Optional[List[dict[str, Any]]] = None
    output_schema: Optional[dict[str, Any]] = None


class AfdHelpOutput(WireModel):
    """Output for ``afd-help``."""

    commands: List[CommandInfo]
    total: int
    filtered: bool
    grouped_by_category: Dict[str, List[CommandInfo]]


def _serialize_examples(examples: list[CommandExample]) -> list[dict[str, Any]]:
    return [{"title": example.title, "input": example.input} for example in examples]


async def _afd_help_handler(
    input: AfdHelpInput,
    context: Optional[CommandContext],
    get_commands: Callable[[], List[CommandDefinition]],
) -> CommandResult[AfdHelpOutput]:
    all_commands = get_commands()
    filtered = input.filter is not None
    commands = all_commands

    if input.filter:
        query = input.filter.lower()
        commands = [
            command
            for command in all_commands
            if (command.tags and any(query in tag.lower() for tag in command.tags))
            or (command.category and query in command.category.lower())
            or query in command.name.lower()
        ]

    command_infos: list[CommandInfo] = []
    grouped_by_category: dict[str, list[CommandInfo]] = {}

    for command in commands:
        info = CommandInfo(
            name=command.name,
            description=command.description,
            requires=command.requires or None,
            contexts=command.contexts or None,
        )

        if input.format == "full":
            info.category = command.category
            info.tags = command.tags
            info.mutation = command.mutation
            info.examples = _serialize_examples(command.examples)
            info.output_schema = command.returns

        command_infos.append(info)
        category = command.category or "uncategorized"
        grouped_by_category.setdefault(category, []).append(info)

    output = AfdHelpOutput(
        commands=command_infos,
        total=len(command_infos),
        filtered=filtered,
        grouped_by_category=grouped_by_category,
    )
    reasoning = (
        f'Found {len(command_infos)} commands matching "{input.filter}"'
        if filtered
        else f"Listing {len(command_infos)} available commands"
    )
    return success(output, reasoning=reasoning, confidence=1.0)


def create_afd_help_command(
    get_commands: Callable[[], List[CommandDefinition]],
) -> CommandDefinition:
    """Create the ``afd-help`` bootstrap command."""

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[AfdHelpOutput]:
        try:
            parsed_input = input if isinstance(input, AfdHelpInput) else AfdHelpInput(**(input or {}))
        except ValidationError as exc:
            return _input_validation_failure(AfdHelpInput, input, exc)
        return await _afd_help_handler(parsed_input, context, get_commands)

    return CommandDefinition(
        name="afd-help",
        description="List available commands with filtering and grouped summaries",
        handler=handler,
        category="bootstrap",
        tags=["bootstrap", "read", "safe"],
        mutation=False,
        version="1.0.0",
        parameters=[
            CommandParameter(
                name="filter",
                type="string",
                description="Filter by tag, category, or command name",
                required=False,
            ),
            CommandParameter(
                name="format",
                type="string",
                description='Output format: "brief" or "full"',
                required=False,
                enum=["brief", "full"],
            ),
        ],
        input_schema=AfdHelpInput.model_json_schema(),
        returns=AfdHelpOutput.model_json_schema(),
        expose=BOOTSTRAP_EXPOSE,
    )
