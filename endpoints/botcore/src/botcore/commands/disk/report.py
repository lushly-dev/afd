"""`disk-report`: every worktree of every registered repository, with what could be reclaimed.

Read-only. The tiers are the proposal's (docs/features/active/disk-hygiene/): 0 tool caches and
aged cache folders, 1 build output in an idle worktree, 3 report only. Removing finished
worktrees (tier 2) is a later piece; until then such worktrees are reported, not classified.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk import caches as cache_mod
from botcore.commands.disk.git import (
    GitError,
    Worktree,
    ignored,
    list_worktrees,
    status,
    tracked_under,
)
from botcore.commands.disk.scan import (
    DAY,
    Candidate,
    Processes,
    VolumeState,
    allocated,
    busy_reason,
    find_candidates,
    last_activity,
    mount_point,
    running_processes,
    volume_state,
)
from botcore.commands.disk.settings import (
    MachineSettings,
    SettingsError,
    expand,
    load_machine_settings,
    read_repo_disk_config,
    t3_worktree_roots,
)
from botcore.config import DiskConfig


@dataclass
class Context:
    """What one report run reads once and shares."""

    settings: MachineSettings
    processes: Processes
    volumes: dict[str, VolumeState]
    t3_roots: list[Path]
    deadline: float
    now: float = field(default_factory=time.time)
    complete: bool = True


def _inside(root: Path, path: Path) -> bool:
    try:
        rel = os.path.relpath(os.path.normcase(path), os.path.normcase(root))
    except ValueError:  # different drives on Windows
        return False
    return rel != "." and not rel.startswith("..") and not os.path.isabs(rel)


def _volume_for(path: Path, ctx: Context) -> VolumeState | None:
    """The configured volume holding path, if any (longest mount first)."""
    best = None
    for mount, state in ctx.volumes.items():
        root = Path(mount)
        if (path == root or _inside(root, path)) and (
            best is None or len(mount) > len(best.mount)
        ):
            best = state
    return best


def _strippable(worktree: Path, found: list[Candidate]) -> tuple[list[Candidate], list[dict]]:
    """Candidates that may be stripped, and those refused with the reason."""
    refused: list[dict] = []
    keep: list[Candidate] = []
    real_root = os.path.realpath(worktree)
    for cand in found:
        if cand.kind != "link":
            real = os.path.realpath(worktree / cand.rel)
            if not real.startswith(real_root + os.sep):
                refused.append({"path": cand.rel, "reason": "resolves outside the worktree"})
                continue
        keep.append(cand)
    rels = [c.rel for c in keep]
    ignored_set = ignored(worktree, rels)
    tracked = tracked_under(worktree, rels)
    result: list[Candidate] = []
    for cand in keep:
        if cand.rel in tracked:
            refused.append({"path": cand.rel, "reason": "holds a tracked file"})
        elif cand.rel not in ignored_set:
            refused.append({"path": cand.rel, "reason": "not ignored by git"})
        else:
            result.append(cand)
    return result, refused


def _threshold(cand: Candidate, ctx: Context) -> float:
    if cand.pattern.after_days is not None:
        return cand.pattern.after_days
    return ctx.settings.strip_after_days


def _keep_reasons(wt: Worktree, busy: str | None, managed: bool) -> list[str]:
    reasons = []
    if wt.is_main:
        reasons.append("main checkout")
    if wt.locked is not None:
        reasons.append(f"kept: {wt.locked}" if wt.locked else "kept (git worktree lock)")
    if busy:
        reasons.append(f"busy: {busy}")
    if managed:
        reasons.append("T3 Code removes this worktree (its storage cleanup)")
    return reasons


def _strip_plan(
    path: Path, cands: list[Candidate], idle_days: float | None, ctx: Context,
) -> tuple[list[dict], int]:
    plan: list[dict] = []
    bytes_now = 0
    for cand in cands:
        due = _threshold(cand, ctx)
        ready = idle_days is not None and idle_days >= due
        item = {
            "path": cand.rel,
            "kind": cand.kind,
            "pattern": cand.pattern.path,
            "when": cand.pattern.when,
            "after_days": due,
            "ready": ready and cand.pattern.when == "idle",
            "bytes": None,
        }
        if cand.pattern.when == "idle" and cand.kind == "dir":
            item["bytes"] = allocated(path / cand.rel, ctx.deadline)
            if item["bytes"] is None:
                ctx.complete = False
        if item["ready"] and item["bytes"]:
            bytes_now += item["bytes"]
        plan.append(item)
    return plan, bytes_now


def _worktree_row(wt: Worktree, config: DiskConfig, ctx: Context, blocked: str | None) -> dict:
    row: dict = {
        "path": str(wt.path),
        "branch": wt.branch,
        "head": wt.head,
        "detached": wt.detached,
        "main": wt.is_main,
        "exists": wt.path.exists(),
        "locked": wt.locked,
        "managed_by": None,
        "tier": None,
        "reasons": [],
    }
    if not row["exists"]:
        row["tier"] = 3
        row["reasons"].append(
            "missing: " + (blocked or "its folder is gone; git lists it as prunable")
        )
        return row
    managed = any(_inside(root, wt.path) for root in ctx.t3_roots)
    if managed:
        row["managed_by"] = "t3-code"
    st = status(wt.path, wt.admin)
    found, finished = find_candidates(wt.path, config.entries(), ctx.deadline)
    ctx.complete = ctx.complete and finished
    cands, refused = _strippable(wt.path, found)
    activity = last_activity(
        wt.path, wt.admin, st.changed, [wt.path / c.rel for c in cands if c.kind == "dir"]
    )
    idle_days = None if activity is None else round((ctx.now - activity) / DAY, 2)
    busy = busy_reason(wt.path, ctx.processes)
    row.update({
        "changed_files": len(st.changed),
        "operation": st.operation,
        "idle_days": idle_days,
        "busy": busy,
        "refused": refused,
    })
    row["reasons"] = _keep_reasons(wt, busy, managed)
    if blocked:
        row["reasons"].append(blocked)
    plan, bytes_now = _strip_plan(wt.path, cands, idle_days, ctx)
    row["strip"] = plan
    row["strip_ready_bytes"] = bytes_now
    can_strip = not (wt.is_main or wt.locked is not None or busy or blocked)
    if can_strip and any(p["ready"] for p in plan):
        row["tier"] = 1
    elif plan and can_strip:
        waiting = min(p["after_days"] for p in plan if p["when"] == "idle") if any(
            p["when"] == "idle" for p in plan
        ) else None
        if waiting is not None and idle_days is not None:
            row["reasons"].append(f"idle {idle_days} of {waiting} days")
    return row


def _repo_rows(checkout: Path, ctx: Context) -> tuple[dict, DiskConfig | None]:
    out: dict = {"checkout": str(checkout)}
    try:
        common, worktrees = list_worktrees(checkout)
    except GitError as exc:
        out["error"] = str(exc)
        return out, None
    main = worktrees[0].path if worktrees else checkout
    repo_cfg = read_repo_disk_config(main)
    out.update({
        "main": str(main),
        "git_common_dir": str(common),
        "config_ref": repo_cfg.ref,
        "config_source": repo_cfg.source,
    })
    if repo_cfg.error or repo_cfg.config is None:
        out["error"] = repo_cfg.error or "no [disk] settings"
        out["worktrees"] = []
        return out, None
    out["landing_ref"] = repo_cfg.config.landing_ref
    if not repo_cfg.config.regenerable:
        out["note"] = "no [disk].regenerable patterns: nothing in its worktrees is strippable"
    blocked = None
    for wt in worktrees:
        vol = _volume_for(wt.path, ctx)
        if vol is not None and not vol.verified:
            blocked = f"volume {vol.mount} is not mounted or is not the recorded volume"
    rows = []
    for wt in worktrees:
        try:
            rows.append(_worktree_row(wt, repo_cfg.config, ctx, blocked))
        except GitError as exc:
            rows.append({"path": str(wt.path), "tier": 3, "reasons": [f"git failed: {exc}"]})
    out["worktrees"] = rows
    if blocked:
        out["blocked"] = blocked
    return out, repo_cfg.config


def _repos(settings: MachineSettings, repo: str | None) -> list[Path]:
    if repo:
        return [expand(repo)]
    if settings.repos:
        return [expand(r) for r in settings.repos]
    return [Path.cwd()]


def _volumes(settings: MachineSettings, repos: list[Path]) -> dict[str, VolumeState]:
    states: dict[str, VolumeState] = {}
    for vol in settings.volume:
        mount = expand(vol.mount)
        states[str(mount)] = volume_state(mount, vol.id, vol.low_space_gb)
    for repo in repos:
        mount = mount_point(repo)
        states.setdefault(str(mount), volume_state(mount, None, None))
    return states


def _orphans(ctx: Context, known: set[str]) -> list[dict]:
    """Linked-worktree folders under configured roots that no registered repository lists."""
    rows = []
    roots = [expand(r) for r in ctx.settings.worktree_roots] + ctx.t3_roots
    for root in roots:
        if not root.is_dir():
            continue
        for first in _children(root):
            for folder in [first, *_children(first)]:
                git_file = folder / ".git"
                if git_file.is_file() and os.path.normcase(str(folder)) not in known:
                    reason = _orphan_reason(git_file)
                    rows.append({"path": str(folder), "tier": 3, "reason": reason})
    return rows


def _children(folder: Path) -> list[Path]:
    try:
        return [Path(e.path) for e in os.scandir(folder) if e.is_dir(follow_symlinks=False)]
    except OSError:
        return []


def _orphan_reason(git_file: Path) -> str:
    try:
        target = git_file.read_text(encoding="utf-8").strip().removeprefix("gitdir:").strip()
    except OSError:
        return "a worktree no registered repository lists"
    if not Path(target).exists():
        return "its repository's record of it is gone"
    return "a worktree of a repository the machine settings do not register"


def _totals(repos: list[dict], cache_rows: list[dict]) -> dict:
    strip = sum(w.get("strip_ready_bytes", 0) for r in repos for w in r.get("worktrees", []))
    counts: dict[str, int] = {"tier1": 0, "tier3": 0}
    for r in repos:
        for w in r.get("worktrees", []):
            if w.get("tier") == 1:
                counts["tier1"] += 1
            elif w.get("tier") == 3:
                counts["tier3"] += 1
    return {
        "tier1_worktrees": counts["tier1"],
        "tier1_gb": round(strip / 1024**3, 2),
        "tier3_worktrees": counts["tier3"],
        "tier0_gb": round(sum(c.get("reclaimable_bytes") or 0 for c in cache_rows) / 1024**3, 2),
    }


async def disk_report(
    repo: str | None = None,
    unclassified: bool = False,
    budget_seconds: float = 180,
) -> CommandResult[dict]:
    """Report every worktree, cache and watched volume, and what each tier would reclaim.

    Read-only. Without machine settings it reports the repository holding the working
    directory. `unclassified` also lists ignored paths in each worktree that no [disk] pattern
    or declared copy covers, which is how a repository's list is finished.
    """
    try:
        settings, settings_file, settings_found = load_machine_settings()
    except SettingsError as exc:
        return error(
            "DISK_SETTINGS_INVALID",
            str(exc),
            suggestion="Fix the machine settings file, or move it aside and run disk-setup",
        )
    repos = _repos(settings, repo)
    ctx = Context(
        settings=settings,
        processes=running_processes(),
        volumes=_volumes(settings, repos),
        t3_roots=t3_worktree_roots(settings),
        deadline=time.monotonic() + budget_seconds,
    )
    pairs = [_repo_rows(r, ctx) for r in repos]
    repo_rows = [row for row, _config in pairs]
    if unclassified:
        from botcore.commands.disk.unclassified import add_unclassified

        add_unclassified(pairs, ctx.deadline)
    known = {
        os.path.normcase(w["path"]) for r in repo_rows for w in r.get("worktrees", [])
    }
    cache_rows = cache_mod.report_caches(settings, repos, ctx.deadline)
    aged_rows = cache_mod.report_aged(settings, ctx.now, ctx.deadline)
    data = {
        "settings": {"path": str(settings_file), "found": settings_found},
        "processes": {"method": ctx.processes.method, "sees_working_dirs": ctx.processes.sees_cwds},
        "volumes": [v.as_dict() for v in ctx.volumes.values()],
        "t3_code_roots": [str(r) for r in ctx.t3_roots],
        "repos": repo_rows,
        "orphans": _orphans(ctx, known),
        "caches": cache_rows,
        "aged": aged_rows,
        "complete": ctx.complete and time.monotonic() <= ctx.deadline,
    }
    data["totals"] = _totals(repo_rows, cache_rows + aged_rows)
    suggestions = ["Run disk-reclaim to preview what a reclaim would do (a dry run by default)"]
    if not settings_found:
        suggestions.append("Run disk-setup to register repositories and volumes on this machine")
    if not data["complete"]:
        suggestions.append("Some sizes were not measured in time; raise budget_seconds")
    return success(data=data, suggestions=suggestions)
