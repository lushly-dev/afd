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


@pytest.mark.asyncio
async def test_lint_option_unsupported_by_installed_afd(tmp_dir, monkeypatch):
    """An older afd without the option is reported, not raised."""

    def old_linter(**kwargs):
        raise TypeError("unexpected keyword argument 'rule_severity_overrides'")

    monkeypatch.setattr("alfred.commands.lint.AFDLinter", old_linter)
    result = await alfred_lint(str(tmp_dir), rule_severity_overrides={"afd-command-result": "off"})
    assert result.success is False
    assert result.error.code == "UNSUPPORTED_OPTION"
    assert result.error.suggestion


@pytest.mark.asyncio
async def test_lint_flags_ambient_time_and_random_in_handlers(tmp_dir):
    (tmp_dir / "todo.ts").write_text(
        "export const c = defineCommand({\n"
        "  name: 'todo-create',\n"
        "  handler: async () => success({ at: Date.now(), id: crypto.randomUUID() }),\n"
        "});\n"
        "const startedAt = Date.now();\n",
        encoding="utf-8",
    )
    result = await alfred_lint(str(tmp_dir))
    assert result.data["passed"] is True
    assert result.data["warning_count"] == 2
    assert sorted(i["rule"] for i in result.data["issues"]) == [
        "afd-no-ambient-random",
        "afd-no-ambient-time",
    ]

    gated = await alfred_lint(
        str(tmp_dir),
        rule_severity_overrides={"afd-no-ambient-time": "error", "afd-no-ambient-random": "off"},
    )
    assert gated.data["passed"] is False
    assert gated.data["error_count"] == 1
    assert gated.data["suppressed"]["by_rule"] == {"afd-no-ambient-random": 1}


@pytest.mark.asyncio
async def test_lint_flags_ambient_calls_in_python_rust_and_cpp_handlers(tmp_dir):
    (tmp_dir / "todo.py").write_text(
        "import time\n"
        "STARTED = time.time()\n"
        "@server.command(name='todo-create', description='Create')\n"
        "async def create(input, context):\n"
        "    return success({'at': time.time()})\n",
        encoding="utf-8",
    )
    (tmp_dir / "todo.rs").write_text(
        "fn helper() { Uuid::new_v4(); }\n"
        "impl CommandHandler for Create {\n"
        "    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {\n"
        "        success(json!({ \"id\": Uuid::new_v4().to_string() }))\n"
        "    }\n"
        "}\n",
        encoding="utf-8",
    )
    (tmp_dir / "todo.cpp").write_text(
        "auto t0 = std::chrono::steady_clock::now();\n"
        "auto h = [](const afd::Json& input, afd::CommandContext& context) {\n"
        "    return afd::success(std::chrono::system_clock::now().time_since_epoch().count());\n"
        "};\n",
        encoding="utf-8",
    )
    result = await alfred_lint(str(tmp_dir))
    assert result.data["passed"] is True
    assert sorted((i["file"].rsplit("/", 1)[-1], i["line"], i["rule"]) for i in result.data["issues"]) == [
        ("todo.cpp", 3, "afd-no-ambient-time"),
        ("todo.py", 5, "afd-no-ambient-time"),
        ("todo.rs", 4, "afd-no-ambient-random"),
    ]
    suggestions = {i["file"].rsplit("/", 1)[-1]: i["suggestion"] for i in result.data["issues"]}
    assert "context.clock.now()" in suggestions["todo.py"]
    assert "context.random().next()" in suggestions["todo.rs"]
    assert "context.clock->wall_ms()" in suggestions["todo.cpp"]

    gated = await alfred_lint(str(tmp_dir), rule_severity_overrides={"afd-no-ambient-random": "error"})
    assert gated.data["passed"] is False
    assert gated.data["error_count"] == 1
