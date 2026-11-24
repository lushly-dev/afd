"""Bootstrap command registry."""

from collections.abc import Callable
from typing import Any

from afd.core.commands import CommandDefinition
from afd.server.bootstrap.afd_context import (
    create_afd_context_enter_command,
    create_afd_context_exit_command,
    create_afd_context_list_command,
)
from afd.server.bootstrap.afd_docs import create_afd_docs_command
from afd.server.bootstrap.afd_help import create_afd_help_command
from afd.server.bootstrap.afd_schema import create_afd_schema_command


def get_bootstrap_commands(
    get_commands: Callable[[], list[CommandDefinition]],
    options: dict[str, Any] | None = None,
) -> list[CommandDefinition]:
    """Get all bootstrap commands for an AFD server.

    ``options["include_discovery"]`` (default True) includes ``afd-help``, ``afd-docs`` and
    ``afd-schema``; ``create_server`` passes its ``bootstrap`` option, so a server leaves them
    out unless it opts in. The context commands follow ``get_contexts`` and ``context_state``.
    """
    options = options or {}
    get_json_schema = options.get("get_json_schema")
    get_contexts = options.get("get_contexts")
    context_state = options.get("context_state")
    tool_strategy = options.get("tool_strategy")
    first_class_tools = options.get("first_class_tools")
    context_fields = options.get("context_fields")
    # afd-help, afd-docs and afd-schema; a server leaves them out unless it opts in (D5).
    include_discovery = options.get("include_discovery", True)

    # The context commands first, then the discovery commands, as TypeScript's server registers
    # them, so grouped and individual lists order them alike (spec/tool-strategies.md, #533).
    commands = []
    if get_contexts and context_state:
        commands.extend(
            [
                create_afd_context_list_command(get_contexts, context_state),
                create_afd_context_enter_command(get_contexts, context_state),
                create_afd_context_exit_command(context_state),
            ]
        )
    if not include_discovery:
        return commands
    commands.extend(
        [
            create_afd_help_command(get_commands, tool_strategy, first_class_tools, context_fields),
            create_afd_docs_command(get_commands),
            create_afd_schema_command(get_commands, get_json_schema),
        ]
    )
    return commands
