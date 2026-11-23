"""`disk-reclaim`: carry out tier 0 (caches, aged folders) and tier 1 (idle build output).

A dry run unless `apply=True`. Plans come from the same code as disk-report. Immediately before
each deletion everything that made it safe is read again: the volume's identity, the worktree's
folder and lock, its activity (including the build folder itself), its processes, and the
path's git state; for an aged folder, its identity, age and protection. Anything that changed,
or cannot be read, is skipped and recorded, and the run goes on. One run at a time per machine.
Every run writes a receipt, however it ends; space reclaimed is the change in free space.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.caches import AGED_DEPTH, unsafe_aged_root
from botcore.commands.disk.finished import ReflogTooLong
from botcore.commands.disk.git import (
    GitError,
    git_out,
    ignored,
    path_key,
    status,
    tracked_under,
)
from botcore.commands.disk.lock import LockHeld, RunLock
from botcore.commands.disk.removal import (
    begin_record,
    finish_record,
    pin_commits,
    plan_removals,
    recheck_removal,
    remove_worktree,
    unpin,
)
from botcore.commands.disk.remove import UnsafePath, remove_inside
from botcore.commands.disk.report import (
    MANAGERS,
    Context,
    build_report,
    count_idle,
    manager,
    repository_of,
    settings_error,
    volume_for,
)
from botcore.commands.disk.scan import (
    DAY,
    Processes,
    busy_reason,
    is_dir,
    last_activity,
    newest_mtime,
    running_processes,
    volume_state,
)
from botcore.commands.disk.settings import (
    SettingsError,
    load_machine_settings,
    state_path,
    t3_worktree_roots,
)
from botcore.commands.disk.steps import command, doing
from botcore.config import DiskConfig

STRIP_RECORD = "botcore-disk-strip.json"
MAX_RECEIPTS = 30
MAX_RECEIPT_BYTES = 50 * 1024 * 1024
MAX_ONE_RECEIPT = 5 * 1024 * 1024
# Tier 1's idle thresholds under low space: the configured ones, then 1 day, then 6 hours
PRESSURE_STEPS: tuple[float | None, ...] = (None, 1.0, 0.25)
RUST_BUILDERS = ("cargo", "rustc", "clippy-driver")


@dataclass
class Action:
    """One thing a reclaim does or would do."""

    kind: str  # "strip", "cache", "aged" or "remove"
    target: str
    root: str | None = None
    worktree: str | None = None
    pattern: str | None = None
    target_kind: str | None = None  # "file", "dir" or "link" for strip actions
    bytes_estimate: int | None = None
    due_days: float | None = None
    planned_mtime: float | None = None
    identity: tuple[int, int] | None = None
    head: str | None = None
    branch: str | None = None
    landed: str | None = None
    outputs: list[str] = field(default_factory=list)
    step: str = "normal"
    outcome: str = "planned"
    detail: str | None = None
    removed_bytes: int = 0


@dataclass
class Run:
    apply: bool
    tier: int
    ctx: Context
    protected: list[Path] = field(default_factory=list)
    configs: dict[str, DiskConfig] = field(default_factory=dict)  # by main checkout's key
    unfetched: dict[str, str] = field(default_factory=dict)  # main's key -> why the fetch failed
    actions: list[Action] = field(default_factory=list)
    seen: set[str] = field(default_factory=set)
    _per_worktree: dict[str, Processes] = field(default_factory=dict)

    def add(self, action: Action) -> None:
        key = f"{action.kind}:{action.target}"
        if key not in self.seen:
            self.seen.add(key)
            self.actions.append(action)

    def processes_for(self, worktree: str) -> Processes:
        """A process listing taken when this worktree's first deletion is about to happen."""
        if worktree not in self._per_worktree:
            self._per_worktree[worktree] = running_processes()
        return self._per_worktree[worktree]


# ── Planning ────────────────────────────────────────────────────────────────


def _strippable(row: dict, repo: dict) -> bool:
    """The report's own verdict: verified, unprotected, fully searched, with known activity."""
    return bool(row.get("can_strip") and row.get("exists") and not repo.get("blocked"))


def _volume_low(path: str, ctx: Context) -> bool:
    vol = volume_for(Path(path), ctx)
    return bool(vol and vol.low)


def plan_strips(
    data: dict, step: float | None, include_pressure: bool, ctx: Context, only_low: bool,
) -> list[Action]:
    actions = []
    for repo in data["repos"]:
        for row in repo.get("worktrees", []):
            idle = row.get("idle_seconds")
            if not _strippable(row, repo) or idle is None:
                continue
            if only_low and not _volume_low(row["path"], ctx):
                continue
            wt_actions: list[Action] = []
            for item in row.get("strip", []):
                if item["when"] == "pressure" and not include_pressure:
                    continue
                due = item["after_days"] if step is None else min(item["after_days"], step)
                if idle < due * DAY:
                    continue
                wt_actions.append(Action(
                    kind="strip",
                    target=str(Path(row["path"]) / item["path"]),
                    root=row["path"],
                    worktree=row["path"],
                    pattern=item["pattern"],
                    target_kind=item.get("kind"),
                    bytes_estimate=item.get("bytes"),
                    due_days=due,
                    step="normal" if step is None else f"pressure-{step}d",
                    detail=f"due after {due} days; idle {row['idle_days']}",
                ))
            # Strip file candidates (such as *.tsbuildinfo) before folder candidates (such as
            # dist) within a worktree so an interrupted or failed build-info removal never leaves
            # build info behind after its output folder is gone (lushly-dev/afd#1939).
            wt_actions.sort(key=lambda a: (0 if a.target_kind == "file" else 1, a.target))
            actions.extend(wt_actions)
    return actions


def _identity(path: str) -> tuple[int, int] | None:
    try:
        info = os.lstat(path)
    except OSError:
        return None
    return info.st_dev, info.st_ino


def plan_tier0(data: dict) -> list[Action]:
    actions = []
    for cache in data.get("caches", []):
        if cache.get("action"):
            actions.append(Action(kind="cache", target=cache["name"], root=cache.get("cwd"),
                                  detail=cache["action"]))
    for aged in data.get("aged", []):
        for entry in aged["entries"]:
            if entry["eligible"]:
                actions.append(Action(
                    kind="aged",
                    target=entry["path"],
                    root=str(Path(entry["path"]).parent),
                    bytes_estimate=entry.get("bytes"),
                    planned_mtime=entry.get("mtime"),
                    identity=_identity(entry["path"]),
                    detail=f"age {entry['age_days']} days",
                ))
    return actions


# ── Checks made immediately before acting ───────────────────────────────────


def _volume_problem(path: str, ctx: Context) -> str | None:
    vol = volume_for(Path(path), ctx)
    if vol is None:
        return None
    fresh = volume_state(Path(vol.mount), vol.id_expected, vol.low_space_gb)
    if not fresh.verified:
        return f"volume {vol.mount} is no longer the verified volume"
    return None


def _admin(worktree: Path) -> Path | None:
    try:
        return Path(git_out(worktree, "rev-parse", "--absolute-git-dir").strip())
    except GitError:
        return None


def _toplevel(folder: Path) -> str:
    return path_key(git_out(folder, "rev-parse", "--path-format=absolute", "--show-toplevel")
                    .strip())


def _recheck_strip(action: Action, run: Run) -> str | None:
    """Why this strip must not happen now, or None."""
    worktree = Path(action.worktree or "")
    target = Path(action.target)
    rel = target.relative_to(worktree).as_posix()
    problem = _volume_problem(action.target, run.ctx)
    if problem:
        return problem
    if os.path.islink(worktree) or not is_dir(worktree):
        return "the worktree folder changed since planning"
    if _toplevel(worktree) != path_key(worktree):
        return "the folder is no longer this worktree"
    if is_dir(target.parent) and _toplevel(target.parent) != path_key(worktree):
        return "it is inside another repository"
    admin = _admin(worktree)
    if admin is None:
        return "git's record of the worktree is gone"
    try:
        os.lstat(admin / "locked")
    except FileNotFoundError:
        pass
    except OSError:
        return "whether the worktree is locked cannot be read"
    else:
        return "the worktree was locked (kept) since planning"
    if busy_reason(worktree, run.processes_for(str(worktree))):
        return "a process is using the worktree"
    st = status(worktree, admin, timeout=60)
    if st.operation:
        return f"a {st.operation} started"
    activity = last_activity(worktree, admin, st.changed, [])
    outputs = [
        Path(a.target)
        for a in run.actions
        if a.kind == "strip" and a.worktree == action.worktree and a.target_kind != "link"
    ]
    if not outputs and action.target_kind != "link":
        outputs = [target]
    for folder in outputs:
        built = newest_mtime(folder)
        if built is not None and (activity is None or built > activity):
            activity = built
    if activity is not None and action.due_days is not None:
        idle = time.time() - activity
        if idle < action.due_days * DAY:
            return f"the worktree was active {round(idle / 3600, 1)} hours ago"
    if rel in tracked_under(worktree, [rel]):
        return "it now holds a tracked file"
    if rel not in ignored(worktree, [rel]):
        return "git no longer ignores it"
    return None


def _recheck_aged(action: Action, run: Run) -> str | None:
    target = Path(action.target)
    refused = unsafe_aged_root(target, run.protected)
    if refused:
        return refused
    problem = _volume_problem(action.target, run.ctx)
    if problem:
        return problem
    if _identity(action.target) != action.identity:
        return "it was replaced since planning"
    if newest_mtime(target, AGED_DEPTH) != action.planned_mtime:
        return "it changed since planning"
    processes = running_processes()
    if tool_running(RUST_BUILDERS, processes) or busy_reason(target, processes):
        return "a build or process is using it"
    return None


# ── Carrying out ────────────────────────────────────────────────────────────


def _record_strip(action: Action) -> None:
    admin = _admin(Path(action.worktree or ""))
    if admin is None:
        return
    record = admin / STRIP_RECORD
    try:
        existing = json.loads(record.read_text(encoding="utf-8")) if record.exists() else {}
    except (OSError, ValueError):
        existing = {}
    paths = sorted(set(existing.get("paths", [])) | {action.target})
    stamp = datetime.now(UTC).isoformat(timespec="seconds")
    _write_atomic(record, json.dumps({"stripped_at": stamp, "paths": paths}, indent=1))


def _do_remove(action: Action) -> None:
    try:
        removal = remove_inside(Path(action.target), Path(action.root or ""))
    except UnsafePath as exc:
        action.outcome, action.detail = "refused", str(exc)
        return
    action.removed_bytes = removal.removed_bytes
    if removal.errors:
        action.outcome = "partial"
        action.detail = f"{len(removal.errors)} left: {removal.errors[0]}"
    else:
        action.outcome = "done"


def tool_running(names: tuple[str, ...], processes: Processes) -> bool:
    """Whether a process runs one of these tools, as the program or a script it runs."""
    if not processes.ok:
        return True
    words = re.compile(
        r"(?:^|[\\/\s\"'])(?:" + "|".join(re.escape(n) for n in names)
        + r")(?:\.exe|\.cjs|\.js|\.cmd)?(?=$|[\s\"'])",
        re.IGNORECASE,
    )
    return any(words.search(line) for line in processes.cmdlines)


def _run_cache(action: Action) -> None:
    args = {"pnpm": ["pnpm", "store", "prune"], "uv": ["uv", "cache", "prune"]}.get(action.target)
    if args is None:
        action.outcome, action.detail = "skipped", "no prune command"
        return
    if tool_running((action.target,), running_processes()):
        action.outcome, action.detail = "skipped", f"{action.target} is running"
        return
    exe = shutil.which(args[0])
    if exe is None:
        action.outcome, action.detail = "skipped", f"{args[0]} not found"
        return
    with command(f"pruning the {action.target} cache", allow=1800):
        done = subprocess.run(
            [exe, *args[1:]], cwd=action.root, capture_output=True, text=True, timeout=1800,
            check=False,
        )
    action.outcome = "done" if done.returncode == 0 else "failed"
    lines = (done.stdout or done.stderr).strip().splitlines()
    action.detail = lines[-1] if lines else None


def _failed_prior_file(action: Action, run: Run) -> Action | None:
    """An earlier file strip (such as build info) in the same folder or an ancestor inside the
    worktree that was not removed, so a folder strip must stay put (lushly-dev/afd#1939)."""
    if action.target_kind != "dir" or not action.worktree:
        return None
    worktree_key = path_key(action.worktree)
    ancestors: set[str] = set()
    cur = Path(action.target).parent
    while True:
        cur_key = path_key(cur)
        ancestors.add(cur_key)
        if cur_key == worktree_key or cur.parent == cur:
            break
        cur = cur.parent
    for prior in run.actions:
        if (
            prior is action
            or prior.kind != "strip"
            or prior.worktree != action.worktree
            or prior.target_kind != "file"
            or prior.outcome == "done"
        ):
            continue
        if path_key(Path(prior.target).parent) in ancestors:
            return prior
    return None


def carry_out(action: Action, run: Run) -> None:
    """Do one action, or record why not. Never raises for a filesystem or git problem."""
    if not run.apply:
        return
    doing("reclaiming", action.target)
    try:
        if action.kind == "strip":
            blocker = _failed_prior_file(action, run)
            if blocker is not None:
                rel = Path(blocker.target).relative_to(Path(action.worktree or "")).as_posix()
                why = f"{blocker.outcome}: {blocker.detail}" if blocker.detail else blocker.outcome
                action.outcome = "skipped"
                action.detail = f"build info {rel} was not removed ({why})"
                return
            reason = _recheck_strip(action, run)
            if reason:
                action.outcome, action.detail = "skipped", reason
                return
            _do_remove(action)
            if action.outcome in ("done", "partial"):
                _record_strip(action)
        elif action.kind == "aged":
            reason = _recheck_aged(action, run)
            if reason:
                action.outcome, action.detail = "skipped", reason
                return
            _do_remove(action)
        elif action.kind == "cache":
            _run_cache(action)
        elif action.kind == "remove":
            _carry_out_removal(action, run)
    except (GitError, OSError, ValueError, subprocess.SubprocessError) as exc:
        action.outcome, action.detail = "skipped", f"could not be checked: {exc}"


def _repository(main: Path, run: Run) -> Path:
    """The repository folder Factory names its slots after, from the run's worktree lists."""
    for common, worktrees in run.ctx.listed.values():
        if worktrees and path_key(worktrees[0].path) == path_key(main):
            return repository_of(common)
    return main


def _t3_owned(target: Path, run: Run, repository: Path) -> str | None:
    """Ownership read again: never remove what T3 Code or Factory manages, or when T3 Code's
    settings cannot tell."""
    roots, read_ok = t3_worktree_roots(run.ctx.settings)
    if not read_ok:
        return "T3 Code's settings cannot be read, so its worktrees are unknown"
    owner = manager(target, roots, repository)
    return MANAGERS[owner] if owner else None


def _carry_out_removal(action: Action, run: Run) -> None:
    target, main = Path(action.target), Path(action.root or "")
    config = run.configs.get(path_key(main))
    if config is None:
        action.outcome, action.detail = "skipped", "the repository's [disk] settings are gone"
        return
    if action.landed and path_key(main) in run.unfetched:
        action.outcome = "skipped"
        why = run.unfetched[path_key(main)]
        action.detail = f"{config.landing_ref} could not be refreshed: {why}"
        return
    busy = busy_reason(target, run.processes_for(action.target))
    reason = recheck_removal(
        target, main, action.head, bool(action.landed), action.due_days or 0, config, busy,
        action.outputs, volume_problem=lambda p: _volume_problem(p, run.ctx),
        t3_owned=lambda p: _t3_owned(p, run, _repository(main, run)),
        checkouts=run.ctx.checkouts,
    )
    if reason:
        action.outcome, action.detail = "skipped", reason
        return
    try:
        refs = pin_commits(target, main, action.head or "")
    except (GitError, ReflogTooLong) as exc:
        action.outcome, action.detail = "skipped", f"its commits could not be pinned: {exc}"
        return
    try:
        record_id = begin_record(target, main, action.branch, action.head, refs)
    except OSError as exc:
        unpin(main, refs)
        action.outcome, action.detail = "skipped", f"the removal could not be recorded: {exc}"
        return
    done, problem = remove_worktree(target, main)
    if not done:
        unpin(main, refs)
        finish_record(record_id, "failed", problem)
        action.outcome, action.detail = "failed", problem
        return
    finish_record(record_id, "removed")
    action.outcome = "done"
    action.detail = f"removed; its commits are pinned under {refs[0]}; disk-restore {target}"


def plan_tier2(data: dict, run: Run, include_restorable: bool) -> list[Action]:
    due = run.ctx.settings.remove_landed_after_days
    return [
        Action(kind="remove", target=p["target"], root=p["main"], worktree=p["target"],
               pattern=None, bytes_estimate=p["bytes"], due_days=p["due_days"], head=p["head"],
               branch=p["branch"], landed=p["landed"], outputs=p["outputs"],
               detail=p["landed"] or "restorable: nothing unique, not landed")
        for p in plan_removals(data, include_restorable, due)
    ]


def refresh_landing(main: Path, landing_ref: str) -> str | None:
    """Fetch only the landing ref's branch from its own remote: no prune, no prompts, no
    automatic maintenance. Returns why it failed, or None. A local landing ref needs nothing."""
    try:
        remotes = git_out(main, "remote", timeout=30).split()
    except GitError as exc:
        return str(exc)
    ref = landing_ref.removeprefix("refs/remotes/")
    remote = next((r for r in remotes if ref.startswith(f"{r}/")), None)
    if remote is None:
        return None
    branch = ref[len(remote) + 1:]
    try:
        configured = git_out(main, "config", "--get", "core.sshCommand", timeout=30).strip()
    except GitError:
        configured = ""
    ssh = f"{configured or 'ssh'} -o BatchMode=yes"  # the user's own command, never prompting
    try:
        git_out(main, "-c", "gc.auto=0", "-c", "maintenance.auto=false",
                "-c", f"core.sshCommand={ssh}", "fetch", "--quiet", "--no-prune", "--no-tags",
                remote, branch, timeout=120)
    except GitError as exc:
        return str(exc)
    return None


# ── Receipts and status ─────────────────────────────────────────────────────


def _write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _free(ctx: Context) -> dict[str, int]:
    free = {}
    for mount, vol in ctx.volumes.items():
        if vol.mounted:
            try:
                free[mount] = shutil.disk_usage(mount).free
            except OSError:
                continue
    return free


def prune_receipts(folder: Path, keep: Path | None = None) -> None:
    """Keep the newest MAX_RECEIPTS receipts and at most MAX_RECEIPT_BYTES; never `keep`."""
    files = sorted(folder.glob("*.json"), key=lambda p: p.name, reverse=True)
    total = 0
    for index, path in enumerate(files):
        if keep is not None and path == keep:
            total += path.stat().st_size
            continue
        total += path.stat().st_size
        if index >= MAX_RECEIPTS or total > MAX_RECEIPT_BYTES:
            path.unlink(missing_ok=True)


def write_receipt(payload: dict) -> Path:
    folder = state_path() / "receipts"
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    mode = "apply" if payload["apply"] else "dry"
    path = folder / f"{stamp}-{mode}-{os.getpid()}-{secrets.token_hex(3)}.json"
    text = json.dumps(payload, indent=1, default=str)
    if len(text) > MAX_ONE_RECEIPT:
        trimmed = dict(payload, actions=payload["actions"][:1000],
                       actions_truncated=len(payload["actions"]))
        text = json.dumps(trimmed, indent=1, default=str)
    _write_atomic(path, text)
    prune_receipts(folder, keep=path)
    return path


def write_status(payload: dict, receipt: Path) -> None:
    """Update status.json; called only while holding the run lock."""
    folder = state_path()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "status.json"
    try:
        current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, ValueError):
        current = {}
    now = datetime.now(UTC).isoformat(timespec="seconds")
    key = "last_apply" if payload["apply"] else "last_dry_run"
    current[key] = {
        "at": now,
        "ok": not payload["failures"] and not payload.get("error"),
        "receipt": str(receipt),
        "reclaimed_gb": payload["reclaimed_gb"],
        "still_low": payload["still_low"],
        "free_after": payload.get("free_after", {}),
    }
    current["volumes"] = payload["volumes_after"]
    # Per repository, and only where its count was established: a run that ran out of time,
    # could not list a repository or was given one with --repo leaves the others as they were
    snapshot = current.get("worktree_warnings")
    repos = dict(snapshot.get("repos") or {}) if isinstance(snapshot, dict) else {}
    for entry in payload.get("idle", []):
        if entry.get("complete"):
            repos[entry["main"]] = {"at": now, "count": entry["count"],
                                    "checkout": entry.get("checkout"),
                                    "warning": entry.get("warning")}
    current["worktree_warnings"] = {"repos": repos}
    _write_atomic(path, json.dumps(current, indent=1))


# ── The command ─────────────────────────────────────────────────────────────


def _execute(run: Run, actions: list[Action]) -> None:
    for action in actions:
        run.add(action)
    for action in run.actions:
        if action.outcome == "planned":
            carry_out(action, run)


def _low(ctx: Context) -> list[str]:
    low = []
    for mount, vol in ctx.volumes.items():
        fresh = volume_state(Path(mount), vol.id_expected, vol.low_space_gb)
        ctx.volumes[mount] = fresh
        if fresh.low:
            low.append(mount)
    return low


async def disk_reclaim(
    tier: int = 1,
    apply: bool = False,
    repo: str | None = None,
    pressure: bool = False,
    budget_seconds: float = 300,
    include_restorable: bool = False,
) -> CommandResult[dict]:
    """Prune caches and aged folders (tier 0), strip idle build output (tier 1), and remove
    finished worktrees (tier 2).

    A dry run unless apply=True (a dry run still writes a receipt). When a watched volume is
    below its threshold, or pressure=True, tier 1 also strips `when = "pressure"` patterns and
    lowers its idle thresholds in steps (1 day, then 6 hours) until the volume recovers; with
    pressure=True every step runs. Tier 2 removes worktrees T3 Code does not manage that hold
    nothing unique and whose work has landed; include_restorable also removes those that hold
    nothing unique but have not landed. Branches are kept; disk_restore brings one back.
    """
    if tier not in (0, 1, 2):
        return error("DISK_TIER_INVALID", f"tier {tier} is not 0, 1 or 2",
                     suggestion="Pass tier=0 for caches, 1 to also strip build output, "
                                "2 to also remove finished worktrees")
    if include_restorable and tier < 2:
        return error("DISK_TIER_INVALID", "include_restorable needs tier=2",
                     suggestion="Pass tier=2 with include_restorable")
    try:
        settings, _path, _found = load_machine_settings()
    except SettingsError as exc:
        return settings_error(exc)
    try:
        with RunLock(state_path() / "run.lock"):
            payload = _reclaim(settings, tier, apply, repo, pressure, budget_seconds,
                               include_restorable)
    except LockHeld as exc:
        return error("DISK_RUN_IN_PROGRESS", str(exc),
                     suggestion="Wait for the other run to finish, then run again")
    if payload.get("error"):
        return error("DISK_RECLAIM_FAILED", payload["error"],
                     suggestion=f"Read the receipt {payload.get('receipt')}; the run stopped early")
    suggestions = [] if apply else ["Run again with apply=True to carry out this plan"]
    return success(data=payload, suggestions=suggestions)


def _protected(data: dict, ctx: Context) -> list[Path]:
    paths = [Path(w["path"]) for r in data["repos"] for w in r.get("worktrees", [])]
    paths += [Path(r["git_common_dir"]) for r in data["repos"] if r.get("git_common_dir")]
    return paths + list(ctx.t3_roots)


def _plan_and_run(run: Run, data: dict, pressure: bool, include_restorable: bool) -> None:
    _execute(run, plan_tier0(data))
    if run.tier < 1:
        return
    ctx = run.ctx
    removed: set[str] = set()
    if run.tier >= 2:
        removals = plan_tier2(data, run, include_restorable)
        if run.apply:
            for main in {a.root for a in removals if a.landed}:
                config = run.configs.get(path_key(main or ""))
                if config is not None:
                    problem = refresh_landing(Path(main or ""), config.landing_ref)
                    if problem:
                        run.unfetched[path_key(main or "")] = problem
        _execute(run, removals)
        removed = {a.target for a in removals if a.outcome in ("done", "planned")}
    _execute(run, [a for a in plan_strips(data, None, False, ctx, only_low=False)
                   if a.worktree not in removed])
    if not (pressure or _low(ctx)):
        return
    for step in PRESSURE_STEPS[1:]:
        _execute(run, plan_strips(data, step, True, ctx, only_low=not pressure))
        if run.apply and not pressure and not _low(ctx):
            break


def _idle_after(data: dict, run: Run) -> dict:
    """Each repository's idle count once this run's removals are taken off, and its warnings."""
    gone = {path_key(a.target) for a in run.actions if a.kind == "remove" and a.outcome == "done"}
    idle, warnings = [], []
    for repo_row in data["repos"]:
        if "idle_worktrees" not in repo_row:
            continue  # its worktrees were not listed, or its [disk] could not be read
        count_idle(repo_row, run.ctx.settings, gone)
        counted = repo_row["idle_worktrees"]
        idle.append({"main": repo_row["main"], "checkout": repo_row.get("checkout"),
                     "count": counted["count"],
                     "complete": counted["complete"], "warning": repo_row.get("warning")})
        if repo_row.get("warning"):
            warnings.append(repo_row["warning"])
    return {"idle": idle, "warnings": warnings}


def _reclaim(  # noqa: PLR0913 - the command's own arguments
    settings, tier, apply, repo, pressure, budget_seconds, include_restorable=False,
) -> dict:
    data, pairs, ctx = build_report(settings, repo, budget_seconds=budget_seconds)
    configs = {path_key(row["main"]): config for row, config in pairs
               if config is not None and row.get("main")}
    run = Run(apply=apply, tier=tier, ctx=ctx, protected=_protected(data, ctx), configs=configs)
    before = _free(ctx)
    failure = None
    try:
        _plan_and_run(run, data, pressure, include_restorable)
    except Exception as exc:  # noqa: BLE001 - the receipt must be written whatever happened
        failure = f"{type(exc).__name__}: {exc}"
    # (A reclaim the hourly job has left is told so by `steps.Left`, which is not an
    # Exception and passes through here: like one that was killed, it writes no receipt and
    # no status, so the next hour's run finds it still due. Writing them would read the
    # volumes again, which a step that was left must not begin.)
    after = _free(ctx)
    reclaimed = {m: round((after.get(m, 0) - before.get(m, 0)) / 1024**3, 2) for m in before}
    payload = {
        "apply": apply,
        "tier": tier,
        "actions": [asdict(a) for a in run.actions],
        "planned_gb": round(sum(a.bytes_estimate or 0 for a in run.actions) / 1024**3, 2),
        "reclaimed_gb": reclaimed if apply else {},
        "failures": [asdict(a) for a in run.actions if a.outcome in ("failed", "partial")],
        "still_low": _low(ctx) if apply else [],
        "free_after": after,
        "volumes_after": [v.as_dict() for v in ctx.volumes.values()],
        **_idle_after(data, run),
        "error": failure,
    }
    # (the volumes and worktrees were read once more for this: a reclaim the job left while
    # one of them waited is told here, and writes neither receipt nor status)
    doing("writing its receipt in", state_path())
    receipt = write_receipt(payload)
    write_status(payload, receipt)
    payload["receipt"] = str(receipt)
    return payload
