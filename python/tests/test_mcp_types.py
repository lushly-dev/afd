"""Tests for afd.core.mcp_types module."""

import json

import pytest
from pydantic import ValidationError

from afd.core.mcp_types import (
    JSONRPC_VERSION,
    MCP_PROTOCOL_VERSION,
    ClientInfo,
    EmbeddedResource,
    ImageContent,
    InitializeParams,
    InitializeResult,
    JsonRpcError,
    McpErrorResponse,
    McpRequest,
    McpResponse,
    ServerInfo,
    TextContent,
    ToolCallParams,
    ToolDefinition,
    ToolInputSchema,
    ToolResult,
    embedded_resource,
    image_content,
    initialize_params,
    initialize_result,
    mcp_error_response,
    mcp_request,
    mcp_response,
    text_content,
    tool_call_params,
    tool_definition,
    tool_result,
)


# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestConstants:
    """Tests for protocol constants."""

    def test_mcp_protocol_version(self):
        assert MCP_PROTOCOL_VERSION == "2024-11-05"

    def test_jsonrpc_version(self):
        assert JSONRPC_VERSION == "2.0"


# ═══════════════════════════════════════════════════════════════════════════════
# CONTENT TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class TestTextContent:
    """Tests for TextContent model."""

    def test_basic_text(self):
        tc = TextContent(text="hello")
        assert tc.type == "text"
        assert tc.text == "hello"

    def test_json_text(self):
        payload = json.dumps({"success": True, "data": {"id": "123"}})
        tc = TextContent(text=payload)
        parsed = json.loads(tc.text)
        assert parsed["success"] is True

    def test_empty_text(self):
        tc = TextContent(text="")
        assert tc.text == ""

    def test_frozen(self):
        tc = TextContent(text="hello")
        with pytest.raises(ValidationError):
            tc.text = "world"

    def test_serialization(self):
        tc = TextContent(text="hello")
        data = tc.model_dump()
        assert data == {"type": "text", "text": "hello"}

    def test_deserialization(self):
        tc = TextContent.model_validate({"type": "text", "text": "hello"})
        assert tc.text == "hello"


class TestImageContent:
    """Tests for ImageContent model."""

    def test_basic_image(self):
        ic = ImageContent(data="iVBOR...", mimeType="image/png")
        assert ic.type == "image"
        assert ic.data == "iVBOR..."
        assert ic.mime_type == "image/png"

    def test_serialization_uses_alias(self):
        ic = ImageContent(data="abc", mimeType="image/jpeg")
        data = ic.model_dump(by_alias=True)
        assert data["mimeType"] == "image/jpeg"

    def test_frozen(self):
        ic = ImageContent(data="abc", mimeType="image/png")
        with pytest.raises(ValidationError):
            ic.data = "xyz"


class TestEmbeddedResource:
    """Tests for EmbeddedResource model."""

    def test_basic_resource(self):
        er = EmbeddedResource(resource={"uri": "file:///test.txt", "text": "contents"})
        assert er.type == "resource"
        assert er.resource["uri"] == "file:///test.txt"

    def test_frozen(self):
        er = EmbeddedResource(resource={"key": "value"})
        with pytest.raises(ValidationError):
            er.type = "text"


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class TestToolInputSchema:
    """Tests for ToolInputSchema model."""

    def test_default_schema(self):
        schema = ToolInputSchema()
        assert schema.type == "object"
        assert schema.properties == {}
        assert schema.required == []

    def test_schema_with_properties(self):
        schema = ToolInputSchema(
            properties={
                "title": {"type": "string", "description": "The title"},
                "count": {"type": "number"},
            },
            required=["title"],
        )
        assert "title" in schema.properties
        assert schema.required == ["title"]


class TestToolDefinition:
    """Tests for ToolDefinition model."""

    def test_basic_definition(self):
        td = ToolDefinition(name="todo-create", description="Create a todo")
        assert td.name == "todo-create"
        assert td.description == "Create a todo"
        assert td.input_schema.type == "object"

    def test_definition_with_schema(self):
        td = ToolDefinition(
            name="todo-create",
            description="Create",
            inputSchema=ToolInputSchema(
                properties={"title": {"type": "string"}},
                required=["title"],
            ),
        )
        assert td.input_schema.required == ["title"]

    def test_serialization_uses_alias(self):
        td = ToolDefinition(name="test", description="Test")
        data = td.model_dump(by_alias=True)
        assert "inputSchema" in data


class TestToolCallParams:
    """Tests for ToolCallParams model."""

    def test_basic_call(self):
        params = ToolCallParams(name="todo-create", arguments={"title": "Buy milk"})
        assert params.name == "todo-create"
        assert params.arguments["title"] == "Buy milk"

    def test_empty_arguments(self):
        params = ToolCallParams(name="todo-list")
        assert params.arguments == {}

    def test_frozen(self):
        params = ToolCallParams(name="test")
        with pytest.raises(ValidationError):
            params.name = "other"


class TestToolResult:
    """Tests for ToolResult model."""

    def test_success_result(self):
        result = ToolResult(
            content=[TextContent(text='{"success": true}')],
        )
        assert result.is_error is False
        assert len(result.content) == 1

    def test_error_result(self):
        result = ToolResult(
            content=[TextContent(text="Something went wrong")],
            isError=True,
        )
        assert result.is_error is True

    def test_empty_result(self):
        result = ToolResult()
        assert result.content == []
        assert result.is_error is False

    def test_serialization_uses_alias(self):
        result = ToolResult(isError=True)
        data = result.model_dump(by_alias=True)
        assert data["isError"] is True


# ═══════════════════════════════════════════════════════════════════════════════
# JSON-RPC TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class TestJsonRpcError:
    """Tests for JsonRpcError model."""

    def test_basic_error(self):
        err = JsonRpcError(code=-32601, message="Method not found")
        assert err.code == -32601
        assert err.message == "Method not found"
        assert err.data is None

    def test_error_with_data(self):
        err = JsonRpcError(code=-32600, message="Invalid", data={"details": "bad"})
        assert err.data == {"details": "bad"}


class TestMcpRequest:
    """Tests for McpRequest model."""

    def test_basic_request(self):
        req = McpRequest(id=1, method="tools/list")
        assert req.jsonrpc == "2.0"
        assert req.id == 1
        assert req.method == "tools/list"
        assert req.params is None

    def test_request_with_params(self):
        req = McpRequest(
            id=2,
            method="tools/call",
            params={"name": "todo-create", "arguments": {"title": "Test"}},
        )
        assert req.params["name"] == "todo-create"

    def test_string_id(self):
        req = McpRequest(id="req-1", method="tools/list")
        assert req.id == "req-1"

    def test_serialization(self):
        req = McpRequest(id=1, method="tools/list")
        data = req.model_dump()
        assert data == {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": None}


class TestMcpResponse:
    """Tests for McpResponse model."""

    def test_basic_response(self):
        resp = McpResponse(id=1, result={"tools": []})
        assert resp.jsonrpc == "2.0"
        assert resp.id == 1
        assert resp.result == {"tools": []}

    def test_response_with_tool_result(self):
        resp = McpResponse(
            id=2,
            result={
                "content": [{"type": "text", "text": "ok"}],
                "isError": False,
            },
        )
        assert resp.result["content"][0]["text"] == "ok"


class TestMcpErrorResponse:
    """Tests for McpErrorResponse model."""

    def test_basic_error_response(self):
        resp = McpErrorResponse(
            id=1,
            error=JsonRpcError(code=-32601, message="Method not found"),
        )
        assert resp.jsonrpc == "2.0"
        assert resp.error.code == -32601


# ═══════════════════════════════════════════════════════════════════════════════
# INITIALIZATION TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class TestInitializeParams:
    """Tests for InitializeParams model."""

    def test_basic_params(self):
        params = InitializeParams(
            clientInfo=ClientInfo(name="test-client", version="1.0.0"),
        )
        assert params.protocol_version == MCP_PROTOCOL_VERSION
        assert params.client_info.name == "test-client"
        assert params.capabilities == {}

    def test_serialization_uses_aliases(self):
        params = InitializeParams(
            clientInfo=ClientInfo(name="test", version="1.0"),
        )
        data = params.model_dump(by_alias=True)
        assert "protocolVersion" in data
        assert "clientInfo" in data


class TestInitializeResult:
    """Tests for InitializeResult model."""

    def test_basic_result(self):
        result = InitializeResult(
            serverInfo=ServerInfo(name="test-server", version="1.0.0"),
        )
        assert result.protocol_version == MCP_PROTOCOL_VERSION
        assert result.server_info.name == "test-server"

    def test_result_without_server_info(self):
        result = InitializeResult()
        assert result.server_info is None


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER CONSTRUCTORS
# ═══════════════════════════════════════════════════════════════════════════════


class TestTextContentHelper:
    """Tests for text_content() helper."""

    def test_creates_text_content(self):
        tc = text_content("hello world")
        assert isinstance(tc, TextContent)
        assert tc.type == "text"
        assert tc.text == "hello world"

    def test_json_payload(self):
        payload = json.dumps({"success": True})
        tc = text_content(payload)
        assert json.loads(tc.text)["success"] is True


class TestImageContentHelper:
    """Tests for image_content() helper."""

    def test_creates_image_content(self):
        ic = image_content("iVBOR...", "image/png")
        assert isinstance(ic, ImageContent)
        assert ic.data == "iVBOR..."
        assert ic.mime_type == "image/png"


class TestEmbeddedResourceHelper:
    """Tests for embedded_resource() helper."""

    def test_creates_embedded_resource(self):
        er = embedded_resource({"uri": "file:///test.txt"})
        assert isinstance(er, EmbeddedResource)
        assert er.resource["uri"] == "file:///test.txt"


class TestToolCallParamsHelper:
    """Tests for tool_call_params() helper."""

    def test_with_arguments(self):
        params = tool_call_params("todo-create", {"title": "Buy milk"})
        assert isinstance(params, ToolCallParams)
        assert params.name == "todo-create"
        assert params.arguments["title"] == "Buy milk"

    def test_without_arguments(self):
        params = tool_call_params("todo-list")
        assert params.arguments == {}


class TestToolResultHelper:
    """Tests for tool_result() helper."""

    def test_success_result(self):
        result = tool_result([text_content("ok")])
        assert isinstance(result, ToolResult)
        assert result.is_error is False
        assert len(result.content) == 1

    def test_error_result(self):
        result = tool_result([text_content("fail")], is_error=True)
        assert result.is_error is True

    def test_empty_result(self):
        result = tool_result()
        assert result.content == []


class TestToolDefinitionHelper:
    """Tests for tool_definition() helper."""

    def test_basic_definition(self):
        td = tool_definition("todo-create", "Create a todo")
        assert isinstance(td, ToolDefinition)
        assert td.name == "todo-create"
        assert td.input_schema.type == "object"

    def test_with_properties(self):
        td = tool_definition(
            "todo-create",
            "Create a todo",
            properties={"title": {"type": "string"}},
            required=["title"],
        )
        assert "title" in td.input_schema.properties
        assert td.input_schema.required == ["title"]


class TestMcpRequestHelper:
    """Tests for mcp_request() helper."""

    def test_basic_request(self):
        req = mcp_request("tools/list")
        assert isinstance(req, McpRequest)
        assert req.method == "tools/list"
        assert req.id == 1

    def test_with_custom_id(self):
        req = mcp_request("tools/call", id=42)
        assert req.id == 42

    def test_with_dict_params(self):
        req = mcp_request("tools/call", params={"name": "test"})
        assert req.params["name"] == "test"

    def test_with_pydantic_params(self):
        params = tool_call_params("todo-create", {"title": "Test"})
        req = mcp_request("tools/call", params=params)
        assert req.params["name"] == "todo-create"
        assert req.params["arguments"]["title"] == "Test"


class TestMcpResponseHelper:
    """Tests for mcp_response() helper."""

    def test_basic_response(self):
        resp = mcp_response(1, {"tools": []})
        assert isinstance(resp, McpResponse)
        assert resp.id == 1
        assert resp.result == {"tools": []}


class TestMcpErrorResponseHelper:
    """Tests for mcp_error_response() helper."""

    def test_basic_error(self):
        resp = mcp_error_response(1, -32601, "Method not found")
        assert isinstance(resp, McpErrorResponse)
        assert resp.error.code == -32601
        assert resp.error.message == "Method not found"

    def test_error_with_data(self):
        resp = mcp_error_response(1, -32600, "Invalid", data={"key": "val"})
        assert resp.error.data == {"key": "val"}


class TestInitializeParamsHelper:
    """Tests for initialize_params() helper."""

    def test_basic_params(self):
        params = initialize_params("my-client", "1.0.0")
        assert isinstance(params, InitializeParams)
        assert params.client_info.name == "my-client"
        assert params.client_info.version == "1.0.0"
        assert params.protocol_version == MCP_PROTOCOL_VERSION

    def test_custom_version(self):
        params = initialize_params("c", "1.0", protocol_version="2025-01-01")
        assert params.protocol_version == "2025-01-01"


class TestInitializeResultHelper:
    """Tests for initialize_result() helper."""

    def test_basic_result(self):
        result = initialize_result("my-server", "2.0.0")
        assert isinstance(result, InitializeResult)
        assert result.server_info.name == "my-server"
        assert result.server_info.version == "2.0.0"

    def test_with_capabilities(self):
        result = initialize_result(
            "srv", "1.0", capabilities={"tools": {"listChanged": True}}
        )
        assert result.capabilities["tools"]["listChanged"] is True


# ═══════════════════════════════════════════════════════════════════════════════
# ROUND-TRIP / INTEGRATION
# ═══════════════════════════════════════════════════════════════════════════════


class TestRoundTrip:
    """Tests for JSON round-trip serialization."""

    def test_request_round_trip(self):
        req = mcp_request(
            "tools/call",
            id=5,
            params=tool_call_params("todo-create", {"title": "Test"}),
        )
        data = req.model_dump()
        restored = McpRequest.model_validate(data)
        assert restored.id == 5
        assert restored.method == "tools/call"
        assert restored.params["name"] == "todo-create"

    def test_response_round_trip(self):
        tr = tool_result([text_content('{"success": true}')])
        resp = mcp_response(5, tr.model_dump(by_alias=True))
        data = resp.model_dump()
        restored = McpResponse.model_validate(data)
        assert restored.result["content"][0]["text"] == '{"success": true}'

    def test_error_response_round_trip(self):
        resp = mcp_error_response(5, -32601, "Method not found")
        data = resp.model_dump()
        restored = McpErrorResponse.model_validate(data)
        assert restored.error.code == -32601

    def test_initialize_round_trip(self):
        params = initialize_params("client", "1.0")
        data = params.model_dump(by_alias=True)
        restored = InitializeParams.model_validate(data)
        assert restored.client_info.name == "client"


class TestPackageExports:
    """Tests that MCP types are accessible from the package root."""

    def test_import_from_afd(self):
        from afd import (
            MCP_PROTOCOL_VERSION,
            TextContent,
            McpRequest,
            text_content,
            mcp_request,
            tool_call_params,
            tool_result,
            mcp_response,
            mcp_error_response,
            initialize_params,
            initialize_result,
        )
        # Verify they are callable / usable
        tc = text_content("test")
        assert tc.text == "test"

    def test_import_from_afd_core(self):
        from afd.core import (
            TextContent,
            McpRequest,
            text_content,
            mcp_request,
        )
        req = mcp_request("tools/list")
        assert req.method == "tools/list"
