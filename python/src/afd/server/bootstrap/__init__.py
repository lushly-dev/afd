"""Bootstrap commands for AFD servers.

Bootstrap commands are built-in commands that every AFD server provides:
- afd-help: List all available commands with tags and grouping
- afd-docs: Generate markdown documentation for commands
- afd-schema: Export JSON schemas for all commands

Example:
    >>> from afd.server import create_server
    >>> from afd.server.bootstrap import get_bootstrap_commands
    >>>
    >>> server = create_server("my-app")
    >>> # Bootstrap commands are automatically registered
    >>>
    >>> # Or manually get them:
    >>> commands = get_bootstrap_commands(server.list_commands)
"""

from afd.server.bootstrap.registry import get_bootstrap_commands
from afd.server.bootstrap.afd_help import create_afd_help_command
from afd.server.bootstrap.afd_docs import create_afd_docs_command
from afd.server.bootstrap.afd_schema import create_afd_schema_command

__all__ = [
    "get_bootstrap_commands",
    "create_afd_help_command",
    "create_afd_docs_command",
    "create_afd_schema_command",
]
