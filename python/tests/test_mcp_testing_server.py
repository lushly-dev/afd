"""Tests for the MCP testing server and tool definitions."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from afd.testing.mcp.server import (
    JSON_RPC_ERRORS,
    McpTestingServer,
    create_mcp_testing_server,
)
from afd.testing.mcp.tools import (
    _validate_input,
    create_tool_registry,
    generate_tools,
)


# ==============================================================================
# Helpers
# ==============================================================================

EXPECTED_TOOL_NAMES = [
    "scenario-list",
    "scenario-evaluate",
    "scenario-coverage",
    "scenario-create",
    "scenario-suggest",
]


def _jsonrpc_request(method: str, params=None, req_id=1) -> dict:
    """Build a JSON-RPC 2.0 request dict."""
    req = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        req["params"] = params
    return req


# ==============================================================================
# generate_tools
# ==============================================================================

class TestGenerateTools:
    """Tests for generate_tools()."""

    def test_returns_five_tools(self):
        """Should return exactly 5 tool definitions."""
        tools = generate_tools()
        assert len(tools) == 5

    def test_tool_names(self):
        """Should return tools with the expected names."""
        tools = generate_tools()
        names = [t["name"] for t in tools]
        assert names == EXPECTED_TOOL_NAMES

    def test_each_tool_has_required_fields(self):
        """Each tool should have name, description, and inputSchema."""
        tools = generate_tools()
        for tool in tools:
            assert "name" in tool
            assert "description" in tool
            assert "inputSchema" in tool
            assert isinstance(tool["name"], str)
            assert isinstance(tool["description"], str)
            assert isinstance(tool["inputSchema"], dict)

    def test_input_schemas_are_object_type(self):
        """Each inputSchema should have type 'object' with properties."""
        tools = generate_tools()
        for tool in tools:
            schema = tool["inputSchema"]
            assert schema["type"] == "object"
            assert "properties" in schema

    def test_scenario_coverage_requires_known_commands(self):
        """scenario-coverage should require knownCommands."""
        tools = generate_tools()
        coverage = next(t for t in tools if t["name"] == "scenario-coverage")
        assert "required" in coverage["inputSchema"]
        assert "knownCommands" in coverage["inputSchema"]["required"]

    def test_scenario_create_requires_name_and_job(self):
        """scenario-create should require name and job."""
        tools = generate_tools()
        create = next(t for t in tools if t["name"] == "scenario-create")
        assert "required" in create["inputSchema"]
        assert "name" in create["inputSchema"]["required"]
        assert "job" in create["inputSchema"]["required"]

    def test_scenario_suggest_requires_context(self):
        """scenario-suggest should require context."""
        tools = generate_tools()
        suggest = next(t for t in tools if t["name"] == "scenario-suggest")
        assert "required" in suggest["inputSchema"]
        assert "context" in suggest["inputSchema"]["required"]

    def test_scenario_list_has_no_required_fields(self):
        """scenario-list should not have any required fields."""
        tools = generate_tools()
        list_tool = next(t for t in tools if t["name"] == "scenario-list")
        assert "required" not in list_tool["inputSchema"]


# ==============================================================================
# _validate_input
# ==============================================================================

class TestValidateInput:
    """Tests for _validate_input()."""

    def test_returns_empty_dict_for_none(self):
        """Should return empty dict when input is None."""
        result = _validate_input(None)
        assert result == {}

    def test_returns_dict_as_is(self):
        """Should return the dict unchanged when valid."""
        data = {"key": "value"}
        result = _validate_input(data)
        assert result == data

    def test_raises_on_non_dict(self):
        """Should raise ValueError for non-dict input."""
        with pytest.raises(ValueError, match="Input must be an object"):
            _validate_input("not a dict")

    def test_raises_on_missing_required_field(self):
        """Should raise ValueError for missing required field."""
        with pytest.raises(ValueError, match="Missing required field: name"):
            _validate_input({"other": "value"}, ["name"])

    def test_raises_on_none_required_field(self):
        """Should raise ValueError when a required field is None."""
        with pytest.raises(ValueError, match="Missing required field: name"):
            _validate_input({"name": None}, ["name"])

    def test_passes_with_all_required_fields(self):
        """Should succeed when all required fields are present."""
        data = {"name": "test", "job": "do something"}
        result = _validate_input(data, ["name", "job"])
        assert result == data

    def test_no_required_fields(self):
        """Should succeed with no required fields specified."""
        data = {"anything": 123}
        result = _validate_input(data, [])
        assert result == data


# ==============================================================================
# McpTestingServer creation
# ==============================================================================

class TestMcpTestingServerCreation:
    """Tests for McpTestingServer instantiation."""

    def test_default_values(self):
        """Should use default name, version, and flags."""
        server = McpTestingServer()
        assert server.name == "@lushly-dev/afd-testing"
        assert server.version == "0.1.0"
        assert server._verbose is False

    def test_custom_values(self):
        """Should accept custom name, version, and verbose flag."""
        handler = AsyncMock()
        server = McpTestingServer(
            name="custom-server",
            version="2.0.0",
            command_handler=handler,
            cwd="/tmp/test",
            verbose=True,
        )
        assert server.name == "custom-server"
        assert server.version == "2.0.0"
        assert server._verbose is True

    def test_tools_are_populated(self):
        """Server should have the 5 generated tools on init."""
        server = McpTestingServer()
        assert len(server._tools) == 5

    def test_registry_is_populated(self):
        """Server should have a registry with all 5 tool handlers."""
        server = McpTestingServer()
        assert len(server._registry) == 5
        for name in EXPECTED_TOOL_NAMES:
            assert name in server._registry


# ==============================================================================
# handle_request: initialize
# ==============================================================================

class TestHandleRequestInitialize:
    """Tests for the initialize JSON-RPC method."""

    @pytest.mark.asyncio
    async def test_returns_protocol_version(self):
        """Should return protocolVersion in result."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("initialize"))
        assert response["jsonrpc"] == "2.0"
        assert response["id"] == 1
        assert "error" not in response
        result = response["result"]
        assert result["protocolVersion"] == "2024-11-05"

    @pytest.mark.asyncio
    async def test_returns_server_info(self):
        """Should return serverInfo with name and version."""
        server = McpTestingServer(name="my-server", version="3.0.0")
        response = await server.handle_request(_jsonrpc_request("initialize"))
        info = response["result"]["serverInfo"]
        assert info["name"] == "my-server"
        assert info["version"] == "3.0.0"

    @pytest.mark.asyncio
    async def test_returns_capabilities(self):
        """Should return capabilities with tools."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("initialize"))
        capabilities = response["result"]["capabilities"]
        assert "tools" in capabilities
        assert capabilities["tools"]["listChanged"] is False

    @pytest.mark.asyncio
    async def test_preserves_request_id(self):
        """Should echo back the request ID."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("initialize", req_id=42))
        assert response["id"] == 42


# ==============================================================================
# handle_request: ping
# ==============================================================================

class TestHandleRequestPing:
    """Tests for the ping JSON-RPC method."""

    @pytest.mark.asyncio
    async def test_returns_empty_result(self):
        """Should return an empty dict as result."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("ping"))
        assert response["result"] == {}

    @pytest.mark.asyncio
    async def test_no_error(self):
        """Should not contain an error field."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("ping"))
        assert "error" not in response


# ==============================================================================
# handle_request: tools/list
# ==============================================================================

class TestHandleRequestToolsList:
    """Tests for the tools/list JSON-RPC method."""

    @pytest.mark.asyncio
    async def test_returns_all_five_tools(self):
        """Should return all 5 tools in the result."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("tools/list"))
        tools = response["result"]["tools"]
        assert len(tools) == 5

    @pytest.mark.asyncio
    async def test_tool_names_match(self):
        """Should return tools with the expected names."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("tools/list"))
        names = [t["name"] for t in response["result"]["tools"]]
        assert names == EXPECTED_TOOL_NAMES

    @pytest.mark.asyncio
    async def test_tools_have_description_and_schema(self):
        """Each tool in the list should have description and inputSchema."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("tools/list"))
        for tool in response["result"]["tools"]:
            assert "name" in tool
            assert "description" in tool
            assert "inputSchema" in tool


# ==============================================================================
# handle_request: tools/call with valid tool
# ==============================================================================

class TestHandleRequestToolsCallValid:
    """Tests for tools/call with a valid tool name."""

    @pytest.mark.asyncio
    async def test_calls_scenario_list_with_tmp_dir(self, tmp_path):
        """Should invoke scenario-list and return content array."""
        server = McpTestingServer()
        params = {
            "name": "scenario-list",
            "arguments": {"directory": str(tmp_path)},
        }
        response = await server.handle_request(_jsonrpc_request("tools/call", params))
        assert "error" not in response
        result = response["result"]
        assert "content" in result
        assert len(result["content"]) == 1
        assert result["content"][0]["type"] == "text"
        # The text should be parseable JSON
        parsed = json.loads(result["content"][0]["text"])
        assert "success" in parsed

    @pytest.mark.asyncio
    async def test_content_is_json_string(self, tmp_path):
        """The content text should be valid JSON."""
        server = McpTestingServer()
        params = {
            "name": "scenario-list",
            "arguments": {"directory": str(tmp_path)},
        }
        response = await server.handle_request(_jsonrpc_request("tools/call", params))
        text = response["result"]["content"][0]["text"]
        data = json.loads(text)
        assert data["success"] is True
        assert data["data"]["total"] == 0
        assert data["data"]["scenarios"] == []

    @pytest.mark.asyncio
    async def test_is_error_false_on_success(self, tmp_path):
        """isError should be False when the tool succeeds."""
        server = McpTestingServer()
        params = {
            "name": "scenario-list",
            "arguments": {"directory": str(tmp_path)},
        }
        response = await server.handle_request(_jsonrpc_request("tools/call", params))
        assert response["result"]["isError"] is False

    @pytest.mark.asyncio
    async def test_tools_call_with_mocked_handler(self):
        """Should call through to the registry handler for the named tool."""
        mock_result = {"success": True, "data": {"mocked": True}}
        mock_handler = AsyncMock(return_value=mock_result)

        server = McpTestingServer()
        server._registry["scenario-list"] = mock_handler

        params = {"name": "scenario-list", "arguments": {"directory": "/fake"}}
        response = await server.handle_request(_jsonrpc_request("tools/call", params))

        mock_handler.assert_awaited_once_with({"directory": "/fake"})
        assert "error" not in response
        content_text = response["result"]["content"][0]["text"]
        parsed = json.loads(content_text)
        assert parsed["success"] is True
        assert parsed["data"]["mocked"] is True


# ==============================================================================
# handle_request: tools/call with missing params
# ==============================================================================

class TestHandleRequestToolsCallMissingParams:
    """Tests for tools/call with missing or invalid params."""

    @pytest.mark.asyncio
    async def test_missing_params_entirely(self):
        """Should return INVALID_PARAMS when params is absent."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("tools/call"))
        assert "error" in response
        assert response["error"]["code"] == JSON_RPC_ERRORS["INVALID_PARAMS"]

    @pytest.mark.asyncio
    async def test_params_is_none(self):
        """Should return INVALID_PARAMS when params is None."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("tools/call", None))
        assert "error" in response
        assert response["error"]["code"] == JSON_RPC_ERRORS["INVALID_PARAMS"]

    @pytest.mark.asyncio
    async def test_params_not_dict(self):
        """Should return INVALID_PARAMS when params is not a dict."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("tools/call", "bad"))
        assert "error" in response
        assert response["error"]["code"] == JSON_RPC_ERRORS["INVALID_PARAMS"]

    @pytest.mark.asyncio
    async def test_missing_tool_name(self):
        """Should return INVALID_PARAMS when tool name is missing."""
        server = McpTestingServer()
        params = {"arguments": {}}
        response = await server.handle_request(_jsonrpc_request("tools/call", params))
        assert "error" in response
        assert response["error"]["code"] == JSON_RPC_ERRORS["INVALID_PARAMS"]
        assert "name" in response["error"]["message"].lower()

    @pytest.mark.asyncio
    async def test_tool_name_not_string(self):
        """Should return INVALID_PARAMS when tool name is not a string."""
        server = McpTestingServer()
        params = {"name": 123, "arguments": {}}
        response = await server.handle_request(_jsonrpc_request("tools/call", params))
        assert "error" in response
        assert response["error"]["code"] == JSON_RPC_ERRORS["INVALID_PARAMS"]


# ==============================================================================
# handle_request: tools/call with unknown tool
# ==============================================================================

class TestHandleRequestToolsCallUnknownTool:
    """Tests for tools/call with an unknown tool name."""

    @pytest.mark.asyncio
    async def test_returns_error_result_for_unknown_tool(self):
        """Should return an error result (not JSON-RPC error) for unknown tool."""
        server = McpTestingServer()
        params = {"name": "nonexistent-tool", "arguments": {}}
        response = await server.handle_request(_jsonrpc_request("tools/call", params))
        # This goes through execute_tool which returns an error result, not a JSON-RPC error
        assert "error" not in response
        result = response["result"]
        assert result["isError"] is True
        content_text = result["content"][0]["text"]
        parsed = json.loads(content_text)
        assert parsed["success"] is False
        assert parsed["error"]["code"] == "UNKNOWN_TOOL"
        assert "nonexistent-tool" in parsed["error"]["message"]

    @pytest.mark.asyncio
    async def test_error_includes_suggestion(self):
        """Should include available tools in the error suggestion."""
        server = McpTestingServer()
        params = {"name": "no-such-tool", "arguments": {}}
        response = await server.handle_request(_jsonrpc_request("tools/call", params))
        content_text = response["result"]["content"][0]["text"]
        parsed = json.loads(content_text)
        suggestion = parsed["error"]["suggestion"]
        for name in EXPECTED_TOOL_NAMES:
            assert name in suggestion


# ==============================================================================
# handle_request: unknown method
# ==============================================================================

class TestHandleRequestUnknownMethod:
    """Tests for unrecognized JSON-RPC methods."""

    @pytest.mark.asyncio
    async def test_returns_method_not_found(self):
        """Should return METHOD_NOT_FOUND error code."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("unknown/method"))
        assert "error" in response
        assert response["error"]["code"] == JSON_RPC_ERRORS["METHOD_NOT_FOUND"]

    @pytest.mark.asyncio
    async def test_error_message_includes_method(self):
        """Error message should reference the unknown method name."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("foo/bar"))
        assert "foo/bar" in response["error"]["message"]

    @pytest.mark.asyncio
    async def test_preserves_id_on_error(self):
        """Should preserve request ID even on error responses."""
        server = McpTestingServer()
        response = await server.handle_request(_jsonrpc_request("nope", req_id=99))
        assert response["id"] == 99

    @pytest.mark.asyncio
    async def test_empty_method_returns_method_not_found(self):
        """An empty method string should return METHOD_NOT_FOUND."""
        server = McpTestingServer()
        response = await server.handle_request(
            {"jsonrpc": "2.0", "id": 1, "method": ""}
        )
        assert "error" in response
        assert response["error"]["code"] == JSON_RPC_ERRORS["METHOD_NOT_FOUND"]


# ==============================================================================
# get_tools()
# ==============================================================================

class TestGetTools:
    """Tests for McpTestingServer.get_tools()."""

    def test_returns_list(self):
        """Should return a list."""
        server = McpTestingServer()
        tools = server.get_tools()
        assert isinstance(tools, list)

    def test_returns_five_tools(self):
        """Should return all 5 tools."""
        server = McpTestingServer()
        tools = server.get_tools()
        assert len(tools) == 5

    def test_tool_names(self):
        """Should return tools with correct names."""
        server = McpTestingServer()
        names = [t["name"] for t in server.get_tools()]
        assert names == EXPECTED_TOOL_NAMES

    def test_matches_generate_tools(self):
        """Should return the same data as generate_tools()."""
        server = McpTestingServer()
        assert server.get_tools() == generate_tools()


# ==============================================================================
# execute_tool()
# ==============================================================================

class TestExecuteTool:
    """Tests for McpTestingServer.execute_tool()."""

    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error(self):
        """Should return error dict for an unknown tool."""
        server = McpTestingServer()
        result = await server.execute_tool("nonexistent", {})
        assert result["success"] is False
        assert result["error"]["code"] == "UNKNOWN_TOOL"
        assert "nonexistent" in result["error"]["message"]

    @pytest.mark.asyncio
    async def test_unknown_tool_has_suggestion(self):
        """Error should include a suggestion listing available tools."""
        server = McpTestingServer()
        result = await server.execute_tool("bad-name", {})
        suggestion = result["error"]["suggestion"]
        assert "scenario-list" in suggestion
        assert "scenario-evaluate" in suggestion

    @pytest.mark.asyncio
    async def test_known_tool_delegates_to_handler(self):
        """Should delegate to the registered handler for a known tool."""
        mock_result = {"success": True, "data": "handled"}
        mock_handler = AsyncMock(return_value=mock_result)

        server = McpTestingServer()
        server._registry["scenario-list"] = mock_handler

        result = await server.execute_tool("scenario-list", {"directory": "/tmp"})
        mock_handler.assert_awaited_once_with({"directory": "/tmp"})
        assert result == mock_result

    @pytest.mark.asyncio
    async def test_scenario_list_with_empty_dir(self, tmp_path):
        """Calling scenario-list on an empty directory should succeed."""
        server = McpTestingServer()
        result = await server.execute_tool(
            "scenario-list", {"directory": str(tmp_path)}
        )
        assert result["success"] is True
        assert result["data"]["total"] == 0


# ==============================================================================
# create_mcp_testing_server factory
# ==============================================================================

class TestCreateMcpTestingServer:
    """Tests for the create_mcp_testing_server factory function."""

    def test_returns_mcp_testing_server(self):
        """Should return an McpTestingServer instance."""
        server = create_mcp_testing_server()
        assert isinstance(server, McpTestingServer)

    def test_default_values(self):
        """Should use default name and version."""
        server = create_mcp_testing_server()
        assert server.name == "@lushly-dev/afd-testing"
        assert server.version == "0.1.0"

    def test_custom_values(self):
        """Should pass through custom name and version."""
        server = create_mcp_testing_server(
            name="custom", version="9.9.9", verbose=True
        )
        assert server.name == "custom"
        assert server.version == "9.9.9"
        assert server._verbose is True

    def test_with_command_handler(self):
        """Should accept a command handler."""
        handler = AsyncMock()
        server = create_mcp_testing_server(command_handler=handler)
        assert isinstance(server, McpTestingServer)
        # The server should have been created without error
        assert len(server.get_tools()) == 5

    def test_with_cwd(self):
        """Should accept a cwd parameter."""
        server = create_mcp_testing_server(cwd="/some/path")
        assert isinstance(server, McpTestingServer)


# ==============================================================================
# JSON-RPC error codes
# ==============================================================================

class TestJsonRpcErrors:
    """Tests for the JSON_RPC_ERRORS constants."""

    def test_parse_error(self):
        assert JSON_RPC_ERRORS["PARSE_ERROR"] == -32700

    def test_invalid_request(self):
        assert JSON_RPC_ERRORS["INVALID_REQUEST"] == -32600

    def test_method_not_found(self):
        assert JSON_RPC_ERRORS["METHOD_NOT_FOUND"] == -32601

    def test_invalid_params(self):
        assert JSON_RPC_ERRORS["INVALID_PARAMS"] == -32602

    def test_internal_error(self):
        assert JSON_RPC_ERRORS["INTERNAL_ERROR"] == -32603


# ==============================================================================
# Internal error handling
# ==============================================================================

class TestInternalErrorHandling:
    """Tests for internal error handling in handle_request."""

    @pytest.mark.asyncio
    async def test_handler_exception_returns_internal_error(self):
        """An exception in a tool handler should return INTERNAL_ERROR."""
        server = McpTestingServer()
        server._registry["scenario-list"] = AsyncMock(
            side_effect=RuntimeError("boom")
        )
        params = {"name": "scenario-list", "arguments": {}}
        response = await server.handle_request(_jsonrpc_request("tools/call", params))
        assert "error" in response
        assert response["error"]["code"] == JSON_RPC_ERRORS["INTERNAL_ERROR"]
        assert "boom" in response["error"]["message"]

    @pytest.mark.asyncio
    async def test_missing_id_in_request(self):
        """Should handle requests without an id field gracefully."""
        server = McpTestingServer()
        response = await server.handle_request({"jsonrpc": "2.0", "method": "ping"})
        assert response["id"] is None
        assert response["result"] == {}

    @pytest.mark.asyncio
    async def test_null_id_preserved(self):
        """Should preserve a null id in the response."""
        server = McpTestingServer()
        response = await server.handle_request(
            {"jsonrpc": "2.0", "id": None, "method": "ping"}
        )
        assert response["id"] is None


# ==============================================================================
# create_tool_registry
# ==============================================================================

class TestCreateToolRegistry:
    """Tests for the create_tool_registry function."""

    def test_returns_dict_with_five_entries(self):
        """Should return a dict with 5 tool handlers."""
        registry = create_tool_registry()
        assert isinstance(registry, dict)
        assert len(registry) == 5

    def test_all_expected_keys_present(self):
        """Should contain all expected tool names."""
        registry = create_tool_registry()
        for name in EXPECTED_TOOL_NAMES:
            assert name in registry

    def test_handlers_are_callable(self):
        """Each handler should be callable."""
        registry = create_tool_registry()
        for name, handler in registry.items():
            assert callable(handler), f"Handler for {name} is not callable"

    @pytest.mark.asyncio
    async def test_evaluate_without_handler_returns_error(self):
        """scenario-evaluate should return error when no command_handler set."""
        registry = create_tool_registry(command_handler=None)
        result = await registry["scenario-evaluate"]({})
        assert result["success"] is False
        assert result["error"]["code"] == "HANDLER_NOT_CONFIGURED"
