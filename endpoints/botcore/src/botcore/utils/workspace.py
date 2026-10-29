"""Workspace detection utilities for botcore."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from botcore.config import BotCoreConfig

# Markers that indicate a workspace root, checked in priority order
WORKSPACE_MARKERS = [
    "pnpm-workspace.yaml",  # pnpm monorepo
    "Cargo.toml",  # Rust project/workspace
    "pyproject.toml",  # Python project
    "package.json",  # Node/TS project
    ".git",  # Git root fallback
]


def find_workspace(start: Path | None = None) -> Path | None:
    """Find the project workspace root.

    Searches upward from start (default: cwd) for workspace markers:
    pnpm-workspace.yaml, Cargo.toml, pyproject.toml, package.json, .git
    """
    from botcore.context import current_context

    context = current_context()
    if start is None and context is not None:
        return context.target
    current = (start or Path.cwd()).resolve()

    while current != current.parent:
        for marker in WORKSPACE_MARKERS:
            if (current / marker).exists():
                return current
        current = current.parent

    return None


def detect_language(workspace: Path) -> str | None:
    """Detect the primary language of a workspace.

    Returns "python", "typescript", "rust", or None.
    """
    # Rust — Cargo.toml with [package] or [workspace]
    if (workspace / "Cargo.toml").exists():
        return "rust"

    # Python — pyproject.toml with a build system
    pyproject = workspace / "pyproject.toml"
    if pyproject.exists():
        try:
            data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
            if "build-system" in data:
                return "python"
        except Exception:
            pass

    # TypeScript/Node — package.json
    if (workspace / "package.json").exists():
        return "typescript"

    # Python fallback — pyproject.toml exists but no build-system
    if pyproject.exists():
        return "python"

    return None


def get_packages(workspace: Path, filter_name: str | None = None) -> list[Path]:
    """Get all packages in the workspace.

    Scans the packages/ directory for subdirectories containing
    package.json, pyproject.toml, or Cargo.toml.

    Args:
        workspace: Path to workspace root.
        filter_name: Optional package name to filter by directory name.

    Returns:
        List of package directory paths.
    """
    packages_dir = workspace / "packages"

    if not packages_dir.exists():
        return []

    packages = []
    for pkg_dir in sorted(packages_dir.iterdir()):
        if not pkg_dir.is_dir():
            continue

        # Check for any recognized package manifest
        has_manifest = any(
            (pkg_dir / m).exists() for m in ("package.json", "pyproject.toml", "Cargo.toml")
        )
        if not has_manifest:
            continue

        if filter_name and pkg_dir.name != filter_name:
            continue

        packages.append(pkg_dir)

    return packages


def get_package_names(workspace: Path) -> list[str]:
    """Get list of package directory names in the workspace."""
    return [pkg.name for pkg in get_packages(workspace)]


def _read_package_name(directory: Path) -> str | None:
    """Read the package name from the first manifest found in a directory."""
    # package.json
    pkg_json = directory / "package.json"
    if pkg_json.exists():
        try:
            data: dict[str, Any] = json.loads(pkg_json.read_text(encoding="utf-8"))
            if name := data.get("name"):
                return str(name)
        except Exception:
            pass

    # pyproject.toml [project.name]
    pyproject = directory / "pyproject.toml"
    if pyproject.exists():
        try:
            data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
            if name := data.get("project", {}).get("name"):
                return str(name)
        except Exception:
            pass

    # Cargo.toml [package.name]
    cargo = directory / "Cargo.toml"
    if cargo.exists():
        try:
            data = tomllib.loads(cargo.read_text(encoding="utf-8"))
            if name := data.get("package", {}).get("name"):
                return str(name)
        except Exception:
            pass

    return None


def detect_package(file_path: Path, workspace: Path) -> str | None:
    """Detect which package a file belongs to by walking up to the nearest manifest.

    Returns the package name from package.json, pyproject.toml, or Cargo.toml.
    Returns None if the file is not inside a package.
    """
    file_path = file_path.resolve()
    workspace = workspace.resolve()
    current = file_path.parent if file_path.is_file() else file_path

    while current != workspace.parent and str(current).startswith(str(workspace)):
        name = _read_package_name(current)
        if name:
            return name
        current = current.parent

    return None


def resolve_language(
    path: Path | None,
    config: BotCoreConfig,
    workspace: Path,
    language_override: str | None = None,
) -> str | None:
    """Resolve language for a given path using a 5-step priority chain.

    Priority:
        1. Explicit language_override
        2. language_config root prefix match (longest wins)
        3. PackageOverrideConfig.language
        4. detect_language() walk-up from path
        5. config.language fallback
    """
    # 1. Explicit override
    if language_override:
        return language_override

    if path and config.language_config:
        # Normalize path separators for cross-platform compat
        try:
            rel = str(path.relative_to(workspace)).replace("\\", "/")
        except ValueError:
            rel = None

        if rel:
            # 2. Root prefix matching (longest prefix wins)
            best_match: str | None = None
            best_len = 0
            for lang, lc in config.language_config.items():
                if lc.root:
                    # Normalize root to trailing /
                    root = lc.root if lc.root.endswith("/") else lc.root + "/"
                    if rel.startswith(root) or (rel + "/").startswith(root):
                        if len(root) > best_len:
                            best_match = lang
                            best_len = len(root)
            if best_match:
                return best_match

    if path:
        # 3. Per-package language override
        pkg_name = detect_package(path, workspace)
        if pkg_name and pkg_name in config.packages:
            pkg_lang = config.packages[pkg_name].language
            if pkg_lang:
                return pkg_lang

        # 4. Marker-based walk-up from path
        # Use parent for files (existing or not — check suffix as fallback)
        walk_from = path.parent if (path.is_file() or path.suffix) else path
        detected = detect_language(walk_from)
        if detected:
            return detected

    # 5. Primary language fallback
    return config.language
