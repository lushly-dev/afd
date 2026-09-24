"""Scenario file discovery and project-root containment for the testing commands."""

from __future__ import annotations

import os
from pathlib import Path

SCENARIO_SUFFIXES = (".scenario.yaml", ".scenario.yml")


def find_scenario_files(directory: str, recursive: bool = True) -> list[str]:
    """Find ``*.scenario.yaml`` and ``*.scenario.yml`` files, sorted.

    Hidden directories and ``node_modules`` are skipped. A directory that does
    not exist yields no files.
    """
    results: list[str] = []
    if not os.path.isdir(directory):
        return results
    for current, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "node_modules"]
        results.extend(os.path.join(current, f) for f in files if f.endswith(SCENARIO_SUFFIXES))
        if not recursive:
            break
    return sorted(results)


def project_root(root: str | os.PathLike[str] | None = None) -> Path:
    """The resolved project root: ``root``, or the current working directory."""
    return Path(root if root is not None else os.getcwd()).resolve()


def resolve_inside(path: str | os.PathLike[str], root: Path) -> Path | None:
    """Resolve ``path`` against ``root``; None if the result escapes ``root``.

    Symlinks are followed, so a link that points outside the root is refused
    like ``..`` segments or an absolute path elsewhere.
    """
    candidate = (root / path).resolve()
    if candidate == root or root in candidate.parents:
        return candidate
    return None
