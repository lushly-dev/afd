"""Tier 2: removing a finished worktree with `git worktree remove`, and putting one back.

A worktree is removed only when disk-report put it in tier 2 (or the caller asked for restorable
ones too), and only after everything that made it eligible is read again: its volume, its
folder, lock, processes, git status, commit, idleness, and that nothing unique lives in it.
The branch is never deleted. Each removal is recorded, so `disk-restore` can recreate the
worktree at the same path and commit.
"""

from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path

from botcore.commands.disk.finished import judge, landed_how, same_path
from botcore.commands.disk.git import GitError, git_out, path_key, status
from botcore.commands.disk.scan import DAY, exists, last_activity, newest_mtime
from botcore.commands.disk.settings import state_path
from botcore.config import DiskConfig

REMOVALS = "removed.json"
MAX_RECORDS = 500


def plan_removals(data: dict, include_restorable: bool, due_days: float) -> list[dict]:
    """The worktrees a tier 2 run would remove, as plain records for the Action list."""
    planned = []
    for repo in data["repos"]:
        if repo.get("blocked") or repo.get("error") or not repo.get("main"):
            continue
        for row in repo.get("worktrees", []):
            verdict = row.get("finished")
            if not verdict or not row.get("can_strip") or row.get("managed_by"):
                continue
            if row.get("tier") != 2 and not (include_restorable and verdict["restorable"]):
                continue
            planned.append({
                "target": row["path"],
                "main": repo["main"],
                "branch": row.get("branch"),
                "head": row.get("head"),
                "landed": verdict.get("landed"),
                "outputs": [s["path"] for s in row.get("strip", []) if s["kind"] == "dir"],
                "due_days": due_days,
                "bytes": row.get("strip_ready_bytes") or None,
            })
    return planned


def recheck_removal(  # noqa: PLR0913 - each is a fact the recheck must compare
    target: Path, main: Path, head: str | None, landed: bool, due_days: float,
    config: DiskConfig, busy: str | None, outputs: list[str] | None = None,
) -> str | None:
    """Why this worktree must not be removed now, or None. Read immediately before removing.

    Activity is read the way disk-report reads it: git's records for the worktree, its changed
    files, and its declared build-output folders (not the worktree folder's own time, which
    changes whenever anything directly inside it is created or deleted).
    """
    if os.path.islink(target) or not exists(target):
        return "the worktree folder changed since planning"
    try:
        top = git_out(target, "rev-parse", "--path-format=absolute", "--show-toplevel").strip()
        admin = Path(git_out(target, "rev-parse", "--absolute-git-dir").strip())
        now_head = git_out(target, "rev-parse", "HEAD").strip()
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
    verdict = judge(target, main, now_head, st.changed, st.operation, config, 60)
    if verdict.unique:
        return f"something unique is in it now: {verdict.unique[0]}"
    if landed and not landed_how(target, now_head, config.landing_ref, 60):
        return f"its work is no longer found in {config.landing_ref}"
    return None


def remove_worktree(target: Path, main: Path) -> tuple[bool, str | None]:
    """`git worktree remove` without --force: git itself refuses a dirty or locked worktree."""
    try:
        git_out(main, "worktree", "remove", str(target), timeout=600)
    except GitError as exc:
        return False, str(exc)
    return True, None


def _records_path() -> Path:
    return state_path() / REMOVALS


def read_records() -> list[dict]:
    try:
        data = json.loads(_records_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def record_removal(target: Path, main: Path, branch: str | None, head: str | None) -> None:
    records = read_records()
    records.append({
        "path": str(target),
        "main": str(main),
        "branch": branch,
        "head": head,
        "removed_at": datetime.now(UTC).isoformat(timespec="seconds"),
    })
    folder = state_path()
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / f".{REMOVALS}.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(records[-MAX_RECORDS:], indent=1), encoding="utf-8")
    os.replace(tmp, _records_path())


def find_record(path: Path) -> dict | None:
    for record in reversed(read_records()):
        if same_path(record["path"], path) or os.path.normcase(record["path"]) == \
                os.path.normcase(os.path.abspath(path)):
            return record
    return None


def restore(record: dict) -> tuple[bool, str]:
    """Recreate a removed worktree at its path: on its branch at the same commit if it can be,
    else on a recreated branch, else detached at the commit."""
    target, main = Path(record["path"]), Path(record["main"])
    head, branch = record.get("head"), record.get("branch")
    if exists(target):
        return False, f"{target} already exists"
    if not head:
        return False, "the removal record has no commit"
    try:
        git_out(main, "cat-file", "-e", f"{head}^{{commit}}")
    except GitError:
        return False, f"commit {head} is no longer in the repository"
    tip = None
    if branch:
        try:
            tip = git_out(main, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}").strip()
        except GitError:
            tip = None
    try:
        if branch and tip == head:
            git_out(main, "worktree", "add", str(target), branch, timeout=600)
            return True, f"on {branch} at {head[:12]}"
        if branch and tip is None:
            git_out(main, "worktree", "add", "-b", branch, str(target), head, timeout=600)
            return True, f"on a recreated {branch} at {head[:12]}"
        git_out(main, "worktree", "add", "--detach", str(target), head, timeout=600)
    except GitError as exc:
        return False, str(exc)
    moved = f" ({branch} has moved on)" if branch else ""
    return True, f"detached at {head[:12]}{moved}"
