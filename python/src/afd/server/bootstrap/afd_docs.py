"""``afd-docs`` bootstrap command."""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, Field, ValidationError

from afd.core.commands import CommandContext, CommandDefinition, CommandParameter
from afd.core.result import CommandResult, success
from afd.server.bootstrap.afd_context import BOOTSTRAP_EXPOSE
from afd.server.validation import _input_validation_failure


class AfdDocsInput(BaseModel):
    """Input for ``afd-docs``."""

    command: Optional[str] = Field(default=None, description="Specific command name, or omit for all")


class AfdDocsOutput(BaseModel):
    """Output for ``afd-docs``."""

    markdown: str
    command_count: int


def _json_block(value: dict[str, Any]) -> str:
    return f"```json\n{json.dumps(value, indent=2)}\n```"


async def _afd_docs_handler(
    input: AfdDocsInput,
    context: Optional[CommandContext],
    get_commands: Callable[[], List[CommandDefinition]],
) -> CommandResult[AfdDocsOutput]:
    commands = get_commands()
    if input.command:
        commands = [command for command in commands if command.name == input.command]

    if input.command and not commands:
        return success(
            AfdDocsOutput(markdown="", command_count=0),
            reasoning=f'Command "{input.command}" not found',
            confidence=1.0,
        )

    lines: list[str] = ["# Command Documentation", ""]
    grouped: Dict[str, List[CommandDefinition]] = {}
    for command in commands:
        grouped.setdefault(command.category or "General", []).append(command)

    for category in sorted(grouped):
        lines.append(f"## {category}")
        lines.append("")
        for command in sorted(grouped[category], key=lambda item: item.name):
            lines.append(f"### `{command.name}`")
            lines.append("")
            lines.append(command.description)
            lines.append("")

            if command.tags:
                lines.append(f"**Tags:** {', '.join(f'`{tag}`' for tag in command.tags)}")
                lines.append("")

            lines.append(f"**Mutation:** {'Yes' if command.mutation else 'No (read-only)'}")
            lines.append("")

            if command.requires:
                lines.append(f"**Requires:** {', '.join(f'`{name}`' for name in command.requires)}")
                lines.append("")

            if command.contexts:
                lines.append(f"**Contexts:** {', '.join(f'`{name}`' for name in command.contexts)}")
                lines.append("")

            if command.parameters:
                lines.append("**Parameters:**")
                lines.append("")
                lines.append("| Name | Type | Required | Description |")
                lines.append("|------|------|----------|-------------|")
                for parameter in command.parameters:
                    lines.append(
                        f"| {parameter.name} | {parameter.type} | "
                        f"{'Yes' if parameter.required else 'No'} | {parameter.description} |"
                    )
                lines.append("")

            if command.examples:
                lines.append("**Examples:**")
                lines.append("")
                for example in command.examples:
                    lines.append(f"- `{example.title}`")
                    lines.append("")
                    lines.append(_json_block(example.input if isinstance(example.input, dict) else {"value": example.input}))
                    lines.append("")

            if command.input_schema:
                lines.append("**Input Schema:**")
                lines.append("")
                lines.append(_json_block(command.input_schema))
                lines.append("")

            if command.returns:
                lines.append("**Output Schema:**")
                lines.append("")
                lines.append(_json_block(command.returns))
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
    """Create the ``afd-docs`` bootstrap command."""

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[AfdDocsOutput]:
        try:
            parsed_input = input if isinstance(input, AfdDocsInput) else AfdDocsInput(**(input or {}))
        except ValidationError as exc:
            return _input_validation_failure(AfdDocsInput, input, exc)
        return await _afd_docs_handler(parsed_input, context, get_commands)

    return CommandDefinition(
        name="afd-docs",
        description="Generate markdown documentation for available commands",
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
            )
        ],
        input_schema=AfdDocsInput.model_json_schema(),
        returns=AfdDocsOutput.model_json_schema(),
        expose=BOOTSTRAP_EXPOSE,
    )
