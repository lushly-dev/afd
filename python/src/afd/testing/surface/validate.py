"""
Main entry point for surface validation.

Orchestrates all rules and produces a SurfaceValidationResult.

Port of packages/testing/src/surface/validate.ts
"""

from __future__ import annotations

import time
from typing import Any

from afd.testing.surface.rules import (
	check_circular_prerequisites,
	check_description_injection,
	check_description_quality,
	check_missing_category,
	check_naming_collision,
	check_naming_convention,
	check_orphaned_category,
	check_schema_complexity,
	check_schema_overlap,
	check_similar_descriptions,
	check_unresolved_prerequisites,
)
from afd.testing.surface.types import (
	SurfaceCommand,
	SurfaceFinding,
	SurfaceValidationOptions,
	SurfaceValidationResult,
	SurfaceValidationSummary,
)


def _normalize_commands(commands: list[Any]) -> list[SurfaceCommand]:
	"""Normalize heterogeneous input to SurfaceCommand list."""
	result: list[SurfaceCommand] = []
	for cmd in commands:
		if isinstance(cmd, SurfaceCommand):
			result.append(cmd)
			continue

		if isinstance(cmd, dict):
			result.append(SurfaceCommand(
				name=str(cmd.get("name", "")),
				description=str(cmd.get("description", "")),
				category=cmd.get("category"),
				json_schema=cmd.get("jsonSchema") or cmd.get("json_schema"),
				requires=cmd.get("requires"),
			))
			continue

		# Object with attributes (Pydantic model, dataclass, etc.)
		name = getattr(cmd, "name", "")
		description = getattr(cmd, "description", "")
		category = getattr(cmd, "category", None)

		# Check for jsonSchema (Zod-style) or json_schema or parameters
		json_schema = getattr(cmd, "jsonSchema", None) or getattr(cmd, "json_schema", None)
		if json_schema is None and hasattr(cmd, "parameters"):
			params = getattr(cmd, "parameters", None)
			if isinstance(params, list):
				json_schema = _parameters_to_json_schema(params)

		requires = getattr(cmd, "requires", None)

		result.append(SurfaceCommand(
			name=str(name),
			description=str(description),
			category=category,
			json_schema=json_schema,
			requires=requires,
		))

	return result


def _parameters_to_json_schema(params: list[Any]) -> dict[str, Any]:
	"""Convert CommandParameter list to a flat JSON Schema."""
	properties: dict[str, Any] = {}
	required: list[str] = []

	for param in params:
		if isinstance(param, dict):
			name = param.get("name", "")
			properties[name] = {
				"type": param.get("type", "string"),
				"description": param.get("description", ""),
			}
			if param.get("required"):
				required.append(name)
		else:
			name = getattr(param, "name", "")
			properties[name] = {
				"type": getattr(param, "type", "string"),
				"description": getattr(param, "description", ""),
			}
			if getattr(param, "required", False):
				required.append(name)

	schema: dict[str, Any] = {"type": "object", "properties": properties}
	if required:
		schema["required"] = required
	return schema


def _is_suppressed(finding: SurfaceFinding, suppressions: list[str]) -> bool:
	"""Check if a finding should be suppressed."""
	for sup in suppressions:
		parts = sup.split(":")
		rule = parts[0]

		if rule != finding.rule:
			continue

		# Rule-level suppression
		if len(parts) == 1:
			return True

		# Single-command suppression
		if len(parts) == 2:
			if len(finding.commands) == 1 and finding.commands[0] == parts[1]:
				return True

		# Pair-level suppression
		if len(parts) == 3:
			sup_cmds = sorted([parts[1], parts[2]])
			find_cmds = sorted(finding.commands)
			if len(find_cmds) >= 2 and sup_cmds[0] == find_cmds[0] and sup_cmds[1] == find_cmds[1]:
				return True

	return False


def validate_command_surface(
	commands: list[Any],
	options: SurfaceValidationOptions | None = None,
) -> SurfaceValidationResult:
	"""Validate the command surface for semantic quality issues.

	Performs cross-command analysis on a registered command set, detecting:
	- Similar descriptions (cosine similarity)
	- Schema overlap (shared input fields)
	- Naming convention violations
	- Naming collisions (separator-normalized)
	- Missing categories
	- Prompt injection in descriptions
	- Description quality (length, verb presence)
	- Orphaned categories (single-command)
	- Schema complexity
	- Unresolved prerequisites
	- Circular prerequisites
	"""
	start = time.perf_counter()
	opts = options or SurfaceValidationOptions()

	similarity_threshold = opts.similarity_threshold
	schema_overlap_threshold = opts.schema_overlap_threshold
	detect_injection = opts.detect_injection
	check_quality = opts.check_description_quality
	min_description_length = opts.min_description_length
	enforce_naming = opts.enforce_naming
	naming_pattern = opts.naming_pattern
	skip_categories = opts.skip_categories or []
	strict = opts.strict
	suppressions = opts.suppressions or []
	additional_injection_patterns = opts.additional_injection_patterns
	check_complexity = opts.check_schema_complexity
	schema_complexity_threshold = opts.schema_complexity_threshold

	# Normalize input
	normalized = _normalize_commands(commands)

	# Filter out skipped categories
	if skip_categories:
		skip_set = set(skip_categories)
		normalized = [c for c in normalized if not c.category or c.category not in skip_set]

	# Run rules
	all_findings: list[SurfaceFinding] = []
	rules_evaluated: list[str] = []

	# Always run: similar-descriptions
	rules_evaluated.append("similar-descriptions")
	all_findings.extend(check_similar_descriptions(normalized, similarity_threshold))

	# Always run: schema-overlap
	rules_evaluated.append("schema-overlap")
	all_findings.extend(check_schema_overlap(normalized, schema_overlap_threshold))

	# Naming convention (configurable)
	if enforce_naming:
		rules_evaluated.append("naming-convention")
		all_findings.extend(check_naming_convention(normalized, naming_pattern))

	# Always run: naming-collision
	rules_evaluated.append("naming-collision")
	all_findings.extend(check_naming_collision(normalized))

	# Always run: missing-category
	rules_evaluated.append("missing-category")
	all_findings.extend(check_missing_category(normalized))

	# Injection detection (configurable)
	if detect_injection:
		rules_evaluated.append("description-injection")
		all_findings.extend(
			check_description_injection(normalized, additional_injection_patterns)
		)

	# Description quality (configurable)
	if check_quality:
		rules_evaluated.append("description-quality")
		all_findings.extend(
			check_description_quality(normalized, min_length=min_description_length)
		)

	# Always run: orphaned-category
	rules_evaluated.append("orphaned-category")
	all_findings.extend(check_orphaned_category(normalized))

	# Schema complexity (configurable)
	if check_complexity:
		rules_evaluated.append("schema-complexity")
		all_findings.extend(check_schema_complexity(normalized, schema_complexity_threshold))

	# Always run: unresolved-prerequisite
	rules_evaluated.append("unresolved-prerequisite")
	all_findings.extend(check_unresolved_prerequisites(normalized))

	# Always run: circular-prerequisite
	rules_evaluated.append("circular-prerequisite")
	all_findings.extend(check_circular_prerequisites(normalized))

	# Apply suppressions
	suppressed_count = 0
	for finding in all_findings:
		if _is_suppressed(finding, suppressions):
			finding.suppressed = True
			suppressed_count += 1

	# Count severities (excluding suppressed)
	error_count = 0
	warning_count = 0
	info_count = 0

	for f in all_findings:
		if f.suppressed:
			continue
		if f.severity == "error":
			error_count += 1
		elif f.severity == "warning":
			warning_count += 1
		elif f.severity == "info":
			info_count += 1

	# Determine validity
	valid = (
		error_count == 0 and warning_count == 0 if strict else error_count == 0
	)

	duration_ms = round((time.perf_counter() - start) * 1000 * 100) / 100

	return SurfaceValidationResult(
		valid=valid,
		findings=all_findings,
		summary=SurfaceValidationSummary(
			command_count=len(normalized),
			error_count=error_count,
			warning_count=warning_count,
			info_count=info_count,
			suppressed_count=suppressed_count,
			rules_evaluated=rules_evaluated,
			duration_ms=duration_ms,
		),
	)
