"""List skills — available sources and locally installed."""

from __future__ import annotations

from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.skill._discovery import discover_available_skills, discover_local_skills
from botcore.config import load_config
from botcore.utils.workspace import find_workspace


async def skill_list(
    show_source: bool = False,
    plugin_dirs: list[Path] | None = None,
) -> CommandResult[dict]:
    """List all skills — both available sources and locally installed.

    Returns:
        CommandResult with data containing available, installed, and summary.
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

    available = discover_available_skills(plugin_dirs)
    local = discover_local_skills(skills_dir)

    installed = []
    for dir_name, (path, manifest) in sorted(local.items()):
        entry: dict = {"name": dir_name, "path": str(path)}
        if manifest:
            entry["version"] = manifest.version
            if show_source:
                entry["source"] = manifest.source
        installed.append(entry)

    sources = []
    for name, skill in sorted(available.items()):
        entry = {
            "name": name,
            "source": skill.source,
            "version": skill.manifest.version,
            "installed": name in local,
        }
        sources.append(entry)

    return success(
        data={
            "installed": installed,
            "available": sources,
            "installed_count": len(installed),
            "available_count": len(available),
        }
    )
