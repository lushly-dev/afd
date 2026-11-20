"""The git reads the disk-* commands need: worktree lists, admin folders and status."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

GIT_TIMEOUT = 120


class GitError(Exception):
    """A git command failed or could not run."""


def _env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["LC_ALL"] = "C"
    env["GIT_OPTIONAL_LOCKS"] = "0"  # a read must never take the index lock
    return env


def git_out(cwd: Path, *args: str, timeout: float = GIT_TIMEOUT) -> str:
    """Run git in cwd and return stdout; raise GitError on failure."""
    try:
        done = subprocess.run(
            ["git", "-C", str(cwd), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="surrogateescape",
            env=_env(),
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GitError(f"git {' '.join(args)}: {exc}") from exc
    if done.returncode != 0:
        raise GitError(f"git {' '.join(args)}: {done.stderr.strip().splitlines()[:1]}")
    return done.stdout


@dataclass
class Worktree:
    """One entry of `git worktree list --porcelain`."""

    path: Path
    head: str | None = None
    branch: str | None = None
    detached: bool = False
    bare: bool = False
    locked: str | None = None  # the lock reason; "" for a lock without one
    prunable: str | None = None
    is_main: bool = False
    admin: Path | None = None
    extra: dict[str, str] = field(default_factory=dict)


def _apply(entry: Worktree, key: str, value: str) -> None:
    if key == "HEAD":
        entry.head = value
    elif key == "branch":
        entry.branch = value.removeprefix("refs/heads/")
    elif key == "detached":
        entry.detached = True
    elif key == "bare":
        entry.bare = True
    elif key == "locked":
        entry.locked = value
    elif key == "prunable":
        entry.prunable = value
    else:
        entry.extra[key] = value


def parse_worktree_list(text: str) -> list[Worktree]:
    """Parse `git worktree list --porcelain -z` output. The first entry is the main one."""
    entries: list[Worktree] = []
    current: Worktree | None = None
    for record in text.split("\0"):
        if record == "":
            if current is not None:
                entries.append(current)
                current = None
            continue
        key, _, value = record.partition(" ")
        if key == "worktree":
            current = Worktree(path=Path(value))
        elif current is not None:
            _apply(current, key, value)
    if current is not None:
        entries.append(current)
    if entries:
        entries[0].is_main = True
    return entries


def common_dir(path: Path) -> Path:
    """The repository's shared git folder for any of its checkouts."""
    out = git_out(path, "rev-parse", "--path-format=absolute", "--git-common-dir").strip()
    return Path(out)


def _admin_map(common: Path) -> dict[str, Path]:
    """Map each linked worktree's path (as its gitdir file names it) to its admin folder."""
    found: dict[str, Path] = {}
    base = common / "worktrees"
    if not base.is_dir():
        return found
    for admin in base.iterdir():
        gitdir = admin / "gitdir"
        try:
            target = gitdir.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        found[_key(Path(target).parent)] = admin
    return found


def _key(path: Path) -> str:
    text = os.path.normpath(str(path))
    return text.lower() if os.name == "nt" else text


def list_worktrees(checkout: Path) -> tuple[Path, list[Worktree]]:
    """(common git folder, worktrees) for the repository holding checkout."""
    common = common_dir(checkout)
    entries = parse_worktree_list(git_out(checkout, "worktree", "list", "--porcelain", "-z"))
    admins = _admin_map(common)
    for entry in entries:
        entry.admin = common if entry.is_main else admins.get(_key(entry.path))
    return common, entries


@dataclass
class Status:
    """What `git status` says about a worktree."""

    changed: list[str]
    operation: str | None


_OPERATIONS = {
    "rebase-merge": "rebase",
    "rebase-apply": "rebase",
    "MERGE_HEAD": "merge",
    "CHERRY_PICK_HEAD": "cherry-pick",
    "REVERT_HEAD": "revert",
    "BISECT_LOG": "bisect",
}


def status(worktree: Path, admin: Path | None) -> Status:
    """Changed and untracked paths, and any git operation in progress."""
    out = git_out(
        worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all",
        "--ignore-submodules=none",
    )
    changed: list[str] = []
    records = out.split("\0")
    index = 0
    while index < len(records):
        record = records[index]
        index += 1
        if len(record) < 4:
            continue
        changed.append(record[3:])
        if record[0] in "RC" or record[1] in "RC":
            index += 1  # the rename's source path follows
    operation = None
    if admin is not None:
        for marker, name in _OPERATIONS.items():
            if (admin / marker).exists():
                operation = name
                break
    return Status(changed, operation)


def ignored(worktree: Path, paths: list[str]) -> set[str]:
    """The subset of paths (relative, forward slashes) that git ignores."""
    if not paths:
        return set()
    try:
        done = subprocess.run(
            ["git", "-C", str(worktree), "check-ignore", "-z", "--stdin"],
            input="\0".join(paths) + "\0",
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="surrogateescape",
            env=_env(),
            timeout=GIT_TIMEOUT,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GitError(f"git check-ignore: {exc}") from exc
    if done.returncode not in (0, 1):
        raise GitError(f"git check-ignore: {done.stderr.strip()[:200]}")
    return {p for p in done.stdout.split("\0") if p}


def tracked_under(worktree: Path, paths: list[str]) -> set[str]:
    """The subset of paths that hold at least one tracked file."""
    if not paths:
        return set()
    files: list[str] = []
    for start in range(0, len(paths), 100):  # stay well inside Windows' command-line limit
        out = git_out(worktree, "ls-files", "-z", "--", *paths[start : start + 100])
        files += [f for f in out.split("\0") if f]
    hits: set[str] = set()
    for path in paths:
        prefix = path.rstrip("/") + "/"
        if any(f == path or f.startswith(prefix) for f in files):
            hits.add(path)
    return hits
