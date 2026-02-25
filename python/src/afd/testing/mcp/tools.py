"""
MCP tool definitions for AFD testing.

Generates MCP tool specifications from the scenario commands.

Port of packages/testing/src/mcp/tools.ts
"""

from __future__ import annotations

from typing import Any, Callable


def generate_tools() -> list[dict[str, Any]]:
	"""Generate MCP tool definitions for all scenario commands."""
	return [
		{
			"name": "scenario-list",
			"description": (
				"List JTBD (Jobs-to-be-Done) scenario files. Returns scenario names, "
				"jobs, tags, and metadata. Use to discover available test scenarios "
				"before running them."
			),
			"inputSchema": {
				"type": "object",
				"properties": {
					"directory": {
						"type": "string",
						"description": "Directory to search for scenarios (default: ./scenarios)",
					},
					"tags": {
						"type": "array",
						"items": {"type": "string"},
						"description": 'Filter scenarios by tags (e.g., ["smoke", "crud"])',
					},
					"job": {
						"type": "string",
						"description": "Filter scenarios by job name pattern",
					},
					"recursive": {
						"type": "boolean",
						"description": "Search subdirectories recursively (default: true)",
					},
				},
				"additionalProperties": False,
			},
		},
		{
			"name": "scenario-evaluate",
			"description": (
				"Execute JTBD scenarios and return detailed test results. Runs scenarios "
				"against a command handler, supports parallel execution, and outputs in "
				"multiple formats (json, terminal, markdown)."
			),
			"inputSchema": {
				"type": "object",
				"properties": {
					"directory": {
						"type": "string",
						"description": "Directory containing scenarios",
					},
					"scenarios": {
						"type": "array",
						"items": {"type": "string"},
						"description": "Specific scenario files to run",
					},
					"tags": {
						"type": "array",
						"items": {"type": "string"},
						"description": "Run scenarios matching these tags",
					},
					"job": {
						"type": "string",
						"description": "Run scenarios matching this job pattern",
					},
					"concurrency": {
						"type": "number",
						"description": "Number of scenarios to run in parallel (default: 1)",
					},
					"stopOnFailure": {
						"type": "boolean",
						"description": "Stop execution on first failure (default: false)",
					},
					"format": {
						"type": "string",
						"enum": ["json", "terminal", "markdown"],
						"description": "Output format (default: json)",
					},
					"verbose": {
						"type": "boolean",
						"description": "Include detailed step-by-step output",
					},
				},
				"additionalProperties": False,
			},
		},
		{
			"name": "scenario-coverage",
			"description": (
				"Analyze test coverage of JTBD scenarios against known commands. "
				"Shows which commands are tested, untested, and calculates coverage percentage."
			),
			"inputSchema": {
				"type": "object",
				"properties": {
					"directory": {
						"type": "string",
						"description": "Directory containing scenarios",
					},
					"knownCommands": {
						"type": "array",
						"items": {"type": "string"},
						"description": "List of all commands that should be tested",
					},
					"format": {
						"type": "string",
						"enum": ["json", "markdown"],
						"description": "Output format (default: json)",
					},
				},
				"required": ["knownCommands"],
				"additionalProperties": False,
			},
		},
		{
			"name": "scenario-create",
			"description": (
				"Generate a new JTBD scenario file from a template. Creates properly "
				"structured YAML with job definition, setup, and steps."
			),
			"inputSchema": {
				"type": "object",
				"properties": {
					"name": {
						"type": "string",
						"description": "Scenario name (becomes filename)",
					},
					"job": {
						"type": "string",
						"description": "Job-to-be-done description",
					},
					"template": {
						"type": "string",
						"enum": ["basic", "crud", "workflow", "validation"],
						"description": "Template type (default: basic)",
					},
					"directory": {
						"type": "string",
						"description": "Output directory (default: ./scenarios)",
					},
					"commands": {
						"type": "array",
						"items": {"type": "string"},
						"description": "Commands to include in the scenario",
					},
					"tags": {
						"type": "array",
						"items": {"type": "string"},
						"description": "Tags to apply to the scenario",
					},
				},
				"required": ["name", "job"],
				"additionalProperties": False,
			},
		},
		{
			"name": "scenario-suggest",
			"description": (
				"Get scenario suggestions based on context. Supports multiple strategies: "
				"changed-files, uncovered, failed, command, natural."
			),
			"inputSchema": {
				"type": "object",
				"properties": {
					"context": {
						"type": "string",
						"enum": ["changed-files", "uncovered", "failed", "command", "natural"],
						"description": "Context type for suggestions",
					},
					"files": {
						"type": "array",
						"items": {"type": "string"},
						"description": "Changed files (for changed-files context)",
					},
					"command": {
						"type": "string",
						"description": "Specific command (for command context)",
					},
					"query": {
						"type": "string",
						"description": "Natural language query (for natural context)",
					},
					"directory": {
						"type": "string",
						"description": "Directory containing scenarios",
					},
					"knownCommands": {
						"type": "array",
						"items": {"type": "string"},
						"description": "Known commands for coverage analysis",
					},
					"limit": {
						"type": "number",
						"description": "Maximum suggestions to return (default: 5)",
					},
					"includeSkeleton": {
						"type": "boolean",
						"description": "Include skeleton scenario in suggestions",
					},
				},
				"required": ["context"],
				"additionalProperties": False,
			},
		},
	]


def _validate_input(input: Any, required_fields: list[str] | None = None) -> dict[str, Any]:
	"""Validate input against expected types."""
	if input is None:
		return {}
	if not isinstance(input, dict):
		raise ValueError("Input must be an object")
	for field in required_fields or []:
		if field not in input or input[field] is None:
			raise ValueError(f"Missing required field: {field}")
	return input


def create_tool_registry(
	command_handler: Callable[..., Any] | None = None,
) -> dict[str, Callable[..., Any]]:
	"""Create a tool registry with handlers.

	Returns a dict mapping tool name -> async handler function.
	"""
	from afd.testing.commands.coverage import scenario_coverage_cmd
	from afd.testing.commands.create import scenario_create
	from afd.testing.commands.list import scenario_list
	from afd.testing.commands.suggest import scenario_suggest
	from afd.testing.hints import enhance_with_agent_hints

	async def handle_list(input: Any) -> dict[str, Any]:
		parsed = _validate_input(input)
		result = scenario_list(parsed)
		if isinstance(result, dict):
			return enhance_with_agent_hints("scenario-list", result)
		return enhance_with_agent_hints("scenario-list", result.model_dump() if hasattr(result, "model_dump") else {"success": result.success, "data": result.data})

	async def handle_evaluate(input: Any) -> dict[str, Any]:
		from afd.testing.commands.evaluate import scenario_evaluate

		parsed = _validate_input(input)
		if not command_handler:
			error_result = {
				"success": False,
				"error": {
					"code": "HANDLER_NOT_CONFIGURED",
					"message": "No command handler configured for scenario evaluation",
					"suggestion": "Provide a commandHandler in the MCP server context",
				},
			}
			return enhance_with_agent_hints("scenario-evaluate", error_result)
		parsed["handler"] = command_handler
		result = await scenario_evaluate(parsed)
		if isinstance(result, dict):
			return enhance_with_agent_hints("scenario-evaluate", result)
		return enhance_with_agent_hints("scenario-evaluate", result.model_dump() if hasattr(result, "model_dump") else {"success": result.success, "data": result.data})

	async def handle_coverage(input: Any) -> dict[str, Any]:
		parsed = _validate_input(input, ["knownCommands"])
		result = scenario_coverage_cmd(parsed)
		if isinstance(result, dict):
			return enhance_with_agent_hints("scenario-coverage", result)
		return enhance_with_agent_hints("scenario-coverage", result.model_dump() if hasattr(result, "model_dump") else {"success": result.success, "data": result.data})

	async def handle_create(input: Any) -> dict[str, Any]:
		parsed = _validate_input(input, ["name", "job"])
		result = scenario_create(parsed)
		if isinstance(result, dict):
			return enhance_with_agent_hints("scenario-create", result)
		return enhance_with_agent_hints("scenario-create", result.model_dump() if hasattr(result, "model_dump") else {"success": result.success, "data": result.data})

	async def handle_suggest(input: Any) -> dict[str, Any]:
		parsed = _validate_input(input, ["context"])
		result = scenario_suggest(parsed)
		if isinstance(result, dict):
			return enhance_with_agent_hints("scenario-suggest", result)
		return enhance_with_agent_hints("scenario-suggest", result.model_dump() if hasattr(result, "model_dump") else {"success": result.success, "data": result.data})

	return {
		"scenario-list": handle_list,
		"scenario-evaluate": handle_evaluate,
		"scenario-coverage": handle_coverage,
		"scenario-create": handle_create,
		"scenario-suggest": handle_suggest,
	}
