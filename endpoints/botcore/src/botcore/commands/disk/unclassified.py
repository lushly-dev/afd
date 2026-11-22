"""`disk-report --unclassified`: ignored paths no [disk] pattern or declared copy covers."""

from __future__ import annotations

import os
import re
import stat
import time
from pathlib import Path

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.scan import compile_pattern, is_link
from botcore.config import DiskConfig

LIMIT = 50
WALK_SECONDS = 60.0
WALK_ENTRIES = 500_000


def _is_path_link(path: Path) -> bool:
    """True for symlinks, Windows reparse points (junctions), or unreadable paths."""
    try:
        info = path.lstat()
    except OSError:
        return True
    if stat.S_ISLNK(info.st_mode):
        return True
    if os.name == "nt":
        attrs = getattr(info, "st_file_attributes", 0)
        return bool(attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    return False


def _has_uncovered_child(  # noqa: C901, PLR0912
    folder: Path,
    rel: str,
    patterns: list[re.Pattern[str]],
    deadline: float,
) -> bool:
    """Whether a collapsed ignored folder holds any child no [disk] pattern covers.

    Fails safe (returns True) on symlinks/junctions, nested git checkouts, unreadable or empty
    uncovered folders, or walks that exceed the time or entry bound.
    """
    if _is_path_link(folder):
        return True
    seen = 0
    stack = [(folder, rel.rstrip("/"))]
    while stack:
        current, here = stack.pop()
        if time.monotonic() > deadline or seen >= WALK_ENTRIES:
            return True
        try:
            it = os.scandir(current)
        except OSError:
            return True
        empty = True
        with it:
            try:
                for entry in it:
                    empty = False
                    seen += 1
                    if seen > WALK_ENTRIES or time.monotonic() > deadline:
                        return True
                    if entry.name == ".git":
                        return True
                    if is_link(entry):
                        return True
                    child = f"{here}/{entry.name}"
                    if any(p.match(child) for p in patterns):
                        continue
                    if not entry.is_dir(follow_symlinks=False):
                        return True
                    stack.append((Path(entry.path), child))
            except OSError:
                return True
        if empty:
            return True
    return False


def unclassified_paths(
    worktree: Path,
    config: DiskConfig,
    deadline: float | None = None,
) -> list[str]:
    """Ignored files and folders in worktree that the repository's [disk] does not name."""
    out = git_out(
        worktree,
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "-z",
    )
    patterns = [compile_pattern(e.path) for e in config.entries()]
    patterns += [compile_pattern(c) for c in config.copies]
    walk_deadline = time.monotonic() + WALK_SECONDS if deadline is None else deadline
    found = []
    for entry in out.split("\0"):
        rel = entry.rstrip("/")
        if not rel:
            continue
        parts = rel.split("/")
        prefixes = ["/".join(parts[: i + 1]) for i in range(len(parts))]
        if any(p.match(prefix) for p in patterns for prefix in prefixes):
            continue
        if entry.endswith("/") and not _has_uncovered_child(
            worktree / rel,
            entry,
            patterns,
            walk_deadline,
        ):
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
                row["unclassified"] = unclassified_paths(
                    Path(row["path"]),
                    config,
                    deadline=deadline,
                )
            except GitError as exc:
                row["unclassified_error"] = str(exc)
