"""
scenario-evaluate command.

Executes JTBD scenarios and returns detailed test results.

Port of packages/testing/src/commands/evaluate.ts
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any

from afd.core.result import CommandResult, error, success
from afd.testing.commands._files import (
	SCENARIO_SUFFIXES,
	find_scenario_files,
	project_root,
	resolve_inside,
)
from afd.testing.scenarios.executor import InProcessExecutor, InProcessExecutorConfig
from afd.testing.scenarios.parser import parse_scenario_file
from afd.testing.scenarios.types import (
	Scenario,
	ScenarioResult,
	TestReport,
	calculate_summary,
)


async def scenario_evaluate(
	input: dict[str, Any] | None = None,
	*,
	root: str | os.PathLike[str] | None = None,
) -> CommandResult[Any]:
	"""Execute JTBD scenarios and return detailed test results.

	``directory`` and ``scenarios`` must stay inside ``root`` (default: the
	current working directory), and explicit scenario files must be
	``*.scenario.yaml`` or ``*.scenario.yml``: an agent cannot make the
	evaluator read or run files elsewhere.

	Input:
		handler: Callable - Command handler function (required for execution)
		directory: str - Directory containing scenarios
		scenarios: list[str] - Specific scenario files to run
		tags: list[str] - Filter by tags
		job: str - Filter by job pattern
		fail_fast: bool - Stop on first failure (default: False)
		concurrency: int - Parallel execution limit (default: 1)
		format: str - Output format (json, terminal, markdown)
		timeout: int - Per-scenario timeout in ms
		title: str - Report title

	Returns:
		CommandResult with test report data.
	"""
	params = input or {}
	handler = params.get("handler")
	directory = params.get("directory", "./scenarios")
	scenario_files = params.get("scenarios")
	tags_filter = params.get("tags")
	job_filter = params.get("job")
	fail_fast = params.get("fail_fast", params.get("stopOnFailure", False))
	concurrency = params.get("concurrency", 1)
	output_format = params.get("format", "json")
	timeout = params.get("timeout")
	title = params.get("title", "JTBD Scenario Report")

	if not handler:
		return error(
			"HANDLER_NOT_CONFIGURED",
			"No command handler configured for scenario evaluation",
			suggestion="Provide a 'handler' function in the input.",
		)

	if isinstance(concurrency, bool) or not isinstance(concurrency, (int, float)) or concurrency < 1:
		return error(
			"VALIDATION_ERROR",
			f"Invalid concurrency: {concurrency!r}",
			suggestion="Pass 'concurrency' as a positive integer (default: 1).",
		)
	concurrency = int(concurrency)

	if timeout is not None and (
		isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0
	):
		return error(
			"VALIDATION_ERROR",
			f"Invalid timeout: {timeout!r}",
			suggestion="Pass 'timeout' as a positive number of milliseconds, or omit it.",
		)

	# Discover scenario files, inside the project root only.
	base = project_root(root)
	if scenario_files:
		if not isinstance(scenario_files, list) or not all(
			isinstance(f, str) for f in scenario_files
		):
			return error(
				"VALIDATION_ERROR",
				"'scenarios' must be a list of file paths",
				suggestion="Pass scenario file paths relative to the project root.",
			)
		for scenario_file in scenario_files:
			if (
				not scenario_file.endswith(SCENARIO_SUFFIXES)
				or resolve_inside(scenario_file, base) is None
			):
				return error(
					"VALIDATION_ERROR",
					f"Not a scenario file inside the project root: {scenario_file[:200]}",
					suggestion=(
						"Pass *.scenario.yaml files inside the project, "
						"or use 'directory' to discover them."
					),
					details={"field": "scenarios"},
				)
		files = scenario_files
	else:
		scenario_dir = resolve_inside(str(directory), base)
		if scenario_dir is None:
			return error(
				"VALIDATION_ERROR",
				f"Scenario directory is outside the project root: {str(directory)[:200]}",
				suggestion="Use a directory inside the project, such as ./scenarios.",
				details={"field": "directory"},
			)
		files = find_scenario_files(str(scenario_dir))

	if not files:
		return error(
			"NOT_FOUND",
			f"No scenario files found in {directory}",
			suggestion="Check that the directory contains .scenario.yaml files.",
		)

	# Parse scenarios
	parsed_scenarios = []
	for filepath in files:
		result = parse_scenario_file(filepath)
		if result.success:
			scenario = result.scenario
			# Apply filters
			if job_filter and job_filter.lower() not in scenario.job.lower():
				continue
			if tags_filter and not all(t in scenario.tags for t in tags_filter):
				continue
			parsed_scenarios.append((scenario, filepath))

	if not parsed_scenarios:
		return error(
			"NOT_FOUND",
			"No scenarios matched the given filters",
			suggestion="Adjust your filters or add more scenarios.",
		)

	# Execute scenarios
	start_time = time.monotonic()
	results: list[ScenarioResult] = []

	config = InProcessExecutorConfig(
		handler=handler,
		stop_on_failure=fail_fast,
	)
	executor = InProcessExecutor(config)

	async def run_one(scenario: Scenario, filepath: str) -> ScenarioResult:
		try:
			if timeout is None:
				result = await executor.execute(scenario)
			else:
				result = await asyncio.wait_for(executor.execute(scenario), timeout / 1000)
		except Exception:
			return ScenarioResult(
				scenario_path=filepath,
				job_name=scenario.job,
				outcome="error",
				duration_ms=0,
				step_results=[],
				passed_steps=0,
				failed_steps=0,
				skipped_steps=len(scenario.steps),
				started_at=datetime.now(timezone.utc),
				completed_at=datetime.now(timezone.utc),
			)
		result.scenario_path = filepath
		return result

	# Run in batches of `concurrency`; fail_fast stops after the failing batch.
	for i in range(0, len(parsed_scenarios), concurrency):
		batch = parsed_scenarios[i : i + concurrency]
		batch_results = await asyncio.gather(*(run_one(s, p) for s, p in batch))
		results.extend(batch_results)
		if fail_fast and any(r.outcome in ("fail", "error") for r in batch_results):
			break

	total_duration = int((time.monotonic() - start_time) * 1000)
	summary = calculate_summary(results)

	report = TestReport(
		title=title,
		duration_ms=total_duration,
		scenarios=results,
		summary=summary,
		generated_at=datetime.now(timezone.utc),
	)

	# Format output
	formatted_output = ""
	if output_format == "terminal":
		formatted_output = _format_terminal(report)
	elif output_format == "markdown":
		formatted_output = _format_markdown(report)

	exit_code = 0 if summary.failed_scenarios == 0 and summary.error_scenarios == 0 else 1

	return success(
		{
			"report": {
				"title": report.title,
				"duration_ms": report.duration_ms,
				"summary": {
					"total_scenarios": summary.total_scenarios,
					"passed_scenarios": summary.passed_scenarios,
					"failed_scenarios": summary.failed_scenarios,
					"error_scenarios": summary.error_scenarios,
					"total_steps": summary.total_steps,
					"passed_steps": summary.passed_steps,
					"failed_steps": summary.failed_steps,
					"skipped_steps": summary.skipped_steps,
					"pass_rate": summary.pass_rate,
				},
				"scenarios": [
					{
						"scenario_path": r.scenario_path,
						"job_name": r.job_name,
						"outcome": r.outcome,
						"duration_ms": r.duration_ms,
						"passed_steps": r.passed_steps,
						"failed_steps": r.failed_steps,
						"skipped_steps": r.skipped_steps,
					}
					for r in results
				],
			},
			"exit_code": exit_code,
			"formatted_output": formatted_output,
		},
		reasoning=f"Executed {summary.total_scenarios} scenario(s): {summary.passed_scenarios} passed, {summary.failed_scenarios} failed.",
		confidence=0.95,
	)


def _format_terminal(report: TestReport) -> str:
	"""Format report for terminal output."""
	lines: list[str] = []
	s = report.summary
	lines.append(f"\n{report.title}")
	lines.append("=" * len(report.title))
	for r in report.scenarios:
		icon = {"pass": "✓", "fail": "✗", "error": "⚠", "partial": "◐"}.get(r.outcome, "○")
		lines.append(f"  {icon} {r.job_name} ({r.duration_ms}ms)")
	lines.append("")
	lines.append(
		f"Results: {s.passed_scenarios}/{s.total_scenarios} passed "
		f"({s.pass_rate:.0%}) in {report.duration_ms}ms"
	)
	return "\n".join(lines)


def _format_markdown(report: TestReport) -> str:
	"""Format report as markdown."""
	lines: list[str] = []
	s = report.summary
	lines.append(f"# {report.title}")
	lines.append("")
	lines.append("## Summary")
	lines.append(f"- **Scenarios**: {s.passed_scenarios}/{s.total_scenarios} passed ({s.pass_rate:.0%})")
	lines.append(f"- **Steps**: {s.passed_steps}/{s.total_steps}")
	lines.append(f"- **Duration**: {report.duration_ms}ms")
	lines.append("")
	lines.append("## Scenarios")
	lines.append("| Job | Outcome | Duration |")
	lines.append("|-----|---------|----------|")
	for r in report.scenarios:
		lines.append(f"| {r.job_name} | {r.outcome} | {r.duration_ms}ms |")
	return "\n".join(lines)
