"""Command → Tool bridge.

Converts botcore ``CommandResult``-returning async functions into
Copilot SDK :class:`Tool` objects so they can be called by the LLM.
"""

from __future__ import annotations

import inspect
import json
import logging
from collections.abc import Callable
from typing import Any, Union, get_type_hints

from copilot import Tool, ToolInvocation, ToolResult
from pydantic import BaseModel

logger = logging.getLogger(__name__)


def botcore_command_to_copilot_tool(command: Callable[..., Any]) -> Tool:
    """Convert a botcore command into a Copilot SDK ``Tool``.

    The tool's:
    - **name** is derived from ``command.__name__``
    - **description** is derived from ``command.__doc__``
    - **parameters** schema is extracted from type hints (Pydantic or inspect)
    - **handler** bridges tool invocations back to the command, converting
      ``CommandResult`` into ``ToolResult``

    Args:
        command: An async botcore command returning ``CommandResult``.

    Returns:
        A :class:`Tool` ready for use in a ``SessionConfig``.
    """
    name = command.__name__
    description = (command.__doc__ or "").strip().split("\n")[0]
    schema = _extract_parameter_schema(command)

    # Pre-compute signature info once at bridge time, not per invocation.
    pydantic_type = _detect_pydantic_param(command)

    async def handler(invocation: ToolInvocation) -> ToolResult:
        args = invocation.arguments or {}

        if pydantic_type is not None:
            model_instance = pydantic_type.model_validate(args)
            result = await command(model_instance)
        else:
            result = await command(**args)

        return _command_result_to_tool_result(result)

    return Tool(
        name=name,
        description=description,
        handler=handler,
        parameters=schema,
    )


def bridge_commands(
    command_names: list[str],
    namespace: dict[str, Callable[..., Any]],
) -> list[Tool]:
    """Resolve command names from a namespace and bridge each one.

    Args:
        command_names: List of command function names to bridge.
        namespace: Dict mapping names to command callables (e.g. from
            ``build_namespace()``).

    Returns:
        List of bridged :class:`Tool` objects.

    Raises:
        KeyError: If a command name is not found in the namespace.
    """
    tools: list[Tool] = []
    for name in command_names:
        if name not in namespace:
            raise KeyError(f"Command {name!r} not found in namespace")
        tools.append(botcore_command_to_copilot_tool(namespace[name]))
    return tools


def _extract_parameter_schema(command: Callable[..., Any]) -> dict[str, Any] | None:
    """Extract a JSON Schema from command type hints.

    If the first parameter is a Pydantic ``BaseModel``, returns its
    ``model_json_schema()``.  Otherwise, builds a schema from
    ``inspect.signature()`` parameters.
    """
    sig = inspect.signature(command)
    params = list(sig.parameters.values())

    if not params:
        return None

    # Check if first param is a Pydantic model
    hints = get_type_hints(command)
    first_type = hints.get(params[0].name)
    if first_type and isinstance(first_type, type) and issubclass(first_type, BaseModel):
        return first_type.model_json_schema()

    # Build schema from individual parameters
    properties: dict[str, Any] = {}
    required: list[str] = []

    for param in params:
        param_type = hints.get(param.name, str)
        json_type = _python_type_to_json_type(param_type)
        properties[param.name] = {"type": json_type}

        if param.default is inspect.Parameter.empty:
            required.append(param.name)
        else:
            properties[param.name]["default"] = param.default

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    if required:
        schema["required"] = required

    return schema


def _detect_pydantic_param(command: Callable[..., Any]) -> type[BaseModel] | None:
    """If *command* takes a single Pydantic model parameter, return its type."""
    sig = inspect.signature(command)
    params = list(sig.parameters.values())
    if len(params) != 1:
        return None
    hints = get_type_hints(command)
    first_type = hints.get(params[0].name)
    if first_type and isinstance(first_type, type) and issubclass(first_type, BaseModel):
        return first_type
    return None


def _unwrap_optional(python_type: Any) -> Any:
    """Unwrap ``X | None`` / ``Optional[X]`` to ``X``.

    Returns the inner type if the input is a union with ``NoneType``,
    otherwise returns the input unchanged.
    """
    import types as _types

    # Python 3.10+ ``X | None`` produces a types.UnionType
    if isinstance(python_type, _types.UnionType):
        args = python_type.__args__
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return non_none[0]
        return python_type

    # typing.Optional[X] / typing.Union[X, None]
    origin = getattr(python_type, "__origin__", None)
    if origin is Union:
        args = python_type.__args__
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return non_none[0]

    return python_type


def _python_type_to_json_type(python_type: Any) -> str:
    """Map a Python type to a JSON Schema type string."""
    # Unwrap Optional / X | None before checking
    python_type = _unwrap_optional(python_type)

    origin = getattr(python_type, "__origin__", None)

    if python_type is str:
        return "string"
    if python_type is int:
        return "integer"
    if python_type is float:
        return "number"
    if python_type is bool:
        return "boolean"
    if origin is list or python_type is list:
        return "array"
    if origin is dict or python_type is dict:
        return "object"
    return "string"


def _command_result_to_tool_result(result: Any) -> ToolResult:
    """Convert a ``CommandResult`` to a Copilot ``ToolResult``."""
    if result.success:
        return ToolResult(
            text_result_for_llm=json.dumps(result.data, default=str),
            result_type="success",
        )

    err = result.error
    error_payload: dict[str, Any] = {
        "error": err.code,
        "message": err.message,
    }
    if err.suggestion:
        error_payload["suggestion"] = err.suggestion

    return ToolResult(
        text_result_for_llm=json.dumps(error_payload),
        result_type="failure",
    )
