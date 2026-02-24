"""
MCP integration for AFD testing.

Provides agent hints, MCP tool definitions, and an MCP testing server
for exposing scenario commands to AI agents.
"""

from afd.testing.mcp.hints import (
    AgentEnhancedResult,
    AgentHints,
    enhance_with_agent_hints,
    generate_agent_hints,
    generate_coverage_hints,
    generate_test_report_hints,
)
from afd.testing.mcp.server import (
    JsonRpcError,
    JsonRpcRequest,
    JsonRpcResponse,
    McpTestingServer,
    McpTestingServerOptions,
    create_mcp_testing_server,
)
from afd.testing.mcp.tools import (
    McpTool,
    RegisteredTool,
    ToolExecutionContext,
    create_tool_registry,
    execute_tool,
    generate_tools,
    get_tool,
)

__all__ = [
    # Hints
    'AgentHints',
    'AgentEnhancedResult',
    'generate_agent_hints',
    'generate_test_report_hints',
    'generate_coverage_hints',
    'enhance_with_agent_hints',
    # Server
    'JsonRpcRequest',
    'JsonRpcResponse',
    'JsonRpcError',
    'McpTestingServerOptions',
    'McpTestingServer',
    'create_mcp_testing_server',
    # Tools
    'McpTool',
    'RegisteredTool',
    'ToolExecutionContext',
    'generate_tools',
    'create_tool_registry',
    'get_tool',
    'execute_tool',
]
