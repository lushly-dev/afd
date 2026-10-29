"""Regression tests for SK008 reference resolution in both skill linters (issue #15)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from afd.testing import assert_success

from botcore.commands.skill.lint import skill_lint
from botcore.commands.skill_lint import _check_reference_links

# Bodies that point at repo docs or existing skill-local files: no SK008.
_CLEAN_BODIES = [
    "See [docs/references/runtime-profiles.md](../../../docs/references/runtime-profiles.md).",
    "See [`docs/references/runtime-profiles.md`](../../../docs/references/runtime-profiles.md).",
    "Read `docs/references/runtime-profiles.md` first.",
    "See [guide](references/guide.md).",
    "See [`references/guide.md`](references/guide.md#setup).",
    "See [guide](./references/guide.md), or references/guide.md.",
    'See [guide](references/guide.md "Guide") and **references/guide.md**!',
    "| file |\n|---|\n|references/sub/deep.md|",
    "Mentions docs/references/missing.md, which is not a skill-local file.",
]

# Bodies with a missing skill-local reference, and the name SK008 must report.
_MISSING_BODIES = [
    ("See references/nonexistent.md for details.", "nonexistent.md"),
    ("See [`references/missing.md`](references/missing.md).", "missing.md"),
    ("See [missing](./references/missing.md#part).", "missing.md"),
    ("See *references/sub/missing.md*.", "sub/missing.md"),
]


def _make_skill(base: Path, body: str) -> Path:
    skill_dir = base / "demo"
    (skill_dir / "references").mkdir(parents=True)
    (skill_dir / "references" / "guide.md").write_text("# Guide\n", encoding="utf-8")
    (skill_dir / "references" / "sub").mkdir()
    (skill_dir / "references" / "sub" / "deep.md").write_text("# Deep\n", encoding="utf-8")
    (skill_dir / "SKILL.md").write_text(
        "---\nname: demo\ndescription: A demo skill.\nversion: '1.0.0'\n"
        f"triggers:\n  - demo\n---\n\n# Demo\n\n{body}\n",
        encoding="utf-8",
    )
    return skill_dir


async def _sk008_messages(tmp_path: Path, body: str) -> list[str]:
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'\n\n[tool.botcore]\n",
        encoding="utf-8",
    )
    _make_skill(tmp_path / ".claude" / "skills", body)
    with patch("botcore.commands.skill.lint.find_workspace", return_value=tmp_path):
        data = assert_success(await skill_lint(path="demo"))
    return [v["message"] for v in data["skills"][0]["violations"] if v["rule"] == "SK008"]


@pytest.mark.parametrize("body", _CLEAN_BODIES)
async def test_skill_lint_ignores_repo_paths(tmp_path: Path, body: str) -> None:
    assert await _sk008_messages(tmp_path, body) == []


@pytest.mark.parametrize(("body", "name"), _MISSING_BODIES)
async def test_skill_lint_reports_missing_reference_once(
    tmp_path: Path, body: str, name: str
) -> None:
    assert await _sk008_messages(tmp_path, body) == [f"Referenced file missing: references/{name}"]


@pytest.mark.parametrize("body", _CLEAN_BODIES)
def test_spec_lint_ignores_repo_paths(tmp_path: Path, body: str) -> None:
    assert _check_reference_links(_make_skill(tmp_path, body), body) == []


@pytest.mark.parametrize(("body", "name"), _MISSING_BODIES)
def test_spec_lint_reports_missing_reference_once(tmp_path: Path, body: str, name: str) -> None:
    issues = _check_reference_links(_make_skill(tmp_path, body), body)
    assert [i["message"] for i in issues] == [f"Referenced file missing: references/{name}"]
