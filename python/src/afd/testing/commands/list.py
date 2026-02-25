"""
scenario-list command.

Discovers and lists JTBD scenario files with filtering and sorting.

Port of packages/testing/src/commands/list.ts
"""

from __future__ import annotations

import os
from typing import Any

from afd.core.result import CommandResult, error, success
from afd.testing.scenarios.parser import parse_scenario_file


def _find_scenario_files(directory: str, recursive: bool = True) -> list[str]:
	"""Recursively search for *.scenario.yaml files."""
	results: list[str] = []
	if not os.path.isdir(directory):
		return results

	for root, dirs, files in os.walk(directory):
		# Exclude hidden dirs and node_modules
		dirs[:] = [d for d in dirs if not d.startswith(".") and d != "node_modules"]
		for f in files:
			if f.endswith(".scenario.yaml") or f.endswith(".scenario.yml"):
				results.append(os.path.join(root, f))
		if not recursive:
			break

	return sorted(results)


def scenario_list(input: dict[str, Any] | None = None) -> CommandResult[Any]:
	"""List JTBD scenario files.

	Input:
		directory: str - Directory to search (default: ./scenarios)
		tags: list[str] - Filter by tags
		job: str - Filter by job name pattern
		status: str - Filter by status
		search: str - Full-text search
		sort: str - Sort by field (name, job, step_count)
		order: str - Sort order (asc, desc)
		recursive: bool - Search subdirectories (default: True)

	Returns:
		CommandResult with scenario list data.
	"""
	params = input or {}
	directory = params.get("directory", "./scenarios")
	tags_filter = params.get("tags")
	job_filter = params.get("job")
	status_filter = params.get("status")
	search_term = params.get("search")
	sort_field = params.get("sort", "name")
	sort_order = params.get("order", "asc")
	recursive = params.get("recursive", True)

	try:
		files = _find_scenario_files(directory, recursive)
	except Exception as e:
		return error(
			"INTERNAL_ERROR",
			f"Failed to search directory: {e}",
			suggestion="Check that the directory exists and is readable.",
		)

	scenarios: list[dict[str, Any]] = []
	for filepath in files:
		result = parse_scenario_file(filepath)
		if result.success:
			sc = result.scenario
			scenarios.append({
				"name": sc.name,
				"job": sc.job,
				"description": sc.description,
				"path": filepath,
				"tags": sc.tags,
				"step_count": len(sc.steps),
				"has_fixture": sc.fixture is not None,
			})

	total = len(scenarios)

	# Apply filters
	filtered = scenarios
	if job_filter:
		job_lower = job_filter.lower()
		filtered = [s for s in filtered if job_lower in s["job"].lower()]
	if tags_filter:
		filtered = [
			s for s in filtered
			if all(t in s["tags"] for t in tags_filter)
		]
	if status_filter:
		filtered = [s for s in filtered if s.get("status") == status_filter]
	if search_term:
		term = search_term.lower()
		filtered = [
			s for s in filtered
			if term in s["name"].lower()
			or term in s.get("description", "").lower()
			or term in s["job"].lower()
		]

	# Sort
	reverse = sort_order == "desc"
	if sort_field == "job":
		filtered.sort(key=lambda s: s["job"].lower(), reverse=reverse)
	elif sort_field == "step_count":
		filtered.sort(key=lambda s: s["step_count"], reverse=reverse)
	else:
		filtered.sort(key=lambda s: s["name"].lower(), reverse=reverse)

	return success(
		{
			"total": total,
			"filtered": len(filtered),
			"scenarios": filtered,
			"filters": {
				"directory": directory,
				"tags": tags_filter,
				"job": job_filter,
				"status": status_filter,
				"search": search_term,
			},
		},
		reasoning=f"Found {total} scenario(s), {len(filtered)} after filtering.",
		confidence=0.95,
	)
