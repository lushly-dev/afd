"""Tests for MCP testing server tool calls, execution, factory, and error handling."""

import json
from unittest.mock import AsyncMock
from unittest.mock import patch

import pytest

from afd.testing.mcp.server import (
    JSON_RPC_ERRORS,
    McpTestingServer,
    create_mcp_testing_server,
)
from afd.testing.mcp.tools import (
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

    @pytest.mark.asyncio
    async def test_evaluate_maps_stop_on_failure_alias(self):
        """scenario-evaluate should map stopOnFailure to fail_fast."""
        registry = create_tool_registry(command_handler=AsyncMock())

        async def fake_evaluate(input):
            return {"success": True, "data": {"fail_fast": input.get("fail_fast")}}

        with patch("afd.testing.commands.evaluate.scenario_evaluate", side_effect=fake_evaluate):
            result = await registry["scenario-evaluate"]({"stopOnFailure": True})

        assert result["success"] is True
        assert result["data"]["fail_fast"] is True

    @pytest.mark.asyncio
    async def test_coverage_accepts_known_commands_alias(self):
        """scenario-coverage should accept known_commands alias."""
        registry = create_tool_registry()
        result = await registry["scenario-coverage"]({"known_commands": ["todo-list"]})
        assert result["success"] is True
