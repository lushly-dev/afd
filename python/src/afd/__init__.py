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

__version__ = "0.2.0"

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
]

