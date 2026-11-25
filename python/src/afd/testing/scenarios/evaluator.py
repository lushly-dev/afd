"""
Step Evaluator.

Compares actual command results against expected values defined in scenarios.
Supports various matchers: equals, contains, exists, length, gte, lte, etc.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from afd.core.errors import is_command_recovery
from afd.testing.scenarios.types import (
    AssertionResult,
    Expectation,
    InvalidExpectationError,
    StepError,
    find_expectation_problems,
    is_assertion_matcher,
)

# ============================================================================
# Evaluation Result Types
# ============================================================================


@dataclass
class EvaluationResult:
    """Result of evaluating a command result against an expectation."""

    passed: bool
    """Whether all assertions passed."""

    assertions: list[AssertionResult] = field(default_factory=list)
    """Individual assertion results."""

    error: StepError | None = None
    """Overall error if evaluation failed for unexpected reasons."""


# ============================================================================
# Main Evaluation Function
# ============================================================================


def evaluate_result(actual: dict[str, Any], expected: Expectation) -> EvaluationResult:
    """Evaluate a command result against an expectation.

    Args:
        actual: The actual CommandResult (as dict) from executing a command.
        expected: The Expectation from the scenario.

    Returns:
        EvaluationResult with pass/fail status and detailed assertions.

    Raises:
        InvalidExpectationError: When an assertion is malformed, such as a
            matcher object mixed with other keys or a matcher given the wrong
            type.
    """
    problems = find_expectation_problems(expected)
    if problems:
        raise InvalidExpectationError(problems)

    assertions: list[AssertionResult] = []
    all_passed = True

    # Check success status
    success_assertion = _evaluate_assertion(
        "success", actual.get("success"), expected.success, "equals"
    )
    assertions.append(success_assertion)
    if not success_assertion.passed:
        all_passed = False

    # If expecting success, check data assertions
    if expected.success and expected.data:
        data_assertions = _evaluate_data_assertions(actual.get("data"), expected.data, "data")
        for assertion in data_assertions:
            assertions.append(assertion)
            if not assertion.passed:
                all_passed = False

    # If expecting failure, check error assertions
    if not expected.success and expected.error:
        actual_error = actual.get("error")
        error_dict = actual_error if isinstance(actual_error, dict) else {}

        if expected.error.get("code"):
            code_assertion = _evaluate_assertion(
                "error.code", error_dict.get("code"), expected.error["code"], "equals"
            )
            assertions.append(code_assertion)
            if not code_assertion.passed:
                all_passed = False

        if expected.error.get("message"):
            msg_assertion = _evaluate_assertion(
                "error.message", error_dict.get("message"), expected.error["message"], "contains"
            )
            assertions.append(msg_assertion)
            if not msg_assertion.passed:
                all_passed = False

        expected_recovery = expected.error.get("recovery")
        if expected_recovery is not None:
            actual_recovery = error_dict.get("recovery")
            if actual_recovery is None:
                recovery_assertions = [_absent_assertion("error.recovery", expected_recovery)]
            elif not is_command_recovery(actual_recovery):
                recovery_assertions = [_unreadable_recovery(actual_recovery, expected_recovery)]
            else:
                recovery_assertions = _evaluate_data_assertions(
                    actual_recovery, expected_recovery, "error.recovery"
                )
            for assertion in recovery_assertions:
                assertions.append(assertion)
                if not assertion.passed:
                    all_passed = False

        expected_suggestion = expected.error.get("suggestion")
        if expected_suggestion is not None:
            actual_suggestion = error_dict.get("suggestion")
            suggestion_assertions = (
                _evaluate_matcher_assertions(
                    "error.suggestion", actual_suggestion, expected_suggestion
                )
                if is_assertion_matcher(expected_suggestion, "error.suggestion")
                else [
                    _evaluate_assertion(
                        "error.suggestion", actual_suggestion, expected_suggestion, "contains"
                    )
                ]
            )
            for assertion in suggestion_assertions:
                assertions.append(assertion)
                if not assertion.passed:
                    all_passed = False

    # Check reasoning assertion
    if expected.reasoning is not None:
        reasoning_assertion = _evaluate_assertion(
            "reasoning", actual.get("reasoning"), expected.reasoning, "contains"
        )
        assertions.append(reasoning_assertion)
        if not reasoning_assertion.passed:
            all_passed = False

    # Check confidence threshold
    if expected.confidence is not None:
        confidence_assertion = _evaluate_assertion(
            "confidence", actual.get("confidence"), expected.confidence, "gte"
        )
        assertions.append(confidence_assertion)
        if not confidence_assertion.passed:
            all_passed = False

    return EvaluationResult(passed=all_passed, assertions=assertions)


# ============================================================================
# Data Assertion Evaluation
# ============================================================================


def _evaluate_data_assertions(
    actual: Any, expected: dict[str, Any], base_path: str
) -> list[AssertionResult]:
    """Recursively evaluate data assertions using dot-notation paths."""
    results: list[AssertionResult] = []

    for key, expected_value in expected.items():
        path = f"{base_path}.{key}"
        results.extend(_evaluate_value(path, get_value_at_path(actual, key), expected_value))

    return results


def _is_object_like(value: Any) -> bool:
    return isinstance(value, (dict, list))


def _evaluate_value(path: str, actual: Any, expected: Any) -> list[AssertionResult]:
    """Evaluate one expected value: a matcher, a nested object of field assertions,
    a list holding objects (matched item by item), or a literal compared with deep equality."""
    if is_assertion_matcher(expected, path):
        return _evaluate_matcher_assertions(path, actual, expected)
    if isinstance(expected, list) and any(_is_object_like(item) for item in expected):
        return _evaluate_array_assertions(path, actual, expected)
    if isinstance(expected, dict):
        return _evaluate_data_assertions(actual, expected, path)
    return [_evaluate_assertion(path, actual, expected, "equals")]


def _evaluate_array_assertions(
    path: str, actual: Any, expected: list[Any]
) -> list[AssertionResult]:
    """An expected list holding objects is matched item by item: the lists must be the same
    length, and each item is evaluated like any expected value, so an object item checks only
    the fields it names and may use matchers. A list of plain values is compared whole, and
    ``{ equals: [...] }`` compares any list literally."""
    items = actual if isinstance(actual, list) else []
    results: list[AssertionResult] = []
    if not isinstance(actual, list) or len(actual) != len(expected):
        results.append(_evaluate_assertion(path, actual, len(expected), "length"))
    shared = min(len(items), len(expected))
    for index in range(shared):
        results.extend(_evaluate_value(f"{path}[{index}]", items[index], expected[index]))
    return results


def _evaluate_matcher_assertions(
    path: str, actual: Any, matcher: dict[str, Any]
) -> list[AssertionResult]:
    """Evaluate all matchers in an AssertionMatcher dict."""
    results: list[AssertionResult] = []

    if "equals" in matcher:
        results.append(_evaluate_assertion(path, actual, matcher["equals"], "equals"))

    if "contains" in matcher:
        results.append(_evaluate_assertion(path, actual, matcher["contains"], "contains"))

    if "matches" in matcher:
        results.append(_evaluate_assertion(path, actual, matcher["matches"], "matches"))

    if "exists" in matcher:
        results.append(_evaluate_assertion(path, actual, matcher["exists"], "exists"))

    not_exists_key = "notExists" if "notExists" in matcher else "not_exists"
    if not_exists_key in matcher:
        results.append(_evaluate_assertion(path, actual, matcher[not_exists_key], "notExists"))

    if "length" in matcher:
        results.append(_evaluate_assertion(path, actual, matcher["length"], "length"))

    if "includes" in matcher:
        results.append(_evaluate_assertion(path, actual, matcher["includes"], "includes"))

    if "gte" in matcher:
        results.append(_evaluate_assertion(path, actual, matcher["gte"], "gte"))

    if "lte" in matcher:
        results.append(_evaluate_assertion(path, actual, matcher["lte"], "lte"))

    if "between" in matcher:
        results.append(_evaluate_assertion(path, actual, matcher["between"], "between"))

    return results


# ============================================================================
# Single Assertion Evaluation
# ============================================================================


def _evaluate_assertion(path: str, actual: Any, expected: Any, matcher: str) -> AssertionResult:
    """Evaluate a single assertion."""
    passed = _run_matcher(actual, expected, matcher)

    return AssertionResult(
        path=path,
        matcher=matcher,
        passed=passed,
        expected=expected,
        actual=actual,
        description=describe_assertion(path, actual, expected, matcher, passed),
    )


def _unreadable_recovery(actual: Any, expected: Any) -> AssertionResult:
    """A recovery that breaks ``$defs/recovery`` is one every reader drops (``spec/recovery.md``,
    rule 7), so asserting its fields would certify a step no caller sees."""
    return AssertionResult(
        path="error.recovery",
        matcher="readable",
        passed=False,
        expected=expected,
        actual=actual,
        description=(
            "error.recovery is unreadable: it breaks $defs/recovery, so a reader drops it "
            "(spec/recovery.md, rule 7)"
        ),
    )


def _absent_assertion(path: str, expected: Any) -> AssertionResult:
    """A failed assertion for a value the expectation names but the result does not hold."""
    return AssertionResult(
        path=path,
        matcher="exists",
        passed=False,
        expected=expected,
        actual=None,
        description=describe_assertion(path, None, True, "exists", False),
    )


def _run_matcher(actual: Any, expected: Any, matcher: str) -> bool:
    """Run a matcher against actual and expected values."""
    if matcher == "equals":
        return _deep_equal(actual, expected)

    elif matcher == "contains":
        if isinstance(actual, str) and isinstance(expected, str):
            return expected in actual
        return False

    elif matcher == "matches":
        if isinstance(actual, str) and isinstance(expected, str):
            try:
                return bool(re.search(expected, actual))
            except re.error:
                return False
        return False

    elif matcher == "exists":
        if expected is True:
            return actual is not None
        return actual is None

    elif matcher == "notExists":
        if expected is True:
            return actual is None
        return actual is not None

    elif matcher == "length":
        if isinstance(actual, (list, str)):
            return len(actual) == expected
        return False

    elif matcher == "includes":
        if isinstance(actual, list):
            return any(_deep_equal(item, expected) for item in actual)
        return False

    elif matcher == "gte":
        return (
            isinstance(actual, (int, float))
            and isinstance(expected, (int, float))
            and actual >= expected
        )

    elif matcher == "lte":
        return (
            isinstance(actual, (int, float))
            and isinstance(expected, (int, float))
            and actual <= expected
        )

    elif matcher == "between":
        if (
            isinstance(actual, (int, float))
            and isinstance(expected, (list, tuple))
            and len(expected) == 2
        ):
            lo, hi = expected
            return actual >= lo and actual <= hi
        return False

    return False


def describe_assertion(path: str, actual: Any, expected: Any, matcher: str, passed: bool) -> str:
    """Generate a human-readable description for an assertion."""
    status = "\u2713" if passed else "\u2717"
    actual_str = _format_value(actual)
    expected_str = _format_value(expected)

    if matcher == "equals":
        return f"{status} {path} equals {expected_str} (got {actual_str})"
    elif matcher == "contains":
        return f'{status} {path} contains "{expected}" (got {actual_str})'
    elif matcher == "matches":
        return f"{status} {path} matches /{expected}/ (got {actual_str})"
    elif matcher == "exists":
        label = "exists" if expected else "does not exist"
        return f"{status} {path} {label} (got {actual_str})"
    elif matcher == "notExists":
        label = "does not exist" if expected else "exists"
        return f"{status} {path} {label} (got {actual_str})"
    elif matcher == "length":
        actual_len = len(actual) if isinstance(actual, (list, str)) else type(actual).__name__
        return f"{status} {path}.length equals {expected} (got {actual_len})"
    elif matcher == "includes":
        return f"{status} {path} includes {expected_str} (got {actual_str})"
    elif matcher == "gte":
        return f"{status} {path} >= {expected} (got {actual_str})"
    elif matcher == "lte":
        return f"{status} {path} <= {expected} (got {actual_str})"
    elif matcher == "between":
        if isinstance(expected, (list, tuple)) and len(expected) == 2:
            return f"{status} {path} between {expected[0]} and {expected[1]} (got {actual_str})"
        return f"{status} {path} between {expected} (got {actual_str})"
    else:
        return f"{status} {path}: {matcher}"


# ============================================================================
# Utility Functions
# ============================================================================


def get_value_at_path(obj: Any, path: str) -> Any:
    """Get a value at a dot-notation path.

    Supports array index syntax like 'items[0]'.

    Note: This is a Python enhancement over the TS evaluator which does NOT
    support array indexing. The TS executor has array index support only in
    its private getValueAtPath. Assertions using array paths will work in
    Python but not in TS.
    """
    if obj is None:
        return None

    parts = path.split(".")
    current = obj

    for part in parts:
        if current is None:
            return None
        if not isinstance(current, dict):
            return None

        # Handle array index access like "items[0]"
        array_match = re.match(r"^(\w+)\[(\d+)\]$", part)
        if array_match:
            prop_name = array_match.group(1)
            index = int(array_match.group(2))
            current = current.get(prop_name)
            if isinstance(current, list) and index < len(current):
                current = current[index]
            else:
                return None
        else:
            current = current.get(part)

    return current


def _deep_equal(a: Any, b: Any) -> bool:
    """Deep equality check."""
    if a is b:
        return True

    if type(a) is not type(b):
        # Allow int/float comparison, but never treat bool as int
        if (
            isinstance(a, (int, float))
            and isinstance(b, (int, float))
            and not isinstance(a, bool)
            and not isinstance(b, bool)
        ):
            return a == b
        return False

    if isinstance(a, dict):
        if set(a.keys()) != set(b.keys()):
            return False
        return all(_deep_equal(a[k], b[k]) for k in a)

    if isinstance(a, list):
        if len(a) != len(b):
            return False
        return all(_deep_equal(ai, bi) for ai, bi in zip(a, b, strict=True))

    return a == b


def _format_value(value: Any) -> str:
    """Format a value for display in assertion descriptions."""
    if value is None:
        return "None"
    if isinstance(value, str):
        truncated = value[:50] + "..." if len(value) > 50 else value
        return f'"{truncated}"'
    if isinstance(value, (dict, list)):
        try:
            s = json.dumps(value)
            return s[:100] + "..." if len(s) > 100 else s
        except (TypeError, ValueError):
            return "[object]"
    return str(value)
