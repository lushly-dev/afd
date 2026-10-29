"""Tests for botcore.commands.skill.seed — skill seeding."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from afd.testing import assert_error, assert_success

from botcore.commands.skill._discovery import DiscoveredSkill, discover_available_skills
from botcore.commands.skill.frontmatter import read_skill_manifest
from botcore.commands.skill.renames import SKILL_RENAMES, resolve_rename
from botcore.commands.skill.seed import skill_seed


def _make_source_skill(
    base: Path, name: str, version: str = "1.0.0", source: str | None = None
) -> Path:
    """Create a source skill directory."""
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    source_line = f"\nsource: {source}" if source else ""
    content = (
        f"---\nname: {name}\ndescription: A {name} skill."
        f"{source_line}\nversion: '{version}'\n---\n\nBody.\n"
    )
    (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")
    return skill_dir


def _make_source_skill_with_refs(base: Path, name: str, version: str = "1.0.0") -> Path:
    """Create a source skill with references/ dir."""
    skill_dir = _make_source_skill(base, name, version)
    refs = skill_dir / "references"
    refs.mkdir()
    (refs / "guide.md").write_text("# Guide\n\nContent.", encoding="utf-8")
    return skill_dir


def _setup_workspace(tmp_path: Path) -> Path:
    """Create workspace with pyproject.toml."""
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'\n\n[tool.botcore]\n",
        encoding="utf-8",
    )
    return tmp_path


async def test_seed_no_workspace() -> None:
    """Returns error when no workspace found."""
    with patch("botcore.commands.skill.seed.find_workspace", return_value=None):
        result = await skill_seed()

    assert_error(result, "NO_WORKSPACE")


async def test_seed_no_available_skills(tmp_path: Path) -> None:
    """Returns error when no skills are available."""
    ws = _setup_workspace(tmp_path)
    bundled = tmp_path / "empty_bundled"
    bundled.mkdir()

    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch(
            "botcore.commands.skill.seed.discover_available_skills",
            return_value={},
        ),
    ):
        result = await skill_seed()

    assert_error(result, "NO_SKILLS_AVAILABLE")


async def test_seed_creates_new_skills(tmp_path: Path) -> None:
    """Seeds skills into empty project."""
    ws = _setup_workspace(tmp_path)
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    _make_source_skill(source_dir, "security", "3.0.0")
    _make_source_skill(source_dir, "testing", "2.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    available = {}
    for name in ["security", "testing"]:
        m = read_skill_manifest(source_dir / name)
        available[name] = DiscoveredSkill(
            name=name, source="botcore", source_path=source_dir / name, manifest=m
        )

    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch("botcore.commands.skill.seed.discover_available_skills", return_value=available),
    ):
        result = await skill_seed()

    data = assert_success(result)
    assert sorted(data["seeded"]) == ["security", "testing"]
    assert len(data["skipped"]) == 0

    # Verify files were copied and source: injected
    security_skill = ws / ".claude" / "skills" / "security" / "SKILL.md"
    assert security_skill.exists()
    content = security_skill.read_text(encoding="utf-8")
    assert "source: botcore" in content


async def test_seed_skips_different_source(tmp_path: Path) -> None:
    """Does not overwrite skills owned by a different source."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    # Local skill owned by "custom-plugin"
    _make_source_skill(skills_dir, "security", "1.0.0", source="custom-plugin")

    source_dir = tmp_path / "source"
    source_dir.mkdir()
    _make_source_skill(source_dir, "security", "5.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    m = read_skill_manifest(source_dir / "security")
    available = {
        "security": DiscoveredSkill(
            name="security", source="botcore", source_path=source_dir / "security", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch("botcore.commands.skill.seed.discover_available_skills", return_value=available),
    ):
        result = await skill_seed()

    data = assert_success(result)
    assert data["seeded"] == []
    assert len(data["skipped"]) == 1
    assert data["skipped"][0]["reason"] == "owned by custom-plugin"


async def test_seed_updates_matching_source(tmp_path: Path) -> None:
    """Updates skills with matching source when update=True."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    _make_source_skill(skills_dir, "security", "1.0.0", source="botcore")

    source_dir = tmp_path / "source"
    source_dir.mkdir()
    _make_source_skill(source_dir, "security", "5.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    m = read_skill_manifest(source_dir / "security")
    available = {
        "security": DiscoveredSkill(
            name="security", source="botcore", source_path=source_dir / "security", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch("botcore.commands.skill.seed.discover_available_skills", return_value=available),
    ):
        result = await skill_seed(update=True)

    data = assert_success(result)
    assert data["updated"] == ["security"]


async def test_seed_skips_unmanaged(tmp_path: Path) -> None:
    """Does not overwrite unmanaged skills (no source:)."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    # Local skill without source:
    _make_source_skill(skills_dir, "security", "1.0.0")

    source_dir = tmp_path / "source"
    source_dir.mkdir()
    _make_source_skill(source_dir, "security", "5.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    m = read_skill_manifest(source_dir / "security")
    available = {
        "security": DiscoveredSkill(
            name="security", source="botcore", source_path=source_dir / "security", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch("botcore.commands.skill.seed.discover_available_skills", return_value=available),
    ):
        result = await skill_seed()

    data = assert_success(result)
    assert data["seeded"] == []
    assert any("unmanaged" in s["reason"] for s in data["skipped"])


async def test_seed_dry_run(tmp_path: Path) -> None:
    """Dry run reports what would be seeded without writing."""
    ws = _setup_workspace(tmp_path)
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    _make_source_skill(source_dir, "testing", "1.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    m = read_skill_manifest(source_dir / "testing")
    available = {
        "testing": DiscoveredSkill(
            name="testing", source="botcore", source_path=source_dir / "testing", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch("botcore.commands.skill.seed.discover_available_skills", return_value=available),
    ):
        result = await skill_seed(dry_run=True)

    data = assert_success(result)
    assert data["dry_run"] is True
    assert data["seeded"] == ["testing"]
    # File should NOT exist
    assert not (ws / ".claude" / "skills" / "testing").exists()


async def test_seed_include_filter(tmp_path: Path) -> None:
    """include: config filters to only listed skills."""
    ws = _setup_workspace(tmp_path)
    # Override config with include
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'"
        "\n\n[tool.botcore.skills]\ninclude = ['testing']\n",
        encoding="utf-8",
    )

    source_dir = tmp_path / "source"
    source_dir.mkdir()
    _make_source_skill(source_dir, "security", "1.0.0")
    _make_source_skill(source_dir, "testing", "1.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    available = {}
    for name in ["security", "testing"]:
        m = read_skill_manifest(source_dir / name)
        available[name] = DiscoveredSkill(
            name=name, source="botcore", source_path=source_dir / name, manifest=m
        )

    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch("botcore.commands.skill.seed.discover_available_skills", return_value=available),
    ):
        result = await skill_seed()

    data = assert_success(result)
    assert data["seeded"] == ["testing"]


async def test_seed_skip_filter(tmp_path: Path) -> None:
    """skip: config excludes listed skills."""
    ws = _setup_workspace(tmp_path)
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'"
        "\n\n[tool.botcore.skills]\nskip = ['security']\n",
        encoding="utf-8",
    )

    source_dir = tmp_path / "source"
    source_dir.mkdir()
    _make_source_skill(source_dir, "security", "1.0.0")
    _make_source_skill(source_dir, "testing", "1.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    available = {}
    for name in ["security", "testing"]:
        m = read_skill_manifest(source_dir / name)
        available[name] = DiscoveredSkill(
            name=name, source="botcore", source_path=source_dir / name, manifest=m
        )

    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch("botcore.commands.skill.seed.discover_available_skills", return_value=available),
    ):
        result = await skill_seed()

    data = assert_success(result)
    assert data["seeded"] == ["testing"]


async def test_seed_copies_references(tmp_path: Path) -> None:
    """Seed copies the references/ directory along with SKILL.md."""
    ws = _setup_workspace(tmp_path)
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    _make_source_skill_with_refs(source_dir, "testing", "1.0.0")

    from botcore.commands.skill._discovery import DiscoveredSkill
    from botcore.commands.skill.frontmatter import read_skill_manifest

    m = read_skill_manifest(source_dir / "testing")
    available = {
        "testing": DiscoveredSkill(
            name="testing", source="botcore", source_path=source_dir / "testing", manifest=m
        )
    }

    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch("botcore.commands.skill.seed.discover_available_skills", return_value=available),
    ):
        result = await skill_seed()

    assert_success(result)
    refs = ws / ".claude" / "skills" / "testing" / "references" / "guide.md"
    assert refs.exists()


# ── Renamed skills (v0.4.0 verb-noun → noun-first) ──────────────────────────


def _discovered(source_dir: Path, *names: str, source: str = "botcore") -> dict:
    """Build a discover_available_skills() result from skills in source_dir."""
    return {
        name: DiscoveredSkill(
            name=name,
            source=source,
            source_path=source_dir / name,
            manifest=read_skill_manifest(source_dir / name),
        )
        for name in names
    }


async def _seed(ws: Path, available: dict, **kwargs):
    with (
        patch("botcore.commands.skill.seed.find_workspace", return_value=ws),
        patch("botcore.commands.skill.seed.discover_available_skills", return_value=available),
    ):
        return await skill_seed(**kwargs)


def test_rename_targets_are_current_bundled_skills() -> None:
    """Every retired name resolves to a bundled skill and none is still bundled."""
    bundled = discover_available_skills()

    assert not set(SKILL_RENAMES) & set(bundled)
    assert {resolve_rename(old) for old in SKILL_RENAMES} <= set(bundled)
    assert resolve_rename("manage-documentation") == "docs-manager"
    assert resolve_rename("docs-manager") is None


async def test_seed_migrates_botcore_owned_renamed_skill(tmp_path: Path) -> None:
    """A botcore-owned skill under its old name is replaced by the new name."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    _make_source_skill(skills_dir, "manage-documentation", "1.0.0", source="botcore")

    source_dir = tmp_path / "source"
    _make_source_skill(source_dir, "docs-manager", "2.0.0")

    result = await _seed(ws, _discovered(source_dir, "docs-manager"))

    data = assert_success(result)
    assert data["migrated"] == [{"from": "manage-documentation", "to": "docs-manager"}]
    assert data["seeded"] == ["docs-manager"]
    assert data["renamed_locally_owned"] == []
    assert not (skills_dir / "manage-documentation").exists()
    new_skill = read_skill_manifest(skills_dir / "docs-manager")
    assert new_skill.source == "botcore"
    assert new_skill.version == "2.0.0"


async def test_seed_migration_dry_run_writes_nothing(tmp_path: Path) -> None:
    """Dry run reports the migration but leaves the old skill in place."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    _make_source_skill(skills_dir, "manage-documentation", "1.0.0", source="botcore")

    source_dir = tmp_path / "source"
    _make_source_skill(source_dir, "docs-manager", "2.0.0")

    result = await _seed(ws, _discovered(source_dir, "docs-manager"), dry_run=True)

    data = assert_success(result)
    assert data["migrated"] == [{"from": "manage-documentation", "to": "docs-manager"}]
    assert data["seeded"] == ["docs-manager"]
    assert (skills_dir / "manage-documentation").exists()
    assert not (skills_dir / "docs-manager").exists()


async def test_seed_migration_removes_existing_duplicate(tmp_path: Path) -> None:
    """A project already seeded with both names loses the old botcore-owned copy."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    _make_source_skill(skills_dir, "manage-documentation", "1.0.0", source="botcore")
    _make_source_skill(skills_dir, "docs-manager", "2.0.0", source="botcore")

    source_dir = tmp_path / "source"
    _make_source_skill(source_dir, "docs-manager", "2.0.0")

    result = await _seed(ws, _discovered(source_dir, "docs-manager"))

    data = assert_success(result)
    assert data["migrated"] == [{"from": "manage-documentation", "to": "docs-manager"}]
    assert data["seeded"] == []
    assert not (skills_dir / "manage-documentation").exists()
    assert (skills_dir / "docs-manager").exists()


@pytest.mark.parametrize("owner", [None, "local", "custom-plugin"])
async def test_seed_keeps_locally_owned_renamed_skill(tmp_path: Path, owner: str | None) -> None:
    """A renamed skill botcore doesn't own is left alone and reported, not duplicated."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    old_skill = _make_source_skill(skills_dir, "do-review", "0.3.5", source=owner)
    original = (old_skill / "SKILL.md").read_text(encoding="utf-8")

    source_dir = tmp_path / "source"
    _make_source_skill(source_dir, "review", "2.0.0")

    result = await _seed(ws, _discovered(source_dir, "review"), update=True)

    data = assert_success(result)
    assert data["migrated"] == []
    assert data["seeded"] == []
    assert (old_skill / "SKILL.md").read_text(encoding="utf-8") == original
    assert not (skills_dir / "review").exists()

    [entry] = data["renamed_locally_owned"]
    assert entry["name"] == "do-review"
    assert entry["renamed_to"] == "review"
    assert entry["owner"] == owner
    assert ".claude/skills/do-review" in entry["suggestion"]
    if owner is None:
        assert "skill_adopt('review')" in entry["suggestion"]
    else:
        assert "skill_adopt" not in entry["suggestion"]
        assert f"source: {owner}" in entry["suggestion"]
    assert {"name": "review", "reason": "renamed from 'do-review', which is locally owned"} in (
        data["skipped"]
    )


async def test_seed_leaves_renamed_skill_when_new_name_filtered(tmp_path: Path) -> None:
    """If config skips the new name, the old botcore-owned skill is not removed."""
    ws = _setup_workspace(tmp_path)
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'"
        "\n\n[tool.botcore.skills]\nskip = ['docs-manager']\n",
        encoding="utf-8",
    )
    skills_dir = ws / ".claude" / "skills"
    _make_source_skill(skills_dir, "manage-documentation", "1.0.0", source="botcore")

    source_dir = tmp_path / "source"
    _make_source_skill(source_dir, "docs-manager", "2.0.0")

    result = await _seed(ws, _discovered(source_dir, "docs-manager"))

    data = assert_success(result)
    assert data["migrated"] == []
    assert (skills_dir / "manage-documentation").exists()
    assert not (skills_dir / "docs-manager").exists()


async def test_seed_ignores_old_name_still_shipped_by_a_source(tmp_path: Path) -> None:
    """An old name that a plugin still ships is a live skill, not a rename."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    _make_source_skill(skills_dir, "do-review", "1.0.0", source="my-plugin")

    botcore_dir = tmp_path / "botcore"
    _make_source_skill(botcore_dir, "review", "2.0.0")
    plugin_dir = tmp_path / "my-plugin"
    _make_source_skill(plugin_dir, "do-review", "1.0.0")
    available = {
        **_discovered(botcore_dir, "review"),
        **_discovered(plugin_dir, "do-review", source="my-plugin"),
    }

    result = await _seed(ws, available)

    data = assert_success(result)
    assert data["renamed_locally_owned"] == []
    assert data["migrated"] == []
    assert data["seeded"] == ["review"]
    assert (skills_dir / "do-review").exists()


async def test_seed_migration_removes_agent_mirror(tmp_path: Path) -> None:
    """With agent_skills on, the old name's botcore-owned mirror is removed too."""
    ws = _setup_workspace(tmp_path)
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'"
        "\n\n[tool.botcore.skills]\nagent_skills = true\n",
        encoding="utf-8",
    )
    _make_source_skill(ws / ".claude" / "skills", "manage-documentation", "1.0.0", source="botcore")
    agent_dir = ws / ".agent" / "skills"
    _make_source_skill(agent_dir, "manage-documentation", "1.0.0", source="botcore")
    _make_source_skill(agent_dir, "manage-git", "1.0.0")  # unowned mirror: left alone

    source_dir = tmp_path / "source"
    _make_source_skill(source_dir, "docs-manager", "2.0.0")

    result = await _seed(ws, _discovered(source_dir, "docs-manager"))

    data = assert_success(result)
    assert data["agent_mirrored"] == 1
    assert not (agent_dir / "manage-documentation").exists()
    assert (agent_dir / "docs-manager").exists()
    assert (agent_dir / "manage-git").exists()


async def test_seed_keeps_locally_owned_old_name_when_new_name_present(tmp_path: Path) -> None:
    """With both names installed, a locally owned old name is reported and left alone."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    _make_source_skill(skills_dir, "do-review", "0.3.5")
    _make_source_skill(skills_dir, "review", "1.0.0", source="botcore")

    source_dir = tmp_path / "source"
    _make_source_skill(source_dir, "review", "2.0.0")

    result = await _seed(ws, _discovered(source_dir, "review"), update=True)

    data = assert_success(result)
    assert [e["name"] for e in data["renamed_locally_owned"]] == ["do-review"]
    assert data["updated"] == ["review"]
    assert (skills_dir / "do-review").exists()


async def test_seed_migrates_include_filtered_new_name(tmp_path: Path) -> None:
    """An include list naming the new skill still migrates the old botcore-owned one."""
    ws = _setup_workspace(tmp_path)
    (tmp_path / "pyproject.toml").write_text(
        "[project]\nname = 'test'\nversion = '0.1.0'"
        "\n\n[tool.botcore.skills]\ninclude = ['docs-manager']\n",
        encoding="utf-8",
    )
    skills_dir = ws / ".claude" / "skills"
    _make_source_skill(skills_dir, "manage-documentation", "1.0.0", source="botcore")
    _make_source_skill(skills_dir, "manage-git", "1.0.0", source="botcore")

    source_dir = tmp_path / "source"
    _make_source_skill(source_dir, "docs-manager", "2.0.0")
    _make_source_skill(source_dir, "git-manager", "2.0.0")

    result = await _seed(ws, _discovered(source_dir, "docs-manager", "git-manager"))

    data = assert_success(result)
    assert data["migrated"] == [{"from": "manage-documentation", "to": "docs-manager"}]
    assert (skills_dir / "manage-git").exists()


async def test_seed_migration_unlinks_symlinked_old_skill(tmp_path: Path) -> None:
    """A symlinked old-name skill loses only the link; the link target is untouched."""
    ws = _setup_workspace(tmp_path)
    skills_dir = ws / ".claude" / "skills"
    skills_dir.mkdir(parents=True)
    shared = _make_source_skill(tmp_path / "shared", "manage-documentation", source="botcore")
    (skills_dir / "manage-documentation").symlink_to(shared, target_is_directory=True)

    source_dir = tmp_path / "source"
    _make_source_skill(source_dir, "docs-manager", "2.0.0")

    result = await _seed(ws, _discovered(source_dir, "docs-manager"))

    data = assert_success(result)
    assert data["migrated"] == [{"from": "manage-documentation", "to": "docs-manager"}]
    assert not (skills_dir / "manage-documentation").exists()
    assert (shared / "SKILL.md").exists()
    assert (skills_dir / "docs-manager").exists()
