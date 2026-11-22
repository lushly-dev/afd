"""Tier 2's two questions about a worktree: does anything unique live in it, and has it landed?

Removing a worktree with `git worktree remove` keeps its branch and commits but deletes the
folder and git's per-worktree records, so "unique" means anything removal would lose:

- uncommitted or untracked work, including edits hidden with `skip-worktree` or
  `assume-unchanged` (git status does not show those);
- an operation in progress; a commit on no branch or remote; per-worktree refs
  (`refs/worktree/*`, `refs/bisect/*`); its own git config or sparse-checkout rules;
- an ignored file that is neither rebuildable nor an unchanged copy of the main checkout's,
  and anything a rebuildable folder hides: a nested checkout, or a declared copy inside it.

Commits only the worktree's HEAD reflog reaches are not unique: removal pins them under
`refs/botcore/removed/` first. "Landed" means the commit is an ancestor of the landing ref,
every path any of the branch's commits touched matches it, or its pull request merged with
exactly this commit. Anything that cannot be read counts as unique or not landed.
"""

from __future__ import annotations

import filecmp
import json
import os
import re
import shutil
import stat
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from botcore.commands.disk.git import GitError, git_out, path_key
from botcore.commands.disk.scan import compile_pattern, is_link
from botcore.commands.disk.steps import command, doing, each
from botcore.config import DiskConfig

KEEP_MARK = "botcore-keep until="
MAX_IGNORED = 5000
MAX_FLAGGED = 10000
MAX_PATHS = 2000
WALK_SECONDS = 60.0
WALK_ENTRIES = 500_000
# Package-manager and Cargo trees hold only what an install or build wrote
OPAQUE = {"node_modules", ".venv", "venv", "__pycache__"}


@dataclass
class Finished:
    """The verdict on one worktree."""

    unique: list[str] = field(default_factory=list)
    landed: str | None = None  # how it landed, or None

    @property
    def restorable(self) -> bool:
        return not self.unique


# ── Git state removal would lose ────────────────────────────────────────────


def _on_a_ref(worktree: Path, head: str, timeout: float) -> bool:
    out = git_out(
        worktree,
        "for-each-ref",
        "--count=1",
        "--contains",
        head,
        "refs/heads",
        "refs/remotes",
        "refs/tags",
        timeout=timeout,
    )
    return bool(out.strip())


def _hidden_changes(worktree: Path, timeout: float) -> str | None:
    """A tracked file edited behind `skip-worktree` or `assume-unchanged`, or None."""
    sparse = (
        git_out(
            worktree,
            "config",
            "--type=bool",
            "--default=false",
            "core.sparseCheckout",
            timeout=timeout,
        ).strip()
        == "true"
    )
    out = git_out(worktree, "ls-files", "-s", "-v", "-z", timeout=timeout)
    flagged: list[tuple[str, str, str]] = []  # (tag, object id, path)
    for record in out.split("\0"):
        if not record or "\t" not in record:
            continue
        meta, path = record.split("\t", 1)
        parts = meta.split()
        if len(parts) < 4:
            continue
        tag, mode, oid = parts[0], parts[1], parts[2]
        if mode == "160000" or not (tag == "S" or tag.islower()):
            continue
        flagged.append((tag, oid, path))
        if len(flagged) > MAX_FLAGGED:
            return "too many hidden tracked files to check"
    on_disk = []
    for tag, oid, path in flagged:
        full = worktree / path
        try:
            info = os.lstat(full)
        except FileNotFoundError:
            if tag == "S" and sparse:
                continue  # outside the sparse checkout: absent on purpose
            return f"a hidden tracked file is missing: {path}"
        if not stat.S_ISREG(info.st_mode):
            return f"a hidden tracked path is not a plain file: {path}"
        on_disk.append((oid, path))
    if not on_disk:
        return None
    hashes = git_out(
        worktree,
        "hash-object",
        "--stdin-paths",
        stdin="\n".join(p for _, p in on_disk) + "\n",
        timeout=timeout,
    ).split()
    for (oid, path), now in zip(on_disk, hashes, strict=False):
        if now != oid:
            return f"a tracked file edited behind skip-worktree or assume-unchanged: {path}"
    if len(hashes) != len(on_disk):
        return "hidden tracked files could not all be checked"
    return None


def _private_state(worktree: Path, admin: Path | None, timeout: float) -> str | None:
    """Per-worktree git state removal would delete and restore could not bring back."""
    if admin is None:
        return "git's record of the worktree is unknown"
    refs = git_out(
        worktree,
        "for-each-ref",
        "--format=%(refname)",
        "refs/worktree",
        "refs/bisect",
        timeout=timeout,
    ).split()
    if refs:
        return f"per-worktree refs: {refs[0]}"
    try:
        reflog_only_commits(worktree, timeout)
    except ReflogTooLong as exc:
        return f"{exc}, more than removal pins"
    for name, what in (
        ("config.worktree", "its own git config"),
        ("info/sparse-checkout", "its own sparse-checkout rules"),
    ):
        try:
            if (admin / name).stat().st_size > 0:
                return what
        except FileNotFoundError:
            continue
        except OSError:
            return f"{what} cannot be read"
    return None


REFLOG_LIMIT = 2000


class ReflogTooLong(Exception):
    """The worktree's reflog is longer than removal can pin."""


def reflog_only_commits(worktree: Path, timeout: float, limit: int | None = None) -> list[str]:
    """Commits the worktree's HEAD reflog reaches that no branch, remote or tag does.

    Raises ReflogTooLong past `limit` entries: commits older than what was read could be lost.
    """
    limit = REFLOG_LIMIT if limit is None else limit
    try:
        logged = git_out(worktree, "log", "-g", "--format=%H", "HEAD", timeout=timeout).split()
    except GitError:
        return []
    if not logged:
        return []
    wanted = list(dict.fromkeys(logged))
    out = git_out(
        worktree,
        "rev-list",
        "--stdin",
        "--not",
        "--branches",
        "--remotes",
        "--tags",
        stdin="\n".join(wanted) + "\n",
        timeout=timeout,
    )
    unreachable = set(out.split())
    tips = [commit for commit in wanted if commit in unreachable]
    if len(tips) > limit:
        raise ReflogTooLong(f"its reflog holds more than {limit} commits on no branch")
    return tips


# ── Ignored files ───────────────────────────────────────────────────────────


def _ignored_paths(worktree: Path, timeout: float) -> list[str]:
    out = git_out(
        worktree,
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "-z",
        timeout=timeout,
    )
    return [entry for entry in out.split("\0") if entry]


def _rebuildable(rel: str, config: DiskConfig) -> bool:
    """Whether an ignored path is, or lies inside, something a [disk] pattern names."""
    parts = rel.rstrip("/").split("/")
    prefixes = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    patterns = [compile_pattern(e.path) for e in config.entries()]
    return any(p.match(prefix) for p in patterns for prefix in prefixes)


def _is_copy(rel: str, config: DiskConfig) -> bool:
    return any(compile_pattern(c).match(rel) for c in config.copies)


def _unchanged_copy(rel: str, worktree: Path, main: Path) -> bool:
    """A plain file identical to a plain file at the same path in the main checkout.

    Links are not followed: a link in either place, or a main-checkout file that is really
    inside this worktree, does not count as a surviving copy.
    """
    ours, theirs = worktree / rel, main / rel
    try:
        a, b = os.lstat(ours), os.lstat(theirs)
    except OSError:
        return False
    if not (stat.S_ISREG(a.st_mode) and stat.S_ISREG(b.st_mode)):
        return False
    if path_key(theirs).startswith(path_key(worktree).rstrip(os.sep) + os.sep):
        return False
    try:
        return filecmp.cmp(ours, theirs, shallow=False)
    except OSError:
        return False


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


def _matches_any(rel: str, patterns: list[re.Pattern[str]]) -> bool:
    parts = rel.rstrip("/").split("/")
    prefixes = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    return any(p.match(prefix) for p in patterns for prefix in prefixes)


def _inside_rebuildable(  # noqa: C901, PLR0912, PLR0913
    folder: Path,
    rel: str,
    worktree: Path,
    main: Path,
    config: DiskConfig,
    checkouts: list[str],
    deadline: float,
    copy_patterns: list[re.Pattern[str]] | None = None,
    budget: list[int] | None = None,
) -> str | None:
    """What a rebuildable folder hides that removal would lose: a checkout or a changed copy."""
    if _is_path_link(folder):
        return f"an ignored file that may be unique: {rel}"
    root_key = path_key(folder).rstrip(os.sep) + os.sep
    for other in checkouts:
        if other.startswith(root_key):
            return f"a registered checkout inside {rel}"
    copies = [compile_pattern(c) for c in config.copies] if copy_patterns is None else copy_patterns
    seen = [0] if budget is None else budget
    stack = [(folder, rel.rstrip("/"))]
    while stack:
        current, here = stack.pop()
        if time.monotonic() > deadline or seen[0] >= WALK_ENTRIES:
            return f"{rel} is too large to check in time"
        doing("reading", current)
        try:
            it = os.scandir(current)
        except OSError:
            return f"{here} cannot be read"
        pending_dirs: list[tuple[Path, str]] = []
        pending_files: list[str] = []
        cachedir = False
        with it:
            try:
                for entry in each("reading", current, it):
                    seen[0] += 1
                    if seen[0] > WALK_ENTRIES or time.monotonic() > deadline:
                        return f"{rel} is too large to check in time"
                    if entry.name == ".git":
                        return f"a git checkout inside {here}"
                    if entry.name == "CACHEDIR.TAG":
                        cachedir = True
                        continue
                    if is_link(entry):
                        continue
                    child = f"{here}/{entry.name}"
                    if entry.is_dir(follow_symlinks=False):
                        if entry.name not in OPAQUE:
                            pending_dirs.append((Path(entry.path), child))
                    else:
                        pending_files.append(child)
            except OSError:
                return f"{here} cannot be read"
        if cachedir:
            continue  # a Cargo target: build output only
        for child in pending_files:
            if any(p.match(child) for p in copies) and not _unchanged_copy(child, worktree, main):
                return f"a changed declared copy: {child}"
        stack.extend(pending_dirs)
    return None


def _inside_collapsed_ignored(  # noqa: PLR0911, PLR0912, PLR0913, C901
    folder: Path,
    rel: str,
    worktree: Path,
    main: Path,
    config: DiskConfig,
    checkouts: list[str],
    deadline: float,
    checked_rebuildable: set[str],
    rebuild_patterns: list[re.Pattern[str]],
    copy_patterns: list[re.Pattern[str]],
) -> str | None:
    """Judge a collapsed ignored folder whose own path matches no [disk] pattern.

    Git reports a directory containing only ignored entries as a single ``dir/`` entry. Walk it
    boundedly and accept it only when every child is covered by a rebuildable pattern (with its
    own safety checks) or is an unchanged declared copy.
    """
    if _is_path_link(folder):
        return f"an ignored file that may be unique: {rel}"
    root_key = path_key(folder).rstrip(os.sep) + os.sep
    for other in checkouts:
        if other.startswith(root_key):
            return f"a registered checkout inside {rel}"
    seen = [0]
    stack = [(folder, rel.rstrip("/"))]
    while stack:
        current, here = stack.pop()
        if time.monotonic() > deadline or seen[0] >= WALK_ENTRIES:
            return f"{rel} is too large to check in time"
        doing("reading", current)
        try:
            it = os.scandir(current)
        except OSError:
            return f"{here} cannot be read"
        empty = True
        with it:
            try:
                for entry in each("reading", current, it):
                    empty = False
                    seen[0] += 1
                    if seen[0] > WALK_ENTRIES or time.monotonic() > deadline:
                        return f"{rel} is too large to check in time"
                    if entry.name == ".git":
                        return f"a git checkout inside {here}"
                    child = f"{here}/{entry.name}"
                    if is_link(entry):
                        return f"an ignored file that may be unique: {child}"
                    if entry.is_dir(follow_symlinks=False):
                        if _matches_any(child, rebuild_patterns):
                            if child not in checked_rebuildable:
                                checked_rebuildable.add(child)
                                hidden = _inside_rebuildable(
                                    Path(entry.path),
                                    f"{child}/",
                                    worktree,
                                    main,
                                    config,
                                    checkouts,
                                    deadline,
                                    copy_patterns=copy_patterns,
                                    budget=seen,
                                )
                                if hidden:
                                    return hidden
                            continue
                        stack.append((Path(entry.path), child))
                    elif any(p.match(child) for p in copy_patterns):
                        if not _unchanged_copy(child, worktree, main):
                            return f"a changed declared copy: {child}"
                    elif not _matches_any(child, rebuild_patterns):
                        return f"an ignored file that may be unique: {child}"
            except OSError:
                return f"{here} cannot be read"
        if empty:
            return f"an ignored file that may be unique: {here}/"
    return None


def _ignored_reason(
    worktree: Path,
    main: Path,
    config: DiskConfig,
    checkouts: list[str],
    timeout: float,
) -> str | None:
    ignored = _ignored_paths(worktree, timeout)
    if len(ignored) > MAX_IGNORED:
        return "too many ignored paths to check"
    deadline = time.monotonic() + WALK_SECONDS
    rebuild_patterns = [compile_pattern(e.path) for e in config.entries()]
    copy_patterns = [compile_pattern(c) for c in config.copies]
    checked_rebuildable: set[str] = set()
    for rel in ignored:
        name = rel.rstrip("/")
        if any(p.match(name) for p in copy_patterns) and not rel.endswith("/"):
            if _unchanged_copy(name, worktree, main):
                continue
            return f"a changed declared copy: {name}"
        if not _matches_any(rel, rebuild_patterns):
            if rel.endswith("/"):
                reason = _inside_collapsed_ignored(
                    worktree / name,
                    rel,
                    worktree,
                    main,
                    config,
                    checkouts,
                    deadline,
                    checked_rebuildable,
                    rebuild_patterns,
                    copy_patterns,
                )
                if reason:
                    return reason
                continue
            return f"an ignored file that may be unique: {rel}"
        if rel.endswith("/") and name not in checked_rebuildable:
            checked_rebuildable.add(name)
            hidden = _inside_rebuildable(
                worktree / name,
                rel,
                worktree,
                main,
                config,
                checkouts,
                deadline,
                copy_patterns=copy_patterns,
            )
            if hidden:
                return hidden
    return None


def unique_reasons(  # noqa: PLR0913 - every fact is one more way to lose work
    worktree: Path,
    main: Path,
    admin: Path | None,
    head: str | None,
    changed: list[str],
    operation: str | None,
    config: DiskConfig,
    timeout: float,
    checkouts: list[str] | None = None,
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
            reasons.append("its commit is on no branch, remote or tag")
        for check in (
            lambda: _hidden_changes(worktree, timeout),
            lambda: _private_state(worktree, admin, timeout),
            lambda: _ignored_reason(worktree, main, config, checkouts or [], timeout),
        ):
            reason = check()
            if reason:
                reasons.append(reason)
                break
    except GitError as exc:
        reasons.append(f"git could not answer: {exc}")
    return reasons


# ── Landing ─────────────────────────────────────────────────────────────────


def _literal(worktree: Path, *args: str, timeout: float) -> str:
    return git_out(worktree, "--literal-pathspecs", *args, timeout=timeout)


def _merged_pr(worktree: Path, branch: str | None, head: str) -> bool:
    """Whether a pull request from this branch merged with exactly this commit (needs gh)."""
    gh = shutil.which("gh")
    if not gh or not branch:
        return False
    try:
        with command("asking gh about", worktree, allow=30):
            done = subprocess.run(
                [
                    gh,
                    "pr",
                    "list",
                    "--state",
                    "merged",
                    "--head",
                    branch,
                    "--limit",
                    "20",
                    "--json",
                    "headRefOid",
                ],
                cwd=worktree,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
                env={**os.environ, "GH_PROMPT_DISABLED": "1"},
            )
        pulls = json.loads(done.stdout) if done.returncode == 0 else []
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return False
    return any(isinstance(p, dict) and p.get("headRefOid") == head for p in pulls)


def landed_how(
    worktree: Path,
    head: str | None,
    landing_ref: str,
    timeout: float,
    branch: str | None = None,
) -> str | None:
    """How the worktree's work reached the landing ref, or None when it has not (or unclear)."""
    if not head:
        return None
    try:
        git_out(
            worktree,
            "rev-parse",
            "--verify",
            "--quiet",
            f"{landing_ref}^{{commit}}",
            timeout=timeout,
        )
    except GitError:
        return None
    try:
        git_out(worktree, "merge-base", "--is-ancestor", head, landing_ref, timeout=timeout)
        return f"its commit is in {landing_ref}"
    except GitError:
        pass
    if _paths_match(worktree, head, landing_ref, timeout):
        return f"every path its commits touched matches {landing_ref}"
    if _merged_pr(worktree, branch, head):
        return "its pull request merged with exactly this commit"
    return None


def _paths_match(worktree: Path, head: str, landing_ref: str, timeout: float) -> bool:
    """Every path any commit since the merge base touched, both sides of renames, reverted
    ones included, is identical in the landing ref."""
    try:
        base = git_out(worktree, "merge-base", head, landing_ref, timeout=timeout).strip()
        touched = _literal(
            worktree,
            "log",
            "--format=",
            "--name-only",
            "--no-renames",
            "--cc",
            "-z",
            f"{base}..{head}",
            timeout=timeout,
        )
        overall = _literal(
            worktree, "diff", "--name-only", "--no-renames", "-z", base, head, timeout=timeout
        )
    except GitError:
        return False
    paths = list(dict.fromkeys(p for p in (touched + "\0" + overall).split("\0") if p.strip()))
    if not paths or len(paths) > MAX_PATHS:
        return False
    try:
        for start in range(0, len(paths), 200):
            _literal(
                worktree,
                "diff",
                "--quiet",
                "--no-renames",
                landing_ref,
                head,
                "--",
                *paths[start : start + 200],
                timeout=timeout,
            )
    except GitError:
        return False
    return True


def judge(  # noqa: PLR0913 - the facts the report already holds
    worktree: Path,
    main: Path,
    admin: Path | None,
    head: str | None,
    branch: str | None,
    changed: list[str],
    operation: str | None,
    config: DiskConfig,
    timeout: float,
    checkouts: list[str] | None = None,
) -> Finished:
    verdict = Finished(
        unique_reasons(worktree, main, admin, head, changed, operation, config, timeout, checkouts)
    )
    if not verdict.unique:
        verdict.landed = landed_how(worktree, head, config.landing_ref, timeout, branch)
    return verdict


# ── Keeps ───────────────────────────────────────────────────────────────────


def keep_reason(until: str, reason: str) -> str:
    """The `git worktree lock` reason disk-keep writes."""
    text = f"{KEEP_MARK}{until}"
    return f"{text}: {reason}" if reason else text


def keep_until(lock_reason: str | None) -> str | None:
    """The date a disk-keep lock lasts until, or None for any other lock."""
    if not lock_reason or not lock_reason.startswith(KEEP_MARK):
        return None
    value = lock_reason[len(KEEP_MARK) :].split(":", 1)[0].strip()
    return value or None


def same_path(a: Path | str, b: Path | str) -> bool:
    return path_key(a) == path_key(b)
