"""Tests for botcore.commands.info."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

from afd.testing import assert_error, assert_success

from botcore.commands.info import info_env, info_scripts, info_workspace


async def test_info_workspace_found(tmp_workspace: Path) -> None:
    """Returns workspace path and packages."""
    with patch("botcore.commands.info.find_workspace", return_value=tmp_workspace):
        result = await info_workspace()

    data = assert_success(result)
    assert data["workspace_root"] == str(tmp_workspace)
    assert isinstance(data["packages"], list)
    assert result.suggestions is not None
    assert "Use info_scripts to see available package scripts" in result.suggestions


async def test_info_workspace_not_found() -> None:
    """Returns error CommandResult when no workspace."""
    with patch("botcore.commands.info.find_workspace", return_value=None):
        result = await info_workspace()

    assert_error(result, "WORKSPACE_NOT_FOUND")


async def test_info_env() -> None:
    """Returns python version and platform."""
    result = await info_env()

    data = assert_success(result)
    assert sys.version in data["python_version"]
    assert data["platform"] == sys.platform
    assert data["cwd"] == os.getcwd()
    assert result.suggestions == ["Use info_workspace for project structure"]


async def test_info_scripts(tmp_workspace_with_packages: Path) -> None:
    """Reads package.json scripts correctly."""
    # Add scripts to one of the packages
    pkg_core = tmp_workspace_with_packages / "packages" / "core"
    (pkg_core / "package.json").write_text(
        '{"name": "@test/core", "scripts": {"build": "tsc", "test": "vitest"}}',
        encoding="utf-8",
    )

    with patch("botcore.commands.info.find_workspace", return_value=tmp_workspace_with_packages):
        result = await info_scripts()

    data = assert_success(result)
    assert "core" in data
    assert "build" in data["core"]
    assert "test" in data["core"]
    assert result.suggestions == ["Run scripts with dev_test or dev_lint commands"]


async def test_info_scripts_no_workspace() -> None:
    """Returns error when no workspace found."""
    with patch("botcore.commands.info.find_workspace", return_value=None):
        result = await info_scripts()

    assert_error(result)


async def test_info_workspace_with_packages(tmp_workspace_with_packages: Path) -> None:
    """Workspace with packages reports correct count."""
    with patch("botcore.commands.info.find_workspace", return_value=tmp_workspace_with_packages):
        result = await info_workspace()

    data = assert_success(result)
    assert data["package_count"] == 3
    assert "core" in data["packages"]
    assert "data" in data["packages"]
    assert "utils" in data["packages"]
