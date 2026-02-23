"""Server module for AFD applications.

This module provides the core server functionality for exposing AFD commands
via MCP (Model Context Protocol) and other transports.

Example:
    >>> from afd.server import create_server, define_command
    >>> from afd import success
    >>> from pydantic import BaseModel
    >>>
    >>> class CreateInput(BaseModel):
    ...     name: str
    ...
    >>> class CreateOutput(BaseModel):
    ...     id: str
    ...     name: str
    >>>
    >>> server = create_server("my-app")
    >>>
    >>> @server.command(
    ...     name="item-create",
    ...     description="Create a new item",
    ...     input_schema=CreateInput,
    ...     output_schema=CreateOutput,
    ... )
    ... async def create_item(input: CreateInput) -> CreateOutput:
    ...     return success(CreateOutput(id="123", name=input.name))

Bootstrap Commands:
    Every AFD server includes bootstrap commands for command discovery:

    >>> # Bootstrap commands are included automatically
    >>> from afd.server.bootstrap import get_bootstrap_commands
    >>>
    >>> # Or access them directly:
    >>> from afd.server.bootstrap import (
    ...     create_afd_help_command,
    ...     create_afd_docs_command,
    ...     create_afd_schema_command,
    ... )
"""

from afd.server.decorators import define_command
from afd.server.factory import create_server, MCPServer
from afd.server.bootstrap import (
    get_bootstrap_commands,
    create_afd_help_command,
    create_afd_docs_command,
    create_afd_schema_command,
)
from afd.server.middleware import (
    CommandMiddleware,
    NextFn,
    compose_middleware,
    default_middleware,
    create_auto_trace_id_middleware,
    create_logging_middleware,
    create_timing_middleware,
    create_retry_middleware,
    create_tracing_middleware,
    create_rate_limit_middleware,
    create_telemetry_middleware,
    TelemetryEvent,
    TelemetrySink,
    ConsoleTelemetrySink,
)
from afd.server.validation import (
    ValidationError,
    ValidationResult,
    EnhancedValidationResult,
    ValidationException,
    validate_input,
    validate_input_enhanced,
    validate_or_throw,
    is_valid,
    format_validation_errors,
    format_enhanced_validation_error,
    UuidStr,
    EmailStr,
    PaginationParams,
    SortParams,
    SearchParams,
    DateRangeParams,
)
from afd.server.handoff_schemas import (
    HandoffCredentialsSchema,
    HandoffMetadataSchema,
    HandoffResultSchema,
    ReconnectPolicySchema,
    validate_handoff,
)

__all__ = [
    "create_server",
    "define_command",
    "MCPServer",
    # Bootstrap commands
    "get_bootstrap_commands",
    "create_afd_help_command",
    "create_afd_docs_command",
    "create_afd_schema_command",
    # Middleware
    "CommandMiddleware",
    "NextFn",
    "compose_middleware",
    "default_middleware",
    "create_auto_trace_id_middleware",
    "create_logging_middleware",
    "create_timing_middleware",
    "create_retry_middleware",
    "create_tracing_middleware",
    "create_rate_limit_middleware",
    "create_telemetry_middleware",
    "TelemetryEvent",
    "TelemetrySink",
    "ConsoleTelemetrySink",
    # Validation
    "ValidationError",
    "ValidationResult",
    "EnhancedValidationResult",
    "ValidationException",
    "validate_input",
    "validate_input_enhanced",
    "validate_or_throw",
    "is_valid",
    "format_validation_errors",
    "format_enhanced_validation_error",
    # Validation patterns
    "UuidStr",
    "EmailStr",
    "PaginationParams",
    "SortParams",
    "SearchParams",
    "DateRangeParams",
    # Handoff schemas
    "HandoffCredentialsSchema",
    "HandoffMetadataSchema",
    "HandoffResultSchema",
    "ReconnectPolicySchema",
    "validate_handoff",
]
