"""MCP tool list generation for individual, grouped, lazy, and hybrid strategies."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from typing import Any

from afd.core.commands import (
    CommandDefinition,
    command_result_output_schema,
    command_to_mcp_tool,
)
from afd.server.confirmations import CONFIRM_PROPERTY, accepts_confirm
from afd.server.types import ToolStrategy

MAX_FIRST_CLASS_TOOLS = 8
"""The most first-class tools a hybrid server lists (spec/tool-strategies.md, H5)."""

# The context tools in list order. The hybrid list names them explicitly, so that its order
# does not depend on how the server registered its bootstrap commands.
CONTEXT_TOOL_ORDER = ("afd-context-list", "afd-context-enter", "afd-context-exit")


# The meta-tools, field for field as spec/meta-tools.json defines them (TypeScript's, Rust's and
# C++'s are the same; a test compares them).
CallToolSchema: dict[str, Any] = {
    "name": "afd-call",
    "title": "Call a command",
    "description": "Invoke any command by name with runtime input validation. Works in all server strategies.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "minLength": 1, "description": "Command name to invoke"},
            "input": {
                "type": "object",
                "description": "Command input (validated against the command's own schema at runtime)",
            },
            "confirm": {
                "description": "Set to true to confirm a command that asks for confirmation, once the user intends it (only on servers that enforce confirmations)",
                "type": "boolean",
            },
            "meta": {
                "type": "object",
                "description": "Request values for clients that cannot set _meta: dev.afd/context, dev.afd/outputBudget, dev.afd/idempotencyKey and the server's declared context fields' _meta keys, applied as if sent in _meta",
            },
        },
        "required": ["command"],
    },
}

BatchToolSchema: dict[str, Any] = {
    "name": "afd-batch",
    "title": "Run commands in a batch",
    "description": "Execute multiple commands in a single batch request with partial success semantics",
    "inputSchema": {
        "type": "object",
        "properties": {
            "commands": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "description": "Optional client-provided ID for correlating results",
                            "type": "string",
                        },
                        "command": {"type": "string", "description": "The command name to execute"},
                        "input": {
                            "type": "object",
                            "description": "Input parameters for the command",
                        },
                    },
                    "required": ["command"],
                },
                "description": "Array of commands to execute",
            },
            "options": {
                "description": "Batch execution options",
                "type": "object",
                "properties": {
                    "stopOnError": {
                        "description": "Stop execution on first error",
                        "type": "boolean",
                    },
                    "timeout": {
                        "description": "Timeout in milliseconds for entire batch",
                        "type": "number",
                        "minimum": 0,
                    },
                    "parallelism": {
                        "description": "Maximum commands to run concurrently (default 1)",
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 9007199254740991,
                    },
                },
            },
            "confirm": {
                "description": "Names of the commands that ask for confirmation and are confirmed, once the user intends them (only on servers that enforce confirmations)",
                "type": "array",
                "items": {"type": "string"},
            },
            "meta": {
                "type": "object",
                "description": "Request values for clients that cannot set _meta: dev.afd/context, dev.afd/outputBudget, dev.afd/idempotencyKey and the server's declared context fields' _meta keys, applied as if sent in _meta",
            },
        },
        "required": ["commands"],
    },
}

PipeToolSchema: dict[str, Any] = {
    "name": "afd-pipe",
    "title": "Run a command pipeline",
    "description": "Execute a pipeline of chained commands where the output of one becomes the input of the next",
    "inputSchema": {
        "type": "object",
        "properties": {
            "input": {
                "description": "Optional pipeline input (any JSON value), available to steps as $input and $input.<path>"
            },
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "Command name to execute"},
                        "input": {
                            "description": "Input parameters. A string value that is exactly $prev, $first, $steps[n], $steps.alias or $input, optionally followed by .path (e.g. $prev.items[0].id), is replaced by that data; unresolved references are omitted. Other strings are literals; start one with $$ to send a literal $ (e.g. $$prev).",
                            "type": "object",
                            "propertyNames": {"type": "string"},
                            "additionalProperties": {},
                        },
                        "as": {
                            "description": "Optional alias for referencing this step's output",
                            "type": "string",
                        },
                        "when": {
                            "description": "Optional condition for running this step (e.g., { $exists: '$prev.id' })",
                            "type": "object",
                            "propertyNames": {"type": "string"},
                            "additionalProperties": {},
                        },
                    },
                    "required": ["command"],
                },
                "description": "Ordered list of pipeline steps to execute",
            },
            "options": {
                "description": "Pipeline execution options",
                "type": "object",
                "properties": {
                    "continueOnFailure": {
                        "description": "Continue on failure or stop immediately",
                        "type": "boolean",
                    },
                    "timeoutMs": {
                        "description": "Timeout for entire pipeline in milliseconds",
                        "type": "number",
                        "minimum": 0,
                    },
                },
            },
            "confirm": {
                "description": "Names of the commands that ask for confirmation and are confirmed, once the user intends them (only on servers that enforce confirmations)",
                "type": "array",
                "items": {"type": "string"},
            },
            "meta": {
                "type": "object",
                "description": "Request values for clients that cannot set _meta: dev.afd/context, dev.afd/outputBudget, dev.afd/idempotencyKey and the server's declared context fields' _meta keys, applied as if sent in _meta",
            },
        },
        "required": ["steps"],
    },
}

DiscoverToolSchema: dict[str, Any] = {
    "name": "afd-discover",
    "title": "Discover commands",
    "description": "List available commands with optional filtering by category, tag, or search text. Returns compact summaries.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "category": {"description": "Filter commands by category", "type": "string"},
            "tag": {
                "description": "Filter by tag(s). String for single, array for multiple.",
                "anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}],
            },
            "tagMode": {
                "description": "Tag matching mode (default: any)",
                "type": "string",
                "enum": ["all", "any"],
            },
            "search": {
                "description": "Text search across names and descriptions",
                "type": "string",
            },
            "includeMutation": {
                "description": "Include mutation classification",
                "type": "boolean",
            },
            "limit": {"description": "Max results (1-200, default 50)", "type": "number"},
            "offset": {"description": "Results to skip for pagination", "type": "number"},
            "meta": {
                "type": "object",
                "description": "Request values for clients that cannot set _meta: dev.afd/context, dev.afd/outputBudget, dev.afd/idempotencyKey and the server's declared context fields' _meta keys, applied as if sent in _meta",
            },
        },
    },
}

DetailToolSchema: dict[str, Any] = {
    "name": "afd-detail",
    "title": "Describe commands",
    "description": "Get the full input schema and metadata for one or more commands by name.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {
                "anyOf": [{"type": "string"}, {"type": "array", "items": {"type": "string"}}],
                "description": "Command name or names (exact match, kebab-case). String or array of strings (max 10).",
            },
            "meta": {
                "type": "object",
                "description": "Request values for clients that cannot set _meta: dev.afd/context, dev.afd/outputBudget, dev.afd/idempotencyKey and the server's declared context fields' _meta keys, applied as if sent in _meta",
            },
        },
        "required": ["command"],
    },
}

META_TOOLS = (DiscoverToolSchema, DetailToolSchema, CallToolSchema, BatchToolSchema, PipeToolSchema)
"""The five meta-tools in the order every strategy lists them first (spec/tool-strategies.md, #533)."""

GROUPED_PARAMS_SCHEMA_BUDGET = 8_192
"""Largest serialized size, in UTF-16 code units as TypeScript measures it, of a grouped tool's
per-action schemas that are inlined as ``params.anyOf``."""


def _individual_tool(
    command: CommandDefinition, confirmations: str, output_schema: bool = True
) -> dict[str, Any]:
    """The command's tool, with the ``confirm`` argument when the command accepts it, and the
    CommandResult envelope as its top-level ``outputSchema`` when the command has ``returns``
    (``spec/command-metadata.md``, "Structured results") and ``output_schema`` is on."""
    tool = command_to_mcp_tool(command)
    if accepts_confirm(command, confirmations):
        schema = dict(tool["inputSchema"])
        schema["properties"] = {**(schema.get("properties") or {}), "confirm": CONFIRM_PROPERTY}
        tool["inputSchema"] = schema
    if output_schema and command.returns:
        tool["outputSchema"] = command_result_output_schema(command.returns)
    return tool


def _hybrid_tools_list(
    commands: Sequence[CommandDefinition],
    first_class_tools: Sequence[str],
    confirmations: str,
    output_schema: bool = True,
) -> list[dict[str, Any]]:
    """The hybrid list (spec/tool-strategies.md, H3): the five meta-tools, the context tools
    when the server has contexts, then the first-class command tools in configured order.

    The list is a function of the server's configuration alone, so it takes no active
    context: a first-class command outside the active context stays listed and is refused
    when called (H4). Each command tool is the individual strategy's tool.
    """
    by_name: dict[str, CommandDefinition] = {}
    for command in commands:
        # No registered command shares an enabled built-in's name (MCPServer refuses one
        # before each request), so the first of a name is the only one.
        by_name.setdefault(command.name, command)
    meta_tools = list(META_TOOLS)
    context_tools = [by_name[name] for name in CONTEXT_TOOL_ORDER if name in by_name]
    first_class = [by_name[name] for name in first_class_tools if name in by_name]
    return [
        *meta_tools,
        *(
            _individual_tool(command, confirmations, output_schema)
            for command in [*context_tools, *first_class]
        ),
    ]


def filter_commands_by_context(
    commands: Sequence[CommandDefinition],
    active_context: str | None,
) -> list[CommandDefinition]:
    """Keep universal commands plus commands in the active context."""

    if not active_context:
        return list(commands)
    return [
        command
        for command in commands
        if not command.contexts or active_context in command.contexts
    ]


def default_group_name(command: CommandDefinition) -> str:
    """Derive a grouped-tool name using category, then the first kebab segment."""

    if command.category:
        return command.category
    return command.name.split("-", 1)[0] if "-" in command.name else "general"


def get_command_action(command: CommandDefinition) -> str:
    """Derive the grouped action name for a command."""

    parts = command.name.split("-")
    return "-".join(parts[1:]) if len(parts) > 1 else command.name


def derive_group_name(command: CommandDefinition) -> str:
    """Alias matching the TS-inspired server router naming."""
    return default_group_name(command)


def derive_group_action(command: CommandDefinition) -> str:
    """Alias matching the TS-inspired server router naming."""
    return get_command_action(command)


def _object_schema(tool: dict[str, Any]) -> dict[str, Any]:
    """A tool's ``inputSchema`` as an object schema."""
    schema = dict(tool.get("inputSchema") or {})
    schema["type"] = "object"
    return schema


def _grouped_tool(
    group_name: str,
    members: Sequence[CommandDefinition],
    confirmations: str,
) -> dict[str, Any]:
    """One grouped tool, as TypeScript's: ``{ action, params }``, every action's schema and
    metadata in ``_meta.actions``, and the schemas inlined as ``params.anyOf`` when they fit in
    8,192 UTF-16 code units and hold no ``$ref`` (spec/tool-strategies.md, "grouped")."""
    actions: list[str] = []
    entries: list[dict[str, Any]] = []
    branches: list[dict[str, Any]] = []
    for command in members:
        action = get_command_action(command)
        if action not in actions:
            actions.append(action)
        # The command's own schema: a grouped tool takes `confirm` beside `action`, never in
        # `params`, as TypeScript's does.
        tool = command_to_mcp_tool(command)
        entries.append(
            {
                "action": action,
                "command": command.name,
                "description": command.description,
                "inputSchema": _object_schema(tool),
                # TypeScript's per-command _meta, which leads with the category.
                **({"category": command.category} if command.category else {}),
                **(tool.get("_meta") or {}),
            }
        )
        branches.append(
            {
                **_object_schema(tool),
                "title": action,
                "description": f"Parameters for action '{action}' ({command.name})",
            }
        )
    # As JSON.stringify writes it for strings and integers; a float such as 1.0 or a lone
    # surrogate may count differently from TypeScript at the very edge of the budget.
    serialized = json.dumps(branches, separators=(",", ":"), ensure_ascii=False)
    inline = (
        len(serialized.encode("utf-16-le")) // 2 <= GROUPED_PARAMS_SCHEMA_BUDGET
        and '"$ref"' not in serialized
    )
    params: dict[str, Any] = {
        "type": "object",
        "description": (
            "Parameters for the action: the anyOf branch titled with the action"
            if inline
            else "Parameters for the action: see _meta.actions[].inputSchema, or call afd-detail "
            "with the action's command name"
        ),
    }
    if inline:
        params["anyOf"] = branches
    properties: dict[str, Any] = {
        "action": {
            "type": "string",
            "enum": actions,
            "description": f"Action to perform: {' | '.join(actions)}",
        },
        "params": params,
    }
    if any(accepts_confirm(command, confirmations) for command in members):
        properties["confirm"] = CONFIRM_PROPERTY
    return {
        "name": group_name,
        "description": f"{group_name} operations: {', '.join(actions)}",
        "inputSchema": {"type": "object", "properties": properties, "required": ["action"]},
        "_meta": {"actions": entries},
    }


def get_tools_list(
    commands: Sequence[CommandDefinition],
    tool_strategy: ToolStrategy,
    group_by_fn: Callable[[CommandDefinition], str | None] | None = None,
    active_context: str | None = None,
    confirmations: str = "off",
    first_class_tools: Sequence[str] | None = None,
    output_schema: bool = True,
) -> list[dict[str, Any]]:
    """Return the MCP-visible tool list for the selected strategy (spec/tool-strategies.md, #533).

    Every strategy lists the five meta-tools first. ``lazy`` is the hybrid list with no
    first-class tools, and ``hybrid`` lists ``first_class_tools``; neither reads
    ``active_context``. ``individual`` and ``grouped`` list the commands available in it, as
    command tools or as one grouped tool per group in the order of each group's first command.
    With ``confirmations="enforce"``, confirm-gated tools advertise the ``confirm`` argument. A
    command listed as its own tool with ``returns`` advertises the CommandResult envelope as its
    top-level ``outputSchema`` unless ``output_schema`` is off.
    """

    if tool_strategy in ("hybrid", "lazy"):
        listed = (first_class_tools or []) if tool_strategy == "hybrid" else []
        return _hybrid_tools_list(commands, listed, confirmations, output_schema)

    filtered_commands = filter_commands_by_context(commands, active_context)
    if tool_strategy == "individual":
        return [
            *META_TOOLS,
            *(
                _individual_tool(command, confirmations, output_schema)
                for command in filtered_commands
            ),
        ]

    group_name_for = group_by_fn or default_group_name
    groups: dict[str, list[CommandDefinition]] = {}
    for command in filtered_commands:
        groups.setdefault(group_name_for(command) or "general", []).append(command)
    return [
        *META_TOOLS,
        *(
            _grouped_tool(group_name, members, confirmations)
            for group_name, members in groups.items()
        ),
    ]
