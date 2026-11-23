"""`disk-keep`, `disk-unkeep` and `disk-restore`.

A keep is a `git worktree lock` whose reason starts `botcore-keep until=<date>`: git itself then
refuses to prune or remove the worktree, and every disk-* command leaves it alone. disk-report
lists keeps past their date so they get renewed or released, never silently dropped. disk-unkeep
releases only a botcore keep, never someone else's lock. disk-restore recreates a worktree a
tier 2 run removed, from the record that run wrote.
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.finished import keep_reason, keep_until
from botcore.commands.disk.git import GitError, git_out, list_worktrees, path_key
from botcore.commands.disk.removal import find_record, restore
from botcore.commands.disk.settings import expand
from botcore.commands.disk.steps import run_blocking

DEFAULT_KEEP_DAYS = 14


def _linked_worktree(path: Path):
    """(main checkout, the worktree entry) for a linked worktree, or an error result."""
    try:
        _common, worktrees = list_worktrees(path)
    except GitError as exc:
        return None, error("DISK_NOT_A_WORKTREE", f"{path} is not in a git repository: {exc}",
                           suggestion="Pass the path of a linked worktree")
    for entry in worktrees:
        if path_key(entry.path) == path_key(path):
            if entry.is_main:
                return None, error("DISK_NOT_A_WORKTREE", f"{path} is the main checkout",
                                   suggestion="The main checkout is never stripped or removed")
            return (worktrees[0].path, entry), None
    return None, error("DISK_NOT_A_WORKTREE", f"{path} is not a worktree git lists",
                       suggestion="Pass the top folder of a linked worktree")


def _disk_keep_sync(path: str, until: str | None = None, reason: str = "") -> CommandResult[dict]:
    target = expand(path)
    found, failure = _linked_worktree(target)
    if failure:
        return failure
    main, entry = found
    try:
        day = (date.fromisoformat(until) if until else
               date.today() + timedelta(days=DEFAULT_KEEP_DAYS))
        if day < date.today():
            raise ValueError("in the past")
    except ValueError as exc:
        return error("DISK_KEEP_INVALID", f"until={until!r}: {exc}",
                     suggestion="Pass a date on or after today as YYYY-MM-DD")
    until = day.isoformat()
    if entry.locked is not None and keep_until(entry.locked) is None:
        return error("DISK_LOCKED_ELSEWHERE", f"{target} is already locked: {entry.locked or '?'}",
                     suggestion="It is already protected; its own lock stays as it is")
    try:
        if entry.locked is None:
            git_out(main, "worktree", "lock", "--reason", keep_reason(until, reason),
                    str(entry.path))
        else:
            _renew(entry.admin, keep_reason(until, reason))
    except (GitError, OSError) as exc:
        return error("DISK_KEEP_FAILED", str(exc), suggestion="Read the message and try again")
    return success(data={"path": str(entry.path), "until": until, "reason": reason},
                   suggestions=[f"disk-unkeep {entry.path} releases it"])


async def disk_keep(path: str, until: str | None = None, reason: str = "") -> CommandResult[dict]:
    """Protect a worktree from every disk-* action until a date (14 days by default)."""
    return await run_blocking(_disk_keep_sync, path, until, reason)


def _renew(admin: Path | None, reason: str) -> None:
    """Replace a keep's reason in git's own lock file, so the worktree never goes unlocked."""
    if admin is None:
        raise OSError("git's record of the worktree is unknown")
    lock = admin / "locked"
    tmp = admin / f".locked.{os.getpid()}.tmp"
    tmp.write_text(reason, encoding="utf-8")
    os.replace(tmp, lock)


def _disk_unkeep_sync(path: str) -> CommandResult[dict]:
    target = expand(path)
    found, failure = _linked_worktree(target)
    if failure:
        return failure
    main, entry = found
    if entry.locked is None:
        return success(data={"path": str(entry.path), "released": False},
                       suggestions=["It was not kept"])
    if keep_until(entry.locked) is None:
        return error("DISK_LOCKED_ELSEWHERE", f"{target} is locked by something else: "
                     f"{entry.locked or '?'}",
                     suggestion="Release it with `git worktree unlock` if you are sure")
    try:
        git_out(main, "worktree", "unlock", str(entry.path))
    except GitError as exc:
        return error("DISK_KEEP_FAILED", str(exc), suggestion="Read git's message and try again")
    return success(data={"path": str(entry.path), "released": True})


async def disk_unkeep(path: str) -> CommandResult[dict]:
    """Release a keep that disk-keep made. Another tool's lock is left alone."""
    return await run_blocking(_disk_unkeep_sync, path)


def _disk_restore_sync(path: str) -> CommandResult[dict]:
    record = find_record(expand(path))
    if record is None:
        return error("DISK_NOT_REMOVED", f"no removal of {path} is recorded",
                     suggestion="disk-restore only knows worktrees disk-reclaim removed")
    done, how = restore(record)
    if not done:
        return error("DISK_RESTORE_FAILED", how,
                     suggestion="Recreate it with `git worktree add` from the record's commit")
    removed_at = record.get("finished_at") or record.get("started_at")
    return success(data={"path": record["path"], "how": how, "removed_at": removed_at,
                         "pinned": record.get("refs", [])},
                   suggestions=["Install and build again before running anything in it"])


async def disk_restore(path: str) -> CommandResult[dict]:
    """Recreate a worktree a tier 2 run removed, at the same path and commit."""
    return await run_blocking(_disk_restore_sync, path)


__all__ = ["disk_keep", "disk_restore", "disk_unkeep"]
