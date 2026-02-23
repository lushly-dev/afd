"""
JTBD Scenario types for workflow testing.

A scenario represents a complete user job (JTBD) expressed as
a sequence of commands with expected outcomes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

# ============================================================================
# Scenario Definition
# ============================================================================


@dataclass
class FixtureConfig:
    """Configuration for scenario starting state."""

    file: str
    """Path to fixture file (JSON)."""

    base: str | None = None
    """Optional base fixture to inherit from."""

    overrides: dict[str, Any] | None = None
    """Inline overrides to apply on top of fixture."""


@dataclass
class AssertionMatcher:
    """Matchers for complex assertions.

    Example (YAML):
        expect:
          data.count: { gte: 5 }
          data.name: { contains: "xbox" }
          data.items: { length: 3 }
    """

    contains: str | None = None
    """Value contains substring."""

    matches: str | None = None
    """Value matches regex pattern."""

    exists: bool | None = None
    """Value exists (not None)."""

    not_exists: bool | None = None
    """Value does not exist."""

    length: int | None = None
    """Array/string length equals."""

    includes: Any | None = None
    """Array includes value."""

    gte: float | None = None
    """Greater than or equal."""

    lte: float | None = None
    """Less than or equal."""

    between: tuple[float, float] | None = None
    """Value is between min and max (inclusive)."""


@dataclass
class Expectation:
    """Expected outcome of a step."""

    success: bool
    """Whether command should succeed."""

    data: dict[str, Any] | None = None
    """Assertions on the data field (JSONPath-like keys)."""

    error: dict[str, str | None] | None = None
    """Expected error details (for failure tests). Keys: code, message."""

    reasoning: str | None = None
    """Pattern match on reasoning field."""

    confidence: float | None = None
    """Minimum confidence threshold."""


@dataclass
class Step:
    """A single step in a scenario."""

    command: str
    """Command name to execute."""

    expect: Expectation
    """Expected results."""

    input: dict[str, Any] | None = None
    """Input parameters for the command."""

    description: str | None = None
    """Optional description explaining this step."""

    continue_on_failure: bool = False
    """Continue scenario even if this step fails."""


@dataclass
class Verification:
    """Final verification after all steps complete."""

    snapshot: str | None = None
    """Path to expected state snapshot (JSON)."""

    assertions: list[str] | None = None
    """Human-readable assertions."""

    custom: str | None = None
    """Path to custom verification script."""


@dataclass
class Scenario:
    """A JTBD scenario defining a complete user workflow."""

    name: str
    """Human-readable name."""

    description: str
    """What job this accomplishes (user story format)."""

    job: str
    """Job identifier (kebab-case)."""

    steps: list[Step]
    """Steps to execute."""

    tags: list[str] = field(default_factory=list)
    """Categorization tags for filtering."""

    version: str | None = None
    """Schema version."""

    fixture: FixtureConfig | None = None
    """Starting state configuration."""

    isolation: Literal['fresh', 'chained'] | None = None
    """Isolation mode: fresh (default) or chained."""

    depends_on: list[str] | None = None
    """Dependencies if isolation is 'chained'."""

    timeout: int | None = None
    """Per-scenario timeout in milliseconds."""

    verify: Verification | None = None
    """Final verification after all steps."""


# ============================================================================
# Report Types
# ============================================================================

StepOutcome = Literal['pass', 'fail', 'skip', 'error']
ScenarioOutcome = Literal['pass', 'fail', 'error', 'partial']


@dataclass
class StepError:
    """Detailed error information from a step."""

    type: Literal['command_failed', 'expectation_mismatch', 'timeout', 'parse_error', 'unknown']
    """Error type classification."""

    message: str
    """Human-readable error message."""

    expected: Any | None = None
    """Expected value (for expectation mismatches)."""

    actual: Any | None = None
    """Actual value received."""

    path: str | None = None
    """JSON path to the failing assertion."""

    cause: Exception | None = None
    """Original exception if available."""


@dataclass
class AssertionResult:
    """Result of a single assertion check."""

    path: str
    """Path being checked (e.g., 'data.items.length')."""

    matcher: str
    """Matcher used (e.g., 'equals', 'contains')."""

    passed: bool
    """Whether the assertion passed."""

    expected: Any
    """Expected value."""

    actual: Any
    """Actual value."""

    description: str | None = None
    """Human-readable description of the assertion."""


@dataclass
class StepResult:
    """Result of executing a single step in a scenario."""

    step_id: str
    """Step identifier."""

    command: str
    """Command that was invoked."""

    outcome: StepOutcome
    """Step execution outcome."""

    duration_ms: float
    """Execution duration in milliseconds."""

    assertions: list[AssertionResult] = field(default_factory=list)
    """Individual assertion results."""

    command_result: dict[str, Any] | None = None
    """Raw command result (if execution succeeded)."""

    error: StepError | None = None
    """Detailed error information (if outcome is fail/error)."""

    skipped_reason: str | None = None
    """Step was skipped due to previous failure."""


@dataclass
class ScenarioResult:
    """Result of executing an entire scenario."""

    scenario_path: str
    """Scenario file path."""

    job_name: str
    """Job name from the scenario."""

    outcome: ScenarioOutcome
    """Overall scenario outcome."""

    duration_ms: float
    """Total execution duration in milliseconds."""

    step_results: list[StepResult]
    """Results for each step."""

    passed_steps: int
    """Number of steps that passed."""

    failed_steps: int
    """Number of steps that failed."""

    skipped_steps: int
    """Number of steps that were skipped."""

    started_at: datetime
    """Timestamp when scenario started."""

    completed_at: datetime
    """Timestamp when scenario completed."""

    job_description: str | None = None
    """Job description."""

    fixture: str | None = None
    """Fixture that was used."""


@dataclass
class TestSummary:
    """Summary statistics for a test report."""

    total_scenarios: int = 0
    passed_scenarios: int = 0
    failed_scenarios: int = 0
    error_scenarios: int = 0
    total_steps: int = 0
    passed_steps: int = 0
    failed_steps: int = 0
    skipped_steps: int = 0
    pass_rate: float = 0.0


@dataclass
class TestReport:
    """Aggregated report for multiple scenarios."""

    title: str
    duration_ms: float
    scenarios: list[ScenarioResult]
    summary: TestSummary
    generated_at: datetime


# ============================================================================
# Factory Functions
# ============================================================================


def create_empty_summary() -> TestSummary:
    """Create an empty test summary."""
    return TestSummary()


def calculate_summary(scenarios: list[ScenarioResult]) -> TestSummary:
    """Calculate summary from scenario results."""
    summary = create_empty_summary()

    for scenario in scenarios:
        summary.total_scenarios += 1
        summary.total_steps += len(scenario.step_results)
        summary.passed_steps += scenario.passed_steps
        summary.failed_steps += scenario.failed_steps
        summary.skipped_steps += scenario.skipped_steps

        if scenario.outcome == 'pass':
            summary.passed_scenarios += 1
        elif scenario.outcome in ('fail', 'partial'):
            summary.failed_scenarios += 1
        elif scenario.outcome == 'error':
            summary.error_scenarios += 1

    summary.pass_rate = (
        summary.passed_scenarios / summary.total_scenarios if summary.total_scenarios > 0 else 0.0
    )

    return summary


def create_step_error(
    error_type: str,
    message: str,
    **kwargs: Any,
) -> StepError:
    """Create a step error."""
    return StepError(type=error_type, message=message, **kwargs)


# ============================================================================
# Type Guards
# ============================================================================

_MATCHER_KEYS = frozenset(
    ['contains', 'matches', 'exists', 'not_exists', 'notExists',
     'length', 'includes', 'gte', 'lte', 'between']
)


def is_assertion_matcher(value: Any) -> bool:
    """Check if a value is an AssertionMatcher-like dict."""
    if not isinstance(value, dict):
        return False
    return bool(set(value.keys()) & _MATCHER_KEYS)


def is_scenario(value: Any) -> bool:
    """Check if a value is a valid Scenario-like object."""
    if not isinstance(value, dict):
        return False
    return (
        isinstance(value.get('name'), str)
        and isinstance(value.get('description'), str)
        and isinstance(value.get('job'), str)
        and isinstance(value.get('tags', []), list)
        and isinstance(value.get('steps'), list)
    )
