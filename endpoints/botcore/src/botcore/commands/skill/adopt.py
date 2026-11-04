"""Adopt an unmanaged skill — set metadata.source in its frontmatter."""

from __future__ import annotations

from afd import CommandResult, error, success

from botcore.commands.skill.frontmatter import read_skill_manifest, update_skill_source
from botcore.config import load_config
from botcore.utils.workspace import find_workspace


async def skill_adopt(
    name: str,
    source: str = "local",
) -> CommandResult[dict]:
    """Claim an unmanaged skill by setting ``metadata.source`` in its frontmatter.

    A skill already owned by ``source`` whose ownership fields are still at the top
    level (an older copy) has them moved under ``metadata:``.

    Fails if:
    - Skill directory doesn't exist
    - Skill has no SKILL.md
    - Skill already has a different source
    """
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    config = load_config(workspace=ws)
    skills_dir = ws / config.skills.source_dir
    skill_dir = skills_dir / name

    if not skill_dir.is_dir():
        return error(
            "SKILL_NOT_FOUND",
            f"Skill directory not found: {name}",
            suggestion=f"Check that {skills_dir / name} exists",
        )

    manifest = read_skill_manifest(skill_dir)
    if manifest is None:
        return error(
            "NO_MANIFEST",
            f"No valid SKILL.md found in {name}",
            suggestion="Ensure the skill has a SKILL.md with YAML frontmatter",
        )

    if manifest.source is not None and manifest.source != source:
        return error(
            "SOURCE_CONFLICT",
            f"Skill '{name}' already owned by '{manifest.source}', cannot adopt as '{source}'",
            suggestion=(
                f"Run skill_unadopt('{name}') to remove metadata.source first, "
                f"or use source='{manifest.source}'"
            ),
        )

    if manifest.source == source:
        moved = update_skill_source(skill_dir, source)
        reasoning = f"Skill already has source: {source}"
        if moved:
            reasoning += "; moved its top-level ownership fields under metadata:"
        return success(
            data={"name": name, "source": source, "changed": moved},
            reasoning=reasoning,
        )

    updated = update_skill_source(skill_dir, source)
    return success(
        data={"name": name, "source": source, "changed": updated},
        undo_command="skill_unadopt",
        undo_args={"name": name},
    )


async def skill_unadopt(name: str) -> CommandResult[dict]:
    """Remove ``metadata.source`` (or an older top-level ``source:``) from a skill."""
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    config = load_config(workspace=ws)
    skills_dir = ws / config.skills.source_dir
    skill_dir = skills_dir / name

    if not skill_dir.is_dir():
        return error(
            "SKILL_NOT_FOUND",
            f"Skill directory not found: {name}",
            suggestion=f"Check that {skills_dir / name} exists",
        )

    manifest = read_skill_manifest(skill_dir)
    if manifest is None:
        return error(
            "NO_MANIFEST",
            f"No valid SKILL.md found in {name}",
            suggestion="Ensure the skill has a SKILL.md with YAML frontmatter",
        )

    if manifest.source is None:
        return error(
            "SOURCE_NOT_SET",
            f"Skill '{name}' does not have a source field",
            suggestion="Use skill_adopt first to set a source",
        )

    previous_source = manifest.source
    updated = update_skill_source(skill_dir, None)
    return success(
        data={"name": name, "changed": updated, "removed_source": previous_source},
        reasoning=f"Removed source ownership from skill: {name}",
        undo_command="skill_adopt",
        undo_args={"name": name, "source": previous_source},
    )
