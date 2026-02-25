"""Tests for MCP testing server tool generation, validation, creation, and basic requests."""

import pytest

from afd.testing.mcp.server import McpTestingServer
from afd.testing.mcp.tools import (
    _validate_input,
    generate_tools,
)
from unittest.mock import AsyncMock


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
