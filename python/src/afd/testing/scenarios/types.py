"""
JTBD Scenario types for workflow testing.

A scenario represents a complete user job (JTBD) expressed as
a sequence of commands with expected outcomes.
"""

from __future__ import annotations

import math
import re
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

    error: dict[str, Any] | None = None
    """Expected error details (for failure tests). Keys: ``code`` (equals), ``message``
    (contains), ``suggestion``: a string the suggestion must contain or an assertion matcher, and
    ``recovery``: the structured recovery (``spec/recovery.md``), checked like ``data``, so each
    named field must match and others are ignored, e.g.
    ``{"kind": "call", "command": "issue-check"}``."""

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

    follow: FollowExpectation | None = None
    """Follow the refusal's ``error.recovery`` (``spec/recovery.md``) and check that it gets
    further. Only on a step that expects a failure; see :class:`FollowExpectation`."""


@dataclass
class FollowExpectation:
    """Following a refused step's structured recovery, and what counts as getting further.

    The runner reads the refusal's ``error.recovery`` and takes its step:

    - ``call``: runs ``recovery.command`` with ``recovery.input`` and ``input``, and judges it by
      ``expect`` (default: it succeeds). With ``thenRetry``, it then repeats the refused call
      unchanged and judges that by ``retry`` (default: it succeeds).
    - ``fix-input``: repeats the refused command with its input, ``recovery.input`` and ``input``
      merged, and judges it by ``expect`` (default: it succeeds).
    - ``retry``: repeats the refused call unchanged at once, judged by ``expect`` (default: it
      succeeds). The runner does not wait ``afterMs``; a fixture that models time arranges it.

    Whatever ``expect`` says, a followed call that fails with the same command and code as the
    refusal fails the step: following the advice led straight back to it. A refusal with no
    recovery, or one whose kind is ``external`` or ``stop``, has nothing to follow and fails the
    step; assert those with ``expect.error.recovery`` instead.

    Example (YAML)::

        - command: cell-register
          input: { branch: fix/b, issues: [302], route: sol/high }
          expect:
            success: false
            error: { code: ALREADY_CLAIMED, recovery: { kind: call, command: issue-check } }
          follow:
            expect: { success: true, data: { dispatchable: [305] } }
    """

    input: dict[str, Any] | None = None
    """Values for the recovery's ``needs``, and nothing else: a scenario cannot add to or replace
    what the recovery says. Step references resolve here as in a step's ``input``."""

    expect: Expectation | None = None
    """What the recovery's own call returns. Default: ``Expectation(success=True)``."""

    retry: Expectation | None = None
    """``call`` with ``thenRetry`` only: what the repeated refused call returns. Default: success."""


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

    isolation: Literal["fresh", "chained"] | None = None
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

StepOutcome = Literal["pass", "fail", "skip", "error"]
ScenarioOutcome = Literal["pass", "fail", "error", "partial"]


@dataclass
class StepError:
    """Detailed error information from a step."""

    type: Literal["command_failed", "expectation_mismatch", "timeout", "parse_error", "unknown"]
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

    follow: list[StepResult] | None = None
    """The calls a ``follow`` made after the refusal, in order: the recovery's call and, with
    ``thenRetry``, the repeated refused call. A failure among them fails this step."""


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

        if scenario.outcome == "pass":
            summary.passed_scenarios += 1
        elif scenario.outcome in ("fail", "partial"):
            summary.failed_scenarios += 1
        elif scenario.outcome == "error":
            summary.error_scenarios += 1

    summary.pass_rate = (
        summary.passed_scenarios / summary.total_scenarios if summary.total_scenarios > 0 else 0.0
    )

    return summary


def create_step_error(
    error_type: Literal[
        "command_failed", "expectation_mismatch", "timeout", "parse_error", "unknown"
    ],
    message: str,
    **kwargs: Any,
) -> StepError:
    """Create a step error."""
    return StepError(type=error_type, message=message, **kwargs)


# ============================================================================
# Type Guards
# ============================================================================

_MATCHER_KEYS = frozenset(
    [
        "equals",
        "contains",
        "matches",
        "exists",
        "not_exists",
        "notExists",
        "length",
        "includes",
        "gte",
        "lte",
        "between",
    ]
)


class InvalidExpectationError(ValueError):
    """Raised when a scenario expectation is malformed (for example a matcher
    object mixed with field keys, or a matcher given the wrong type of value)."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


def _quote_list(keys: list[str]) -> str:
    return ", ".join(f"'{key}'" for key in keys)


def _is_finite_number(value: Any) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        # An integer too large for a float is Infinity to JavaScript, so not finite.
        return False


def is_assertion_matcher(value: Any, path: str = "value") -> bool:
    """Check if a value is an AssertionMatcher-like dict.

    An object is a matcher only when every one of its keys is a matcher key.
    Mixing matcher keys with other keys raises ``ValueError`` so typos or
    ambiguous assertions are never silently ignored.
    """
    if not isinstance(value, dict):
        return False
    keys = list(value.keys())
    other_keys = [key for key in keys if key not in _MATCHER_KEYS]
    if len(other_keys) == len(keys):
        return False
    if other_keys:
        matcher_keys = [key for key in keys if key in _MATCHER_KEYS]
        matcher_verb = "is a matcher key" if len(matcher_keys) == 1 else "are matcher keys"
        other_verb = "is" if len(other_keys) == 1 else "are"
        allowed = ", ".join(sorted(_MATCHER_KEYS))
        raise ValueError(
            f"Invalid assertion at {path}: {_quote_list(matcher_keys)} {matcher_verb} "
            f"but {_quote_list(other_keys)} {other_verb} not. "
            f"Use only matcher keys ({allowed}), or nest field assertions in their own object. "
            "To compare against a literal object, use { equals: ... }."
        )
    return True


def _matcher_value_problem(key: str, value: Any) -> str | None:
    """What is wrong with one matcher's value, as the TypeScript runner judges it."""
    if key == "contains":
        return None if isinstance(value, str) else "expects a string"
    if key == "matches":
        if not isinstance(value, str):
            return "expects a regular expression string"
        try:
            re.compile(value)
        except re.error:
            return "is not a valid regular expression"
        return None
    if key in ("exists", "notExists", "not_exists"):
        return None if isinstance(value, bool) else "expects true or false"
    if key == "length":
        # As JavaScript's Number.isInteger: 2.0 is an integer.
        ok = _is_finite_number(value) and float(value).is_integer() and value >= 0
        return None if ok else "expects a non-negative integer"
    if key in ("gte", "lte"):
        return None if _is_finite_number(value) else "expects a number"
    if key == "between":
        ok = (
            isinstance(value, (list, tuple))
            and len(value) == 2
            and _is_finite_number(value[0])
            and _is_finite_number(value[1])
            and value[0] <= value[1]
        )
        return None if ok else "expects [min, max] with min <= max"
    return None  # equals and includes take any value


def _collect_problems(expected: dict[str, Any], base_path: str, problems: list[str]) -> None:
    for key, value in expected.items():
        _collect_value_problems(value, f"{base_path}.{key}", problems)


def _collect_value_problems(value: Any, path: str, problems: list[str]) -> None:
    try:
        matcher = is_assertion_matcher(value, path)
    except ValueError as exc:
        problems.append(str(exc))
        return
    if matcher:
        for matcher_key, matcher_value in value.items():
            problem = _matcher_value_problem(matcher_key, matcher_value)
            if problem:
                problems.append(f"Invalid assertion at {path}: '{matcher_key}' {problem}")
    elif isinstance(value, list):
        # Items of an array that holds objects are evaluated item by item, so check them too.
        for index, item in enumerate(value):
            _collect_value_problems(item, f"{path}[{index}]", problems)
    elif isinstance(value, dict):
        _collect_problems(value, path, problems)


# The TypeScript runner's matcher keys, in its order: recovery problems are worded as it words
# them, and Python's ``not_exists`` alias is not among them.
_TS_MATCHER_KEYS = (
    "equals",
    "contains",
    "matches",
    "exists",
    "notExists",
    "length",
    "includes",
    "gte",
    "lte",
    "between",
)


def _collect_recovery_problems(value: Any, path: str, problems: list[str]) -> None:
    """Problems in one recovery assertion, as the TypeScript runner's ``collectValueProblems``
    finds and words them. Python's ``not_exists`` alias is refused: to the TypeScript runner it
    is a field name, so a recovery assertion using it would mean different things in the two."""
    if isinstance(value, list):
        for index, item in enumerate(value):
            _collect_recovery_problems(item, f"{path}[{index}]", problems)
        return
    if not isinstance(value, dict):
        return
    matcher_keys = [key for key in value if key in _TS_MATCHER_KEYS]
    others = [key for key in value if key not in _TS_MATCHER_KEYS]
    if matcher_keys and others:
        problems.append(
            f"Invalid assertion at {path}: {_quote_list(matcher_keys)} "
            f"{'is a matcher key' if len(matcher_keys) == 1 else 'are matcher keys'} but "
            f"{_quote_list(others)} {'is' if len(others) == 1 else 'are'} not. "
            f"Use only matcher keys ({', '.join(_TS_MATCHER_KEYS)}), or nest field assertions "
            "in their own object. To compare against a literal object, use { equals: ... }."
        )
    elif matcher_keys:
        for key, matcher_value in value.items():
            problem = _matcher_value_problem(key, matcher_value)
            if problem:
                problems.append(f"Invalid assertion at {path}: '{key}' {problem}")
    elif "not_exists" in value:
        problems.append(
            f"Invalid assertion at {path}: 'not_exists' is a field name to the TypeScript runner; "
            "use 'notExists'"
        )
    else:
        for key, item in value.items():
            _collect_recovery_problems(item, f"{path}.{key}", problems)


def find_expectation_problems(expectation: Expectation) -> list[str]:
    """List every problem in an expectation that would otherwise be silently
    ignored (empty when valid): malformed data assertions, ``data`` assertions on
    an expected failure, and ``error`` assertions on an expected success."""
    problems: list[str] = []
    if expectation.data is not None:
        if expectation.success:
            _collect_problems(expectation.data, "data", problems)
        else:
            problems.append("'data' assertions are only checked when 'success' is true")
    if expectation.error is not None and expectation.success:
        problems.append("'error' assertions are only checked when 'success' is false")
    recovery = expectation.error.get("recovery") if expectation.error else None
    if recovery is not None:
        if isinstance(recovery, dict):
            # The top of a recovery holds its fields, never a matcher, as in TypeScript.
            for key, item in recovery.items():
                _collect_recovery_problems(item, f"error.recovery.{key}", problems)
        else:
            problems.append("'error.recovery' must be an object of the recovery fields to check")
    suggestion = expectation.error.get("suggestion") if expectation.error else None
    if suggestion is not None and not isinstance(suggestion, str):
        before = len(problems)
        _collect_problems({"suggestion": suggestion}, "error", problems)
        if len(problems) == before and not is_assertion_matcher(suggestion):
            problems.append("'error.suggestion' must be a string or a matcher object")
    return problems


def matcher_problem(value: Any, path: str) -> str | None:
    """Why ``value`` is not a well-formed matcher object, or None when it is.

    As in the TypeScript runner, every key must be a matcher key (a typo such as ``matchs``
    beside a real matcher is refused, never ignored), and each value must suit its matcher.
    """
    if not isinstance(value, dict) or not value:
        return f"'{path}' must be a string or a matcher object such as {{contains: ...}}"
    others = sorted(set(value) - _MATCHER_KEYS)
    if others and len(others) == len(value):
        return (
            f"'{path}' has no matcher keys ({', '.join(repr(k) for k in others)}); use a string "
            f"or matcher keys ({', '.join(sorted(_MATCHER_KEYS))})"
        )
    if others:
        return (
            f"'{path}' mixes matcher keys with {', '.join(repr(k) for k in others)}; use only "
            f"matcher keys ({', '.join(sorted(_MATCHER_KEYS))})"
        )
    for key, matcher_value in value.items():
        problem = _matcher_value_problem(key, matcher_value)
        if problem:
            return f"'{path}.{key}' {problem}"
    return None


def is_scenario(value: Any) -> bool:
    """Check if a value is a valid Scenario-like object."""
    if not isinstance(value, dict):
        return False
    return (
        isinstance(value.get("name"), str)
        and isinstance(value.get("description"), str)
        and isinstance(value.get("job"), str)
        and isinstance(value.get("tags", []), list)
        and isinstance(value.get("steps"), list)
    )
