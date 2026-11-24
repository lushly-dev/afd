"""Botcore documentation commands — link checking, changelog, and agents validation."""

from __future__ import annotations

import functools
import os
import re
import subprocess
from pathlib import Path, PurePosixPath

from afd import CommandResult, error, success

from botcore.registry import get_client
from botcore.utils.workspace import display_path, find_workspace, resolve_path

PIPELINE_DOCS = """# Pipelines

DirectClient supports multi-step command pipelines via `client.pipe()`.
Each step can reference outputs from previous steps using variable syntax.

## Variable Resolution

A string is a reference only when the whole value matches one of these forms;
anything else starting with `$` (e.g. `$9.99`) passes through as a literal, and
`$$` escapes a leading `$`.

- `$prev` / `$prev.field` — Data of the most recent successful step
- `$first` / `$first.field` — Data of the first step
- `$steps[N]` / `$steps[N].field` — Data of step `N` (0-based)
- `$steps.alias` / `$steps.alias.field` — Data of the step named with `as`
- `$input` / `$input.field` — The pipeline request's own `input`

Unresolved references are omitted from the step input.

## Example

```python
from botcore.registry import get_client

client = get_client()
result = await client.pipe([
    {"command": "info-workspace", "as": "ws"},
    {"command": "info-env", "input": {}},
])
# result.steps holds each step's result, result.outputs maps aliases to data,
# and result.final is the last step's CommandResult
```

## Conditional Steps

Use `when` to conditionally execute a step:

```python
result = await client.pipe([
    {"command": "docs-check-changelog", "as": "check"},
    {"command": "changeset-create",
     "input": {"type": "added", "description": "..."},
     "when": "$steps.check.needs_update"},
])
```

## Error Handling

If any step fails, the pipeline stops and returns the failure.
The `result.steps` list shows which steps completed before the failure.
"""

_FRONTMATTER_REQUIRED_FIELDS = {"status", "author", "created"}


def _slugify_heading(text: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", text.lower())
    slug = re.sub(r"\s+", "-", slug).strip("-")
    return slug


def _extract_headings(content: str) -> dict[str, int]:
    headings: dict[str, int] = {}
    for line_num, line in enumerate(content.splitlines(), 1):
        match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if not match:
            continue
        title = match.group(2).strip()
        slug = _slugify_heading(title)
        if slug:
            headings[slug] = line_num
    return headings


def _has_frontmatter(content: str) -> bool:
    return content.startswith("---") and "\n---" in content[3:]


def _extract_frontmatter(content: str) -> dict[str, str]:
    if not _has_frontmatter(content):
        return {}
    end = content.find("---", 3)
    if end <= 0:
        return {}
    frontmatter: dict[str, str] = {}
    for line in content[3:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        frontmatter[key.strip().lower()] = value.strip()
    return frontmatter


def _format_issue_path(md_file: Path, ws: Path | None) -> str:
    return display_path(md_file, ws)


def _record_issue(
    issues: list[dict],
    md_file: Path,
    ws: Path | None,
    line: int,
    severity: str,
    rule: str,
    message: str,
    link_text: str | None = None,
) -> None:
    issue: dict = {
        "file": _format_issue_path(md_file, ws),
        "line": line,
        "severity": severity,
        "rule": rule,
        "message": message,
    }
    if link_text:
        issue["link_text"] = link_text
    issues.append(issue)


def _link_boundary(ws: Path | None) -> Path | None:
    """The directory a link may not leave: the worktree, not only the selected unit.

    Under a managed host that is the context's worktree. From the command line it is the
    nearest directory above the workspace that holds ``.git``, so links between a
    repository's units are still checked.
    """
    from botcore.context import current_context

    context = current_context()
    if context is not None:
        return context.workspace
    if ws is None:
        return None
    root = _resolved(Path(os.path.abspath(ws)))
    for candidate in (root, *root.parents):
        if (candidate / ".git").exists():
            return candidate
    return root


@functools.lru_cache(maxsize=8)
def _resolved(path: Path) -> Path:
    return path.resolve()


def _outside_workspace(boundary: Path | None, path: Path) -> bool:
    """Whether ``path`` leaves ``boundary``, through ``..`` or a symlink.

    The ``..`` check is lexical, so such a path is never looked up. A path that stays inside
    lexically is resolved, which follows symlinks inside the boundary; a path that cannot be
    resolved (a symlink loop) counts as outside.
    """
    if boundary is None:
        return False
    lexical = Path(os.path.normpath(os.path.abspath(path)))
    if not lexical.is_relative_to(boundary):
        return True
    try:
        return not path.resolve().is_relative_to(_resolved(boundary))
    except (OSError, RuntimeError):
        return True


def _record_outside(
    issues: list[dict],
    md_file: Path,
    ws: Path | None,
    line_num: int,
    url_path: str,
    link_text: str,
) -> None:
    _record_issue(
        issues,
        md_file,
        ws,
        line_num,
        "warning",
        "link-outside-workspace",
        f"Link target '{url_path}' is outside the workspace and was not checked",
        link_text,
    )


def _resolve_target(ws: Path | None, md_file: Path, url_path: str) -> Path:
    if url_path.startswith("/"):
        return ws / url_path[1:] if ws else Path(url_path[1:])
    return md_file.parent / url_path


def _is_spec_or_proposal(md_file: Path) -> bool:
    return "".join(md_file.suffixes[-2:]) in {".proposal.md", ".spec.md"}


def _check_frontmatter(
    md_file: Path,
    content: str,
    ws: Path | None,
    issues: list[dict],
) -> None:
    if not _is_spec_or_proposal(md_file):
        return
    frontmatter = _extract_frontmatter(content)
    missing_fields = sorted(_FRONTMATTER_REQUIRED_FIELDS - set(frontmatter.keys()))
    if not frontmatter:
        _record_issue(
            issues, md_file, ws, 1, "warning", "missing-frontmatter", "Missing frontmatter block"
        )
    elif missing_fields:
        _record_issue(
            issues,
            md_file,
            ws,
            1,
            "warning",
            "missing-frontmatter-fields",
            f"Missing frontmatter fields: {', '.join(missing_fields)}",
        )


def _split_anchor(link_url: str) -> tuple[str, str]:
    if "#" in link_url:
        base, anchor = link_url.split("#", 1)
        return base, anchor
    return link_url, ""


def _load_target_headings(
    target: Path,
    anchor_cache: dict[Path, dict[str, int]],
) -> dict[str, int]:
    if target.suffix != ".md":
        return {}
    if target not in anchor_cache:
        target_content = target.read_text(encoding="utf-8", errors="replace")
        anchor_cache[target] = _extract_headings(target_content)
    return anchor_cache[target]


def _check_anchor(
    anchor: str,
    target_headings: dict[str, int],
    md_file: Path,
    ws: Path | None,
    line_num: int,
    issues: list[dict],
    link_text: str,
) -> None:
    anchor_slug = _slugify_heading(anchor)
    if anchor_slug and anchor_slug not in target_headings:
        _record_issue(
            issues,
            md_file,
            ws,
            line_num,
            "error",
            "broken-anchor",
            f"Anchor '#{anchor}' not found",
            link_text,
        )


def _check_link(  # noqa: PLR0913 - one argument per lint input
    link_text: str,
    link_url: str,
    md_file: Path,
    ws: Path | None,
    line_num: int,
    doc_headings: dict[str, int],
    anchor_cache: dict[Path, dict[str, int]],
    issues: list[dict],
    boundary: Path | None = None,
) -> None:
    if link_url.startswith(("http://", "https://", "mailto:")):
        return

    url_path, anchor = _split_anchor(link_url)

    if anchor:
        if url_path:
            target = _resolve_target(ws, md_file, url_path)
            # Never read or test a file outside the workspace: the link names it, not the caller.
            if _outside_workspace(boundary, target):
                _record_outside(issues, md_file, ws, line_num, url_path, link_text)
                return
            if not target.exists():
                _record_issue(
                    issues,
                    md_file,
                    ws,
                    line_num,
                    "error",
                    "broken-link",
                    f"Link target '{url_path}' does not exist",
                    link_text,
                )
                return
            target_headings = _load_target_headings(target, anchor_cache)
        else:
            target_headings = doc_headings
        _check_anchor(anchor, target_headings, md_file, ws, line_num, issues, link_text)
        return

    if not url_path:
        return

    target = _resolve_target(ws, md_file, url_path)
    if _outside_workspace(boundary, target):
        _record_outside(issues, md_file, ws, line_num, url_path, link_text)
        return
    if not target.exists():
        _record_issue(
            issues,
            md_file,
            ws,
            line_num,
            "error",
            "broken-link",
            f"Link target '{url_path}' does not exist",
            link_text,
        )


# Directories of installed or generated files, never a repository's own docs.
_SKIPPED_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".venv",
        "venv",
        ".tox",
        ".nox",
        "node_modules",
        "__pycache__",
        "dist",
        "build",
        "target",
        ".next",
        ".turbo",
        "coverage",
    }
)


def _markdown_files(path: Path) -> list[Path]:
    """The Markdown files to lint: ``path`` itself, or those under it outside skipped dirs."""
    if path.is_file():
        return [path] if path.suffix.lower() == ".md" else []
    return sorted(
        md
        for md in path.rglob("*.md")
        if not _SKIPPED_DIRS.intersection(md.relative_to(path).parts[:-1])
    )


async def docs_lint(path: str | None = None) -> CommandResult[dict]:
    """Lint markdown files for broken links and missing frontmatter.

    Checks for:
    - Broken internal links
    - Broken anchor links
    - Missing files referenced in links
    - Missing frontmatter for specs/proposals
    """
    ws = find_workspace()
    check_path = resolve_path(path, ws, "docs")
    boundary = _link_boundary(ws)

    # Checked before the path is looked up, so a docs/ that links out is never listed.
    if _outside_workspace(boundary, check_path):
        return error(
            "PATH_OUTSIDE_WORKSPACE",
            f"Path is outside the workspace: {check_path}",
            suggestion="Lint a directory inside the workspace, or run from inside the one to lint",
        )

    if not check_path.exists():
        return error(
            "PATH_NOT_FOUND",
            f"Path not found: {check_path}",
            suggestion="Verify the path exists or omit to use default docs/",
        )

    issues: list[dict] = []
    files_checked = 0

    link_pattern = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
    anchor_cache: dict[Path, dict[str, int]] = {}

    for md_file in _markdown_files(check_path):
        # A Markdown file reached through a symlink out of the workspace is not read.
        if _outside_workspace(boundary, md_file):
            continue
        files_checked += 1
        content = md_file.read_text(encoding="utf-8", errors="replace")
        lines = content.splitlines()
        doc_headings = _extract_headings(content)

        _check_frontmatter(md_file, content, ws, issues)

        for line_num, line in enumerate(lines, 1):
            for match in link_pattern.finditer(line):
                _check_link(
                    match.group(1),
                    match.group(2),
                    md_file,
                    ws,
                    line_num,
                    doc_headings,
                    anchor_cache,
                    issues,
                    boundary,
                )

    has_errors = any(i["severity"] == "error" for i in issues)

    if has_errors:
        return error(
            "BROKEN_LINKS",
            f"Found {len(issues)} broken link(s)",
            suggestion="Fix or remove broken links",
            details={"issues": issues},
        )

    suggestions = []
    if issues:
        suggestions.append("Fix warnings to improve documentation quality")
    return success(
        data={"files_checked": files_checked, "issues": issues, "passed": True},
        reasoning=f"Checked {files_checked} markdown files, no issues found",
        suggestions=suggestions if suggestions else None,
    )


# Source files whose change a changelog records: these extensions, under a ``src/`` directory.
_SOURCE_SUFFIXES = frozenset(
    {
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".rs",
        ".go",
        ".c",
        ".cc",
        ".cpp",
        ".h",
        ".hpp",
    }
)


def _is_source(path: str) -> bool:
    parts = Path(path).parts
    return "src" in parts[:-1] and Path(path).suffix in _SOURCE_SUFFIXES


def _nearest_changelog(ws: Path, path: str) -> str | None:
    """The CHANGELOG.md nearest a file, from its directory up to the workspace root."""
    directory = Path(path).parent
    while True:
        candidate = directory / "CHANGELOG.md"
        if (ws / candidate).is_file():
            return candidate.as_posix()
        if directory == Path("."):
            return None
        directory = directory.parent


def _uses_npm_changesets(ws: Path) -> bool:
    """Whether the workspace is an npm project, which ``changeset_create`` refuses."""
    return any(
        (ws / name).exists()
        for name in ("package.json", "pnpm-workspace.yaml", ".changeset/config.json")
    )


def _changelog_suggestion(ws: Path | None) -> str:
    if ws is not None and _uses_npm_changesets(ws):
        return (
            "Add a changeset with the repository's Changesets command (such as `pnpm changeset`),"
            " or update the CHANGELOG.md named"
        )
    return "Run changeset_create to record this change, or update the CHANGELOG.md named"


async def docs_check_changelog() -> CommandResult[dict]:
    """Check whether staged source changes need a CHANGELOG.md update.

    A staged source file (a code file under any ``src/`` directory) is covered by the
    CHANGELOG.md nearest it, from its directory up to the workspace root, so each package
    of a monorepo answers to its own changelog. A staged changelog, or a pending changeset
    in ``.changeset/``, covers it; a file with no changelog above it needs none.
    """
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", "diff", "--cached", "--name-only"],
        cwd=ws,
        capture_output=True,
        text=True,
    )

    staged_files = result.stdout.strip().splitlines() if result.returncode == 0 else []
    staged = set(staged_files)

    # Count pending changeset files
    changeset_dir = ws / ".changeset"
    changeset_count = 0
    if changeset_dir.exists():
        changeset_count = len(
            [f for f in changeset_dir.glob("*.md") if f.name.lower() != "readme.md"]
        )

    covered: dict[str, str] = {}
    for f in staged_files:
        if _is_source(f):
            changelog = _nearest_changelog(ws, f)
            if changelog is not None:
                covered[f] = changelog
    has_changelog = bool(covered) or (ws / "CHANGELOG.md").is_file()
    if not has_changelog:
        return success(
            data={"has_changelog": False, "needs_update": False, "changeset_count": 0},
            reasoning="No CHANGELOG.md covers the staged files - skipping check",
        )

    uncovered = {f: c for f, c in covered.items() if c not in staged}
    if uncovered and changeset_count > 0:
        return success(
            data={
                "has_changelog": True,
                "needs_update": False,
                "changeset_count": changeset_count,
                "staged_src_files": sorted(uncovered),
            },
            reasoning=f"{changeset_count} changeset(s) pending — changelog "
            "will be updated at release time",
        )
    if uncovered:
        changelogs = sorted(set(uncovered.values()))
        return success(
            data={
                "has_changelog": True,
                "needs_update": True,
                "changeset_count": 0,
                "staged_src_files": sorted(uncovered),
                "changelogs": changelogs,
            },
            reasoning="Source files staged but no update to "
            f"{', '.join(changelogs)} and no changeset files found",
            suggestions=[f"{_changelog_suggestion(ws)}: {', '.join(changelogs)}"],
        )

    return success(
        data={
            "has_changelog": True,
            "needs_update": False,
            "changeset_count": changeset_count,
        },
        reasoning="CHANGELOG.md is up to date or no source changes",
    )


_PACKAGE_MANIFESTS = frozenset({"package.json", "pyproject.toml", "Cargo.toml"})
_TEST_NAME = re.compile(r"^test_|_test\.|\.(test|spec)\.")


def _is_test(path: str) -> bool:
    parts = Path(path).parts
    return bool(_TEST_NAME.search(parts[-1])) or bool({"tests", "__tests__"} & set(parts[:-1]))


def _structural_change(path: str, added: bool) -> str | None:
    """What a staged file changes in a repository's structure, if anything. It is reported, not
    required in AGENTS.md, which routes rather than lists (lushly-dev/afd#1128).

    A command module counts whenever it is staged; a package, skill or workflow only when it
    is new, since editing one does not move it.
    """
    parts = Path(path).parts
    name = parts[-1]
    if (
        "commands" in parts[:-1]
        and Path(path).suffix in _SOURCE_SUFFIXES
        and name != "__init__.py"
        and not _is_test(path)
    ):
        return f"{'New' if added else 'Changed'} command: {path}"
    if not added:
        return None
    if name in _PACKAGE_MANIFESTS or (name == "__init__.py" and "src" in parts[:-1]):
        return f"New package: {path}"
    if name == "SKILL.md" and "skills" in parts[:-1]:
        return f"New skill: {path}"
    if parts[:2] == (".github", "workflows") and Path(path).suffix in (".yml", ".yaml"):
        return f"New workflow: {path}"
    return None


def _git_lines(ws: Path, *args: str) -> list[str] | None:
    """Git's output lines, run in the workspace; None when git fails."""
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", *args], cwd=ws, capture_output=True, text=True
    )
    return result.stdout.splitlines() if result.returncode == 0 else None


def _staged_changes(ws: Path) -> list[tuple[str, str, str | None]]:
    """Each staged change in the workspace as ``(status, path, old path)``, relative to the
    workspace, which may sit below the git root; a rename's old path, else None."""
    changes: list[tuple[str, str, str | None]] = []
    for line in _git_lines(ws, "diff", "--cached", "--name-status", "-M", "--relative") or []:
        fields = line.split("\t")
        if len(fields) == 3:
            changes.append((fields[0][:1], fields[2], fields[1]))
        elif len(fields) == 2:
            changes.append((fields[0][:1], fields[1], None))
    return changes


def _cites(text: str, name: str) -> bool:
    """Whether AGENTS.md cites ``name`` as a whole name, not inside a longer one."""
    return re.search(rf"(?<![\w./-]){re.escape(name)}(?![\w-])", text) is not None


def _names(path: str) -> list[str]:
    """The names AGENTS.md could cite ``path`` by: the path, a skill's name, and the file name of
    a command module or workflow. A manifest's or ``__init__.py``'s name says nothing alone."""
    parts = Path(path).parts
    names = [path]
    if parts[-1] == "SKILL.md" and len(parts) > 1:
        names.append(f"`{parts[-2]}`")
    elif _structural_change(path, False) or (_structural_change(path, True) or "").startswith(
        "New workflow"
    ):
        names.append(parts[-1])
    return names


def _owned_changes(ws: Path, text: str, changes: list[tuple[str, str, str | None]]) -> list[str]:
    """The changes AGENTS.md owns: a new top-level directory it does not name, and a path or
    directory it names that the change removes or renames (lushly-dev/afd#1128).

    AGENTS.md routes; it need not list each package, skill, workflow or command, so a new one
    is not stale until AGENTS.md cites it.
    """
    tracked = _git_lines(ws, "ls-tree", "--name-only", "HEAD")  # None before a first commit.
    # Git prints "/" on every platform; directories that still hold a file after the change.
    remaining = {
        str(parent)
        for path in _git_lines(ws, "ls-files") or []
        for parent in PurePosixPath(path).parents
    }
    owned: list[str] = []
    new_tops: set[str] = set()
    gone_dirs: set[str] = set()
    for status, path, old in changes:
        top = PurePosixPath(path).parts
        if status in "AR" and tracked is not None and len(top) > 1 and top[0] not in tracked:
            if top[0] not in new_tops and not _cites(text, top[0]):
                owned.append(f"New top-level directory: {top[0]}/")
            new_tops.add(top[0])
        gone = old if status == "R" else path if status == "D" else None
        if gone is None:
            continue
        verb = f"renamed to {path}" if status == "R" else "removed"
        cited = next((name for name in _names(gone) if _cites(text, name)), None)
        if cited is not None:
            owned.append(f"AGENTS.md names {cited}, which this change {verb}")
        for parent in PurePosixPath(gone).parents:
            folder = str(parent)
            if folder == "." or folder in remaining or folder in gone_dirs:
                continue
            gone_dirs.add(folder)
            if _cites(text, f"{folder}/"):
                owned.append(f"AGENTS.md names {folder}/, which this change removes or moves")
    return owned


async def docs_check_agents() -> CommandResult[dict]:
    """Check whether AGENTS.md needs updating for what it owns: the top-level layout and the
    paths it names. Other structural changes are reported, not required."""
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    agents_md = ws / "AGENTS.md"
    if not agents_md.exists():
        return success(
            data={"has_agents_md": False, "needs_update": False},
            reasoning="No AGENTS.md found - skipping check",
        )

    changes = _staged_changes(ws)
    structural_changes = [
        change
        for status, path, _old in changes
        if status != "D" and (change := _structural_change(path, status in "AR"))
    ]
    agents_staged = any(path == "AGENTS.md" for _status, path, _old in changes)
    owned = [] if agents_staged else _owned_changes(ws, agents_md.read_text("utf-8"), changes)

    data = {
        "has_agents_md": True,
        "needs_update": bool(owned),
        "owned_changes": owned,
        "structural_changes": structural_changes,
    }
    if owned:
        return success(
            data=data,
            reasoning=f"AGENTS.md is out of date: {', '.join(owned[:3])}",
            suggestions=["Update AGENTS.md: name the new directory, or fix the name it cites"],
        )
    if structural_changes and not agents_staged:
        return success(
            data=data,
            reasoning="Structural changes that AGENTS.md does not list: "
            f"{', '.join(structural_changes[:3])}",
            suggestions=[
                "No AGENTS.md entry is needed; describe them where they are owned (a README, "
                "the docs, the command's own description)"
            ],
        )
    return success(data=data, reasoning="AGENTS.md is up to date or no structural changes")


async def docs_preflight() -> CommandResult[dict]:
    """Run docs release-readiness checks via an AFD DirectClient pipeline."""
    client = get_client(source="docs_preflight")
    pipeline = await client.pipe(
        [
            {"command": "docs_check_changelog", "input": {}, "as": "changelog"},
            {"command": "docs_check_agents", "input": {}, "as": "agents"},
        ]
    )

    final = pipeline.final
    if not pipeline.success or final is None:
        if final is not None and not final.success and final.error is not None:
            return error(
                final.error.code,
                final.error.message,
                suggestion=final.error.suggestion,
                retryable=final.error.retryable,
                details=final.error.details,
            )
        return error(
            "DOCS_PREFLIGHT_FAILED",
            "Docs preflight pipeline did not complete successfully",
            suggestion="Inspect the docs check commands individually",
        )

    changelog = pipeline.outputs.get("changelog", {})
    agents = pipeline.outputs.get("agents", {})
    needs_update = bool(changelog.get("needs_update")) or bool(agents.get("needs_update"))

    suggestions: list[str] = []
    if changelog.get("needs_update"):
        changelogs = changelog.get("changelogs") or ["CHANGELOG.md"]
        suggestions.append(f"{_changelog_suggestion(find_workspace())}: {', '.join(changelogs)}")
    if agents.get("needs_update"):
        suggestions.append("Update AGENTS.md: name the new directory, or fix the name it cites")

    return success(
        data={
            "needs_update": needs_update,
            "checks": {
                "changelog": changelog,
                "agents": agents,
            },
            "step_count": len(pipeline.steps),
        },
        reasoning="Ran docs preflight checks via DirectClient pipeline",
        suggestions=suggestions or None,
    )
