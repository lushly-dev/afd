"""Tests for botcore.commands.dev.quality — quality gate commands."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from afd.testing import assert_error, assert_success

from botcore.commands.dev.quality import _parse_version, dev_check_deps, dev_check_size

_MOD = "botcore.commands.dev.quality"
_FIND_WS = f"{_MOD}.find_workspace"
_RUN_TOOL = f"{_MOD}.run_external_tool"


def test_parse_version_full() -> None:
    """Parse complete semver."""
    assert _parse_version("2.5.3") == (2, 5, 3)


def test_parse_version_major_only() -> None:
    """Parse major-only version."""
    assert _parse_version("3") == (3, 0, 0)


def test_parse_version_major_minor() -> None:
    """Parse major.minor version."""
    assert _parse_version("1.2") == (1, 2, 0)


def test_parse_version_invalid() -> None:
    """Invalid version returns (0, 0, 0)."""
    assert _parse_version("abc") == (0, 0, 0)


async def test_check_size_no_errors(tmp_path) -> None:
    """check_size passes when files are small."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "small.py").write_text("x = 1\n" * 50)

    with patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path):
        result = await dev_check_size(path=str(src))

    data = assert_success(result)
    assert data["files_checked"] == 1
    assert len(data["errors"]) == 0


async def test_check_size_warns(tmp_path) -> None:
    """check_size warns for files above warn threshold."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "big.py").write_text("x = 1\n" * 600)

    with patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path):
        result = await dev_check_size(path=str(src), warn_threshold=500, error_threshold=1000)

    data = assert_success(result)
    assert len(data["warnings"]) == 1


async def test_check_size_errors(tmp_path) -> None:
    """check_size errors for files above error threshold."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "huge.py").write_text("x = 1\n" * 1100)

    with patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path):
        result = await dev_check_size(path=str(src), error_threshold=1000)

    assert_error(result, "FILES_TOO_LARGE")


async def test_check_size_uses_config_thresholds(tmp_path) -> None:
    """check_size uses BotCoreConfig thresholds when not overridden."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "medium.py").write_text("x = 1\n" * 250)

    # Config with low warn threshold
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text("[tool.botcore]\nfile_size_warn = 200\n")

    with patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path):
        result = await dev_check_size(path=str(src))

    data = assert_success(result)
    assert len(data["warnings"]) == 1


async def test_check_size_path_not_found(tmp_path) -> None:
    """check_size errors when path doesn't exist."""
    with patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path):
        result = await dev_check_size(path=str(tmp_path / "nonexistent"))

    assert_error(result, "PATH_NOT_FOUND")


async def test_check_size_typescript_extensions(tmp_path) -> None:
    """check_size scans .ts/.tsx files when language=typescript."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.ts").write_text("const x = 1;\n" * 600)
    (src / "comp.tsx").write_text("const y = 2;\n" * 50)
    (src / "ignored.py").write_text("x = 1\n" * 600)  # Should be ignored

    with patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path):
        result = await dev_check_size(
            path=str(src), language="typescript", warn_threshold=500, error_threshold=1000,
        )

    data = assert_success(result)
    assert data["files_checked"] == 2
    assert len(data["warnings"]) == 1  # Only app.ts


async def test_check_size_skips_build_output(tmp_path) -> None:
    """check_size ignores dist/ and build/ trees like it ignores node_modules."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "small.py").write_text("x = 1\n" * 50)
    dist = tmp_path / "src" / "dist"
    dist.mkdir()
    (dist / "bundle.py").write_text("x = 1\n" * 2000)
    build = tmp_path / "src" / "build"
    build.mkdir()
    (build / "out.py").write_text("x = 1\n" * 2000)

    with patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path):
        result = await dev_check_size(path=str(src), error_threshold=1000)

    data = assert_success(result)
    assert data["files_checked"] == 1
    assert len(data["errors"]) == 0


async def test_check_deps_npm_dispatch(tmp_path) -> None:
    """dev_check_deps dispatches to npm outdated for TypeScript."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {"success": True, "output": "{}", "error": None}
        result = await dev_check_deps(language="typescript")

    assert_success(result)
    mock_tool.assert_called_once()


async def test_check_deps_npm_not_found(tmp_path) -> None:
    """dev_check_deps errors when npm not found for TypeScript."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = None
        result = await dev_check_deps(language="typescript")

    assert_error(result, "NPM_NOT_FOUND")
