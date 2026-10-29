"""Generate _index.md for a skills directory."""

from __future__ import annotations

from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.skill._discovery import discover_local_skills
from botcore.config import load_config
from botcore.utils.workspace import find_workspace


def _build_index(skills_dir: Path) -> str:
    """Build _index.md content from installed skills."""
    local = discover_local_skills(skills_dir)

    lines = [
        "# Skill Index",
        "",
        f"> Auto-generated from `{skills_dir.name}/`. Do not edit manually.",
        "",
        "| Skill | Version | Source | Description |",
        "|-------|---------|--------|-------------|",
    ]

    for dir_name, (_, manifest) in sorted(local.items()):
        name = manifest.name if manifest else dir_name
        version = manifest.version if manifest else "—"
        source = manifest.source or "—" if manifest else "—"
        desc = manifest.description[:80] if manifest and manifest.description else "—"
        if manifest and manifest.description and len(manifest.description) > 80:
            desc += "…"
        lines.append(f"| [{name}](./{dir_name}/SKILL.md) | {version} | {source} | {desc} |")

    lines.append("")
    lines.append(f"**Total:** {len(local)} skills")
    lines.append("")

    return "\n".join(lines)


async def skill_index(
    write: bool = True,
) -> CommandResult[dict]:
    """Generate a _index.md file listing all installed skills.

    Args:
        write: If True, write the file. If False, return content only (dry run).
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

    if not skills_dir.is_dir():
        return error(
            "NO_SKILLS_DIR",
            f"Skills directory not found: {skills_dir}",
            suggestion="Run skill_seed first or create .claude/skills/",
        )

    content = _build_index(skills_dir)

    if write:
        index_path = skills_dir / "_index.md"
        index_path.write_text(content, encoding="utf-8")
        return success(data={"path": str(index_path), "content": content, "written": True})

    return success(data={"content": content, "written": False})
