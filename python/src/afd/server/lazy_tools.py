"""Lazy discovery/detail helpers for MCP tool routing."""

from __future__ import annotations

import copy
import math
from collections.abc import Mapping, Sequence
from typing import Any, Literal

from afd.core.approval import approval_mode
from afd.core.commands import CommandDefinition, command_to_mcp_tool, serialize_command_examples
from afd.core.errors import Recovery
from afd.core.result import CommandResult, error, success
from afd.core.similarity import find_similar_tools, truncate_name

# How many close matches a COMMAND_NOT_FOUND suggestion names at most.
_MAX_NOT_FOUND_MATCHES = 3


NotFoundGuide = Literal["afd-discover", "afd-help"] | None
"""The command a ``COMMAND_NOT_FOUND`` suggestion and recovery point to, or ``None`` when the
caller can call neither (``spec/recovery.md``, "Engine errors")."""

_NOT_FOUND_NEXT: dict[str | None, str] = {
    "afd-discover": "Use afd-discover to list all commands.",
    "afd-help": "Use afd-help to list all commands.",
    None: "Check the command name against the available commands.",
}


def not_found_suggestion(
    command_name: str,
    command_names: Sequence[str],
    guide: NotFoundGuide = "afd-discover",
) -> str:
    """Recovery guidance for an unknown (untrusted, never echoed) command name.

    Names at most three close matches (none for very long names) and points to ``guide``, the
    command the caller can call to list commands (``afd-discover``, else ``afd-help``), or to the
    available commands when it can call neither: a suggestion never names a command the caller
    cannot call (``spec/recovery.md``, rule 2). It never lists every command, which in lazy mode
    would load the whole surface into the agent's context on a single typo.
    """
    next_step = _NOT_FOUND_NEXT[guide]
    matches = find_similar_tools(command_name, command_names, _MAX_NOT_FOUND_MATCHES)
    if not matches:
        return next_step
    best, *others = matches
    quoted_others = ", ".join(f"'{name}'" for name in others)
    also_close = f" Other close matches: {quoted_others}." if others else ""
    return f"Did you mean '{best}'?{also_close} {next_step}"


def not_found_recovery(guide: NotFoundGuide) -> Recovery | None:
    """The recovery of a ``COMMAND_NOT_FOUND`` whose suggestion points to ``guide``: a call of it,
    or none (``spec/recovery.md``, "Engine errors")."""
    return Recovery(kind="call", command=guide) if guide is not None else None


def command_not_found(
    command_name: str,
    command_names: Sequence[str],
    guide: NotFoundGuide,
) -> CommandResult[Any]:
    """The ``COMMAND_NOT_FOUND`` result for an unknown command name at lookup: the suggestion and
    the recovery name ``guide``, decided once, so the two never disagree (rule 1)."""
    return error(
        "COMMAND_NOT_FOUND",
        f"Command '{truncate_name(command_name)}' not found",
        suggestion=not_found_suggestion(command_name, command_names, guide),
        recovery=not_found_recovery(guide),
    )


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


_MISSING = object()


def _parse_discover_int(
    value: Any,
    *,
    field: str,
    default: int,
) -> tuple[int | None, CommandResult[dict[str, Any]] | None]:
    if value is _MISSING:
        return default, None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, error(
            "VALIDATION_ERROR",
            f"Invalid {field}: expected an integer",
            suggestion=f"Provide '{field}' as a finite integer.",
            details={"field": field},
        )
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return None, error(
                "VALIDATION_ERROR",
                f"Invalid {field}: expected a finite integer",
                suggestion=f"Provide '{field}' as a finite integer.",
                details={"field": field},
            )
        return int(value), None
    return value, None


def execute_discover(
    commands: Sequence[CommandDefinition],
    raw_input: dict[str, Any] | None,
) -> CommandResult[dict[str, Any]]:
    """List available commands with lightweight metadata."""

    if raw_input is not None and not isinstance(raw_input, Mapping):
        return error(
            "VALIDATION_ERROR",
            "afd-discover input must be an object",
            suggestion="Provide optional { category, tag, tagMode, search, includeMutation, limit, offset }.",
        )

    payload = dict(raw_input) if raw_input is not None else {}

    category = payload.get("category", _MISSING)
    if category is _MISSING:
        category = None
    elif not isinstance(category, str):
        return error(
            "VALIDATION_ERROR",
            "Invalid category: expected a string",
            suggestion="Provide 'category' as a string or omit it.",
            details={"field": "category"},
        )

    tag = payload.get("tag", _MISSING)
    if tag is _MISSING:
        tag = None
    elif not isinstance(tag, str) and not (
        isinstance(tag, list) and all(isinstance(t, str) for t in tag)
    ):
        return error(
            "VALIDATION_ERROR",
            "Invalid tag: expected a string or list of strings",
            suggestion="Provide 'tag' as a string or array of strings, or omit it.",
            details={"field": "tag"},
        )

    if "tag_mode" in payload:
        tag_mode = payload["tag_mode"]
    elif "tagMode" in payload:
        tag_mode = payload["tagMode"]
    else:
        tag_mode = "any"
    if tag_mode not in ("any", "all"):
        return error(
            "VALIDATION_ERROR",
            f"Invalid tagMode: {tag_mode!r}",
            suggestion="Use 'any' or 'all' for tagMode, or omit it.",
            details={"field": "tagMode"},
        )

    search = payload.get("search", _MISSING)
    if search is _MISSING:
        search = None
    elif not isinstance(search, str):
        return error(
            "VALIDATION_ERROR",
            "Invalid search: expected a string",
            suggestion="Provide 'search' as a string or omit it.",
            details={"field": "search"},
        )

    if "include_mutation" in payload:
        raw_include_mutation = payload["include_mutation"]
    elif "includeMutation" in payload:
        raw_include_mutation = payload["includeMutation"]
    else:
        raw_include_mutation = False
    if not isinstance(raw_include_mutation, bool):
        return error(
            "VALIDATION_ERROR",
            "Invalid includeMutation: expected a boolean",
            suggestion="Provide 'includeMutation' as true or false, or omit it.",
            details={"field": "includeMutation"},
        )
    include_mutation = raw_include_mutation

    parsed_limit, limit_err = _parse_discover_int(
        payload.get("limit", _MISSING), field="limit", default=50
    )
    if limit_err is not None or parsed_limit is None:
        return limit_err or error(
            "VALIDATION_ERROR", "Invalid limit", suggestion="Pass an integer limit."
        )
    parsed_offset, offset_err = _parse_discover_int(
        payload.get("offset", _MISSING), field="offset", default=0
    )
    if offset_err is not None or parsed_offset is None:
        return offset_err or error(
            "VALIDATION_ERROR", "Invalid offset", suggestion="Pass an integer offset."
        )

    limit = max(1, min(parsed_limit, 200))
    offset = max(0, parsed_offset)

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
    reasoning = f"Returned {len(page)} of {len(filtered)} matching commands ({len(commands)} total)"
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
            # Echo a bounded name: an unknown name is untrusted and can be huge.
            shown = truncate_name(name)
            entries.append(
                {
                    "name": shown,
                    "found": False,
                    "error": {
                        "code": "COMMAND_NOT_FOUND",
                        "message": f"No command named '{shown}'",
                        "suggestion": not_found_suggestion(name, available_names),
                    },
                }
            )
            continue

        tool = command_to_mcp_tool(command)
        entry = {
            "name": command.name,
            "found": True,
            "title": command.title,
            "description": command.description,
            "category": command.category,
            # Empty lists are omitted (spec/command-metadata.md, "Reporting rules").
            "tags": list(command.tags) if command.tags else None,
            "mutation": command.mutation,
            "executionTime": command.execution_time,
            "errors": list(command.errors) if command.errors else None,
            "inputSchema": tool["inputSchema"],
            "outputSchema": command.returns,
            "version": command.version,
            "callable": command.name in exposed_command_names,
            "requires": list(command.requires) if command.requires else None,
            "contexts": list(command.contexts) if command.contexts else None,
            "scopes": list(command.scopes) if command.scopes else None,
            "examples": (
                serialize_command_examples(list(command.examples)) if command.examples else None
            ),
            "handoff": command.handoff,
            "handoffProtocol": command.handoff_protocol,
            "destructive": command.destructive,
            "confirmPrompt": command.confirm_prompt,
            "confirmationMode": command.confirmation_mode,
            "undoable": command.undoable,
            "approval": approval_mode(command.approval),
            "task": command.task,
            "toolMeta": copy.deepcopy(command.tool_meta) if command.tool_meta else None,
            "outputBudget": (
                command.output_budget.to_wire_dict() if command.output_budget is not None else None
            ),
        }
        # Wire format: unset fields are omitted, never null.
        entries.append({key: value for key, value in entry.items() if value is not None})

    return success(
        entries,
        reasoning=f"Resolved {sum(1 for entry in entries if entry.get('found'))} of {len(entries)} requested commands",
        confidence=1.0,
    )
