"""
Surface Validation for AFD testing.

Cross-command semantic quality analysis that detects duplicate descriptions,
ambiguous naming, overlapping schemas, and prompt injection risks.
"""

from afd.testing.surface.types import (
    DescriptionQualityOptions,
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
    # Types
    'SurfaceValidationOptions',
    'SurfaceValidationResult',
    'SurfaceValidationSummary',
    'SurfaceFinding',
    'SurfaceRule',
    'SurfaceCommand',
    'InjectionPattern',
    'DescriptionQualityOptions',
    # Main validator
    'validate_command_surface',
]
