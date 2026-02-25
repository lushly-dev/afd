"""Tests for scenario-list and scenario-create commands."""

from __future__ import annotations
import os
import yaml

from afd.testing.commands.create import scenario_create
from afd.testing.commands.list import scenario_list
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

def _populate_scenarios(directory: str) -> list[str]:
	"""Write several scenario files into a directory, return paths."""
	paths = []
	paths.append(_write_scenario(directory, "test.scenario.yaml", VALID_SCENARIO_YAML))
	paths.append(_write_scenario(directory, "second.scenario.yaml", SECOND_SCENARIO_YAML))
	paths.append(_write_scenario(directory, "workflow.scenario.yaml", WORKFLOW_SCENARIO_YAML))
	return paths

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
