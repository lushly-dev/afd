"""Botcore info commands — workspace and environment discovery."""

from __future__ import annotations

import json
import tomllib

from afd import CommandResult, error, success

from botcore.utils.workspace import find_workspace, get_packages


async def info_workspace() -> CommandResult[dict]:
    """Get workspace information."""
    ws = find_workspace()

    if not ws:
        return error(
            "WORKSPACE_NOT_FOUND",
            "No workspace found in current or parent directories",
            suggestion="Run from within a project workspace or specify a path",
        )

    packages = get_packages(ws)
    package_names = [p.name for p in packages]

    return success(
        data={
            "workspace_root": str(ws),
            "packages": package_names,
            "package_count": len(packages),
        },
        suggestions=[
            "Use info_scripts to see available package scripts",
            "Use info_env for runtime environment details",
        ],
    )


async def info_scripts() -> CommandResult[dict]:
    """Get scripts from all packages.

    Reads both package.json scripts and pyproject.toml [project.scripts].
    """
    ws = find_workspace()

    if not ws:
        return error(
            "WORKSPACE_NOT_FOUND",
            "No workspace found",
            suggestion="Run from within a project workspace",
        )

    packages = get_packages(ws)
    result = {}

    for pkg in packages:
        scripts: list[str] = []

        # package.json scripts
        pkg_json_path = pkg / "package.json"
        if pkg_json_path.exists():
            try:
                pkg_data = json.loads(pkg_json_path.read_text(encoding="utf-8"))
                scripts.extend(pkg_data.get("scripts", {}).keys())
            except Exception:
                scripts.append("<error reading package.json>")

        # pyproject.toml [project.scripts]
        pyproject_path = pkg / "pyproject.toml"
        if pyproject_path.exists():
            try:
                data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
                scripts.extend(data.get("project", {}).get("scripts", {}).keys())
            except Exception:
                scripts.append("<error reading pyproject.toml>")

        result[pkg.name] = scripts

    return success(
        data=result,
        suggestions=["Run scripts with dev_test or dev_lint commands"],
    )


async def info_env() -> CommandResult[dict]:
    """Get environment information."""
    import os
    import sys

    return success(
        data={
            "python_version": sys.version,
            "platform": sys.platform,
            "cwd": os.getcwd(),
        },
        suggestions=["Use info_workspace for project structure"],
    )
