"""MCP tool list generation for individual, grouped, and lazy strategies."""

from __future__ import annotations

from typing import Any, Callable, Optional, Sequence

from afd.core.commands import CommandDefinition, command_to_mcp_tool
from afd.server.types import ToolStrategy


BatchToolSchema = {
    "name": "afd-batch",
    "description": "Execute multiple commands in a single batch request with partial success semantics",
    "inputSchema": {
        "type": "object",
        "properties": {
            "commands": {
                "type": "array",
                "description": "Array of commands to execute",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "Optional client-provided ID"},
                        "command": {"type": "string", "description": "The command name to execute"},
                        "input": {"type": "object", "description": "Input parameters for the command"},
                    },
                    "required": ["command"],
                },
            },
            "options": {
                "type": "object",
                "description": "Batch execution options",
                "properties": {
                    "stopOnError": {"type": "boolean", "description": "Stop execution on first error"},
                    "timeout": {"type": "number", "description": "Timeout in milliseconds for the full batch"},
                },
            },
        },
        "required": ["commands"],
    },
}

PipeToolSchema = {
    "name": "afd-pipe",
    "description": "Execute a pipeline of chained commands where earlier outputs can feed later steps",
    "inputSchema": {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "description": "Ordered list of pipeline steps to execute",
                "items": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "Command name to execute"},
                        "input": {"type": "object", "description": "Input parameters for the command"},
                        "as": {"type": "string", "description": "Optional alias for this step"},
                        "when": {"type": "object", "description": "Optional condition controlling execution"},
                    },
                    "required": ["command"],
                },
            },
            "options": {
                "type": "object",
                "description": "Pipeline execution options",
                "properties": {
                    "continueOnFailure": {
                        "type": "boolean",
                        "description": "Continue after a failed step instead of stopping immediately",
                    },
                    "timeoutMs": {
                        "type": "number",
                        "description": "Timeout for the full pipeline in milliseconds",
                    },
                },
            },
        },
        "required": ["steps"],
    },
}

CallToolSchema = {
    "name": "afd-call",
    "description": "Invoke any command by name with runtime input validation",
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Command name to invoke"},
            "input": {"type": "object", "description": "Input payload for the target command"},
        },
        "required": ["command"],
    },
}

DiscoverToolSchema = {
    "name": "afd-discover",
    "description": "List available commands with optional filtering by category, tag, or search text",
    "inputSchema": {
        "type": "object",
        "properties": {
            "category": {"type": "string", "description": "Filter by category"},
            "tag": {"type": "string", "description": "Filter by tag"},
            "tagMode": {
                "type": "string",
                "enum": ["all", "any"],
                "description": "Tag matching mode",
            },
            "search": {"type": "string", "description": "Search text across names and descriptions"},
            "includeMutation": {"type": "boolean", "description": "Include mutation classification"},
            "limit": {"type": "number", "description": "Maximum results to return (1-200)"},
            "offset": {"type": "number", "description": "Number of results to skip"},
        },
    },
}

DetailToolSchema = {
    "name": "afd-detail",
    "description": "Get detailed input/output schema and metadata for one or more commands",
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {
                "oneOf": [
                    {
                        "type": "string",
                    },
                    {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 10,
                    },
                ],
                "description": "Command name or names (string or array of strings, max 10)",
            }
        },
        "required": ["command"],
    },
}


def filter_commands_by_context(
    commands: Sequence[CommandDefinition],
    active_context: Optional[str],
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


def get_tools_list(
	commands: Sequence[CommandDefinition],
	tool_strategy: ToolStrategy,
	group_by_fn: Optional[Callable[[CommandDefinition], Optional[str]]] = None,
	active_context: Optional[str] = None,
) -> list[dict[str, Any]]:
	"""Return the MCP-visible tool list for the selected strategy."""

	builtins = [DiscoverToolSchema, DetailToolSchema, BatchToolSchema, PipeToolSchema, CallToolSchema]
	filtered_commands = filter_commands_by_context(commands, active_context)
	bootstrap_commands = [
		command for command in filtered_commands if command.category == "bootstrap"
	]
	routed_commands = [
		command for command in filtered_commands if command.category != "bootstrap"
	]

	if tool_strategy == "lazy":
		return [
			*builtins,
			*(command_to_mcp_tool(command) for command in bootstrap_commands),
		]

	if tool_strategy == "individual":
		return [*builtins, *(command_to_mcp_tool(command) for command in filtered_commands)]

	group_name_for = group_by_fn or default_group_name
	grouped: dict[str, list[CommandDefinition]] = {}
	for command in routed_commands:
		group_name = group_name_for(command) or "general"
		grouped.setdefault(group_name, []).append(command)

	grouped_tools: list[dict[str, Any]] = []
	for group_name, group_commands in sorted(grouped.items()):
		actions = sorted({get_command_action(command) for command in group_commands})
		grouped_tools.append(
			{
				"name": group_name,
				"description": f"{group_name} operations: {', '.join(actions)}",
				"inputSchema": {
					"type": "object",
					"properties": {
						"action": {
							"type": "string",
							"enum": actions,
							"description": "Operation to execute within this group",
						},
						"params": {
							"type": "object",
							"description": "Input payload for the selected action",
						},
					},
					"required": ["action"],
				},
			}
		)

	return [
		*builtins,
		*(command_to_mcp_tool(command) for command in bootstrap_commands),
		*grouped_tools,
	]
