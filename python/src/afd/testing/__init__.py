"""
AFD Testing Utilities.

This module provides test fixtures and assertion helpers for testing
AFD commands. It makes it easy to write clear, concise tests for
command handlers.

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
]
