"""`disk-report`: every worktree of every registered repository, with what could be reclaimed.

Read-only. The tiers are the proposal's (docs/features/active/disk-hygiene/): 0 tool caches and
aged cache folders, 1 build output in an idle worktree, 2 a finished worktree no other tool
manages, 3 report only (everything else).

Protection comes first: a row is eligible for tier 1 only when its folder is the checkout git
records, it is not the main checkout, locked, busy or on an unverified volume, its process list
and pattern walk were complete, and git's record of its activity was found. Only then can a
build-output path be `ready`, and only ready paths count toward what a reclaim would free.
"""

from __future__ import annotations

import errno
import os
import re
import time
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk import caches as cache_mod
from botcore.commands.disk.finished import judge, keep_until
from botcore.commands.disk.git import (
    GitError,
    Worktree,
    case_insensitive,
    ignored,
    list_worktrees,
    path_key,
    status,
    tracked_files,
    tracked_under,
    verify_checkout,
)
from botcore.commands.disk.scan import (
    DAY,
    Candidate,
    Processes,
    VolumeState,
    allocated,
    busy_reason,
    compile_pattern,
    exists,
    find_candidates,
    is_dir,
    is_file,
    last_activity,
    mount_point,
    newest_mtime,
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
from botcore.commands.disk.steps import doing
from botcore.config import DiskConfig

MIN_GIT_SECONDS = 10.0
# Botcore Factory's lane checks its validation slots out in `<repository>.factory-slots/`
FACTORY_SLOTS_SUFFIX = ".factory-slots"
MANAGERS = {
    "t3-code": "T3 Code removes this worktree (its storage cleanup)",
    "factory": "Botcore Factory's lane reuses this slot and removes it itself",
}


@dataclass
class Context:
    """What one report run reads once and shares."""

    settings: MachineSettings
    processes: Processes
    volumes: dict[str, VolumeState]
    t3_roots: list[Path]
    deadline: float
    checkouts: list[str] = field(default_factory=list)  # every registered checkout's key
    listed: dict[str, tuple[Path, list[Worktree]]] = field(default_factory=dict)
    t3_read: bool = True
    now: float = field(default_factory=time.time)
    complete: bool = True

    def remaining(self) -> float:
        return self.deadline - time.monotonic()

    def git_timeout(self) -> float:
        return max(MIN_GIT_SECONDS, min(120.0, self.remaining()))


def _inside(root: Path | str, path: Path | str) -> bool:
    outer, inner = path_key(root), path_key(path)
    return inner != outer and inner.startswith(outer.rstrip(os.sep) + os.sep)


def factory_slots(repository: Path) -> Path:
    """Where Botcore Factory's lane checks a repository's slots out: beside the repository
    (the folder holding its `.git`), as its `_slot_path` does."""
    return repository.with_name(f"{repository.name}{FACTORY_SLOTS_SUFFIX}")


def repository_of(common: Path) -> Path:
    """The repository folder Factory names its slots after, from git's common directory."""
    return common.parent if common.name == ".git" else common


def manager(path: Path | str, t3_roots: list[Path], repository: Path | None = None) -> str | None:
    """The tool that creates and removes this worktree itself, if any: tier 2 leaves it alone.
    A Factory slot sits directly in this repository's `<repository>.factory-slots/`."""
    if repository is not None and path_key(Path(path).parent) == path_key(
            factory_slots(repository)):
        return "factory"
    if any(_inside(root, path) for root in t3_roots):
        return "t3-code"
    return None


def volume_for(path: Path, ctx: Context) -> VolumeState | None:
    """The watched volume holding path, if any (longest mount first)."""
    best = None
    for mount, state in ctx.volumes.items():
        if (path_key(path) == path_key(mount) or _inside(mount, path)) and (
            best is None or len(mount) > len(best.mount)
        ):
            best = state
    return best


# ── Folder state ────────────────────────────────────────────────────────────


def _presence(path: Path) -> tuple[str, str | None]:
    """("present" | "missing" | "unreadable", detail). A permission error is not "missing"."""
    doing("opening", path)
    try:
        os.lstat(path)
    except FileNotFoundError:
        pass
    except NotADirectoryError:
        pass
    except OSError as exc:
        if exc.errno not in (errno.ENOENT, errno.ENOTDIR):
            return "unreadable", exc.strerror or str(exc)
    else:
        try:
            os.listdir(path)
        except PermissionError as exc:
            return "unreadable", exc.strerror or "permission denied"
        except OSError:
            pass
        return "present", None
    parent = path.parent
    try:
        os.lstat(parent)
    except FileNotFoundError:
        return "missing", "the folder that held it is gone too (an unplugged drive?)"
    except OSError as exc:
        return "unreadable", exc.strerror or str(exc)
    return "missing", None


def _repo_block(worktrees: list[Worktree], ctx: Context) -> tuple[str | None, dict[str, tuple]]:
    """Why no worktree of this repository may be acted on, and each worktree's presence."""
    presence = {str(w.path): _presence(w.path) for w in worktrees}
    for wt in worktrees:
        vol = volume_for(wt.path, ctx)
        if vol is not None and not vol.verified:
            reason = vol.error or "it is not mounted or is not the recorded volume"
            return f"volume {vol.mount}: {reason}", presence
    for wt in worktrees:
        state, detail = presence[str(wt.path)]
        if state == "unreadable":
            return f"{wt.path} cannot be read ({detail})", presence
        if state == "missing" and detail:
            hint = ""
            if wt.prunable:
                main = worktrees[0].path
                hint = f"; if it was deleted on purpose, run `git worktree prune` in {main}"
            return f"{wt.path}: {detail}{hint}", presence
    return None, presence


# ── Candidates ──────────────────────────────────────────────────────────────


def may_contain(folder: str, pattern: str, fold: bool | None = None) -> bool:
    """Whether a path matching pattern could lie inside folder (both relative, `/`).

    Case-folded where patterns match case-insensitively (Windows), as compile_pattern does.
    """
    if fold if fold is not None else os.name == "nt":
        folder, pattern = folder.casefold(), pattern.casefold()
    outer = folder.split("/")
    parts = pattern.split("/")
    for index, piece in enumerate(outer):
        if index >= len(parts):
            return False
        if parts[index] == "**":
            return True
        if not fnmatchcase(piece, parts[index]):
            return False
    return len(parts) > len(outer)


def _holds_copy(cand: Candidate, copy: str, fold: bool) -> bool:
    pattern = compile_pattern(copy)
    if fold:
        pattern = re.compile(pattern.pattern, re.IGNORECASE)
    if pattern.match(cand.rel):
        return True
    return cand.kind == "dir" and may_contain(cand.rel, copy, fold=fold or None)


def _holds_checkout(folder: Path, checkouts: list[str]) -> bool:
    key = path_key(folder).rstrip(os.sep) + os.sep
    return any(other.startswith(key) for other in checkouts)


def _strippable(
    worktree: Path, found: list[Candidate], config: DiskConfig, ctx: Context,
) -> tuple[list[Candidate], list[dict]]:
    """Candidates that may be stripped, and those refused with the reason."""
    git_timeout = ctx.git_timeout()
    fold = case_insensitive(worktree)
    refused: list[dict] = []
    keep: list[Candidate] = []
    for cand in found:
        nested = cand.kind == "dir" and _holds_checkout(worktree / cand.rel, ctx.checkouts)
        if cand.kind == "checkout" or nested:
            refused.append({"path": cand.rel, "reason": "holds another checkout"})
        elif any(_holds_copy(cand, copy, fold) for copy in config.copies):
            refused.append({"path": cand.rel, "reason": "it is or may hold a declared copy"})
        elif cand.kind != "link" and not _inside(worktree, worktree / cand.rel):
            refused.append({"path": cand.rel, "reason": "resolves outside the worktree"})
        else:
            keep.append(cand)
    rels = [c.rel for c in keep]
    tracked = tracked_under(worktree, rels, tracked_files(worktree, git_timeout), fold)
    ignored_set = ignored(worktree, [r for r in rels if r not in tracked], git_timeout)
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


# ── Rows ────────────────────────────────────────────────────────────────────


def _base_row(wt: Worktree, ctx: Context, common: Path) -> dict:
    return {
        "path": str(wt.path),
        "branch": wt.branch,
        "head": wt.head,
        "detached": wt.detached,
        "main": wt.is_main,
        "exists": False,
        "locked": wt.locked,
        "prunable": wt.prunable,
        "managed_by": None if wt.is_main else manager(wt.path, ctx.t3_roots,
                                                        repository_of(common)),
        "tier": 3,
        "can_strip": False,
        "complete": False,
        "reasons": [],
        "strip": [],
        "refused": [],
        "strip_ready_bytes": 0,
    }


def _protections(row: dict, wt: Worktree, ctx: Context) -> bool:
    """Record why the worktree is protected; True when anything protects it."""
    before = len(row["reasons"])
    if wt.is_main:
        row["reasons"].append("main checkout")
    if wt.locked is not None:
        row["reasons"].append(f"kept: {wt.locked}" if wt.locked else "kept (git worktree lock)")
        until = keep_until(wt.locked)
        if until and until < time.strftime("%Y-%m-%d", time.localtime(ctx.now)):
            row["keep_expired"] = until
            row["reasons"].append(f"its keep expired on {until}: disk-unkeep it, or keep it again")
    busy = busy_reason(wt.path, ctx.processes)
    row["busy"] = busy
    if busy:
        row["reasons"].append(f"busy: {busy}")
    if wt.admin is None and not wt.is_main:
        row["reasons"].append("git's record of this worktree was not found")
    protected = len(row["reasons"]) > before
    if row["managed_by"]:
        row["reasons"].append(MANAGERS[row["managed_by"]])
    return protected


def _inspect(
    row: dict, wt: Worktree, common: Path, main: Path, config: DiskConfig, ctx: Context,
) -> None:
    """Fill a present worktree's row: verification, status, candidates, activity, readiness."""
    mismatch = None if wt.is_main else verify_checkout(wt, common, ctx.git_timeout())
    if mismatch:
        row["reasons"].append(mismatch)
        return
    protected = _protections(row, wt, ctx)
    st = status(wt.path, wt.admin, ctx.git_timeout())
    found, walked = find_candidates(wt.path, config.entries(), ctx.deadline)
    cands, refused = _strippable(wt.path, found, config, ctx)
    outputs = [wt.path / c.rel for c in found if c.kind in ("dir", "checkout")]
    activity = last_activity(wt.path, wt.admin, st.changed, [])
    for folder in outputs:
        value = newest_mtime(folder)
        if value is not None and (activity is None or value > activity):
            activity = value
    idle = None if activity is None else max(0.0, ctx.now - activity)
    row.update({
        "changed_files": len(st.changed),
        "operation": st.operation,
        "idle_seconds": None if idle is None else int(idle),
        "idle_days": None if idle is None else round(idle / DAY, 2),
        "refused": refused,
        "complete": walked,
    })
    if st.operation:
        protected = True
        row["reasons"].append(f"a {st.operation} is in progress")
    if not walked:
        if ctx.remaining() <= 0:
            ctx.complete = False
        row["reasons"].append("its folders could not all be searched: nothing is marked ready")
    row["can_strip"] = not protected and walked and idle is not None and ctx.processes.ok
    _plan(row, cands, idle, ctx)
    if row["can_strip"] and not row["managed_by"]:
        _judge_finished(row, wt, main, st.changed, st.operation, config, idle, ctx)


def _judge_finished(
    row: dict, wt: Worktree, main: Path, changed: list[str], operation: str | None,
    config: DiskConfig, idle: float | None, ctx: Context,
) -> None:
    """Tier 2: a worktree no other tool manages, idle long enough, nothing unique, landed."""
    due = ctx.settings.remove_landed_after_days
    if idle is None or idle < due * DAY:
        return
    if not ctx.t3_read:
        row["reasons"].append("tier 2 is off: T3 Code's settings could not be read, so which "
                              "worktrees it manages is unknown")
        return
    others = [c for c in ctx.checkouts if c != path_key(wt.path)]
    verdict = judge(wt.path, main, wt.admin, wt.head, wt.branch, changed, operation, config,
                    ctx.git_timeout(), others)
    row["finished"] = {
        "unique": verdict.unique,
        "landed": verdict.landed,
        "restorable": verdict.restorable,
    }
    if verdict.unique:
        row["reasons"].append(f"not removable: {verdict.unique[0]}")
    elif verdict.landed:
        row["tier"] = 2
        row["reasons"].append(f"finished: {verdict.landed}")
    else:
        row["reasons"].append("restorable but not landed: removed only with include_restorable")


def _plan(row: dict, cands: list[Candidate], idle: float | None, ctx: Context) -> None:
    waits = []
    for cand in cands:
        due = _threshold(cand, ctx)
        ready = bool(
            row["can_strip"] and cand.pattern.when == "idle"
            and idle is not None and idle >= due * DAY
        )
        row["strip"].append({
            "path": cand.rel,
            "kind": cand.kind,
            "pattern": cand.pattern.path,
            "when": cand.pattern.when,
            "after_days": due,
            "ready": ready,
            "bytes": None,
        })
        if cand.pattern.when == "idle" and not ready:
            waits.append(due)
    if any(item["ready"] for item in row["strip"]):
        row["tier"] = 1
    elif waits and row["can_strip"] and idle is not None:
        row["reasons"].append(f"idle {round(idle / DAY, 2)} of {min(waits)} days")
    elif not row["strip"]:
        row["reasons"].append("nothing its [disk] patterns name")


def _measure(rows: list[dict], ctx: Context) -> None:
    """Sizes of ready folders, after every row was inspected, within what is left of the budget."""
    for row in rows:
        for item in row.get("strip", []):
            if not item["ready"] or item["kind"] != "dir":
                continue
            item["bytes"] = allocated(Path(row["path"]) / item["path"], ctx.deadline)
            if item["bytes"] is None:
                ctx.complete = False
                row["sizes_complete"] = False
            else:
                row["strip_ready_bytes"] += item["bytes"]


def _worktree_row(  # noqa: PLR0913 - one row needs each of these
    wt: Worktree, common: Path, main: Path, config: DiskConfig, ctx: Context,
    block: str | None, presence: tuple[str, str | None],
) -> dict:
    row = _base_row(wt, ctx, common)
    state, _detail = presence
    if block:
        row["reasons"].append(f"not inspected: {block}")
        row["exists"] = state == "present"
        return row
    if state != "present":
        row["reasons"].append(
            "missing: git lists it as prunable" if wt.prunable else "missing: its folder is gone"
        )
        return row
    row["exists"] = True
    if wt.prunable:
        row["reasons"].append(f"git lists it as prunable: {wt.prunable}")
        return row
    if ctx.remaining() <= 0:
        ctx.complete = False
        row["reasons"].append("not inspected: the time budget was spent")
        return row
    doing("inspecting", wt.path)
    try:
        _inspect(row, wt, common, main, config, ctx)
    except (GitError, OSError) as exc:
        row["reasons"].append(f"could not be inspected: {exc}")
        row["can_strip"] = False
        for item in row["strip"]:
            item["ready"] = False
        row["tier"] = 3
    return row


def _repo_rows(checkout: Path, ctx: Context) -> tuple[dict, DiskConfig | None]:
    out: dict = {"checkout": str(checkout)}
    try:
        common, worktrees = ctx.listed.get(path_key(checkout)) or list_worktrees(
            checkout, ctx.git_timeout()
        )
    except GitError as exc:
        out["error"] = str(exc)
        out["worktrees"] = []
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
    block, presence = _repo_block(worktrees, ctx)
    if block:
        out["blocked"] = block
    out["worktrees"] = [
        _worktree_row(wt, common, main, repo_cfg.config, ctx, block, presence[str(wt.path)])
        for wt in worktrees
    ]
    count_idle(out, ctx.settings)
    return out, repo_cfg.config


def count_idle(out: dict, settings: MachineSettings, gone: set[str] | None = None) -> None:
    """How many linked worktrees have been idle strip_after_days or longer, and a warning when
    that passes idle_worktree_limit. Kept worktrees and Factory's slots (it removes its own) are
    not counted, nor those in `gone` (removed by this run). `complete` is false when a worktree
    was not inspected for lack of time: the count is then only a floor."""
    out.pop("warning", None)
    days = settings.strip_after_days
    gone = gone or set()
    rows = [w for w in out["worktrees"] if not w["main"] and path_key(w["path"]) not in gone]
    idle = [
        w for w in rows
        if w["exists"] and w["locked"] is None and w["managed_by"] != "factory"
        and w.get("idle_seconds") is not None and w["idle_seconds"] >= days * DAY
    ]
    managed = sum(1 for w in idle if w["managed_by"] == "t3-code")
    limit = settings.idle_worktree_limit
    complete = not out.get("blocked") and not any(
        r.startswith("not inspected") for w in rows for r in w["reasons"])
    out["idle_worktrees"] = {"count": len(idle), "days": days, "t3_code": managed,
                             "limit": limit, "complete": complete}
    if limit and len(idle) > limit:
        out["warning"] = (
            f"{out['main']}: {len(idle)} worktrees idle {days:g} days or more, over the limit "
            f"of {limit}. {managed} are T3 Code's (its storage cleanup removes them once its "
            "rules are on); disk-report lists the rest"
        )


# ── The whole machine ───────────────────────────────────────────────────────


def _repos(settings: MachineSettings, repo: str | None) -> list[Path]:
    if repo:
        return [expand(repo)]
    if settings.repos:
        return [expand(r) for r in settings.repos]
    return [Path.cwd()]


def _unique(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    out = []
    for path in paths:
        if path_key(path) not in seen:
            seen.add(path_key(path))
            out.append(path)
    return out


def _all_checkouts(
    repos: list[Path], deadline: float,
) -> tuple[list[Path], dict[str, tuple[Path, list[Worktree]]]]:
    paths: list[Path] = []
    listed: dict[str, tuple[Path, list[Worktree]]] = {}
    for repo in repos:
        timeout = max(MIN_GIT_SECONDS, min(120.0, deadline - time.monotonic()))
        try:
            listed[path_key(repo)] = list_worktrees(repo, timeout)
        except GitError:
            continue
        paths += [w.path for w in listed[path_key(repo)][1]]
    return paths, listed


def _volumes(
    settings: MachineSettings, paths: list[Path],
) -> dict[str, VolumeState]:
    """Configured volumes, plus every volume holding a repository, a worktree or a T3 root."""
    states: dict[str, VolumeState] = {}
    for vol in settings.volume:
        mount = expand(vol.mount)
        states[str(mount)] = volume_state(mount, vol.id, vol.low_space_gb)
    for path in paths:
        if not exists(path):
            continue
        mount = mount_point(path)
        if not any(path_key(mount) == path_key(m) for m in states):
            states[str(mount)] = volume_state(mount, None, None)
    return states


def _orphans(ctx: Context, known: set[str]) -> list[dict]:
    """Linked-worktree folders under configured roots that no registered repository lists."""
    rows = []
    roots = [expand(r) for r in ctx.settings.worktree_roots] + ctx.t3_roots
    seen: set[str] = set()
    for root in roots:
        if not is_dir(root):
            continue
        for first in _children(root):
            for folder in [first, *_children(first)]:
                key = path_key(folder)
                git_file = folder / ".git"
                if key in seen or key in known or not is_file(git_file):
                    continue
                seen.add(key)
                rows.append({"path": str(folder), "tier": 3, "reason": _orphan_reason(git_file)})
    return rows


def _children(folder: Path) -> list[Path]:
    doing("reading", folder)
    try:
        return [Path(e.path) for e in os.scandir(folder) if e.is_dir(follow_symlinks=False)]
    except OSError:
        return []


def _orphan_reason(git_file: Path) -> str:
    try:
        target = git_file.read_text(encoding="utf-8").strip().removeprefix("gitdir:").strip()
    except OSError:
        return "a worktree no registered repository lists"
    resolved = Path(target) if os.path.isabs(target) else git_file.parent / target
    if not exists(resolved):
        return "its repository's record of it is gone"
    return "a worktree of a repository the machine settings do not register"


def _totals(repos: list[dict], cache_rows: list[dict]) -> dict:
    rows = [w for r in repos for w in r.get("worktrees", [])]
    strip = sum(w.get("strip_ready_bytes", 0) for w in rows)
    return {
        "tier1_worktrees": sum(1 for w in rows if w.get("tier") == 1),
        "tier2_worktrees": sum(1 for w in rows if w.get("tier") == 2),
        "tier1_gb": round(strip / 1024**3, 2),
        "tier3_worktrees": sum(1 for w in rows if w.get("tier") == 3),
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
        return settings_error(exc)
    data, _pairs, _ctx = build_report(
        settings, repo, unclassified=unclassified, budget_seconds=budget_seconds,
    )
    data["settings"] = {"path": str(settings_file), "found": settings_found}
    suggestions = [*data["warnings"],
                   "Run disk-reclaim to preview what a reclaim would do (a dry run by default)"]
    if not settings_found:
        suggestions.append(f"Run disk-setup, or create {settings_file}, to register repositories")
    if not data["complete"]:
        suggestions.append("Some worktrees or sizes were not covered in time; raise budget_seconds")
    return success(data=data, suggestions=suggestions)


def settings_error(exc: SettingsError) -> CommandResult[dict]:
    return error(
        "DISK_SETTINGS_INVALID",
        str(exc),
        suggestion="Fix the machine settings file, or move it aside to use the defaults",
    )


def build_report(
    settings: MachineSettings,
    repo: str | None,
    *,
    unclassified: bool = False,
    budget_seconds: float = 180,
) -> tuple[dict, list[tuple[dict, DiskConfig | None]], Context]:
    """The report's data, each repository's row with its [disk] config, and the run context."""
    deadline = time.monotonic() + budget_seconds
    repos = _repos(settings, repo)
    t3_roots, t3_read = t3_worktree_roots(settings)
    checkouts, listed = _all_checkouts(repos, deadline)
    ctx = Context(
        settings=settings,
        processes=running_processes(),
        volumes=_volumes(settings, list(repos) + list(t3_roots) + checkouts),
        t3_roots=t3_roots,
        t3_read=t3_read,
        deadline=deadline,
        checkouts=[path_key(p) for p in checkouts],
        listed=listed,
    )
    pairs = [_repo_rows(r, ctx) for r in repos]
    repo_rows = [row for row, _config in pairs]
    _measure([w for r in repo_rows for w in r.get("worktrees", [])], ctx)
    if unclassified:
        from botcore.commands.disk.unclassified import add_unclassified

        add_unclassified(pairs, ctx.deadline)
    known = {path_key(w["path"]) for r in repo_rows for w in r.get("worktrees", [])}
    protected = [Path(w["path"]) for r in repo_rows for w in r.get("worktrees", [])]
    protected += [Path(r["git_common_dir"]) for r in repo_rows if r.get("git_common_dir")]
    protected += ctx.t3_roots
    cache_rows = cache_mod.report_caches(settings, _unique(list(repos) + checkouts), ctx.deadline)
    aged_rows = cache_mod.report_aged(settings, ctx.now, ctx.deadline, protected, ctx.processes)
    data = {
        "processes": {
            "method": ctx.processes.method,
            "ok": ctx.processes.ok,
            "sees_working_dirs": ctx.processes.sees_cwds,
        },
        "volumes": [v.as_dict() for v in ctx.volumes.values()],
        "t3_code_roots": [str(r) for r in ctx.t3_roots],
        "t3_code_settings_read": ctx.t3_read,
        "repos": repo_rows,
        "orphans": _orphans(ctx, known),
        "caches": cache_rows,
        "aged": aged_rows,
        "complete": ctx.complete,
    }
    data["totals"] = _totals(repo_rows, cache_rows + aged_rows)
    data["warnings"] = [r["warning"] for r in repo_rows if r.get("warning")]
    return data, pairs, ctx
