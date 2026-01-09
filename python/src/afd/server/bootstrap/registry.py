"""Bootstrap commands registry.

Provides a function to get all bootstrap commands for an AFD server.
"""

from typing import Any, Callable, Dict, List, Optional

from afd.core.commands import CommandDefinition
from afd.server.bootstrap.afd_help import create_afd_help_command
from afd.server.bootstrap.afd_docs import create_afd_docs_command
from afd.server.bootstrap.afd_schema import create_afd_schema_command


def get_bootstrap_commands(
    get_commands: Callable[[], List[CommandDefinition]],
    options: Optional[Dict[str, Any]] = None,
) -> List[CommandDefinition]:
    """Get all bootstrap commands for an AFD server.

    Bootstrap commands provide built-in functionality for command discovery
    and documentation:
    - afd-help: List all available commands with filtering and grouping
    - afd-docs: Generate markdown documentation for commands
    - afd-schema: Export JSON schemas for all commands

    Args:
        get_commands: Function to get all user-defined commands.
        options: Optional configuration:
            - get_json_schema: Function to get JSON schema for a command.

    Returns:
        List of bootstrap command definitions.

    Example:
        >>> from afd.server.bootstrap import get_bootstrap_commands
        >>> from afd.core.commands import create_command_registry
        >>>
        >>> registry = create_command_registry()
        >>> # ... register user commands ...
        >>>
        >>> bootstrap = get_bootstrap_commands(registry.list)
        >>> for cmd in bootstrap:
        ...     registry.register(cmd)
    """
    options = options or {}
    get_json_schema = options.get("get_json_schema")

    return [
        create_afd_help_command(get_commands),
        create_afd_docs_command(get_commands),
        create_afd_schema_command(get_commands, get_json_schema),
    ]
