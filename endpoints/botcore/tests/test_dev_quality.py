"""Tests for botcore.commands.dev.quality — quality gate commands."""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, patch

from afd.testing import assert_error, assert_success

from botcore.commands.dev.quality import (
    _parse_version,
    dev_check_coverage,
    dev_check_deps,
    dev_check_size,
)

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


async def test_check_size_relative_path_resolves_against_workspace(tmp_path, monkeypatch) -> None:
    """A relative path names a directory under the workspace, whatever the cwd (#1355)."""
    ws = tmp_path / "ws"
    (ws / "src" / "pkg").mkdir(parents=True)
    (ws / "src" / "pkg" / "big.py").write_text("x = 1\n" * 600)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)

    with patch("botcore.commands.dev.quality.find_workspace", return_value=ws):
        result = await dev_check_size(path="src", warn_threshold=500, error_threshold=1000)

    data = assert_success(result)
    assert data["files_checked"] == 1
    assert data["warnings"] == [{"file": str(Path("src/pkg/big.py")), "lines": 600}]


async def test_check_size_staged_only_with_relative_path(tmp_path) -> None:
    """staged_only matches staged files when the path is relative (#1355)."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "staged.py").write_text("x = 1\n" * 600)
    (src / "unstaged.py").write_text("x = 1\n" * 600)
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "src/staged.py"], cwd=tmp_path, check=True)

    with patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path):
        result = await dev_check_size(
            path="src", warn_threshold=500, error_threshold=1000, staged_only=True
        )

    data = assert_success(result)
    assert [entry["file"] for entry in data["warnings"]] == [str(Path("src/staged.py"))]


async def test_check_size_staged_only_in_a_nested_workspace(tmp_path) -> None:
    """Git prints staged paths from its root; a workspace below it still matches them."""
    ws = tmp_path / "sub"
    (ws / "src").mkdir(parents=True)
    (ws / "src" / "big.py").write_text("x = 1\n" * 600)
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "sub/src/big.py"], cwd=tmp_path, check=True)

    with patch("botcore.commands.dev.quality.find_workspace", return_value=ws):
        result = await dev_check_size(
            path="src", warn_threshold=500, error_threshold=1000, staged_only=True
        )

    data = assert_success(result)
    assert [entry["file"] for entry in data["warnings"]] == [str(Path("src/big.py"))]


async def test_check_size_typescript_extensions(tmp_path) -> None:
    """check_size scans .ts/.tsx files when language=typescript."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.ts").write_text("const x = 1;\n" * 600)
    (src / "comp.tsx").write_text("const y = 2;\n" * 50)
    (src / "ignored.py").write_text("x = 1\n" * 600)  # Should be ignored

    with patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path):
        result = await dev_check_size(
            path=str(src),
            language="typescript",
            warn_threshold=500,
            error_threshold=1000,
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


def _write_vitest_report(summary_json: str):
    """Build an AsyncMock side_effect that writes coverage-summary.json to vitest's report dir."""

    async def _side_effect(_tool, args, **_kwargs):
        for arg in args:
            if arg.startswith("--coverage.reportsDirectory="):
                report_dir = Path(arg.split("=", 1)[1])
                (report_dir / "coverage-summary.json").write_text(summary_json, encoding="utf-8")
        return {"success": True, "output": "", "error": None}

    return _side_effect


def _write_tarpaulin_report(report_json: str):
    """Build an AsyncMock side_effect that writes tarpaulin-report.json to --output-dir."""

    async def _side_effect(_tool, args, **_kwargs):
        if "--output-dir" in args:
            report_dir = Path(args[args.index("--output-dir") + 1])
            (report_dir / "tarpaulin-report.json").write_text(report_json, encoding="utf-8")
        return {"success": True, "output": "", "error": None}

    return _side_effect


async def test_check_coverage_typescript_reads_summary_file(tmp_path) -> None:
    """dev_check_coverage parses Vitest coverage-summary.json instead of hardcoding 0 (#1874)."""
    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(
            _RUN_TOOL,
            side_effect=_write_vitest_report(
                '{"total": {"lines": {"pct": 82.5}, "statements": {"pct": 82.5}}}'
            ),
        ),
    ):
        result = await dev_check_coverage(language="typescript")

    data = assert_success(result)
    assert data["coverage"] == 82.5
    assert data["status"] == "passing"


async def test_check_coverage_typescript_below_threshold_errors(tmp_path) -> None:
    """dev_check_coverage returns COVERAGE_TOO_LOW when parsed TS coverage is low (#1874)."""
    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(
            _RUN_TOOL,
            side_effect=_write_vitest_report(
                '{"total": {"lines": {"pct": 65.0}, "statements": {"pct": 65.0}}}'
            ),
        ),
    ):
        result = await dev_check_coverage(language="typescript")

    assert_error(result, "COVERAGE_TOO_LOW")
    assert "65.0%" in result.error.message


async def test_check_coverage_typescript_ignores_stale_report_on_failed_run(tmp_path) -> None:
    """A stale 92% workspace report cannot pass a failed Vitest run (#1874)."""
    cov_dir = tmp_path / "coverage"
    cov_dir.mkdir()
    (cov_dir / "coverage-summary.json").write_text(
        '{"total": {"lines": {"pct": 92.0}}}',
        encoding="utf-8",
    )

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {"success": False, "output": "test failed", "error": "exit 1"}
        result = await dev_check_coverage(language="typescript")

    assert_error(result, "NO_COVERAGE_DATA")
    assert "failed" in result.error.message.lower()


async def test_check_coverage_typescript_rejects_json_test_name_spoof_and_bad_pct(
    tmp_path,
) -> None:
    """JSON test names with 'All files | 97' and out-of-range/NaN pct are rejected (#1874)."""
    spoof_json = '{"testResults": [{"name": "All files | 97 | 97 | 97 | 97"}]}'
    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {"success": True, "output": spoof_json, "error": None}
        result = await dev_check_coverage(language="typescript")
    assert_error(result, "NO_COVERAGE_DATA")

    for bad_report in (
        '{"total": {"lines": {"pct": 101}}}',
        '{"total": {"lines": {"pct": -1}}}',
        '{"total": {"lines": {"pct": NaN}}}',
        f'{{"total": {{"lines": {{"pct": {10**309}}}}}}}',
    ):
        with (
            patch(_FIND_WS, return_value=tmp_path),
            patch(_RUN_TOOL, side_effect=_write_vitest_report(bad_report)),
        ):
            result = await dev_check_coverage(language="typescript")
        assert_error(result, "NO_COVERAGE_DATA")

    for trailing_prose in (
        "Lines : 97% confidence interval",
        "All files | 97 | 97 | 97 | 97 tests collected",
        "Lines : 97%\n(97/100)",
        "All files | 97 |\n97 | 97 | 97",
    ):
        with (
            patch(_FIND_WS, return_value=tmp_path),
            patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
        ):
            mock_tool.return_value = {"success": True, "output": trailing_prose, "error": None}
            result = await dev_check_coverage(language="typescript")
        assert_error(result, "NO_COVERAGE_DATA")


async def test_check_coverage_typescript_zero_percent_is_valid_failure(tmp_path) -> None:
    """Legitimate 0% coverage returns COVERAGE_TOO_LOW, not NO_COVERAGE_DATA (#1874)."""
    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, side_effect=_write_vitest_report('{"total": {"lines": {"pct": 0}}}')),
    ):
        result = await dev_check_coverage(language="typescript")

    assert_error(result, "COVERAGE_TOO_LOW")


async def test_check_coverage_typescript_unparseable_errors(tmp_path) -> None:
    """dev_check_coverage returns NO_COVERAGE_DATA when Vitest output has no metrics (#1874)."""
    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {"success": True, "output": "no metrics here", "error": None}
        result = await dev_check_coverage(language="typescript")

    assert_error(result, "NO_COVERAGE_DATA")
    assert "no parseable" in result.error.message.lower()


async def test_check_coverage_rust_reads_tarpaulin_report(tmp_path) -> None:
    """dev_check_coverage parses tarpaulin-report.json instead of hardcoding 0 (#1874)."""
    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(
            _RUN_TOOL,
            side_effect=_write_tarpaulin_report('{"files": [{"covered": 92, "coverable": 100}]}'),
        ),
    ):
        result = await dev_check_coverage(language="rust")

    data = assert_success(result)
    assert data["coverage"] == 92.0
    assert data["status"] == "passing"


async def test_check_coverage_rust_ignores_stale_report_on_failed_run(tmp_path) -> None:
    """A stale workspace tarpaulin-report.json cannot pass a failed tarpaulin run (#1874)."""
    (tmp_path / "tarpaulin-report.json").write_text(
        '{"files": [{"covered": 95, "coverable": 100}]}',
        encoding="utf-8",
    )

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {"success": False, "output": "compile error", "error": "exit 101"}
        result = await dev_check_coverage(language="rust")

    assert_error(result, "NO_COVERAGE_DATA")
    assert "failed" in result.error.message.lower()


async def test_check_coverage_rust_missing_subcommand_gives_install_hint(tmp_path) -> None:
    """Cargo installed without tarpaulin subcommand keeps the install suggestion (#1874)."""
    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {
            "success": False,
            "output": "",
            "error": "error: no such command: `tarpaulin`",
        }
        result = await dev_check_coverage(language="rust")

    assert_error(result, "NO_COVERAGE_DATA")
    assert "cargo install cargo-tarpaulin" in (result.error.suggestion or "")

    for other_error in (
        "error: no such command: `nextest`",
        "error: no such command: `tarpaulin-extra`",
        "error: no such subcommand: tarpaulin-extra",
    ):
        with (
            patch(_FIND_WS, return_value=tmp_path),
            patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
        ):
            mock_tool.return_value = {"success": False, "output": "", "error": other_error}
            other_result = await dev_check_coverage(language="rust")

        assert_error(other_result, "NO_COVERAGE_DATA")
        assert "failed" in other_result.error.message.lower()
        assert "cargo install cargo-tarpaulin" not in (other_result.error.suggestion or "")


async def test_check_coverage_rust_oversized_counts_do_not_crash(tmp_path) -> None:
    """Oversized JSON integers in tarpaulin reports do not raise OverflowError (#1874)."""
    huge = 10**309
    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(
            _RUN_TOOL,
            side_effect=_write_tarpaulin_report(
                f'{{"files": [{{"covered": {huge}, "coverable": {huge * 2}}}]}}'
            ),
        ),
    ):
        result = await dev_check_coverage(language="rust")

    assert_error(result, "COVERAGE_TOO_LOW")
    assert "50.0%" in result.error.message


async def test_check_coverage_rust_reads_stdout_percentage(tmp_path) -> None:
    """dev_check_coverage parses tarpaulin stdout percentage when no report file exists (#1874)."""
    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {
            "success": True,
            "output": "74.25% coverage, 148/200 lines covered",
            "error": None,
        }
        result = await dev_check_coverage(language="rust")

    assert_error(result, "COVERAGE_TOO_LOW")
    assert "74.2%" in result.error.message or "74.3%" in result.error.message
