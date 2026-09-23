"""Tests for the scenario-evaluate command."""

from __future__ import annotations

import asyncio
import os

import pytest

from afd.testing.commands.evaluate import scenario_evaluate


VALID_SCENARIO_YAML = """\
name: test-scenario
description: When I want to test
job: test-job
tags: [smoke]
steps:
  - command: test-cmd
    expect:
      success: true
"""

SECOND_SCENARIO_YAML = """\
name: second-scenario
description: When I want to verify
job: verify-job
tags: [smoke, regression]
steps:
  - command: verify-cmd
    expect:
      success: true
  - command: check-cmd
    expect:
      success: true
"""

WORKFLOW_SCENARIO_YAML = """\
name: workflow-scenario
description: When I want a full workflow
job: workflow-job
tags: [workflow, integration]
steps:
  - command: setup-cmd
    expect:
      success: true
  - command: action-cmd
    expect:
      success: true
  - command: cleanup-cmd
    expect:
      success: true
"""


def _write_scenario(directory: str, filename: str, content: str) -> str:
	"""Write a scenario YAML file and return its path."""
	path = os.path.join(directory, filename)
	with open(path, "w", encoding="utf-8") as f:
		f.write(content)
	return path


class TestScenarioEvaluate:
	"""Tests for the scenario-evaluate command."""

	@pytest.mark.asyncio
	async def test_missing_handler(self):
		"""Returns error when handler is not provided."""
		result = await scenario_evaluate({})
		assert result.success is False
		assert result.error.code == "HANDLER_NOT_CONFIGURED"
		assert result.error.suggestion is not None

	@pytest.mark.asyncio
	async def test_missing_handler_none_input(self):
		"""Returns error with None input."""
		result = await scenario_evaluate(None)
		assert result.success is False
		assert result.error.code == "HANDLER_NOT_CONFIGURED"

	@pytest.mark.asyncio
	async def test_no_scenario_files(self, tmp_path):
		"""Returns error when no scenario files are found."""
		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
		})
		assert result.success is False
		assert result.error.code == "NOT_FOUND"

	@pytest.mark.asyncio
	async def test_evaluate_passing_scenario(self, tmp_path):
		"""Evaluates a passing scenario and returns correct report."""
		_write_scenario(str(tmp_path), "pass.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {"id": 1}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
		})
		assert result.success is True
		report = result.data["report"]
		assert report["summary"]["total_scenarios"] == 1
		assert report["summary"]["passed_scenarios"] == 1
		assert report["summary"]["failed_scenarios"] == 0
		assert result.data["exit_code"] == 0

	@pytest.mark.asyncio
	async def test_evaluate_failing_scenario(self, tmp_path):
		"""Evaluates a failing scenario and returns exit_code 1."""
		_write_scenario(str(tmp_path), "fail.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": False, "error": {"code": "ERR", "message": "fail"}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
		})
		assert result.success is True
		assert result.data["exit_code"] == 1
		assert result.data["report"]["summary"]["failed_scenarios"] >= 1

	@pytest.mark.asyncio
	async def test_evaluate_with_specific_scenarios(self, tmp_path):
		"""Runs only the specified scenario files."""
		path1 = _write_scenario(str(tmp_path), "one.scenario.yaml", VALID_SCENARIO_YAML)
		_write_scenario(str(tmp_path), "two.scenario.yaml", SECOND_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"scenarios": [path1],
		})
		assert result.success is True
		assert result.data["report"]["summary"]["total_scenarios"] == 1

	@pytest.mark.asyncio
	async def test_evaluate_filter_by_tags(self, tmp_path):
		"""Filters scenarios by tags during evaluation."""
		_write_scenario(str(tmp_path), "smoke.scenario.yaml", VALID_SCENARIO_YAML)
		_write_scenario(str(tmp_path), "workflow.scenario.yaml", WORKFLOW_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
			"tags": ["workflow"],
		})
		assert result.success is True
		assert result.data["report"]["summary"]["total_scenarios"] == 1

	@pytest.mark.asyncio
	async def test_evaluate_filter_by_job(self, tmp_path):
		"""Filters scenarios by job pattern during evaluation."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		_write_scenario(str(tmp_path), "workflow.scenario.yaml", WORKFLOW_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
			"job": "workflow",
		})
		assert result.success is True
		assert result.data["report"]["summary"]["total_scenarios"] == 1

	@pytest.mark.asyncio
	async def test_evaluate_no_matching_filters(self, tmp_path):
		"""Returns error when no scenarios match filters."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
			"tags": ["nonexistent-tag"],
		})
		assert result.success is False
		assert result.error.code == "NOT_FOUND"

	@pytest.mark.asyncio
	async def test_evaluate_terminal_format(self, tmp_path):
		"""Terminal format produces non-empty formatted_output."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
			"format": "terminal",
		})
		assert result.success is True
		assert result.data["formatted_output"] != ""

	@pytest.mark.asyncio
	async def test_evaluate_markdown_format(self, tmp_path):
		"""Markdown format produces markdown-formatted output."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
			"format": "markdown",
		})
		assert result.success is True
		assert "# " in result.data["formatted_output"]

	@pytest.mark.asyncio
	async def test_evaluate_json_format_no_formatted_output(self, tmp_path):
		"""JSON format produces empty formatted_output (data is in report)."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
			"format": "json",
		})
		assert result.success is True
		assert result.data["formatted_output"] == ""

	@pytest.mark.asyncio
	async def test_evaluate_report_structure(self, tmp_path):
		"""Report has expected top-level structure."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
		})
		assert result.success is True
		assert "report" in result.data
		assert "exit_code" in result.data
		assert "formatted_output" in result.data
		report = result.data["report"]
		assert "title" in report
		assert "duration_ms" in report
		assert "summary" in report
		assert "scenarios" in report

	@pytest.mark.asyncio
	async def test_evaluate_custom_title(self, tmp_path):
		"""Custom title is used in the report."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
			"title": "Custom Report Title",
		})
		assert result.success is True
		assert result.data["report"]["title"] == "Custom Report Title"

	@pytest.mark.asyncio
	async def test_evaluate_handler_exception(self, tmp_path):
		"""Handler exceptions are caught and produce a failure exit code."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			raise RuntimeError("Handler crashed")

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
		})
		assert result.success is True
		# The executor catches step-level exceptions and records them as failed steps
		summary = result.data["report"]["summary"]
		assert summary["failed_scenarios"] >= 1 or summary["error_scenarios"] >= 1
		assert result.data["exit_code"] == 1

	@pytest.mark.asyncio
	async def test_evaluate_timeout_marks_scenario_as_error(self, tmp_path):
		"""A scenario that exceeds `timeout` (ms) is reported as an error."""
		_write_scenario(str(tmp_path), "slow.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			await asyncio.sleep(5)
			return {"success": True, "data": {}}

		result = await scenario_evaluate({
			"handler": handler,
			"directory": str(tmp_path),
			"timeout": 20,
		})
		assert result.success is True
		assert result.data["report"]["summary"]["error_scenarios"] == 1
		assert result.data["report"]["scenarios"][0]["outcome"] == "error"
		assert result.data["exit_code"] == 1

	@pytest.mark.asyncio
	async def test_evaluate_concurrency_runs_scenarios_in_parallel(self, tmp_path):
		"""`concurrency` > 1 runs scenarios concurrently; the default runs them one at a time."""
		_write_scenario(str(tmp_path), "a.scenario.yaml", VALID_SCENARIO_YAML)
		_write_scenario(str(tmp_path), "b.scenario.yaml", SECOND_SCENARIO_YAML)
		_write_scenario(str(tmp_path), "c.scenario.yaml", WORKFLOW_SCENARIO_YAML)

		async def run(concurrency: int | None) -> int:
			in_flight = 0
			peak = 0

			async def handler(cmd, inp):
				nonlocal in_flight, peak
				in_flight += 1
				peak = max(peak, in_flight)
				await asyncio.sleep(0.01)
				in_flight -= 1
				return {"success": True, "data": {}}

			params = {"handler": handler, "directory": str(tmp_path)}
			if concurrency is not None:
				params["concurrency"] = concurrency
			result = await scenario_evaluate(params)
			assert result.success is True
			assert result.data["report"]["summary"]["passed_scenarios"] == 3
			return peak

		assert await run(None) == 1
		assert await run(3) == 3

	@pytest.mark.asyncio
	async def test_evaluate_reports_scenario_path(self, tmp_path):
		"""Each scenario entry carries the file it came from."""
		path = _write_scenario(str(tmp_path), "one.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({"handler": handler, "scenarios": [path]})
		assert result.data["report"]["scenarios"][0]["scenario_path"] == path

	@pytest.mark.asyncio
	@pytest.mark.parametrize(
		"params",
		[{"concurrency": 0}, {"concurrency": "4"}, {"timeout": 0}, {"timeout": "fast"}],
	)
	async def test_evaluate_rejects_invalid_concurrency_and_timeout(self, tmp_path, params):
		"""Invalid `concurrency` or `timeout` values return a validation error."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)

		async def handler(cmd, inp):
			return {"success": True, "data": {}}

		result = await scenario_evaluate({"handler": handler, "directory": str(tmp_path), **params})
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"
		assert result.error.suggestion is not None
