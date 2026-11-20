"""The git reads the disk-* commands need: worktree lists, admin folders, status and tracked files.

Output is read as bytes and decoded with surrogateescape, so a NUL-delimited path is never
altered by newline translation.
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

GIT_TIMEOUT = 120.0


class GitError(Exception):
    """A git command failed or could not run."""


def _env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["LC_ALL"] = "C"
    env["GIT_OPTIONAL_LOCKS"] = "0"  # a read must never take the index lock
    return env


def _decode(raw: bytes) -> str:
    return raw.decode("utf-8", errors="surrogateescape")


def git_out(
    cwd: Path, *args: str, timeout: float = GIT_TIMEOUT, stdin: str | None = None,
    ok_codes: tuple[int, ...] = (0,),
) -> str:
    """Run git in cwd and return stdout; raise GitError on failure or timeout."""
    try:
        done = subprocess.run(
            ["git", "-C", str(cwd), *args],
            input=None if stdin is None else stdin.encode("utf-8", errors="surrogateescape"),
            capture_output=True,
            env=_env(),
            timeout=max(1.0, timeout),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GitError(f"git {' '.join(args[:3])}: {exc}") from exc
    if done.returncode not in ok_codes:
        first = _decode(done.stderr).strip().splitlines()
        raise GitError(f"git {' '.join(args[:3])}: {first[0] if first else 'failed'}")
    return _decode(done.stdout)


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


def path_key(path: Path | str) -> str:
    """A comparison key: absolute, resolved where it exists, case-folded where paths are."""
    text = os.path.realpath(os.path.abspath(str(path)))
    return os.path.normcase(text)


def _admin_map(common: Path) -> dict[str, Path]:
    """Map each linked worktree's folder (as its gitdir file names it) to its admin folder.

    The gitdir file may hold a relative path (`worktree.useRelativePaths`): it is resolved
    against the admin folder, as git does.
    """
    found: dict[str, Path] = {}
    base = common / "worktrees"
    try:
        admins = list(base.iterdir())
    except OSError:
        return found
    for admin in admins:
        try:
            target = (admin / "gitdir").read_text(encoding="utf-8").strip()
        except OSError:
            continue
        gitfile = Path(target) if os.path.isabs(target) else admin / target
        found[path_key(os.path.normpath(gitfile.parent))] = admin
    return found


def list_worktrees(checkout: Path, timeout: float = GIT_TIMEOUT) -> tuple[Path, list[Worktree]]:
    """(common git folder, worktrees) for the repository holding checkout."""
    common = common_dir(checkout)
    entries = parse_worktree_list(
        git_out(checkout, "worktree", "list", "--porcelain", "-z", timeout=timeout)
    )
    admins = _admin_map(common)
    for entry in entries:
        entry.admin = common if entry.is_main else admins.get(path_key(entry.path))
    return common, entries


def verify_checkout(worktree: Worktree, common: Path, timeout: float = GIT_TIMEOUT) -> str | None:
    """Why the folder at worktree.path is not the checkout git records there, or None.

    A registered path replaced by a link or by another repository's checkout would otherwise be
    inspected with this worktree's age and lock.
    """
    if os.path.islink(worktree.path):
        return "the registered folder is now a symbolic link"
    try:
        out = git_out(worktree.path, "rev-parse", "--path-format=absolute", "--show-toplevel",
                      "--git-dir", "--git-common-dir", timeout=timeout)
        top, own, shared = (out.splitlines() + ["", "", ""])[:3]
    except GitError as exc:
        return f"git cannot read it: {exc}"
    if path_key(top.strip()) != path_key(worktree.path):
        return "git says the folder belongs to another checkout"
    if path_key(shared.strip()) != path_key(common):
        return "the folder belongs to another repository"
    if worktree.admin is None or path_key(own.strip()) != path_key(worktree.admin):
        return "git's record of this worktree does not match the folder"
    return None


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


def status(worktree: Path, admin: Path | None, timeout: float = GIT_TIMEOUT) -> Status:
    """Changed and untracked paths, and any git operation in progress."""
    out = git_out(
        worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all",
        "--ignore-submodules=none", timeout=timeout,
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
            if os.path.lexists(admin / marker):
                operation = name
                break
    return Status(changed, operation)


def ignored(worktree: Path, paths: list[str], timeout: float = GIT_TIMEOUT) -> set[str]:
    """The subset of paths (relative, forward slashes) that git ignores."""
    if not paths:
        return set()
    out = git_out(worktree, "check-ignore", "-z", "--stdin", stdin="\0".join(paths) + "\0",
                  timeout=timeout, ok_codes=(0, 1))
    return {p for p in out.split("\0") if p}


def case_insensitive(folder: Path) -> bool:
    """Whether the filesystem holding folder treats names case-insensitively.

    Probed on the nearest folder whose name has letters; True when nothing can be probed,
    since comparing case-insensitively only ever refuses more.
    """
    current = Path(os.path.abspath(folder))
    while current.name and current.name == current.name.swapcase():
        if current.parent == current:
            break
        current = current.parent
    name = current.name
    if not name or name == name.swapcase():
        return True
    try:
        return os.path.samefile(current, current.with_name(name.swapcase()))
    except FileNotFoundError:
        return False
    except OSError:
        return True


def tracked_files(worktree: Path, timeout: float = GIT_TIMEOUT) -> list[str]:
    """Every path in the worktree's index (files and submodule entries)."""
    out = git_out(worktree, "ls-files", "-z", "--cached", timeout=timeout)
    return [f for f in out.split("\0") if f]


def tracked_under(worktree: Path, paths: list[str], files: list[str] | None = None,
                  fold: bool | None = None) -> set[str]:
    """The subset of paths that are, or hold, a tracked path.

    Compared case-insensitively where the filesystem is, so `BUILD` counts as holding the
    tracked `build/keep.txt` on a default macOS or Windows volume.
    """
    if not paths:
        return set()
    if files is None:
        files = tracked_files(worktree)
    if fold is None:
        fold = case_insensitive(worktree)
    known: set[str] = set()
    for name in files:
        key = name.casefold() if fold else name
        known.add(key)
        parts = key.split("/")
        for depth in range(1, len(parts)):
            known.add("/".join(parts[:depth]))
    hits: set[str] = set()
    for path in paths:
        key = path.rstrip("/")
        if (key.casefold() if fold else key) in known:
            hits.add(path)
    return hits
