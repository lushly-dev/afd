"""
Types for surface (semantic quality) validation.

Port of packages/testing/src/surface/types.ts
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

SurfaceRule = Literal[
	"similar-descriptions",
	"schema-overlap",
	"naming-convention",
	"naming-collision",
	"missing-category",
	"description-injection",
	"description-quality",
	"orphaned-category",
	"schema-complexity",
	"unresolved-prerequisite",
	"circular-prerequisite",
]


@dataclass
class SurfaceValidationOptions:
	"""Options for validate_command_surface()."""

	similarity_threshold: float = 0.7
	schema_overlap_threshold: float = 0.8
	detect_injection: bool = True
	check_description_quality: bool = True
	min_description_length: int = 20
	enforce_naming: bool = True
	naming_pattern: re.Pattern[str] | None = None
	skip_categories: list[str] | None = None
	strict: bool = False
	suppressions: list[str] | None = None
	additional_injection_patterns: list[InjectionPattern] | None = None
	check_schema_complexity: bool = True
	schema_complexity_threshold: int = 13


@dataclass
class SurfaceFinding:
	"""A single finding from surface validation."""

	rule: SurfaceRule
	severity: Literal["error", "warning", "info"]
	message: str
	commands: list[str]
	suggestion: str
	evidence: dict[str, Any] | None = None
	suppressed: bool = False


@dataclass
class SurfaceValidationSummary:
	"""Summary statistics for the validation run."""

	command_count: int = 0
	error_count: int = 0
	warning_count: int = 0
	info_count: int = 0
	suppressed_count: int = 0
	rules_evaluated: list[str] = field(default_factory=list)
	duration_ms: float = 0.0


@dataclass
class SurfaceValidationResult:
	"""Result of surface validation."""

	valid: bool
	findings: list[SurfaceFinding]
	summary: SurfaceValidationSummary


@dataclass
class InjectionPattern:
	"""A regex-based pattern for detecting prompt injection in descriptions."""

	id: str
	pattern: re.Pattern[str]
	description: str
	example: str


@dataclass
class InjectionMatch:
	"""A match from injection pattern scanning."""

	pattern_id: str
	matched_text: str
	description: str


@dataclass
class SurfaceCommand:
	"""Normalized command representation for surface validation."""

	name: str
	description: str
	category: str | None = None
	json_schema: dict[str, Any] | None = None
	requires: list[str] | None = None


@dataclass
class ComplexityBreakdown:
	"""Breakdown of individual complexity contributors."""

	fields: int = 0
	depth: int = 0
	unions: int = 0
	intersections: int = 0
	enums: int = 0
	patterns: int = 0
	bounds: int = 0
	optional_ratio: float = 0.0


@dataclass
class ComplexityResult:
	"""Result of computing schema complexity."""

	score: float
	tier: Literal["low", "medium", "high", "critical"]
	breakdown: ComplexityBreakdown
