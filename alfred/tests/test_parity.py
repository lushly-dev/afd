"""Tests for alfred_parity command."""

import tempfile
from pathlib import Path

import pytest

from alfred.commands.parity import (
    alfred_parity,
    parse_typescript_exports,
    parse_python_exports,
    parse_rust_exports,
    _camel_to_snake,
    _normalize,
)


# ─── Unit tests for parsing ──────────────────────────────────────────────────


def test_camel_to_snake():
    assert _camel_to_snake("createError") == "create_error"
    assert _camel_to_snake("CommandResult") == "command_result"
    assert _camel_to_snake("isSuccess") == "is_success"
    assert _camel_to_snake("McpErrorCodes") == "mcp_error_codes"
    assert _camel_to_snake("isBatchRequest") == "is_batch_request"


def test_normalize_already_snake():
    assert _normalize("create_error") == "create_error"
    assert _normalize("is_success") == "is_success"


def test_normalize_camel():
    assert _normalize("createError") == "create_error"
    assert _normalize("CommandResult") == "command_result"


def test_parse_typescript_exports():
    content = """
export type { CommandResult, ResultMetadata } from './result.js';
export { success, failure, isSuccess, isFailure } from './result.js';
export type { CommandError, ErrorCode } from './errors.js';
export { createError, validationError } from './errors.js';
"""
    entries = parse_typescript_exports(content)
    names = {e.name for e in entries}
    assert "CommandResult" in names
    assert "success" in names
    assert "createError" in names

    # Check kinds
    types = {e.name for e in entries if e.kind == "type"}
    funcs = {e.name for e in entries if e.kind == "function"}
    assert "CommandResult" in types
    assert "success" in funcs


def test_parse_python_exports():
    content = '''
__all__ = [
    "__version__",
    "CommandResult",
    "success",
    "failure",
    "CommandError",
    "create_error",
]
'''
    entries = parse_python_exports(content)
    names = {e.name for e in entries}
    assert "CommandResult" in names
    assert "success" in names
    assert "create_error" in names
    # __version__ should be skipped
    assert "__version__" not in names


def test_parse_rust_exports():
    content = """
pub use result::{
    failure, success, CommandResult, ResultMetadata,
};
pub use errors::{
    create_error, CommandError,
};
"""
    entries = parse_rust_exports(content)
    names = {e.name for e in entries}
    assert "CommandResult" in names
    assert "success" in names
    assert "create_error" in names


# ─── Integration tests ───────────────────────────────────────────────────────


@pytest.fixture
def fake_repo(tmp_path):
    """Create a minimal fake repo structure with export files."""
    ts_dir = tmp_path / "packages" / "core" / "src"
    ts_dir.mkdir(parents=True)
    (ts_dir / "index.ts").write_text(
        "export type { CommandResult } from './result.js';\n"
        "export { success, failure } from './result.js';\n",
        encoding="utf-8",
    )

    py_dir = tmp_path / "python" / "src" / "afd"
    py_dir.mkdir(parents=True)
    (py_dir / "__init__.py").write_text(
        '__all__ = [\n'
        '    "CommandResult",\n'
        '    "success",\n'
        '    "failure",\n'
        ']\n',
        encoding="utf-8",
    )

    rs_dir = tmp_path / "packages" / "rust" / "src"
    rs_dir.mkdir(parents=True)
    (rs_dir / "lib.rs").write_text(
        "pub use result::{\n"
        "    success, failure, CommandResult,\n"
        "};\n",
        encoding="utf-8",
    )

    return tmp_path


@pytest.mark.asyncio
async def test_parity_all_match(fake_repo):
    """When all languages export the same names, gaps should be zero."""
    result = await alfred_parity(str(fake_repo))
    assert result.success is True
    assert result.data["total_gaps"] == 0
    assert result.confidence == 1.0


@pytest.mark.asyncio
async def test_parity_detects_missing(fake_repo):
    """When Python is missing an export, it should be reported."""
    py_init = fake_repo / "python" / "src" / "afd" / "__init__.py"
    py_init.write_text(
        '__all__ = [\n'
        '    "CommandResult",\n'
        '    "success",\n'
        ']\n',
        encoding="utf-8",
    )
    result = await alfred_parity(str(fake_repo))
    assert result.success is True
    assert "failure" in result.data["missing_from_python"]
    assert result.data["total_gaps"] > 0
    assert result.confidence < 1.0


@pytest.mark.asyncio
async def test_parity_missing_files():
    """Running parity on a dir without export files should error."""
    with tempfile.TemporaryDirectory() as d:
        result = await alfred_parity(d)
        assert result.success is False
        assert result.error.code == "NOT_FOUND"


@pytest.mark.asyncio
async def test_parity_on_real_repo():
    """Run parity on the actual AFD repo (if available)."""
    # This test runs from the repo root
    repo_root = Path(__file__).parent.parent.parent
    ts_file = repo_root / "packages" / "core" / "src" / "index.ts"
    if not ts_file.exists():
        pytest.skip("Not running from AFD repo root")

    result = await alfred_parity(str(repo_root))
    assert result.success is True
    assert result.data["counts"]["typescript"] > 0
    assert result.data["counts"]["python"] > 0
    assert result.data["counts"]["rust"] > 0
