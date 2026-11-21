"""Bootstrap commands for AFD servers.

Bootstrap commands are built-in commands a server registers with ``bootstrap=True``
(the context commands, with ``contexts``):
- afd-help: List all available commands with tags and grouping
- afd-docs: Generate markdown documentation for commands
- afd-schema: Export JSON schemas for all commands
- afd-context-list / enter / exit: Manage active tool contexts when configured

Example:
    >>> from afd.server import create_server
    >>> from afd.server.bootstrap import get_bootstrap_commands
    >>>
    >>> server = create_server("my-app", bootstrap=True)
    >>> # afd-help, afd-docs and afd-schema are registered (off by default)
    >>>
    >>> # Or manually get them:
    >>> commands = get_bootstrap_commands(server.list_commands)
"""

from afd.server.bootstrap.registry import get_bootstrap_commands
from afd.server.bootstrap.afd_help import create_afd_help_command
from afd.server.bootstrap.afd_docs import create_afd_docs_command
from afd.server.bootstrap.afd_schema import create_afd_schema_command
from afd.server.bootstrap.afd_context import (
    ContextState,
    create_context_state,
    create_afd_context_list_command,
    create_afd_context_enter_command,
    create_afd_context_exit_command,
)
from afd.server.types import ContextConfig

__all__ = [
    "get_bootstrap_commands",
    "create_afd_help_command",
    "create_afd_docs_command",
    "create_afd_schema_command",
    "ContextConfig",
    "ContextState",
    "create_context_state",
    "create_afd_context_list_command",
    "create_afd_context_enter_command",
    "create_afd_context_exit_command",
]
