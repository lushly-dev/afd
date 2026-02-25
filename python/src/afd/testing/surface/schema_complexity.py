"""
Schema complexity scoring for command input schemas.

Scores how complex a JSON Schema is for an agent to satisfy correctly.
Higher scores indicate schemas that are more likely to cause agent input errors.

Port of packages/testing/src/surface/schema-complexity.ts
"""

from __future__ import annotations

import math
from typing import Any

from afd.testing.surface.types import ComplexityBreakdown, ComplexityResult

# Weight multipliers for each complexity dimension
WEIGHTS = {
	"fields": 1,
	"depth": 3,
	"unions": 5,
	"intersections": 2,
	"enums": 1,
	"patterns": 2,
	"bounds": 1,
}


def _is_nullable_wrapper(variants: list[dict[str, Any]]) -> bool:
	"""Detect anyOf: [T, {type: 'null'}] patterns from nullable wrappers."""
	if len(variants) != 2:
		return False
	return any(v.get("type") == "null" for v in variants)


def _walk(node: dict[str, Any], state: dict[str, Any], depth: int) -> None:
	"""Recursively walk a JSON Schema node and accumulate state."""
	# Union: oneOf / anyOf
	if "oneOf" in node:
		one_of = node["oneOf"]
		if isinstance(one_of, list):
			if not _is_nullable_wrapper(one_of):
				state["unions"] += 1
			for variant in one_of:
				if isinstance(variant, dict):
					_walk(variant, state, depth)

	if "anyOf" in node:
		any_of = node["anyOf"]
		if isinstance(any_of, list):
			if not _is_nullable_wrapper(any_of):
				state["unions"] += 1
				for variant in any_of:
					if isinstance(variant, dict):
						_walk(variant, state, depth)
			else:
				# Nullable wrapper - walk the non-null variant only
				for variant in any_of:
					if isinstance(variant, dict) and variant.get("type") != "null":
						_walk(variant, state, depth)
				return

	# Intersection: allOf
	if "allOf" in node:
		all_of = node["allOf"]
		if isinstance(all_of, list):
			state["intersections"] += 1
			for variant in all_of:
				if isinstance(variant, dict):
					_walk(variant, state, depth)

	# Object
	if node.get("type") == "object" and "properties" in node:
		object_depth = depth + 1
		if object_depth > state["max_depth"]:
			state["max_depth"] = object_depth

		required_set = set(node.get("required", []))
		properties = node.get("properties", {})
		if isinstance(properties, dict):
			for name, prop_schema in properties.items():
				state["field_names"].add(name)
				state["total_field_count"] += 1
				if name not in required_set:
					state["optional_count"] += 1
				if isinstance(prop_schema, dict):
					_walk(prop_schema, state, object_depth)
		return

	# Array
	if node.get("type") == "array" and "items" in node:
		items = node["items"]
		if isinstance(items, dict):
			_walk(items, state, depth)

	# Constraints
	if "enum" in node:
		state["enums"] += 1

	if "pattern" in node:
		state["patterns"] += 1
	if "format" in node:
		state["patterns"] += 1

	for bound_key in (
		"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
		"minLength", "maxLength", "minItems", "maxItems",
	):
		if bound_key in node:
			state["bounds"] += 1


def _compute_score(breakdown: ComplexityBreakdown) -> float:
	"""Compute weighted complexity score."""
	return (
		breakdown.fields * WEIGHTS["fields"]
		+ breakdown.depth * WEIGHTS["depth"]
		+ breakdown.unions * WEIGHTS["unions"]
		+ breakdown.intersections * WEIGHTS["intersections"]
		+ breakdown.enums * WEIGHTS["enums"]
		+ breakdown.patterns * WEIGHTS["patterns"]
		+ breakdown.bounds * WEIGHTS["bounds"]
		+ breakdown.optional_ratio
	)


def _score_tier(score: float) -> str:
	"""Determine complexity tier from score."""
	if score <= 5:
		return "low"
	if score <= 12:
		return "medium"
	if score <= 20:
		return "high"
	return "critical"


def compute_complexity(schema: dict[str, Any]) -> ComplexityResult:
	"""Compute the complexity score for a JSON Schema."""
	state: dict[str, Any] = {
		"field_names": set(),
		"max_depth": 0,
		"unions": 0,
		"intersections": 0,
		"enums": 0,
		"patterns": 0,
		"bounds": 0,
		"optional_count": 0,
		"total_field_count": 0,
	}

	_walk(schema, state, 0)

	optional_ratio = (
		math.floor((state["optional_count"] / state["total_field_count"]) * 4)
		if state["total_field_count"] > 0
		else 0.0
	)

	breakdown = ComplexityBreakdown(
		fields=len(state["field_names"]),
		depth=state["max_depth"],
		unions=state["unions"],
		intersections=state["intersections"],
		enums=state["enums"],
		patterns=state["patterns"],
		bounds=state["bounds"],
		optional_ratio=optional_ratio,
	)

	score = _compute_score(breakdown)
	tier = _score_tier(score)

	return ComplexityResult(score=score, tier=tier, breakdown=breakdown)
