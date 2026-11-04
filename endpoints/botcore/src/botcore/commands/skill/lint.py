"""Skill lint: one rule set behind two entry points.

``skill_lint`` (here) lints the workspace's configured skills directory; MCP, Alfred and
``dev_skill_lint`` use it. ``skill_lint_spec`` (``botcore.commands.skill_lint``) lints any
path; ``botcore skill-lint`` runs it. Both call ``lint_skill_dirs``.

Rules:
  SK001  error    SKILL.md exists and has YAML frontmatter (a mapping between --- markers)
  SK002  error    `name` present
  SK003  error    `description` present
  SK004  error    name is kebab-case, at most 64 characters, and matches its directory
  SK005  error    description over 1,024 characters
  SK008  error    linked references/ files exist
  SK009  warning  body over 500 lines
  SK010  warning  placeholder text (TODO, FIXME, TBD, Lorem ipsum)
  SK012  warning  file named skill.md instead of SKILL.md
  SK014  warning  orphan reference files
  SK015  error    duplicate names (across the linted skills)
  SK016  warning  description over 300 characters
  SK017  warning  `triggers` field, or a "Triggers:" list in the listed text
  SK018  warning  unsupported frontmatter fields
  SK019  warning  listing over the [skills] listing_budget (across the linted skills)
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from afd import CommandResult, error, success

from botcore.commands.skill._discovery import discover_local_skills
from botcore.commands.skill.frontmatter import OWNERSHIP_FIELDS, split_frontmatter
from botcore.config import load_config
from botcore.utils.workspace import find_workspace

Issue = dict[str, str]

_MAX_NAME_LENGTH = 64
_MAX_DESCRIPTION_LENGTH = 1024
_TARGET_DESCRIPTION_LENGTH = 300
_MAX_BODY_LINES = 500
_KEBAB_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")

# Upper-case markers only: lower-case "todo" is a common identifier (todo-create).
_PLACEHOLDER_PATTERNS = [
    re.compile(r"\bTODO\b"),
    re.compile(r"\bFIXME\b"),
    re.compile(r"\bTBD\b"),
    re.compile(r"\bLorem ipsum\b", re.IGNORECASE),
]

_TRIGGERS_LIST_RE = re.compile(r"\btriggers?:", re.IGNORECASE)

# SK008: a skill-local references/ path. The lookbehind skips repo paths such as
# docs/references/x.md and ../references/x.md; the class stops at markdown delimiters,
# query strings and #anchors.
_REFERENCE_PATH_RE = re.compile(r"(?<![\w./-])(?:\./)?references/([^\s()\[\]{}<>`'\"*|?#]+)")

# Open standard fields, then Claude Code's additions.
SUPPORTED_FIELDS = frozenset(
    {
        "name",
        "description",
        "license",
        "compatibility",
        "metadata",
        "allowed-tools",
        "when_to_use",
        "argument-hint",
        "disable-model-invocation",
        "user-invocable",
        "model",
        "context",
        "agent",
        "hooks",
        "paths",
    }
)

# SK019 mirrors listingCharacters in AFD's scripts/skill-profiles.mjs. Only an unquoted
# YAML 1.2 boolean disables listing; PyYAML would also read yes/on as true.
_LISTING_DISABLED_RE = re.compile(
    r"^disable-model-invocation:[ \t]+(?:true|True|TRUE)(?:[ \t]+#.*)?[ \t]*$", re.MULTILINE
)
_LISTING_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---(?:\n|$)", re.DOTALL)
_HTML_COMMENT_RE = re.compile(r"^<!--.*-->$")


def _issue(rule: str, severity: str, message: str) -> Issue:
    return {"rule": rule, "severity": severity, "message": message}


# ── Rules over frontmatter ───────────────────────────────────────────────────


def _check_name(fm: dict, dir_name: str) -> list[Issue]:
    """SK002 and SK004."""
    name = fm.get("name")
    if not name:
        return [_issue("SK002", "error", "'name' is required in frontmatter")]
    name = str(name)
    issues: list[Issue] = []
    if not _KEBAB_RE.match(name):
        issues.append(_issue("SK004", "error", f"Name '{name}' is not kebab-case"))
    if len(name) > _MAX_NAME_LENGTH:
        issues.append(
            _issue(
                "SK004",
                "error",
                f"Name '{name}' is {len(name)} characters (max {_MAX_NAME_LENGTH})",
            )
        )
    if name != dir_name:
        issues.append(
            _issue("SK004", "error", f"Name '{name}' does not match its directory '{dir_name}'")
        )
    return issues


def _check_description(fm: dict) -> list[Issue]:
    """SK003, SK005 and SK016."""
    description = fm.get("description")
    if not description:
        return [_issue("SK003", "error", "'description' is required in frontmatter")]
    length = len(str(description))
    if length > _MAX_DESCRIPTION_LENGTH:
        return [
            _issue(
                "SK005",
                "error",
                f"Description is {length} characters (max {_MAX_DESCRIPTION_LENGTH})",
            )
        ]
    if length > _TARGET_DESCRIPTION_LENGTH:
        return [
            _issue(
                "SK016",
                "warning",
                f"Description is {length} characters; keep it under "
                f"{_TARGET_DESCRIPTION_LENGTH}: say what the skill does and when to use it",
            )
        ]
    return []


def _check_triggers(fm: dict) -> list[Issue]:
    """SK017: hosts don't read trigger lists, and they spend the listing budget."""
    issues: list[Issue] = []
    if "triggers" in fm:
        issues.append(
            _issue(
                "SK017",
                "warning",
                "'triggers' is not read by hosts; remove it and name the situations in the "
                "description's 'Use when ...' sentence",
            )
        )
    for field in ("description", "when_to_use"):
        value = fm.get(field)
        if isinstance(value, str) and _TRIGGERS_LIST_RE.search(value):
            issues.append(
                _issue(
                    "SK017",
                    "warning",
                    f"'{field}' has a 'Triggers:' list, which hosts don't use and which "
                    "spends the listing budget; remove it",
                )
            )
    return issues


def _check_fields(fm: dict) -> list[Issue]:
    """SK018: fields neither the open standard nor Claude Code reads."""
    issues: list[Issue] = []
    for key in fm:
        if key in SUPPORTED_FIELDS or key == "triggers":  # triggers: SK017
            continue
        if key in OWNERSHIP_FIELDS:
            message = (
                f"Top-level '{key}' is not a runtime field; move it under metadata: "
                f"(metadata.{key}) rather than deleting it, because skill-seed reads it there"
            )
        else:
            message = (
                f"Unsupported frontmatter field '{key}' (neither the open standard nor "
                "Claude Code reads it)"
            )
        issues.append(_issue("SK018", "warning", message))
    return issues


# ── Rules over the body and directory ───────────────────────────────────────


def check_reference_links(skill_dir: Path, body: str) -> list[Issue]:
    """SK008: every skill-local references/ path in the body exists."""
    issues: list[Issue] = []
    seen: set[str] = set()
    for match in _REFERENCE_PATH_RE.finditer(body):
        ref_name = match.group(1).rstrip(".,;:!")
        if ref_name in seen:
            continue
        seen.add(ref_name)
        if not (skill_dir / "references" / ref_name).exists():
            issues.append(
                _issue("SK008", "error", f"Referenced file missing: references/{ref_name}")
            )
    return issues


def _check_body(skill_dir: Path, body: str) -> list[Issue]:
    """SK009, SK010 and SK014."""
    issues: list[Issue] = []
    lines = len(body.splitlines())
    if lines > _MAX_BODY_LINES:
        issues.append(
            _issue(
                "SK009",
                "warning",
                f"Body is {lines} lines (max {_MAX_BODY_LINES}); move lookup material "
                "into references/",
            )
        )

    for pattern in _PLACEHOLDER_PATTERNS:
        match = pattern.search(body)
        if match:
            issues.append(_issue("SK010", "warning", f"Placeholder text found: '{match.group()}'"))
            break

    refs_dir = skill_dir / "references"
    if refs_dir.is_dir():
        for ref_file in sorted(refs_dir.iterdir()):
            if ref_file.is_file() and ref_file.name not in body:
                issues.append(
                    _issue("SK014", "warning", f"Orphan reference: references/{ref_file.name}")
                )
    return issues


def _check_filename(skill_dir: Path) -> list[Issue]:
    """SK012: compares real directory entries, so it holds on case-insensitive filesystems."""
    names = {entry.name for entry in skill_dir.iterdir()}
    if "skill.md" in names and "SKILL.md" not in names:
        return [_issue("SK012", "warning", "Rename skill.md to SKILL.md")]
    return []


# ── Listing budget ───────────────────────────────────────────────────────────


def _first_paragraph(text: str) -> str:
    """The body's first paragraph, skipping headings and one-line HTML comments."""
    body = _LISTING_FRONTMATTER_RE.sub("", text, count=1)
    paragraph: list[str] = []
    for line in body.split("\n"):
        trimmed = line.strip()
        if not trimmed:
            if paragraph:
                break
            continue
        if not paragraph and (trimmed.startswith("#") or _HTML_COMMENT_RE.match(trimmed)):
            continue
        paragraph.append(trimmed)
    return " ".join(paragraph)


def listing_characters(text: str, fm: dict | None) -> int:
    """Characters a skill adds to the host's skill listing.

    ``description`` plus ``when_to_use``; 0 with ``disable-model-invocation: true``; a
    missing or empty description is listed by the body's first paragraph.
    """
    frontmatter = _LISTING_FRONTMATTER_RE.match(text)
    if frontmatter and _LISTING_DISABLED_RE.search(frontmatter.group(1)):
        return 0
    fm = fm or {}
    description = fm.get("description")
    listed = str(description) if description not in (None, "") else _first_paragraph(text)
    when_to_use = fm.get("when_to_use")
    return len(listed) + (len(str(when_to_use)) if when_to_use not in (None, "") else 0)


def _check_listing_budget(results: list[dict[str, Any]], budget: int) -> dict[str, int]:
    """SK019: attach an over-budget warning to the skill with the largest listing."""
    # Hosts list a name once, so a mirrored copy (same name) counts once.
    listed: dict[str, int] = {}
    for r in results:
        listed.setdefault(r.get("name") or r["skill"], r["listing"])
    characters = sum(listed.values())
    if characters > budget:
        largest = sorted(
            (r for r in results if r["listing"] > 0), key=lambda r: r["listing"], reverse=True
        )[:3]
        named = ", ".join(f"{r['skill']} ({r['listing']})" for r in largest)
        largest[0]["violations"].append(
            _issue(
                "SK019",
                "warning",
                f"Skill listing is {characters} characters, over the budget of {budget} "
                f"(largest: {named}). Shorten descriptions or remove skills that add no "
                "unique context",
            )
        )
    return {"characters": characters, "budget": budget}


# ── Per-skill and aggregate linting ─────────────────────────────────────────


def find_skill_file(skill_dir: Path) -> Path | None:
    """SKILL.md, or skill.md, in a skill directory."""
    for name in ("SKILL.md", "skill.md"):
        candidate = skill_dir / name
        if candidate.is_file():
            return candidate
    return None


def _lint_skill(skill_dir: Path) -> dict[str, Any]:
    """Lint one skill; the result carries its frontmatter name and listing size."""
    result: dict[str, Any] = {"skill": skill_dir.name, "violations": [], "name": None}
    skill_file = find_skill_file(skill_dir)
    if skill_file is None:
        result["violations"] = [_issue("SK001", "error", "Missing SKILL.md file")]
        result["listing"] = 0
        return result

    text = skill_file.read_text(encoding="utf-8").removeprefix("\ufeff")
    fm, body = split_frontmatter(text)
    result["listing"] = listing_characters(text, fm)
    violations: list[Issue] = result["violations"]
    if fm is None:
        violations.append(
            _issue(
                "SK001",
                "error",
                "SKILL.md has no YAML frontmatter (a mapping between --- markers)",
            )
        )
        return result

    if fm.get("name"):
        result["name"] = str(fm["name"])
    violations.extend(_check_name(fm, skill_dir.name))
    violations.extend(_check_description(fm))
    violations.extend(check_reference_links(skill_dir, body))
    violations.extend(_check_body(skill_dir, body))
    violations.extend(_check_filename(skill_dir))
    violations.extend(_check_triggers(fm))
    violations.extend(_check_fields(fm))
    violations.extend(_check_ownership_types(fm))
    return result


def _check_ownership_types(fm: dict[str, Any]) -> list[Issue]:
    """SK001: ownership values skill-seed can read; SK018: versions YAML would reformat."""
    metadata = fm.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        return [
            _issue(
                "SK001",
                "error",
                "metadata: must be a mapping; skill-seed can't read the skill's owner from it",
            )
        ]
    issues: list[Issue] = []
    for where, values in (("metadata.", metadata or {}), ("", fm)):
        version = values.get("version")
        if isinstance(version, int | float) and not isinstance(version, bool):
            issues.append(
                _issue(
                    "SK018",
                    "warning",
                    f"{where}version is the YAML number {version!r}; quote it so it keeps "
                    "its exact text (1.10 would read as 1.1)",
                )
            )
    return issues


def lint_skill_dirs(
    skill_dirs: list[Path], listing_budget: int
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Run every rule over the skills; both entry points shape the result from this.

    Returns:
        (results, listing): one ``{"skill", "violations"}`` per directory, in order,
        and ``{"characters", "budget"}`` for the listing.
    """
    results = [_lint_skill(skill_dir) for skill_dir in skill_dirs]

    # SK015: duplicate names across the linted skills
    by_name: dict[str, list[dict[str, Any]]] = {}
    for r in results:
        if r["name"]:
            by_name.setdefault(r["name"], []).append(r)
    for name, owners in by_name.items():
        if len(owners) > 1:
            dirs = ", ".join(r["skill"] for r in owners)
            for r in owners:
                r["violations"].append(
                    _issue("SK015", "error", f"Duplicate name '{name}' in: {dirs}")
                )

    listing = _check_listing_budget(results, listing_budget)
    return [{"skill": r["skill"], "violations": r["violations"]} for r in results], listing


def summarize(skills: list[dict[str, Any]], key: str) -> dict[str, int]:
    """Totals over each skill's ``key`` list of issues."""
    errors = sum(1 for s in skills for i in s[key] if i["severity"] == "error")
    warnings = sum(1 for s in skills for i in s[key] if i["severity"] == "warning")
    passed = sum(1 for s in skills if not any(i["severity"] == "error" for i in s[key]))
    return {"total": len(skills), "passed": passed, "errors": errors, "warnings": warnings}


async def skill_lint(
    path: str | None = None,
    strict: bool = False,
) -> CommandResult[dict]:
    """Lint the workspace's skills with rules SK001-SK019.

    Args:
        path: A skill under the configured skills directory, or an absolute skill
            directory. None lints every skill in the skills directory.
        strict: If True, every warning is reported as an error.
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

    if path:
        target = Path(path) if Path(path).is_absolute() else skills_dir / path
        if not target.is_dir():
            return error(
                "SKILL_NOT_FOUND",
                f"Skill directory not found: {target}",
                suggestion=f"Pass a skill name under {skills_dir} or an absolute path",
            )
        skill_dirs = [target]
        linted_path = target
    else:
        linted_path = skills_dir
        skill_dirs = [p for _, (p, _) in sorted(discover_local_skills(skills_dir).items())]

    if not skill_dirs:
        return error(
            "NO_SKILLS",
            "No skills found to lint",
            suggestion=f"Add skill directories with a SKILL.md under {skills_dir}",
        )

    results, listing = lint_skill_dirs(skill_dirs, config.skills.listing_budget)
    if strict:
        for r in results:
            for v in r["violations"]:
                v["severity"] = "error"

    totals = summarize(results, "violations")
    return success(
        data={
            "path": str(linted_path),
            **totals,
            "skills": results,
            "listing": listing,
            "success": totals["errors"] == 0,
        }
    )
