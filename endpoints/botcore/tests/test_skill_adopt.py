"""Tests for botcore.commands.skill.adopt — claim unmanaged skills."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from afd.testing import assert_error, assert_success

from botcore.commands.skill.adopt import skill_adopt, skill_unadopt
from botcore.commands.skill.frontmatter import read_skill_manifest


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


def _make_metadata_skill(base: Path, name: str, source: str, version: str = "1.0.0") -> Path:
    """Create a skill whose ownership is under metadata:."""
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: A {name} skill.\n"
        f"metadata:\n  source: {source}\n  version: {version}\n---\n\nBody.\n",
        encoding="utf-8",
    )
    return skill_dir


def _setup_workspace(tmp_path: Path) -> Path:
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'\n\n[tool.botcore]\n",
        encoding="utf-8",
    )
    return tmp_path


async def test_adopt_no_workspace() -> None:
    """Returns error when no workspace found."""
    with patch("botcore.commands.skill.adopt.find_workspace", return_value=None):
        result = await skill_adopt("test-skill")

    assert_error(result, "NO_WORKSPACE")


async def test_adopt_skill_not_found(tmp_path: Path) -> None:
    """Returns error when skill directory doesn't exist."""
    ws = _setup_workspace(tmp_path)

    with patch("botcore.commands.skill.adopt.find_workspace", return_value=ws):
        result = await skill_adopt("nonexistent")

    assert_error(result, "SKILL_NOT_FOUND")


async def test_adopt_adds_source(tmp_path: Path) -> None:
    """Adopts an unmanaged skill by adding source: field."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "my-skill", "1.0.0")  # no source

    with patch("botcore.commands.skill.adopt.find_workspace", return_value=ws):
        result = await skill_adopt("my-skill", source="local")

    data = assert_success(result)
    assert data["changed"] is True
    assert data["source"] == "local"
    assert result.undo_command == "skill_unadopt"
    assert result.undo_args == {"name": "my-skill"}

    # Verify file was updated: ownership under metadata:, nothing at the top level
    content = (skills_dir / "my-skill" / "SKILL.md").read_text(encoding="utf-8")
    assert content == (
        "---\nname: my-skill\ndescription: A my-skill skill.\n"
        "metadata:\n  source: local\n  version: 1.0.0\n---\n\nBody.\n"
    )


async def test_adopt_already_adopted(tmp_path: Path) -> None:
    """Skill with the same metadata.source returns changed=False and is untouched."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    skill_dir = _make_metadata_skill(skills_dir, "my-skill", "local")
    before = (skill_dir / "SKILL.md").read_text(encoding="utf-8")

    with patch("botcore.commands.skill.adopt.find_workspace", return_value=ws):
        result = await skill_adopt("my-skill", source="local")

    data = assert_success(result)
    assert data["changed"] is False
    assert result.undo_command is None
    assert (skill_dir / "SKILL.md").read_text(encoding="utf-8") == before


async def test_adopt_moves_top_level_ownership_of_an_older_copy(tmp_path: Path) -> None:
    """Re-adopting an older copy with a top-level source moves it under metadata:."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "my-skill", "1.0.0", source="botcore")

    with patch("botcore.commands.skill.adopt.find_workspace", return_value=ws):
        result = await skill_adopt("my-skill", source="botcore")

    data = assert_success(result)
    assert data["changed"] is True
    assert result.undo_command is None
    content = (skills_dir / "my-skill" / "SKILL.md").read_text(encoding="utf-8")
    assert "metadata:\n  source: botcore\n  version: 1.0.0\n" in content
    assert "\nsource:" not in content
    assert "\nversion:" not in content


async def test_adopt_conflict(tmp_path: Path) -> None:
    """Fails when skill has a different source, at the top level or under metadata:."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "my-skill", "1.0.0", source="botcore")
    _make_metadata_skill(skills_dir, "other", "botcore")

    with patch("botcore.commands.skill.adopt.find_workspace", return_value=ws):
        for name in ("my-skill", "other"):
            result = await skill_adopt(name, source="custom")
            assert_error(result, "SOURCE_CONFLICT")
            assert "skill_unadopt" in result.error.suggestion


async def test_unadopt_removes_source(tmp_path: Path) -> None:
    """skill_unadopt removes source metadata and returns inverse undo."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "my-skill", "1.0.0", source="local")

    with patch("botcore.commands.skill.adopt.find_workspace", return_value=ws):
        result = await skill_unadopt("my-skill")

    data = assert_success(result)
    assert data["removed_source"] == "local"
    assert result.undo_command == "skill_adopt"
    assert result.undo_args == {"name": "my-skill", "source": "local"}

    content = (skills_dir / "my-skill" / "SKILL.md").read_text(encoding="utf-8")
    assert "source:" not in content
    # The version stays tracked, now under metadata:
    assert "metadata:\n  version: 1.0.0\n" in content


async def test_unadopt_removes_metadata_source(tmp_path: Path) -> None:
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    skill_dir = _make_metadata_skill(skills_dir, "my-skill", "local", "2.0.0")

    with patch("botcore.commands.skill.adopt.find_workspace", return_value=ws):
        result = await skill_unadopt("my-skill")

    assert assert_success(result)["removed_source"] == "local"
    manifest = read_skill_manifest(skill_dir)
    assert manifest is not None
    assert (manifest.source, manifest.version) == (None, "2.0.0")


async def test_unadopt_requires_existing_source(tmp_path: Path) -> None:
    """skill_unadopt errors when the skill has no source."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "my-skill", "1.0.0")

    with patch("botcore.commands.skill.adopt.find_workspace", return_value=ws):
        result = await skill_unadopt("my-skill")

    assert_error(result, "SOURCE_NOT_SET")
