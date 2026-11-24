"""`disk-report --unclassified`: ignored paths no [disk] pattern or declared copy covers."""

from __future__ import annotations

import os
import re
import stat
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.scan import compile_pattern, is_link
from botcore.config import DiskConfig

LIMIT = 50
WALK_SECONDS = 60.0
WALK_ENTRIES = 500_000


@dataclass
class UnclassifiedScan:
    """Result of scanning one worktree for unclassified ignored paths."""

    paths: list[str]
    omitted: int = 0
    incomplete: bool = False

    @property
    def truncated(self) -> bool:
        return self.omitted > 0


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
) -> tuple[bool, bool]:
    """Return `(uncovered, incomplete)` for a collapsed ignored folder.

    Fails safe (`uncovered=True`) on symlinks/junctions, nested git checkouts, unreadable or empty
    uncovered folders, or walks that exceed the time or entry bound (`incomplete=True`).
    """
    if _is_path_link(folder):
        return True, False
    seen = 0
    stack = [(folder, rel.rstrip("/"))]
    while stack:
        current, here = stack.pop()
        if time.monotonic() > deadline or seen >= WALK_ENTRIES:
            return True, True
        try:
            it = os.scandir(current)
        except OSError:
            return True, False
        empty = True
        with it:
            try:
                for entry in it:
                    empty = False
                    seen += 1
                    if seen > WALK_ENTRIES or time.monotonic() > deadline:
                        return True, True
                    if entry.name == ".git":
                        return True, False
                    if is_link(entry):
                        return True, False
                    child = f"{here}/{entry.name}"
                    if any(p.match(child) for p in patterns):
                        continue
                    if not entry.is_dir(follow_symlinks=False):
                        return True, False
                    stack.append((Path(entry.path), child))
            except OSError:
                return True, False
        if empty:
            return True, False
    return False, False


def scan_unclassified(
    worktree: Path,
    config: DiskConfig,
    deadline: float | None = None,
    limit: int | None = None,
) -> UnclassifiedScan:
    """Ignored files and folders in worktree that the repository's [disk] does not name.

    Each uncovered ignored folder is collapsed to one entry (so a self-ignoring cache folder
    like `.pytest_cache/` does not also list its `.gitignore`, `CACHEDIR.TAG` and subfolders).
    When more than `limit` entries remain, `paths` holds the first `limit` and `omitted` counts
    what was left out (`truncated` is True).
    """
    cap = LIMIT if limit is None else limit
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
    found: list[str] = []
    collapsed: set[str] = set()
    omitted = 0
    incomplete = False
    for entry in out.split("\0"):
        if time.monotonic() > walk_deadline:
            incomplete = True
            break
        rel = entry.rstrip("/")
        if not rel:
            continue
        parts = rel.split("/")
        prefixes = ["/".join(parts[: i + 1]) for i in range(len(parts))]
        # Collapse children of an already-emitted ignored folder (e.g. `.pytest_cache/`).
        if any(prefix in collapsed for prefix in prefixes[:-1]):
            continue
        if any(p.match(prefix) for p in patterns for prefix in prefixes):
            continue
        if entry.endswith("/"):
            has_uncovered, walk_incomplete = _has_uncovered_child(
                worktree / rel,
                entry,
                patterns,
                walk_deadline,
            )
            if walk_incomplete:
                incomplete = True
            if not has_uncovered:
                continue
            collapsed.add(rel)
        if len(found) < cap:
            found.append(entry)
        else:
            omitted += 1
    return UnclassifiedScan(paths=found, omitted=omitted, incomplete=incomplete)


def unclassified_paths(
    worktree: Path,
    config: DiskConfig,
    deadline: float | None = None,
) -> list[str]:
    """Ignored files and folders in worktree that the repository's [disk] does not name."""
    return scan_unclassified(worktree, config, deadline=deadline).paths


def add_unclassified(
    pairs: list[tuple[dict[str, Any], DiskConfig | None]], deadline: float
) -> bool:
    """Add an `unclassified` list to each present worktree row of each repository.

    Marks truncated lists (`unclassified_truncated`, `unclassified_omitted`) and incomplete
    scans (`unclassified_incomplete`). Returns False when the time or entry budget stopped a scan.
    """
    complete = True
    for repo, config in pairs:
        if config is None:
            continue
        for row in repo.get("worktrees", []):
            if not row.get("exists"):
                continue
            if time.monotonic() > deadline:
                row["unclassified_incomplete"] = True
                complete = False
                continue
            try:
                scan = scan_unclassified(
                    Path(row["path"]),
                    config,
                    deadline=deadline,
                )
            except GitError as exc:
                row["unclassified_error"] = str(exc)
                continue
            row["unclassified"] = scan.paths
            if scan.truncated:
                row["unclassified_truncated"] = True
                row["unclassified_omitted"] = scan.omitted
            if scan.incomplete:
                row["unclassified_incomplete"] = True
                complete = False
    return complete


def format_unclassified_summary(data: dict[str, Any]) -> str:
    """Plain-text summary of unclassified ignored paths grouped across each repo's worktrees,
    followed by worktrees whose scan was incomplete (lushly-dev/afd#1955)."""
    sections: list[str] = []
    for repo in data.get("repos", []):
        name = repo.get("main") or repo.get("checkout") or "(unknown repository)"
        lines: list[str] = []
        if repo.get("error"):
            lines.append(f"{name}: error: {repo['error']}")
            sections.append("\n".join(lines))
            continue
        worktrees = repo.get("worktrees", [])
        present = [row for row in worktrees if row.get("exists")]
        scanned = [row for row in present if "unclassified" in row]
        lines.append(f"{name} ({len(scanned)} of {len(present)} worktrees scanned):")
        if repo.get("blocked"):
            lines.append(f"  Blocked: {repo['blocked']}")
        counts: Counter[str] = Counter()
        incomplete: list[str] = []
        for row in present:
            path = row.get("path", "")
            for entry in dict.fromkeys(row.get("unclassified") or []):
                counts[entry] += 1
            reasons: list[str] = []
            if row.get("unclassified_truncated"):
                omitted = row.get("unclassified_omitted")
                reasons.append(f"truncated ({omitted} omitted)" if omitted else "truncated")
            if row.get("unclassified_incomplete"):
                reasons.append("scan budget spent")
            if row.get("unclassified_error"):
                reasons.append(f"error: {row['unclassified_error']}")
            elif "unclassified" not in row and not reasons:
                reasons.append("not scanned")
            if reasons:
                incomplete.append(f"  {path}: {'; '.join(reasons)}")
        if counts:
            width = len(str(max(counts.values())))
            for entry, count in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0])):
                label = "worktree " if count == 1 else "worktrees"
                lines.append(f"  {count:>{width}} {label}  {entry}")
        elif not incomplete and not repo.get("blocked"):
            lines.append("  No unclassified ignored paths.")
        if incomplete:
            lines.append("  Incomplete scans:")
            lines.extend(f"  {item}" for item in incomplete)
        sections.append("\n".join(lines))
    if not sections:
        return "No repositories reported."
    return "\n\n".join(sections)
