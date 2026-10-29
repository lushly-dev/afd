"""Seed skills into a project's .claude/skills/ directory."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.skill._discovery import (
    discover_available_skills,
    discover_local_skills,
    filter_skills,
)
from botcore.commands.skill.frontmatter import read_skill_manifest, set_frontmatter_source
from botcore.commands.skill.renames import locally_owned_rename_suggestion, resolve_rename
from botcore.config import load_config
from botcore.utils.workspace import find_workspace

logger = logging.getLogger(__name__)


async def skill_seed(
    update: bool = False,
    dry_run: bool = False,
    plugin_dirs: list[Path] | None = None,
) -> CommandResult[dict]:
    """Seed available skills into the project's skills directory.

    Algorithm:
    1. Load config → get SkillsConfig (include/skip/source_dir/agent_skills)
    2. discover_available_skills() → all candidates from botcore + plugins
    3. Filter by include/skip (include takes priority; if set, skip is ignored)
    4. For each local skill under a renamed name whose new name is a candidate:
       - source: botcore → remove it (migrated; the new name is seeded below)
       - no source: or different → leave it, report it, and don't seed the
         new name alongside it (that would duplicate the skill)
    5. For each skill:
       - Not present locally → copy tree, inject source: in frontmatter
       - Present, matching source: → overwrite if update=True, skip otherwise
       - Present, no source: or different → skip (log warning)
    6. If agent_skills=True, mirror to .agent/skills/
    7. Return summary
    """
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    config = load_config(workspace=ws)
    skills_config = config.skills
    skills_dir = ws / skills_config.source_dir
    available = discover_available_skills(plugin_dirs)

    if not available:
        return error("NO_SKILLS_AVAILABLE", "No skills found in any source")

    # Filter
    candidates = filter_skills(available, skills_config.include, skills_config.skip)
    local = discover_local_skills(skills_dir)

    seeded: list[str] = []
    updated: list[str] = []
    skipped: list[dict] = []

    migrated, renamed_locally_owned = _migrate_renamed_skills(
        local, candidates, available, skills_config.source_dir, dry_run
    )
    # new name -> locally owned old name still occupying it
    blocked_by_rename = {e["renamed_to"]: e["name"] for e in renamed_locally_owned}

    for name, skill in sorted(candidates.items()):
        if name in blocked_by_rename and name not in local:
            skipped.append(
                {
                    "name": name,
                    "reason": f"renamed from '{blocked_by_rename[name]}', which is locally owned",
                }
            )
            continue

        if name in local:
            local_path, local_manifest = local[name]
            local_source = local_manifest.source if local_manifest else None

            if local_source and local_source != skill.source:
                skipped.append({"name": name, "reason": f"owned by {local_source}"})
                continue

            if local_source == skill.source and update:
                if not dry_run:
                    _copy_skill(skill.source_path, local_path, skill.source)
                updated.append(name)
            else:
                reason = "already present" if not local_source else "up to date"
                if not local_source:
                    reason = "unmanaged (use skill_adopt first)"
                skipped.append({"name": name, "reason": reason})
        else:
            target = skills_dir / name
            if not dry_run:
                skills_dir.mkdir(parents=True, exist_ok=True)
                _copy_skill(skill.source_path, target, skill.source)
            seeded.append(name)

    # Mirror to .agent/skills/ if configured
    agent_mirrored = 0
    if skills_config.agent_skills and not dry_run:
        agent_dir = ws / ".agent" / "skills"
        agent_dir.mkdir(parents=True, exist_ok=True)
        _remove_botcore_owned(agent_dir, [m["from"] for m in migrated])
        for name in seeded + updated:
            src = skills_dir / name
            dst = agent_dir / name
            if src.is_dir():
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.copytree(src, dst)
                agent_mirrored += 1

    return success(
        data={
            "seeded": seeded,
            "updated": updated,
            "skipped": skipped,
            "migrated": migrated,
            "renamed_locally_owned": renamed_locally_owned,
            "agent_mirrored": agent_mirrored,
            "dry_run": dry_run,
        }
    )


def _migrate_renamed_skills(
    local: dict,
    candidates: dict,
    available: dict,
    source_dir: str,
    dry_run: bool,
) -> tuple[list[dict], list[dict]]:
    """Handle local skills installed under a retired name.

    Only renames whose new name is a seed candidate are considered, so an
    include/skip filter never leaves a project with neither name.
    - source: botcore → remove the old directory (migrated)
    - anything else → leave it in place and report it (renamed_locally_owned)

    Returns:
        (migrated, renamed_locally_owned)
    """
    migrated: list[dict] = []
    renamed_locally_owned: list[dict] = []

    for old_name, (old_path, old_manifest) in sorted(local.items()):
        new_name = resolve_rename(old_name)
        # A source that still ships the old name owns it; it isn't a rename
        if new_name is None or new_name not in candidates or old_name in available:
            continue

        owner = old_manifest.source if old_manifest else None
        if owner == "botcore":
            if not dry_run:
                _remove_skill_dir(old_path)
            migrated.append({"from": old_name, "to": new_name})
        else:
            renamed_locally_owned.append(
                {
                    "name": old_name,
                    "renamed_to": new_name,
                    "owner": owner,
                    "suggestion": locally_owned_rename_suggestion(
                        old_name, new_name, source_dir, owner
                    ),
                }
            )

    return migrated, renamed_locally_owned


def _remove_botcore_owned(skills_dir: Path, names: list[str]) -> None:
    """Remove the named skill directories that botcore owns; leave any others."""
    for name in names:
        path = skills_dir / name
        manifest = read_skill_manifest(path) if path.is_dir() else None
        if manifest and manifest.source == "botcore":
            _remove_skill_dir(path)


def _remove_skill_dir(path: Path) -> None:
    """Remove a skill directory; for a symlink, remove only the link."""
    if path.is_symlink():
        path.unlink()
    else:
        shutil.rmtree(path)


def _copy_skill(source_path: Path, target_path: Path, source_name: str) -> None:
    """Copy a skill directory and inject source: into frontmatter."""
    if target_path.exists():
        shutil.rmtree(target_path)
    shutil.copytree(source_path, target_path)

    # Inject source: into frontmatter
    skill_file = target_path / "SKILL.md"
    if not skill_file.exists():
        skill_file = target_path / "skill.md"
    if not skill_file.exists():
        return

    content = skill_file.read_text(encoding="utf-8")
    new_content = set_frontmatter_source(content, source_name)
    if new_content is not None and new_content != content:
        skill_file.write_text(new_content, encoding="utf-8")
