"""
MCP testing server for AFD JTBD scenarios.

Exposes scenario commands as MCP tools for AI agent integration.
"""

from afd.testing.mcp.server import (
	McpTestingServer,
	create_mcp_testing_server,
	run_stdio_server,
)
from afd.testing.mcp.tools import generate_tools

__all__ = [
	"McpTestingServer",
	"create_mcp_testing_server",
	"generate_tools",
	"run_stdio_server",
]
