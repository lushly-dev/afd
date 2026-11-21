"""`disk-setup`, `disk-status` and `disk-run`: install the schedule, read its state, run it.

`disk-run` is what the scheduler starts every hour. It reads free space and exits, unless a
watched volume is below its threshold or the last full run is a day old; then it runs
`disk-reclaim` with apply. When space stays low after that, it notifies once a day.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk import schedule
from botcore.commands.disk.cargo import cargo_check, cargo_roots
from botcore.commands.disk.git import GitError, list_worktrees, path_key
from botcore.commands.disk.scan import exists, mount_point, volume_id, volume_state
from botcore.commands.disk.settings import (
    MachineSettings,
    SettingsError,
    VolumeSettings,
    expand,
    load_machine_settings,
    settings_path,
    state_path,
    t3_worktree_roots,
)

FULL_RUN_SECONDS = 23 * 3600
STALE_SECONDS = 48 * 3600
NOTIFY_SECONDS = 24 * 3600
# How long skill usage may fail to collect before the status calls it a problem. What a
# harness drops in the meantime cannot be collected later.
USAGE_STALE_SECONDS = 24 * 3600
# How long the job waits for one collection. A full read of a large store takes a quarter
# of a minute; a scheduler does not start the next run while one is still going.
USAGE_SECONDS = 300
# Space that must disappear before a still-low volume is worth another full run that day
NEW_LOSS_BYTES = 1024**3
TOOLS = ("git", "pnpm", "uv", "gh", "node")
SYSTEM_PATH = {
    "darwin": ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"],
    "linux": ["/usr/local/bin", "/usr/bin", "/bin"],
}
# Folders that hold a shell session's links and vanish with it: path prefixes, plus one name
# that may sit anywhere (fnm keeps its session links under the user's state folder)
SESSION_PREFIXES = ("/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/")
SESSION_PART = "fnm_multishells"
# Keys newer than the first release, left out of the file while at their defaults, so a botcore
# from before them (which refuses unknown keys) still reads a file this one wrote
OMIT_AT_DEFAULT = ("remove_landed", "idle_worktree_limit", "skill_usage_collect",
                   "skill_usage_away")


# ── The settings file ───────────────────────────────────────────────────────


def _toml_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return repr(value)
    if isinstance(value, str):
        # TOML takes a character as it is, and has no escape for half of a surrogate pair
        return json.dumps(value, ensure_ascii=False).replace("\x7f", "\\u007f")
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    raise TypeError(f"cannot write {type(value).__name__} to TOML")


def settings_toml(settings: MachineSettings) -> str:
    """The machine settings as TOML. Setup writes the whole file; comments are not kept."""
    data = settings.model_dump(exclude_none=True)
    defaults = MachineSettings().model_dump()
    for key in OMIT_AT_DEFAULT:
        if key in data and data[key] == defaults[key]:
            del data[key]
    tables = {key: data.pop(key) for key in ("volume", "aged")}
    tools = data.pop("tools")
    lines = ["# Written by `botcore disk-setup`; safe to edit. See the disk-hygiene skill.", ""]
    lines += [f"{key} = {_toml_value(value)}" for key, value in data.items()]
    if tools:
        lines += ["", "[tools]"]
        lines += [f"{json.dumps(k)} = {_toml_value(v)}" for k, v in sorted(tools.items())]
    for name, rows in tables.items():
        for row in rows:
            lines += ["", f"[[{name}]]"]
            lines += [f"{k} = {_toml_value(v)}" for k, v in row.items() if v is not None]
    return "\n".join(lines) + "\n"


def _main_checkout(path: Path) -> Path | None:
    try:
        _common, worktrees = list_worktrees(path)
    except GitError:
        return None
    return worktrees[0].path if worktrees else None


def default_low_space_gb(mount: Path) -> float:
    """10% of the volume, between 20 and 100 GB."""
    total = shutil.disk_usage(mount).total / 1024**3
    return float(round(min(100, max(20, total * 0.10))))


def _watch_volumes(settings: MachineSettings) -> list[str]:
    """Record every volume holding a registered repository's worktrees, T3 Code's folders or
    Cargo output moved out of the worktrees."""
    added = []
    known = {str(expand(v.mount)) for v in settings.volume}
    paths: list[Path] = list(t3_worktree_roots(settings)[0])
    for root in cargo_roots(settings):  # before the first build its folder may not exist yet
        while not exists(root) and root.parent != root:
            root = root.parent
        paths.append(root)
    for repo in settings.repos:
        try:
            _common, worktrees = list_worktrees(expand(repo))
        except GitError:
            continue
        paths += [w.path for w in worktrees]
    for path in paths:
        if not exists(path):
            continue
        mount = mount_point(path)
        if str(mount) in known:
            continue
        known.add(str(mount))
        settings.volume.append(VolumeSettings(
            mount=str(mount), id=volume_id(mount), low_space_gb=default_low_space_gb(mount),
        ))
        added.append(str(mount))
    return added


def uv_cache_dir() -> str | None:
    uv = shutil.which("uv")
    if uv is None:
        return None
    try:
        done = subprocess.run([uv, "cache", "dir"], capture_output=True, text=True, timeout=30,
                              check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout.strip() or None


def _under(path: str, folder: str) -> bool:
    inner = os.path.normcase(os.path.realpath(path))
    outer = os.path.normcase(os.path.realpath(folder)).rstrip(os.sep)
    return inner == outer or inner.startswith(outer + os.sep)


def _persistent_exe(checkouts: list[Path]) -> tuple[str | None, str | None]:
    """The installed `botcore` the scheduler should run, or why there is none.

    Never one from uv's cache (the job prunes it) or from inside a checkout (a project
    `.venv` that a strip or a worktree removal would take away).
    """
    found = shutil.which("botcore")
    if found is None:
        return None, "no botcore on PATH"
    cache = uv_cache_dir()
    if cache and _under(found, cache):
        return None, "the botcore on PATH lives in uv's cache, which the job prunes"
    for checkout in checkouts:
        if _under(found, str(checkout)):
            return None, f"the botcore on PATH lives inside {checkout}, which a reclaim can strip"
    return found, None


def _session_path(path: str) -> bool:
    """Whether path lies in a folder that lives only as long as a shell session or a boot."""
    text = path.replace("\\", "/")
    folded = text.lower()
    if SESSION_PART in folded.split("/"):
        return True
    prefixes = list(SESSION_PREFIXES)
    home = os.path.realpath(Path.home())
    for name in ("TMPDIR", "TEMP", "TMP"):
        value = os.environ.get(name)
        if not value:
            continue
        resolved = os.path.realpath(value)
        if os.path.dirname(resolved) == resolved or home == resolved or home.startswith(
            resolved.rstrip(os.sep) + os.sep
        ):
            continue  # a root, the home folder or one above it is not a session folder
        for form in (value, resolved):
            prefixes.append(form.replace("\\", "/").rstrip("/") + "/")
    candidates = (folded, text) if os.name == "nt" else (text,)
    for prefix in prefixes:
        mark = prefix.lower() if os.name == "nt" else prefix
        if any(c.startswith(mark) for c in candidates):
            return True
    return False


def _tool_name(path: str) -> str:
    name = os.path.basename(path).lower()
    for suffix in (".exe", ".cmd", ".bat", ".ps1"):
        name = name.removesuffix(suffix)
    return name


def stable_tool_path(name: str, found: str) -> str | None:
    """A lasting path that still runs `name`, starting from what `which` found.

    Links are followed one hop at a time, only while the path is in a shell-session folder
    (fnm's multishells, a temp folder): `/opt/homebrew/bin/uv` is kept as it is, not resolved
    to a versioned Cellar folder that an upgrade deletes, and a hop to a file with another
    name (corepack's `pnpm.js`) is not taken.
    """
    if not _session_path(found):
        return found if _tool_name(found) == name else None
    # fnm's session folder is a link to the Node version's folder: resolve the folder, keep the
    # file's own name (its target may be corepack's pnpm.js, which is not "pnpm")
    kept = os.path.join(os.path.realpath(os.path.dirname(found)), os.path.basename(found))
    if not _session_path(kept) and os.path.exists(kept):
        return kept
    path = found
    for _hop in range(10):
        if not _session_path(path):
            return path if _tool_name(path) == name else None
        if not os.path.islink(path):
            return None
        target = os.readlink(path)
        path = os.path.join(os.path.realpath(os.path.dirname(path)), target)
        path = os.path.normpath(path)
        if _tool_name(path) != name:
            return None
        if not _session_path(path):
            return path if os.path.isfile(path) else None
    return None


def record_tools(settings: MachineSettings) -> dict[str, str]:
    """Record a lasting path for each tool the job runs; a scheduler starts it without the
    user's shell PATH. A tool whose path only lives in a shell session is left out."""
    for name in TOOLS:
        found = shutil.which(name)
        stable = stable_tool_path(name, found) if found else None
        if stable:
            settings.tools[name] = stable
        else:
            settings.tools.pop(name, None)
    return settings.tools


def job_path(settings: MachineSettings) -> str:
    """PATH for the scheduled job: the recorded tools' folders, then the system's."""
    folders: list[str] = []
    for tool in settings.tools.values():
        folder = os.path.dirname(tool)
        if folder not in folders:
            folders.append(folder)
    for folder in SYSTEM_PATH.get(sys.platform, []):
        if folder not in folders:
            folders.append(folder)
    return os.pathsep.join(folders)


def apply_tool_path(settings: MachineSettings) -> None:
    """Put the recorded tools first on this process's PATH (the job's first step)."""
    current = os.environ.get("PATH", "")
    extra = [os.path.dirname(t) for t in settings.tools.values() if os.path.exists(t)]
    os.environ["PATH"] = os.pathsep.join([*dict.fromkeys(extra), current])


async def disk_setup(
    uninstall: bool = False,
    repos: list[str] | None = None,
    install_schedule: bool = True,
    remove_landed: bool | None = None,
) -> CommandResult[dict]:
    """Register this repository (and `repos`), record watched volumes, install the schedule.

    Safe to run again: it adds what is missing and never removes a repository or volume.
    `uninstall` removes the schedule only; settings and receipts stay where `disk-status` says.
    """
    if uninstall:
        schedule.uninstall()
        state = schedule.current()
        if state.installed:
            detail = f" ({state.detail})" if state.detail else ""
            return error("DISK_SCHEDULE_FAILED",
                         f"the job is still installed at {state.where}{detail}",
                         suggestion="Remove it with the platform's scheduler, then run again")
        return success(data={"schedule": state.as_dict(), "settings": str(settings_path()),
                             "state": str(state_path())},
                       suggestions=["Settings and receipts were kept; delete them if unwanted"])
    try:
        settings, path, _found = load_machine_settings()
    except SettingsError as exc:
        return error("DISK_SETTINGS_INVALID", str(exc),
                     suggestion="Fix the machine settings file, or move it aside and run again")
    added_repos = []
    for candidate in [*(repos or []), str(Path.cwd())]:
        main = _main_checkout(expand(candidate))
        if main is not None and str(main) not in {str(expand(r)) for r in settings.repos}:
            settings.repos.append(str(main))
            added_repos.append(str(main))
    added_volumes = _watch_volumes(settings)
    record_tools(settings)
    if remove_landed is not None:
        settings.remove_landed = remove_landed
    if not settings.skill_usage_machine:
        # written down once: a hostname changes with the network, and a machine that changed
        # its name would leave its record under the old one
        from botcore.commands.skill_usage.store import default_machine

        settings.skill_usage_machine = default_machine()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(settings_toml(settings), encoding="utf-8")
    cargo = cargo_check(settings)
    data: dict = {"settings": str(path), "added_repos": added_repos,
                  "added_volumes": added_volumes, "repos": settings.repos,
                  "tools": settings.tools, "remove_landed": settings.remove_landed,
                  "cargo": cargo}
    if not install_schedule:
        return success(data=data, suggestions=cargo["problems"])
    checkouts: list[Path] = []
    for repo in settings.repos:
        try:
            checkouts += [w.path for w in list_worktrees(expand(repo))[1]]
        except GitError:
            continue
    exe, why = _persistent_exe(checkouts)
    if exe is None:
        return error(
            "DISK_TOOL_NOT_INSTALLED", why or "botcore is not installed",
            suggestion="Install it as a tool first: uv tool install 'lushly-botcore==<version>'",
        )
    state = schedule.install(exe, state_path(), job_path(settings))
    data["schedule"] = state.as_dict()
    if not state.installed:
        return error("DISK_SCHEDULE_FAILED", state.detail or "the scheduler refused the job",
                     suggestion="Read the detail, fix it, and run disk-setup again")
    schedule.run_now()
    return success(data=data, suggestions=[
        *cargo["problems"],
        "Approve any permission prompt now: the first run has started",
        "disk-status shows the last run",
    ])


# ── Status ──────────────────────────────────────────────────────────────────


def _read_json(name: str) -> dict:
    path = state_path() / name
    try:
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _read_status() -> dict:
    """status.json, which only disk-reclaim writes, under the run lock."""
    return _read_json("status.json")


def _age_hours(stamp: str | None) -> float | None:
    if not stamp:
        return None
    try:
        then = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    return round((datetime.now(UTC) - then).total_seconds() / 3600, 1)


def disk_warnings(settings: MachineSettings | None = None, status: dict | None = None) -> list[str]:
    """What the owner should fix that does not stop a run: registered repositories over the
    idle-worktree limit when a reclaim last counted them, and Cargo output no [[aged]] folder
    clears. A count older than 48 hours says when it was taken. Factory's lane-status shows
    these to the foreman before it starts cells."""
    if settings is None:
        try:
            settings = load_machine_settings()[0]
        except SettingsError:
            return []
    snapshot = (status if status is not None else _read_status()).get("worktree_warnings")
    repos = snapshot.get("repos") if isinstance(snapshot, dict) else None
    registered = {path_key(expand(r)) for r in settings.repos}
    warnings = []
    for main, entry in (repos if isinstance(repos, dict) else {}).items():
        if not isinstance(entry, dict) or not isinstance(entry.get("warning"), str):
            continue
        checkout = entry.get("checkout") or main
        if registered and path_key(checkout) not in registered and path_key(main) not in registered:
            continue  # no longer registered
        age = _age_hours(entry.get("at"))
        stale = age is None or age * 3600 > STALE_SECONDS
        warnings.append(entry["warning"] + (f" (counted {entry.get('at')})" if stale else ""))
    return warnings + cargo_check(settings)["problems"]


def _volumes_now(settings: MachineSettings) -> list[dict]:
    return [volume_state(expand(v.mount), v.id, v.low_space_gb).as_dict() for v in settings.volume]


async def disk_status() -> CommandResult[dict]:
    """The schedule, the last runs, free space on watched volumes, and whether anything is stale."""
    try:
        settings, path, found = load_machine_settings()
    except SettingsError as exc:
        return error("DISK_SETTINGS_INVALID", str(exc),
                     suggestion="Fix the machine settings file, or move it aside and run setup")
    status = _read_status()
    last_apply = status.get("last_apply") or {}
    age = _age_hours(last_apply.get("at"))
    volumes = _volumes_now(settings)
    sched = schedule.current()
    problems = []
    if not found:
        problems.append("no machine settings: run disk-setup")
    if not sched.installed:
        problems.append("the schedule is not installed: run disk-setup")
    if age is None or age * 3600 > STALE_SECONDS:
        problems.append("no successful run in the last 48 hours")
    elif not last_apply.get("ok"):
        problems.append("the last run had failures: read its receipt")
    problems += [f"{v['mount']} is below {v['low_space_gb']} GB free" for v in volumes
                 if v["below_threshold"]]
    problems += [f"{v['mount']} is not mounted or not the recorded volume" for v in volumes
                 if not v["verified"]]
    check = _read_json("check.json")
    usage = check.get("skill_usage") if settings.skill_usage_collect else None
    usage = usage if isinstance(usage, dict) else None
    warnings = disk_warnings(settings, status)
    if usage and not usage.get("ok"):
        failing = f"skill usage is not being collected: {usage.get('error') or 'it failed'}"
        # how long it has been failing, not how long since it worked: a machine that slept
        # for two days and fails once on waking has failed for an hour
        since = _age_hours(usage.get("failing_since") or usage.get("ok_at"))
        if since is not None and since * 3600 > USAGE_STALE_SECONDS:
            problems.append(f"{failing} (for {since:.0f} hours)")
        else:
            warnings.append(failing)
    data = {
        "settings": {"path": str(path), "found": found},
        "state": str(state_path()),
        "schedule": sched.as_dict(),
        "last_apply": last_apply or None,
        "last_apply_hours_ago": age,
        "last_check": check.get("last_check"),
        "skill_usage": usage,
        "volumes": volumes,
        "healthy": not problems,
        "problems": problems,
        "warnings": warnings,
    }
    return success(data=data,
                   suggestions=problems[:1] or data["warnings"][:1] or ["Nothing to do"])


# ── The scheduled job ───────────────────────────────────────────────────────


def notify(title: str, message: str) -> None:
    """A desktop notification; silently nothing where none is available."""
    try:
        if sys.platform == "darwin":
            script = f"display notification {json.dumps(message)} with title {json.dumps(title)}"
            subprocess.run(["osascript", "-e", script], timeout=30, check=False,
                           capture_output=True)
        elif sys.platform == "win32":
            ps = (
                "Add-Type -AssemblyName System.Windows.Forms;"
                "$n=New-Object System.Windows.Forms.NotifyIcon;"
                "$n.Icon=[System.Drawing.SystemIcons]::Warning;$n.Visible=$true;"
                f"$n.ShowBalloonTip(10000,{json.dumps(title)},{json.dumps(message)},'Warning');"
                "Start-Sleep -Seconds 11;$n.Dispose()"
            )
            subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                           timeout=60, check=False, capture_output=True)
        elif shutil.which("notify-send"):
            subprocess.run(["notify-send", title, message], timeout=30, check=False,
                           capture_output=True)
    except (OSError, subprocess.TimeoutExpired):
        pass


def _write_check(update: dict) -> None:
    """check.json: the job's own heartbeat and notification time, apart from status.json."""
    folder = state_path()
    folder.mkdir(parents=True, exist_ok=True)
    data = _read_json("check.json")
    data.update(update)
    data["last_check"] = datetime.now(UTC).isoformat(timespec="seconds")
    tmp = folder / f".check.json.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    os.replace(tmp, folder / "check.json")


def _newly_low(volumes: list[dict], last_apply: dict) -> list[str]:
    """Low volumes worth a run now: not already low after the last run, or losing more space.

    A volume the last run could not bring back above its threshold waits for the daily run,
    unless another gigabyte has gone since: retrying every hour would change nothing.
    """
    still = set(last_apply.get("still_low") or [])
    free_after = last_apply.get("free_after") or {}
    out = []
    for vol in volumes:
        if not vol["below_threshold"]:
            continue
        mount = vol["mount"]
        before = free_after.get(mount)
        free_now = (vol.get("free_gb") or 0) * 1024**3
        if mount not in still or before is None or free_now < before - NEW_LOSS_BYTES:
            out.append(mount)
    return out


def _collect_skill_usage(settings: MachineSettings) -> dict | None:
    """The hourly collection of skill usage, and what the status needs of it: whether it
    worked, when it last did, and since when it has not. It runs after the disk work and
    never fails or holds the job: whatever a harness's store or a shared drive does, the
    job ends, and the next hour's starts."""
    if not settings.skill_usage_collect:
        return None
    from botcore.commands.skill_usage import skill_usage_collect

    now = datetime.now(UTC).isoformat(timespec="seconds")
    previous = _read_json("check.json").get("skill_usage")
    previous = previous if isinstance(previous, dict) else {}
    outcome: dict = {}

    def collect() -> None:
        try:
            outcome["result"] = asyncio.run(skill_usage_collect())
        except BaseException as exc:  # noqa: BLE001 - the job must end whatever this raises
            outcome["raised"] = exc

    # its own thread, left behind if it does not come back: a read of a drive that is away
    # can wait for ever, and a thread that only waits holds nothing the job needs
    worker = threading.Thread(target=collect, name="skill-usage-collect", daemon=True)
    worker.start()
    worker.join(USAGE_SECONDS)
    data: dict = {}
    if worker.is_alive():
        failure = f"it did not finish in {USAGE_SECONDS:g} seconds"
    elif "raised" in outcome:
        failure = f"{type(outcome['raised']).__name__}: {outcome['raised']}"
    else:
        result = outcome["result"]
        data = result.data or {}
        shared = data.get("shared") if isinstance(data.get("shared"), dict) else {}
        failure = None
        if not result.success:
            failure = result.error.message if result.error else "the collection failed"
        elif shared.get("error"):
            failure = f"the shared folder could not be written: {shared['error']}"
    if failure is None:
        return {"at": now, "ok": True, "ok_at": now, "added": data.get("added", 0)}
    return {
        "at": now,
        "ok": False,
        "ok_at": previous.get("ok_at"),
        "failing_since": (previous.get("failing_since") if previous.get("ok") is False else None)
        or now,
        "error": failure,
    }


async def disk_run(force: bool = False) -> CommandResult[dict]:
    """What the schedule runs: a free-space check, a reclaim when it is due or space is low,
    and then the hourly collection of skill usage."""
    try:
        settings, _path, _found = load_machine_settings()
    except SettingsError as exc:
        return error("DISK_SETTINGS_INVALID", str(exc),
                     suggestion="Fix the machine settings file; the job will retry next hour")
    result = await _disk_work(settings, force)
    usage = _collect_skill_usage(settings)
    if usage is not None:
        _write_check({"skill_usage": usage})
        if result.success and isinstance(result.data, dict):
            result.data["skill_usage"] = usage
    return result


async def _disk_work(settings: MachineSettings, force: bool) -> CommandResult[dict]:
    """The disk part of the job: nothing here waits on, or fails with, the collection."""
    from botcore.commands.disk.reclaim import disk_reclaim

    apply_tool_path(settings)
    volumes = _volumes_now(settings)
    low = [v["mount"] for v in volumes if v["below_threshold"]]
    last_apply = _read_status().get("last_apply") or {}
    age = _age_hours(last_apply.get("at"))
    newly_low = _newly_low(volumes, last_apply)
    due = force or bool(newly_low) or age is None or age * 3600 >= FULL_RUN_SECONDS
    if not due:
        _write_check({})
        return success(data={"ran": False, "low": low, "last_apply_hours_ago": age})
    result = await disk_reclaim(tier=2 if settings.remove_landed else 1, apply=True,
                                pressure=False)
    if not result.success:
        _write_check({"last_error": result.error.message if result.error else "failed"})
        code = result.error.code if result.error else "DISK_RECLAIM_FAILED"
        return error(code, result.error.message if result.error else "the reclaim failed",
                     suggestion="disk-status shows the state; the job will try again next hour")
    data = result.data or {}
    still_low = data.get("still_low", [])
    check = _read_json("check.json")
    update: dict = {"last_error": None}
    if still_low and time.time() - float(check.get("notified_at") or 0) > NOTIFY_SECONDS:
        notify("Disk space is still low", ", ".join(still_low) + ": run botcore disk-report")
        update["notified_at"] = time.time()
    _write_check(update)
    return success(data={
        "ran": True, "low": low, "still_low": still_low,
        "reclaim_ok": not data.get("failures"), "failures": len(data.get("failures", [])),
        "receipt": data.get("receipt"),
    })
