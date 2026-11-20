"""`disk-report --unclassified`: ignored paths no [disk] pattern or declared copy covers."""

from __future__ import annotations

import time
from pathlib import Path

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.scan import compile_pattern
from botcore.config import DiskConfig

LIMIT = 50


def unclassified_paths(worktree: Path, config: DiskConfig) -> list[str]:
    """Ignored files and folders in worktree that the repository's [disk] does not name."""
    out = git_out(
        worktree, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z",
    )
    patterns = [compile_pattern(e.path) for e in config.entries()]
    patterns += [compile_pattern(c) for c in config.copies]
    found = []
    for entry in out.split("\0"):
        rel = entry.rstrip("/")
        if not rel:
            continue
        parts = rel.split("/")
        prefixes = ["/".join(parts[: i + 1]) for i in range(len(parts))]
        if any(p.match(prefix) for p in patterns for prefix in prefixes):
            continue
        found.append(entry)
        if len(found) >= LIMIT:
            break
    return found


def add_unclassified(pairs: list[tuple[dict, DiskConfig | None]], deadline: float) -> None:
    """Add an `unclassified` list to each present worktree row of each repository."""
    for repo, config in pairs:
        if config is None:
            continue
        for row in repo.get("worktrees", []):
            if not row.get("exists") or time.monotonic() > deadline:
                continue
            try:
                row["unclassified"] = unclassified_paths(Path(row["path"]), config)
            except GitError as exc:
                row["unclassified_error"] = str(exc)
