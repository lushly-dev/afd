"""Tests for the MCP testing server module."""

import pytest

from afd.testing.mcp.server import (
    JsonRpcRequest,
    McpTestingServer,
    McpTestingServerOptions,
    create_mcp_testing_server,
)
from afd.testing.mcp.tools import (
    McpTool,
    generate_tools,
    get_tool,
)


class TestGenerateTools:
    def test_returns_five_tools(self):
        tools = generate_tools()
        assert len(tools) == 5

    def test_tool_names(self):
        tools = generate_tools()
        names = {t.name for t in tools}
        assert names == {
            'scenario-list',
            'scenario-evaluate',
            'scenario-coverage',
            'scenario-create',
            'scenario-suggest',
        }

    def test_tool_has_schema(self):
        tools = generate_tools()
        for tool in tools:
            assert isinstance(tool, McpTool)
            assert tool.input_schema['type'] == 'object'
            assert 'properties' in tool.input_schema


class TestGetTool:
    def test_existing_tool(self):
        tool = get_tool('scenario-list')
        assert tool is not None
        assert tool.name == 'scenario-list'

    def test_nonexistent_tool(self):
        tool = get_tool('nonexistent')
        assert tool is None


class TestMcpTestingServer:
    @pytest.mark.asyncio
    async def test_initialize(self):
        server = McpTestingServer()
        response = await server.handle_request(
            JsonRpcRequest(jsonrpc='2.0', id=1, method='initialize')
        )
        assert response.error is None
        assert response.result is not None
        assert response.result['protocolVersion'] == '2024-11-05'
        assert response.result['serverInfo']['name'] == '@lushly-dev/afd-testing'

    @pytest.mark.asyncio
    async def test_ping(self):
        server = McpTestingServer()
        response = await server.handle_request(
            JsonRpcRequest(jsonrpc='2.0', id=2, method='ping')
        )
        assert response.error is None
        assert response.result == {}

    @pytest.mark.asyncio
    async def test_tools_list(self):
        server = McpTestingServer()
        response = await server.handle_request(
            JsonRpcRequest(jsonrpc='2.0', id=3, method='tools/list')
        )
        assert response.error is None
        tools = response.result['tools']
        assert len(tools) == 5
        names = {t['name'] for t in tools}
        assert 'scenario-list' in names

    @pytest.mark.asyncio
    async def test_unknown_method(self):
        server = McpTestingServer()
        response = await server.handle_request(
            JsonRpcRequest(jsonrpc='2.0', id=4, method='unknown/method')
        )
        assert response.error is not None
        assert response.error.code == -32601  # METHOD_NOT_FOUND

    @pytest.mark.asyncio
    async def test_tools_call_missing_params(self):
        server = McpTestingServer()
        response = await server.handle_request(
            JsonRpcRequest(jsonrpc='2.0', id=5, method='tools/call', params=None)
        )
        assert response.error is not None

    @pytest.mark.asyncio
    async def test_tools_call_missing_name(self):
        server = McpTestingServer()
        response = await server.handle_request(
            JsonRpcRequest(jsonrpc='2.0', id=6, method='tools/call', params={'arguments': {}})
        )
        assert response.error is not None

    @pytest.mark.asyncio
    async def test_dict_request(self):
        server = McpTestingServer()
        response = await server.handle_request({
            'jsonrpc': '2.0',
            'id': 7,
            'method': 'ping',
        })
        assert response.error is None
        assert response.result == {}

    def test_get_tools(self):
        server = McpTestingServer()
        tools = server.get_tools()
        assert len(tools) == 5

    @pytest.mark.asyncio
    async def test_execute_tool_unknown(self):
        server = McpTestingServer()
        result = await server.execute_tool('nonexistent', {})
        assert result.result['success'] is False
        assert result.result['error']['code'] == 'UNKNOWN_TOOL'

    @pytest.mark.asyncio
    async def test_custom_name(self):
        server = McpTestingServer(McpTestingServerOptions(
            name='custom-server',
            version='1.0.0',
        ))
        assert server.name == 'custom-server'
        assert server.version == '1.0.0'


class TestCreateMcpTestingServer:
    def test_factory_no_args(self):
        server = create_mcp_testing_server()
        assert isinstance(server, McpTestingServer)

    def test_factory_with_options(self):
        server = create_mcp_testing_server(
            McpTestingServerOptions(name='test', version='2.0')
        )
        assert server.name == 'test'

    def test_factory_with_kwargs(self):
        server = create_mcp_testing_server(name='kwarg-server')
        assert server.name == 'kwarg-server'
