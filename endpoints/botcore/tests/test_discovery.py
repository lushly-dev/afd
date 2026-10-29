"""Tests for botcore.commands.skill._discovery — skill discovery."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from botcore.commands.skill._discovery import (
    discover_available_skills,
    discover_local_skills,
    get_bundled_skills_dir,
)


def _make_skill(base: Path, name: str, version: str = "1.0.0", source: str | None = None) -> Path:
    """Helper: create a minimal skill directory."""
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    source_line = f"\nsource: {source}" if source else ""
    content = (
        f"---\nname: {name}\ndescription: A {name} skill."
        f"{source_line}\nversion: '{version}'\n---\n\nBody.\n"
    )
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")
    return skill_dir


# ── get_bundled_skills_dir ─────────────────────────────────────────────


def test_get_bundled_skills_dir() -> None:
    """Returns a path ending in 'skills'."""
    path = get_bundled_skills_dir()
    assert path.name == "skills"


# ── discover_available_skills ──────────────────────────────────────────


def test_discover_bundled_skills(tmp_path: Path) -> None:
    """Discovers skills from a bundled directory."""
    bundled = tmp_path / "bundled"
    bundled.mkdir()
    _make_skill(bundled, "security", "3.0.0")
    _make_skill(bundled, "testing", "2.0.0")

    with patch("botcore.commands.skill._discovery.get_bundled_skills_dir", return_value=bundled):
        skills = discover_available_skills()

    assert len(skills) == 2
    assert "security" in skills
    assert skills["security"].source == "botcore"
    assert skills["security"].manifest.version == "3.0.0"


def test_discover_plugin_skills_override(tmp_path: Path) -> None:
    """Plugin skills override bundled skills with the same name."""
    bundled = tmp_path / "bundled"
    bundled.mkdir()
    _make_skill(bundled, "security", "1.0.0")

    plugin = tmp_path / "myplugin" / "skills"
    plugin.mkdir(parents=True)
    _make_skill(plugin, "security", "5.0.0")

    with patch("botcore.commands.skill._discovery.get_bundled_skills_dir", return_value=bundled):
        skills = discover_available_skills(plugin_dirs=[plugin])

    assert skills["security"].manifest.version == "5.0.0"
    assert skills["security"].source == "myplugin"


def test_discover_empty_dir(tmp_path: Path) -> None:
    """Empty bundled dir returns no skills."""
    bundled = tmp_path / "empty"
    bundled.mkdir()

    with patch("botcore.commands.skill._discovery.get_bundled_skills_dir", return_value=bundled):
        skills = discover_available_skills()

    assert len(skills) == 0


def test_discover_skips_invalid_skills(tmp_path: Path) -> None:
    """Skills without valid SKILL.md are skipped."""
    bundled = tmp_path / "bundled"
    bundled.mkdir()
    _make_skill(bundled, "valid", "1.0.0")

    # Invalid: dir without SKILL.md
    invalid_dir = bundled / "invalid"
    invalid_dir.mkdir()
    (invalid_dir / "README.md").write_text("Not a skill")

    with patch("botcore.commands.skill._discovery.get_bundled_skills_dir", return_value=bundled):
        skills = discover_available_skills()

    assert len(skills) == 1
    assert "valid" in skills


def test_discover_combined_sources(tmp_path: Path) -> None:
    """Both bundled and plugin skills are discovered."""
    bundled = tmp_path / "bundled"
    bundled.mkdir()
    _make_skill(bundled, "security", "1.0.0")

    plugin = tmp_path / "myplugin" / "skills"
    plugin.mkdir(parents=True)
    _make_skill(plugin, "custom-lint", "1.0.0")

    with patch("botcore.commands.skill._discovery.get_bundled_skills_dir", return_value=bundled):
        skills = discover_available_skills(plugin_dirs=[plugin])

    assert "security" in skills
    assert "custom-lint" in skills
    assert skills["security"].source == "botcore"
    assert skills["custom-lint"].source == "myplugin"


# ── discover_local_skills ──────────────────────────────────────────────


def test_discover_local_skills(tmp_path: Path) -> None:
    """Discover skills in a project's skills directory."""
    skills_dir = tmp_path / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_skill(skills_dir, "my-skill", "1.0.0", source="botcore")

    local = discover_local_skills(skills_dir)

    assert "my-skill" in local
    path, manifest = local["my-skill"]
    assert manifest is not None
    assert manifest.source == "botcore"


def test_discover_local_empty(tmp_path: Path) -> None:
    """Empty skills dir returns no skills."""
    skills_dir = tmp_path / ".claude" / "skills"
    skills_dir.mkdir(parents=True)

    local = discover_local_skills(skills_dir)
    assert len(local) == 0


def test_discover_local_nonexistent(tmp_path: Path) -> None:
    """Non-existent dir returns empty dict."""
    local = discover_local_skills(tmp_path / "nope")
    assert len(local) == 0


def test_discover_local_skills_without_frontmatter(tmp_path: Path) -> None:
    """Skills without valid frontmatter return None manifest."""
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()

    skill_dir = skills_dir / "bad-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# Just markdown\n\nNo frontmatter.", encoding="utf-8")

    local = discover_local_skills(skills_dir)

    assert "bad-skill" in local
    _, manifest = local["bad-skill"]
    assert manifest is None
