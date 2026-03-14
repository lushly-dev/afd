"""Agent-First Development (AFD) toolkit for Python.

AFD is a software development methodology where AI agents are treated as
first-class users from day one.

Example:
    >>> from afd import CommandResult, success, error
    >>> result = success(data={"id": "123"}, reasoning="Created successfully")
    >>> result.success
    True

Server Example:
    >>> from afd.server import create_server
    >>> from afd import success
    >>> from pydantic import BaseModel
    >>>
    >>> server = create_server("my-app")
    >>>
    >>> class GreetInput(BaseModel):
    ...     name: str
    >>>
    >>> @server.command(name="greet", description="Greet someone")
    ... async def greet(input: GreetInput):
    ...     return success({"message": f"Hello, {input.name}!"})

Handoff Example:
    >>> from afd import create_handoff, is_handoff, success
    >>> from afd.server import define_command
    >>>
    >>> @define_command(
    ...     name="chat-connect",
    ...     description="Connect to a chat room",
    ...     handoff=True,
    ...     handoff_protocol="websocket",
    ... )
    ... async def connect_chat(input):
    ...     return success(create_handoff(
    ...         protocol="websocket",
    ...         endpoint="wss://chat.example.com/room/123",
    ...         token="auth-token",
    ...     ))
"""

from afd.core.result import (
    CommandResult,
    ResultMetadata,
    success,
    failure,
    error,
    is_success,
    is_failure,
)
from afd.core.errors import (
    CommandError,
    ErrorCodes,
    create_error,
    validation_error,
    not_found_error,
    rate_limit_error,
    timeout_error,
    internal_error,
    wrap_error,
    is_command_error,
)
from afd.core.metadata import (
    Source,
    PlanStep,
    PlanStepStatus,
    Alternative,
    Warning,
    create_source,
    create_step,
    update_step_status,
    create_warning,
)
from afd.core.telemetry import (
    TelemetryEvent,
    TelemetrySink,
    ConsoleTelemetrySink,
    create_telemetry_event,
    is_telemetry_event,
)
from afd.core.handoff import (
    HandoffProtocol,
    HandoffCredentials,
    HandoffMetadata,
    HandoffResult,
    ReconnectPolicy,
    is_handoff,
    is_handoff_protocol,
    is_handoff_command,
    get_handoff_protocol,
    create_handoff,
)
from afd.core.batch import (
    BatchCommand,
    BatchOptions,
    BatchRequest,
    BatchCommandResult,
    BatchSummary,
    BatchTiming,
    BatchWarning,
    BatchResult,
    create_batch_request,
    calculate_batch_confidence,
    create_batch_result,
    create_failed_batch_result,
    is_batch_request,
    is_batch_result,
    is_batch_command,
)
from afd.core.commands import (
    ExposeOptions,
    DEFAULT_EXPOSE,
)
from afd.core.mcp_types import (
    MCP_PROTOCOL_VERSION,
    JSONRPC_VERSION,
    TextContent,
    ImageContent,
    EmbeddedResource,
    ToolInputSchema,
    ToolDefinition,
    ToolCallParams,
    ToolResult,
    JsonRpcError,
    McpRequest,
    McpResponse,
    McpErrorResponse,
    ClientInfo,
    ServerInfo,
    InitializeParams,
    InitializeResult,
    text_content,
    image_content,
    embedded_resource,
    tool_call_params,
    tool_result,
    tool_definition,
    mcp_request,
    mcp_response,
    mcp_error_response,
    initialize_params,
    initialize_result,
)
from afd.core.streaming import (
    ProgressChunk,
    DataChunk,
    CompleteChunk,
    ErrorChunk,
    StreamChunk,
    StreamOptions,
    StreamCallbacks,
    StreamableCommand,
    create_progress_chunk,
    create_data_chunk,
    create_complete_chunk,
    create_error_chunk,
    is_progress_chunk,
    is_data_chunk,
    is_complete_chunk,
    is_error_chunk,
    is_stream_chunk,
    is_streamable_command,
    consume_stream,
    collect_stream_data,
)
from afd.direct import (
    DirectClient,
    DirectRegistry,
    SimpleRegistry,
    DirectClientOptions,
    DirectCallContext,
    CommandContext,
    CommandInfo,
    CommandDefinition,
    CommandParameter,
    PipelineStep,
    PipelineStepResult,
    PipelineResult,
    create_direct_client,
    create_registry,
)
from afd.client import (
    McpClient,
    McpClientConfig,
    ClientStatus,
    create_client,
)
from afd.platform import (
    ExecErrorCode,
    ExecOptions,
    ExecResult,
    OsInfo,
    create_exec_result,
    exec_command,
    find_up,
    get_os_info,
    get_temp_dir,
    is_exec_error,
    is_linux,
    is_mac,
    is_windows,
    normalize_path,
)
from afd.connectors import (
    GitHubConnector,
    GitHubConnectorOptions,
    Issue,
    IssueCreateOptions,
    IssueFilters,
    PackageManager,
    PackageManagerConnector,
    PackageManagerConnectorOptions,
    PrCreateOptions,
    PullRequest,
)
from afd.connectors.package_manager import (
    Dependency,
    detect_package_manager,
)
from afd.handoff_client import (
    HandoffConnectionState,
    HandoffConnection,
    HandoffConnectionOptions,
    ReconnectingHandoffConnection,
    ReconnectionOptions,
    connect_handoff,
    create_reconnecting_handoff,
    register_handoff_handler,
    unregister_handoff_handler,
    get_handoff_handler,
    has_handoff_handler,
    list_handoff_handlers,
    clear_handoff_handlers,
    build_authenticated_endpoint,
    parse_handoff_endpoint,
    is_handoff_expired,
    get_handoff_ttl,
    register_builtin_handlers,
    WebSocketHandoffHandler,
    SseHandoffHandler,
)

__version__ = "0.6.0"

__all__ = [
    # Version
    "__version__",
    # Result types
    "CommandResult",
    "ResultMetadata",
    "success",
    "failure",
    "error",
    "is_success",
    "is_failure",
    # Error types
    "CommandError",
    "ErrorCodes",
    "create_error",
    "validation_error",
    "not_found_error",
    "rate_limit_error",
    "timeout_error",
    "internal_error",
    "wrap_error",
    "is_command_error",
    # Metadata types
    "Source",
    "PlanStep",
    "PlanStepStatus",
    "Alternative",
    "Warning",
    "create_source",
    "create_step",
    "update_step_status",
    "create_warning",
    # Telemetry types
    "TelemetryEvent",
    "TelemetrySink",
    "ConsoleTelemetrySink",
    "create_telemetry_event",
    "is_telemetry_event",
    # Handoff types
    "HandoffProtocol",
    "HandoffCredentials",
    "HandoffMetadata",
    "HandoffResult",
    "ReconnectPolicy",
    "is_handoff",
    "is_handoff_protocol",
    "is_handoff_command",
    "get_handoff_protocol",
    "create_handoff",
    # Batch types
    "BatchCommand",
    "BatchOptions",
    "BatchRequest",
    "BatchCommandResult",
    "BatchSummary",
    "BatchTiming",
    "BatchWarning",
    "BatchResult",
    "create_batch_request",
    "calculate_batch_confidence",
    "create_batch_result",
    "create_failed_batch_result",
    "is_batch_request",
    "is_batch_result",
    "is_batch_command",
    # Expose options
    "ExposeOptions",
    "DEFAULT_EXPOSE",
    # MCP protocol types
    "MCP_PROTOCOL_VERSION",
    "JSONRPC_VERSION",
    "TextContent",
    "ImageContent",
    "EmbeddedResource",
    "ToolInputSchema",
    "ToolDefinition",
    "ToolCallParams",
    "ToolResult",
    "JsonRpcError",
    "McpRequest",
    "McpResponse",
    "McpErrorResponse",
    "ClientInfo",
    "ServerInfo",
    "InitializeParams",
    "InitializeResult",
    "text_content",
    "image_content",
    "embedded_resource",
    "tool_call_params",
    "tool_result",
    "tool_definition",
    "mcp_request",
    "mcp_response",
    "mcp_error_response",
    "initialize_params",
    "initialize_result",
    # Streaming types
    "ProgressChunk",
    "DataChunk",
    "CompleteChunk",
    "ErrorChunk",
    "StreamChunk",
    "StreamOptions",
    "StreamCallbacks",
    "StreamableCommand",
    "create_progress_chunk",
    "create_data_chunk",
    "create_complete_chunk",
    "create_error_chunk",
    "is_progress_chunk",
    "is_data_chunk",
    "is_complete_chunk",
    "is_error_chunk",
    "is_stream_chunk",
    "is_streamable_command",
    "consume_stream",
    "collect_stream_data",
    # Direct execution
    "DirectClient",
    "DirectRegistry",
    "SimpleRegistry",
    "DirectClientOptions",
    "DirectCallContext",
    "CommandContext",
    "CommandInfo",
    "CommandDefinition",
    "CommandParameter",
    "PipelineStep",
    "PipelineStepResult",
    "PipelineResult",
    "create_direct_client",
    "create_registry",
    # MCP Client (network)
    "McpClient",
    "McpClientConfig",
    "ClientStatus",
    "create_client",
    # Platform utilities
    "ExecErrorCode",
    "ExecOptions",
    "ExecResult",
    "OsInfo",
    "create_exec_result",
    "exec_command",
    "find_up",
    "get_os_info",
    "get_temp_dir",
    "is_exec_error",
    "is_linux",
    "is_mac",
    "is_windows",
    "normalize_path",
    # Connectors - GitHub
    "GitHubConnector",
    "GitHubConnectorOptions",
    "Issue",
    "IssueCreateOptions",
    "IssueFilters",
    "PrCreateOptions",
    "PullRequest",
    # Connectors - Package manager
    "Dependency",
    "PackageManager",
    "PackageManagerConnector",
    "PackageManagerConnectorOptions",
    "detect_package_manager",
    # Handoff client
    "HandoffConnectionState",
    "HandoffConnection",
    "HandoffConnectionOptions",
    "ReconnectingHandoffConnection",
    "ReconnectionOptions",
    "connect_handoff",
    "create_reconnecting_handoff",
    "register_handoff_handler",
    "unregister_handoff_handler",
    "get_handoff_handler",
    "has_handoff_handler",
    "list_handoff_handlers",
    "clear_handoff_handlers",
    "build_authenticated_endpoint",
    "parse_handoff_endpoint",
    "is_handoff_expired",
    "get_handoff_ttl",
    "register_builtin_handlers",
    "WebSocketHandoffHandler",
    "SseHandoffHandler",
]

