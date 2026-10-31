"""``afd-help`` bootstrap command."""

from __future__ import annotations

import copy
from typing import Any, Callable, Dict, List, Optional, Sequence

from pydantic import BaseModel, Field, ValidationError

from afd.core.commands import (
    CommandContext,
    CommandDefinition,
    CommandExample,
    CommandParameter,
)
from afd.core.contract import CONTRACT_VERSION
from afd.core.result import CommandResult, success
from afd.core.wire import WireModel
from afd.server.bootstrap.afd_context import BOOTSTRAP_EXPOSE
from afd.server.context_fields import ContextField, describe_context_fields
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
    destructive: Optional[bool] = None
    undoable: Optional[bool] = None
    requires: Optional[List[str]] = None
    contexts: Optional[List[str]] = None
    examples: Optional[List[dict[str, Any]]] = None
    output_schema: Optional[dict[str, Any]] = None
    first_class: Optional[bool] = None


class AfdHelpOutput(WireModel):
    """Output for ``afd-help``."""

    contract_version: str = Field(description="The AFD contract version this server implements")
    commands: List[CommandInfo]
    total: int
    filtered: bool
    grouped_by_category: Dict[str, List[CommandInfo]]
    tool_strategy: Optional[str] = Field(
        default=None, description="The server's tool strategy; omitted when not served by an MCP server"
    )
    first_class_tools: Optional[List[str]] = Field(
        default=None, description="Hybrid servers only: the first-class tools, in list order"
    )
    context_fields: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description=(
            "The declared context fields and their _meta keys (spec/context-fields.md): "
            "name, meta, schema, required, journal; omitted when none"
        ),
    )


def _serialize_examples(examples: list[CommandExample]) -> list[dict[str, Any]]:
    return [{"title": example.title, "input": example.input} for example in examples]


async def _afd_help_handler(
    input: AfdHelpInput,
    context: Optional[CommandContext],
    get_commands: Callable[[], List[CommandDefinition]],
    tool_strategy: Optional[str] = None,
    first_class_tools: Optional[List[str]] = None,
    context_fields: Optional[List[Dict[str, Any]]] = None,
) -> CommandResult[AfdHelpOutput]:
    all_commands = get_commands()
    first_class = set(first_class_tools or [])
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
            first_class=True if command.name in first_class else None,
        )

        if input.format == "full":
            info.category = command.category
            info.tags = command.tags
            info.mutation = command.mutation
            info.destructive = command.destructive
            info.undoable = command.undoable
            info.examples = _serialize_examples(command.examples)
            info.output_schema = command.returns

        command_infos.append(info)
        category = command.category or "uncategorized"
        grouped_by_category.setdefault(category, []).append(info)

    output = AfdHelpOutput(
        contract_version=CONTRACT_VERSION,
        commands=command_infos,
        total=len(command_infos),
        filtered=filtered,
        grouped_by_category=grouped_by_category,
        tool_strategy=tool_strategy,
        first_class_tools=list(first_class_tools) if first_class_tools else None,
        context_fields=copy.deepcopy(context_fields) if context_fields else None,
    )
    reasoning = (
        f'Found {len(command_infos)} commands matching "{input.filter}"'
        if filtered
        else f"Listing {len(command_infos)} available commands"
    )
    return success(output, reasoning=reasoning, confidence=1.0)


def create_afd_help_command(
    get_commands: Callable[[], List[CommandDefinition]],
    tool_strategy: Optional[str] = None,
    first_class_tools: Optional[List[str]] = None,
    context_fields: Optional[Sequence[ContextField]] = None,
) -> CommandDefinition:
    """Create the ``afd-help`` bootstrap command.

    A server passes its ``tool_strategy`` (reported as ``toolStrategy``), for the hybrid
    strategy its ``first_class_tools`` (reported as ``firstClassTools``, with ``firstClass:
    true`` on each of their entries), and its declared ``context_fields`` (reported as
    ``contextFields``, as ``server/discover`` lists them). Each is omitted when not given.
    """
    described = describe_context_fields(context_fields) if context_fields else None

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[AfdHelpOutput]:
        try:
            parsed_input = input if isinstance(input, AfdHelpInput) else AfdHelpInput(**(input or {}))
        except ValidationError as exc:
            return _input_validation_failure(AfdHelpInput, input, exc)
        return await _afd_help_handler(
            parsed_input, context, get_commands, tool_strategy, first_class_tools, described
        )

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
