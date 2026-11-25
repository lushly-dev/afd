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

# Adapters
from afd.testing.adapters import (
    AppAdapter,
    create_adapter_registry,
    create_generic_adapter,
    detect_adapter,
    get_adapter,
    list_adapters,
    register_adapter,
    reset_global_registry,
)
from afd.testing.assertions import (
    assert_ai_result,
    assert_error,
    assert_has_alternatives,
    assert_has_confidence,
    assert_has_plan,
    assert_has_reasoning,
    assert_has_sources,
    assert_has_suggestion,
    assert_has_warnings,
    assert_retryable,
    assert_step_status,
    assert_success,
)

# CLI Wrapper
from afd.testing.cli_wrapper import (
    CliConfig,
    CliWrapper,
    ExecuteError,
    ExecuteResult,
    ExecuteSuccess,
    create_cli_wrapper,
)

# Scenario Commands
from afd.testing.commands import (
    scenario_coverage_cmd,
    scenario_create,
    scenario_evaluate,
    scenario_list,
    scenario_suggest,
)
from afd.testing.fixtures import (
    command_context,
    isolated_registry,
    mock_server,
)
from afd.testing.helpers import (
    CommandTestResult,
    create_failure_command,
    create_mock_command,
    create_success_command,
    create_test_context,
    test_command,
    test_command_definition,
    test_command_multiple,
)

# Agent Hints
from afd.testing.hints import (
    AgentEnhancedResult,
    AgentHints,
    enhance_with_agent_hints,
    generate_agent_hints,
    generate_coverage_hints,
    generate_test_report_hints,
)

# MCP Testing Server
from afd.testing.mcp import (
    McpTestingServer,
    create_mcp_testing_server,
)
from afd.testing.scenarios import (
    AssertionMatcher,
    Expectation,
    FollowExpectation,
    InProcessExecutor,
    InProcessExecutorConfig,
    Scenario,
    ScenarioResult,
    Step,
    StepResult,
    TerminalReporter,
    TestSummary,
    evaluate_result,
    parse_scenario,
    parse_scenario_dir,
    parse_scenario_file,
    scenario_coverage,
    validate_scenario,
)

# Surface Validation
from afd.testing.surface import (
    SurfaceFinding,
    SurfaceValidationOptions,
    SurfaceValidationResult,
    validate_command_surface,
)
from afd.testing.validators import (
    ResultValidationOptions,
    ValidationError,
    ValidationResult,
    ValidationWarning,
    validate_command_definition,
    validate_error,
    validate_result,
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
    "FollowExpectation",
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
