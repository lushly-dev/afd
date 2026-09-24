"""Lazy discovery/detail helpers for MCP tool routing."""

from __future__ import annotations

from difflib import get_close_matches
from typing import Any, Iterable, Sequence

from afd.core.commands import CommandDefinition, command_to_mcp_tool, serialize_command_examples
from afd.core.result import CommandResult, success

# Requested names are untrusted: cap them before fuzzy matching and echoing.
_MAX_COMMAND_NAME_LENGTH = 128


def _truncate_description(description: str, max_length: int = 120) -> str:
    first_sentence = description.split(". ")[0] if description else ""
    candidate = first_sentence or description
    if len(candidate) <= max_length:
        return candidate
    return f"{candidate[: max_length - 1]}..."


def _derive_category(command: CommandDefinition) -> str:
    if command.category:
        return command.category
    return command.name.split("-", 1)[0] if "-" in command.name else "general"


def _matches_search(command: CommandDefinition, query: str) -> bool:
    tokens = [token for token in query.lower().split() if token]
    if not tokens:
        return True
    haystack = f"{command.name} {command.description}".lower()
    return all(token in haystack for token in tokens)


def _matches_tags(command: CommandDefinition, tags: Sequence[str], mode: str) -> bool:
    command_tags = command.tags or []
    if not command_tags:
        return False
    if mode == "all":
        return all(tag in command_tags for tag in tags)
    return any(tag in command_tags for tag in tags)


def execute_discover(
    commands: Sequence[CommandDefinition],
    raw_input: dict[str, Any] | None,
) -> CommandResult[dict[str, Any]]:
    """List available commands with lightweight metadata."""

    payload = dict(raw_input or {})
    category = payload.get("category")
    tag = payload.get("tag")
    tag_mode = payload.get("tag_mode", payload.get("tagMode", "any"))
    search = payload.get("search")
    include_mutation = bool(
        payload.get("include_mutation", payload.get("includeMutation", False))
    )
    limit = max(1, min(int(payload.get("limit", 50) or 50), 200))
    offset = max(0, int(payload.get("offset", 0) or 0))

    all_categories = sorted({_derive_category(command) for command in commands})
    all_tags = sorted({tag for command in commands for tag in (command.tags or [])})

    filtered = list(commands)
    if category:
        filtered = [command for command in filtered if _derive_category(command) == category]
    if tag:
        tags = tag if isinstance(tag, list) else [tag]
        filtered = [command for command in filtered if _matches_tags(command, tags, tag_mode)]
    if search:
        filtered = [command for command in filtered if _matches_search(command, str(search))]

    page = filtered[offset : offset + limit]
    data = {
        "commands": [
            {
                "name": command.name,
                "description": _truncate_description(command.description),
                "category": _derive_category(command),
                **({"mutation": command.mutation} if include_mutation else {}),
            }
            for command in page
        ],
        "total": len(commands),
        "filtered": len(filtered),
        "returned": len(page),
        "hasMore": offset + limit < len(filtered),
        "availableCategories": all_categories,
        "availableTags": all_tags,
    }
    reasoning = (
        f"Returned {len(page)} of {len(filtered)} matching commands "
        f"({len(commands)} total)"
    )
    if data["hasMore"]:
        reasoning += f". Use offset={offset + limit} to see more."
    return success(data, reasoning=reasoning, confidence=1.0)


def execute_detail(
    all_registered_commands: Sequence[CommandDefinition],
    exposed_command_names: set[str],
    raw_input: dict[str, Any] | None,
) -> CommandResult[list[dict[str, Any]]]:
    """Return detailed command metadata for one or more command names."""

    payload = raw_input or {}
    requested = payload.get("command")
    raw_names = requested if isinstance(requested, list) else [requested]
    names = [name for name in raw_names if isinstance(name, str) and name][:10]
    available_names = [command.name for command in all_registered_commands]
    command_map = {command.name: command for command in all_registered_commands}

    entries: list[dict[str, Any]] = []
    for name in names:
        command = command_map.get(name)
        if command is None:
            name = name[:_MAX_COMMAND_NAME_LENGTH]
            suggestion = get_close_matches(name, available_names, n=1)
            entries.append(
                {
                    "name": name,
                    "found": False,
                    "error": {
                        "code": "COMMAND_NOT_FOUND",
                        "message": f"No command named '{name}'",
                        "suggestion": (
                            f"Did you mean '{suggestion[0]}'? Use afd-discover to list commands."
                            if suggestion
                            else "Use afd-discover to list commands."
                        ),
                    },
                }
            )
            continue

        tool = command_to_mcp_tool(command)
        entry = {
            "name": command.name,
            "found": True,
            "description": command.description,
            "category": command.category,
            "tags": list(command.tags or []),
            "mutation": command.mutation,
            "executionTime": command.execution_time,
            "errors": list(command.errors or []),
            "inputSchema": tool["inputSchema"],
            "outputSchema": command.returns,
            "version": command.version,
            "callable": command.name in exposed_command_names,
            "requires": list(command.requires or []),
            "contexts": list(command.contexts or []),
            "examples": serialize_command_examples(list(command.examples or [])),
            "handoff": command.handoff,
            "handoffProtocol": command.handoff_protocol,
        }
        # Wire format: unset fields are omitted, never null.
        entries.append({key: value for key, value in entry.items() if value is not None})

    return success(
        entries,
        reasoning=f"Resolved {sum(1 for entry in entries if entry.get('found'))} of {len(entries)} requested commands",
        confidence=1.0,
    )
