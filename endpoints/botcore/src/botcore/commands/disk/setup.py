"""`disk-setup`, `disk-status` and `disk-run`: install the schedule, read its state, run it.

`disk-run` is what the scheduler starts every hour. It reads free space and exits, unless a
watched volume is below its threshold or the last full run is a day old; then it runs
`disk-reclaim` with apply. When space stays low after that, it notifies once a day.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk import schedule
from botcore.commands.disk.git import GitError, list_worktrees
from botcore.commands.disk.scan import mount_point, volume_id, volume_state
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


# ── The settings file ───────────────────────────────────────────────────────


def _toml_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    raise TypeError(f"cannot write {type(value).__name__} to TOML")


def settings_toml(settings: MachineSettings) -> str:
    """The machine settings as TOML. Setup writes the whole file; comments are not kept."""
    data = settings.model_dump(exclude_none=True)
    tables = {key: data.pop(key) for key in ("volume", "aged")}
    lines = ["# Written by `botcore disk-setup`; safe to edit. See the disk-hygiene skill.", ""]
    lines += [f"{key} = {_toml_value(value)}" for key, value in data.items()]
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
    """Record every volume holding a registered repository's worktrees or T3 Code's folders."""
    added = []
    known = {str(expand(v.mount)) for v in settings.volume}
    paths: list[Path] = list(t3_worktree_roots(settings))
    for repo in settings.repos:
        try:
            _common, worktrees = list_worktrees(expand(repo))
        except GitError:
            continue
        paths += [w.path for w in worktrees]
    for path in paths:
        if not path.exists():
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


def _persistent_exe() -> tuple[str | None, str | None]:
    """The installed `botcore` the scheduler should run, or why there is none."""
    found = shutil.which("botcore")
    if found is None:
        return None, "no botcore on PATH"
    real = os.path.realpath(found)
    cache = None
    uv = shutil.which("uv")
    if uv:
        done = subprocess.run([uv, "cache", "dir"], capture_output=True, text=True, timeout=30,
                              check=False)
        cache = done.stdout.strip() or None
    if cache and os.path.normcase(real).startswith(os.path.normcase(os.path.realpath(cache))):
        return None, "the botcore on PATH lives in uv's cache, which the job prunes"
    return found, None


def _path_env() -> str:
    seen: list[str] = []
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry and entry not in seen and os.path.isdir(entry):
            seen.append(entry)
    return os.pathsep.join(seen)


async def disk_setup(
    uninstall: bool = False,
    repos: list[str] | None = None,
    install_schedule: bool = True,
) -> CommandResult[dict]:
    """Register this repository (and `repos`), record watched volumes, install the schedule.

    Safe to run again: it adds what is missing and never removes a repository or volume.
    `uninstall` removes the schedule only; settings and receipts stay where `disk-status` says.
    """
    if uninstall:
        state = schedule.uninstall()
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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(settings_toml(settings), encoding="utf-8")
    data: dict = {"settings": str(path), "added_repos": added_repos,
                  "added_volumes": added_volumes, "repos": settings.repos}
    if not install_schedule:
        return success(data=data)
    exe, why = _persistent_exe()
    if exe is None:
        return error(
            "DISK_TOOL_NOT_INSTALLED", why or "botcore is not installed",
            suggestion="Install it as a tool first: uv tool install 'lushly-botcore==<version>'",
        )
    state = schedule.install(exe, state_path(), _path_env())
    data["schedule"] = state.as_dict()
    if not state.installed:
        return error("DISK_SCHEDULE_FAILED", state.detail or "the scheduler refused the job",
                     suggestion="Read the detail, fix it, and run disk-setup again")
    schedule.run_now()
    return success(data=data, suggestions=[
        "Approve any permission prompt now: the first run has started",
        "disk-status shows the last run",
    ])


# ── Status ──────────────────────────────────────────────────────────────────


def _read_status() -> dict:
    path = state_path() / "status.json"
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, ValueError):
        return {}


def _age_hours(stamp: str | None) -> float | None:
    if not stamp:
        return None
    try:
        then = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    return round((datetime.now(UTC) - then).total_seconds() / 3600, 1)


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
    data = {
        "settings": {"path": str(path), "found": found},
        "state": str(state_path()),
        "schedule": sched.as_dict(),
        "last_apply": last_apply or None,
        "last_apply_hours_ago": age,
        "last_check": status.get("last_check"),
        "volumes": volumes,
        "healthy": not problems,
        "problems": problems,
    }
    return success(data=data, suggestions=problems[:1] or ["Nothing to do"])


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


def _write_check(status: dict) -> None:
    folder = state_path()
    folder.mkdir(parents=True, exist_ok=True)
    status["last_check"] = datetime.now(UTC).isoformat(timespec="seconds")
    (folder / "status.json").write_text(json.dumps(status, indent=1), encoding="utf-8")


async def disk_run(force: bool = False) -> CommandResult[dict]:
    """What the schedule runs: a free-space check, and a reclaim when it is due or space is low."""
    from botcore.commands.disk.reclaim import disk_reclaim

    try:
        settings, _path, _found = load_machine_settings()
    except SettingsError as exc:
        return error("DISK_SETTINGS_INVALID", str(exc),
                     suggestion="Fix the machine settings file; the job will retry next hour")
    low = [v["mount"] for v in _volumes_now(settings) if v["below_threshold"]]
    status = _read_status()
    age = _age_hours((status.get("last_apply") or {}).get("at"))
    due = force or bool(low) or age is None or age * 3600 >= FULL_RUN_SECONDS
    if not due:
        _write_check(status)
        return success(data={"ran": False, "low": low, "last_apply_hours_ago": age})
    result = await disk_reclaim(tier=1, apply=True, pressure=False)
    status = _read_status()
    still_low = result.data.get("still_low", []) if result.success and result.data else low
    last_notice = status.get("notified_at") or 0
    if still_low and time.time() - float(last_notice) > NOTIFY_SECONDS:
        notify("Disk space is still low", ", ".join(still_low) + ": run botcore disk-report")
        status["notified_at"] = time.time()
    _write_check(status)
    return success(data={"ran": True, "low": low, "still_low": still_low,
                         "reclaim_ok": result.success,
                         "receipt": (result.data or {}).get("receipt") if result.success else None})
