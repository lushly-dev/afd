"""
MCP Server for AFD testing.

Exposes JTBD scenario commands as MCP tools for AI agent integration.
Follows JSON-RPC 2.0 protocol.

Example:
    >>> from afd.testing.mcp.server import create_mcp_testing_server
    >>>
    >>> server = create_mcp_testing_server(
    ...     name='testing-server',
    ...     command_handler=my_handler,
    ... )
    >>>
    >>> response = await server.handle_request({
    ...     'jsonrpc': '2.0',
    ...     'id': 1,
    ...     'method': 'tools/list',
    ... })
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from afd.testing.mcp.hints import AgentEnhancedResult
from afd.testing.mcp.tools import (
    McpTool,
    ToolExecutionContext,
    create_tool_registry,
    execute_tool,
    generate_tools,
)


@dataclass
class JsonRpcRequest:
    """JSON-RPC 2.0 Request.

    Attributes:
        jsonrpc: Protocol version (always "2.0").
        method: Method name.
        id: Request id (optional).
        params: Parameters (optional).
    """

    jsonrpc: str
    method: str
    id: str | int | None = None
    params: Any = None


@dataclass
class JsonRpcError:
    """JSON-RPC 2.0 Error.

    Attributes:
        code: Error code.
        message: Error message.
        data: Additional error data.
    """

    code: int
    message: str
    data: Any = None


@dataclass
class JsonRpcResponse:
    """JSON-RPC 2.0 Response.

    Attributes:
        jsonrpc: Protocol version.
        id: Request id.
        result: Success result.
        error: Error details.
    """

    jsonrpc: str = '2.0'
    id: str | int | None = None
    result: Any = None
    error: JsonRpcError | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dict for serialization."""
        d: dict[str, Any] = {'jsonrpc': self.jsonrpc}
        if self.id is not None:
            d['id'] = self.id
        if self.error is not None:
            d['error'] = {'code': self.error.code, 'message': self.error.message}
            if self.error.data is not None:
                d['error']['data'] = self.error.data
        else:
            d['result'] = self.result
        return d


@dataclass
class McpTestingServerOptions:
    """MCP Server configuration options.

    Attributes:
        name: Server name for identification.
        version: Server version.
        command_handler: Command handler for executing scenario commands.
        cwd: Working directory for file operations.
        verbose: Enable verbose logging.
    """

    name: str = '@lushly-dev/afd-testing'
    version: str = '0.1.0'
    command_handler: Callable[..., Any] | None = None
    cwd: str | None = None
    verbose: bool = False


# JSON-RPC error codes
_PARSE_ERROR = -32700
_INVALID_REQUEST = -32600
_METHOD_NOT_FOUND = -32601
_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


class McpTestingServer:
    """MCP server exposing scenario commands as tools.

    Example:
        >>> server = McpTestingServer(McpTestingServerOptions(name='test'))
        >>> response = await server.handle_request(JsonRpcRequest(
        ...     jsonrpc='2.0', id=1, method='tools/list'
        ... ))
        >>> tools = response.result['tools']
    """

    def __init__(self, options: McpTestingServerOptions | None = None) -> None:
        opts = options or McpTestingServerOptions()
        self.name = opts.name
        self.version = opts.version
        self._verbose = opts.verbose

        context = ToolExecutionContext(
            command_handler=opts.command_handler,
            cwd=opts.cwd,
        )
        self._registry = create_tool_registry(context)
        self._tools = generate_tools()

    async def handle_request(self, request: JsonRpcRequest | dict[str, Any]) -> JsonRpcResponse:
        """Handle a JSON-RPC request.

        Args:
            request: JSON-RPC request (object or dict).

        Returns:
            JSON-RPC response.
        """
        if isinstance(request, dict):
            request = JsonRpcRequest(
                jsonrpc=request.get('jsonrpc', '2.0'),
                id=request.get('id'),
                method=request.get('method', ''),
                params=request.get('params'),
            )

        try:
            result: Any

            if request.method == 'initialize':
                result = self._handle_initialize()
            elif request.method == 'ping':
                result = {}
            elif request.method == 'tools/list':
                result = self._handle_tools_list()
            elif request.method == 'tools/call':
                result = await self._handle_tools_call(request.params)
            else:
                return JsonRpcResponse(
                    id=request.id,
                    error=JsonRpcError(_METHOD_NOT_FOUND, f'Unknown method: {request.method}'),
                )

            return JsonRpcResponse(id=request.id, result=result)

        except Exception as exc:
            return JsonRpcResponse(
                id=request.id,
                error=JsonRpcError(_INTERNAL_ERROR, str(exc)),
            )

    def get_tools(self) -> list[McpTool]:
        """Get all available tools.

        Returns:
            List of McpTool definitions.
        """
        return self._tools

    async def execute_tool(self, name: str, input: Any) -> AgentEnhancedResult:
        """Execute a tool by name.

        Args:
            name: Tool name.
            input: Tool input arguments.

        Returns:
            AgentEnhancedResult with result and hints.
        """
        return await execute_tool(self._registry, name, input)

    def _handle_initialize(self) -> dict[str, Any]:
        """Handle initialize request."""
        return {
            'protocolVersion': '2024-11-05',
            'serverInfo': {
                'name': self.name,
                'version': self.version,
            },
            'capabilities': {
                'tools': {'listChanged': False},
            },
        }

    def _handle_tools_list(self) -> dict[str, Any]:
        """Handle tools/list request."""
        return {
            'tools': [
                {
                    'name': tool.name,
                    'description': tool.description,
                    'inputSchema': tool.input_schema,
                }
                for tool in self._tools
            ],
        }

    async def _handle_tools_call(self, params: Any) -> dict[str, Any]:
        """Handle tools/call request."""
        if not params or not isinstance(params, dict):
            raise ValueError('Missing params for tools/call')

        tool_name = params.get('name')
        tool_args = params.get('arguments', {})

        if not tool_name or not isinstance(tool_name, str):
            raise ValueError('Missing or invalid tool name')

        result = await execute_tool(self._registry, tool_name, tool_args)

        return {
            'content': [
                {
                    'type': 'text',
                    'text': json.dumps(result.result, indent=2, default=str),
                },
            ],
            'isError': not result.result.get('success', False),
        }


def create_mcp_testing_server(
    options: McpTestingServerOptions | None = None,
    **kwargs: Any,
) -> McpTestingServer:
    """Create an MCP server for testing tools.

    Args:
        options: Full options object.
        **kwargs: Individual option fields (name, version, command_handler, cwd, verbose).

    Returns:
        A configured McpTestingServer.
    """
    if options is None:
        options = McpTestingServerOptions(**kwargs)
    return McpTestingServer(options)
