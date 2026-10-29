"""Tests for botcore.commands.skill.status — version drift detection."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from afd.testing import assert_error, assert_success

from botcore.commands.skill.status import skill_status


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


async def test_status_no_workspace() -> None:
    """Returns error when no workspace found."""
    with patch("botcore.commands.skill.status.find_workspace", return_value=None):
        result = await skill_status()

    assert_error(result, "NO_WORKSPACE")


async def test_status_ok(tmp_path: Path) -> None:
    """Skill at same version and source shows 'ok'."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "security", "3.0.0", source="botcore")

    source = tmp_path / "source"
    source.mkdir()
    _make_skill(source, "security", "3.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    m = read_skill_manifest(source / "security")
    available = {
        "security": DiscoveredSkill(
            name="security", source="botcore", source_path=source / "security", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.status.find_workspace", return_value=ws),
        patch("botcore.commands.skill.status.discover_available_skills", return_value=available),
    ):
        result = await skill_status()

    data = assert_success(result)
    sec = next(s for s in data["skills"] if s["name"] == "security")
    assert sec["status"] == "ok"
    assert data["summary"]["ok"] == 1


async def test_status_stale(tmp_path: Path) -> None:
    """Skill with older local version shows 'stale'."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "security", "1.0.0", source="botcore")

    source = tmp_path / "source"
    source.mkdir()
    _make_skill(source, "security", "3.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    m = read_skill_manifest(source / "security")
    available = {
        "security": DiscoveredSkill(
            name="security", source="botcore", source_path=source / "security", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.status.find_workspace", return_value=ws),
        patch("botcore.commands.skill.status.discover_available_skills", return_value=available),
    ):
        result = await skill_status()

    data = assert_success(result)
    sec = next(s for s in data["skills"] if s["name"] == "security")
    assert sec["status"] == "stale"


async def test_status_missing(tmp_path: Path) -> None:
    """Available skill not installed locally shows 'missing'."""
    ws = _setup_workspace(tmp_path)

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import SkillManifest

    available = {
        "testing": DiscoveredSkill(
            name="testing",
            source="botcore",
            source_path=tmp_path / "src" / "testing",
            manifest=SkillManifest(name="testing", version="2.0.0"),
        )
    }

    with (
        patch("botcore.commands.skill.status.find_workspace", return_value=ws),
        patch("botcore.commands.skill.status.discover_available_skills", return_value=available),
    ):
        result = await skill_status()

    data = assert_success(result)
    test = next(s for s in data["skills"] if s["name"] == "testing")
    assert test["status"] == "missing"


async def test_status_unmanaged(tmp_path: Path) -> None:
    """Local skill without source: field shows 'unmanaged'."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "security", "1.0.0")  # no source

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    source = tmp_path / "source"
    source.mkdir()
    _make_skill(source, "security", "3.0.0")
    m = read_skill_manifest(source / "security")
    available = {
        "security": DiscoveredSkill(
            name="security", source="botcore", source_path=source / "security", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.status.find_workspace", return_value=ws),
        patch("botcore.commands.skill.status.discover_available_skills", return_value=available),
    ):
        result = await skill_status()

    data = assert_success(result)
    sec = next(s for s in data["skills"] if s["name"] == "security")
    assert sec["status"] == "unmanaged"


async def test_status_conflict(tmp_path: Path) -> None:
    """Local skill with different source shows 'conflict'."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "security", "1.0.0", source="other-plugin")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    source = tmp_path / "source"
    source.mkdir()
    _make_skill(source, "security", "3.0.0")
    m = read_skill_manifest(source / "security")
    available = {
        "security": DiscoveredSkill(
            name="security", source="botcore", source_path=source / "security", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.status.find_workspace", return_value=ws),
        patch("botcore.commands.skill.status.discover_available_skills", return_value=available),
    ):
        result = await skill_status()

    data = assert_success(result)
    sec = next(s for s in data["skills"] if s["name"] == "security")
    assert sec["status"] == "conflict"


async def test_status_renamed_botcore_owned(tmp_path: Path) -> None:
    """A botcore-owned skill under a retired name shows 'renamed' with a seed hint."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    _make_skill(skills_dir, "manage-documentation", "1.0.0", source="botcore")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    source = tmp_path / "source"
    _make_skill(source, "docs-manager", "2.0.0")
    m = read_skill_manifest(source / "docs-manager")
    available = {
        "docs-manager": DiscoveredSkill(
            name="docs-manager", source="botcore", source_path=source / "docs-manager", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.status.find_workspace", return_value=ws),
        patch("botcore.commands.skill.status.discover_available_skills", return_value=available),
    ):
        result = await skill_status()

    data = assert_success(result)
    old = next(s for s in data["skills"] if s["name"] == "manage-documentation")
    assert old["status"] == "renamed"
    assert old["renamed_to"] == "docs-manager"
    assert old["source"] == "botcore"
    assert "skill-seed" in old["suggestion"]
    new = next(s for s in data["skills"] if s["name"] == "docs-manager")
    assert new["status"] == "missing"
    assert data["summary"]["renamed"] == 1
    assert data["summary"]["unmanaged"] == 0


@pytest.mark.parametrize("owner", [None, "local", "custom-plugin"])
async def test_status_renamed_locally_owned(tmp_path: Path, owner: str | None) -> None:
    """A renamed skill botcore doesn't own shows 'renamed' with a delete/adopt hint."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    _make_skill(skills_dir, "do-review", "0.3.5", source=owner)

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    source = tmp_path / "source"
    _make_skill(source, "review", "2.0.0")
    m = read_skill_manifest(source / "review")
    available = {
        "review": DiscoveredSkill(
            name="review", source="botcore", source_path=source / "review", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.status.find_workspace", return_value=ws),
        patch("botcore.commands.skill.status.discover_available_skills", return_value=available),
    ):
        result = await skill_status()

    data = assert_success(result)
    old = next(s for s in data["skills"] if s["name"] == "do-review")
    assert old["status"] == "renamed"
    assert old["renamed_to"] == "review"
    assert old["source"] == owner
    assert ".claude/skills/do-review" in old["suggestion"]
    if owner is None:
        assert "skill_adopt('review')" in old["suggestion"]
    else:
        assert f"source: {owner}" in old["suggestion"]
    assert data["summary"]["renamed"] == 1


async def test_status_old_name_still_shipped_is_not_renamed(tmp_path: Path) -> None:
    """An old name that a source still ships is reported normally, not as renamed."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    _make_skill(skills_dir, "do-review", "1.0.0", source="my-plugin")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    source = tmp_path / "my-plugin"
    _make_skill(source, "do-review", "1.0.0")
    m = read_skill_manifest(source / "do-review")
    available = {
        "do-review": DiscoveredSkill(
            name="do-review", source="my-plugin", source_path=source / "do-review", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.status.find_workspace", return_value=ws),
        patch("botcore.commands.skill.status.discover_available_skills", return_value=available),
    ):
        result = await skill_status()

    data = assert_success(result)
    assert [s["status"] for s in data["skills"] if s["name"] == "do-review"] == ["ok"]
    assert data["summary"]["renamed"] == 0


async def test_status_renamed_when_new_name_excluded(tmp_path: Path) -> None:
    """If config excludes the new name, the suggestion doesn't promise a seed fix."""
    ws = _setup_workspace(tmp_path)
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'"
        "\n\n[tool.botcore.skills]\nskip = ['docs-manager']\n",
        encoding="utf-8",
    )
    skills_dir = ws / ".claude" / "skills"
    _make_skill(skills_dir, "manage-documentation", "1.0.0", source="botcore")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    source = tmp_path / "source"
    _make_skill(source, "docs-manager", "2.0.0")
    m = read_skill_manifest(source / "docs-manager")
    available = {
        "docs-manager": DiscoveredSkill(
            name="docs-manager", source="botcore", source_path=source / "docs-manager", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.status.find_workspace", return_value=ws),
        patch("botcore.commands.skill.status.discover_available_skills", return_value=available),
    ):
        result = await skill_status()

    data = assert_success(result)
    old = next(s for s in data["skills"] if s["name"] == "manage-documentation")
    assert old["status"] == "renamed"
    assert "excludes" in old["suggestion"]
    assert "Run skill-seed" not in old["suggestion"]
