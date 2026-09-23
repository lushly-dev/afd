"""Todo MCP server built with the afd Python package.

It exposes the same eleven ``todo-*`` commands as the TypeScript backend
(``backends/typescript/src/commands``), with the same inputs, limits, error
codes and result shapes, so both pass ``spec/test-cases.json``.

Run it over stdio::

    uv run --project packages/examples/todo/backends/python todo-server
"""

from __future__ import annotations

import logging
import sys

from afd.server import MCPServer, create_server

from todo_backend.batch_commands import register_batch_commands
from todo_backend.commands import register_commands
from todo_backend.store import MemoryStore, create_store


def create_app(store: MemoryStore) -> MCPServer:
    """Create the todo MCP server with its commands bound to ``store``."""

    server = create_server(
        name="todo-app",
        version="1.0.0",
        description="A todo list manager demonstrating AFD patterns",
    )
    register_commands(server, store)
    register_batch_commands(server, store)
    return server


def main() -> None:
    """Run the todo MCP server over stdio."""

    # stdout carries JSON-RPC over stdio, so logs must go to stderr.
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    create_app(create_store()).run()


if __name__ == "__main__":
    main()
