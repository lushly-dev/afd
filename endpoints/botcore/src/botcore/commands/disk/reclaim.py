"""`disk-reclaim`: carry out tier 0 (caches, aged folders) and tier 1 (idle build output).

A dry run unless `apply=True`. Plans come from the same code as disk-report; right before each
deletion the worktree's activity, its processes and the path's git state are checked again, so
a worktree that came back to life between planning and deleting is left alone. One run at a
time per machine. Every run writes a receipt; space reclaimed is the change in free space.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.git import GitError, git_out, ignored, status, tracked_under
from botcore.commands.disk.lock import LockHeld, RunLock
from botcore.commands.disk.remove import UnsafePath, remove_inside
from botcore.commands.disk.report import Context, build_report, settings_error, volume_for
from botcore.commands.disk.scan import (
    DAY,
    Processes,
    busy_reason,
    last_activity,
    running_processes,
)
from botcore.commands.disk.settings import SettingsError, load_machine_settings, state_path

STRIP_RECORD = "botcore-disk-strip.json"
MAX_RECEIPTS = 30
MAX_RECEIPT_BYTES = 50 * 1024 * 1024
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
    step: str = "normal"
    outcome: str = "planned"
    detail: str | None = None
    removed_bytes: int = 0


@dataclass
class Run:
    apply: bool
    tier: int
    actions: list[Action] = field(default_factory=list)
    seen: set[str] = field(default_factory=set)
    _processes: Processes | None = None
    _taken: float = 0.0

    def processes(self) -> Processes:
        """A process snapshot at most a minute old, taken after planning."""
        if self._processes is None or time.monotonic() - self._taken > 60:
            self._processes = running_processes()
            self._taken = time.monotonic()
        return self._processes

    def add(self, action: Action) -> None:
        key = f"{action.kind}:{action.target}"
        if key not in self.seen:
            self.seen.add(key)
            self.actions.append(action)


# ── Planning ────────────────────────────────────────────────────────────────


def _strippable(row: dict, repo: dict) -> bool:
    return bool(
        row.get("exists")
        and not row.get("main")
        and row.get("locked") is None
        and not row.get("busy")
        and not repo.get("blocked")
    )


def _volume_low(path: str, ctx: Context) -> bool:
    vol = volume_for(Path(path), ctx)
    return bool(vol and vol.low)


def plan_strips(
    data: dict, step: float | None, include_pressure: bool, ctx: Context, only_low: bool,
) -> list[Action]:
    actions = []
    for repo in data["repos"]:
        for row in repo.get("worktrees", []):
            if not _strippable(row, repo) or row.get("idle_days") is None:
                continue
            if only_low and not _volume_low(row["path"], ctx):
                continue
            for item in row.get("strip", []):
                if item["when"] == "pressure" and not include_pressure:
                    continue
                due = item["after_days"] if step is None else min(item["after_days"], step)
                if row["idle_days"] < due:
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


def plan_tier0(data: dict) -> list[Action]:
    actions = []
    for cache in data.get("caches", []):
        if cache.get("action"):
            actions.append(Action(kind="cache", target=cache["name"], detail=cache["action"]))
    for aged in data.get("aged", []):
        for entry in aged["entries"]:
            if entry["eligible"]:
                actions.append(Action(
                    kind="aged",
                    target=entry["path"],
                    root=str(Path(entry["path"]).parent),
                    bytes_estimate=entry.get("bytes"),
                    detail=f"age {entry['age_days']} days",
                ))
    return actions


# ── Carrying out ────────────────────────────────────────────────────────────


def _admin(worktree: Path) -> Path | None:
    try:
        return Path(git_out(worktree, "rev-parse", "--absolute-git-dir").strip())
    except GitError:
        return None


def _recheck_strip(action: Action, run: Run) -> str | None:
    """Why this strip must not happen now, or None. Read immediately before deleting."""
    worktree = Path(action.worktree or "")
    rel = Path(action.target).relative_to(worktree).as_posix()
    if busy_reason(worktree, run.processes()):
        return "a process started using the worktree"
    admin = _admin(worktree)
    st = status(worktree, admin)
    if st.operation:
        return f"a {st.operation} is in progress"
    activity = last_activity(worktree, admin, st.changed, [])
    if activity is not None and action.due_days is not None:
        idle = (time.time() - activity) / DAY
        if idle < action.due_days:
            return f"the worktree was active {round(idle * 24, 1)} hours ago"
    if rel in tracked_under(worktree, [rel]):
        return "it now holds a tracked file"
    if rel not in ignored(worktree, [rel]):
        return "git no longer ignores it"
    return None


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
    record.write_text(json.dumps({"stripped_at": stamp, "paths": paths}, indent=1), "utf-8")


def _do_remove(action: Action) -> None:
    try:
        removal = remove_inside(Path(action.target), Path(action.root or ""))
    except UnsafePath as exc:
        action.outcome, action.detail = "refused", str(exc)
        return
    action.removed_bytes = removal.removed_bytes
    if removal.errors:
        action.outcome = "partial"
        action.detail = f"{len(removal.errors)} could not be removed: {removal.errors[0]}"
    else:
        action.outcome = "done"


def tool_running(names: tuple[str, ...], processes: Processes) -> bool:
    """Whether a process runs one of these tools, as the program or a script it runs."""
    words = re.compile(
        r"(?:^|[\\/\s\"'])(?:" + "|".join(re.escape(n) for n in names)
        + r")(?:\.exe|\.cjs|\.js|\.cmd)?(?=$|[\s\"'])",
        re.IGNORECASE,
    )
    return any(words.search(line) for line in processes.cmdlines)


def _run_cache(action: Action, cwd: Path | None, run: Run) -> None:
    args = {"pnpm": ["pnpm", "store", "prune"], "uv": ["uv", "cache", "prune"]}.get(action.target)
    if args is None:
        action.outcome, action.detail = "skipped", "no prune command"
        return
    if tool_running((action.target,), run.processes()):
        action.outcome, action.detail = "skipped", f"{action.target} is running"
        return
    exe = shutil.which(args[0])
    if exe is None:
        action.outcome, action.detail = "skipped", f"{args[0]} not found"
        return
    try:
        done = subprocess.run(
            [exe, *args[1:]], cwd=cwd, capture_output=True, text=True, timeout=1800, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        action.outcome, action.detail = "failed", str(exc)
        return
    action.outcome = "done" if done.returncode == 0 else "failed"
    lines = (done.stdout or done.stderr).strip().splitlines()
    action.detail = lines[-1] if lines else None


def carry_out(action: Action, run: Run, ctx: Context, cwd: Path | None) -> None:
    if not run.apply:
        return
    if action.kind == "strip":
        reason = _recheck_strip(action, run)
        if reason:
            action.outcome, action.detail = "skipped", reason
            return
        _do_remove(action)
        if action.outcome in ("done", "partial"):
            _record_strip(action)
    elif action.kind == "aged":
        processes = run.processes()
        if tool_running(RUST_BUILDERS, processes) or busy_reason(Path(action.target), processes):
            action.outcome, action.detail = "skipped", "a build or process is using it"
            return
        _do_remove(action)
    elif action.kind == "cache":
        _run_cache(action, cwd, run)


# ── Receipts and status ─────────────────────────────────────────────────────


def _free(ctx: Context) -> dict[str, int]:
    free = {}
    for mount, vol in ctx.volumes.items():
        if vol.mounted:
            free[mount] = shutil.disk_usage(mount).free
    return free


def prune_receipts(folder: Path) -> None:
    """Keep the newest MAX_RECEIPTS receipts and at most MAX_RECEIPT_BYTES in all."""
    files = sorted(folder.glob("*.json"), key=lambda p: p.name, reverse=True)
    total = 0
    for index, path in enumerate(files):
        size = path.stat().st_size
        total += size
        if index >= MAX_RECEIPTS or total > MAX_RECEIPT_BYTES:
            path.unlink(missing_ok=True)


def write_receipt(payload: dict) -> Path:
    folder = state_path() / "receipts"
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = folder / f"{stamp}-{'apply' if payload['apply'] else 'dry'}.json"
    path.write_text(json.dumps(payload, indent=1, default=str), encoding="utf-8")
    prune_receipts(folder)
    return path


def write_status(payload: dict, receipt: Path) -> None:
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
        "ok": not payload["failures"],
        "receipt": str(receipt),
        "reclaimed_gb": payload["reclaimed_gb"],
        "still_low": payload["still_low"],
    }
    current["volumes"] = payload["volumes_after"]
    path.write_text(json.dumps(current, indent=1), encoding="utf-8")


# ── The command ─────────────────────────────────────────────────────────────


def _execute(run: Run, actions: list[Action], ctx: Context, cwd: Path | None) -> None:
    for action in actions:
        run.add(action)
    for action in run.actions:
        if action.outcome == "planned":
            carry_out(action, run, ctx, cwd)


def _low(ctx: Context, data: dict) -> list[str]:
    from botcore.commands.disk.scan import volume_state

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

    A dry run unless apply=True. When a watched volume is below its threshold, or pressure=True,
    tier 1 also strips `when = "pressure"` patterns and lowers its idle thresholds in steps
    (1 day, then 6 hours) until the volume recovers. Removing worktrees is not done here.
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
    suggestions = [] if apply else ["Run again with apply=True to carry out this plan"]
    return success(data=payload, suggestions=suggestions)


def _reclaim(settings, tier, apply, repo, pressure, budget_seconds) -> dict:
    data, _pairs, ctx = build_report(settings, repo, budget_seconds=budget_seconds)
    run = Run(apply=apply, tier=tier)
    cwd = Path(data["repos"][0]["main"]) if data["repos"] and data["repos"][0].get("main") else None
    before = _free(ctx)
    _execute(run, plan_tier0(data), ctx, cwd)
    if tier >= 1:
        _execute(run, plan_strips(data, None, False, ctx, only_low=False), ctx, cwd)
        low = _low(ctx, data)
        if pressure or low:
            for step in PRESSURE_STEPS[1:]:
                _execute(run, plan_strips(data, step, True, ctx, only_low=not pressure), ctx, cwd)
                if apply and not _low(ctx, data):
                    break
    after = _free(ctx)
    reclaimed = {m: round((after.get(m, 0) - before.get(m, 0)) / 1024**3, 2) for m in before}
    payload = {
        "apply": apply,
        "tier": tier,
        "actions": [asdict(a) for a in run.actions],
        "planned_gb": round(sum(a.bytes_estimate or 0 for a in run.actions) / 1024**3, 2),
        "reclaimed_gb": reclaimed if apply else {},
        "failures": [asdict(a) for a in run.actions if a.outcome in ("failed", "partial")],
        "still_low": _low(ctx, data) if apply else [],
        "volumes_after": [v.as_dict() for v in ctx.volumes.values()],
    }
    receipt = write_receipt(payload)
    write_status(payload, receipt)
    payload["receipt"] = str(receipt)
    return payload
