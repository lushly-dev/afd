"""
Agent hints system for AFD testing.

Provides structured hints to help AI agents interpret command results
and determine next actions.

Port of packages/testing/src/mcp/hints.ts
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

T = TypeVar("T")


@dataclass
class AgentHints:
	"""Hints to help AI agents interpret results and decide next actions."""

	should_retry: bool
	related_commands: list[str]
	next_steps: list[str]
	interpretation_confidence: float
	low_confidence_steps: list[int] | None = None
	untested_commands: list[str] | None = None
	error_codes: list[str] | None = None


@dataclass
class AgentEnhancedResult:
	"""Command result with agent hints added."""

	success: bool
	data: Any | None = None
	error: dict[str, Any] | None = None
	_agent_hints: AgentHints | None = None


def generate_agent_hints(command_name: str, result: dict[str, Any]) -> AgentHints:
	"""Generate agent hints for a command result."""
	hints = AgentHints(
		should_retry=_should_retry_command(result),
		related_commands=_get_related_commands(command_name, result),
		next_steps=_suggest_next_steps(command_name, result),
		interpretation_confidence=_calculate_interpretation_confidence(result),
	)

	if not result.get("success") and result.get("error"):
		error = result["error"]
		code = error.get("code") if isinstance(error, dict) else getattr(error, "code", None)
		if code:
			hints.error_codes = [code]

	return hints


def generate_test_report_hints(report: dict[str, Any]) -> AgentHints:
	"""Generate agent hints specific to test reports."""
	summary = report.get("summary", {})
	scenarios = report.get("scenarios", [])

	pass_rate = summary.get("pass_rate", 0.0)

	hints = AgentHints(
		should_retry=False,
		related_commands=[],
		next_steps=[],
		interpretation_confidence=pass_rate,
	)

	failed_scenarios = [
		s for s in scenarios if s.get("outcome") in ("fail", "error")
	]

	if failed_scenarios:
		hints.next_steps.append(f"Review {len(failed_scenarios)} failed scenario(s)")
		hints.next_steps.append("Run with --verbose for detailed step output")
		hints.related_commands.append("scenario-suggest --context failed")

		error_types: set[str] = set()
		for scenario in failed_scenarios:
			for step in scenario.get("step_results", []):
				step_error = step.get("error")
				if step_error and step_error.get("type"):
					error_types.add(step_error["type"])
		if error_types:
			hints.error_codes = list(error_types)

	mismatch_steps: list[int] = []
	step_index = 0
	for scenario in scenarios:
		for step in scenario.get("step_results", []):
			if step.get("error", {}).get("type") == "expectation_mismatch":
				mismatch_steps.append(step_index)
			step_index += 1
	if mismatch_steps:
		hints.low_confidence_steps = mismatch_steps
		hints.next_steps.append(
			f"{len(mismatch_steps)} step(s) have expectation mismatches - consider reviewing assertions"
		)

	if pass_rate >= 0.95:
		hints.next_steps.append("All tests passing - safe to proceed")
	elif pass_rate >= 0.8:
		hints.next_steps.append("Most tests passing - review failures before proceeding")
	else:
		hints.should_retry = True
		hints.next_steps.append("Significant failures detected - fix issues before continuing")

	return hints


def generate_coverage_hints(
	tested: list[str],
	untested: list[str],
	coverage_percent: float,
) -> AgentHints:
	"""Generate agent hints for coverage results."""
	hints = AgentHints(
		should_retry=False,
		related_commands=[],
		next_steps=[],
		interpretation_confidence=0.95,
	)

	if untested:
		hints.untested_commands = untested
		hints.related_commands.append("scenario-create --template crud")
		hints.next_steps.append(f"{len(untested)} command(s) have no test coverage")
		hints.next_steps.append("Consider using scenario-create to generate test templates")

		priority_commands = [
			cmd for cmd in untested if ".create" in cmd or ".delete" in cmd
		]
		if priority_commands:
			hints.next_steps.append(
				f"Priority: Test {', '.join(priority_commands)} (mutation commands)"
			)

	if coverage_percent >= 90:
		hints.next_steps.append("Excellent coverage - focus on edge cases")
	elif coverage_percent >= 70:
		hints.next_steps.append("Good coverage - add tests for remaining commands")
	else:
		hints.next_steps.append("Low coverage - prioritize adding test scenarios")

	return hints


def enhance_with_agent_hints(command_name: str, result: dict[str, Any]) -> dict[str, Any]:
	"""Enhance a command result with agent hints."""
	hints = generate_agent_hints(command_name, result)
	return {**result, "_agent_hints": hints}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _should_retry_command(result: dict[str, Any]) -> bool:
	"""Determine if a command should be retried based on result."""
	if result.get("success"):
		return False

	error = result.get("error")
	if not error:
		return False

	if isinstance(error, dict):
		retryable = error.get("retryable")
		suggestion = (error.get("suggestion") or "").lower()
		code = error.get("code", "")
	else:
		retryable = getattr(error, "retryable", None)
		suggestion = (getattr(error, "suggestion", "") or "").lower()
		code = getattr(error, "code", "")

	if retryable is True:
		return True
	if retryable is False:
		return False

	if any(kw in suggestion for kw in ("try again", "retry", "temporary")):
		return True

	transient_codes = {"TIMEOUT", "CONNECTION_ERROR", "RATE_LIMITED", "SERVICE_UNAVAILABLE"}
	if code in transient_codes:
		return True

	return False


def _get_related_commands(command_name: str, result: dict[str, Any]) -> list[str]:
	"""Get related commands based on the executed command."""
	related: list[str] = []
	category = command_name.split("-")[0] if "-" in command_name else command_name

	if category == "scenario":
		if command_name == "scenario-list":
			related.extend(["scenario-evaluate", "scenario-coverage"])
		elif command_name == "scenario-evaluate":
			related.extend(["scenario-coverage", "scenario-suggest"])
		elif command_name == "scenario-coverage":
			related.extend(["scenario-suggest", "scenario-create"])
		elif command_name == "scenario-create":
			related.append("scenario-evaluate")

	if not result.get("success"):
		if "scenario-suggest --context failed" not in related:
			related.append("scenario-suggest --context failed")

	return related


def _suggest_next_steps(command_name: str, result: dict[str, Any]) -> list[str]:
	"""Suggest next steps based on command result."""
	steps: list[str] = []

	if result.get("success"):
		if command_name == "scenario-list":
			steps.append("Run scenario-evaluate to execute listed scenarios")
		elif command_name == "scenario-create":
			steps.append("Edit the generated scenario to add specific test cases")
			steps.append("Run scenario-evaluate to test the new scenario")
		elif command_name == "scenario-evaluate":
			steps.append("Run scenario-coverage to check test coverage")
		elif command_name == "scenario-coverage":
			steps.append("Use scenario-suggest to find gaps")
			steps.append("Create scenarios for untested commands")
	else:
		error = result.get("error")
		if error:
			suggestion = error.get("suggestion") if isinstance(error, dict) else getattr(error, "suggestion", None)
			if suggestion:
				steps.append(suggestion)

			code = error.get("code") if isinstance(error, dict) else getattr(error, "code", "")
			if code == "PARSE_ERROR":
				steps.append("Check scenario YAML syntax")
			elif code == "FILE_NOT_FOUND":
				steps.append("Verify the scenario file path exists")
			elif code == "VALIDATION_ERROR":
				steps.append("Review the scenario schema requirements")

	return steps


def _calculate_interpretation_confidence(result: dict[str, Any]) -> float:
	"""Calculate confidence in how accurately we can interpret the result."""
	confidence = 0.9

	if not result.get("success"):
		error = result.get("error")
		code = None
		if isinstance(error, dict):
			code = error.get("code")
		elif error:
			code = getattr(error, "code", None)
		if not code:
			confidence -= 0.2

	if result.get("reasoning"):
		confidence += 0.05

	sources = result.get("sources")
	if sources and len(sources) > 0:
		confidence += 0.05

	return max(0.0, min(1.0, confidence))
