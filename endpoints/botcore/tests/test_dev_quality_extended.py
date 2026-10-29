"""Tests for botcore.commands.dev.quality — coverage and dependency checking."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

from afd.testing import assert_error, assert_success

from botcore.commands.dev.quality import (
    _check_cargo_deps,
    _check_npm_deps,
    _collect_all_deps,
    dev_check_coverage,
    dev_check_deps,
)

# ── _collect_all_deps ────────────────────────────────────────────────────


def test_collect_all_deps(tmp_path) -> None:
    """Collects dependency names from pyproject.toml."""
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "test"\ndependencies = [\n'
        '  "requests>=2.28",\n  "pydantic[email]>=2.0",\n  "aiohttp"\n]\n'
    )
    deps = _collect_all_deps(tmp_path)
    assert "requests" in deps
    assert "pydantic" in deps
    assert "aiohttp" in deps


def test_collect_all_deps_no_file(tmp_path) -> None:
    """Returns empty list when no pyproject.toml."""
    deps = _collect_all_deps(tmp_path)
    assert deps == []


def test_collect_all_deps_no_dependencies(tmp_path) -> None:
    """Returns empty list when no dependencies declared."""
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "test"\n')
    deps = _collect_all_deps(tmp_path)
    assert deps == []


# ── dev_check_coverage ───────────────────────────────────────────────────


async def test_check_coverage_no_workspace() -> None:
    """Returns error when no workspace found."""
    with patch("botcore.commands.dev.quality.find_workspace", return_value=None):
        result = await dev_check_coverage()

    assert_error(result, "NO_WORKSPACE")


async def test_check_coverage_python_success(tmp_path) -> None:
    """Python coverage check succeeds when above threshold."""
    (tmp_path / "pyproject.toml").write_text("[tool.botcore]\ncoverage_threshold = 70\n")
    coverage_data = {"totals": {"percent_covered": 85.5}}
    (tmp_path / "coverage.json").write_text(json.dumps(coverage_data))

    with (
        patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.quality.run_python_module", new_callable=AsyncMock),
    ):
        result = await dev_check_coverage(language="python")

    data = assert_success(result)
    assert data["coverage"] == 85.5
    assert data["status"] == "passing"


async def test_check_coverage_python_below_threshold(tmp_path) -> None:
    """Python coverage check fails when below threshold."""
    (tmp_path / "pyproject.toml").write_text("[tool.botcore]\ncoverage_threshold = 90\n")
    coverage_data = {"totals": {"percent_covered": 50.0}}
    (tmp_path / "coverage.json").write_text(json.dumps(coverage_data))

    with (
        patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.quality.run_python_module", new_callable=AsyncMock),
    ):
        result = await dev_check_coverage(language="python")

    assert_error(result, "COVERAGE_TOO_LOW")


async def test_check_coverage_python_no_data(tmp_path) -> None:
    """Python coverage check errors when no coverage.json."""
    (tmp_path / "pyproject.toml").write_text("[tool.botcore]\n")

    with (
        patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.quality.run_python_module", new_callable=AsyncMock),
    ):
        result = await dev_check_coverage(language="python")

    assert_error(result, "NO_COVERAGE_DATA")


async def test_check_coverage_typescript(tmp_path) -> None:
    """TS coverage dispatches to vitest."""
    (tmp_path / "pyproject.toml").write_text("[tool.botcore]\n")

    with (
        patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path),
        patch(
            "botcore.commands.dev.quality.run_external_tool",
            new_callable=AsyncMock,
        ) as mock_tool,
    ):
        mock_tool.return_value = {"success": True, "output": "", "error": None}
        result = await dev_check_coverage(language="typescript")

    assert_error(result, "COVERAGE_TOO_LOW")  # coverage=0 < 80 default


async def test_check_coverage_typescript_not_available(tmp_path) -> None:
    """TS coverage errors when vitest not found."""
    (tmp_path / "pyproject.toml").write_text("[tool.botcore]\n")

    with (
        patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.quality.run_external_tool", new_callable=AsyncMock) as mock,
    ):
        mock.return_value = None
        result = await dev_check_coverage(language="typescript")

    assert_error(result, "NO_COVERAGE_DATA")


async def test_check_coverage_rust_not_available(tmp_path) -> None:
    """Rust coverage errors when tarpaulin not found."""
    (tmp_path / "pyproject.toml").write_text("[tool.botcore]\n")

    with (
        patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.quality.run_external_tool", new_callable=AsyncMock) as mock,
    ):
        mock.return_value = None
        result = await dev_check_coverage(language="rust")

    assert_error(result, "NO_COVERAGE_DATA")


async def test_check_coverage_warning_zone(tmp_path) -> None:
    """Coverage between threshold and warn_threshold returns warning status."""
    (tmp_path / "pyproject.toml").write_text(
        "[tool.botcore]\ncoverage_threshold = 60\ncoverage_warn_threshold = 90\n"
    )
    coverage_data = {"totals": {"percent_covered": 75.0}}
    (tmp_path / "coverage.json").write_text(json.dumps(coverage_data))

    with (
        patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.quality.run_python_module", new_callable=AsyncMock),
    ):
        result = await dev_check_coverage(language="python")

    data = assert_success(result)
    assert data["status"] == "warning"


# ── _check_npm_deps ──────────────────────────────────────────────────────


async def test_check_npm_deps_with_outdated(tmp_path) -> None:
    """npm deps check reports outdated packages."""
    with patch(
        "botcore.commands.dev.quality.run_external_tool", new_callable=AsyncMock,
    ) as mock_tool:
        mock_tool.return_value = {
            "success": True,
            "output": json.dumps({"lodash": {"current": "4.0.0", "wanted": "4.17.21"}}),
            "error": None,
        }
        result = await _check_npm_deps(tmp_path)

    data = assert_success(result)
    assert "lodash" in data["outdated"]


async def test_check_npm_deps_all_current(tmp_path) -> None:
    """npm deps check reports all current when no outdated."""
    with patch(
        "botcore.commands.dev.quality.run_external_tool", new_callable=AsyncMock,
    ) as mock_tool:
        mock_tool.return_value = {"success": True, "output": "{}", "error": None}
        result = await _check_npm_deps(tmp_path)

    data = assert_success(result)
    assert data["outdated"] == []


async def test_check_npm_deps_invalid_json(tmp_path) -> None:
    """npm deps handles invalid JSON output."""
    with patch(
        "botcore.commands.dev.quality.run_external_tool", new_callable=AsyncMock,
    ) as mock_tool:
        mock_tool.return_value = {"success": True, "output": "not json", "error": None}
        result = await _check_npm_deps(tmp_path)

    data = assert_success(result)
    assert data["outdated"] == []


# ── _check_cargo_deps ────────────────────────────────────────────────────


async def test_check_cargo_deps_outdated(tmp_path) -> None:
    """Cargo deps check reports outdated crates."""
    cargo_output = json.dumps({
        "dependencies": [
            {"name": "serde", "current": "1.0.0", "latest": "1.0.200"},
        ],
    })
    with patch(
        "botcore.commands.dev.quality.run_external_tool", new_callable=AsyncMock,
    ) as mock_tool:
        mock_tool.return_value = {"success": True, "output": cargo_output, "error": None}
        result = await _check_cargo_deps(tmp_path)

    data = assert_success(result)
    assert "serde" in data["outdated"]


async def test_check_cargo_deps_not_found(tmp_path) -> None:
    """Cargo deps check errors when cargo-outdated not found."""
    with patch(
        "botcore.commands.dev.quality.run_external_tool", new_callable=AsyncMock,
    ) as mock_tool:
        mock_tool.return_value = None
        result = await _check_cargo_deps(tmp_path)

    assert_error(result, "CARGO_OUTDATED_NOT_FOUND")


# ── dev_check_deps (integration) ────────────────────────────────────────


async def test_check_deps_no_workspace() -> None:
    """dev_check_deps errors without workspace."""
    with patch("botcore.commands.dev.quality.find_workspace", return_value=None):
        result = await dev_check_deps()

    assert_error(result, "NO_WORKSPACE")


async def test_check_deps_rust_dispatch(tmp_path) -> None:
    """dev_check_deps dispatches to cargo-outdated for Rust."""
    (tmp_path / "Cargo.toml").write_text('[package]\nname = "test"')

    with (
        patch("botcore.commands.dev.quality.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.quality.run_external_tool", new_callable=AsyncMock) as mock,
    ):
        mock.return_value = {"success": True, "output": '{"dependencies": []}', "error": None}
        result = await dev_check_deps(language="rust")

    assert_success(result)
