"""Server module for AFD applications.

This module provides the core server functionality for exposing AFD commands
via MCP (Model Context Protocol) and other transports.

Example:
    >>> from afd.server import create_server, define_command
    >>> from afd import success
    >>> from pydantic import BaseModel
    >>>
    >>> class CreateInput(BaseModel):
    ...     name: str
    ...
    >>> class CreateOutput(BaseModel):
    ...     id: str
    ...     name: str
    >>>
    >>> server = create_server("my-app")
    >>>
    >>> @server.command(
    ...     name="item-create",
    ...     description="Create a new item",
    ...     input_schema=CreateInput,
    ...     output_schema=CreateOutput,
    ... )
    ... async def create_item(input: CreateInput) -> CreateOutput:
    ...     return success(CreateOutput(id="123", name=input.name))

Bootstrap Commands:
    Every AFD server includes bootstrap commands for command discovery:

    >>> # Bootstrap commands are included automatically
    >>> from afd.server.bootstrap import get_bootstrap_commands
    >>>
    >>> # Or access them directly:
    >>> from afd.server.bootstrap import (
    ...     create_afd_help_command,
    ...     create_afd_docs_command,
    ...     create_afd_schema_command,
    ... )
"""

from afd.server.decorators import define_command
from afd.server.factory import create_server, MCPServer
from afd.server.bootstrap import (
    get_bootstrap_commands,
    create_afd_help_command,
    create_afd_docs_command,
    create_afd_schema_command,
)

__all__ = [
    "create_server",
    "define_command",
    "MCPServer",
    # Bootstrap commands
    "get_bootstrap_commands",
    "create_afd_help_command",
    "create_afd_docs_command",
    "create_afd_schema_command",
]
