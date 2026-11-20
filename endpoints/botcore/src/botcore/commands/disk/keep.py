"""`disk-keep`, `disk-unkeep` and `disk-restore`.

A keep is a `git worktree lock` whose reason starts `botcore-keep until=<date>`: git itself then
refuses to prune or remove the worktree, and every disk-* command leaves it alone. disk-report
lists keeps past their date so they get renewed or released, never silently dropped. disk-unkeep
releases only a botcore keep, never someone else's lock. disk-restore recreates a worktree a
tier 2 run removed, from the record that run wrote.
"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.finished import KEEP_PREFIX, keep_reason
from botcore.commands.disk.git import GitError, git_out, list_worktrees, path_key
from botcore.commands.disk.removal import find_record, restore
from botcore.commands.disk.settings import expand

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


async def disk_keep(path: str, until: str | None = None, reason: str = "") -> CommandResult[dict]:
    """Protect a worktree from every disk-* action until a date (14 days by default)."""
    target = expand(path)
    found, failure = _linked_worktree(target)
    if failure:
        return failure
    main, entry = found
    if until is None:
        until = (date.today() + timedelta(days=DEFAULT_KEEP_DAYS)).isoformat()
    try:
        if date.fromisoformat(until) < date.today():
            raise ValueError("in the past")
    except ValueError as exc:
        return error("DISK_KEEP_INVALID", f"until={until!r}: {exc}",
                     suggestion="Pass a date on or after today as YYYY-MM-DD")
    if entry.locked is not None and not entry.locked.startswith(KEEP_PREFIX):
        return error("DISK_LOCKED_ELSEWHERE", f"{target} is already locked: {entry.locked or '?'}",
                     suggestion="It is already protected; its own lock stays as it is")
    try:
        if entry.locked is not None:
            git_out(main, "worktree", "unlock", str(entry.path))
        git_out(main, "worktree", "lock", "--reason", keep_reason(until, reason), str(entry.path))
    except GitError as exc:
        return error("DISK_KEEP_FAILED", str(exc), suggestion="Read git's message and try again")
    return success(data={"path": str(entry.path), "until": until, "reason": reason},
                   suggestions=[f"disk-unkeep {entry.path} releases it"])


async def disk_unkeep(path: str) -> CommandResult[dict]:
    """Release a keep that disk-keep made. Another tool's lock is left alone."""
    target = expand(path)
    found, failure = _linked_worktree(target)
    if failure:
        return failure
    main, entry = found
    if entry.locked is None:
        return success(data={"path": str(entry.path), "released": False},
                       suggestions=["It was not kept"])
    if not entry.locked.startswith(KEEP_PREFIX):
        return error("DISK_LOCKED_ELSEWHERE", f"{target} is locked by something else: "
                     f"{entry.locked or '?'}",
                     suggestion="Release it with `git worktree unlock` if you are sure")
    try:
        git_out(main, "worktree", "unlock", str(entry.path))
    except GitError as exc:
        return error("DISK_KEEP_FAILED", str(exc), suggestion="Read git's message and try again")
    return success(data={"path": str(entry.path), "released": True})


async def disk_restore(path: str) -> CommandResult[dict]:
    """Recreate a worktree a tier 2 run removed, at the same path and commit."""
    record = find_record(expand(path))
    if record is None:
        return error("DISK_NOT_REMOVED", f"no removal of {path} is recorded",
                     suggestion="disk-restore only knows worktrees disk-reclaim removed")
    done, how = restore(record)
    if not done:
        return error("DISK_RESTORE_FAILED", how,
                     suggestion="Recreate it with `git worktree add` from the record's commit")
    return success(data={"path": record["path"], "how": how, "removed_at": record["removed_at"]},
                   suggestions=["Install and build again before running anything in it"])


__all__ = ["disk_keep", "disk_restore", "disk_unkeep"]
