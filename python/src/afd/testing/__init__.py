"""
AFD Testing Utilities.

This module provides test fixtures, assertion helpers, non-throwing
validators, and test helper functions for testing AFD commands.

Example:
    >>> from afd.testing import assert_success, assert_error
    >>>
    >>> # Test a successful command
    >>> result = await my_command({"name": "Alice"})
    >>> data = assert_success(result)
    >>> assert data["id"] == 1
    >>>
    >>> # Test a failing command
    >>> result = await my_command({})
    >>> error = assert_error(result, "VALIDATION_ERROR")
    >>> assert "name" in error.message
    >>>
    >>> # Use validators for programmatic checks
    >>> from afd.testing import validate_result
    >>> vr = validate_result(result)
    >>> assert vr.valid
"""

from afd.testing.assertions import (
    assert_success,
    assert_error,
    assert_has_confidence,
    assert_has_reasoning,
    assert_has_sources,
    assert_has_plan,
    assert_has_warnings,
    assert_has_alternatives,
    assert_has_suggestion,
    assert_retryable,
    assert_step_status,
    assert_ai_result,
)
from afd.testing.fixtures import (
    command_context,
    mock_server,
    isolated_registry,
)
from afd.testing.scenarios import (
    Scenario,
    Step,
    Expectation,
    AssertionMatcher,
    StepResult,
    ScenarioResult,
    TestSummary,
    InProcessExecutor,
    InProcessExecutorConfig,
    validate_scenario,
    parse_scenario,
    parse_scenario_file,
    parse_scenario_dir,
    evaluate_result,
    scenario_coverage,
    TerminalReporter,
)
from afd.testing.helpers import (
    CommandTestResult,
    create_test_context,
    test_command,
    test_command_definition,
    test_command_multiple,
    create_mock_command,
    create_success_command,
    create_failure_command,
)
from afd.testing.validators import (
    ValidationError,
    ValidationWarning,
    ValidationResult,
    ResultValidationOptions,
    validate_result,
    validate_error,
    validate_command_definition,
)

# CLI Wrapper
from afd.testing.cli_wrapper import (
    CliWrapper,
    CliConfig,
    ExecuteResult,
    ExecuteSuccess,
    ExecuteError,
    create_cli_wrapper,
)

# Agent Hints
from afd.testing.hints import (
    AgentHints,
    AgentEnhancedResult,
    generate_agent_hints,
    generate_test_report_hints,
    generate_coverage_hints,
    enhance_with_agent_hints,
)

# Surface Validation
from afd.testing.surface import (
    validate_command_surface,
    SurfaceValidationResult,
    SurfaceFinding,
    SurfaceValidationOptions,
)

# Adapters
from afd.testing.adapters import (
    AppAdapter,
    create_adapter_registry,
    register_adapter,
    get_adapter,
    list_adapters,
    detect_adapter,
    reset_global_registry,
    create_generic_adapter,
)

# Scenario Commands
from afd.testing.commands import (
    scenario_list,
    scenario_evaluate,
    scenario_coverage_cmd,
    scenario_create,
    scenario_suggest,
)

# MCP Testing Server
from afd.testing.mcp import (
    McpTestingServer,
    create_mcp_testing_server,
)

__all__ = [
    # Assertions
    "assert_success",
    "assert_error",
    "assert_has_confidence",
    "assert_has_reasoning",
    "assert_has_sources",
    "assert_has_plan",
    "assert_has_warnings",
    "assert_has_alternatives",
    "assert_has_suggestion",
    "assert_retryable",
    "assert_step_status",
    "assert_ai_result",
    # Fixtures
    "command_context",
    "mock_server",
    "isolated_registry",
    # Scenarios
    "Scenario",
    "Step",
    "Expectation",
    "AssertionMatcher",
    "StepResult",
    "ScenarioResult",
    "TestSummary",
    "InProcessExecutor",
    "InProcessExecutorConfig",
    "validate_scenario",
    "parse_scenario",
    "parse_scenario_file",
    "parse_scenario_dir",
    "evaluate_result",
    "scenario_coverage",
    "TerminalReporter",
    # Helpers
    "CommandTestResult",
    "create_test_context",
    "test_command",
    "test_command_definition",
    "test_command_multiple",
    "create_mock_command",
    "create_success_command",
    "create_failure_command",
    # Validators
    "ValidationError",
    "ValidationWarning",
    "ValidationResult",
    "ResultValidationOptions",
    "validate_result",
    "validate_error",
    "validate_command_definition",
    # CLI Wrapper
    "CliWrapper",
    "CliConfig",
    "ExecuteResult",
    "ExecuteSuccess",
    "ExecuteError",
    "create_cli_wrapper",
    # Agent Hints
    "AgentHints",
    "AgentEnhancedResult",
    "generate_agent_hints",
    "generate_test_report_hints",
    "generate_coverage_hints",
    "enhance_with_agent_hints",
    # Surface Validation
    "validate_command_surface",
    "SurfaceValidationResult",
    "SurfaceFinding",
    "SurfaceValidationOptions",
    # Adapters
    "AppAdapter",
    "create_adapter_registry",
    "register_adapter",
    "get_adapter",
    "list_adapters",
    "detect_adapter",
    "reset_global_registry",
    "create_generic_adapter",
    # Scenario Commands
    "scenario_list",
    "scenario_evaluate",
    "scenario_coverage_cmd",
    "scenario_create",
    "scenario_suggest",
    # MCP Testing Server
    "McpTestingServer",
    "create_mcp_testing_server",
]
