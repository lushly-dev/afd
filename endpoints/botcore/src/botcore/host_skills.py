"""The skills a managed host serves over MCP's Skills extension.

The extension is ``io.modelcontextprotocol/skills``; ``create_host_mcp_server`` serves this catalog.
Skills are found and named with AFD's own reader (``afd.server.skills``), not ``skill seed``'s, so
a folder is served exactly as the extension reads it, or the server is refused naming the folder.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from botcore.commands.skill._discovery import (
    discover_local_skills,
    filter_skills,
    get_bundled_skills_dir,
)

if TYPE_CHECKING:
    from pathlib import Path

    from afd.server.skills import Skill, SkillCatalog

    from botcore.host import CommandHost

_REMEDY = "fix the folder, or pass skills=None to create_host_mcp_server to serve no skills"


def _refuse(folder: Path, problem: str) -> ValueError:
    return ValueError(f"Skill folder {folder}: {problem}; {_REMEDY}")


def _skill_name(folder: Path) -> str | None:
    """The frontmatter name of the skill in ``folder``, or ``None`` when it holds no skill."""
    from afd.server.frontmatter import FrontmatterError, parse_frontmatter

    entries = os.listdir(folder)
    if "SKILL.md" not in entries:
        if "skill.md" in entries:
            raise _refuse(folder, "the Skills extension reads SKILL.md, not skill.md")
        return None
    try:
        frontmatter = parse_frontmatter((folder / "SKILL.md").read_bytes().decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise _refuse(folder, "SKILL.md is not UTF-8 text") from exc
    except FrontmatterError as exc:
        raise _refuse(folder, str(exc)) from exc
    name = frontmatter.get("name")
    if not isinstance(name, str) or not name:
        raise _refuse(folder, "SKILL.md's frontmatter has no name")
    return name


def _available(sources: list[Path]) -> dict[str, Path]:
    """Every skill folder in ``sources`` by name; a later source replaces an earlier one."""
    found: dict[str, Path] = {}
    for source in sources:
        if not source.is_dir():
            continue
        for folder in sorted(source.iterdir()):
            name = _skill_name(folder) if folder.is_dir() else None
            if name is not None:
                found[name] = folder
    return found


def _read(name: str, folder: Path) -> Skill:
    from afd.server.skills import SkillCatalog, skill_from_directory

    try:
        skill = skill_from_directory(name, folder)
        SkillCatalog([skill])  # the extension's checks, so a failure names this folder
    except ValueError as exc:
        raise _refuse(folder, str(exc)) from exc
    return skill


def host_skill_catalog(host: CommandHost) -> SkillCatalog | None:
    """The skills a managed host's MCP server serves, from ``host.skills``.

    Botcore's bundled skills come first, then each folder the host's plugins register; a skill
    of the same frontmatter name replaces an earlier one, as in ``skill seed``. The workspace's
    ``[skills]`` ``include`` and ``skip`` filter the set the same way, and a skill already
    seeded as files (under ``[skills] source_dir``, by folder or frontmatter name) is left out,
    since a client that reads both would list it twice. Each skill is read from disk once, when
    the server is built. ``None`` when ``host.skills`` is ``None`` or nothing is left to serve.

    Raises:
        ValueError: Naming the folder, when a skill folder breaks the Skills extension's rules.
    """
    from afd.server.skills import SkillCatalog

    sources = host.skills
    if sources is None:
        return None
    bundled = [get_bundled_skills_dir()] if sources.bundled else []
    available = filter_skills(
        _available([*bundled, *sources.dirs]),
        None if sources.include is None else list(sources.include),
        list(sources.skip),
    )
    if sources.seeded_dir is not None:
        local = discover_local_skills(sources.seeded_dir)
        held = set(local) | {manifest.name for _, manifest in local.values() if manifest}
        available = {name: folder for name, folder in available.items() if name not in held}
    if not available:
        return None
    return SkillCatalog([_read(name, folder) for name, folder in available.items()])
