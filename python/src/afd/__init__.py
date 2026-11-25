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

import warnings
from typing import TYPE_CHECKING

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
from afd.core.actor import (
    ACTOR_KINDS,
    Actor,
    ActorKind,
    ContextDefaults,
    is_actor,
    is_actor_kind,
    with_context_defaults,
)
from afd.core.approval import ApprovalDecision, ApprovalPolicy, approval_mode
from afd.core.batch import (
    DEFAULT_MAX_BATCH_PARALLELISM,
    DEFAULT_MAX_BATCH_SIZE,
    BatchCommand,
    BatchCommandResult,
    BatchOptions,
    BatchRequest,
    BatchResult,
    BatchSummary,
    BatchTiming,
    BatchWarning,
    calculate_batch_confidence,
    check_batch_limits,
    create_batch_request,
    create_batch_result,
    create_failed_batch_result,
    is_batch_command,
    is_batch_request,
    is_batch_result,
)
from afd.core.builtin_names import (
    AFD_BOOTSTRAP_COMMAND_NAMES,
    AFD_BUILTIN_TOOL_NAMES,
    AFD_CONTEXT_COMMAND_NAMES,
    AFD_META_TOOL_NAMES,
    is_afd_builtin_name,
)
from afd.core.clock import (
    Clock,
    ClockInstant,
    ManualClock,
    RandomSource,
    fixed_clock,
    seeded_random,
    system_clock,
    system_random,
)

# The core registry's CommandDefinition, CommandContext and CommandParameter
# live at afd.core. The direct-client dataclasses are exported as DirectContext,
# DirectCommandDefinition, DirectCommandParameter, DirectPipelineStep,
# DirectPipelineStepResult and DirectPipelineResult; the old colliding root
# names stay reachable through __getattr__ with a DeprecationWarning for one
# minor release.
from afd.core.commands import (
    DEFAULT_EXPOSE,
    CallGrant,
    CommandConfirmationMode,
    CommandExample,
    CommandHandler,
    CommandMiddleware,
    CommandRegistry,
    ExposeOptions,
    JsonSchema,
    NextFn,
    TaskSupport,
    call_not_granted,
    command_result_output_schema,
    command_to_mcp_tool,
    command_tool_annotations,
    create_command_registry,
    serialize_command_examples,
    validate_command_name,
)
from afd.core.contract import CONTRACT_VERSION
from afd.core.errors import (
    ERROR_CODE_CATALOG,
    HOST_ERROR_CODE_PREFIX,
    RECOVERY_KINDS,
    CommandError,
    ErrorCode,
    ErrorCodeInfo,
    ErrorCodes,
    Recovery,
    RecoveryKind,
    create_error,
    internal_error,
    is_command_error,
    is_command_recovery,
    not_found_error,
    rate_limit_error,
    timeout_error,
    validation_error,
    wrap_error,
)
from afd.core.handoff import (
    HandoffCredentials,
    HandoffMetadata,
    HandoffProtocol,
    HandoffResult,
    ReconnectPolicy,
    create_handoff,
    get_handoff_protocol,
    is_handoff,
    is_handoff_command,
    is_handoff_protocol,
)
from afd.core.journal import (
    FileJournalSink,
    JournalContextDigest,
    JournalEntry,
    JournalRange,
    JournalRecord,
    JournalSink,
    JournalTape,
    MemoryJournalSink,
    create_context_digest,
    is_journal_entry,
    journal_actor,
    parse_journal,
    serialize_journal,
    serialize_journal_entry,
)
from afd.core.mcp_types import (
    JSONRPC_VERSION,
    LEGACY_PROTOCOL_VERSIONS,
    MCP_PROTOCOL_VERSION,
    MODERN_PROTOCOL_VERSION,
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
from afd.core.metadata import (
    Alternative,
    PlanStep,
    PlanStepStatus,
    Source,
    Warning,
    WarningSeverity,
    create_source,
    create_step,
    create_warning,
    update_step_status,
)
from afd.core.output_budget import (
    AFD_OUTPUT_BUDGET_META_KEY,
    MAX_OUTPUT_BUDGET_BYTES,
    OutputBudget,
)
from afd.core.result import (
    CommandResult,
    ResultMetadata,
    error,
    failure,
    is_failure,
    is_success,
    success,
)
from afd.core.streaming import (
    CompleteChunk,
    DataChunk,
    ErrorChunk,
    ProgressChunk,
    StreamableCommand,
    StreamCallbacks,
    StreamChunk,
    StreamOptions,
    TimeoutController,
    collect_stream_data,
    consume_stream,
    create_complete_chunk,
    create_data_chunk,
    create_error_chunk,
    create_progress_chunk,
    create_progress_chunk_with_steps,
    create_timeout_controller,
    is_complete_chunk,
    is_data_chunk,
    is_error_chunk,
    is_progress_chunk,
    is_stream_chunk,
    is_streamable_command,
    parse_stream_chunk,
)
from afd.core.telemetry import (
    ConsoleTelemetrySink,
    TelemetryEvent,
    TelemetrySink,
    create_telemetry_event,
    is_telemetry_event,
)
from afd.core.wire import WireModel, to_wire, to_wire_json
from afd.direct import (
    CommandInfo,
    DirectApprovalRequest,
    DirectCallContext,
    DirectClient,
    DirectClientOptions,
    DirectCommandDefinition,
    DirectCommandParameter,
    DirectCommandRegistry,
    DirectContext,
    DirectPipelineResult,
    DirectPipelineStep,
    DirectPipelineStepResult,
    DirectRegistry,
    SimpleRegistry,
    create_direct_client,
    create_direct_registry,
    create_registry,
)
from afd.handoff_client import (
    HandoffConnection,
    HandoffConnectionOptions,
    HandoffConnectionState,
    ReconnectingHandoffConnection,
    ReconnectionOptions,
    SseHandoffHandler,
    WebSocketHandoffHandler,
    build_authenticated_endpoint,
    clear_handoff_handlers,
    connect_handoff,
    create_reconnecting_handoff,
    get_handoff_handler,
    get_handoff_ttl,
    has_handoff_handler,
    is_handoff_expired,
    list_handoff_handlers,
    parse_handoff_endpoint,
    register_builtin_handlers,
    register_handoff_handler,
    unregister_handoff_handler,
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

if TYPE_CHECKING:
    from afd.client import (
        ClientStatus as ClientStatus,
    )
    from afd.client import (
        DetailedTask as DetailedTask,
    )
    from afd.client import (
        McpClient as McpClient,
    )
    from afd.client import (
        McpClientConfig as McpClientConfig,
    )
    from afd.client import (
        TaskInfo as TaskInfo,
    )
    from afd.client import (
        TaskProgressCallback as TaskProgressCallback,
    )
    from afd.client import (
        create_client as create_client,
    )
    from afd.transports.streamable_http import (
        ElicitationHandler as ElicitationHandler,
    )
    from afd.transports.streamable_http import (
        ElicitationRequest as ElicitationRequest,
    )
    from afd.transports.streamable_http import (
        ElicitationResponse as ElicitationResponse,
    )

# The MCP client needs the optional ``client`` extra (httpx, mcp), so its
# exports are imported on first access instead of when ``afd`` is imported.
_LAZY_EXPORTS = {
    "McpClient": "afd.client",
    "McpClientConfig": "afd.client",
    "ClientStatus": "afd.client",
    "TaskInfo": "afd.client",
    "DetailedTask": "afd.client",
    "TaskProgressCallback": "afd.client",
    "create_client": "afd.client",
    "ElicitationHandler": "afd.client",
    "ElicitationRequest": "afd.client",
    "ElicitationResponse": "afd.client",
}


# Deprecated colliding root names kept for one minor release (#1758).
_DEPRECATED_DIRECT_EXPORTS: dict[str, tuple[str, str]] = {
    "CommandContext": ("DirectContext", "afd.core.CommandContext"),
    "CommandDefinition": ("DirectCommandDefinition", "afd.core.CommandDefinition"),
    "CommandParameter": ("DirectCommandParameter", "afd.core.CommandParameter"),
    "PipelineStep": ("DirectPipelineStep", "afd.core.pipeline.PipelineStep"),
    "PipelineStepResult": ("DirectPipelineStepResult", "afd.core.pipeline.StepResult"),
    "PipelineResult": ("DirectPipelineResult", "afd.core.pipeline.PipelineResult"),
}


def __getattr__(name: str) -> object:
    deprecated = _DEPRECATED_DIRECT_EXPORTS.get(name)
    if deprecated is not None:
        replacement, core_path = deprecated
        warnings.warn(
            f"afd.{name} is deprecated and will be removed in the next minor release; "
            f"use afd.{replacement} (or {core_path} for the core type) instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return globals()[replacement]
    module_name = _LAZY_EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    import importlib

    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            f"afd.{name} requires the 'client' extra: pip install 'afd[client]' ({exc})",
            name=exc.name,
        ) from exc
    value = getattr(module, name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(_LAZY_EXPORTS))


__version__ = "0.13.0"

__all__ = [
    # Context primitives (actor, clock, random)
    "ACTOR_KINDS",
    "Actor",
    "ActorKind",
    "ContextDefaults",
    "is_actor",
    "is_actor_kind",
    "with_context_defaults",
    # Pre-execution approval policy
    "ApprovalDecision",
    "ApprovalPolicy",
    "approval_mode",
    # Output budgets
    "AFD_OUTPUT_BUDGET_META_KEY",
    "MAX_OUTPUT_BUDGET_BYTES",
    "OutputBudget",
    "Clock",
    "ClockInstant",
    "ManualClock",
    "RandomSource",
    "fixed_clock",
    "seeded_random",
    "system_clock",
    "system_random",
    # Command journal
    "FileJournalSink",
    "JournalContextDigest",
    "JournalEntry",
    "JournalRange",
    "JournalRecord",
    "JournalSink",
    "JournalTape",
    "MemoryJournalSink",
    "create_context_digest",
    "is_journal_entry",
    "journal_actor",
    "parse_journal",
    "serialize_journal",
    "serialize_journal_entry",
    # Version
    "__version__",
    "CONTRACT_VERSION",
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
    "Recovery",
    "RecoveryKind",
    "RECOVERY_KINDS",
    "ErrorCode",
    "ErrorCodeInfo",
    "ErrorCodes",
    "ERROR_CODE_CATALOG",
    "HOST_ERROR_CODE_PREFIX",
    "create_error",
    "validation_error",
    "not_found_error",
    "rate_limit_error",
    "timeout_error",
    "internal_error",
    "wrap_error",
    "is_command_error",
    "is_command_recovery",
    # Metadata types
    "Source",
    "PlanStep",
    "PlanStepStatus",
    "Alternative",
    "Warning",
    "WarningSeverity",
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
    "DEFAULT_MAX_BATCH_SIZE",
    "DEFAULT_MAX_BATCH_PARALLELISM",
    "BatchCommand",
    "BatchOptions",
    "BatchRequest",
    "BatchCommandResult",
    "BatchSummary",
    "BatchTiming",
    "BatchWarning",
    "BatchResult",
    "check_batch_limits",
    "create_batch_request",
    "calculate_batch_confidence",
    "create_batch_result",
    "create_failed_batch_result",
    "is_batch_request",
    "is_batch_result",
    "is_batch_command",
    # Core command registry and middleware
    "CallGrant",
    "CommandHandler",
    "CommandRegistry",
    "create_command_registry",
    "CommandMiddleware",
    "NextFn",
    "call_not_granted",
    # Expose options
    "ExposeOptions",
    "DEFAULT_EXPOSE",
    "CommandConfirmationMode",
    "CommandExample",
    "JsonSchema",
    "TaskSupport",
    "command_result_output_schema",
    "command_to_mcp_tool",
    "command_tool_annotations",
    "serialize_command_examples",
    "validate_command_name",
    # MCP protocol types
    "LEGACY_PROTOCOL_VERSIONS",
    "MCP_PROTOCOL_VERSION",
    "MODERN_PROTOCOL_VERSION",
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
    # Names of the tools an AFD server provides itself
    "AFD_META_TOOL_NAMES",
    "AFD_BOOTSTRAP_COMMAND_NAMES",
    "AFD_CONTEXT_COMMAND_NAMES",
    "AFD_BUILTIN_TOOL_NAMES",
    "is_afd_builtin_name",
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
    "create_progress_chunk_with_steps",
    "create_data_chunk",
    "create_complete_chunk",
    "create_error_chunk",
    "is_progress_chunk",
    "is_data_chunk",
    "is_complete_chunk",
    "is_error_chunk",
    "is_stream_chunk",
    "is_streamable_command",
    "parse_stream_chunk",
    # Wire format
    "WireModel",
    "to_wire",
    "to_wire_json",
    "consume_stream",
    "collect_stream_data",
    "TimeoutController",
    "create_timeout_controller",
    # Direct execution
    "DirectClient",
    "DirectApprovalRequest",
    "DirectCommandRegistry",
    "create_direct_registry",
    "DirectRegistry",
    "SimpleRegistry",
    "DirectClientOptions",
    "DirectCallContext",
    "DirectContext",
    "CommandInfo",
    "DirectCommandDefinition",
    "DirectCommandParameter",
    "DirectPipelineStep",
    "DirectPipelineStepResult",
    "DirectPipelineResult",
    "create_direct_client",
    "create_registry",
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
