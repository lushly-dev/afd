"""Skill lint — validate SKILL.md files against the Claude Code runtime frontmatter spec.

This validates skills against the *official* supported frontmatter fields
that the Claude Code runtime actually processes, catching unsupported or
misconfigured fields before they cause silent runtime failures.

Rules:
  SK001  error    Frontmatter (YAML between --- markers) must exist
  SK002  error    `name` field required
  SK003  error    `description` field required
  SK004  warning  name must be lowercase-hyphenated and match parent directory
  SK005  warning  description must be < 1024 chars
  SK008  error    All markdown links to references/ must point to existing files
  SK010  error    No placeholder text (TODO, FIXME, TBD, lorem ipsum)
  SK012  warning  File must be named SKILL.md (uppercase)
  SK015  error    No duplicate names across all skills in directory
  SK018  warning  Unsupported frontmatter fields
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml
from afd import CommandResult, error, success
from afd.core.metadata import Warning as AfdWarning

# ── Constants ────────────────────────────────────────────────────────────────

# Official Claude Code runtime supported frontmatter fields
_SUPPORTED_FIELDS = frozenset({
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
    "argument-hint",
    "disable-model-invocation",
    "user-invocable",
})

_MAX_NAME_LENGTH = 64
_MAX_DESCRIPTION_LENGTH = 1024
_MAX_COMPATIBILITY_LENGTH = 500

# name: lowercase letters, digits, hyphens — must start with a letter
_KEBAB_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")

_PLACEHOLDER_PATTERNS = [
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bFIXME\b", re.IGNORECASE),
    re.compile(r"\bTBD\b"),
    re.compile(r"\bLorem ipsum\b", re.IGNORECASE),
]

# SK008: a skill-local references/ path. The lookbehind skips repo paths such as
# docs/references/x.md and ../references/x.md; the class stops at markdown delimiters,
# query strings and #anchors.
_REFERENCE_PATH_RE = re.compile(r"(?<![\w./-])(?:\./)?references/([^\s()\[\]{}<>`'\"*|?#]+)")

# ── Types ────────────────────────────────────────────────────────────────────

Issue = dict[str, str]


# ── Frontmatter parsing ─────────────────────────────────────────────────────


def _parse_frontmatter(content: str) -> tuple[dict | None, str]:
    """Extract YAML frontmatter dict and body from a SKILL.md file.

    Returns (None, content) if no valid frontmatter block is found.
    """
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)", content, re.DOTALL)
    if not match:
        return None, content

    yaml_str = match.group(1)
    body = match.group(2)

    try:
        data = yaml.safe_load(yaml_str)
    except yaml.YAMLError:
        return None, content

    if not isinstance(data, dict):
        return None, content

    return data, body


# ── Individual rule checks ───────────────────────────────────────────────────


def _check_frontmatter_exists(fm: dict | None) -> list[Issue]:
    """SK001: Frontmatter (YAML between --- markers) must exist."""
    if fm is None:
        return [{"rule": "SK001", "severity": "error",
                 "message": "Frontmatter (YAML between --- markers) must exist"}]
    return []


def _check_name_required(fm: dict) -> list[Issue]:
    """SK002: `name` field required."""
    if not fm.get("name"):
        return [{"rule": "SK002", "severity": "error",
                 "message": "'name' field is required in frontmatter"}]
    return []


def _check_description_required(fm: dict) -> list[Issue]:
    """SK003: `description` field required."""
    if not fm.get("description"):
        return [{"rule": "SK003", "severity": "error",
                 "message": "'description' field is required in frontmatter"}]
    return []


def _check_name_format(fm: dict, parent_dir_name: str) -> list[Issue]:
    """SK004: name must be lowercase-hyphenated and match parent directory name."""
    issues: list[Issue] = []
    name = fm.get("name", "")
    if not name:
        return []

    if not _KEBAB_RE.match(name):
        issues.append({
            "rule": "SK004", "severity": "warning",
            "message": f"Name '{name}' must be lowercase with hyphens only",
        })

    if len(name) > _MAX_NAME_LENGTH:
        issues.append({
            "rule": "SK004", "severity": "warning",
            "message": f"Name '{name}' exceeds {_MAX_NAME_LENGTH} char limit ({len(name)} chars)",
        })

    if name != parent_dir_name:
        issues.append({
            "rule": "SK004", "severity": "warning",
            "message": f"Name '{name}' does not match parent directory '{parent_dir_name}'",
        })

    return issues


def _check_description_length(fm: dict) -> list[Issue]:
    """SK005: description must be < 1024 chars."""
    desc = fm.get("description", "")
    if desc and len(str(desc)) > _MAX_DESCRIPTION_LENGTH:
        return [{
            "rule": "SK005", "severity": "warning",
            "message": f"Description is {len(str(desc))} chars (max {_MAX_DESCRIPTION_LENGTH})",
        }]
    return []


def _check_reference_links(skill_dir: Path, body: str) -> list[Issue]:
    """SK008: All markdown links to references/ must point to existing files."""
    issues: list[Issue] = []
    seen: set[str] = set()
    for match in _REFERENCE_PATH_RE.finditer(body):
        ref_name = match.group(1).rstrip(".,;:!")
        if ref_name in seen:
            continue
        seen.add(ref_name)
        ref_path = skill_dir / "references" / ref_name
        if not ref_path.exists():
            issues.append({
                "rule": "SK008", "severity": "error",
                "message": f"Referenced file missing: references/{ref_name}",
            })
    return issues


def _check_placeholder_text(body: str) -> list[Issue]:
    """SK010: No placeholder text (TODO, FIXME, TBD, lorem ipsum)."""
    for pattern in _PLACEHOLDER_PATTERNS:
        m = pattern.search(body)
        if m:
            return [{
                "rule": "SK010", "severity": "error",
                "message": f"Placeholder text found: '{m.group()}'",
            }]
    return []


def _check_filename(skill_dir: Path) -> list[Issue]:
    """SK012: File must be named SKILL.md (uppercase)."""
    if (skill_dir / "skill.md").exists() and not (skill_dir / "SKILL.md").exists():
        return [{
            "rule": "SK012", "severity": "warning",
            "message": "File should be named SKILL.md (uppercase), found skill.md",
        }]
    return []


def _check_unsupported_fields(fm: dict) -> list[Issue]:
    """SK018: Unsupported frontmatter fields."""
    issues: list[Issue] = []
    for key in fm:
        if key not in _SUPPORTED_FIELDS:
            issues.append({
                "rule": "SK018", "severity": "warning",
                "message": f"Unsupported frontmatter field '{key}' "
                           f"(not recognized by Claude Code runtime)",
            })
    return issues


# ── Single-skill linting ─────────────────────────────────────────────────────


def _find_skill_file(skill_dir: Path) -> Path | None:
    """Find SKILL.md or skill.md in a skill directory."""
    for name in ("SKILL.md", "skill.md"):
        candidate = skill_dir / name
        if candidate.exists():
            return candidate
    return None


def _lint_single_skill(skill_dir: Path) -> list[Issue]:
    """Run all lint rules against a single skill directory."""
    skill_file = _find_skill_file(skill_dir)

    if skill_file is None:
        return [{"rule": "SK001", "severity": "error",
                 "message": "No SKILL.md file found in directory"}]

    content = skill_file.read_text(encoding="utf-8")
    fm, body = _parse_frontmatter(content)

    issues: list[Issue] = []

    # SK001: Frontmatter must exist
    issues.extend(_check_frontmatter_exists(fm))
    if fm is None:
        return issues  # Can't check further rules without frontmatter

    # SK002: name required
    issues.extend(_check_name_required(fm))

    # SK003: description required
    issues.extend(_check_description_required(fm))

    # SK004: name format and directory match
    issues.extend(_check_name_format(fm, skill_dir.name))

    # SK005: description length
    issues.extend(_check_description_length(fm))

    # SK008: reference links resolve
    issues.extend(_check_reference_links(skill_dir, body))

    # SK010: no placeholder text
    issues.extend(_check_placeholder_text(body))

    # SK012: filename case
    issues.extend(_check_filename(skill_dir))

    # SK018: unsupported fields
    issues.extend(_check_unsupported_fields(fm))

    return issues


# ── Directory discovery ──────────────────────────────────────────────────────


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


# ── Cross-skill checks ──────────────────────────────────────────────────────


def _check_duplicate_names(
    results: list[dict],
    skill_dirs: list[Path],
) -> None:
    """SK015: No duplicate names across all skills in directory.

    Mutates results in-place, appending violations to affected skills.
    """
    # Build name -> list of dir names mapping
    name_to_dirs: dict[str, list[str]] = {}
    dir_name_lookup: dict[str, Path] = {}

    for skill_dir in skill_dirs:
        skill_file = _find_skill_file(skill_dir)
        if skill_file is None:
            continue
        content = skill_file.read_text(encoding="utf-8")
        fm, _ = _parse_frontmatter(content)
        if fm is None:
            continue
        name = fm.get("name", "")
        if name:
            name_to_dirs.setdefault(name, []).append(skill_dir.name)
            dir_name_lookup[skill_dir.name] = skill_dir

    for name, dirs in name_to_dirs.items():
        if len(dirs) <= 1:
            continue
        for result in results:
            if result["skill"] in dirs:
                result["issues"].append({
                    "rule": "SK015", "severity": "error",
                    "message": f"Duplicate name '{name}' found in: {', '.join(dirs)}",
                })


# ── Public command ───────────────────────────────────────────────────────────


async def skill_lint_spec(
    path: str | None = None,
) -> CommandResult[dict]:
    """Lint SKILL.md files against the official Claude Code runtime frontmatter spec.

    Validates that skill files only use supported frontmatter fields and
    conform to the Claude Code runtime requirements.

    Args:
        path: Directory containing skills (or a single skill directory).
              Defaults to current working directory.
    """
    if path is None:
        target = Path.cwd()
    else:
        target = Path(path).resolve()

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
    if _find_skill_file(target) is not None:
        skill_dirs = [target]
    else:
        skill_dirs = _discover_skill_dirs(target)

    if not skill_dirs:
        return error(
            "NO_SKILLS_FOUND",
            f"No SKILL.md files found in: {target}",
            suggestion="Provide a directory containing skill subdirectories with SKILL.md files",
        )

    # Lint each skill
    results: list[dict] = []
    for skill_dir in skill_dirs:
        issues = _lint_single_skill(skill_dir)
        results.append({
            "skill": skill_dir.name,
            "path": str(skill_dir),
            "issues": issues,
        })

    # SK015: cross-skill duplicate name check
    _check_duplicate_names(results, skill_dirs)

    # Summarize
    total_errors = sum(
        len([i for i in r["issues"] if i["severity"] == "error"])
        for r in results
    )
    total_warnings = sum(
        len([i for i in r["issues"] if i["severity"] == "warning"])
        for r in results
    )
    passed = len([
        r for r in results
        if not any(i["severity"] == "error" for i in r["issues"])
    ])

    data = {
        "path": str(target),
        "total": len(results),
        "passed": passed,
        "errors": total_errors,
        "warnings": total_warnings,
        "skills": results,
        "success": total_errors == 0,
    }

    if total_errors > 0:
        return success(
            data=data,
            warnings=[AfdWarning(
                code="LINT_ERRORS",
                message=f"{total_errors} error(s) found across {len(results)} skill(s)",
            )],
            suggestions=["Fix all errors before deploying skills"],
        )

    return success(
        data=data,
        suggestions=["All skills pass Claude Code runtime spec validation"],
    )
