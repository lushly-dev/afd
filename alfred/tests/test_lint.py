"""Tests for alfred_lint command."""

import asyncio
import tempfile
from pathlib import Path

import pytest

from alfred.commands.lint import alfred_lint


@pytest.fixture
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


@pytest.mark.asyncio
async def test_lint_empty_dir(tmp_dir):
    """Linting an empty directory should pass with zero files checked."""
    result = await alfred_lint(str(tmp_dir))
    assert result.success is True
    assert result.data["passed"] is True
    assert result.data["files_checked"] == 0
    assert result.confidence == 1.0


@pytest.mark.asyncio
async def test_lint_clean_python(tmp_dir):
    """A well-formed Python file should produce no issues."""
    py_file = tmp_dir / "good.py"
    py_file.write_text(
        'from afd import CommandResult, success\n'
        '\n'
        'async def handler(input) -> CommandResult[dict]:\n'
        '    return success({"ok": True})\n',
        encoding="utf-8",
    )
    result = await alfred_lint(str(tmp_dir))
    assert result.success is True
    assert result.data["files_checked"] == 1
    assert result.data["error_count"] == 0


@pytest.mark.asyncio
async def test_lint_detects_missing_command_result(tmp_dir):
    """Handler returning wrong type should be flagged."""
    py_file = tmp_dir / "bad.py"
    py_file.write_text(
        'async def handler(input) -> dict:\n'
        '    return {"ok": True}\n',
        encoding="utf-8",
    )
    result = await alfred_lint(str(tmp_dir))
    assert result.success is True
    assert result.data["files_checked"] == 1
    assert result.data["error_count"] == 1
    assert result.data["issues"][0]["rule"] == "afd-command-result"


@pytest.mark.asyncio
async def test_lint_detects_missing_suggestion(tmp_dir):
    """error() call without suggestion should produce a warning."""
    py_file = tmp_dir / "no_suggestion.py"
    py_file.write_text(
        'from afd import CommandResult, error\n'
        '\n'
        'async def handler(input) -> CommandResult[dict]:\n'
        '    return error("NOT_FOUND", "Missing item")\n',
        encoding="utf-8",
    )
    result = await alfred_lint(str(tmp_dir))
    assert result.success is True
    assert result.data["warning_count"] >= 1
    rules = [i["rule"] for i in result.data["issues"]]
    assert "afd-actionable-errors" in rules


@pytest.mark.asyncio
async def test_lint_nonexistent_path():
    """Linting a path that doesn't exist should return an error."""
    result = await alfred_lint("/nonexistent/path/abc123")
    assert result.success is False
    assert result.error is not None
    assert result.error.code == "NOT_FOUND"


@pytest.mark.asyncio
async def test_lint_default_path():
    """Calling with no path should lint the current directory."""
    result = await alfred_lint()
    assert result.success is True
    assert result.data["files_checked"] >= 0
