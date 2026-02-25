"""
scenario-coverage command.

Analyzes test coverage of JTBD scenarios against known commands.

Port of packages/testing/src/commands/coverage.ts
"""

from __future__ import annotations

import os
from typing import Any

from afd.core.result import CommandResult, error, success
from afd.testing.scenarios.coverage import scenario_coverage
from afd.testing.scenarios.parser import parse_scenario_file


def _find_scenario_files(directory: str) -> list[str]:
	results: list[str] = []
	if not os.path.isdir(directory):
		return results
	for root, dirs, files in os.walk(directory):
		dirs[:] = [d for d in dirs if not d.startswith(".") and d != "node_modules"]
		for f in files:
			if f.endswith(".scenario.yaml") or f.endswith(".scenario.yml"):
				results.append(os.path.join(root, f))
	return sorted(results)


def scenario_coverage_cmd(input: dict[str, Any] | None = None) -> CommandResult[Any]:
	"""Analyze test coverage of JTBD scenarios against known commands.

	Input:
		directory: str - Directory containing scenarios
		known_commands: list[str] - Commands that should be tested
		known_errors: list[str] - Error codes that should be tested
		format: str - Output format (json, terminal, markdown)

	Returns:
		CommandResult with coverage data.
	"""
	params = input or {}
	directory = params.get("directory", "./scenarios")
	known_commands = params.get("known_commands") or params.get("knownCommands")
	known_errors = params.get("known_errors") or params.get("knownErrors")
	output_format = params.get("format", "json")

	# Discover and parse scenarios
	files = _find_scenario_files(directory)
	parsed_scenarios = []
	for filepath in files:
		result = parse_scenario_file(filepath)
		if result.success:
			parsed_scenarios.append((result.scenario, filepath))

	if not parsed_scenarios and not known_commands:
		return error(
			"NOT_FOUND",
			f"No scenario files found in {directory}",
			suggestion="Check that the directory contains .scenario.yaml files or provide knownCommands.",
		)

	# Calculate coverage
	report = scenario_coverage(
		parsed_scenarios,
		known_commands=known_commands,
		known_errors=known_errors,
	)

	# Format output
	formatted_output = ""
	if output_format == "terminal":
		formatted_output = _format_terminal(report)
	elif output_format == "markdown":
		formatted_output = _format_markdown(report)

	summary = report.summary

	return success(
		{
			"summary": {
				"total_scenarios": summary.total_scenarios,
				"total_steps": summary.total_steps,
				"commands_tested": summary.commands_tested,
				"commands_known": summary.commands_known,
				"commands_coverage": summary.commands_coverage,
				"commands_untested": summary.commands_untested,
				"errors_tested": summary.errors_tested,
				"errors_known": summary.errors_known,
				"errors_coverage": summary.errors_coverage,
				"errors_untested": summary.errors_untested,
				"jobs_count": summary.jobs_count,
				"jobs_names": summary.jobs_names,
			},
			"command_coverage": [
				{
					"command": c.command,
					"scenario_count": c.scenario_count,
					"step_count": c.step_count,
					"used_in": c.used_in,
					"has_error_tests": c.has_error_tests,
				}
				for c in report.command_coverage
			],
			"error_coverage": [
				{
					"error_code": e.error_code,
					"scenario_count": e.scenario_count,
					"tested_in": e.tested_in,
				}
				for e in report.error_coverage
			],
			"job_coverage": [
				{
					"job": j.job,
					"scenario_count": j.scenario_count,
					"tags": j.tags,
					"avg_steps": j.avg_steps,
				}
				for j in report.job_coverage
			],
			"formatted_output": formatted_output,
		},
		reasoning=f"Analyzed {summary.total_scenarios} scenario(s) covering {summary.commands_tested} command(s).",
		confidence=0.95,
	)


def _format_terminal(report: Any) -> str:
	s = report.summary
	lines: list[str] = [
		"\nCoverage Report",
		"===============",
		f"  Scenarios: {s.total_scenarios}",
		f"  Steps: {s.total_steps}",
		f"  Commands tested: {s.commands_tested}",
	]
	if s.commands_known is not None:
		pct = f"{s.commands_coverage:.0%}" if s.commands_coverage is not None else "N/A"
		lines.append(f"  Commands coverage: {pct} ({s.commands_tested}/{s.commands_known})")
	if s.commands_untested:
		lines.append(f"  Untested: {', '.join(s.commands_untested)}")
	return "\n".join(lines)


def _format_markdown(report: Any) -> str:
	s = report.summary
	lines: list[str] = [
		"# Coverage Report",
		"",
		"## Summary",
		f"- **Scenarios**: {s.total_scenarios}",
		f"- **Steps**: {s.total_steps}",
		f"- **Commands tested**: {s.commands_tested}",
	]
	if s.commands_known is not None:
		pct = f"{s.commands_coverage:.0%}" if s.commands_coverage is not None else "N/A"
		lines.append(f"- **Coverage**: {pct}")
	if s.commands_untested:
		lines.append(f"- **Untested**: {', '.join(s.commands_untested)}")
	return "\n".join(lines)
