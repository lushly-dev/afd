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
    ...     name="chat.connect",
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

__version__ = "0.1.0"

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

