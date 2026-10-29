"""Botcore development commands.

Commands are split into modules:
- core.py: lint, test, build, skill-lint (language-aware dispatch)
- quality.py: check-size, check-coverage, check-deps, check-lockfile
- analysis.py: dead-code, circular-imports, unused-deps, dep-graph
- portability.py: check-paths (cross-platform path detection)
"""

from botcore.commands.dev.analysis import (
    dev_circular_imports,
    dev_dead_code,
    dev_dep_graph,
    dev_unused_deps,
)
from botcore.commands.dev.core import (
    dev_build,
    dev_lint,
    dev_skill_lint,
    dev_test,
)
from botcore.commands.dev.portability import dev_check_paths
from botcore.commands.dev.quality import (
    _parse_version,
    dev_check_coverage,
    dev_check_deps,
    dev_check_lockfile,
    dev_check_size,
)

__all__ = [
    # Core
    "dev_lint",
    "dev_test",
    "dev_build",
    "dev_skill_lint",
    # Quality
    "dev_check_size",
    "dev_check_coverage",
    "dev_check_deps",
    "dev_check_lockfile",
    "_parse_version",
    # Analysis
    "dev_dead_code",
    "dev_circular_imports",
    "dev_unused_deps",
    "dev_dep_graph",
    # Portability
    "dev_check_paths",
]
