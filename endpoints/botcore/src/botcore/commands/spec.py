"""Botcore spec commands — specification lifecycle management."""

from __future__ import annotations

from pathlib import Path

from afd import CommandResult, error, success

from botcore.utils.workspace import find_workspace

PROPOSAL_TEMPLATE = """---
title: {title}
status: Draft
created: TBD
---

# {title}

## Problem Statement

<!-- What problem does this solve? -->

## Proposed Solution

<!-- High-level approach -->

## Success Criteria

<!-- How do we know this is done? -->

## Open Questions

<!-- Unresolved issues to discuss -->
"""

SPEC_TEMPLATE = """---
title: {title}
status: Draft
created: TBD
proposal: {proposal_path}
---

# {title}

## Overview

<!-- Technical summary -->

## Implementation Plan

<!-- Detailed steps -->

## API Changes

<!-- If applicable -->

## Testing Strategy

<!-- How to verify -->
"""


async def spec_create(path: str, template: str = "proposal") -> CommandResult[dict]:
    """Create a new spec from template.

    Args:
        path: Path like 'docs/features/my-feature' or a full file path
        template: 'proposal' or 'spec'
    """
    if template not in ["proposal", "spec"]:
        return error(
            "INVALID_TEMPLATE",
            f"Invalid template: {template}",
            suggestion="Use template='proposal' or template='spec'",
        )

    spec_path = Path(path)

    # If relative and no extension, add .md
    if not spec_path.is_absolute() and not spec_path.suffix:
        spec_path = spec_path.with_suffix(".md")

    # Resolve relative to workspace
    if not spec_path.is_absolute():
        ws = find_workspace()
        if ws:
            spec_path = ws / spec_path

    if spec_path.exists():
        return error(
            "FILE_EXISTS",
            f"File already exists: {spec_path}",
            suggestion="Use a different path or edit existing file",
        )

    title = spec_path.stem.replace("-", " ").replace("_", " ").title()

    if template == "proposal":
        content = PROPOSAL_TEMPLATE.format(title=title)
    else:
        proposal_path = str(spec_path.parent / "proposal.md")
        content = SPEC_TEMPLATE.format(title=title, proposal_path=proposal_path)

    spec_path.parent.mkdir(parents=True, exist_ok=True)
    spec_path.write_text(content, encoding="utf-8")

    return success(
        data={"path": str(spec_path), "template": template, "title": title},
        reasoning=f"Created {template} at {spec_path}",
        undo_command="spec_delete",
        undo_args={"path": str(spec_path)},
    )


async def spec_status(path: str) -> CommandResult[dict]:
    """Get spec status from frontmatter."""
    spec_path = Path(path)

    if not spec_path.exists():
        return error(
            "FILE_NOT_FOUND",
            f"Spec not found: {path}",
            suggestion="Check the path or use spec-create to create a new spec",
        )

    content = spec_path.read_text()

    status = "Unknown"
    if content.startswith("---"):
        end = content.find("---", 3)
        if end > 0:
            frontmatter = content[3:end]
            for line in frontmatter.split("\n"):
                if line.startswith("status:"):
                    status = line.split(":", 1)[1].strip()
                    break

    return success(data={"path": str(spec_path), "status": status})


async def spec_delete(path: str) -> CommandResult[dict]:
    """Delete a spec file created on disk."""
    spec_path = Path(path)

    if not spec_path.is_absolute():
        ws = find_workspace()
        if ws:
            spec_path = ws / spec_path

    if not spec_path.exists():
        return error(
            "FILE_NOT_FOUND",
            f"Spec not found: {path}",
            suggestion="Check the path or use spec_create to create a new spec",
        )

    if spec_path.is_dir():
        return error(
            "NOT_A_FILE",
            f"Expected a spec file but found a directory: {spec_path}",
            suggestion="Pass the path to a specific markdown spec file",
        )

    content = spec_path.read_text(encoding="utf-8")
    spec_path.unlink()

    return success(
        data={"path": str(spec_path), "deleted": True},
        reasoning=f"Deleted spec at {spec_path}",
        undo_command="spec_create",
        undo_args={
            "path": str(spec_path),
            "template": "spec" if "proposal:" in content else "proposal",
        },
    )


async def spec_validate(path: str) -> CommandResult[dict]:
    """Validate spec structure."""
    spec_path = Path(path)

    if not spec_path.exists():
        return error(
            "FILE_NOT_FOUND",
            f"Spec not found: {path}",
            suggestion="Check the path or use spec-create to create a new spec",
        )

    content = spec_path.read_text()
    issues: list[str] = []

    if "---" not in content[:10]:
        issues.append("Missing frontmatter")
    if "## " not in content:
        issues.append("No section headers found")
    if len(content) < 200:
        issues.append("Content seems too short")

    return success(data={"path": str(spec_path), "valid": len(issues) == 0, "issues": issues})
