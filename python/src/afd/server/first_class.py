"""Validation of the hybrid strategy's first-class tool set (spec/tool-strategies.md, H1, H2, H5)."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence

from afd.core.builtin_names import AFD_CONTEXT_COMMAND_NAMES, AFD_META_TOOL_NAMES
from afd.core.commands import CommandDefinition
from afd.server.tools import MAX_FIRST_CLASS_TOOLS


def normalize_first_class_tools(
    tool_strategy: str, first_class_tools: Sequence[str] | None
) -> list[str] | None:
    """Check the options that need no commands: the set goes with ``hybrid``, and only there.

    Raises:
        ValueError: The set is given with another strategy, is missing or empty with
            ``hybrid``, or is not a sequence of command names.
    """
    if tool_strategy != "hybrid":
        if first_class_tools is not None:
            raise ValueError(
                f"first_class_tools is only valid with tool_strategy='hybrid' "
                f"(got tool_strategy={tool_strategy!r}). Remove first_class_tools, "
                "or set tool_strategy='hybrid'."
            )
        return None
    if first_class_tools is None:
        raise ValueError(
            "tool_strategy='hybrid' needs first_class_tools: the command names to list as "
            "tools, in order (at most "
            f"{MAX_FIRST_CLASS_TOOLS}). Without any, use tool_strategy='lazy'."
        )
    if isinstance(first_class_tools, (str, bytes)) or not all(
        isinstance(name, str) and name for name in first_class_tools
    ):
        raise ValueError("first_class_tools must be a list of non-empty command names")
    names = list(first_class_tools)
    if not names:
        raise ValueError(
            "first_class_tools is empty: a hybrid server with no first-class tools is the "
            "lazy strategy. Set tool_strategy='lazy', or name at least one command."
        )
    return names


def check_first_class_tools(
    names: Sequence[str],
    commands: Mapping[str, CommandDefinition],
    is_mcp_exposed: Callable[[CommandDefinition], bool],
) -> None:
    """Check the set against the server's commands, entry by entry in configured order.

    ``commands`` holds every registered and bootstrap command by name. A hybrid server runs
    this before it answers a request, and again after each change to its commands.

    Raises:
        ValueError: An entry that is beyond the cap of 8 (the first one), a meta-tool or
            context tool, repeated, not registered, or not exposed to MCP. The message names it.
    """
    seen: set[str] = set()
    for index, name in enumerate(names):
        if index >= MAX_FIRST_CLASS_TOOLS:
            raise ValueError(
                f"first_class_tools has {len(names)} entries and the cap is "
                f"{MAX_FIRST_CLASS_TOOLS}: '{name}' is the first beyond it. A server that "
                "wants more command tools listed wants tool_strategy='individual' or 'grouped'."
            )
        if name in AFD_META_TOOL_NAMES or name in AFD_CONTEXT_COMMAND_NAMES:
            raise ValueError(
                f"first_class_tools entry '{name}' is a built-in tool that a hybrid server "
                "already lists. Remove it."
            )
        if name in seen:
            raise ValueError(
                f"first_class_tools lists '{name}' more than once. Each tool is listed once."
            )
        seen.add(name)
        command = commands.get(name)
        if command is None:
            raise ValueError(
                f"first_class_tools entry '{name}' is not a registered command. Register it, "
                "or remove it from first_class_tools."
            )
        if not is_mcp_exposed(command):
            raise ValueError(
                f"first_class_tools entry '{name}' is not exposed to MCP (expose.mcp is not "
                "true), and listing it would reveal a private command. Expose it, or remove "
                "it from first_class_tools."
            )
