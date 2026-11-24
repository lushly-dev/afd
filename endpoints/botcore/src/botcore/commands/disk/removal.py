"""Tier 2: removing a finished worktree with `git worktree remove`, and putting one back.

A worktree is removed only when disk-report put it in tier 2 (or the caller asked for
restorable ones too), and only after everything that made it eligible is read again: its
volumes, its folder, T3 Code's ownership, its lock, processes, git status, commit, idleness,
and that nothing unique lives in it. Before git removes anything, the commit and any commits
only the worktree's HEAD reflog reaches are pinned under `refs/botcore/removed/<id>/`, so no
later branch deletion, remote prune or gc can take them, and a pending record is written; the
record is completed after. The branch is never deleted. `disk-restore` recreates the worktree
at the same path and commit from that record.
"""

from __future__ import annotations

import json
import os
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from botcore.commands.disk.finished import judge, landed_how, reflog_only_commits, same_path
from botcore.commands.disk.git import GitError, git_out, list_worktrees, path_key, status
from botcore.commands.disk.scan import DAY, exists, is_dir, last_activity, newest_mtime
from botcore.commands.disk.settings import state_path
from botcore.config import DiskConfig

REMOVALS = "removed.json"
MAX_RECORDS = 5000
PIN_ROOT = "refs/botcore/removed"


def plan_removals(
    data: dict[str, Any], include_restorable: bool, due_days: float
) -> list[dict[str, Any]]:
    """The worktrees a tier 2 run would remove, as plain records for the Action list."""
    planned: list[dict[str, Any]] = []
    if not data.get("t3_code_settings_read", True):
        return planned
    for repo in data["repos"]:
        if repo.get("blocked") or repo.get("error") or not repo.get("main"):
            continue
        for row in repo.get("worktrees", []):
            verdict = row.get("finished")
            if not verdict or not row.get("can_strip") or row.get("managed_by"):
                continue
            if row.get("tier") != 2 and not (include_restorable and verdict["restorable"]):
                continue
            planned.append(
                {
                    "target": row["path"],
                    "main": repo["main"],
                    "branch": row.get("branch"),
                    "head": row.get("head"),
                    "landed": verdict.get("landed"),
                    "outputs": [
                        s["path"] for s in row.get("strip", []) if s["kind"] in ("dir", "file")
                    ],
                    "due_days": due_days,
                    "bytes": row.get("strip_ready_bytes") or None,
                }
            )
    return planned


def recheck_removal(  # noqa: PLR0911, PLR0913 - each is a fact the recheck must compare
    target: Path,
    main: Path,
    head: str | None,
    landed: bool,
    due_days: float,
    config: DiskConfig,
    busy: str | None,
    outputs: list[str] | None = None,
    volume_problem: Callable[[str], str | None] | None = None,
    t3_owned: Callable[[Path], str | None] | None = None,
    checkouts: list[str] | None = None,
) -> str | None:
    """Why this worktree must not be removed now, or None. Read immediately before removing.

    Activity is read the way disk-report reads it: git's records for the worktree, its changed
    files, and its declared build-output files and folders (not the worktree folder's own time,
    which changes whenever anything directly inside it is created or deleted).
    """
    for path in (target, main):
        problem = volume_problem(str(path)) if volume_problem else None
        if problem:
            return problem
    owner = t3_owned(target) if t3_owned else None
    if owner:
        return owner
    if os.path.islink(target) or not exists(target):
        return "the worktree folder changed since planning"
    try:
        top = git_out(target, "rev-parse", "--path-format=absolute", "--show-toplevel").strip()
        admin = Path(git_out(target, "rev-parse", "--absolute-git-dir").strip())
        now_head = git_out(target, "rev-parse", "HEAD").strip()
        branch = git_out(target, "branch", "--show-current").strip() or None
    except GitError as exc:
        return f"git cannot read it: {exc}"
    if path_key(top) != path_key(target):
        return "the folder is no longer this worktree"
    try:
        os.lstat(admin / "locked")
    except FileNotFoundError:
        pass
    except OSError:
        return "whether it is locked cannot be read"
    else:
        return "it was locked (kept) since planning"
    if busy:
        return busy
    if head and now_head != head:
        return "its commit changed since planning"
    st = status(target, admin, timeout=60)
    activity = last_activity(target, admin, st.changed, [])
    for rel in outputs or []:
        built = newest_mtime(target / rel)
        if built is not None and (activity is None or built > activity):
            activity = built
    if activity is not None and time.time() - activity < due_days * DAY:
        return "it was active since planning"
    others = [c for c in checkouts or [] if c != path_key(target)]
    verdict = judge(
        target, main, admin, now_head, branch, st.changed, st.operation, config, 60, others
    )
    if verdict.unique:
        return f"something unique is in it now: {verdict.unique[0]}"
    if landed and not landed_how(target, now_head, config.landing_ref, 60, branch):
        return f"its work is no longer found in {config.landing_ref}"
    return None


# ── Pinning and removing ────────────────────────────────────────────────────


def pin_name(target: Path) -> str:
    """A ref folder for one removal: the worktree's name and the time, git-ref safe."""
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", target.name).strip(".-") or "worktree"
    return f"{PIN_ROOT}/{name}-{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%fZ')}"


def pin_commits(target: Path, main: Path, head: str) -> list[str]:
    """Pin the commit and every commit only the worktree's reflog reaches; return the refs.

    All or nothing: if any pin fails, the ones made are released and the error is raised.
    """
    folder = pin_name(target)
    commits = [head] + [c for c in reflog_only_commits(target, 60) if c != head]
    refs: list[str] = []
    try:
        for index, commit in enumerate(commits):
            ref = f"{folder}/head" if index == 0 else f"{folder}/reflog-{index}"
            git_out(main, "update-ref", ref, commit)
            refs.append(ref)
    except GitError:
        unpin(main, refs)
        raise
    return refs


def unpin(main: Path, refs: list[str]) -> None:
    for ref in refs:
        try:
            git_out(main, "update-ref", "-d", ref)
        except GitError:
            continue


def remove_worktree(target: Path, main: Path) -> tuple[bool, str | None]:
    """`git worktree remove` without --force: git itself refuses a dirty or locked worktree."""
    try:
        git_out(main, "worktree", "remove", str(target), timeout=600)
    except GitError as exc:
        return False, str(exc)
    return True, None


# ── Records ─────────────────────────────────────────────────────────────────


def _records_path() -> Path:
    return state_path() / REMOVALS


def read_records() -> list[dict[str, Any]]:
    try:
        data = json.loads(_records_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []


def _write_records(records: list[dict[str, Any]]) -> None:
    folder = state_path()
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / f".{REMOVALS}.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(records[-MAX_RECORDS:], indent=1), encoding="utf-8")
    os.replace(tmp, _records_path())


def begin_record(
    target: Path, main: Path, branch: str | None, head: str | None, refs: list[str]
) -> str:
    """Write a pending removal record before git removes anything; return its id."""
    record_id = refs[0] if refs else f"{target}@{time.time()}"
    records = read_records()
    records.append(
        {
            "id": record_id,
            "state": "pending",
            "path": str(target),
            "main": str(main),
            "branch": branch,
            "head": head,
            "refs": refs,
            "started_at": datetime.now(UTC).isoformat(timespec="seconds"),
        }
    )
    _write_records(records)
    return record_id


def finish_record(record_id: str, state: str, detail: str | None = None) -> None:
    records = read_records()
    for record in records:
        if record.get("id") == record_id:
            record["state"] = state
            record["finished_at"] = datetime.now(UTC).isoformat(timespec="seconds")
            if detail:
                record["detail"] = detail
    _write_records(records)


def find_record(path: Path) -> dict[str, Any] | None:
    """The latest record of a removal of path (a pending one whose folder is gone counts)."""
    for record in reversed(read_records()):
        if not same_path(record["path"], path):
            continue
        if record.get("state") == "removed":
            return dict(record)
        if record.get("state") == "pending" and not exists(Path(record["path"])):
            return dict(record)
    return None


# ── Restoring ───────────────────────────────────────────────────────────────


def _checked_out_elsewhere(main: Path, branch: str) -> bool:
    try:
        _common, worktrees = list_worktrees(main)
    except GitError:
        return True
    return any(w.branch == branch for w in worktrees)


def restore(record: dict[str, Any]) -> tuple[bool, str]:
    """Recreate a removed worktree at its path and commit: on its branch when the branch still
    points there and is free, on a recreated branch when it was deleted, else detached."""
    target, main = Path(record["path"]), Path(record["main"])
    head, branch = record.get("head"), record.get("branch")
    if exists(target) or os.path.islink(target):
        return False, f"{target} already exists"
    if not is_dir(target.parent):
        return False, f"{target.parent} is missing (an unplugged drive?)"
    if not head:
        return False, "the removal record has no commit"
    try:
        git_out(main, "cat-file", "-e", f"{head}^{{commit}}")
    except GitError:
        return False, f"commit {head} is no longer in the repository"
    how = _add(target, main, head, branch)
    if how.startswith("error:"):
        return False, how.removeprefix("error:").strip()
    try:
        now = git_out(target, "rev-parse", "HEAD").strip()
    except GitError as exc:
        return False, f"restored, but git cannot read it: {exc}"
    if now != head:
        return False, f"restored at {now[:12]}, not the recorded {head[:12]}: check it by hand"
    return True, how


def _add(target: Path, main: Path, head: str, branch: str | None) -> str:
    tip = None
    if branch:
        try:
            tip = git_out(main, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}").strip()
        except GitError:
            tip = None
    try:
        if branch and tip == head and not _checked_out_elsewhere(main, branch):
            git_out(main, "worktree", "add", str(target), branch, timeout=600)
            return f"on {branch} at {head[:12]}"
        if branch and tip is None:
            git_out(main, "worktree", "add", "-b", branch, str(target), head, timeout=600)
            return f"on a recreated {branch} at {head[:12]}"
        git_out(main, "worktree", "add", "--detach", str(target), head, timeout=600)
    except GitError as exc:
        return f"error: {exc}"
    if not branch:
        return f"detached at {head[:12]}"
    if tip == head:
        return f"detached at {head[:12]} ({branch} is checked out elsewhere)"
    return f"detached at {head[:12]} ({branch} has moved on)"
