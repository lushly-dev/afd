"""Small SDK 1/2 import adapter; base installs do not eagerly require MCP."""

from __future__ import annotations


def sdk_types():
    """Return the installed SDK's server/context classes without changing wire tools."""
    try:
        from mcp.server.mcpserver import Context, MCPServer

        return MCPServer, Context
    except ModuleNotFoundError as exc:
        if exc.name not in {"mcp.server.mcpserver", "mcp", "mcp.server"}:
            raise
        from mcp.server.fastmcp import Context, FastMCP

        return FastMCP, Context
