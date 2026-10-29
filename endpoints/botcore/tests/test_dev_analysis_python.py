"""Tests for botcore.commands.dev.analysis — Python analysis paths."""

from __future__ import annotations

import subprocess
from unittest.mock import AsyncMock, patch

from afd.testing import assert_error, assert_success

from botcore.commands.dev.analysis import (
    _find_cycles,
    _scan_imports,
    dev_circular_imports,
    dev_dead_code,
    dev_dep_graph,
    dev_unused_deps,
)

# ── _find_cycles ─────────────────────────────────────────────────────────


def test_find_cycles_detects_simple_cycle() -> None:
    """Finds A -> B -> A cycle."""
    graph = {"a": {"b"}, "b": {"a"}}
    known = {"a", "b"}
    cycles = _find_cycles(graph, known)
    assert len(cycles) >= 1
    # One of the cycles should contain both a and b
    assert any("a" in c and "b" in c for c in cycles)


def test_find_cycles_no_cycles() -> None:
    """Returns empty when no cycles exist."""
    graph = {"a": {"b"}, "b": {"c"}}
    known = {"a", "b", "c"}
    cycles = _find_cycles(graph, known)
    assert cycles == []


def test_find_cycles_self_loop_ignored() -> None:
    """Single-node self-loops need more than 1 unique node."""
    graph = {"a": {"a"}}
    known = {"a"}
    cycles = _find_cycles(graph, known)
    assert cycles == []


def test_find_cycles_three_node_cycle() -> None:
    """Finds A -> B -> C -> A cycle."""
    graph = {"a": {"b"}, "b": {"c"}, "c": {"a"}}
    known = {"a", "b", "c"}
    cycles = _find_cycles(graph, known)
    assert len(cycles) >= 1


# ── _scan_imports ────────────────────────────────────────────────────────


def test_scan_imports_finds_third_party(tmp_path) -> None:
    """Identifies third-party imports from Python files."""
    (tmp_path / "app.py").write_text(
        "import os\nimport requests\nfrom pydantic import BaseModel\n"
    )
    result = _scan_imports(tmp_path)
    assert "requests" in result
    assert "pydantic" in result
    assert "os" not in result  # stdlib excluded


def test_scan_imports_skips_pycache(tmp_path) -> None:
    """Skips __pycache__ directories."""
    cache_dir = tmp_path / "__pycache__"
    cache_dir.mkdir()
    (cache_dir / "cached.py").write_text("import pandas\n")
    (tmp_path / "app.py").write_text("import flask\n")
    result = _scan_imports(tmp_path)
    assert "flask" in result
    assert "pandas" not in result


def test_scan_imports_handles_syntax_error(tmp_path) -> None:
    """Gracefully skips files with syntax errors."""
    (tmp_path / "bad.py").write_text("def broken(:\n")
    (tmp_path / "good.py").write_text("import httpx\n")
    result = _scan_imports(tmp_path)
    assert "httpx" in result


def test_scan_imports_from_import(tmp_path) -> None:
    """Handles 'from X import Y' style."""
    (tmp_path / "app.py").write_text("from boto3.session import Session\n")
    result = _scan_imports(tmp_path)
    assert "boto3" in result


# ── dev_dead_code (Python path) ──────────────────────────────────────────


async def test_dead_code_python_vulture(tmp_path) -> None:
    """dev_dead_code runs vulture for Python and parses output."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.py").write_text("def unused_func():\n    pass\n")

    vulture_output = f"{src / 'app.py'}:1: unused function 'unused_func' (60% confidence)\n"

    with (
        patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.analysis.subprocess.run") as mock_run,
    ):
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=vulture_output, stderr="",
        )
        result = await dev_dead_code(language="python")

    data = assert_success(result)
    assert data["count"] == 1
    assert "unused function" in data["issues"][0]["message"]
    assert data["summary"]["unused_functions"] == 1


async def test_dead_code_python_no_issues(tmp_path) -> None:
    """dev_dead_code reports no issues when vulture finds nothing."""
    src = tmp_path / "src"
    src.mkdir()

    with (
        patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.analysis.subprocess.run") as mock_run,
    ):
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr="",
        )
        result = await dev_dead_code(language="python")

    data = assert_success(result)
    assert data["count"] == 0


async def test_dead_code_rust_tool_not_found(tmp_path) -> None:
    """dev_dead_code skips when cargo-udeps not found for Rust."""
    with (
        patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.analysis.run_external_tool", new_callable=AsyncMock) as mock,
    ):
        mock.return_value = None
        result = await dev_dead_code(language="rust")

    data = assert_success(result)
    assert data.get("skipped") is True


# ── dev_circular_imports (Python path) ───────────────────────────────────


async def test_circular_imports_python_no_cycles(tmp_path) -> None:
    """Python circular imports check finds no cycles in clean code."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "__init__.py").write_text("")
    (src / "a.py").write_text("import os\n")
    (src / "b.py").write_text("import sys\n")

    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_circular_imports(path=str(src), language="python")

    data = assert_success(result)
    assert data["cycle_count"] == 0


async def test_circular_imports_python_path_not_found(tmp_path) -> None:
    """Returns error for nonexistent path."""
    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_circular_imports(path=str(tmp_path / "nonexistent"), language="python")

    assert_error(result, "PATH_NOT_FOUND")


# ── dev_unused_deps (Python path) ────────────────────────────────────────


async def test_unused_deps_python(tmp_path) -> None:
    """dev_unused_deps detects potentially unused Python deps."""
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "test"\ndependencies = ["requests", "unused-lib"]\n'
    )
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.py").write_text("import requests\n")

    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_unused_deps(language="python")

    data = assert_success(result)
    assert "unused_lib" in data["potentially_unused"]
    assert "requests" not in data["potentially_unused"]


async def test_unused_deps_python_all_used(tmp_path) -> None:
    """dev_unused_deps reports all deps used."""
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "test"\ndependencies = ["requests"]\n'
    )
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.py").write_text("import requests\n")

    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_unused_deps(language="python")

    data = assert_success(result)
    assert len(data["potentially_unused"]) == 0


async def test_unused_deps_no_workspace() -> None:
    """Returns error without workspace."""
    with patch("botcore.commands.dev.analysis.find_workspace", return_value=None):
        result = await dev_unused_deps(language="python")

    assert_error(result, "NO_WORKSPACE")


async def test_unused_deps_no_pyproject(tmp_path) -> None:
    """Returns error when no pyproject.toml."""
    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_unused_deps(language="python")

    assert_error(result, "NO_PYPROJECT")


async def test_unused_deps_rust_not_found(tmp_path) -> None:
    """dev_unused_deps skips when cargo-udeps not found."""
    with (
        patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.analysis.run_external_tool", new_callable=AsyncMock) as mock,
    ):
        mock.return_value = None
        result = await dev_unused_deps(language="rust")

    data = assert_success(result)
    assert data.get("skipped") is True


async def test_unused_deps_ts_not_found(tmp_path) -> None:
    """dev_unused_deps skips when depcheck not found."""
    with (
        patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.analysis.run_external_tool", new_callable=AsyncMock) as mock,
    ):
        mock.return_value = None
        result = await dev_unused_deps(language="typescript")

    data = assert_success(result)
    assert data.get("skipped") is True


# ── dev_dep_graph (Python path) ──────────────────────────────────────────


async def test_dep_graph_python(tmp_path) -> None:
    """Python dep graph generates module graph."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "__init__.py").write_text("")
    (src / "core.py").write_text("import os\n")
    (src / "utils.py").write_text("import sys\n")

    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_dep_graph(path=str(src), language="python")

    data = assert_success(result)
    assert data["module_count"] >= 2
    assert "core" in data["modules"] or any("core" in m for m in data["modules"])


async def test_dep_graph_dot_output(tmp_path) -> None:
    """Python dep graph can output DOT format."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.py").write_text("")
    (src / "b.py").write_text("")

    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_dep_graph(path=str(src), output="dot", language="python")

    data = assert_success(result)
    assert "dot" in data
    assert "digraph" in data["dot"]


async def test_dep_graph_path_not_found(tmp_path) -> None:
    """Returns error for nonexistent path."""
    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_dep_graph(path=str(tmp_path / "nonexistent"), language="python")

    assert_error(result, "PATH_NOT_FOUND")


async def test_dep_graph_rust_found(tmp_path) -> None:
    """dep graph dispatches to cargo-modules for Rust."""
    with (
        patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.analysis.run_external_tool", new_callable=AsyncMock) as mock,
    ):
        mock.return_value = {"success": True, "output": "crate structure", "error": None}
        result = await dev_dep_graph(language="rust")

    data = assert_success(result)
    assert data.get("tool") == "cargo-modules"
