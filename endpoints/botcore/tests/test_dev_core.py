"""Tests for botcore.commands.dev.core — language-aware dev commands."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from afd.testing import assert_error, assert_success

from botcore.commands.dev.core import dev_build, dev_lint, dev_skill_lint, dev_test


async def test_dev_lint_python(tmp_path) -> None:
    """dev_lint dispatches to ruff for Python projects."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text("[build-system]\nrequires = ['hatchling']\n")

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "All good", "error": None}
        result = await dev_lint()

    assert_success(result)
    mock_run.assert_called_once()
    args = mock_run.call_args
    assert args[0][0] == "ruff"
    assert "check" in args[0][1]


async def test_dev_lint_typescript(tmp_path) -> None:
    """dev_lint dispatches to biome for TypeScript projects."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "", "error": None}
        result = await dev_lint()

    assert_success(result)
    mock_run.assert_called_once()
    args = mock_run.call_args[0][0]
    assert "biome" in args


async def test_dev_lint_fix_flag(tmp_path) -> None:
    """dev_lint passes --fix to ruff."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text("[build-system]\nrequires = ['hatchling']\n")

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "", "error": None}
        result = await dev_lint(fix=True)

    assert_success(result)
    ruff_args = mock_run.call_args[0][1]
    assert "--fix" in ruff_args


async def test_dev_lint_failure(tmp_path) -> None:
    """dev_lint returns error on linter failure."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text("[build-system]\nrequires = ['hatchling']\n")

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": False, "output": "E501", "error": "E501 line too long"}
        result = await dev_lint()

    assert_error(result, "LINT_FAILED")


async def test_dev_test_python(tmp_path) -> None:
    """dev_test dispatches to pytest for Python projects."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text("[build-system]\nrequires = ['hatchling']\n")

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "3 passed", "error": None}
        result = await dev_test()

    assert_success(result)
    assert mock_run.call_args[0][0] == "pytest"


async def test_dev_build_requires_package_for_python(tmp_path) -> None:
    """dev_build returns error if no package specified for Python."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text("[build-system]\nrequires = ['hatchling']\n")

    with patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path):
        result = await dev_build()

    assert_error(result, "PACKAGE_REQUIRED")


async def test_dev_lint_with_language_override(tmp_path) -> None:
    """dev_lint uses explicit language override even in a TS workspace."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "", "error": None}
        result = await dev_lint(language="python")

    assert_success(result)
    mock_run.assert_called_once()
    assert mock_run.call_args[0][0] == "ruff"


async def test_dev_test_with_language_override(tmp_path) -> None:
    """dev_test uses explicit language override."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "", "error": None}
        result = await dev_test(language="rust")

    assert_success(result)
    mock_run.assert_called_once()
    args = mock_run.call_args[0][0]
    assert "cargo" in args
    assert "test" in args


async def test_dev_build_with_language_override(tmp_path) -> None:
    """dev_build uses explicit language override."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_run,
    ):
        mock_run.return_value = {"success": True, "output": "", "error": None}
        result = await dev_build(language="rust")

    assert_success(result)
    args = mock_run.call_args[0][0]
    assert "cargo" in args
    assert "build" in args


# ── Multi-language "run all" tests ───────────────────────────────────────


async def test_dev_lint_runs_all_languages(tmp_path) -> None:
    """dev_lint with no --language runs all configured languages."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        "[tool.botcore]\nlanguage = 'typescript'\n\n"
        "[tool.botcore.language_config.python]\n\n"
        "[tool.botcore.language_config.typescript]\n"
    )
    (tmp_path / ".git").mkdir()

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_py,
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_cmd,
    ):
        mock_py.return_value = {"success": True, "output": "", "error": None}
        mock_cmd.return_value = {"success": True, "output": "", "error": None}
        result = await dev_lint()

    data = assert_success(result)
    assert "languages" in data
    assert "python" in data["languages"]
    assert "typescript" in data["languages"]
    assert data["summary"]["passed"] == 2


async def test_dev_lint_all_fails_if_any_fail(tmp_path) -> None:
    """dev_lint multi-language returns error if any language fails."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        "[tool.botcore]\nlanguage = 'typescript'\n\n"
        "[tool.botcore.language_config.python]\n\n"
        "[tool.botcore.language_config.typescript]\n"
    )
    (tmp_path / ".git").mkdir()

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_py,
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_cmd,
    ):
        mock_py.return_value = {"success": False, "output": "E501", "error": "ruff failed"}
        mock_cmd.return_value = {"success": True, "output": "", "error": None}
        result = await dev_lint()

    assert_error(result, "LINT_FAILED")


async def test_dev_lint_all_success(tmp_path) -> None:
    """dev_lint multi-language returns success when all pass."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        "[tool.botcore]\nlanguage = 'python'\n\n"
        "[tool.botcore.language_config.python]\n\n"
        "[tool.botcore.language_config.rust]\n"
    )
    (tmp_path / ".git").mkdir()

    with (
        patch("botcore.commands.dev.core.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.core.run_python_module", new_callable=AsyncMock) as mock_py,
        patch("botcore.commands.dev.core.run_command", new_callable=AsyncMock) as mock_cmd,
    ):
        mock_py.return_value = {"success": True, "output": "", "error": None}
        mock_cmd.return_value = {"success": True, "output": "", "error": None}
        result = await dev_lint()

    data = assert_success(result)
    assert data["summary"]["passed"] == 2
    assert data["summary"]["failed"] == 0


async def test_dev_skill_lint_no_workspace() -> None:
    """dev_skill_lint delegates to skill_lint; errors when no workspace found."""
    with patch("botcore.commands.skill.lint.find_workspace", return_value=None):
        result = await dev_skill_lint()

    assert_error(result, "NO_WORKSPACE")


async def test_dev_skill_lint_no_skills_dir(tmp_path) -> None:
    """dev_skill_lint errors when skills directory is missing."""
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'\n\n[tool.botcore]\n"
    )
    with patch("botcore.commands.skill.lint.find_workspace", return_value=tmp_path):
        result = await dev_skill_lint()

    assert_error(result, "NO_SKILLS_DIR")


async def test_dev_skill_lint_passes(tmp_path) -> None:
    """dev_skill_lint passes with valid skills (with frontmatter)."""
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'\n\n[tool.botcore]\n"
    )
    skills_dir = tmp_path / ".claude" / "skills" / "my-skill"
    skills_dir.mkdir(parents=True)
    skill_file = skills_dir / "SKILL.md"
    skill_file.write_text(
        "---\nname: my-skill\ndescription: A test skill.\nversion: '1.0.0'\n"
        "triggers:\n  - test\n---\n\n## Description\n\nA test skill.\n"
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=tmp_path):
        result = await dev_skill_lint()

    data = assert_success(result)
    assert data["passed"] == 1
    assert data["errors"] == 0
