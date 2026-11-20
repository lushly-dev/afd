"""Tier 2's two questions about a worktree: does anything unique live in it, and has it landed?

Removing a worktree with `git worktree remove` keeps its branch and commits, so "unique" means
what removal would lose: uncommitted or untracked work, an operation in progress, a commit on
no branch or remote, or an ignored file that is neither rebuildable nor an unchanged copy of the
main checkout's. "Landed" means the work is already on the landing ref: the commit is an
ancestor of it, or every file the branch changed matches it (the check that survives squash
merges). Both answer cautiously: anything that cannot be read counts as unique or not landed.
"""

from __future__ import annotations

import filecmp
import os
from dataclasses import dataclass, field
from pathlib import Path

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.scan import compile_pattern, is_file
from botcore.config import DiskConfig

KEEP_PREFIX = "botcore-keep"
MAX_IGNORED = 5000


@dataclass
class Finished:
    """The verdict on one worktree."""

    unique: list[str] = field(default_factory=list)
    landed: str | None = None  # how it landed, or None

    @property
    def restorable(self) -> bool:
        return not self.unique


def _on_a_ref(worktree: Path, head: str, timeout: float) -> bool:
    out = git_out(worktree, "for-each-ref", "--count=1", "--contains", head,
                  "refs/heads", "refs/remotes", timeout=timeout)
    return bool(out.strip())


def _ignored_paths(worktree: Path, timeout: float) -> list[str]:
    out = git_out(worktree, "ls-files", "--others", "--ignored", "--exclude-standard",
                  "--directory", "-z", timeout=timeout)
    return [entry for entry in out.split("\0") if entry]


def _rebuildable(rel: str, config: DiskConfig) -> bool:
    """Whether an ignored path is, or lies inside, something a [disk] pattern names."""
    parts = rel.rstrip("/").split("/")
    prefixes = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    patterns = [compile_pattern(e.path) for e in config.entries()]
    return any(p.match(prefix) for p in patterns for prefix in prefixes)


def _unchanged_copy(rel: str, worktree: Path, main: Path, config: DiskConfig) -> bool:
    """A declared copy (a file) identical to the same file in the main checkout."""
    name = rel.rstrip("/")
    if rel.endswith("/") or not any(compile_pattern(c).match(name) for c in config.copies):
        return False
    ours, theirs = worktree / name, main / name
    if not (is_file(ours) and is_file(theirs)):
        return False
    try:
        return filecmp.cmp(ours, theirs, shallow=False)
    except OSError:
        return False


def unique_reasons(
    worktree: Path, main: Path, head: str | None, changed: list[str], operation: str | None,
    config: DiskConfig, timeout: float,
) -> list[str]:
    """Why removing this worktree could lose something; empty when nothing would be lost."""
    reasons = []
    if changed:
        reasons.append(f"{len(changed)} uncommitted or untracked file(s)")
    if operation:
        reasons.append(f"a {operation} is in progress")
    if not head:
        return reasons + ["its commit is unknown"]
    try:
        if not _on_a_ref(worktree, head, timeout):
            reasons.append("its commit is on no branch or remote")
        ignored = _ignored_paths(worktree, timeout)
    except GitError as exc:
        return reasons + [f"git could not answer: {exc}"]
    if len(ignored) > MAX_IGNORED:
        return reasons + ["too many ignored paths to check"]
    for rel in ignored:
        if _rebuildable(rel, config) or _unchanged_copy(rel, worktree, main, config):
            continue
        reasons.append(f"an ignored file that may be unique: {rel}")
        break
    return reasons


def landed_how(worktree: Path, head: str | None, landing_ref: str, timeout: float) -> str | None:
    """How the worktree's work reached the landing ref, or None when it has not (or unclear)."""
    if not head:
        return None
    try:
        git_out(worktree, "rev-parse", "--verify", "--quiet", f"{landing_ref}^{{commit}}",
                timeout=timeout)
    except GitError:
        return None
    try:
        git_out(worktree, "merge-base", "--is-ancestor", head, landing_ref, timeout=timeout)
        return f"its commit is in {landing_ref}"
    except GitError:
        pass
    try:
        base = git_out(worktree, "merge-base", head, landing_ref, timeout=timeout).strip()
        files = [f for f in git_out(worktree, "diff", "--name-only", "-z", base, head,
                                    timeout=timeout).split("\0") if f]
        if not files:
            return None
        git_out(worktree, "diff", "--quiet", landing_ref, head, "--", *files[:500],
                timeout=timeout)
    except GitError:
        return None
    if len(files) > 500:
        return None
    return f"every file it changed matches {landing_ref}"


def judge(
    worktree: Path, main: Path, head: str | None, changed: list[str], operation: str | None,
    config: DiskConfig, timeout: float,
) -> Finished:
    verdict = Finished(unique_reasons(worktree, main, head, changed, operation, config, timeout))
    if not verdict.unique:
        verdict.landed = landed_how(worktree, head, config.landing_ref, timeout)
    return verdict


def keep_reason(until: str, reason: str) -> str:
    """The `git worktree lock` reason disk-keep writes."""
    text = f"{KEEP_PREFIX} until={until}"
    return f"{text}: {reason}" if reason else text


def keep_until(lock_reason: str | None) -> str | None:
    """The date a disk-keep lock lasts until, or None for any other lock."""
    if not lock_reason or not lock_reason.startswith(KEEP_PREFIX + " until="):
        return None
    value = lock_reason[len(KEEP_PREFIX) + len(" until="):].split(":", 1)[0].strip()
    return value or None


def same_path(a: Path | str, b: Path | str) -> bool:
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


__all__ = [
    "Finished",
    "judge",
    "keep_reason",
    "keep_until",
    "landed_how",
    "same_path",
    "unique_reasons",
]
