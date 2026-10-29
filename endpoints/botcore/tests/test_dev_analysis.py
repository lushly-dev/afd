"""Tests for botcore.commands.dev.analysis — multi-language analysis commands."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from afd.testing import assert_error, assert_success

from botcore.commands.dev.analysis import (
    dev_circular_imports,
    dev_dead_code,
    dev_dep_graph,
    dev_unused_deps,
)

_MOD = "botcore.commands.dev.analysis"
_FIND_WS = f"{_MOD}.find_workspace"
_RUN_TOOL = f"{_MOD}.run_external_tool"


async def test_dead_code_ts_tool_not_found(tmp_path) -> None:
    """dev_dead_code skips with warning when knip not found for TypeScript."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = None
        result = await dev_dead_code(language="typescript")

    data = assert_success(result)
    assert data.get("skipped") is True


async def test_dead_code_ts_runs_knip(tmp_path) -> None:
    """dev_dead_code dispatches to knip for TypeScript."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {"success": True, "output": "No issues", "error": None}
        result = await dev_dead_code(language="typescript")

    data = assert_success(result)
    assert data.get("tool") == "knip"
    mock_tool.assert_called_once()


async def test_dead_code_rust_runs_cargo_udeps(tmp_path) -> None:
    """dev_dead_code dispatches to cargo-udeps for Rust."""
    (tmp_path / "Cargo.toml").write_text('[package]\nname = "test"')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {"success": True, "output": "", "error": None}
        result = await dev_dead_code(language="rust")

    data = assert_success(result)
    assert data.get("tool") == "cargo-udeps"


async def test_circular_imports_ts_runs_madge(tmp_path) -> None:
    """dev_circular_imports dispatches to madge for TypeScript."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {"success": True, "output": "No circular", "error": None}
        result = await dev_circular_imports(language="typescript")

    data = assert_success(result)
    assert data.get("tool") == "madge"


async def test_circular_imports_ts_detects_cycles(tmp_path) -> None:
    """madge cycle output ("N) a > b" lines) becomes a CIRCULAR_DEPS error."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {
            "success": False,
            "output": "Processed 2 files\n\n1) _a.ts > _b.ts\n",
            "error": None,
        }
        result = await dev_circular_imports(language="typescript")

    err = assert_error(result, "CIRCULAR_DEPS")
    assert "_a.ts > _b.ts" in err.message
    # --extensions must be passed or madge processes 0 TypeScript files
    assert "--extensions" in mock_tool.call_args.args[1]


async def test_circular_imports_ts_clean_output_is_not_a_cycle(tmp_path) -> None:
    """madge's "No circular dependency found!" prose must not read as a cycle."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {
            "success": True,
            "output": "Processed 361 files\n\n✔ No circular dependency found!\n",
            "error": None,
        }
        result = await dev_circular_imports(language="typescript")

    data = assert_success(result)
    assert data.get("cycle_count") == 0
    assert data.get("files_processed") == 361


async def test_circular_imports_ts_zero_files_is_an_error(tmp_path) -> None:
    """madge processing 0 files means a mis-targeted scan, not a clean graph."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {
            "success": True,
            "output": "Processed 0 files (140ms)\n\n✔ No circular dependency found!\n",
            "error": None,
        }
        result = await dev_circular_imports(language="typescript")

    assert_error(result, "NO_FILES_SCANNED")


async def test_circular_imports_ts_tool_not_found(tmp_path) -> None:
    """dev_circular_imports skips when madge not found."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = None
        result = await dev_circular_imports(language="typescript")

    data = assert_success(result)
    assert data.get("skipped") is True


async def test_unused_deps_ts_runs_depcheck(tmp_path) -> None:
    """dev_unused_deps dispatches to depcheck for TypeScript."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {
            "success": True,
            "output": '{"dependencies": ["lodash"], "devDependencies": []}',
            "error": None,
        }
        result = await dev_unused_deps(language="typescript")

    data = assert_success(result)
    assert data.get("tool") == "depcheck"
    assert "lodash" in data["potentially_unused"]


async def test_dep_graph_ts_runs_madge(tmp_path) -> None:
    """dev_dep_graph dispatches to madge --json for TypeScript."""
    (tmp_path / "package.json").write_text('{"name": "test"}')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = {
            "success": True,
            "output": '{"src/index.ts": ["src/utils.ts"]}',
            "error": None,
        }
        result = await dev_dep_graph(language="typescript")

    data = assert_success(result)
    assert data.get("tool") == "madge"
    assert data["module_count"] == 1


async def test_dep_graph_rust_tool_not_found(tmp_path) -> None:
    """dev_dep_graph skips when cargo-modules not found."""
    (tmp_path / "Cargo.toml").write_text('[package]\nname = "test"')

    with (
        patch(_FIND_WS, return_value=tmp_path),
        patch(_RUN_TOOL, new_callable=AsyncMock) as mock_tool,
    ):
        mock_tool.return_value = None
        result = await dev_dep_graph(language="rust")

    data = assert_success(result)
    assert data.get("skipped") is True
