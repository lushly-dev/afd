"""
Surface validation rules.

Eleven rule functions, each returning list[SurfaceFinding].

Port of packages/testing/src/surface/rules.ts
"""

from __future__ import annotations

import re
from typing import Any

from afd.testing.surface.injection import check_injection
from afd.testing.surface.schema_complexity import compute_complexity
from afd.testing.surface.similarity import build_similarity_matrix
from afd.testing.surface.types import InjectionPattern, SurfaceCommand, SurfaceFinding

# Common action verbs expected in command descriptions.
DESCRIPTION_VERBS: set[str] = {
	"get", "gets", "fetch", "fetches", "retrieve", "retrieves",
	"create", "creates", "add", "adds", "insert", "inserts",
	"update", "updates", "modify", "modifies", "patch", "patches",
	"delete", "deletes", "remove", "removes", "destroy", "destroys",
	"list", "lists", "search", "searches", "find", "finds",
	"query", "queries", "send", "sends", "submit", "submits",
	"publish", "publishes", "validate", "validates", "check", "checks",
	"verify", "verifies", "connect", "connects", "disconnect", "disconnects",
	"start", "starts", "stop", "stops", "restart", "restarts",
	"enable", "enables", "disable", "disables", "export", "exports",
	"import", "imports", "compute", "computes", "calculate", "calculates",
	"return", "returns", "set", "sets", "reset", "resets",
	"run", "runs", "execute", "executes", "invoke", "invokes",
	"subscribe", "subscribes", "unsubscribe", "unsubscribes",
}

DEFAULT_NAMING_PATTERN = re.compile(r"^[a-z][a-z0-9]*-[a-z][a-z0-9-]*$")


# ---------------------------------------------------------------------------
# Rule 1: Similar Descriptions
# ---------------------------------------------------------------------------

def check_similar_descriptions(
	commands: list[SurfaceCommand], threshold: float
) -> list[SurfaceFinding]:
	"""Detect command pairs with highly similar descriptions."""
	findings: list[SurfaceFinding] = []
	matrix = build_similarity_matrix(commands)

	for pair in matrix.pairs:
		if pair.score < threshold:
			break
		pct = round(pair.score * 100)
		findings.append(SurfaceFinding(
			rule="similar-descriptions",
			severity="warning",
			message=f'Commands "{pair.command_a}" and "{pair.command_b}" have {pct}% description similarity',
			commands=[pair.command_a, pair.command_b],
			suggestion="Merge into a single command or make descriptions more distinct.",
			evidence={"similarity": pair.score},
		))

	return findings


# ---------------------------------------------------------------------------
# Rule 2: Schema Overlap
# ---------------------------------------------------------------------------

def _compare_schemas(
	schema_a: dict[str, Any], schema_b: dict[str, Any]
) -> dict[str, Any]:
	"""Compare two JSON Schemas for top-level field overlap."""
	fields_a = set((schema_a.get("properties") or {}).keys())
	fields_b = set((schema_b.get("properties") or {}).keys())

	shared = list(fields_a & fields_b)
	unique_a = list(fields_a - fields_b)
	unique_b = list(fields_b - fields_a)

	union_size = len(fields_a | fields_b)
	overlap_ratio = len(shared) / union_size if union_size > 0 else 0.0

	props_a = schema_a.get("properties", {})
	props_b = schema_b.get("properties", {})
	types_compatible = all(
		(props_a.get(f, {}) if isinstance(props_a.get(f), dict) else {}).get("type")
		== (props_b.get(f, {}) if isinstance(props_b.get(f), dict) else {}).get("type")
		for f in shared
	)

	return {
		"sharedFields": shared,
		"uniqueToA": unique_a,
		"uniqueToB": unique_b,
		"overlapRatio": overlap_ratio,
		"typesCompatible": types_compatible,
	}


def check_schema_overlap(
	commands: list[SurfaceCommand], threshold: float
) -> list[SurfaceFinding]:
	"""Detect command pairs with highly overlapping input schemas."""
	findings: list[SurfaceFinding] = []
	with_schema = [c for c in commands if c.json_schema and c.json_schema.get("properties")]

	for i in range(len(with_schema)):
		for j in range(i + 1, len(with_schema)):
			cmd_a = with_schema[i]
			cmd_b = with_schema[j]
			if not cmd_a.json_schema or not cmd_b.json_schema:
				continue

			result = _compare_schemas(cmd_a.json_schema, cmd_b.json_schema)
			if result["overlapRatio"] >= threshold:
				pct = round(result["overlapRatio"] * 100)
				shared_str = ", ".join(result["sharedFields"])
				findings.append(SurfaceFinding(
					rule="schema-overlap",
					severity="warning",
					message=f'Commands "{cmd_a.name}" and "{cmd_b.name}" share {pct}% input fields ({shared_str})',
					commands=[cmd_a.name, cmd_b.name],
					suggestion="Consider merging these commands or ensure descriptions clearly differentiate when to use each.",
					evidence=result,
				))

	return findings


# ---------------------------------------------------------------------------
# Rule 3: Naming Convention
# ---------------------------------------------------------------------------

def _suggest_kebab_name(name: str) -> str:
	"""Suggest a kebab-case name from a given name."""
	result = re.sub(r"([a-z])([A-Z])", r"\1-\2", name)
	result = re.sub(r"[_.\s]+", "-", result)
	return result.lower()


def check_naming_convention(
	commands: list[SurfaceCommand], pattern: re.Pattern[str] | None = None
) -> list[SurfaceFinding]:
	"""Validate that all command names match the naming pattern."""
	regex = pattern or DEFAULT_NAMING_PATTERN
	findings: list[SurfaceFinding] = []

	for cmd in commands:
		if not regex.search(cmd.name):
			findings.append(SurfaceFinding(
				rule="naming-convention",
				severity="error",
				message=f'Command "{cmd.name}" does not match the naming convention',
				commands=[cmd.name],
				suggestion=f'Rename to kebab-case domain-action format (e.g., "{_suggest_kebab_name(cmd.name)}").',
				evidence={"pattern": regex.pattern},
			))

	return findings


# ---------------------------------------------------------------------------
# Rule 4: Naming Collision
# ---------------------------------------------------------------------------

def check_naming_collision(commands: list[SurfaceCommand]) -> list[SurfaceFinding]:
	"""Detect command pairs whose names differ only by separator style."""
	findings: list[SurfaceFinding] = []
	normalized: dict[str, list[str]] = {}

	for cmd in commands:
		key = re.sub(r"[-_.]", "", cmd.name).lower()
		normalized.setdefault(key, []).append(cmd.name)

	for names in normalized.values():
		if len(names) > 1:
			names_str = " and ".join(f'"{n}"' for n in names)
			findings.append(SurfaceFinding(
				rule="naming-collision",
				severity="error",
				message=f"Commands {names_str} collide when separators are normalized",
				commands=names,
				suggestion='Use a single consistent naming style. Prefer kebab-case (e.g., "user-create").',
				evidence={"normalizedNames": names},
			))

	return findings


# ---------------------------------------------------------------------------
# Rule 5: Missing Category
# ---------------------------------------------------------------------------

def check_missing_category(commands: list[SurfaceCommand]) -> list[SurfaceFinding]:
	"""Flag commands without a category field."""
	findings: list[SurfaceFinding] = []
	for cmd in commands:
		if not cmd.category:
			findings.append(SurfaceFinding(
				rule="missing-category",
				severity="info",
				message=f'Command "{cmd.name}" has no category',
				commands=[cmd.name],
				suggestion="Add a category to help agents organize and filter commands.",
			))
	return findings


# ---------------------------------------------------------------------------
# Rule 6: Description Injection
# ---------------------------------------------------------------------------

def check_description_injection(
	commands: list[SurfaceCommand],
	additional_patterns: list[InjectionPattern] | None = None,
) -> list[SurfaceFinding]:
	"""Scan descriptions for prompt injection patterns."""
	findings: list[SurfaceFinding] = []

	for cmd in commands:
		matches = check_injection(cmd.description, additional_patterns)
		for match in matches:
			findings.append(SurfaceFinding(
				rule="description-injection",
				severity="error",
				message=f'Command "{cmd.name}" description contains {match.description.lower()}',
				commands=[cmd.name],
				suggestion=(
					"Remove instruction-like language from the description. "
					"Descriptions should explain what the command does, not instruct "
					"the agent how to behave."
				),
				evidence={
					"patternId": match.pattern_id,
					"matchedText": match.matched_text,
				},
			))

	return findings


# ---------------------------------------------------------------------------
# Rule 7: Description Quality
# ---------------------------------------------------------------------------

def check_description_quality(
	commands: list[SurfaceCommand],
	*,
	min_length: int = 20,
	additional_verbs: list[str] | None = None,
) -> list[SurfaceFinding]:
	"""Check description length and verb presence."""
	findings: list[SurfaceFinding] = []
	verbs = set(DESCRIPTION_VERBS)
	if additional_verbs:
		for v in additional_verbs:
			verbs.add(v.lower())

	for cmd in commands:
		if len(cmd.description) < min_length:
			findings.append(SurfaceFinding(
				rule="description-quality",
				severity="warning",
				message=f'Command "{cmd.name}" description is too short ({len(cmd.description)} chars, minimum {min_length})',
				commands=[cmd.name],
				suggestion="Write a description of at least 20 characters explaining what the command does and when to use it.",
				evidence={"length": len(cmd.description), "minLength": min_length},
			))

		tokens = cmd.description.lower().split()
		has_verb = any(t in verbs for t in tokens)
		if not has_verb:
			findings.append(SurfaceFinding(
				rule="description-quality",
				severity="warning",
				message=f'Command "{cmd.name}" description is missing an action verb',
				commands=[cmd.name],
				suggestion='Start the description with an action verb (e.g., "Creates...", "Retrieves...", "Deletes...").',
				evidence={"missingVerb": True},
			))

	return findings


# ---------------------------------------------------------------------------
# Rule 8: Orphaned Category
# ---------------------------------------------------------------------------

def check_orphaned_category(commands: list[SurfaceCommand]) -> list[SurfaceFinding]:
	"""Flag categories with only one command."""
	findings: list[SurfaceFinding] = []
	categories: dict[str, list[str]] = {}

	for cmd in commands:
		if cmd.category:
			categories.setdefault(cmd.category, []).append(cmd.name)

	for category, names in categories.items():
		if len(names) == 1:
			findings.append(SurfaceFinding(
				rule="orphaned-category",
				severity="info",
				message=f'Category "{category}" contains only one command ("{names[0]}")',
				commands=names,
				suggestion=(
					"Consider moving this command to a broader category, or suppress this "
					"finding if the singleton category is intentional."
				),
				evidence={"category": category},
			))

	return findings


# ---------------------------------------------------------------------------
# Rule 9: Schema Complexity
# ---------------------------------------------------------------------------

def check_schema_complexity(
	commands: list[SurfaceCommand], threshold: int
) -> list[SurfaceFinding]:
	"""Score input schema complexity and flag commands exceeding the threshold."""
	findings: list[SurfaceFinding] = []

	for cmd in commands:
		if not cmd.json_schema:
			continue

		result = compute_complexity(cmd.json_schema)
		if result.tier == "low":
			continue

		severity = "warning" if result.score >= threshold else "info"
		suggestion = (
			"Consider simplifying the input schema if agents struggle with this command."
			if result.tier == "medium"
			else "Simplify the input schema by reducing unions, nesting depth, or splitting into multiple commands."
		)

		findings.append(SurfaceFinding(
			rule="schema-complexity",
			severity=severity,
			message=f'Command "{cmd.name}" has {result.tier} schema complexity (score: {result.score})',
			commands=[cmd.name],
			suggestion=suggestion,
			evidence={
				"score": result.score,
				"tier": result.tier,
				"breakdown": {
					"fields": result.breakdown.fields,
					"depth": result.breakdown.depth,
					"unions": result.breakdown.unions,
					"intersections": result.breakdown.intersections,
					"enums": result.breakdown.enums,
					"patterns": result.breakdown.patterns,
					"bounds": result.breakdown.bounds,
					"optionalRatio": result.breakdown.optional_ratio,
				},
			},
		))

	return findings


# ---------------------------------------------------------------------------
# Rule 10: Unresolved Prerequisites
# ---------------------------------------------------------------------------

def check_unresolved_prerequisites(commands: list[SurfaceCommand]) -> list[SurfaceFinding]:
	"""Flag requires entries that reference commands not in the surface."""
	findings: list[SurfaceFinding] = []
	known = {c.name for c in commands}

	for cmd in commands:
		if not cmd.requires:
			continue
		for req in cmd.requires:
			if req not in known:
				findings.append(SurfaceFinding(
					rule="unresolved-prerequisite",
					severity="error",
					message=f'Command "{cmd.name}" requires "{req}" which is not registered',
					commands=[cmd.name],
					suggestion=f'Register "{req}" or remove it from the requires list.',
					evidence={"missingCommand": req},
				))

	return findings


# ---------------------------------------------------------------------------
# Rule 11: Circular Prerequisites
# ---------------------------------------------------------------------------

def check_circular_prerequisites(commands: list[SurfaceCommand]) -> list[SurfaceFinding]:
	"""Detect cycles in the requires dependency graph using DFS."""
	findings: list[SurfaceFinding] = []

	graph: dict[str, list[str]] = {}
	for cmd in commands:
		if cmd.requires and len(cmd.requires) > 0:
			graph[cmd.name] = cmd.requires

	visited: set[str] = set()
	in_stack: set[str] = set()
	reported_cycles: set[str] = set()

	def dfs(node: str, path: list[str]) -> None:
		if node in in_stack:
			cycle_start = path.index(node)
			cycle = path[cycle_start:] + [node]

			key = ",".join(sorted(cycle[:-1]))
			if key not in reported_cycles:
				reported_cycles.add(key)
				findings.append(SurfaceFinding(
					rule="circular-prerequisite",
					severity="error",
					message=f"Circular prerequisite chain: {' -> '.join(cycle)}",
					commands=cycle[:-1],
					suggestion="Break the cycle by removing one of the requires entries.",
					evidence={"cycle": cycle},
				))
			return

		if node in visited:
			return

		visited.add(node)
		in_stack.add(node)

		for neighbor in graph.get(node, []):
			dfs(neighbor, [*path, node])

		in_stack.discard(node)

	for cmd in commands:
		if cmd.name not in visited:
			dfs(cmd.name, [])

	return findings
