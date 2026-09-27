"""The commands ``afd validate --surface`` evaluates.

They are read from a remote server's tool listing whatever its tool strategy:

- individual: one tool per command;
- grouped: one tool per group; TypeScript servers list each command in the
  tool's ``_meta.actions``, other servers only advertise ``action``/``params``,
  so their commands are listed with afd-discover and afd-detail;
- lazy: no command tools, so commands are listed with afd-discover and afd-detail.

Tools and commands that AFD servers provide themselves (afd-call, afd-batch,
afd-help, afd-context-list, ...) are skipped: they are not the application's
surface, and findings about them tell the user nothing they can fix.
"""

from __future__ import annotations

from typing import Any, Optional

from afd.core.builtin_names import is_afd_builtin_name
from afd.transports.base import ToolInfo, Transport

DISCOVER_PAGE_SIZE = 200
"""Page size for afd-discover (its maximum)."""

DETAIL_BATCH_SIZE = 10
"""Most commands afd-detail describes per call."""

MAX_DISCOVER_PAGES = 50
"""Stop paging afd-discover after this many pages."""


def _tool_to_command(tool: ToolInfo) -> dict[str, Any]:
    meta = tool.meta or {}
    return {
        "name": tool.name,
        "description": tool.description or "",
        "category": meta.get("category"),
        "jsonSchema": tool.input_schema or {"type": "object", "properties": {}},
        "outputJsonSchema": meta.get("outputSchema"),
        "requires": meta.get("requires"),
        "contexts": meta.get("contexts"),
    }


def _action_to_command(action: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": action["command"],
        "description": action.get("description") or "",
        "category": action.get("category"),
        "jsonSchema": action.get("inputSchema"),
        "outputJsonSchema": action.get("outputSchema"),
        "requires": action.get("requires"),
        "contexts": action.get("contexts"),
    }


def _grouped_actions(tool: ToolInfo) -> Optional[list[dict[str, Any]]]:
    """The well-formed ``_meta.actions`` entries of a grouped tool, or None."""
    actions = (tool.meta or {}).get("actions")
    if not isinstance(actions, list):
        return None
    return [
        action
        for action in actions
        if isinstance(action, dict) and isinstance(action.get("command"), str) and action["command"]
    ]


def is_opaque_grouped_tool(tool: ToolInfo) -> bool:
    """Whether a tool looks grouped (``action`` enum plus ``params``) but lists no actions."""
    if _grouped_actions(tool) is not None:
        return False
    schema = tool.input_schema or {}
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return False
    action = properties.get("action")
    required = schema.get("required")
    return (
        isinstance(action, dict)
        and isinstance(action.get("enum"), list)
        and isinstance(properties.get("params"), dict)
        and isinstance(required, list)
        and "action" in required
    )


def commands_from_tools(tools: list[ToolInfo]) -> list[dict[str, Any]]:
    """Surface commands from a tool listing alone.

    Built-in AFD tools are skipped and grouped tools are replaced by one command
    per ``_meta.actions`` entry (built-in actions skipped).
    """
    commands: list[dict[str, Any]] = []
    for tool in tools:
        if is_afd_builtin_name(tool.name):
            continue
        actions = _grouped_actions(tool)
        if actions is None:
            commands.append(_tool_to_command(tool))
            continue
        commands.extend(
            _action_to_command(action) for action in actions if not is_afd_builtin_name(action["command"])
        )
    return commands


async def collect_surface_commands(
    transport: Transport, tools: list[ToolInfo]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Collect the commands to validate, and warnings about anything left out.

    afd-discover and afd-detail are called only when the listing does not carry
    the commands: a lazy server (only built-in tools, including afd-discover), or
    grouped tools that do not list their actions. If discovery fails, those
    tools are validated as they are and a warning says why.
    """
    commands = commands_from_tools(tools)
    opaque = {tool.name for tool in tools if not is_afd_builtin_name(tool.name) and is_opaque_grouped_tool(tool)}
    lazy = not commands and any(tool.name == "afd-discover" for tool in tools)
    if not lazy and not opaque:
        return commands, []

    try:
        discovered = await _discover_commands(transport)
    except Exception as exc:  # noqa: BLE001 - any failure falls back to the listing
        if lazy:
            return commands, [f"Could not list commands with afd-discover ({exc}); no commands were validated."]
        names = ", ".join(sorted(opaque))
        return commands, [
            f"Could not list the commands of grouped tools {names} with afd-discover ({exc}); "
            "they were validated as tools."
        ]

    # A tool that only looks grouped may be a real command; discovery then lists it again.
    listed = [command for command in commands if command["name"] not in opaque]
    known = {command["name"] for command in listed}
    return listed + [command for command in discovered if command["name"] not in known], []


def _payload(result: Any, tool_name: str) -> Any:
    """The ``data`` of a CommandResult-shaped response; raise when it failed."""
    if isinstance(result, dict):
        if result.get("success") is False:
            error = result.get("error")
            message = error.get("message") if isinstance(error, dict) else None
            raise RuntimeError(f"{tool_name} failed: {message or 'unknown error'}")
        return result.get("data", result)
    return result


async def _discover_commands(transport: Transport) -> list[dict[str, Any]]:
    """List every command with afd-discover, then describe each with afd-detail."""
    names: list[str] = []
    offset = 0
    for _ in range(MAX_DISCOVER_PAGES):
        data = _payload(
            await transport.call_tool("afd-discover", {"limit": DISCOVER_PAGE_SIZE, "offset": offset}),
            "afd-discover",
        )
        entries = data.get("commands") if isinstance(data, dict) else None
        if not isinstance(entries, list):
            raise RuntimeError("afd-discover returned no commands list")
        names.extend(
            entry["name"] for entry in entries if isinstance(entry, dict) and isinstance(entry.get("name"), str)
        )
        if data.get("hasMore") is not True or not entries:
            break
        offset += len(entries)

    wanted = [name for name in dict.fromkeys(names) if not is_afd_builtin_name(name)]
    commands: list[dict[str, Any]] = []
    for start in range(0, len(wanted), DETAIL_BATCH_SIZE):
        batch = wanted[start : start + DETAIL_BATCH_SIZE]
        details = _payload(await transport.call_tool("afd-detail", {"command": batch}), "afd-detail")
        if not isinstance(details, list):
            raise RuntimeError("afd-detail returned no command list")
        for entry in details:
            if not isinstance(entry, dict) or entry.get("found") is not True:
                continue
            if not isinstance(entry.get("name"), str):
                continue
            commands.append(
                {
                    "name": entry["name"],
                    "description": entry.get("description") or "",
                    "category": entry.get("category"),
                    "jsonSchema": entry.get("inputSchema"),
                    "outputJsonSchema": entry.get("outputSchema"),
                    "requires": entry.get("requires"),
                    "contexts": entry.get("contexts"),
                }
            )
    return commands
