"""Skill lint by path: the entry point behind ``botcore skill-lint [path]``.

It runs the same rules as ``skill_lint`` (``botcore.commands.skill.lint``, which lists
them) over any directory, rather than the workspace's configured skills directory. The
listing budget comes from the workspace containing the path, or the default outside one.
"""

from __future__ import annotations

from pathlib import Path

from afd import CommandResult, error, success
from afd.core.metadata import Warning as AfdWarning

from botcore.commands.skill.lint import find_skill_file, lint_skill_dirs, summarize
from botcore.config import SkillsConfig, load_config
from botcore.utils.workspace import find_workspace


def _discover_skill_dirs(root: Path) -> list[Path]:
    """Recursively find all directories containing a SKILL.md or skill.md."""
    skill_dirs: list[Path] = []
    if not root.is_dir():
        return skill_dirs

    for child in sorted(root.rglob("SKILL.md")):
        skill_dirs.append(child.parent)
    for child in sorted(root.rglob("skill.md")):
        if child.parent not in skill_dirs:
            skill_dirs.append(child.parent)

    return sorted(skill_dirs)


def _listing_budget(target: Path) -> int:
    """The [skills] listing_budget of the workspace containing target, else the default."""
    ws = find_workspace(target)
    skills = load_config(workspace=ws).skills if ws else SkillsConfig()
    return skills.listing_budget


async def skill_lint_spec(
    path: str | None = None,
) -> CommandResult[dict]:
    """Lint SKILL.md files under a path with the shared skill rules (SK001-SK019).

    Args:
        path: Directory containing skills (or a single skill directory).
              Defaults to current working directory.
    """
    target = Path.cwd() if path is None else Path(path).resolve()

    if not target.exists():
        return error(
            "PATH_NOT_FOUND",
            f"Path does not exist: {target}",
            suggestion="Provide a valid directory path containing skills",
        )

    if not target.is_dir():
        return error(
            "NOT_A_DIRECTORY",
            f"Path is not a directory: {target}",
            suggestion="Provide a directory path, not a file path",
        )

    # If the target itself contains a SKILL.md, lint just that one skill
    skill_dirs = [target] if find_skill_file(target) else _discover_skill_dirs(target)

    if not skill_dirs:
        return error(
            "NO_SKILLS_FOUND",
            f"No SKILL.md files found in: {target}",
            suggestion="Provide a directory containing skill subdirectories with SKILL.md files",
        )

    linted, listing = lint_skill_dirs(skill_dirs, _listing_budget(target))
    results = [
        {"skill": r["skill"], "path": str(skill_dir), "issues": r["violations"]}
        for r, skill_dir in zip(linted, skill_dirs, strict=True)
    ]
    totals = summarize(results, "issues")

    data = {
        "path": str(target),
        **totals,
        "skills": results,
        "listing": listing,
        "success": totals["errors"] == 0,
    }

    if totals["errors"] > 0:
        return success(
            data=data,
            warnings=[
                AfdWarning(
                    code="LINT_ERRORS",
                    message=f"{totals['errors']} error(s) found across {len(results)} skill(s)",
                )
            ],
            suggestions=["Fix all errors before deploying skills"],
        )

    return success(
        data=data,
        suggestions=["All skills pass the skill lint rules"],
    )
