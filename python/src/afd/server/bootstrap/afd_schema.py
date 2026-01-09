"""afd-schema bootstrap command.

Export JSON schemas for all commands.
"""

from typing import Any, Callable, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from afd.core.commands import (
    CommandContext,
    CommandDefinition,
    CommandParameter,
)
from afd.core.result import CommandResult, success


class AfdSchemaInput(BaseModel):
    """Input for afd-schema command."""

    format: Literal["json", "typescript"] = Field(
        default="json",
        description='Output format: "json" or "typescript"',
    )


class SchemaInfo(BaseModel):
    """Information about a single command schema."""

    name: str
    description: str
    input_schema: Dict[str, Any]


class AfdSchemaOutput(BaseModel):
    """Output for afd-schema command."""

    schemas: List[SchemaInfo]
    count: int
    format: Literal["json", "typescript"]


def _build_schema_from_parameters(
    parameters: List[CommandParameter],
) -> Dict[str, Any]:
    """Build a JSON Schema from command parameters."""
    properties: Dict[str, Dict[str, Any]] = {}
    required: List[str] = []

    for param in parameters:
        prop: Dict[str, Any] = {
            "type": param.type,
        }
        if param.description:
            prop["description"] = param.description
        if param.default is not None:
            prop["default"] = param.default
        if param.enum is not None:
            prop["enum"] = param.enum

        properties[param.name] = prop

        if param.required:
            required.append(param.name)

    schema: Dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    if required:
        schema["required"] = required

    return schema


async def _afd_schema_handler(
    input: AfdSchemaInput,
    context: Optional[CommandContext],
    get_commands: Callable[[], List[CommandDefinition]],
    get_json_schema: Optional[Callable[[CommandDefinition], Dict[str, Any]]] = None,
) -> CommandResult[AfdSchemaOutput]:
    """Handler for afd-schema command."""
    commands = get_commands()

    schemas: List[SchemaInfo] = []
    for cmd in commands:
        # Try to get JSON schema from the command or use get_json_schema function
        schema: Dict[str, Any] = {}

        if get_json_schema:
            schema = get_json_schema(cmd)
        elif cmd.parameters:
            # Build basic schema from parameters
            schema = _build_schema_from_parameters(cmd.parameters)
        else:
            # Empty schema for commands with no parameters
            schema = {"type": "object", "properties": {}}

        schemas.append(
            SchemaInfo(
                name=cmd.name,
                description=cmd.description,
                input_schema=schema,
            )
        )

    # TypeScript format (placeholder for future)
    if input.format == "typescript":
        return success(
            AfdSchemaOutput(schemas=schemas, count=len(schemas), format="typescript"),
            reasoning=f"Exported {len(schemas)} schemas (TypeScript format coming soon)",
            confidence=0.8,
        )

    return success(
        AfdSchemaOutput(schemas=schemas, count=len(schemas), format="json"),
        reasoning=f"Exported JSON schemas for {len(schemas)} commands",
        confidence=1.0,
    )


def create_afd_schema_command(
    get_commands: Callable[[], List[CommandDefinition]],
    get_json_schema: Optional[Callable[[CommandDefinition], Dict[str, Any]]] = None,
) -> CommandDefinition:
    """Create the afd-schema bootstrap command.

    Args:
        get_commands: Function to get all registered commands.
        get_json_schema: Optional function to get JSON schema for a command.

    Returns:
        CommandDefinition for afd-schema.

    Example:
        >>> def get_cmds():
        ...     return [my_command_1, my_command_2]
        >>> schema_cmd = create_afd_schema_command(get_cmds)
    """

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[AfdSchemaOutput]:
        # Convert dict input to pydantic model if needed
        if isinstance(input, dict):
            parsed_input = AfdSchemaInput(**input)
        elif isinstance(input, AfdSchemaInput):
            parsed_input = input
        else:
            parsed_input = AfdSchemaInput()

        return await _afd_schema_handler(
            parsed_input,
            context,
            get_commands,
            get_json_schema,
        )

    return CommandDefinition(
        name="afd-schema",
        description="Export JSON schemas for all commands",
        handler=handler,
        category="bootstrap",
        tags=["bootstrap", "read", "safe"],
        mutation=False,
        version="1.0.0",
        parameters=[
            CommandParameter(
                name="format",
                type="string",
                description='Output format: "json" or "typescript"',
                required=False,
            ),
        ],
    )
