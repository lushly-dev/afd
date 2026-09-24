"""
scenario-create command.

Generates new JTBD scenario files from templates.

Port of packages/testing/src/commands/create.ts
"""

from __future__ import annotations

import os
import re
from typing import Any

import yaml

from afd.core.result import CommandResult, error, success
from afd.testing.commands._files import SCENARIO_SUFFIXES, project_root, resolve_inside


def _blank_template(name: str, job: str, tags: list[str] | None = None) -> dict[str, Any]:
	return {
		"name": name,
		"description": f"When I want to {job}",
		"job": job,
		"tags": tags or [],
		"steps": [
			{
				"command": "example-command",
				"description": "Replace with your first step",
				"expect": {"success": True},
			}
		],
	}


def _crud_template(
	name: str, job: str, tags: list[str] | None = None, commands: list[str] | None = None
) -> dict[str, Any]:
	domain = (commands[0].split("-")[0] if commands else "item")
	create_cmd = f"{domain}-create"
	get_cmd = f"{domain}-get"
	update_cmd = f"{domain}-update"
	delete_cmd = f"{domain}-delete"
	list_cmd = f"{domain}-list"

	return {
		"name": name,
		"description": f"When I want to {job}",
		"job": job,
		"tags": tags or ["crud"],
		"steps": [
			{
				"command": create_cmd,
				"description": f"Create a new {domain}",
				"input": {"title": f"Test {domain}"},
				"expect": {"success": True},
			},
			{
				"command": get_cmd,
				"description": f"Verify the {domain} was created",
				"input": {"id": "${{ steps[0].data.id }}"},
				"expect": {"success": True},
			},
			{
				"command": update_cmd,
				"description": f"Update the {domain}",
				"input": {"id": "${{ steps[0].data.id }}", "title": f"Updated {domain}"},
				"expect": {"success": True},
			},
			{
				"command": list_cmd,
				"description": f"List all {domain}s",
				"expect": {"success": True},
			},
			{
				"command": delete_cmd,
				"description": f"Delete the {domain}",
				"input": {"id": "${{ steps[0].data.id }}"},
				"expect": {"success": True},
			},
		],
	}


def _workflow_template(
	name: str, job: str, tags: list[str] | None = None
) -> dict[str, Any]:
	return {
		"name": name,
		"description": f"When I want to {job}",
		"job": job,
		"tags": tags or ["workflow"],
		"steps": [
			{
				"command": "setup-command",
				"description": "Set up initial state",
				"expect": {"success": True},
			},
			{
				"command": "action-command",
				"description": "Perform the main action",
				"expect": {"success": True},
			},
			{
				"command": "verify-command",
				"description": "Verify the result",
				"expect": {"success": True},
			},
			{
				"command": "cleanup-command",
				"description": "Clean up state",
				"expect": {"success": True},
			},
		],
	}


def _validation_template(
	name: str, job: str, tags: list[str] | None = None
) -> dict[str, Any]:
	return {
		"name": name,
		"description": f"When I want to {job}",
		"job": job,
		"tags": tags or ["validation", "error-handling"],
		"steps": [
			{
				"command": "example-command",
				"description": "Test with missing required field",
				"input": {},
				"expect": {
					"success": False,
					"error": {"code": "VALIDATION_ERROR"},
				},
			},
			{
				"command": "example-get",
				"description": "Test with non-existent resource",
				"input": {"id": "non-existent-id"},
				"expect": {
					"success": False,
					"error": {"code": "NOT_FOUND"},
				},
			},
			{
				"command": "example-update",
				"description": "Test with invalid data",
				"input": {"id": "some-id", "invalid_field": True},
				"expect": {
					"success": False,
					"error": {"code": "VALIDATION_ERROR"},
				},
			},
		],
	}


TEMPLATES = {
	"basic": _blank_template,
	"crud": _crud_template,
	"workflow": _workflow_template,
	"validation": _validation_template,
}


# Line breaks YAML (1.1, as PyYAML reads it) recognizes, plus other control characters.
_HEADER_UNSAFE = re.compile(r"[\x00-\x1f\x7f\x85\u2028\u2029]+")


def _scenario_slug(name: str) -> str:
	"""A file name stem from a scenario name: letters and digits joined by '-'."""
	stem = name
	for suffix in SCENARIO_SUFFIXES:
		if stem.lower().endswith(suffix):
			stem = stem[: -len(suffix)]
	return re.sub(r"[\W_]+", "-", stem.lower()).strip("-")


def _header_text(value: str) -> str:
	"""A value that cannot break out of a one-line YAML comment."""
	return _HEADER_UNSAFE.sub(" ", value).strip()


def scenario_create(
	input: dict[str, Any] | None = None,
	*,
	root: str | os.PathLike[str] | None = None,
) -> CommandResult[Any]:
	"""Generate a new JTBD scenario file from a template.

	Input:
		name: str - Scenario name (required)
		job: str - Job description (required)
		template: str - Template type (basic, crud, workflow, validation)
		directory: str - Output directory (default: ./scenarios), inside the project root
		commands: list[str] - Commands to include
		tags: list[str] - Tags to apply
		overwrite: bool - Overwrite existing file

	Args:
		root: Project root that ``directory`` must stay inside (default: the
			current working directory). ``..`` segments, absolute paths and
			symlinks that leave the root are refused.

	Returns:
		CommandResult with created scenario data.
	"""
	params = input or {}
	name = params.get("name")
	job = params.get("job")
	template_type = params.get("template", "basic")
	directory = params.get("directory", "./scenarios")
	commands = params.get("commands")
	tags = params.get("tags")
	overwrite = params.get("overwrite", False) is True

	if not name or not isinstance(name, str):
		return error(
			"VALIDATION_ERROR",
			"Missing required field: name",
			suggestion="Provide a 'name' for the scenario.",
		)

	if not job or not isinstance(job, str):
		return error(
			"VALIDATION_ERROR",
			"Missing required field: job",
			suggestion="Provide a 'job' description for the scenario.",
		)

	template_fn = TEMPLATES.get(template_type)
	if not template_fn:
		return error(
			"VALIDATION_ERROR",
			f"Unknown template: {template_type}",
			suggestion=f"Available templates: {', '.join(TEMPLATES.keys())}",
		)

	slug = _scenario_slug(name)
	if not slug:
		return error(
			"VALIDATION_ERROR",
			"The scenario name must contain letters or digits",
			suggestion="Use a name such as 'create-todo'; it becomes the file name.",
		)

	# The directory and file are agent-controlled: keep both inside the project.
	base = project_root(root)
	target_dir = resolve_inside(str(directory), base) if isinstance(directory, str) else None
	filename = f"{slug}.scenario.yaml"
	filepath = target_dir / filename if target_dir is not None else None
	if filepath is None or resolve_inside(filepath, base) is None:
		return error(
			"VALIDATION_ERROR",
			f"Scenario directory is outside the project root: {str(directory)[:200]}",
			suggestion="Use a directory inside the project, such as ./scenarios.",
			details={"field": "directory"},
		)
	display_path = os.path.join(directory, filename)

	# Generate scenario
	if template_type == "crud" and commands:
		scenario_data = template_fn(name, job, tags, commands)
	else:
		scenario_data = template_fn(name, job, tags)

	# Checked before writing, so "overwritten" is true only when a file was replaced.
	existed = filepath.exists()
	if existed and not overwrite:
		return error(
			"ALREADY_EXISTS",
			f"Scenario file already exists: {display_path}",
			suggestion="Set overwrite=true to replace, or choose a different name.",
		)

	os.makedirs(target_dir, exist_ok=True)

	# Write YAML. The header is a comment: newlines in the name must not end it.
	yaml_content = f"# JTBD Scenario: {_header_text(name)}\n"
	yaml_content += f"# Template: {template_type}\n\n"
	yaml_content += yaml.dump(scenario_data, default_flow_style=False, sort_keys=False)

	with open(filepath, "w", encoding="utf-8") as f:
		f.write(yaml_content)

	return success(
		{
			"path": display_path,
			"scenario": scenario_data,
			"template": template_type,
			"overwritten": existed,
		},
		reasoning=f"Created {template_type} scenario '{_header_text(name)}' at {display_path}.",
		confidence=0.95,
	)
