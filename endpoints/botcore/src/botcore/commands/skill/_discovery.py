"""Skill discovery — find bundled, plugin, and local skills."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from botcore.commands.skill.frontmatter import SkillManifest, read_skill_manifest


@dataclass
class DiscoveredSkill:
    """A skill found in a source (bundled or plugin)."""

    name: str
    source: str  # "botcore" or plugin name
    source_path: Path  # directory containing the skill
    manifest: SkillManifest


def get_bundled_skills_dir() -> Path:
    """Return the path to skills shipped with the botcore package."""
    return Path(__file__).resolve().parent.parent.parent / "skills"


def discover_available_skills(
    plugin_dirs: list[Path] | None = None,
) -> dict[str, DiscoveredSkill]:
    """Discover all skills from botcore built-ins and plugin directories.

    Botcore built-in skills take lowest priority — plugin skills with the
    same name will override them.

    Returns:
        Dict mapping skill name to DiscoveredSkill.
    """
    skills: dict[str, DiscoveredSkill] = {}

    # 1. Botcore bundled skills
    bundled_dir = get_bundled_skills_dir()
    if bundled_dir.is_dir():
        for skill_dir in sorted(bundled_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            manifest = read_skill_manifest(skill_dir)
            if manifest is None:
                continue
            skills[manifest.name] = DiscoveredSkill(
                name=manifest.name,
                source="botcore",
                source_path=skill_dir,
                manifest=manifest,
            )

    # 2. Plugin skill directories (override botcore)
    for plugin_dir in plugin_dirs or []:
        if not plugin_dir.is_dir():
            continue
        # Infer source from parent directory name
        source = plugin_dir.parent.name if plugin_dir.parent != plugin_dir else plugin_dir.name
        for skill_dir in sorted(plugin_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            manifest = read_skill_manifest(skill_dir)
            if manifest is None:
                continue
            skills[manifest.name] = DiscoveredSkill(
                name=manifest.name,
                source=source,
                source_path=skill_dir,
                manifest=manifest,
            )

    return skills


def discover_local_skills(
    skills_dir: Path,
) -> dict[str, tuple[Path, SkillManifest | None]]:
    """Discover skills installed in a target project's skills directory.

    Returns:
        Dict mapping skill directory name to (path, manifest_or_None).
    """
    local: dict[str, tuple[Path, SkillManifest | None]] = {}

    if not skills_dir.is_dir():
        return local

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        # Must have SKILL.md or skill.md
        if not (skill_dir / "SKILL.md").exists() and not (skill_dir / "skill.md").exists():
            continue
        manifest = read_skill_manifest(skill_dir)
        local[skill_dir.name] = (skill_dir, manifest)

    return local


def filter_skills(
    available: dict,
    include: list[str] | None,
    skip: list[str],
) -> dict:
    """Filter skills by include/skip. Include takes priority."""
    if include is not None:
        return {k: v for k, v in available.items() if k in include}
    return {k: v for k, v in available.items() if k not in skip}
