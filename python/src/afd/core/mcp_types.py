"""Public MCP protocol types for testing and interoperability.

Validated Pydantic models for the MCP (Model Context Protocol) wire format.
These types enable type-safe construction, serialization, and validation of
MCP messages without reaching into transport internals.

Example:
    >>> from afd.core.mcp_types import (
    ...     mcp_request, mcp_response, mcp_error_response,
    ...     text_content, tool_call_params, tool_result,
    ... )
    >>>
    >>> # Build a tools/call request
    >>> req = mcp_request("tools/call", params=tool_call_params("todo-create", {"title": "Buy milk"}))
    >>> req.method
    'tools/call'
    >>>
    >>> # Build a successful tool result
    >>> result = tool_result([text_content('{"success": true}')])
    >>> result.content[0].text
    '{"success": true}'
"""

from __future__ import annotations

import itertools
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ═══════════════════════════════════════════════════════════════════════════════
# PROTOCOL CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

MCP_PROTOCOL_VERSION = "2025-11-25"
"""Newest MCP revision that uses the ``initialize`` handshake (the default for
:class:`InitializeParams` and :class:`InitializeResult`)."""

MODERN_PROTOCOL_VERSION = "2026-07-28"
"""MCP revision without the handshake: every request carries its version in
``_meta["io.modelcontextprotocol/protocolVersion"]``."""

LEGACY_PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
"""``initialize``-era MCP revisions, newest first."""

JSONRPC_VERSION: Literal["2.0"] = "2.0"
"""JSON-RPC version used by MCP."""

McpId = int | str
"""Request/response identifier in MCP JSON-RPC messages."""


class McpErrorCodes:
    """Standard MCP / JSON-RPC numeric error codes."""

    PARSE_ERROR: Literal[-32700] = -32700
    INVALID_REQUEST: Literal[-32600] = -32600
    METHOD_NOT_FOUND: Literal[-32601] = -32601
    INVALID_PARAMS: Literal[-32602] = -32602
    INTERNAL_ERROR: Literal[-32603] = -32603
    HEADER_MISMATCH: Literal[-32020] = -32020
    MISSING_REQUIRED_CLIENT_CAPABILITY: Literal[-32021] = -32021
    UNSUPPORTED_PROTOCOL_VERSION: Literal[-32022] = -32022
    SERVER_NOT_INITIALIZED: Literal[-32002] = -32002
    REQUEST_CANCELLED: Literal[-32800] = -32800
    CONTENT_MODIFIED: Literal[-32801] = -32801


McpErrorCode = Literal[
    -32700,
    -32600,
    -32601,
    -32602,
    -32603,
    -32020,
    -32021,
    -32022,
    -32002,
    -32800,
    -32801,
]
"""Literal union of standard MCP numeric error codes."""


# ═══════════════════════════════════════════════════════════════════════════════
# CONTENT TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class TextContent(BaseModel):
    """Text content block in MCP responses.

    Attributes:
        type: Always ``"text"``.
        text: The text payload (often JSON-encoded).
    """

    model_config = ConfigDict(frozen=True)

    type: Literal["text"] = "text"
    text: str


class ImageContent(BaseModel):
    """Image content block in MCP responses.

    Attributes:
        type: Always ``"image"``.
        data: Base64-encoded image data.
        mime_type: MIME type of the image (e.g., ``"image/png"``).
    """

    model_config = ConfigDict(frozen=True)

    type: Literal["image"] = "image"
    data: str
    mime_type: str = Field(alias="mimeType")


class EmbeddedResource(BaseModel):
    """Embedded resource content block.

    Attributes:
        type: Always ``"resource"``.
        resource: The embedded resource data.
    """

    model_config = ConfigDict(frozen=True)

    type: Literal["resource"] = "resource"
    resource: dict[str, Any]


Content = TextContent | ImageContent | EmbeddedResource
"""Union of all MCP content types."""


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class ToolInputSchema(BaseModel):
    """JSON Schema describing a tool's input parameters.

    Attributes:
        type: Always ``"object"``.
        properties: Property schemas keyed by name.
        required: List of required property names.
    """

    model_config = ConfigDict(frozen=True)

    type: Literal["object"] = "object"
    properties: dict[str, Any] = Field(default_factory=dict)
    required: list[str] = Field(default_factory=list)


class ToolDefinition(BaseModel):
    """MCP tool definition as returned by ``tools/list``.

    Attributes:
        name: Tool name.
        description: Human-readable description.
        input_schema: JSON Schema for the tool's input.
    """

    model_config = ConfigDict(frozen=True, populate_by_name=True)

    name: str
    description: str = ""
    input_schema: ToolInputSchema = Field(default_factory=ToolInputSchema, alias="inputSchema")


class ToolCallParams(BaseModel):
    """Parameters for a ``tools/call`` request.

    Attributes:
        name: Tool name to invoke.
        arguments: Arguments to pass to the tool.
    """

    model_config = ConfigDict(frozen=True)

    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolResult(BaseModel):
    """Result from a ``tools/call`` response.

    Attributes:
        content: List of content blocks.
        is_error: Whether the tool reported an error.
    """

    model_config = ConfigDict(frozen=True, populate_by_name=True)

    content: list[Content] = Field(default_factory=list)
    is_error: bool = Field(default=False, alias="isError")


# ═══════════════════════════════════════════════════════════════════════════════
# JSON-RPC TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class JsonRpcError(BaseModel):
    """JSON-RPC error object.

    Attributes:
        code: Numeric error code.
        message: Human-readable error message.
        data: Optional additional error data.
    """

    model_config = ConfigDict(frozen=True)

    code: int
    message: str
    data: Any | None = None


class McpRequest(BaseModel):
    """MCP JSON-RPC request message.

    Attributes:
        jsonrpc: Always ``"2.0"``.
        id: Request identifier.
        method: The MCP method to invoke.
        params: Optional method parameters.
    """

    model_config = ConfigDict(frozen=True)

    jsonrpc: Literal["2.0"] = JSONRPC_VERSION
    id: int | str
    method: str
    params: dict[str, Any] | None = None


class McpResponse(BaseModel):
    """MCP JSON-RPC success response message.

    Attributes:
        jsonrpc: Always ``"2.0"``.
        id: Request identifier (matches the request).
        result: The response payload.
    """

    model_config = ConfigDict(frozen=True)

    jsonrpc: Literal["2.0"] = JSONRPC_VERSION
    id: int | str
    result: Any


class McpErrorResponse(BaseModel):
    """MCP JSON-RPC error response message.

    Attributes:
        jsonrpc: Always ``"2.0"``.
        id: Request identifier (matches the request).
        error: The error details.
    """

    model_config = ConfigDict(frozen=True)

    jsonrpc: Literal["2.0"] = JSONRPC_VERSION
    id: int | str
    error: JsonRpcError


class McpNotification(BaseModel):
    """MCP JSON-RPC notification message (no ``id``, no response expected)."""

    model_config = ConfigDict(frozen=True)

    jsonrpc: Literal["2.0"] = JSONRPC_VERSION
    method: str
    params: dict[str, Any] | None = None


class McpToolsListResult(BaseModel):
    """Result payload for ``tools/list``."""

    model_config = ConfigDict(frozen=True)

    tools: list[ToolDefinition] = Field(default_factory=list)


# Cross-language type aliases matching TypeScript's ``@lushly-dev/afd-core`` names.
McpError = JsonRpcError
McpTool = ToolDefinition
McpToolCallParams = ToolCallParams
McpToolCallResult = ToolResult
McpContent = Content
McpTextContent = TextContent
McpImageContent = ImageContent
McpResourceContent = EmbeddedResource
McpServerCapabilities = dict[str, Any]
McpClientCapabilities = dict[str, Any]


# ═══════════════════════════════════════════════════════════════════════════════
# INITIALIZATION TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class ClientInfo(BaseModel):
    """Client information sent during initialization.

    Attributes:
        name: Client name.
        version: Client version string.
    """

    model_config = ConfigDict(frozen=True)

    name: str
    version: str


class ServerInfo(BaseModel):
    """Server information returned during initialization.

    Attributes:
        name: Server name.
        version: Server version string.
    """

    model_config = ConfigDict(frozen=True)

    name: str
    version: str = ""


class InitializeParams(BaseModel):
    """Parameters for the ``initialize`` method.

    Attributes:
        protocol_version: MCP protocol version.
        capabilities: Client capabilities (empty by default).
        client_info: Information about the client.
    """

    model_config = ConfigDict(frozen=True, populate_by_name=True)

    protocol_version: str = Field(default=MCP_PROTOCOL_VERSION, alias="protocolVersion")
    capabilities: dict[str, Any] = Field(default_factory=dict)
    client_info: ClientInfo = Field(alias="clientInfo")


class InitializeResult(BaseModel):
    """Result from the ``initialize`` method.

    Attributes:
        protocol_version: MCP protocol version.
        capabilities: Server capabilities.
        server_info: Information about the server.
    """

    model_config = ConfigDict(frozen=True, populate_by_name=True)

    protocol_version: str = Field(default=MCP_PROTOCOL_VERSION, alias="protocolVersion")
    capabilities: dict[str, Any] = Field(default_factory=dict)
    server_info: ServerInfo | None = Field(default=None, alias="serverInfo")


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER CONSTRUCTORS
# ═══════════════════════════════════════════════════════════════════════════════


def text_content(text: str) -> TextContent:
    """Create a TextContent block.

    Args:
        text: The text payload.

    Returns:
        A frozen TextContent instance.

    Example:
        >>> tc = text_content('{"success": true}')
        >>> tc.type
        'text'
    """
    return TextContent(text=text)


def image_content(data: str, mime_type: str) -> ImageContent:
    """Create an ImageContent block.

    Args:
        data: Base64-encoded image data.
        mime_type: MIME type (e.g., ``"image/png"``).

    Returns:
        A frozen ImageContent instance.

    Example:
        >>> ic = image_content("iVBOR...", "image/png")
        >>> ic.mime_type
        'image/png'
    """
    return ImageContent(data=data, mimeType=mime_type)


def embedded_resource(resource: dict[str, Any]) -> EmbeddedResource:
    """Create an EmbeddedResource block.

    Args:
        resource: The resource data dict.

    Returns:
        A frozen EmbeddedResource instance.
    """
    return EmbeddedResource(resource=resource)


def tool_call_params(name: str, arguments: dict[str, Any] | None = None) -> ToolCallParams:
    """Create parameters for a ``tools/call`` request.

    Args:
        name: Tool name to invoke.
        arguments: Arguments to pass to the tool.

    Returns:
        A frozen ToolCallParams instance.

    Example:
        >>> params = tool_call_params("todo-create", {"title": "Buy milk"})
        >>> params.name
        'todo-create'
    """
    return ToolCallParams(name=name, arguments=arguments or {})


def tool_result(
    content: list[Content] | None = None,
    *,
    is_error: bool = False,
) -> ToolResult:
    """Create a tool result.

    Args:
        content: List of content blocks.
        is_error: Whether the tool reported an error.

    Returns:
        A frozen ToolResult instance.

    Example:
        >>> result = tool_result([text_content("ok")])
        >>> result.is_error
        False
    """
    return ToolResult(content=content or [], isError=is_error)


def tool_definition(
    name: str,
    description: str = "",
    *,
    properties: dict[str, Any] | None = None,
    required: list[str] | None = None,
) -> ToolDefinition:
    """Create a tool definition.

    Args:
        name: Tool name.
        description: Human-readable description.
        properties: Input schema properties.
        required: Required property names.

    Returns:
        A frozen ToolDefinition instance.

    Example:
        >>> td = tool_definition("todo-create", "Create a todo", properties={"title": {"type": "string"}}, required=["title"])
        >>> td.name
        'todo-create'
    """
    schema = ToolInputSchema(
        properties=properties or {},
        required=required or [],
    )
    return ToolDefinition(name=name, description=description, inputSchema=schema)


def mcp_request(
    method: str,
    *,
    id: int | str = 1,
    params: Any | None = None,
) -> McpRequest:
    """Create an MCP JSON-RPC request.

    Args:
        method: The MCP method (e.g., ``"tools/call"``, ``"tools/list"``).
        id: Request identifier.
        params: Method parameters. If a Pydantic model, it will be serialized.

    Returns:
        A frozen McpRequest instance.

    Example:
        >>> req = mcp_request("tools/list", id=1)
        >>> req.method
        'tools/list'
    """
    serialized: dict[str, Any] | None
    if isinstance(params, BaseModel):
        serialized = params.model_dump(by_alias=True)
    elif isinstance(params, dict):
        serialized = params
    else:
        serialized = params
    return McpRequest(id=id, method=method, params=serialized)


def mcp_response(id: int | str, result: Any) -> McpResponse:
    """Create an MCP JSON-RPC success response.

    Args:
        id: Request identifier (must match the request).
        result: The response payload.

    Returns:
        A frozen McpResponse instance.

    Example:
        >>> resp = mcp_response(1, {"tools": []})
        >>> resp.result
        {'tools': []}
    """
    return McpResponse(id=id, result=result)


def mcp_error_response(
    id: int | str,
    code: int,
    message: str,
    *,
    data: Any | None = None,
) -> McpErrorResponse:
    """Create an MCP JSON-RPC error response.

    Args:
        id: Request identifier (must match the request).
        code: Numeric error code.
        message: Human-readable error message.
        data: Optional additional error data.

    Returns:
        A frozen McpErrorResponse instance.

    Example:
        >>> err = mcp_error_response(1, -32601, "Method not found")
        >>> err.error.code
        -32601
    """
    return McpErrorResponse(
        id=id,
        error=JsonRpcError(code=code, message=message, data=data),
    )


def initialize_params(
    client_name: str,
    client_version: str,
    *,
    protocol_version: str = MCP_PROTOCOL_VERSION,
    capabilities: dict[str, Any] | None = None,
) -> InitializeParams:
    """Create parameters for the ``initialize`` method.

    Args:
        client_name: Client name.
        client_version: Client version string.
        protocol_version: MCP protocol version.
        capabilities: Client capabilities.

    Returns:
        A frozen InitializeParams instance.

    Example:
        >>> params = initialize_params("my-client", "1.0.0")
        >>> params.client_info.name
        'my-client'
    """
    return InitializeParams(
        protocolVersion=protocol_version,
        capabilities=capabilities or {},
        clientInfo=ClientInfo(name=client_name, version=client_version),
    )


def initialize_result(
    server_name: str,
    server_version: str = "",
    *,
    protocol_version: str = MCP_PROTOCOL_VERSION,
    capabilities: dict[str, Any] | None = None,
) -> InitializeResult:
    """Create a result for the ``initialize`` method.

    Args:
        server_name: Server name.
        server_version: Server version string.
        protocol_version: MCP protocol version.
        capabilities: Server capabilities.

    Returns:
        A frozen InitializeResult instance.

    Example:
        >>> result = initialize_result("my-server", "1.0.0")
        >>> result.server_info.name
        'my-server'
    """
    return InitializeResult(
        protocolVersion=protocol_version,
        capabilities=capabilities or {},
        serverInfo=ServerInfo(name=server_name, version=server_version),
    )


McpInitializeParams = InitializeParams
McpInitializeResult = InitializeResult

_NEXT_REQUEST_ID = itertools.count(1)


def create_mcp_request(
    method: str,
    params: Any | None = None,
    *,
    id: McpId | None = None,
) -> McpRequest:
    """Create an MCP JSON-RPC request with an auto-incrementing id when omitted."""
    req_id: McpId = next(_NEXT_REQUEST_ID) if id is None else id
    return mcp_request(method, id=req_id, params=params)


def create_mcp_response(id: McpId, result: Any) -> McpResponse:
    """Create an MCP JSON-RPC success response."""
    return mcp_response(id, result)


def create_mcp_error_response(
    id: McpId,
    code: int,
    message: str,
    data: Any | None = None,
) -> McpErrorResponse:
    """Create an MCP JSON-RPC error response."""
    return mcp_error_response(id, code, message, data=data)


def is_mcp_request(value: Any) -> bool:
    """Type guard for MCP JSON-RPC requests."""
    if isinstance(value, McpRequest):
        return True
    return (
        isinstance(value, dict)
        and value.get("jsonrpc") == JSONRPC_VERSION
        and "id" in value
        and "method" in value
        and isinstance(value.get("method"), str)
    )


def is_mcp_response(value: Any) -> bool:
    """Type guard for MCP JSON-RPC responses (success or error)."""
    if isinstance(value, (McpResponse, McpErrorResponse)):
        return True
    return (
        isinstance(value, dict)
        and value.get("jsonrpc") == JSONRPC_VERSION
        and "id" in value
        and ("result" in value or "error" in value)
    )


def is_mcp_notification(value: Any) -> bool:
    """Type guard for MCP JSON-RPC notifications (no ``id``)."""
    if isinstance(value, McpNotification):
        return True
    return (
        isinstance(value, dict)
        and value.get("jsonrpc") == JSONRPC_VERSION
        and "method" in value
        and isinstance(value.get("method"), str)
        and "id" not in value
    )
