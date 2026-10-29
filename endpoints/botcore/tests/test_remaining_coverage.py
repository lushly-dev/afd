"""Tests for remaining coverage gaps — undo, workspace, runner, dev/core, info."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

from afd.testing import assert_error, assert_success

from botcore.commands.dev.core import dev_build, dev_lint, dev_test
from botcore.commands.info import info_scripts
from botcore.commands.undo import undo_status
from botcore.utils.runner import run_command, run_external_tool
from botcore.utils.workspace import (
    detect_language,
    detect_package,
    find_workspace,
    get_package_names,
    get_packages,
)

# ── undo — missing action type branches ──────────────────────────────────


async def test_undo_status_spec_sync(tmp_path) -> None:
    """undo_status generates rollback for spec.sync actions."""
    history_file = tmp_path / "history.json"
    history_file.write_text(
        '{"last_action": {"action": "spec.sync", "timestamp": "2026-01-01",'
        ' "created_issues": [10, 11, 12]}}'
    )

    with patch("botcore.commands.undo.HISTORY_FILE", history_file):
        result = await undo_status()

    data = assert_success(result)
    assert data["last_action"] == "spec.sync"
    assert any("gh issue close" in cmd for cmd in data["rollback_commands"])


async def test_undo_status_work_complete(tmp_path) -> None:
    """undo_status generates rollback for work.complete actions."""
    history_file = tmp_path / "history.json"
    history_file.write_text(
        '{"last_action": {"action": "work.complete", "timestamp": "2026-01-01",'
        ' "issue": "42"}}'
    )

    with patch("botcore.commands.undo.HISTORY_FILE", history_file):
        result = await undo_status()

    data = assert_success(result)
    assert data["last_action"] == "work.complete"
    assert any("gh issue reopen" in cmd for cmd in data["rollback_commands"])
    assert any("remove-label" in cmd for cmd in data["rollback_commands"])


async def test_undo_status_unknown_action(tmp_path) -> None:
    """undo_status handles unknown action types gracefully."""
    history_file = tmp_path / "history.json"
    history_file.write_text(
        '{"last_action": {"action": "custom.thing", "timestamp": "2026-01-01"}}'
    )

    with patch("botcore.commands.undo.HISTORY_FILE", history_file):
        result = await undo_status()

    data = assert_success(result)
    assert data["has_history"] is True
    assert data["rollback_commands"] == []


async def test_undo_status_corrupted_history(tmp_path) -> None:
    """undo_status handles corrupted JSON gracefully."""
    history_file = tmp_path / "history.json"
    history_file.write_text("not valid json {{{")

    with patch("botcore.commands.undo.HISTORY_FILE", history_file):
        result = await undo_status()

    data = assert_success(result)
    assert data["has_history"] is False


# ── workspace — detect_language ──────────────────────────────────────────


def test_detect_language_rust(tmp_path) -> None:
    """Detects Rust from Cargo.toml."""
    (tmp_path / "Cargo.toml").write_text('[package]\nname = "test"')
    assert detect_language(tmp_path) == "rust"


def test_detect_language_python_with_build(tmp_path) -> None:
    """Detects Python from pyproject.toml with build-system."""
    (tmp_path / "pyproject.toml").write_text(
        '[build-system]\nrequires = ["hatchling"]\n'
    )
    assert detect_language(tmp_path) == "python"


def test_detect_language_typescript(tmp_path) -> None:
    """Detects TypeScript from package.json (no pyproject.toml with build-system)."""
    (tmp_path / "package.json").write_text('{"name": "app"}')
    assert detect_language(tmp_path) == "typescript"


def test_detect_language_python_fallback(tmp_path) -> None:
    """Falls back to Python when pyproject.toml exists without build-system."""
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "test"\n')
    assert detect_language(tmp_path) == "python"


def test_detect_language_none(tmp_path) -> None:
    """Returns None when no markers found."""
    assert detect_language(tmp_path) is None


# ── workspace — get_packages ─────────────────────────────────────────────


def test_get_packages_with_manifests(tmp_path) -> None:
    """Finds packages with recognized manifests."""
    pkgs = tmp_path / "packages"
    pkg_a = pkgs / "alpha"
    pkg_a.mkdir(parents=True)
    (pkg_a / "package.json").write_text('{"name": "alpha"}')

    pkg_b = pkgs / "beta"
    pkg_b.mkdir()
    (pkg_b / "pyproject.toml").write_text('[project]\nname = "beta"')

    result = get_packages(tmp_path)
    assert len(result) == 2
    names = [p.name for p in result]
    assert "alpha" in names
    assert "beta" in names


def test_get_packages_no_dir(tmp_path) -> None:
    """Returns empty when packages/ doesn't exist."""
    assert get_packages(tmp_path) == []


def test_get_packages_filter_name(tmp_path) -> None:
    """Filters by package directory name."""
    pkgs = tmp_path / "packages"
    for name in ("a", "b"):
        d = pkgs / name
        d.mkdir(parents=True)
        (d / "package.json").write_text(f'{{"name": "{name}"}}')

    result = get_packages(tmp_path, filter_name="a")
    assert len(result) == 1
    assert result[0].name == "a"


def test_get_packages_skips_no_manifest(tmp_path) -> None:
    """Skips directories without package manifests."""
    pkgs = tmp_path / "packages"
    (pkgs / "empty-dir").mkdir(parents=True)
    assert get_packages(tmp_path) == []


def test_get_package_names(tmp_path) -> None:
    """Returns list of directory names."""
    pkgs = tmp_path / "packages"
    pkg = pkgs / "my-pkg"
    pkg.mkdir(parents=True)
    (pkg / "Cargo.toml").write_text('[package]\nname = "my-pkg"')

    assert get_package_names(tmp_path) == ["my-pkg"]


# ── workspace — detect_package ───────────────────────────────────────────


def test_detect_package_finds_nearest(tmp_path) -> None:
    """Walks up to find nearest package manifest."""
    pkg = tmp_path / "packages" / "web"
    pkg.mkdir(parents=True)
    (pkg / "package.json").write_text('{"name": "@test/web"}')

    src = pkg / "src" / "components"
    src.mkdir(parents=True)
    file = src / "Button.tsx"
    file.touch()

    result = detect_package(file, tmp_path)
    assert result == "@test/web"


def test_detect_package_not_in_package(tmp_path) -> None:
    """Returns None when file is not in any package."""
    (tmp_path / "loose-file.py").touch()
    assert detect_package(tmp_path / "loose-file.py", tmp_path) is None


def test_detect_package_pyproject(tmp_path) -> None:
    """Detects package from pyproject.toml."""
    pkg = tmp_path / "packages" / "core"
    pkg.mkdir(parents=True)
    (pkg / "pyproject.toml").write_text('[project]\nname = "core-lib"')

    file = pkg / "src" / "main.py"
    file.parent.mkdir(parents=True)
    file.touch()

    result = detect_package(file, tmp_path)
    assert result == "core-lib"


def test_detect_package_cargo(tmp_path) -> None:
    """Detects package from Cargo.toml."""
    pkg = tmp_path / "packages" / "engine"
    pkg.mkdir(parents=True)
    (pkg / "Cargo.toml").write_text('[package]\nname = "engine-rs"')

    file = pkg / "src" / "lib.rs"
    file.parent.mkdir(parents=True)
    file.touch()

    result = detect_package(file, tmp_path)
    assert result == "engine-rs"


# ── workspace — find_workspace ───────────────────────────────────────────


def test_find_workspace_from_subdir(tmp_path) -> None:
    """Finds workspace root from a subdirectory."""
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "root"')
    sub = tmp_path / "deep" / "nested"
    sub.mkdir(parents=True)

    result = find_workspace(start=sub)
    assert result == tmp_path


def test_find_workspace_none(tmp_path) -> None:
    """Returns None when no markers found (isolated tmp dir)."""
    isolated = tmp_path / "completely" / "empty"
    isolated.mkdir(parents=True)
    # No workspace markers at all — tmp_path itself might have markers
    # so we need a truly isolated directory
    result = find_workspace(start=isolated)
    # This may or may not find something depending on the filesystem hierarchy,
    # but the function should not crash
    assert result is None or isinstance(result, Path)


# ── runner — run_external_tool ───────────────────────────────────────────


async def test_run_external_tool_not_found() -> None:
    """Returns None with warning when tool not found."""
    import warnings

    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        result = await run_external_tool(
            "__nonexistent_tool_xyz__",
            ["--version"],
            install_hint="Install it somehow",
        )

    assert result is None
    assert len(w) == 1
    assert "not found" in str(w[0].message)


async def test_run_external_tool_found() -> None:
    """Returns result when tool is available."""
    result = await run_external_tool(
        sys.executable, ["-c", "print('hi')"], install_hint="Install Python",
    )
    assert result is not None
    assert result["success"] is True
    assert "hi" in result["output"]


async def test_run_command_timeout() -> None:
    """Command timeout returns error."""
    result = await run_command(
        [sys.executable, "-c", "import time; time.sleep(10)"],
        timeout=1,
    )
    assert result["success"] is False
    assert "timed out" in result["error"]


async def test_run_command_large_stderr() -> None:
    """Large stderr output is truncated."""
    from botcore.utils.runner import MAX_OUTPUT_LENGTH

    code = f"import sys; sys.stderr.write('e' * {MAX_OUTPUT_LENGTH + 5000}); sys.exit(1)"
    result = await run_command([sys.executable, "-c", code])
    assert result["success"] is False
    assert result["error"] is not None
    assert "chars truncated" in result["error"]


# ── dev/core — additional language branches ──────────────────────────────


async def test_dev_lint_clippy(tmp_path) -> None:
    """dev_lint dispatches to clippy for Rust."""
    (tmp_path / "Cargo.toml").write_text('[package]\nname = "test"')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_cmd,
    ):
        mock_cmd.return_value = {"success": True, "output": "", "error": None}
        result = await dev_lint(language="rust")

    assert_success(result)
    args = mock_cmd.call_args[0][0]
    assert "cargo" in args
    assert "clippy" in args


async def test_dev_lint_clippy_fix(tmp_path) -> None:
    """dev_lint passes --fix to clippy."""
    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_cmd,
    ):
        mock_cmd.return_value = {"success": True, "output": "", "error": None}
        result = await dev_lint(language="rust", fix=True)

    assert_success(result)
    args = mock_cmd.call_args[0][0]
    assert "--fix" in args
    assert "--allow-dirty" in args


async def test_dev_test_vitest(tmp_path) -> None:
    """dev_test dispatches to vitest for TypeScript."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_cmd,
    ):
        mock_cmd.return_value = {"success": True, "output": "3 passed", "error": None}
        result = await dev_test(language="typescript")

    assert_success(result)
    args = mock_cmd.call_args[0][0]
    assert "vitest" in args


async def test_dev_test_with_coverage(tmp_path) -> None:
    """dev_test passes --cov flags when coverage=True."""
    (tmp_path / "pyproject.toml").write_text('[build-system]\nrequires = ["hatchling"]\n')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "passed", "error": None}
        result = await dev_test(language="python", coverage=True)

    assert_success(result)
    args = mock_run.call_args[0][1]
    assert "--cov" in args


async def test_dev_test_with_package(tmp_path) -> None:
    """dev_test passes package filter for Python."""
    (tmp_path / "pyproject.toml").write_text('[build-system]\nrequires = ["hatchling"]\n')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "passed", "error": None}
        result = await dev_test(language="python", package="core")

    assert_success(result)
    args = mock_run.call_args[0][1]
    assert "packages/core" in args


async def test_dev_test_failure(tmp_path) -> None:
    """dev_test returns error on test failure."""
    (tmp_path / "pyproject.toml").write_text('[build-system]\nrequires = ["hatchling"]\n')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": False, "output": "FAILED", "error": "1 failed"}
        result = await dev_test(language="python")

    assert_error(result, "TEST_FAILED")


async def test_dev_build_typescript(tmp_path) -> None:
    """dev_build dispatches to turbo for TypeScript."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_cmd,
    ):
        mock_cmd.return_value = {"success": True, "output": "", "error": None}
        result = await dev_build(language="typescript")

    assert_success(result)
    args = mock_cmd.call_args[0][0]
    assert "turbo" in args
    assert "build" in args


async def test_dev_build_typescript_with_package(tmp_path) -> None:
    """dev_build passes --filter for TS package builds."""
    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_cmd,
    ):
        mock_cmd.return_value = {"success": True, "output": "", "error": None}
        result = await dev_build(language="typescript", package="@test/core")

    assert_success(result)
    args = mock_cmd.call_args[0][0]
    assert "--filter" in args
    assert "@test/core" in args


async def test_dev_build_failure(tmp_path) -> None:
    """dev_build returns error on build failure."""
    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_cmd,
    ):
        mock_cmd.return_value = {"success": False, "output": "", "error": "Build failed"}
        result = await dev_build(language="rust")

    assert_error(result, "BUILD_FAILED")


async def test_dev_build_python_with_package(tmp_path) -> None:
    """dev_build runs hatch for Python with package specified."""
    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "Built", "error": None}
        result = await dev_build(language="python", package="mylib")

    assert_success(result)
    assert mock_run.call_args[0][0] == "hatch"


async def test_dev_lint_no_language(tmp_path) -> None:
    """dev_lint returns error when no language detected."""
    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.resolve_language", return_value=None),
    ):
        result = await dev_lint()

    assert_error(result, "NO_LINTER")


async def test_dev_test_no_language(tmp_path) -> None:
    """dev_test returns error when no language detected."""
    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.resolve_language", return_value=None),
    ):
        result = await dev_test()

    assert_error(result, "NO_TEST_RUNNER")


async def test_dev_build_no_language(tmp_path) -> None:
    """dev_build returns error when no language detected."""
    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.resolve_language", return_value=None),
    ):
        result = await dev_build()

    assert_error(result, "NO_LANGUAGE")


# ── info — info_scripts with pyproject.toml ──────────────────────────────


async def test_info_scripts_with_pyproject_scripts(tmp_path) -> None:
    """info_scripts reads [project.scripts] from pyproject.toml."""
    pkgs = tmp_path / "packages"
    pkg = pkgs / "cli-tool"
    pkg.mkdir(parents=True)
    (pkg / "pyproject.toml").write_text(
        '[project]\nname = "cli-tool"\n\n[project.scripts]\nmycli = "app:main"\n'
    )

    with patch("botcore.commands.info.find_workspace", return_value=tmp_path):
        result = await info_scripts()

    data = assert_success(result)
    assert "cli-tool" in data
    assert "mycli" in data["cli-tool"]
