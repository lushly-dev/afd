"""Bind the imported functions and file set to the reviewed provenance record."""

from __future__ import annotations

import ast
import hashlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / "provenance" / "provenance.json"
# Pinned so a changed claim cannot pass by rehashing the record alone.
RECORD_SHA256 = "14ecd098423d59e1063cabbc633c28076d42dc73a5867915e01279bb93b07ee8"
SOURCE_REVISION = "35e3cf041f9daff1354c9e8aee05388389397a0d"
IGNORED = {".venv", "__pycache__", ".pytest_cache", ".ruff_cache", "dist", "build"}

pytestmark = pytest.mark.skipif(
    not RECORD.is_file() or (ROOT / "PKG-INFO").is_file(),
    reason="provenance binds the repository tree, not an unpacked sdist",
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def record() -> dict:
    return json.loads(RECORD.read_text())


def functions(path: Path) -> dict[str, tuple[str, str]]:
    text = path.read_text()
    lines = text.splitlines(keepends=True)
    return {
        node.name: (
            sha256("".join(lines[node.lineno - 1 : node.end_lineno]).encode()),
            sha256(ast.dump(node).encode()),
        )
        for node in ast.parse(text).body
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
    }


def test_record_is_the_reviewed_one():
    assert sha256(RECORD.read_bytes()) == RECORD_SHA256


def test_source_identity_and_privacy_boundary():
    data = record()
    source = data["source"]
    assert source["revision"] == SOURCE_REVISION
    assert source["visibility"] == "private"
    assert source["history_imported"] is False
    assert data["license"] == "MIT"
    assert data["release"] == {
        "distribution": "lushly-health",
        "version": "0.1.0",
        "identity_status": "tentative",
        "publication_state": "quarantined",
        "publisher_authority": "none",
    }


def test_selected_functions_are_the_reviewed_source_functions():
    data = record()
    imported = functions(ROOT / "src/botcore_health/checks.py")
    selected = {row["name"]: row for row in data["selected_functions"]}
    assert set(imported) == set(selected), "checks.py holds only recorded source functions"
    # ast.dump differs between Python versions; the text hash binds every version.
    same_ast_format = data["source_ast_python"] == "{}.{}".format(*sys.version_info[:2])
    for name, (text_hash, ast_hash) in imported.items():
        row = selected[name]
        assert text_hash == row["imported_sha256"], f"{name} changed after import"
        if same_ast_format:
            assert ast_hash == row["source_ast_sha256"], f"{name} differs from the source"
        expected = "byte-identical" if row["source_sha256"] == text_hash else "reformatted"
        assert row["relation"] == expected


def test_every_file_is_recorded_and_derived_files_are_unchanged():
    data = record()
    files = {row["path"]: row for row in data["files"]}
    present = sorted(
        str(path.relative_to(ROOT))
        for path in ROOT.rglob("*")
        if path.is_file()
        and path != RECORD
        and not set(path.relative_to(ROOT).parts) & IGNORED
        and not any(part.endswith(".egg-info") for part in path.parts)
    )
    assert present == sorted(files), "add new files to the provenance record"
    for path, row in files.items():
        assert row["origin"] in {"derived", "authored", "license"}
        if row["origin"] in {"derived", "license"}:
            assert sha256((ROOT / path).read_bytes()) == row["sha256"], path
    assert files["src/botcore_health/checks.py"]["origin"] == "derived"
    assert (ROOT / "LICENSE").read_bytes() == (ROOT.parents[1] / "LICENSE").read_bytes()
