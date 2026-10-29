"""Tests for botcore.commands.skill.list — list skills."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from afd.testing import assert_error, assert_success

from botcore.commands.skill.list import skill_list


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


async def test_list_no_workspace() -> None:
    """Returns error when no workspace found."""
    with patch("botcore.commands.skill.list.find_workspace", return_value=None):
        result = await skill_list()

    assert_error(result, "NO_WORKSPACE")


async def test_list_empty(tmp_path: Path) -> None:
    """Empty project shows no installed skills."""
    ws = _setup_workspace(tmp_path)

    with (
        patch("botcore.commands.skill.list.find_workspace", return_value=ws),
        patch("botcore.commands.skill.list.discover_available_skills", return_value={}),
    ):
        result = await skill_list()

    data = assert_success(result)
    assert data["installed_count"] == 0
    assert data["available_count"] == 0


async def test_list_shows_installed_and_available(tmp_path: Path) -> None:
    """Lists both installed and available skills."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "security", "3.0.0", source="botcore")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import SkillManifest

    available = {
        "security": DiscoveredSkill(
            name="security",
            source="botcore",
            source_path=tmp_path / "src" / "security",
            manifest=SkillManifest(name="security", version="3.0.0"),
        ),
        "testing": DiscoveredSkill(
            name="testing",
            source="botcore",
            source_path=tmp_path / "src" / "testing",
            manifest=SkillManifest(name="testing", version="2.0.0"),
        ),
    }

    with (
        patch("botcore.commands.skill.list.find_workspace", return_value=ws),
        patch("botcore.commands.skill.list.discover_available_skills", return_value=available),
    ):
        result = await skill_list(show_source=True)

    data = assert_success(result)
    assert data["installed_count"] == 1
    assert data["available_count"] == 2

    # Installed skill includes source
    installed = data["installed"]
    assert any(s["name"] == "security" and s.get("source") == "botcore" for s in installed)

    # Available includes installed flag
    avail = data["available"]
    sec = next(s for s in avail if s["name"] == "security")
    assert sec["installed"] is True
    test = next(s for s in avail if s["name"] == "testing")
    assert test["installed"] is False


async def test_list_without_source(tmp_path: Path) -> None:
    """Without show_source, source field is not included in installed."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "security", "1.0.0", source="botcore")

    with (
        patch("botcore.commands.skill.list.find_workspace", return_value=ws),
        patch("botcore.commands.skill.list.discover_available_skills", return_value={}),
    ):
        result = await skill_list(show_source=False)

    data = assert_success(result)
    installed = data["installed"]
    assert len(installed) == 1
    assert "source" not in installed[0]
