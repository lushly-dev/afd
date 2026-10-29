"""Changeset commands — create, status, and consume changelog fragments."""

from __future__ import annotations

import re
import uuid
from datetime import date
from pathlib import Path

import yaml
from afd import CommandResult, error, success

from botcore.context import current_context
from botcore.utils.workspace import find_workspace

CHANGESET_DIR = ".changeset"
VALID_TYPES = ("added", "changed", "deprecated", "removed", "fixed", "security")
_CATEGORY_ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]


def _changeset_dir(ws: Path) -> Path:
    return ws / CHANGESET_DIR


def _list_changeset_files(changeset_dir: Path) -> list[Path]:
    """List all changeset .md files, excluding README.md."""
    if not changeset_dir.exists():
        return []
    return sorted(f for f in changeset_dir.glob("*.md") if f.name.lower() != "readme.md")


def _parse_changeset(path: Path) -> tuple[str | None, str]:
    """Parse a changeset file into (type, description)."""
    content = path.read_text(encoding="utf-8").strip()
    if not content.startswith("---"):
        return None, content

    end = content.find("---", 3)
    if end <= 0:
        return None, content

    frontmatter = content[3:end]
    body = content[end + 3 :].strip()

    change_type = None
    for line in frontmatter.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        if key.strip().lower() == "type":
            change_type = value.strip().lower()

    return change_type, body


def _is_owned_fragment(path: Path) -> bool:
    content = path.read_text(encoding="utf-8").strip()
    parts = content.split("---", 2)
    if len(parts) != 3 or parts[0].strip() or not parts[2].strip():
        return False
    try:
        header = yaml.safe_load(parts[1])
    except yaml.YAMLError:
        return False
    return isinstance(header, dict) and set(header) == {"type"} and (header["type"] in VALID_TYPES)


def _release_guard(ws: Path) -> CommandResult | None:
    """Never interpret npm intent using Botcore's legacy category protocol."""
    context = current_context()
    roots = {ws, context.workspace} if context else {ws}
    if any(
        (root / "package.json").exists()
        or (root / "pnpm-workspace.yaml").exists()
        or (root / CHANGESET_DIR / "config.json").exists()
        for root in roots
    ):
        return error(
            "RELEASE_PROTOCOL_REQUIRED",
            "Category fragments cannot operate on an npm project",
            suggestion="Select a release unit and use the host's approved npm Changesets workflow",
        )
    owned_dir = _changeset_dir(ws).resolve()
    if not owned_dir.is_relative_to(ws.resolve()):
        return error(
            "FOREIGN_RELEASE_STORAGE",
            "Fragment storage resolves outside the target",
            suggestion="Configure owned local category storage",
        )
    for path in _list_changeset_files(_changeset_dir(ws)):
        if path.resolve().parent != owned_dir or not _is_owned_fragment(path):
            return error(
                "FOREIGN_RELEASE_FRAGMENT",
                f"Not a category fragment: {path.name}",
                suggestion="Resolve fragment ownership and protocol before retrying",
            )
    return None


async def changeset_create(
    change_type: str,
    description: str,
) -> CommandResult[dict]:
    """Create a changeset file for the next release.

    Args:
        change_type: One of: added, changed, deprecated, removed, fixed, security.
        description: Changelog entry text (markdown). Bold the component name.
    """
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    denied = _release_guard(ws)
    if denied is not None:
        return denied

    change_type = change_type.strip().lower()
    if change_type not in VALID_TYPES:
        return error(
            "INVALID_TYPE",
            f"Invalid changeset type: {change_type!r}",
            suggestion=f"Use one of: {', '.join(VALID_TYPES)}",
        )

    description = description.strip()
    if not description:
        return error(
            "EMPTY_DESCRIPTION",
            "Description cannot be empty",
            suggestion="Provide a changelog entry describing the change",
        )

    cs_dir = _changeset_dir(ws)
    cs_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid.uuid4().hex[:8]}.md"
    filepath = cs_dir / filename

    content = f"---\ntype: {change_type}\n---\n\n{description}\n"
    filepath.write_text(content, encoding="utf-8")

    return success(
        data={
            "path": filepath.relative_to(ws).as_posix(),
            "type": change_type,
            "description": description,
        },
        undo_command="changeset_delete",
        undo_args={"path": filepath.relative_to(ws).as_posix()},
    )


async def changeset_delete(path: str) -> CommandResult[dict]:
    """Delete a pending changeset file."""
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    denied = _release_guard(ws)
    if denied is not None:
        return denied

    changeset_path = Path(path)
    if not changeset_path.is_absolute():
        changeset_path = ws / changeset_path

    changeset_path = changeset_path.resolve()
    owned_dir = _changeset_dir(ws).resolve()
    if (
        changeset_path.parent != owned_dir
        or changeset_path.suffix != ".md"
        or changeset_path.name.lower() == "readme.md"
    ):
        return error(
            "FOREIGN_RELEASE_FRAGMENT",
            "Only owned category fragments can be deleted",
            suggestion="Use changeset_status and select a fragment in .changeset",
        )

    if not changeset_path.exists():
        return error(
            "FILE_NOT_FOUND",
            f"Changeset not found: {path}",
            suggestion="Check the path or run changeset_status to list pending files",
        )

    if changeset_path.is_dir():
        return error(
            "NOT_A_FILE",
            f"Expected a changeset file but found a directory: {changeset_path}",
            suggestion="Pass the path to a specific changeset markdown file",
        )

    change_type, description = _parse_changeset(changeset_path)
    if change_type not in VALID_TYPES or not description:
        return error(
            "FOREIGN_RELEASE_FRAGMENT",
            "Not a category fragment",
            suggestion="Resolve fragment ownership before deletion",
        )
    changeset_path.unlink()

    return success(
        data={"path": changeset_path.relative_to(ws).as_posix(), "deleted": True},
        reasoning=f"Deleted changeset {changeset_path.name}",
        undo_command="changeset_create",
        undo_args={
            "change_type": change_type or "added",
            "description": description,
        },
    )


async def changeset_status() -> CommandResult[dict]:
    """Show pending changeset files and their types."""
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    denied = _release_guard(ws)
    if denied is not None:
        return denied

    files = _list_changeset_files(_changeset_dir(ws))

    entries: list[dict] = []
    by_type: dict[str, int] = {}
    for f in files:
        change_type, description = _parse_changeset(f)
        entries.append(
            {
                "file": f.relative_to(ws).as_posix(),
                "type": change_type or "unknown",
                "description": description[:100],
            }
        )
        key = change_type or "unknown"
        by_type[key] = by_type.get(key, 0) + 1

    return success(
        data={
            "count": len(entries),
            "by_type": by_type,
            "entries": entries,
        }
    )


async def changeset_consume(
    version: str | None = None,
) -> CommandResult[dict]:
    """Consume changeset files and update CHANGELOG.md.

    Reads all pending changesets, groups by type, generates a changelog
    section, inserts it into CHANGELOG.md, and deletes consumed files.

    Args:
        version: Version string (e.g. "1.2.0"). If None, uses [Unreleased].
    """
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    denied = _release_guard(ws)
    if denied is not None:
        return denied

    cs_dir = _changeset_dir(ws)
    files = _list_changeset_files(cs_dir)
    if not files:
        return error(
            "NO_CHANGESETS",
            "No changeset files found",
            suggestion="Create changesets with changeset_create() "
            f"or add files to {CHANGESET_DIR}/",
        )

    changelog = ws / "CHANGELOG.md"
    if not changelog.exists():
        return error(
            "NO_CHANGELOG",
            "CHANGELOG.md not found",
            suggestion="Create a CHANGELOG.md file first",
        )

    # Parse all changesets
    grouped: dict[str, list[str]] = {cat.lower(): [] for cat in _CATEGORY_ORDER}
    for f in files:
        change_type, description = _parse_changeset(f)
        if change_type and change_type in grouped:
            grouped[change_type].append(description)
        elif description:
            grouped["added"].append(description)

    # Build the new section
    if version:
        heading = f"## [{version}] - {date.today().isoformat()}"
    else:
        heading = "## [Unreleased]"

    section_lines = [heading, ""]
    categories_used = []
    for category in _CATEGORY_ORDER:
        entries = grouped[category.lower()]
        if entries:
            categories_used.append(category)
            section_lines.append(f"### {category}")
            section_lines.append("")
            for entry in entries:
                # Ensure entry starts with "- " for list formatting
                if not entry.startswith("- "):
                    entry = f"- {entry}"
                section_lines.append(entry)
            section_lines.append("")

    new_section = "\n".join(section_lines)

    # Insert into CHANGELOG.md
    content = changelog.read_text(encoding="utf-8")
    # Find the first ## [ heading to insert before
    pattern = re.compile(r"^## \[", re.MULTILINE)
    match = pattern.search(content)
    if match:
        # Replace existing [Unreleased] or insert before first version heading
        unreleased_pattern = re.compile(
            r"^## \[Unreleased\]\s*\n(.*?)(?=^## \[|\Z)",
            re.MULTILINE | re.DOTALL,
        )
        unreleased_match = unreleased_pattern.search(content)
        if unreleased_match:
            # Replace the [Unreleased] section
            if version:
                # Replace [Unreleased] with versioned section, add fresh [Unreleased]
                replacement = "## [Unreleased]\n\n" + new_section
            else:
                replacement = new_section
            content = (
                content[: unreleased_match.start()]
                + replacement
                + content[unreleased_match.end() :]
            )
        else:
            # No [Unreleased] section, insert before first version
            content = content[: match.start()] + new_section + "\n" + content[match.start() :]
    else:
        # No version headings at all, append after header
        content = content.rstrip() + "\n\n" + new_section

    changelog.write_text(content, encoding="utf-8")

    # Delete consumed changeset files
    consumed = len(files)
    for f in files:
        f.unlink()

    return success(
        data={
            "consumed": consumed,
            "version": version,
            "categories": categories_used,
        }
    )
