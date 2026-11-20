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

from botcore.commands.disk.caches import unsafe_aged_root
from botcore.commands.disk.git import (
    GitError,
    git_out,
    ignored,
    path_key,
    status,
    tracked_under,
)
from botcore.commands.disk.lock import LockHeld, RunLock
from botcore.commands.disk.remove import UnsafePath, remove_inside
from botcore.commands.disk.report import Context, build_report, settings_error, volume_for
from botcore.commands.disk.scan import (
    DAY,
    Processes,
    busy_reason,
    last_activity,
    newest_mtime,
    running_processes,
    volume_state,
)
from botcore.commands.disk.settings import SettingsError, load_machine_settings, state_path

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

    kind: str  # "strip", "cache" or "aged"
    target: str
    root: str | None = None
    worktree: str | None = None
    pattern: str | None = None
    bytes_estimate: int | None = None
    due_days: float | None = None
    planned_mtime: float | None = None
    identity: tuple[int, int] | None = None
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
            for item in row.get("strip", []):
                if item["when"] == "pressure" and not include_pressure:
                    continue
                due = item["after_days"] if step is None else min(item["after_days"], step)
                if idle < due * DAY:
                    continue
                actions.append(Action(
                    kind="strip",
                    target=str(Path(row["path"]) / item["path"]),
                    root=row["path"],
                    worktree=row["path"],
                    pattern=item["pattern"],
                    bytes_estimate=item.get("bytes"),
                    due_days=due,
                    step="normal" if step is None else f"pressure-{step}d",
                    detail=f"due after {due} days; idle {row['idle_days']}",
                ))
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
    if os.path.islink(worktree) or not worktree.is_dir():
        return "the worktree folder changed since planning"
    if _toplevel(worktree) != path_key(worktree):
        return "the folder is no longer this worktree"
    if target.parent.is_dir() and _toplevel(target.parent) != path_key(worktree):
        return "it is inside another repository"
    admin = _admin(worktree)
    if admin is None:
        return "git's record of the worktree is gone"
    if (admin / "locked").exists():
        return "the worktree was locked (kept) since planning"
    if busy_reason(worktree, run.processes_for(str(worktree))):
        return "a process is using the worktree"
    st = status(worktree, admin, timeout=60)
    if st.operation:
        return f"a {st.operation} started"
    activity = last_activity(worktree, admin, st.changed, [])
    outputs = [
        Path(a.target) for a in run.actions if a.kind == "strip" and a.worktree == action.worktree
    ]
    for folder in outputs or [target]:
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
    if newest_mtime(target) != action.planned_mtime:
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
    done = subprocess.run(
        [exe, *args[1:]], cwd=action.root, capture_output=True, text=True, timeout=1800,
        check=False,
    )
    action.outcome = "done" if done.returncode == 0 else "failed"
    lines = (done.stdout or done.stderr).strip().splitlines()
    action.detail = lines[-1] if lines else None


def carry_out(action: Action, run: Run) -> None:
    """Do one action, or record why not. Never raises for a filesystem or git problem."""
    if not run.apply:
        return
    try:
        if action.kind == "strip":
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
    except (GitError, OSError, ValueError, subprocess.SubprocessError) as exc:
        action.outcome, action.detail = "skipped", f"could not be checked: {exc}"


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
) -> CommandResult[dict]:
    """Prune caches and aged folders (tier 0) and strip idle build output (tier 1).

    A dry run unless apply=True (a dry run still writes a receipt). When a watched volume is
    below its threshold, or pressure=True, tier 1 also strips `when = "pressure"` patterns and
    lowers its idle thresholds in steps (1 day, then 6 hours) until the volume recovers; with
    pressure=True every step runs. Removing worktrees is not done here.
    """
    if tier not in (0, 1):
        return error("DISK_TIER_INVALID", f"tier {tier} is not 0 or 1",
                     suggestion="Pass tier=0 for caches only or tier=1 to also strip build output")
    try:
        settings, _path, _found = load_machine_settings()
    except SettingsError as exc:
        return settings_error(exc)
    try:
        with RunLock(state_path() / "run.lock"):
            payload = _reclaim(settings, tier, apply, repo, pressure, budget_seconds)
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


def _plan_and_run(run: Run, data: dict, pressure: bool) -> None:
    _execute(run, plan_tier0(data))
    if run.tier < 1:
        return
    ctx = run.ctx
    _execute(run, plan_strips(data, None, False, ctx, only_low=False))
    if not (pressure or _low(ctx)):
        return
    for step in PRESSURE_STEPS[1:]:
        _execute(run, plan_strips(data, step, True, ctx, only_low=not pressure))
        if run.apply and not pressure and not _low(ctx):
            break


def _reclaim(settings, tier, apply, repo, pressure, budget_seconds) -> dict:
    data, _pairs, ctx = build_report(settings, repo, budget_seconds=budget_seconds)
    run = Run(apply=apply, tier=tier, ctx=ctx, protected=_protected(data, ctx))
    before = _free(ctx)
    failure = None
    try:
        _plan_and_run(run, data, pressure)
    except Exception as exc:  # noqa: BLE001 - the receipt must be written whatever happened
        failure = f"{type(exc).__name__}: {exc}"
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
        "error": failure,
    }
    receipt = write_receipt(payload)
    write_status(payload, receipt)
    payload["receipt"] = str(receipt)
    return payload
