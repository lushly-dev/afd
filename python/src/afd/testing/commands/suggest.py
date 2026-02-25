"""
scenario-suggest command.

Context-based scenario suggestions for improving test coverage.

Port of packages/testing/src/commands/suggest.ts
"""

from __future__ import annotations

import os
import re
from typing import Any

from afd.core.result import CommandResult, error, success
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


def _map_file_to_commands(filepath: str) -> list[str]:
	"""Map a file path to likely related commands."""
	commands: list[str] = []
	# Match patterns like commands/category/action.ts
	m = re.search(r"commands?/(\w+)/(\w+)\.\w+$", filepath)
	if m:
		commands.append(f"{m.group(1)}-{m.group(2)}")

	# Match patterns like handlers/category-action.ts
	m = re.search(r"handlers?/(\w+[-_]\w+)\.\w+$", filepath)
	if m:
		commands.append(m.group(1).replace("_", "-"))

	return commands


def _infer_job_from_command(command: str) -> str:
	"""Infer a job description from a command name."""
	parts = command.split("-")
	if len(parts) >= 2:
		action = parts[-1]
		domain = "-".join(parts[:-1])
		return f"{action} a {domain}"
	return f"use {command}"


def _generate_skeleton(
	name: str, job: str, commands: list[str], tags: list[str] | None = None
) -> dict[str, Any]:
	"""Generate a partial scenario structure."""
	steps = []
	for cmd in commands:
		steps.append({
			"command": cmd,
			"description": f"Execute {cmd}",
			"expect": {"success": True},
		})
	return {
		"name": name,
		"description": f"When I want to {job}",
		"job": job,
		"tags": tags or [],
		"steps": steps,
	}


def scenario_suggest(input: dict[str, Any] | None = None) -> CommandResult[Any]:
	"""Get scenario suggestions based on context.

	Input:
		context: str - Context type (changed-files, uncovered, failed, command, natural)
		files: list[str] - Changed files (for changed-files context)
		command: str - Specific command (for command context)
		query: str - Natural language query (for natural context)
		directory: str - Scenario directory
		known_commands: list[str] - Known commands for coverage
		limit: int - Max suggestions (default: 5)
		include_skeleton: bool - Include skeleton scenario

	Returns:
		CommandResult with suggestions list.
	"""
	params = input or {}
	context = params.get("context")
	files = params.get("files", [])
	command = params.get("command")
	query = params.get("query")
	directory = params.get("directory", "./scenarios")
	known_commands = params.get("known_commands") or params.get("knownCommands", [])
	limit = params.get("limit", 5)
	include_skeleton = params.get("include_skeleton", params.get("includeSkeleton", False))

	if not context:
		return error(
			"VALIDATION_ERROR",
			"Missing required field: context",
			suggestion="Provide a context type: changed-files, uncovered, failed, command, natural",
		)

	suggestions: list[dict[str, Any]] = []

	if context == "changed-files":
		suggestions = _suggest_from_changed_files(files, directory, known_commands, include_skeleton)
	elif context == "uncovered":
		suggestions = _suggest_from_uncovered(directory, known_commands, include_skeleton)
	elif context == "failed":
		suggestions = _suggest_from_failed(directory)
	elif context == "command":
		if not command:
			return error(
				"VALIDATION_ERROR",
				"Missing required field: command (for 'command' context)",
				suggestion="Provide the 'command' name to suggest scenarios for.",
			)
		suggestions = _suggest_for_command(command, directory, include_skeleton)
	elif context == "natural":
		if not query:
			return error(
				"VALIDATION_ERROR",
				"Missing required field: query (for 'natural' context)",
				suggestion="Provide a 'query' describing what scenarios you need.",
			)
		suggestions = _suggest_from_query(query, known_commands, include_skeleton)
	else:
		return error(
			"VALIDATION_ERROR",
			f"Unknown context: {context}",
			suggestion="Use one of: changed-files, uncovered, failed, command, natural",
		)

	# Limit results
	suggestions = suggestions[:limit]

	reasoning = _generate_reasoning(context, suggestions)

	return success(
		{
			"suggestions": suggestions,
			"total_found": len(suggestions),
			"reasoning": reasoning,
			"context": context,
		},
		reasoning=reasoning,
		confidence=0.8 if suggestions else 0.5,
	)


def _suggest_from_changed_files(
	files: list[str],
	directory: str,
	known_commands: list[str],
	include_skeleton: bool,
) -> list[dict[str, Any]]:
	suggestions: list[dict[str, Any]] = []
	commands_from_files: set[str] = set()

	for f in files:
		mapped = _map_file_to_commands(f)
		commands_from_files.update(mapped)

	for cmd in commands_from_files:
		job = _infer_job_from_command(cmd)
		suggestion: dict[str, Any] = {
			"name": f"test-{cmd}-from-changes",
			"job": job,
			"reason": f"File changes affect {cmd}",
			"confidence": 0.7,
			"priority": "high",
			"tags": ["regression"],
			"commands": [cmd],
		}
		if include_skeleton:
			suggestion["skeleton"] = _generate_skeleton(
				suggestion["name"], job, [cmd], ["regression"]
			)
		suggestions.append(suggestion)

	return suggestions


def _suggest_from_uncovered(
	directory: str,
	known_commands: list[str],
	include_skeleton: bool,
) -> list[dict[str, Any]]:
	suggestions: list[dict[str, Any]] = []

	# Find commands already covered
	covered: set[str] = set()
	files = _find_scenario_files(directory)
	for filepath in files:
		result = parse_scenario_file(filepath)
		if result.success:
			for step in result.scenario.steps:
				covered.add(step.command)

	uncovered = [cmd for cmd in known_commands if cmd not in covered]

	for cmd in uncovered:
		job = _infer_job_from_command(cmd)
		suggestion: dict[str, Any] = {
			"name": f"test-{cmd}",
			"job": job,
			"reason": f"No existing test coverage for {cmd}",
			"confidence": 0.9,
			"priority": "high",
			"tags": ["coverage"],
			"commands": [cmd],
		}
		if include_skeleton:
			suggestion["skeleton"] = _generate_skeleton(
				suggestion["name"], job, [cmd], ["coverage"]
			)
		suggestions.append(suggestion)

	return suggestions


def _suggest_from_failed(directory: str) -> list[dict[str, Any]]:
	suggestions: list[dict[str, Any]] = []

	files = _find_scenario_files(directory)
	for filepath in files:
		result = parse_scenario_file(filepath)
		if result.success:
			scenario = result.scenario
			has_problem_tags = any(
				t in scenario.tags for t in ("flaky", "failing", "needs-fix")
			)
			if has_problem_tags:
				suggestions.append({
					"name": f"fix-{scenario.name}",
					"job": scenario.job,
					"reason": f"Scenario '{scenario.name}' has problem tags: {scenario.tags}",
					"confidence": 0.8,
					"priority": "high",
					"tags": ["regression", "fix"],
					"commands": [s.command for s in scenario.steps],
				})

	return suggestions


def _suggest_for_command(
	command: str,
	directory: str,
	include_skeleton: bool,
) -> list[dict[str, Any]]:
	suggestions: list[dict[str, Any]] = []
	job = _infer_job_from_command(command)

	# Basic test
	basic: dict[str, Any] = {
		"name": f"test-{command}-basic",
		"job": job,
		"reason": f"Basic success path for {command}",
		"confidence": 0.9,
		"priority": "high",
		"tags": ["basic"],
		"commands": [command],
	}
	if include_skeleton:
		basic["skeleton"] = _generate_skeleton(
			basic["name"], job, [command], ["basic"]
		)
	suggestions.append(basic)

	# Validation test
	suggestions.append({
		"name": f"test-{command}-validation",
		"job": f"validate input for {command}",
		"reason": f"Input validation coverage for {command}",
		"confidence": 0.8,
		"priority": "medium",
		"tags": ["validation"],
		"commands": [command],
	})

	# Edge cases
	if any(keyword in command for keyword in ("create", "update", "delete")):
		suggestions.append({
			"name": f"test-{command}-edge-cases",
			"job": f"handle edge cases for {command}",
			"reason": f"Mutation command {command} needs edge case coverage",
			"confidence": 0.7,
			"priority": "medium",
			"tags": ["edge-cases"],
			"commands": [command],
		})

	return suggestions


def _suggest_from_query(
	query: str,
	known_commands: list[str],
	include_skeleton: bool,
) -> list[dict[str, Any]]:
	suggestions: list[dict[str, Any]] = []
	query_lower = query.lower()

	keyword_patterns = {
		"error": ("error-handling", ["validation", "error-handling"], 0.7),
		"crud": ("crud-operations", ["crud"], 0.8),
		"performance": ("performance-testing", ["performance"], 0.6),
		"security": ("security-testing", ["security"], 0.7),
		"integration": ("integration-testing", ["integration"], 0.7),
	}

	for keyword, (name_suffix, tags, confidence) in keyword_patterns.items():
		if keyword in query_lower:
			matched_commands = [
				cmd for cmd in known_commands
				if any(word in cmd.lower() for word in query_lower.split())
			] or known_commands[:3]

			suggestion: dict[str, Any] = {
				"name": f"test-{name_suffix}",
				"job": query,
				"reason": f"Query matches '{keyword}' pattern",
				"confidence": confidence,
				"priority": "medium",
				"tags": tags,
				"commands": matched_commands,
			}
			if include_skeleton and matched_commands:
				suggestion["skeleton"] = _generate_skeleton(
					suggestion["name"], query, matched_commands, tags
				)
			suggestions.append(suggestion)

	return suggestions


def _generate_reasoning(context: str, suggestions: list[dict[str, Any]]) -> str:
	if not suggestions:
		return f"No suggestions found for context '{context}'."
	return f"Generated {len(suggestions)} suggestion(s) based on '{context}' analysis."
