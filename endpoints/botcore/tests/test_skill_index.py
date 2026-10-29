"""Tests for botcore.commands.skill.index — _index.md generation."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from afd.testing import assert_error, assert_success

from botcore.commands.skill.index import skill_index


def _make_skill(base: Path, name: str, version: str = "1.0.0", source: str | None = None) -> Path:
    """Create a minimal skill directory."""
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    source_line = f"\nsource: {source}" if source else ""
    content = (
        f"---\nname: {name}\ndescription: A {name} skill."
        f"{source_line}\nversion: '{version}'\n---\n\nBody.\n"
    )
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")
    return skill_dir


def _setup_workspace(tmp_path: Path) -> Path:
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'\n\n[tool.botcore]\n",
        encoding="utf-8",
    )
    return tmp_path


async def test_index_no_workspace() -> None:
    """Returns error when no workspace found."""
    with patch("botcore.commands.skill.index.find_workspace", return_value=None):
        result = await skill_index()

    assert_error(result, "NO_WORKSPACE")


async def test_index_generates_table(tmp_path: Path) -> None:
    """Generates markdown table for installed skills."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "security", "3.0.0", source="botcore")
    _make_skill(skills_dir, "testing", "2.0.0")

    with patch("botcore.commands.skill.index.find_workspace", return_value=ws):
        result = await skill_index(write=True)

    data = assert_success(result)
    assert data["written"] is True

    content = data["content"]
    assert "# Skill Index" in content
    assert "[security]" in content
    assert "[testing]" in content
    assert "**Total:** 2 skills" in content

    # File was written
    index_path = skills_dir / "_index.md"
    assert index_path.exists()


async def test_index_dry_run(tmp_path: Path) -> None:
    """Dry run returns content without writing."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "testing", "1.0.0")

    with patch("botcore.commands.skill.index.find_workspace", return_value=ws):
        result = await skill_index(write=False)

    data = assert_success(result)
    assert data["written"] is False
    assert "# Skill Index" in data["content"]

    # File was NOT written
    assert not (skills_dir / "_index.md").exists()


async def test_index_no_skills_dir(tmp_path: Path) -> None:
    """Returns error when skills directory doesn't exist."""
    ws = _setup_workspace(tmp_path)

    with patch("botcore.commands.skill.index.find_workspace", return_value=ws):
        result = await skill_index()

    assert_error(result, "NO_SKILLS_DIR")
