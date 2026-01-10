"""afd-docs bootstrap command.

Generate markdown documentation for commands.
"""

from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, Field

from afd.core.commands import (
    CommandContext,
    CommandDefinition,
    CommandParameter,
)
from afd.core.result import CommandResult, success


class AfdDocsInput(BaseModel):
    """Input for afd-docs command."""

    command: Optional[str] = Field(
        default=None,
        description="Specific command name, or omit for all",
    )


class AfdDocsOutput(BaseModel):
    """Output for afd-docs command."""

    markdown: str
    command_count: int


async def _afd_docs_handler(
    input: AfdDocsInput,
    context: Optional[CommandContext],
    get_commands: Callable[[], List[CommandDefinition]],
) -> CommandResult[AfdDocsOutput]:
    """Handler for afd-docs command."""
    all_commands = get_commands()

    # Filter to specific command if provided
    if input.command:
        commands = [cmd for cmd in all_commands if cmd.name == input.command]
    else:
        commands = all_commands

    if input.command and len(commands) == 0:
        return success(
            AfdDocsOutput(markdown="", command_count=0),
            reasoning=f'Command "{input.command}" not found',
            confidence=1.0,
        )

    # Generate markdown
    lines: List[str] = []
    lines.append("# Command Documentation")
    lines.append("")

    # Group by category
    by_category: Dict[str, List[CommandDefinition]] = {}
    for cmd in commands:
        category = cmd.category or "General"
        if category not in by_category:
            by_category[category] = []
        by_category[category].append(cmd)

    for category in sorted(by_category.keys()):
        cmds = by_category[category]
        lines.append(f"## {category}")
        lines.append("")

        for cmd in sorted(cmds, key=lambda c: c.name):
            lines.append(f"### `{cmd.name}`")
            lines.append("")
            lines.append(cmd.description)
            lines.append("")

            # Tags
            if cmd.tags:
                tags_str = ", ".join(f"`{t}`" for t in cmd.tags)
                lines.append(f"**Tags:** {tags_str}")
                lines.append("")

            # Mutation info
            if cmd.mutation is not None:
                mutation_str = "Yes" if cmd.mutation else "No (read-only)"
                lines.append(f"**Mutation:** {mutation_str}")
                lines.append("")

            # Parameters
            if cmd.parameters:
                lines.append("**Parameters:**")
                lines.append("")
                lines.append("| Name | Type | Required | Description |")
                lines.append("|------|------|----------|-------------|")
                for param in cmd.parameters:
                    required = "Yes" if param.required else "No"
                    desc = param.description or ""
                    lines.append(f"| {param.name} | {param.type} | {required} | {desc} |")
                lines.append("")

            lines.append("---")
            lines.append("")

    markdown = "\n".join(lines)

    reasoning = (
        f'Generated documentation for "{input.command}"'
        if input.command
        else f"Generated documentation for {len(commands)} commands"
    )

    return success(
        AfdDocsOutput(markdown=markdown, command_count=len(commands)),
        reasoning=reasoning,
        confidence=1.0,
    )


def create_afd_docs_command(
    get_commands: Callable[[], List[CommandDefinition]],
) -> CommandDefinition:
    """Create the afd-docs bootstrap command.

    Args:
        get_commands: Function to get all registered commands.

    Returns:
        CommandDefinition for afd-docs.

    Example:
        >>> def get_cmds():
        ...     return [my_command_1, my_command_2]
        >>> docs_cmd = create_afd_docs_command(get_cmds)
    """

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[AfdDocsOutput]:
        # Convert dict input to pydantic model if needed
        if isinstance(input, dict):
            parsed_input = AfdDocsInput(**input)
        elif isinstance(input, AfdDocsInput):
            parsed_input = input
        else:
            parsed_input = AfdDocsInput()

        return await _afd_docs_handler(parsed_input, context, get_commands)

    return CommandDefinition(
        name="afd-docs",
        description="Get detailed documentation for commands",
        handler=handler,
        category="bootstrap",
        tags=["bootstrap", "read", "safe"],
        mutation=False,
        version="1.0.0",
        parameters=[
            CommandParameter(
                name="command",
                type="string",
                description="Specific command name, or omit for all",
                required=False,
            ),
        ],
    )
