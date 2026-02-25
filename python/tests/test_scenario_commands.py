"""Tests for JTBD scenario commands (list, create, evaluate, coverage, suggest)."""

from __future__ import annotations

import os

import pytest
import yaml

from afd.testing.commands.coverage import scenario_coverage_cmd
from afd.testing.commands.create import scenario_create
from afd.testing.commands.evaluate import scenario_evaluate
from afd.testing.commands.list import scenario_list
from afd.testing.commands.suggest import scenario_suggest


# ============================================================================
# Helpers
# ============================================================================

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


def _populate_scenarios(directory: str) -> list[str]:
	"""Write several scenario files into a directory, return paths."""
	paths = []
	paths.append(_write_scenario(directory, "test.scenario.yaml", VALID_SCENARIO_YAML))
	paths.append(_write_scenario(directory, "second.scenario.yaml", SECOND_SCENARIO_YAML))
	paths.append(_write_scenario(directory, "workflow.scenario.yaml", WORKFLOW_SCENARIO_YAML))
	return paths


# ============================================================================
# scenario_list Tests
# ============================================================================


class TestScenarioList:
	"""Tests for the scenario-list command."""

	def test_empty_directory(self, tmp_path):
		"""Returns success with zero scenarios for an empty directory."""
		result = scenario_list({"directory": str(tmp_path)})
		assert result.success is True
		assert result.data["total"] == 0
		assert result.data["filtered"] == 0
		assert result.data["scenarios"] == []

	def test_nonexistent_directory(self):
		"""Returns success with zero scenarios for a nonexistent directory."""
		result = scenario_list({"directory": "/nonexistent/path/that/does/not/exist"})
		assert result.success is True
		assert result.data["total"] == 0

	def test_discovers_scenario_files(self, tmp_path):
		"""Discovers .scenario.yaml files in the given directory."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path)})
		assert result.success is True
		assert result.data["total"] == 3
		assert result.data["filtered"] == 3
		names = [s["name"] for s in result.data["scenarios"]]
		assert "test-scenario" in names
		assert "second-scenario" in names
		assert "workflow-scenario" in names

	def test_scenario_data_structure(self, tmp_path):
		"""Each scenario entry has the expected fields."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		result = scenario_list({"directory": str(tmp_path)})
		assert result.success is True
		scenario = result.data["scenarios"][0]
		assert "name" in scenario
		assert "job" in scenario
		assert "description" in scenario
		assert "path" in scenario
		assert "tags" in scenario
		assert "step_count" in scenario
		assert "has_fixture" in scenario
		assert scenario["name"] == "test-scenario"
		assert scenario["job"] == "test-job"
		assert scenario["tags"] == ["smoke"]
		assert scenario["step_count"] == 1
		assert scenario["has_fixture"] is False

	def test_filter_by_tags(self, tmp_path):
		"""Filters scenarios by tag membership."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path), "tags": ["regression"]})
		assert result.success is True
		assert result.data["total"] == 3
		assert result.data["filtered"] == 1
		assert result.data["scenarios"][0]["name"] == "second-scenario"

	def test_filter_by_multiple_tags(self, tmp_path):
		"""All specified tags must be present."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({
			"directory": str(tmp_path),
			"tags": ["smoke", "regression"],
		})
		assert result.success is True
		assert result.data["filtered"] == 1
		assert result.data["scenarios"][0]["name"] == "second-scenario"

	def test_filter_by_job(self, tmp_path):
		"""Filters scenarios by job name (substring match, case-insensitive)."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path), "job": "verify"})
		assert result.success is True
		assert result.data["filtered"] == 1
		assert result.data["scenarios"][0]["job"] == "verify-job"

	def test_filter_by_job_case_insensitive(self, tmp_path):
		"""Job filter is case-insensitive."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path), "job": "VERIFY"})
		assert result.success is True
		assert result.data["filtered"] == 1

	def test_filter_by_search(self, tmp_path):
		"""Full-text search across name, description, and job."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path), "search": "workflow"})
		assert result.success is True
		assert result.data["filtered"] == 1
		assert result.data["scenarios"][0]["name"] == "workflow-scenario"

	def test_search_matches_description(self, tmp_path):
		"""Search term matches against scenario description."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path), "search": "verify"})
		assert result.success is True
		assert result.data["filtered"] >= 1
		names = [s["name"] for s in result.data["scenarios"]]
		assert "second-scenario" in names

	def test_combined_filters(self, tmp_path):
		"""Multiple filters are combined (AND logic)."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({
			"directory": str(tmp_path),
			"tags": ["smoke"],
			"job": "test",
		})
		assert result.success is True
		assert result.data["filtered"] == 1
		assert result.data["scenarios"][0]["name"] == "test-scenario"

	def test_sort_by_name_asc(self, tmp_path):
		"""Default sort is by name ascending."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path), "sort": "name", "order": "asc"})
		assert result.success is True
		names = [s["name"] for s in result.data["scenarios"]]
		assert names == sorted(names, key=str.lower)

	def test_sort_by_name_desc(self, tmp_path):
		"""Sort by name descending."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path), "sort": "name", "order": "desc"})
		assert result.success is True
		names = [s["name"] for s in result.data["scenarios"]]
		assert names == sorted(names, key=str.lower, reverse=True)

	def test_sort_by_job(self, tmp_path):
		"""Sort by job field."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path), "sort": "job", "order": "asc"})
		assert result.success is True
		jobs = [s["job"] for s in result.data["scenarios"]]
		assert jobs == sorted(jobs, key=str.lower)

	def test_sort_by_step_count(self, tmp_path):
		"""Sort by step_count field."""
		_populate_scenarios(str(tmp_path))
		result = scenario_list({"directory": str(tmp_path), "sort": "step_count", "order": "asc"})
		assert result.success is True
		counts = [s["step_count"] for s in result.data["scenarios"]]
		assert counts == sorted(counts)

	def test_recursive_search(self, tmp_path):
		"""Recursively finds scenarios in subdirectories."""
		subdir = tmp_path / "sub"
		subdir.mkdir()
		_write_scenario(str(tmp_path), "root.scenario.yaml", VALID_SCENARIO_YAML)
		_write_scenario(str(subdir), "nested.scenario.yaml", SECOND_SCENARIO_YAML)
		result = scenario_list({"directory": str(tmp_path), "recursive": True})
		assert result.success is True
		assert result.data["total"] == 2

	def test_non_recursive_search(self, tmp_path):
		"""Non-recursive search only finds files in the top directory."""
		subdir = tmp_path / "sub"
		subdir.mkdir()
		_write_scenario(str(tmp_path), "root.scenario.yaml", VALID_SCENARIO_YAML)
		_write_scenario(str(subdir), "nested.scenario.yaml", SECOND_SCENARIO_YAML)
		result = scenario_list({"directory": str(tmp_path), "recursive": False})
		assert result.success is True
		assert result.data["total"] == 1

	def test_filters_in_response(self, tmp_path):
		"""The filters used are reported in the response data."""
		result = scenario_list({
			"directory": str(tmp_path),
			"tags": ["smoke"],
			"job": "test",
			"search": "query",
		})
		assert result.success is True
		filters = result.data["filters"]
		assert filters["directory"] == str(tmp_path)
		assert filters["tags"] == ["smoke"]
		assert filters["job"] == "test"
		assert filters["search"] == "query"

	def test_default_params(self):
		"""Calling with None input uses defaults."""
		result = scenario_list(None)
		assert result.success is True
		assert result.data["filters"]["directory"] == "./scenarios"

	def test_ignores_non_scenario_files(self, tmp_path):
		"""Does not pick up files that don't match *.scenario.yaml."""
		_write_scenario(str(tmp_path), "test.scenario.yaml", VALID_SCENARIO_YAML)
		_write_scenario(str(tmp_path), "not-a-scenario.yaml", VALID_SCENARIO_YAML)
		_write_scenario(str(tmp_path), "readme.md", "# Hello")
		result = scenario_list({"directory": str(tmp_path)})
		assert result.success is True
		assert result.data["total"] == 1

	def test_yml_extension(self, tmp_path):
		"""Also discovers .scenario.yml files."""
		_write_scenario(str(tmp_path), "alt.scenario.yml", VALID_SCENARIO_YAML)
		result = scenario_list({"directory": str(tmp_path)})
		assert result.success is True
		assert result.data["total"] == 1


# ============================================================================
# scenario_create Tests
# ============================================================================


class TestScenarioCreate:
	"""Tests for the scenario-create command."""

	def test_missing_name(self, tmp_path):
		"""Returns validation error when name is missing."""
		result = scenario_create({"job": "test-job", "directory": str(tmp_path)})
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"
		assert "name" in result.error.message.lower()

	def test_missing_job(self, tmp_path):
		"""Returns validation error when job is missing."""
		result = scenario_create({"name": "test", "directory": str(tmp_path)})
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"
		assert "job" in result.error.message.lower()

	def test_missing_both_name_and_job(self):
		"""Returns validation error when both name and job are missing."""
		result = scenario_create({})
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"

	def test_none_input(self):
		"""Returns validation error with None input."""
		result = scenario_create(None)
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"

	def test_unknown_template(self, tmp_path):
		"""Returns validation error for an unknown template type."""
		result = scenario_create({
			"name": "test",
			"job": "test-job",
			"template": "nonexistent",
			"directory": str(tmp_path),
		})
		assert result.success is False
		assert result.error.code == "VALIDATION_ERROR"
		assert "template" in result.error.message.lower() or "nonexistent" in result.error.message.lower()

	def test_basic_template(self, tmp_path):
		"""Creates a scenario file with the basic template."""
		result = scenario_create({
			"name": "my-test",
			"job": "do-something",
			"template": "basic",
			"directory": str(tmp_path),
		})
		assert result.success is True
		assert result.data["template"] == "basic"
		assert result.data["scenario"]["name"] == "my-test"
		assert result.data["scenario"]["job"] == "do-something"
		assert result.data["scenario"]["description"] == "When I want to do-something"
		assert len(result.data["scenario"]["steps"]) == 1
		# Verify file was created
		filepath = result.data["path"]
		assert os.path.exists(filepath)
		assert filepath.endswith(".scenario.yaml")

	def test_basic_template_writes_valid_yaml(self, tmp_path):
		"""The written file is parseable YAML."""
		result = scenario_create({
			"name": "yaml-test",
			"job": "parse-yaml",
			"template": "basic",
			"directory": str(tmp_path),
		})
		assert result.success is True
		filepath = result.data["path"]
		with open(filepath, encoding="utf-8") as f:
			content = f.read()
		parsed = yaml.safe_load(content)
		assert parsed["name"] == "yaml-test"
		assert parsed["job"] == "parse-yaml"
		assert len(parsed["steps"]) >= 1

	def test_crud_template(self, tmp_path):
		"""Creates a scenario file with the crud template."""
		result = scenario_create({
			"name": "crud-test",
			"job": "manage-items",
			"template": "crud",
			"directory": str(tmp_path),
		})
		assert result.success is True
		assert result.data["template"] == "crud"
		steps = result.data["scenario"]["steps"]
		# CRUD template has create, get, update, list, delete steps
		assert len(steps) == 5
		commands = [s["command"] for s in steps]
		assert any("create" in c for c in commands)
		assert any("delete" in c for c in commands)
		assert any("list" in c for c in commands)

	def test_crud_template_with_commands(self, tmp_path):
		"""CRUD template uses provided commands to derive the domain."""
		result = scenario_create({
			"name": "todo-crud",
			"job": "manage-todos",
			"template": "crud",
			"directory": str(tmp_path),
			"commands": ["todo-create"],
		})
		assert result.success is True
		steps = result.data["scenario"]["steps"]
		commands = [s["command"] for s in steps]
		assert "todo-create" in commands
		assert "todo-get" in commands
		assert "todo-update" in commands
		assert "todo-delete" in commands
		assert "todo-list" in commands

	def test_workflow_template(self, tmp_path):
		"""Creates a scenario file with the workflow template."""
		result = scenario_create({
			"name": "wf-test",
			"job": "run-workflow",
			"template": "workflow",
			"directory": str(tmp_path),
		})
		assert result.success is True
		assert result.data["template"] == "workflow"
		steps = result.data["scenario"]["steps"]
		assert len(steps) == 4
		assert "workflow" in result.data["scenario"]["tags"]

	def test_validation_template(self, tmp_path):
		"""Creates a scenario file with the validation template."""
		result = scenario_create({
			"name": "val-test",
			"job": "validate-input",
			"template": "validation",
			"directory": str(tmp_path),
		})
		assert result.success is True
		assert result.data["template"] == "validation"
		steps = result.data["scenario"]["steps"]
		assert len(steps) == 3
		# Validation template steps should expect failures
		assert all(s["expect"]["success"] is False for s in steps)
		assert "validation" in result.data["scenario"]["tags"]

	def test_custom_tags(self, tmp_path):
		"""Passes custom tags to the template."""
		result = scenario_create({
			"name": "tagged-test",
			"job": "tag-it",
			"template": "basic",
			"directory": str(tmp_path),
			"tags": ["custom", "p0"],
		})
		assert result.success is True
		assert result.data["scenario"]["tags"] == ["custom", "p0"]

	def test_overwrite_protection(self, tmp_path):
		"""Refuses to overwrite existing file without overwrite=True."""
		scenario_create({
			"name": "existing",
			"job": "existing-job",
			"directory": str(tmp_path),
		})
		result = scenario_create({
			"name": "existing",
			"job": "existing-job",
			"directory": str(tmp_path),
		})
		assert result.success is False
		assert result.error.code == "ALREADY_EXISTS"

	def test_overwrite_allowed(self, tmp_path):
		"""Overwrites existing file when overwrite=True."""
		scenario_create({
			"name": "overwrite-me",
			"job": "first-job",
			"directory": str(tmp_path),
		})
		result = scenario_create({
			"name": "overwrite-me",
			"job": "second-job",
			"directory": str(tmp_path),
			"overwrite": True,
		})
		assert result.success is True
		assert result.data["scenario"]["job"] == "second-job"

	def test_creates_directory_if_missing(self, tmp_path):
		"""Creates the output directory if it doesn't exist."""
		nested_dir = os.path.join(str(tmp_path), "deep", "nested")
		result = scenario_create({
			"name": "deep-test",
			"job": "deep-job",
			"directory": nested_dir,
		})
		assert result.success is True
		assert os.path.exists(nested_dir)
		assert os.path.exists(result.data["path"])

	def test_filename_normalization(self, tmp_path):
		"""Name with spaces and underscores is normalized to kebab-case filename."""
		result = scenario_create({
			"name": "My Test Scenario",
			"job": "test-job",
			"directory": str(tmp_path),
		})
		assert result.success is True
		filename = os.path.basename(result.data["path"])
		assert " " not in filename
		assert "_" not in filename
		assert filename == "my-test-scenario.scenario.yaml"

	def test_default_template_is_basic(self, tmp_path):
		"""When no template is specified, defaults to basic."""
		result = scenario_create({
			"name": "default-template",
			"job": "default-job",
			"directory": str(tmp_path),
		})
		assert result.success is True
		assert result.data["template"] == "basic"

	def test_yaml_file_has_header_comments(self, tmp_path):
		"""Created file includes header comments."""
		result = scenario_create({
			"name": "header-test",
			"job": "header-job",
			"directory": str(tmp_path),
		})
		assert result.success is True
		with open(result.data["path"], encoding="utf-8") as f:
			content = f.read()
		assert "# JTBD Scenario:" in content
		assert "# Template:" in content


# ============================================================================
# scenario_evaluate Tests
# ============================================================================


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


# ============================================================================
# scenario_coverage_cmd Tests
# ============================================================================


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


# ============================================================================
# scenario_suggest Tests
# ============================================================================


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
