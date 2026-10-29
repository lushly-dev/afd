"""Skill lint — quality rules SK001-SK015."""

from __future__ import annotations

import re
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.skill._discovery import discover_local_skills
from botcore.commands.skill.frontmatter import SkillManifest, parse_frontmatter
from botcore.config import load_config
from botcore.utils.workspace import find_workspace

# Maximum body length (characters)
_MAX_BODY_LENGTH = 50_000
_MAX_DESCRIPTION_LENGTH = 1024
_KEBAB_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
_PLACEHOLDER_PATTERNS = [
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bFIXME\b", re.IGNORECASE),
    re.compile(r"\bXXX\b"),
    re.compile(r"\bLorem ipsum\b", re.IGNORECASE),
    re.compile(r"\bplaceholder\b", re.IGNORECASE),
]

# SK008: a skill-local references/ path. The lookbehind skips repo paths such as
# docs/references/x.md and ../references/x.md; the class stops at markdown delimiters,
# query strings and #anchors.
_REFERENCE_PATH_RE = re.compile(r"(?<![\w./-])(?:\./)?references/([^\s()\[\]{}<>`'\"*|?#]+)")


def _check_metadata(manifest: SkillManifest, strict: bool) -> list[dict]:
    """Check frontmatter metadata rules SK002-SK006, SK013."""
    violations: list[dict] = []

    if not manifest.name:
        violations.append(
            {"rule": "SK002", "severity": "error", "message": "Missing 'name' in frontmatter"}
        )

    if not manifest.description:
        violations.append(
            {
                "rule": "SK003",
                "severity": "error",
                "message": "Missing 'description' in frontmatter",
            }
        )

    if manifest.name and not _KEBAB_RE.match(manifest.name):
        violations.append(
            {
                "rule": "SK004",
                "severity": "error",
                "message": f"Name '{manifest.name}' is not kebab-case",
            }
        )

    desc_len = len(manifest.description) if manifest.description else 0
    if desc_len > _MAX_DESCRIPTION_LENGTH:
        violations.append(
            {
                "rule": "SK005",
                "severity": "warning",
                "message": f"Description is {desc_len} chars (max {_MAX_DESCRIPTION_LENGTH})",
            }
        )

    if not manifest.triggers:
        violations.append(
            {
                "rule": "SK006",
                "severity": "warning",
                "message": "No triggers defined — skill may not be auto-activated",
            }
        )

    if manifest.version == "0.0.0":
        violations.append(
            {
                "rule": "SK013",
                "severity": "warning" if not strict else "error",
                "message": "No version set (using default 0.0.0)",
            }
        )

    return violations


def _check_body_and_refs(
    skill_dir: Path,
    manifest: SkillManifest,
    body: str,
) -> list[dict]:
    """Check body/reference rules SK008-SK014."""
    violations: list[dict] = []
    refs_dir = skill_dir / "references"

    # SK008: Referenced files exist
    if refs_dir.is_dir():
        seen: set[str] = set()
        for match in _REFERENCE_PATH_RE.finditer(body):
            ref_name = match.group(1).rstrip(".,;:!")
            if ref_name in seen:
                continue
            seen.add(ref_name)
            if not (skill_dir / "references" / ref_name).exists():
                violations.append(
                    {
                        "rule": "SK008",
                        "severity": "error",
                        "message": f"Referenced file missing: references/{ref_name}",
                    }
                )

    # SK009: Body too long
    if len(body) > _MAX_BODY_LENGTH:
        violations.append(
            {
                "rule": "SK009",
                "severity": "warning",
                "message": f"Body is {len(body)} chars (max {_MAX_BODY_LENGTH})",
            }
        )

    # SK010: Placeholder text
    for pattern in _PLACEHOLDER_PATTERNS:
        m = pattern.search(body)
        if m:
            violations.append(
                {
                    "rule": "SK010",
                    "severity": "warning",
                    "message": f"Placeholder text found: '{m.group()}'",
                }
            )
            break

    # SK012: File naming (directory should match skill name)
    if manifest.name and skill_dir.name != manifest.name:
        violations.append(
            {
                "rule": "SK012",
                "severity": "warning",
                "message": f"Directory '{skill_dir.name}' doesn't match name '{manifest.name}'",
            }
        )

    # SK014: Orphan references
    if refs_dir.is_dir():
        for ref_file in refs_dir.iterdir():
            if ref_file.is_file() and ref_file.name not in body:
                violations.append(
                    {
                        "rule": "SK014",
                        "severity": "warning",
                        "message": f"Orphan reference: references/{ref_file.name}",
                    }
                )

    return violations


def _lint_skill(skill_dir: Path, strict: bool = False) -> list[dict]:
    """Run all lint rules against a single skill directory."""
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        skill_file = skill_dir / "skill.md"

    # SK001: Frontmatter required
    if not skill_file.exists():
        return [{"rule": "SK001", "severity": "error", "message": "Missing SKILL.md file"}]

    content = skill_file.read_text(encoding="utf-8")
    if not content.strip().startswith("---"):
        return [
            {"rule": "SK001", "severity": "error", "message": "SKILL.md has no YAML frontmatter"}
        ]

    manifest, body = parse_frontmatter(content)
    violations = _check_metadata(manifest, strict)
    violations.extend(_check_body_and_refs(skill_dir, manifest, body))
    return violations


async def skill_lint(
    path: str | None = None,
    strict: bool = False,
) -> CommandResult[dict]:
    """Lint skills for quality issues using SK001-SK015 rules.

    Args:
        path: Specific skill directory to lint, or None for all.
        strict: If True, warnings become errors for some rules.
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

    # Determine which skills to lint
    if path:
        target = Path(path) if Path(path).is_absolute() else skills_dir / path
        if not target.is_dir():
            return error(
                "SKILL_NOT_FOUND",
                f"Skill directory not found: {target}",
                suggestion=f"Pass a skill name under {skills_dir} or an absolute path",
            )
        skill_dirs = {target.name: target}
        linted_path = target
    else:
        linted_path = skills_dir
        local = discover_local_skills(skills_dir)
        skill_dirs = {name: p for name, (p, _) in local.items()}

    if not skill_dirs:
        return error("NO_SKILLS", "No skills found to lint")

    # SK015: Duplicate names check (across all skills)
    all_names: dict[str, list[str]] = {}
    results: list[dict] = []

    for dir_name, skill_dir in sorted(skill_dirs.items()):
        violations = _lint_skill(skill_dir, strict=strict)

        # Collect names for duplicate check
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.exists():
            skill_file = skill_dir / "skill.md"
        if skill_file.exists():
            content = skill_file.read_text(encoding="utf-8")
            manifest, _ = parse_frontmatter(content)
            if manifest.name:
                all_names.setdefault(manifest.name, []).append(dir_name)

        results.append({"skill": dir_name, "violations": violations})

    # SK015: Add duplicate name violations
    for name, dirs in all_names.items():
        if len(dirs) > 1:
            for r in results:
                if r["skill"] in dirs:
                    r["violations"].append(
                        {
                            "rule": "SK015",
                            "severity": "error",
                            "message": f"Duplicate name '{name}' in: {', '.join(dirs)}",
                        }
                    )

    total_errors = sum(
        len([v for v in r["violations"] if v["severity"] == "error"]) for r in results
    )
    total_warnings = sum(
        len([v for v in r["violations"] if v["severity"] == "warning"]) for r in results
    )
    passed = len([r for r in results if not any(v["severity"] == "error" for v in r["violations"])])

    return success(
        data={
            "path": str(linted_path),
            "total": len(results),
            "passed": passed,
            "errors": total_errors,
            "warnings": total_warnings,
            "skills": results,
            "success": total_errors == 0,
        }
    )
