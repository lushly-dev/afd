"""Targeted tests for remaining valuable coverage gaps."""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from afd.testing import assert_error, assert_success

from botcore.commands.dev.analysis import dev_circular_imports, dev_dep_graph
from botcore.commands.dev.quality import _collect_staged_deps
from botcore.commands.research import _extract_sources
from botcore.commands.skill.lint import skill_lint

# ── skill/lint.py — untested validation rules ────────────────────────────


def _setup_skill_ws(tmp_path: Path) -> Path:
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'\n\n[tool.botcore]\n",
        encoding="utf-8",
    )
    return tmp_path


async def test_lint_sk003_missing_description(tmp_path) -> None:
    """SK003: Missing description triggers error."""
    ws = _setup_skill_ws(tmp_path)
    skills_dir = ws / ".claude" / "skills" / "no-desc"
    skills_dir.mkdir(parents=True)
    (skills_dir / "SKILL.md").write_text(
        "---\nname: no-desc\nversion: '1.0.0'\ntriggers:\n  - test\n---\n\nBody.",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    violations = result.data["skills"][0]["violations"]
    assert any(v["rule"] == "SK003" for v in violations)


async def test_lint_sk005_long_description(tmp_path) -> None:
    """SK005: Overly long description is a warning."""
    ws = _setup_skill_ws(tmp_path)
    skills_dir = ws / ".claude" / "skills" / "long-desc"
    skills_dir.mkdir(parents=True)
    long_desc = "A" * 1100
    (skills_dir / "SKILL.md").write_text(
        f"---\nname: long-desc\ndescription: {long_desc}\n"
        f"version: '1.0.0'\ntriggers:\n  - test\n---\n\nBody.",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    violations = result.data["skills"][0]["violations"]
    assert any(v["rule"] == "SK005" for v in violations)


async def test_lint_sk008_missing_referenced_file(tmp_path) -> None:
    """SK008: Referenced file that doesn't exist triggers error."""
    ws = _setup_skill_ws(tmp_path)
    skills_dir = ws / ".claude" / "skills" / "bad-ref"
    skills_dir.mkdir(parents=True)
    refs = skills_dir / "references"
    refs.mkdir()
    (skills_dir / "SKILL.md").write_text(
        "---\nname: bad-ref\ndescription: Test.\n"
        "version: '1.0.0'\ntriggers:\n  - test\n---\n\n"
        "See references/nonexistent.md for details.\n",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    violations = result.data["skills"][0]["violations"]
    assert any(v["rule"] == "SK008" for v in violations)


async def test_lint_sk009_body_too_long(tmp_path) -> None:
    """SK009: Body exceeding max length is a warning."""
    ws = _setup_skill_ws(tmp_path)
    skills_dir = ws / ".claude" / "skills" / "long-body"
    skills_dir.mkdir(parents=True)
    long_body = "x " * 30_000
    (skills_dir / "SKILL.md").write_text(
        "---\nname: long-body\ndescription: Test.\n"
        f"version: '1.0.0'\ntriggers:\n  - test\n---\n\n{long_body}\n",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    violations = result.data["skills"][0]["violations"]
    assert any(v["rule"] == "SK009" for v in violations)


async def test_lint_sk014_orphan_reference(tmp_path) -> None:
    """SK014: Reference file not mentioned in body is a warning."""
    ws = _setup_skill_ws(tmp_path)
    skills_dir = ws / ".claude" / "skills" / "orphan-ref"
    skills_dir.mkdir(parents=True)
    refs = skills_dir / "references"
    refs.mkdir()
    (refs / "unused.txt").write_text("Some reference content")
    (skills_dir / "SKILL.md").write_text(
        "---\nname: orphan-ref\ndescription: Test.\n"
        "version: '1.0.0'\ntriggers:\n  - test\n---\n\n"
        "Body that doesn't reference anything.\n",
        encoding="utf-8",
    )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    violations = result.data["skills"][0]["violations"]
    assert any(v["rule"] == "SK014" for v in violations)


async def test_lint_sk015_duplicate_names(tmp_path) -> None:
    """SK015: Duplicate skill names trigger error."""
    ws = _setup_skill_ws(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    for dirname in ("skill-a", "skill-b"):
        d = skills_dir / dirname
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(
            "---\nname: same-name\ndescription: Test.\n"
            "version: '1.0.0'\ntriggers:\n  - test\n---\n\nBody.\n",
            encoding="utf-8",
        )

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint()

    all_violations = []
    for s in result.data["skills"]:
        all_violations.extend(s["violations"])
    assert any(v["rule"] == "SK015" for v in all_violations)


async def test_lint_skill_path_not_found(tmp_path) -> None:
    """Lint single skill returns error when path not found."""
    ws = _setup_skill_ws(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)

    with patch("botcore.commands.skill.lint.find_workspace", return_value=ws):
        result = await skill_lint(path="nonexistent")

    assert_error(result, "SKILL_NOT_FOUND")


# ── dev/quality.py — _collect_staged_deps ────────────────────────────────


def test_collect_staged_deps_pyproject(tmp_path) -> None:
    """Parses added dependency lines from git diff."""
    with patch("botcore.commands.dev.quality.subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0,
            stdout='+++\n+"requests>=2.28",\n+"pydantic[email]>=2.0",\n',
            stderr="",
        )
        deps = _collect_staged_deps(tmp_path)

    assert "requests" in deps
    assert "pydantic" in deps


def test_collect_staged_deps_requirements_txt(tmp_path) -> None:
    """Parses added deps from requirements.txt diff."""
    (tmp_path / "requirements.txt").write_text("flask\n")

    def mock_run_side_effect(*args, **kwargs):
        cmd = args[0] if args else kwargs.get("args", [])
        if "requirements.txt" in cmd:
            return subprocess.CompletedProcess(
                args=cmd, returncode=0,
                stdout="+++\n+flask\n+gunicorn\n",
                stderr="",
            )
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    with patch("botcore.commands.dev.quality.subprocess.run", side_effect=mock_run_side_effect):
        deps = _collect_staged_deps(tmp_path)

    assert "flask" in deps
    assert "gunicorn" in deps


def test_collect_staged_deps_no_changes(tmp_path) -> None:
    """Returns empty list when no staged changes."""
    with patch("botcore.commands.dev.quality.subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr="",
        )
        deps = _collect_staged_deps(tmp_path)

    assert deps == []


# ── dev/analysis.py — circular imports with actual cycles ────────────────


async def test_circular_imports_python_finds_cycles(tmp_path) -> None:
    """Detects circular imports in Python code with actual cycles."""
    src = tmp_path / "src"
    pkg = src / "mylib"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("")
    # Explicit submodule cross-imports create a detectable cycle
    (pkg / "a.py").write_text("from mylib.b import something\n")
    (pkg / "b.py").write_text("from mylib.a import something\n")

    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_circular_imports(path=str(src), language="python")

    assert_error(result, "CIRCULAR_IMPORTS")
    assert "circular import" in result.error.message.lower()


async def test_dep_graph_python_with_imports(tmp_path) -> None:
    """Dep graph captures internal import relationships."""
    src = tmp_path / "src"
    pkg = src / "mylib"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("")
    (pkg / "core.py").write_text("from mylib import utils\n")
    (pkg / "utils.py").write_text("import os\n")

    with patch("botcore.commands.dev.analysis.find_workspace", return_value=tmp_path):
        result = await dev_dep_graph(path=str(src), language="python")

    data = assert_success(result)
    assert data["module_count"] >= 2
    assert data["edges"] >= 1


# ── research.py — _extract_sources ───────────────────────────────────────


def _message(*urls: str) -> SimpleNamespace:
    annotations = [SimpleNamespace(type="url_citation", url=url) for url in urls]
    return SimpleNamespace(type="message", content=[SimpleNamespace(annotations=annotations)])


def test_extract_sources_with_citations() -> None:
    """Extracts URLs from url_citation annotations."""
    response = SimpleNamespace(output=[_message("https://example.com/1", "https://example.com/2")])

    sources = _extract_sources(response)
    assert sources == ["https://example.com/1", "https://example.com/2"]


def test_extract_sources_no_output() -> None:
    """Returns empty list when the response has no output items."""
    assert _extract_sources(SimpleNamespace(output=[])) == []


def test_extract_sources_ignores_other_annotations() -> None:
    """Non-citation annotations and parts without annotations are skipped."""
    part = SimpleNamespace(annotations=[SimpleNamespace(type="file_citation", file_id="f1")])
    response = SimpleNamespace(
        output=[SimpleNamespace(type="message", content=[part, SimpleNamespace()])],
    )
    assert _extract_sources(response) == []


def test_extract_sources_search_call_without_sources() -> None:
    """A web_search_call whose action carries no sources adds nothing."""
    call = SimpleNamespace(type="web_search_call", action=SimpleNamespace(query="q"))
    assert _extract_sources(SimpleNamespace(output=[call])) == []


def test_extract_sources_truncates_to_10() -> None:
    """Limits sources to 10."""
    response = SimpleNamespace(output=[_message(*(f"https://example.com/{i}" for i in range(15)))])

    sources = _extract_sources(response)
    assert len(sources) == 10


def test_extract_sources_missing_attributes() -> None:
    """Handles response objects without expected attributes."""
    response = SimpleNamespace()  # No output attr
    assert _extract_sources(response) == []
