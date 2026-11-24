"""Small SDK 1/2 import adapter; base installs do not eagerly require MCP."""

from __future__ import annotations

from typing import Any


def sdk_types() -> tuple[Any, Any]:
    """Return the installed SDK's server/context classes without changing wire tools."""
    try:
        from mcp.server.mcpserver import Context, MCPServer

        return MCPServer, Context
    except ModuleNotFoundError as exc:
        if exc.name not in {"mcp.server.mcpserver", "mcp", "mcp.server"}:
            raise
        import importlib

        fastmcp = importlib.import_module("mcp.server.fastmcp")
        return fastmcp.FastMCP, fastmcp.Context
