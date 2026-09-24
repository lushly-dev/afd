"""``afd-schema`` bootstrap command."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from afd.core.commands import CommandContext, CommandDefinition, CommandParameter
from afd.core.result import CommandResult, success
from afd.core.wire import WireModel
from afd.server.bootstrap.afd_context import BOOTSTRAP_EXPOSE
from afd.server.validation import _input_validation_failure


class AfdSchemaInput(BaseModel):
    """Input for ``afd-schema``."""

    format: Literal["json", "typescript"] = Field(
        default="json",
        description='Output format: "json" or "typescript"',
    )


class SchemaInfo(WireModel):
    """Schema information for one command."""

    name: str
    description: str
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any] | None = None
    typescript: str | None = None


class AfdSchemaOutput(WireModel):
    """Output for ``afd-schema``."""

    schemas: List[SchemaInfo]
    count: int
    format: Literal["json", "typescript"]


def _build_schema_from_parameters(parameters: List[CommandParameter]) -> Dict[str, Any]:
    properties: Dict[str, Dict[str, Any]] = {}
    required: List[str] = []
    for parameter in parameters:
        prop = dict(parameter.schema or {})
        prop.setdefault("type", parameter.type)
        if parameter.description:
            prop.setdefault("description", parameter.description)
        if parameter.default is not None:
            prop.setdefault("default", parameter.default)
        if parameter.enum is not None:
            prop.setdefault("enum", parameter.enum)
        properties[parameter.name] = prop
        if parameter.required:
            required.append(parameter.name)

    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }


def _schema_to_typescript(schema: Dict[str, Any] | None) -> str:
    if not schema:
        return "unknown"

    if schema.get("const") is not None:
        return repr(schema["const"])

    if schema.get("enum"):
        return " | ".join(repr(value) for value in schema["enum"])

    if schema.get("oneOf"):
        return " | ".join(_schema_to_typescript(item) for item in schema["oneOf"])

    if schema.get("anyOf"):
        return " | ".join(_schema_to_typescript(item) for item in schema["anyOf"])

    if schema.get("allOf"):
        return " & ".join(_schema_to_typescript(item) for item in schema["allOf"])

    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        return " | ".join(_schema_to_typescript({"type": item}) for item in schema_type)
    if schema_type == "string":
        return "string"
    if schema_type == "number" or schema_type == "integer":
        return "number"
    if schema_type == "boolean":
        return "boolean"
    if schema_type == "null":
        return "null"
    if schema_type == "array":
        return f"Array<{_schema_to_typescript(schema.get('items'))}>"
    if schema_type == "object":
        properties = schema.get("properties", {}) or {}
        required = set(schema.get("required", []) or [])
        if not properties:
            return "Record<string, unknown>"
        parts = ["{"]
        for name, prop_schema in properties.items():
            optional = "" if name in required else "?"
            parts.append(f"  {name}{optional}: {_schema_to_typescript(prop_schema)};")
        parts.append("}")
        return "\n".join(parts)
    return "unknown"


def _command_type_name(command_name: str) -> str:
    return "".join(part.capitalize() for part in command_name.split("-"))


def _render_named_typescript_type(name: str, schema: Dict[str, Any] | None) -> str:
    rendered = _schema_to_typescript(schema)
    if schema and schema.get("type") == "object" and rendered.startswith("{"):
        return f"export interface {name} {rendered}"
    return f"export type {name} = {rendered};"


def _render_typescript(command: CommandDefinition, input_schema: Dict[str, Any], output_schema: Dict[str, Any] | None) -> str:
    base_name = _command_type_name(command.name)
    return "\n".join(
        [
            _render_named_typescript_type(f"{base_name}Input", input_schema),
            _render_named_typescript_type(f"{base_name}Output", output_schema),
        ]
    )


async def _afd_schema_handler(
    input: AfdSchemaInput,
    context: Optional[CommandContext],
    get_commands: Callable[[], List[CommandDefinition]],
    get_json_schema: Optional[Callable[[CommandDefinition], Dict[str, Any]]] = None,
) -> CommandResult[AfdSchemaOutput]:
    commands = get_commands()
    schemas: list[SchemaInfo] = []

    for command in commands:
        input_schema = (
            get_json_schema(command)
            if get_json_schema is not None
            else command.input_schema or _build_schema_from_parameters(command.parameters)
        )
        output_schema = command.returns
        typescript = None
        if input.format == "typescript":
            typescript = _render_typescript(command, input_schema, output_schema)

        schemas.append(
            SchemaInfo(
                name=command.name,
                description=command.description,
                input_schema=input_schema,
                output_schema=output_schema,
                typescript=typescript,
            )
        )

    return success(
        AfdSchemaOutput(schemas=schemas, count=len(schemas), format=input.format),
        reasoning=f"Exported {len(schemas)} command schemas in {input.format} format",
        confidence=1.0,
    )


def create_afd_schema_command(
    get_commands: Callable[[], List[CommandDefinition]],
    get_json_schema: Optional[Callable[[CommandDefinition], Dict[str, Any]]] = None,
) -> CommandDefinition:
    """Create the ``afd-schema`` bootstrap command."""

    async def handler(
        input: Any,
        context: Optional[CommandContext] = None,
    ) -> CommandResult[AfdSchemaOutput]:
        try:
            parsed_input = input if isinstance(input, AfdSchemaInput) else AfdSchemaInput(**(input or {}))
        except ValidationError as exc:
            return _input_validation_failure(AfdSchemaInput, input, exc)
        return await _afd_schema_handler(parsed_input, context, get_commands, get_json_schema)

    return CommandDefinition(
        name="afd-schema",
        description="Export input and output schemas for available commands",
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
                enum=["json", "typescript"],
            )
        ],
        input_schema=AfdSchemaInput.model_json_schema(),
        returns=AfdSchemaOutput.model_json_schema(),
        expose=BOOTSTRAP_EXPOSE,
    )
