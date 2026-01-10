"""afd-help bootstrap command.

List all available commands with tags and grouping.
"""

from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, Field

from afd.core.commands import (
    CommandContext,
    CommandDefinition,
    CommandParameter,
)
from afd.core.result import CommandResult, success


class AfdHelpInput(BaseModel):
    """Input for afd-help command."""

    filter: Optional[str] = Field(
        default=None,
        description='Tag filter: e.g., "todo" or "read"',
    )
    format: str = Field(
        default="brief",
        description='Output format: "brief" or "full"',
    )


class CommandInfo(BaseModel):
    """Information about a single command."""

    name: str
    description: str
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    mutation: Optional[bool] = None


class AfdHelpOutput(BaseModel):
    """Output for afd-help command."""

    commands: List[CommandInfo]
    total: int
    filtered: bool
    grouped_by_category: Dict[str, List[CommandInfo]]


async def _afd_help_handler(
    input: AfdHelpInput,
    context: Optional[CommandContext],
    get_commands: Callable[[], List[CommandDefinition]],
) -> CommandResult[AfdHelpOutput]:
    """Handler for afd-help command."""
    all_commands = get_commands()

    # Filter by tag if provided
    commands = all_commands
    filtered = input.filter is not None

    if input.filter:
        filter_tag = input.filter.lower()
        commands = [
            cmd
            for cmd in all_commands
            if (cmd.tags and any(filter_tag in tag.lower() for tag in cmd.tags))
            or (cmd.category and filter_tag in cmd.category.lower())
            or filter_tag in cmd.name.lower()
        ]

    # Map to output format and group by category
    command_infos: List[CommandInfo] = []
    grouped_by_category: Dict[str, List[CommandInfo]] = {}

    for cmd in commands:
        info = CommandInfo(
            name=cmd.name,
            description=cmd.description,
        )

        if input.format == "full":
            info.category = cmd.category
            info.tags = cmd.tags
            info.mutation = cmd.mutation

        command_infos.append(info)

        # Use original command's category for grouping (not the mapped info)
        category = cmd.category or "uncategorized"
        if category not in grouped_by_category:
            grouped_by_category[category] = []
        grouped_by_category[category].append(info)

    output = AfdHelpOutput(
        commands=command_infos,
        total=len(command_infos),
        filtered=filtered,
        grouped_by_category=grouped_by_category,
    )

    reasoning = (
        f'Found {len(command_infos)} commands matching "{input.filter}"'
        if filtered
        else f"Listing all {len(command_infos)} available commands"
    )

    return success(output, reasoning=reasoning, confidence=1.0)


def create_afd_help_command(
    get_commands: Callable[[], List[CommandDefinition]],
) -> CommandDefinition:
    """Create the afd-help bootstrap command.

    Args:
        get_commands: Function to get all registered commands.

    Returns:
        CommandDefinition for afd-help.

    Example:
        >>> def get_cmds():
        ...     return [my_command_1, my_command_2]
        >>> help_cmd = create_afd_help_command(get_cmds)
    """

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[AfdHelpOutput]:
        # Convert dict input to pydantic model if needed
        if isinstance(input, dict):
            parsed_input = AfdHelpInput(**input)
        elif isinstance(input, AfdHelpInput):
            parsed_input = input
        else:
            parsed_input = AfdHelpInput()

        return await _afd_help_handler(parsed_input, context, get_commands)

    return CommandDefinition(
        name="afd-help",
        description="List all available commands with tags and grouping",
        handler=handler,
        category="bootstrap",
        tags=["bootstrap", "read", "safe"],
        mutation=False,
        version="1.0.0",
        parameters=[
            CommandParameter(
                name="filter",
                type="string",
                description='Tag filter: e.g., "todo" or "read"',
                required=False,
            ),
            CommandParameter(
                name="format",
                type="string",
                description='Output format: "brief" or "full"',
                required=False,
            ),
        ],
    )
