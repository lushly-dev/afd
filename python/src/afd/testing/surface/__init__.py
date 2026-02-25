"""
Surface validation for AFD command sets.

Cross-command analysis that detects duplicate descriptions, ambiguous naming,
overlapping schemas, and prompt injection risks.
"""

from afd.testing.surface.types import (
	ComplexityBreakdown,
	ComplexityResult,
	InjectionMatch,
	InjectionPattern,
	SurfaceCommand,
	SurfaceFinding,
	SurfaceRule,
	SurfaceValidationOptions,
	SurfaceValidationResult,
	SurfaceValidationSummary,
)
from afd.testing.surface.validate import validate_command_surface

__all__ = [
	"ComplexityBreakdown",
	"ComplexityResult",
	"InjectionMatch",
	"InjectionPattern",
	"SurfaceCommand",
	"SurfaceFinding",
	"SurfaceRule",
	"SurfaceValidationOptions",
	"SurfaceValidationResult",
	"SurfaceValidationSummary",
	"validate_command_surface",
]
