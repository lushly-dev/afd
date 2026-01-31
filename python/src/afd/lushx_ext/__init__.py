"""
AFD Lushx Extension - Registers AFD-specific tools with lushx.

This extension provides:
- AFD linting rules for Python, TypeScript, and Rust
- Architecture validation for AFD patterns

Usage:
    When `afd` is pip-installed, lushx automatically discovers this extension
    via the `lushx.extensions` entry point and registers the tools.
"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from typing import Protocol

    class LushxRegistry(Protocol):
        """Protocol for lushx registry (defined in lushbot)."""

        def register_linter(self, name: str, linter: Any) -> None: ...


def register(lushx: "LushxRegistry") -> None:
    """Register AFD-specific tools with lushx.

    Called automatically by lushx extension discovery.
    """
    from .linters import AFDLinter

    lushx.register_linter("afd", AFDLinter())
