"""Tests for alfred_lint command."""

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


@pytest.mark.asyncio
async def test_lint_reports_empty_suppressed_summary(tmp_dir):
    """A run with no suppressions reports a zeroed summary and plain reasoning."""
    result = await alfred_lint(str(tmp_dir))
    assert result.data["suppressed"] == {"total": 0, "by_rule": {}, "by_reason": {}}
    assert "suppressed" not in result.reasoning


@pytest.mark.asyncio
async def test_lint_surfaces_directive_suppression(tmp_dir):
    """An afd-lint-disable directive is counted, not hidden behind '0 errors'."""
    py_file = tmp_dir / "legacy.py"
    py_file.write_text(
        "# afd-lint-disable: legacy adapter, migrating in a follow-up\n"
        "async def handler(input) -> dict:\n"
        '    return {"ok": True}\n',
        encoding="utf-8",
    )
    result = await alfred_lint(str(tmp_dir))
    assert result.success is True
    assert result.data["passed"] is True
    assert result.data["error_count"] == 0
    assert result.data["suppressed"] == {
        "total": 1,
        "by_rule": {"afd-command-result": 1},
        "by_reason": {"inline-directive": 1},
    }
    assert result.reasoning == "Checked 1 files: 0 errors, 0 warnings (1 suppressed)"


@pytest.mark.asyncio
async def test_lint_passes_calibration_options(tmp_dir):
    """Path excludes and severity overrides reach the linter."""
    (tmp_dir / "vendor").mkdir()
    (tmp_dir / "vendor" / "bad.py").write_text(
        "async def handler(input) -> dict:\n    return {}\n", encoding="utf-8"
    )
    (tmp_dir / "bad.py").write_text(
        "async def handler(input) -> dict:\n    return {}\n", encoding="utf-8"
    )
    result = await alfred_lint(
        str(tmp_dir),
        rule_path_excludes={"afd-command-result": ["vendor/"]},
        rule_severity_overrides={"afd-command-result": "warning"},
    )
    assert result.data["error_count"] == 0
    assert result.data["warning_count"] == 1
    assert result.data["passed"] is True
    assert result.data["suppressed"]["by_reason"] == {"rule-path-exclude": 1}


@pytest.mark.asyncio
async def test_lint_severity_off_counts_as_suppressed(tmp_dir):
    (tmp_dir / "bad.py").write_text(
        "async def handler(input) -> dict:\n    return {}\n", encoding="utf-8"
    )
    result = await alfred_lint(
        str(tmp_dir), rule_severity_overrides={"afd-command-result": "off"}
    )
    assert result.data["error_count"] == 0
    assert result.data["suppressed"]["by_reason"] == {"severity-off": 1}


@pytest.mark.asyncio
async def test_lint_unknown_rule_override_is_invalid_input(tmp_dir):
    result = await alfred_lint(str(tmp_dir), rule_severity_overrides={"afd-nope": "off"})
    assert result.success is False
    assert result.error.code == "INVALID_INPUT"
    assert "afd-nope" in result.error.message
    assert result.error.suggestion
