"""Core types for Agent-First Development.

This module contains the foundational types used across all AFD applications:
- CommandResult: Standard response type for all commands
- CommandError: Structured error with recovery guidance
- Metadata types: Source, PlanStep, Alternative, Warning
- Handoff types: HandoffResult, HandoffCredentials, HandoffMetadata
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
from afd.core.commands import (
    CommandParameter,
    CommandDefinition,
    CommandHandler,
    CommandContext,
    CommandRegistry,
    create_command_registry,
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

__all__ = [
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
    # Command types
    "CommandParameter",
    "CommandDefinition",
    "CommandHandler",
    "CommandContext",
    "CommandRegistry",
    "create_command_registry",
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
]
