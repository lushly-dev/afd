"""
Types for semantic quality (surface) validation.

Cross-command analysis that detects duplicate descriptions, ambiguous naming,
overlapping schemas, and prompt injection risks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

SurfaceRule = Literal[
    'similar-descriptions',
    'schema-overlap',
    'naming-convention',
    'naming-collision',
    'missing-category',
    'description-injection',
    'description-quality',
    'orphaned-category',
    'schema-complexity',
    'unresolved-prerequisite',
    'circular-prerequisite',
]


@dataclass
class SurfaceFinding:
    """A single finding from surface validation.

    Attributes:
        rule: Rule identifier.
        severity: Severity level.
        message: Human-readable description of the finding.
        commands: Commands involved in this finding.
        suggestion: Actionable fix suggestion.
        evidence: Supporting evidence (similarity score, etc.).
        suppressed: Whether this finding was suppressed.
    """

    rule: SurfaceRule
    severity: Literal['error', 'warning', 'info']
    message: str
    commands: list[str]
    suggestion: str
    evidence: dict[str, Any] = field(default_factory=dict)
    suppressed: bool = False


@dataclass
class SurfaceValidationSummary:
    """Summary statistics for the validation run.

    Attributes:
        command_count: Total commands analyzed.
        error_count: Number of error-level findings.
        warning_count: Number of warning-level findings.
        info_count: Number of info-level findings.
        suppressed_count: Number of suppressed findings.
        rules_evaluated: Rules that were evaluated.
        duration_ms: Validation duration in ms.
    """

    command_count: int = 0
    error_count: int = 0
    warning_count: int = 0
    info_count: int = 0
    suppressed_count: int = 0
    rules_evaluated: list[str] = field(default_factory=list)
    duration_ms: float = 0.0


@dataclass
class SurfaceValidationResult:
    """Result of surface validation.

    Attributes:
        valid: Overall pass/fail.
        findings: All findings (including suppressed).
        summary: Summary statistics.
    """

    valid: bool
    findings: list[SurfaceFinding]
    summary: SurfaceValidationSummary


@dataclass
class SurfaceValidationOptions:
    """Options for validate_command_surface().

    Attributes:
        similarity_threshold: Similarity threshold (0-1) for flagging pairs. Default: 0.7.
        schema_overlap_threshold: Minimum schema overlap ratio. Default: 0.8.
        detect_injection: Enable prompt injection detection. Default: True.
        check_description_quality: Enable description quality checks. Default: True.
        min_description_length: Minimum description length in characters. Default: 20.
        enforce_naming: Enable naming convention enforcement. Default: True.
        naming_pattern: Naming pattern to enforce.
        skip_categories: Categories to skip during validation.
        strict: Treat warnings as errors. Default: False.
        suppressions: Suppress specific findings.
    """

    similarity_threshold: float = 0.7
    schema_overlap_threshold: float = 0.8
    detect_injection: bool = True
    check_description_quality: bool = True
    min_description_length: int = 20
    enforce_naming: bool = True
    naming_pattern: re.Pattern[str] | None = None
    skip_categories: list[str] = field(default_factory=list)
    strict: bool = False
    suppressions: list[str] = field(default_factory=list)


@dataclass
class SurfaceCommand:
    """Normalized command representation for surface validation.

    Attributes:
        name: Command name.
        description: Command description.
        category: Optional category.
        json_schema: Optional JSON Schema for input.
        requires: Optional prerequisite commands.
    """

    name: str
    description: str
    category: str | None = None
    json_schema: dict[str, Any] | None = None
    requires: list[str] | None = None


@dataclass
class InjectionPattern:
    """A regex-based pattern for detecting prompt injection.

    Attributes:
        id: Pattern identifier.
        pattern: Regex to match against descriptions.
        description: Human-readable explanation.
        example: Example of flagged text.
    """

    id: str
    pattern: re.Pattern[str]
    description: str
    example: str


@dataclass
class DescriptionQualityOptions:
    """Options for description quality checking.

    Attributes:
        min_length: Minimum description length in characters.
        additional_verbs: Additional verbs to accept.
    """

    min_length: int = 20
    additional_verbs: list[str] = field(default_factory=list)
