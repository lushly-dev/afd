"""Tests for scenario-coverage and scenario-suggest commands."""

from __future__ import annotations

import os

from afd.testing.commands.coverage import scenario_coverage_cmd
from afd.testing.commands.suggest import scenario_suggest

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

ERROR_SCENARIO_YAML = """\
name: error-scenario
description: When I want to test errors
job: error-job
tags: [validation, failing]
steps:
  - command: bad-cmd
    expect:
      success: false
      error:
        code: VALIDATION_ERROR
"""

FLAKY_SCENARIO_YAML = """\
name: flaky-test
description: When I want to retry
job: flaky-job
tags: [flaky]
steps:
  - command: unstable-cmd
    expect:
      success: true
"""

def _write_scenario(directory: str, filename: str, content: str) -> str:
	"""Write a scenario YAML file and return its path."""
	path = os.path.join(directory, filename)
	with open(path, "w", encoding="utf-8") as f:
		f.write(content)
	return path

class TestScenarioCoverage:
	"""Tests for the scenario-coverage command."""

	def test_empty_directory_no_known_commands(self, tmp_path):
		"""Returns error with empty directory and no known_commands."""
		result = scenario_coverage_cmd({"directory": str(tmp_path)})
		assert result.success is False
		assert result.error.code == "NOT_FOUND"

	def test_empty_directory_with_known_commands(self, tmp_path):
		"""Returns coverage report even with empty directory when knownCommands provided."""
		result = scenario_coverage_cmd({
			"directory": str(tmp_path),
			"known_commands": ["cmd-a", "cmd-b"],
		})
		assert result.success is True
		summary = result.data["summary"]
		assert summary["total_scenarios"] == 0
		assert summary["commands_tested"] == 0
		assert summary["commands_known"] == 2
		assert summary["commands_untested"] == ["cmd-a", "cmd-b"]

	def test_coverage_with_scenarios(self, tmp_path):
		"""Calculates correct coverage from scenario files."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		_write_scenario(str(tmp_path), "second.scenario.yaml", SECOND_SCENARIO_YAML)
		result = scenario_coverage_cmd({"directory": str(tmp_path)})
		assert result.success is True
		summary = result.data["summary"]
		assert summary["total_scenarios"] == 2
		assert summary["commands_tested"] >= 1

	def test_coverage_with_known_commands(self, tmp_path):
		"""Coverage percentage is calculated against known commands."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_coverage_cmd({
			"directory": str(tmp_path),
			"known_commands": ["test-cmd", "other-cmd"],
		})
		assert result.success is True
		summary = result.data["summary"]
		assert summary["commands_known"] == 2
		assert summary["commands_tested"] == 1
		assert summary["commands_coverage"] == 50.0
		assert summary["commands_untested"] == ["other-cmd"]

	def test_coverage_camelcase_alias(self, tmp_path):
		"""knownCommands (camelCase) alias works."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_coverage_cmd({
			"directory": str(tmp_path),
			"knownCommands": ["test-cmd"],
		})
		assert result.success is True
		assert result.data["summary"]["commands_known"] == 1

	def test_coverage_with_known_errors(self, tmp_path):
		"""Error coverage is calculated against known errors."""
		_write_scenario(str(tmp_path), "error.scenario.yaml", ERROR_SCENARIO_YAML)
		result = scenario_coverage_cmd({
			"directory": str(tmp_path),
			"known_errors": ["VALIDATION_ERROR", "NOT_FOUND"],
		})
		assert result.success is True
		summary = result.data["summary"]
		assert summary["errors_known"] == 2
		assert summary["errors_tested"] == 1
		assert summary["errors_untested"] == ["NOT_FOUND"]

	def test_coverage_knownErrors_camelcase(self, tmp_path):
		"""knownErrors (camelCase) alias works."""
		_write_scenario(str(tmp_path), "error.scenario.yaml", ERROR_SCENARIO_YAML)
		result = scenario_coverage_cmd({
			"directory": str(tmp_path),
			"knownErrors": ["VALIDATION_ERROR"],
		})
		assert result.success is True
		assert result.data["summary"]["errors_known"] == 1

	def test_coverage_report_structure(self, tmp_path):
		"""Coverage report has the expected structure."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_coverage_cmd({"directory": str(tmp_path)})
		assert result.success is True
		assert "summary" in result.data
		assert "command_coverage" in result.data
		assert "error_coverage" in result.data
		assert "job_coverage" in result.data
		assert "formatted_output" in result.data

	def test_coverage_command_detail(self, tmp_path):
		"""Command coverage entries have the expected fields."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_coverage_cmd({"directory": str(tmp_path)})
		assert result.success is True
		assert len(result.data["command_coverage"]) >= 1
		entry = result.data["command_coverage"][0]
		assert "command" in entry
		assert "scenario_count" in entry
		assert "step_count" in entry
		assert "used_in" in entry
		assert "has_error_tests" in entry

	def test_coverage_job_detail(self, tmp_path):
		"""Job coverage entries have expected fields."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_coverage_cmd({"directory": str(tmp_path)})
		assert result.success is True
		assert len(result.data["job_coverage"]) >= 1
		entry = result.data["job_coverage"][0]
		assert "job" in entry
		assert "scenario_count" in entry
		assert "tags" in entry
		assert "avg_steps" in entry

	def test_coverage_terminal_format(self, tmp_path):
		"""Terminal format produces non-empty formatted output."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_coverage_cmd({
			"directory": str(tmp_path),
			"format": "terminal",
		})
		assert result.success is True
		assert result.data["formatted_output"] != ""
		assert "Coverage Report" in result.data["formatted_output"]

	def test_coverage_markdown_format(self, tmp_path):
		"""Markdown format produces markdown-formatted output."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_coverage_cmd({
			"directory": str(tmp_path),
			"format": "markdown",
		})
		assert result.success is True
		assert "# Coverage Report" in result.data["formatted_output"]

	def test_coverage_json_format(self, tmp_path):
		"""JSON format produces empty formatted output."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_coverage_cmd({
			"directory": str(tmp_path),
			"format": "json",
		})
		assert result.success is True
		assert result.data["formatted_output"] == ""

	def test_coverage_default_params(self):
		"""Calling with None uses defaults."""
		result = scenario_coverage_cmd(None)
		# Default directory ./scenarios likely doesn't exist in test env,
		# so it should error with NOT_FOUND (no scenarios, no known_commands)
		assert result.success is False
		assert result.error.code == "NOT_FOUND"


class TestScenarioSuggest:
	"""Tests for the scenario-suggest command."""

	def test_missing_context(self):
		"""Returns validation error when context is not provided."""
		result = scenario_suggest({})
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"
		assert "context" in result.error.message.lower()

	def test_none_input(self):
		"""Returns validation error with None input."""
		result = scenario_suggest(None)
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"

	def test_unknown_context(self):
		"""Returns validation error for unknown context type."""
		result = scenario_suggest({"context": "unknown-ctx"})
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"
		assert "unknown" in result.error.message.lower()

	def test_command_context_missing_command(self):
		"""command context requires a 'command' field."""
		result = scenario_suggest({"context": "command"})
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"
		assert "command" in result.error.message.lower()

	def test_natural_context_missing_query(self):
		"""natural context requires a 'query' field."""
		result = scenario_suggest({"context": "natural"})
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"
		assert "query" in result.error.message.lower()

	def test_changed_files_context(self):
		"""changed-files context generates suggestions from file paths."""
		result = scenario_suggest({
			"context": "changed-files",
			"files": ["src/commands/todo/create.ts"],
		})
		assert result.success is True
		assert result.data["context"] == "changed-files"
		assert isinstance(result.data["suggestions"], list)
		assert result.data["total_found"] >= 1
		suggestion = result.data["suggestions"][0]
		assert "name" in suggestion
		assert "job" in suggestion
		assert "reason" in suggestion
		assert "confidence" in suggestion
		assert "priority" in suggestion
		assert "commands" in suggestion
		assert "todo-create" in suggestion["commands"]

	def test_changed_files_context_empty_files(self):
		"""changed-files with no files returns empty suggestions."""
		result = scenario_suggest({
			"context": "changed-files",
			"files": [],
		})
		assert result.success is True
		assert result.data["total_found"] == 0
		assert result.data["suggestions"] == []

	def test_changed_files_context_handler_pattern(self):
		"""changed-files maps handler files to commands."""
		result = scenario_suggest({
			"context": "changed-files",
			"files": ["src/handlers/user-update.ts"],
		})
		assert result.success is True
		assert result.data["total_found"] >= 1
		commands = result.data["suggestions"][0]["commands"]
		assert "user-update" in commands

	def test_uncovered_context(self, tmp_path):
		"""uncovered context finds commands without test coverage."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_suggest({
			"context": "uncovered",
			"directory": str(tmp_path),
			"known_commands": ["test-cmd", "uncovered-cmd"],
		})
		assert result.success is True
		assert result.data["total_found"] >= 1
		names = [s["name"] for s in result.data["suggestions"]]
		assert any("uncovered-cmd" in n for n in names)

	def test_uncovered_context_all_covered(self, tmp_path):
		"""uncovered context returns empty when all commands are covered."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_suggest({
			"context": "uncovered",
			"directory": str(tmp_path),
			"known_commands": ["test-cmd"],
		})
		assert result.success is True
		assert result.data["total_found"] == 0

	def test_failed_context(self, tmp_path):
		"""failed context finds scenarios with problem tags."""
		_write_scenario(str(tmp_path), "flaky.scenario.yaml", FLAKY_SCENARIO_YAML)
		_write_scenario(str(tmp_path), "good.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_suggest({
			"context": "failed",
			"directory": str(tmp_path),
		})
		assert result.success is True
		assert result.data["total_found"] >= 1
		names = [s["name"] for s in result.data["suggestions"]]
		assert any("flaky" in n for n in names)

	def test_failed_context_no_problem_tags(self, tmp_path):
		"""failed context returns empty when no problem tags found."""
		_write_scenario(str(tmp_path), "clean.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_suggest({
			"context": "failed",
			"directory": str(tmp_path),
		})
		assert result.success is True
		assert result.data["total_found"] == 0

	def test_command_context(self):
		"""command context generates suggestions for a specific command."""
		result = scenario_suggest({
			"context": "command",
			"command": "todo-create",
		})
		assert result.success is True
		assert result.data["total_found"] >= 2
		names = [s["name"] for s in result.data["suggestions"]]
		assert any("basic" in n for n in names)
		assert any("validation" in n for n in names)

	def test_command_context_mutation_edge_cases(self):
		"""Mutation commands (create/update/delete) get edge case suggestions."""
		result = scenario_suggest({
			"context": "command",
			"command": "todo-create",
		})
		assert result.success is True
		names = [s["name"] for s in result.data["suggestions"]]
		assert any("edge-cases" in n for n in names)

	def test_command_context_non_mutation_no_edge_cases(self):
		"""Non-mutation commands do not get edge case suggestions."""
		result = scenario_suggest({
			"context": "command",
			"command": "todo-list",
		})
		assert result.success is True
		names = [s["name"] for s in result.data["suggestions"]]
		assert not any("edge-cases" in n for n in names)

	def test_command_context_with_skeleton(self):
		"""include_skeleton produces skeleton scenario in suggestion."""
		result = scenario_suggest({
			"context": "command",
			"command": "todo-create",
			"include_skeleton": True,
		})
		assert result.success is True
		basic = next(s for s in result.data["suggestions"] if "basic" in s["name"])
		assert "skeleton" in basic
		assert basic["skeleton"]["name"] is not None
		assert len(basic["skeleton"]["steps"]) >= 1

	def test_natural_context_error_keyword(self):
		"""natural context matches 'error' keyword."""
		result = scenario_suggest({
			"context": "natural",
			"query": "error handling tests",
			"known_commands": ["cmd-a", "cmd-b"],
		})
		assert result.success is True
		assert result.data["total_found"] >= 1
		tags = result.data["suggestions"][0]["tags"]
		assert "error-handling" in tags or "validation" in tags

	def test_natural_context_crud_keyword(self):
		"""natural context matches 'crud' keyword."""
		result = scenario_suggest({
			"context": "natural",
			"query": "crud operations for items",
			"known_commands": ["item-create"],
		})
		assert result.success is True
		assert result.data["total_found"] >= 1
		tags = result.data["suggestions"][0]["tags"]
		assert "crud" in tags

	def test_natural_context_no_match(self):
		"""natural context with no matching keywords returns empty."""
		result = scenario_suggest({
			"context": "natural",
			"query": "something completely unrelated",
			"known_commands": [],
		})
		assert result.success is True
		assert result.data["total_found"] == 0

	def test_natural_context_with_skeleton(self):
		"""natural context with include_skeleton produces skeleton."""
		result = scenario_suggest({
			"context": "natural",
			"query": "error testing for api",
			"known_commands": ["api-get"],
			"include_skeleton": True,
		})
		assert result.success is True
		if result.data["total_found"] > 0:
			assert "skeleton" in result.data["suggestions"][0]

	def test_limit_parameter(self):
		"""Suggestions are limited by the limit parameter."""
		result = scenario_suggest({
			"context": "command",
			"command": "todo-create",
			"limit": 1,
		})
		assert result.success is True
		assert result.data["total_found"] <= 1

	def test_reasoning_in_response(self):
		"""Response includes reasoning string."""
		result = scenario_suggest({
			"context": "command",
			"command": "test-cmd",
		})
		assert result.success is True
		assert result.data["reasoning"] is not None
		assert len(result.data["reasoning"]) > 0

	def test_reasoning_when_empty(self, tmp_path):
		"""Reasoning reflects empty results."""
		result = scenario_suggest({
			"context": "uncovered",
			"directory": str(tmp_path),
			"known_commands": [],
		})
		assert result.success is True
		assert "No suggestions" in result.data["reasoning"] or "0" in result.data["reasoning"]

	def test_confidence_varies_by_result(self):
		"""Confidence is higher when suggestions are found."""
		result_with = scenario_suggest({
			"context": "command",
			"command": "todo-create",
		})
		result_without = scenario_suggest({
			"context": "uncovered",
			"known_commands": [],
		})
		assert result_with.confidence > result_without.confidence

	def test_knownCommands_camelcase(self, tmp_path):
		"""knownCommands (camelCase) alias works for suggest."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_suggest({
			"context": "uncovered",
			"directory": str(tmp_path),
			"knownCommands": ["test-cmd", "new-cmd"],
		})
		assert result.success is True
		names = [s["name"] for s in result.data["suggestions"]]
		assert any("new-cmd" in n for n in names)

	def test_includeSkeleton_camelcase(self):
		"""includeSkeleton (camelCase) alias works."""
		result = scenario_suggest({
			"context": "command",
			"command": "todo-create",
			"includeSkeleton": True,
		})
		assert result.success is True
		basic = next(s for s in result.data["suggestions"] if "basic" in s["name"])
		assert "skeleton" in basic
