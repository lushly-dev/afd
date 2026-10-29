"""Botcore documentation commands — link checking, changelog, and agents validation."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from afd import CommandResult, error, success

from botcore.registry import get_client
from botcore.utils.workspace import find_workspace

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
    return str(md_file.relative_to(ws) if ws else md_file)


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
        _record_issue(issues, md_file, ws, 1, "warning", "missing-frontmatter",
                       "Missing frontmatter block")
    elif missing_fields:
        _record_issue(issues, md_file, ws, 1, "warning", "missing-frontmatter-fields",
                       f"Missing frontmatter fields: {', '.join(missing_fields)}")


def _split_anchor(link_url: str) -> tuple[str, str]:
    if "#" in link_url:
        return link_url.split("#", 1)
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
        _record_issue(issues, md_file, ws, line_num, "error", "broken-anchor",
                       f"Anchor '#{anchor}' not found", link_text)


def _check_link(
    link_text: str,
    link_url: str,
    md_file: Path,
    ws: Path | None,
    line_num: int,
    doc_headings: dict[str, int],
    anchor_cache: dict[Path, dict[str, int]],
    issues: list[dict],
) -> None:
    if link_url.startswith(("http://", "https://", "mailto:")):
        return

    url_path, anchor = _split_anchor(link_url)

    if anchor:
        if url_path:
            target = _resolve_target(ws, md_file, url_path)
            if not target.exists():
                _record_issue(issues, md_file, ws, line_num, "error", "broken-link",
                               f"Link target '{url_path}' does not exist", link_text)
                return
            target_headings = _load_target_headings(target, anchor_cache)
        else:
            target_headings = doc_headings
        _check_anchor(anchor, target_headings, md_file, ws, line_num, issues, link_text)
        return

    if not url_path:
        return

    target = _resolve_target(ws, md_file, url_path)
    if not target.exists():
        _record_issue(issues, md_file, ws, line_num, "error", "broken-link",
                       f"Link target '{url_path}' does not exist", link_text)


async def docs_lint(path: str | None = None) -> CommandResult[dict]:
    """Lint markdown files for broken links and missing frontmatter.

    Checks for:
    - Broken internal links
    - Broken anchor links
    - Missing files referenced in links
    - Missing frontmatter for specs/proposals
    """
    ws = find_workspace()
    check_path = Path(path) if path else (ws / "docs" if ws else Path("docs"))

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

    for md_file in check_path.rglob("*.md"):
        files_checked += 1
        content = md_file.read_text(encoding="utf-8", errors="replace")
        lines = content.splitlines()
        doc_headings = _extract_headings(content)

        _check_frontmatter(md_file, content, ws, issues)

        for line_num, line in enumerate(lines, 1):
            for match in link_pattern.finditer(line):
                _check_link(
                    match.group(1), match.group(2), md_file, ws,
                    line_num, doc_headings, anchor_cache, issues,
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


async def docs_check_changelog() -> CommandResult[dict]:
    """Check if CHANGELOG.md needs updating based on staged changes.

    Changeset-aware: if source files are staged without a CHANGELOG.md update,
    checks for pending changeset files in .changeset/. If changesets exist,
    the changelog will be updated at release time — no manual edit needed.
    """
    ws = find_workspace()
    if not ws:
        return error(
            "NO_WORKSPACE",
            "Could not find workspace root",
            suggestion="Run from within a Git repository",
        )

    changelog = ws / "CHANGELOG.md"
    if not changelog.exists():
        return success(
            data={"has_changelog": False, "needs_update": False, "changeset_count": 0},
            reasoning="No CHANGELOG.md found - skipping check",
        )

    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=ws,
        capture_output=True,
        text=True,
    )

    staged_files = result.stdout.strip().splitlines() if result.returncode == 0 else []

    src_staged = any(f.startswith("src/") and f.endswith(".py") for f in staged_files)
    changelog_staged = "CHANGELOG.md" in staged_files

    # Count pending changeset files
    changeset_dir = ws / ".changeset"
    changeset_count = 0
    if changeset_dir.exists():
        changeset_count = len([
            f for f in changeset_dir.glob("*.md")
            if f.name.lower() != "readme.md"
        ])

    if src_staged and not changelog_staged:
        if changeset_count > 0:
            return success(
                data={
                    "has_changelog": True,
                    "needs_update": False,
                    "changeset_count": changeset_count,
                    "staged_src_files": [f for f in staged_files if f.startswith("src/")],
                },
                reasoning=f"{changeset_count} changeset(s) pending — changelog "
                "will be updated at release time",
            )
        return success(
            data={
                "has_changelog": True,
                "needs_update": True,
                "changeset_count": 0,
                "staged_src_files": [f for f in staged_files if f.startswith("src/")],
            },
            reasoning="Source files staged but no CHANGELOG.md update "
            "and no changeset files found. Create a changeset with "
            "changeset_create() or update CHANGELOG.md manually.",
            suggestions=["Run changeset_create to record this change"],
        )

    return success(
        data={
            "has_changelog": True,
            "needs_update": False,
            "changeset_count": changeset_count,
        },
        reasoning="CHANGELOG.md is up to date or no source changes",
    )


async def docs_check_agents() -> CommandResult[dict]:
    """Check if AGENTS.md needs updating based on structural changes."""
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

    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        cwd=ws,
        capture_output=True,
        text=True,
    )

    staged_files = result.stdout.strip().splitlines() if result.returncode == 0 else []

    structural_changes = []
    for f in staged_files:
        if "/commands/" in f and f.endswith(".py"):
            structural_changes.append(f"New command: {f}")
        if f.endswith("__init__.py") and f.startswith("src/"):
            structural_changes.append(f"New package: {f}")

    agents_staged = "AGENTS.md" in staged_files

    if structural_changes and not agents_staged:
        changes_summary = ", ".join(structural_changes[:3])
        return success(
            data={
                "has_agents_md": True,
                "needs_update": True,
                "structural_changes": structural_changes,
            },
            reasoning=f"Structural changes but AGENTS.md not updated: {changes_summary}",
            suggestions=["Update AGENTS.md to reflect structural changes"],
        )

    return success(
        data={"has_agents_md": True, "needs_update": False},
        reasoning="AGENTS.md is up to date or no structural changes",
    )


async def docs_preflight() -> CommandResult[dict]:
    """Run docs release-readiness checks via an AFD DirectClient pipeline."""
    client = get_client(source="docs_preflight")
    pipeline = await client.pipe([
        {"command": "docs_check_changelog", "input": {}, "as": "changelog"},
        {"command": "docs_check_agents", "input": {}, "as": "agents"},
    ])

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
        suggestions.append("Run changeset_create to record the staged source changes")
    if agents.get("needs_update"):
        suggestions.append("Update AGENTS.md to reflect the staged structural changes")

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
