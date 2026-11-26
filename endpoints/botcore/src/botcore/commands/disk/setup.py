"""`disk-setup`, `disk-status` and `disk-run`: install the schedule, read its state, run it.

`disk-run` is what the scheduler starts every hour. It reads free space and exits, unless a
watched volume is below its threshold or the last full run is a day old; then it runs
`disk-reclaim` with apply. When space stays low after that, it notifies once a day.

Every run of the scheduler's ends by itself. The disk work, the collection of skill usage and
the collection of gate outcomes are steps (`steps.py`), one after the other: a step that only
waits, because a drive is away or the operating system wants the owner's consent, is left
behind, and the status says what it was doing. Each has its own limit and its own line in
check.json and in the run's answer, so one's trouble never stops another.
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
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from afd import CommandResult, error, success

from botcore.commands.disk import schedule
from botcore.commands.disk.caches import aged_base
from botcore.commands.disk.cargo import cargo_check, cargo_roots
from botcore.commands.disk.git import GitError, list_worktrees, path_key
from botcore.commands.disk.lock import waited_lock
from botcore.commands.disk.scan import (
    exists,
    mount_point,
    snapshot_volume_group_id,
    volume_id,
    volume_state,
)
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
from botcore.commands.disk.steps import (
    Step,
    consent_hint,
    describe,
    doing,
    raised_text,
    run_blocking,
)

FULL_RUN_SECONDS = 23 * 3600
STALE_SECONDS = 48 * 3600
NOTIFY_SECONDS = 24 * 3600
# How long skill usage, or gate outcomes, may fail to collect before the status calls it a
# problem. What a harness drops in the meantime cannot be collected later.
USAGE_STALE_SECONDS = 24 * 3600
# How long a skill usage collection may say nothing before the job stops counting on it. A
# collection that keeps reporting progress (reading a large store on a busy machine) runs
# until it finishes, as the disk work does (lushly-dev/afd#2160).
USAGE_SECONDS = 300
# How long a gate outcome collection may say nothing before the job stops counting on it. It
# says something before every request to GitHub and every git command, each with its timeout
GATE_SECONDS = 300
# How long the scheduler's run gives the gate outcome step in all. A collection holds itself
# to its requests and to half the account's allowance; this bounds one whose requests are
# slow, and the next hour's goes on from where it got
GATE_TOTAL_SECONDS = 40 * 60
# How long a step may say nothing, beyond what its last word allowed, before the job stops
# counting on it. A step that is working says so for every folder, file and command.
QUIET_SECONDS = 300
# How often the job looks at the steps it waits for
POLL_SECONDS = 0.2
# How long the job waits for its own settings and state files: small and local, unless the
# owner pointed them at a drive
STATE_SECONDS = 30
# How long disk-status waits for what it reads from the machine as it is now
STATUS_SECONDS = 20
# How long a writer of check.json waits for another process that is writing it
CHECK_LOCK_SECONDS = 5
# How long a replace of a state file, or a read of one, waits for a Windows handle on it
REPLACE_SECONDS = 2.0
# How long a call that was cancelled waits for the steps it told to stop
LEAVE_SECONDS = 10
# How long without a check before the status says so. The scheduler starts the job every
# hour, and at once when a machine wakes.
HEARTBEAT_SECONDS = 3 * 3600
# Whether a run reads its folders before anything else: on the system that asks the owner
# before a scheduled program reads some of them. Elsewhere an hour with nothing due reads
# free space and no folder, as before.
REACH = sys.platform == "darwin"
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
OMIT_AT_DEFAULT = (
    "remove_landed",
    "idle_worktree_limit",
    "skill_usage_collect",
    "skill_usage_away",
    "skill_usage_dirs",
    "gate_outcome_checkouts",
)


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


def _migrate_snapshot_volumes(settings: MachineSettings) -> dict[str, dict[str, str]]:
    """Replace an ephemeral macOS APFS boot-snapshot UUID recorded for an internal `/` volume
    with its persistent `APFSVolumeGroupID` (lushly-dev/afd#2267). External drives (including an
    external macOS boot volume), non-root mounts and `id=None` entries are never touched."""
    updated: dict[str, dict[str, str]] = {}
    for vol in settings.volume:
        if vol.id is None:
            continue
        mount = expand(vol.mount)
        if mount != Path("/"):
            continue
        group_id = snapshot_volume_group_id(mount)
        if group_id and vol.id != group_id:
            updated[vol.mount] = {"was": vol.id, "now": group_id}
            vol.id = group_id
    return updated


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
        settings.volume.append(
            VolumeSettings(
                mount=str(mount),
                id=volume_id(mount),
                low_space_gb=default_low_space_gb(mount),
            )
        )
        added.append(str(mount))
    return added


def uv_cache_dir() -> str | None:
    uv = shutil.which("uv")
    if uv is None:
        return None
    try:
        done = subprocess.run(
            [uv, "cache", "dir"], capture_output=True, text=True, timeout=30, check=False
        )
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
        if (
            os.path.dirname(resolved) == resolved
            or home == resolved
            or home.startswith(resolved.rstrip(os.sep) + os.sep)
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


def _runnable_file(path: str) -> bool:
    """Whether `path` is a file this platform can execute directly."""
    if not os.path.isfile(path):
        return False
    if os.name == "nt":
        exts = {
            ext.lower()
            for ext in os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(os.pathsep)
            if ext
        }
        return os.path.splitext(path)[1].lower() in exts
    return os.access(path, os.X_OK)


def _usable_tool(name: str, path: str) -> bool:
    """Whether an existing `[tools]` entry is still a lasting, runnable file for `name`."""
    return (
        bool(path)
        and os.path.isabs(path)
        and not _session_path(path)
        and _tool_name(path) == name
        and _runnable_file(path)
    )


def record_tools(settings: MachineSettings) -> dict[str, str]:
    """Record a lasting path for each tool the job runs; a scheduler starts it without the
    user's shell PATH. Existing entries whose file still exists and runs the tool are kept so
    a rerun from another shell's PATH does not replace them (lushly-dev/afd#1934). A tool
    whose path only lives in a shell session is left out."""
    for name in TOOLS:
        existing = settings.tools.get(name)
        if existing and _usable_tool(name, existing):
            continue
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
) -> CommandResult[dict[str, Any]]:
    """Register this repository (and `repos`), record watched volumes, install the schedule.

    Safe to run again: it adds what is missing and never removes a repository or volume.
    `uninstall` removes the schedule only; settings and receipts stay where `disk-status` says.
    """
    return await run_blocking(_disk_setup_sync, uninstall, repos, install_schedule, remove_landed)


def _disk_setup_sync(
    uninstall: bool,
    repos: list[str] | None,
    install_schedule: bool,
    remove_landed: bool | None,
) -> CommandResult[dict[str, Any]]:
    if uninstall:
        schedule.uninstall()
        state = schedule.current()
        if state.installed:
            detail = f" ({state.detail})" if state.detail else ""
            return error(
                "DISK_SCHEDULE_FAILED",
                f"the job is still installed at {state.where}{detail}",
                suggestion="Remove it with the platform's scheduler, then run again",
            )
        return success(
            data={
                "schedule": state.as_dict(),
                "settings": str(settings_path()),
                "state": str(state_path()),
            },
            suggestions=["Settings and receipts were kept; delete them if unwanted"],
        )
    try:
        settings, path, _found = load_machine_settings()
    except SettingsError as exc:
        return error(
            "DISK_SETTINGS_INVALID",
            str(exc),
            suggestion="Fix the machine settings file, or move it aside and run again",
        )
    added_repos = []
    for candidate in [*(repos or []), str(Path.cwd())]:
        main = _main_checkout(expand(candidate))
        if main is not None and str(main) not in {str(expand(r)) for r in settings.repos}:
            settings.repos.append(str(main))
            added_repos.append(str(main))
    updated_volumes = _migrate_snapshot_volumes(settings)
    added_volumes = _watch_volumes(settings)
    before_tools = dict(settings.tools)
    record_tools(settings)
    changed_tools = {
        name: {"was": before_tools.get(name), "now": settings.tools.get(name)}
        for name in sorted(set(before_tools) | set(settings.tools))
        if before_tools.get(name) != settings.tools.get(name)
    }
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
    data: dict[str, Any] = {
        "settings": str(path),
        "added_repos": added_repos,
        "added_volumes": added_volumes,
        "updated_volumes": updated_volumes,
        "repos": settings.repos,
        "tools": settings.tools,
        "changed_tools": changed_tools,
        "remove_landed": settings.remove_landed,
        "cargo": cargo,
    }
    if not install_schedule:
        return success(data=data, suggestions=cargo["problems"])
    err_details: dict[str, Any] = {"settings": str(path), "changed_tools": changed_tools}
    if updated_volumes:
        err_details["updated_volumes"] = updated_volumes
    checkouts: list[Path] = []
    for repo in settings.repos:
        try:
            checkouts += [w.path for w in list_worktrees(expand(repo))[1]]
        except GitError:
            continue
    exe, why = _persistent_exe(checkouts)
    if exe is None:
        return error(
            "DISK_TOOL_NOT_INSTALLED",
            why or "botcore is not installed",
            suggestion="Install it as a tool first: uv tool install 'lushly-botcore==<version>'",
            details=err_details,
        )
    state = schedule.install(exe, state_path(), job_path(settings))
    data["schedule"] = state.as_dict()
    if not state.installed:
        return error(
            "DISK_SCHEDULE_FAILED",
            state.detail or "the scheduler refused the job",
            suggestion="Read the detail, fix it, and run disk-setup again",
            details=err_details,
        )
    schedule.run_now()
    return success(
        data=data,
        suggestions=[
            *cargo["problems"],
            "Approve any permission prompt now: the first run has started",
            "disk-status shows the last run",
        ],
    )


# ── Status ──────────────────────────────────────────────────────────────────


def _read_json(name: str) -> dict[str, Any]:
    """A state file as it stands, or `{}`. A read that meets the file while a writer replaces
    it on Windows (`PermissionError`) is tried again for `REPLACE_SECONDS`, so `disk-status`
    and the run's own notification time never read a record as missing (#2538)."""
    path = state_path() / name
    until = time.monotonic() + REPLACE_SECONDS
    while True:
        try:
            data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except PermissionError:
            if time.monotonic() < until:
                time.sleep(0.01)
                continue
            return {}
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}


def _read_status() -> dict[str, Any]:
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


def _counted_warnings(
    settings: MachineSettings,
    status: dict[str, Any],
    registered_only: bool = True,
) -> list[str]:
    """Repositories over the idle-worktree limit when a reclaim last counted them, from
    what that reclaim wrote. A count older than 48 hours says when it was taken.

    `registered_only` leaves out a repository that is no longer registered. Telling takes
    resolving its path, which reads the volume it is on: without it every count is given,
    and nothing is read."""
    snapshot = status.get("worktree_warnings")
    repos = snapshot.get("repos") if isinstance(snapshot, dict) else None
    registered: set[str] = set()
    if registered_only:
        for repo in settings.repos:
            doing("resolving", expand(repo))
            registered.add(path_key(expand(repo)))
    warnings = []
    for main, entry in (repos if isinstance(repos, dict) else {}).items():
        if not isinstance(entry, dict) or not isinstance(entry.get("warning"), str):
            continue
        checkout = entry.get("checkout") or main
        if registered:
            doing("resolving", checkout)
            if path_key(checkout) not in registered:
                doing("resolving", main)
                if path_key(main) not in registered:
                    continue  # no longer registered
        age = _age_hours(entry.get("at"))
        stale = age is None or age * 3600 > STALE_SECONDS
        warnings.append(entry["warning"] + (f" (counted {entry.get('at')})" if stale else ""))
    return warnings


def disk_warnings(
    settings: MachineSettings | None = None, status: dict[str, Any] | None = None
) -> list[str]:
    """What the owner should fix that does not stop a run: registered repositories over the
    idle-worktree limit when a reclaim last counted them, and Cargo output no [[aged]] folder
    clears. Factory's lane-status shows these to the foreman before it starts cells."""
    if settings is None:
        try:
            settings = load_machine_settings()[0]
        except SettingsError:
            return []
    counted = _counted_warnings(settings, status if status is not None else _read_status())
    problems: list[str] = list(cargo_check(settings)["problems"])
    return counted + problems


def _volumes_now(settings: MachineSettings) -> list[dict[str, Any]]:
    return [volume_state(expand(v.mount), v.id, v.low_space_gb).as_dict() for v in settings.volume]


def _saved() -> tuple[MachineSettings, Path, bool, dict[str, Any], dict[str, Any]]:
    """The machine settings and what the job last wrote, each named before it is read."""
    doing("reading", settings_path())
    settings, path, found = load_machine_settings()
    doing("reading", state_path() / "status.json")
    status = _read_status()
    doing("reading", state_path() / "check.json")
    return settings, path, found, status, _read_json("check.json")


def _live(settings: MachineSettings, status: dict[str, Any]) -> dict[str, Any]:
    """What `disk-status` reads from the machine as it is now, and not from the job's files:
    the scheduler, the watched volumes, which counted repositories are still registered,
    and what Cargo's settings say."""
    doing("asking the scheduler")
    found = {"schedule": schedule.current(), "volumes": _volumes_now(settings)}
    found["counted"] = _counted_warnings(settings, status)
    doing("reading Cargo's settings")
    return {**found, "cargo": cargo_check(settings)["problems"]}


# The last read of the machine that has not come back, and what it was started with (the
# settings, and the counts a reclaim wrote): a status asked again of the same waits for
# that one and starts no other, so a process that lives on holds one reader and not one a
# call.
_LIVE: tuple[Step, tuple[MachineSettings, object]] | None = None


async def disk_status() -> CommandResult[dict[str, Any]]:
    """The schedule, the last runs, free space on watched volumes, and whether anything is
    stale.

    Nothing here can wait at the folder it is asked about. Everything read, the job's own
    files first and then the machine as it is now, has `STATUS_SECONDS` in all. When the
    machine does not answer, the status says what it was reading and gives what the job
    last wrote. The reader is left where it waits; it only reads.
    """
    global _LIVE  # noqa: PLW0603 - one outstanding read for the process
    began = time.monotonic()

    def spent() -> bool:
        return time.monotonic() - began >= STATUS_SECONDS

    files = Step("disk-status-files", _saved)
    await _wait([files], spent)
    if not files.done:
        said = files.now()
        return error(
            "DISK_STATE_UNANSWERED",
            _with_hint(
                f"The status has been {describe(said)} and it has not answered",
                said[1] if said else "",
            ),
            suggestion="The machine settings and the state folder must be on a drive that answers",
        )
    if isinstance(files.outcome.get("raised"), SettingsError):
        return error(
            "DISK_SETTINGS_INVALID",
            str(files.outcome["raised"]),
            suggestion="Fix the machine settings file, or move it aside and run setup",
        )
    if "raised" in files.outcome:
        raise files.outcome["raised"]
    settings, path, found, status, check = files.outcome["result"]
    last_apply = status.get("last_apply") or {}
    age = _age_hours(last_apply.get("at"))
    asked = (settings, status.get("worktree_warnings"))
    if _LIVE is not None and not _LIVE[0].done and _LIVE[1] == asked:
        live = _LIVE[0]
    else:
        live = Step("disk-status", lambda: _live(settings, status))
        _LIVE = (live, asked)
    await _wait([live], spent)
    if "raised" in live.outcome:
        raise live.outcome["raised"]
    now = live.outcome.get("result")
    volumes = now["volumes"] if now else []
    sched = now["schedule"] if now else None
    problems = []
    if now is None:
        said = live.now()
        problems.append(
            _with_hint(
                f"this machine did not answer in {STATUS_SECONDS:g} seconds: the status was "
                f"{describe(said)}; what follows is what the job last wrote",
                said[1] if said else "",
            )
        )
    if not found:
        problems.append("no machine settings: run disk-setup")
    if sched is not None and not sched.installed:
        problems.append("the schedule is not installed: run disk-setup")
    if age is None or age * 3600 > STALE_SECONDS:
        problems.append("no successful run in the last 48 hours")
    elif not last_apply.get("ok"):
        problems.append("the last run had failures: read its receipt")
    problems += [
        f"{v['mount']} is below {v['low_space_gb']} GB free"
        for v in volumes
        if v["below_threshold"]
    ]
    problems += [
        f"{v['mount']} is not mounted or not the recorded volume"
        for v in volumes
        if not v["verified"]
    ]
    usage = check.get("skill_usage") if settings.skill_usage_collect else None
    usage = usage if isinstance(usage, dict) else None
    gate = check.get("gate_outcome") if settings.gate_outcome_checkouts else None
    gate = gate if isinstance(gate, dict) else None
    # what a reclaim counted is on file: all of it, when the machine does not say which
    # of those repositories are still registered. What Cargo's settings say is read now.
    warnings = (
        (now["counted"] + now["cargo"])
        if now
        else _counted_warnings(settings, status, registered_only=False)
    )
    work = check.get("disk_work")
    work = work if isinstance(work, dict) else None
    if work and not work.get("ok"):
        why = work.get("error") or "it failed"
        if work.get("waiting_on"):
            # it never came back: nothing but the owner's answer, or the drive, will change it
            since = _age_hours(work.get("failing_since"))
            lasted = f" (for {since:.0f} hours)" if since and since >= 1 else ""
            problems.append(f"the scheduled disk work is waiting: {why}{lasted}")
        elif work.get("reclaim_ok") is not False:
            # (what a reclaim could not do is told by its receipt, in the problem above,
            # for as long as that reclaim is the last one)
            warnings.append(f"the scheduled disk work failed: {why}")
    if sched is not None and sched.installed:
        beat = _age_hours(check.get("last_check"))
        if beat is None:
            warnings.append("the schedule is installed and no scheduled check is recorded yet")
        elif beat * 3600 > HEARTBEAT_SECONDS:
            warnings.append(f"the scheduled job last checked in {beat:.0f} hours ago")
    for what, kept in (("skill usage is", usage), ("gate outcomes are", gate)):
        _failing(what, kept, problems, warnings)
    data = {
        "settings": {"path": str(path), "found": found},
        "state": str(state_path()),
        "schedule": sched.as_dict() if sched is not None else None,
        "last_apply": last_apply or None,
        "last_apply_hours_ago": age,
        "last_check": check.get("last_check"),
        "disk_work": work,
        "skill_usage": usage,
        "gate_outcome": gate,
        "volumes": volumes,
        "healthy": not problems,
        "problems": problems,
        "warnings": warnings,
    }
    return success(data=data, suggestions=problems[:1] or data["warnings"][:1] or ["Nothing to do"])


# ── The scheduled job ───────────────────────────────────────────────────────


def notify(title: str, message: str) -> None:
    """A desktop notification; silently nothing where none is available."""
    try:
        if sys.platform == "darwin":
            script = f"display notification {json.dumps(message)} with title {json.dumps(title)}"
            subprocess.run(
                ["osascript", "-e", script], timeout=30, check=False, capture_output=True
            )
        elif sys.platform == "win32":
            ps = (
                "Add-Type -AssemblyName System.Windows.Forms;"
                "$n=New-Object System.Windows.Forms.NotifyIcon;"
                "$n.Icon=[System.Drawing.SystemIcons]::Warning;$n.Visible=$true;"
                f"$n.ShowBalloonTip(10000,{json.dumps(title)},{json.dumps(message)},'Warning');"
                "Start-Sleep -Seconds 11;$n.Dispose()"
            )
            subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                timeout=60,
                check=False,
                capture_output=True,
            )
        elif shutil.which("notify-send"):
            subprocess.run(
                ["notify-send", title, message], timeout=30, check=False, capture_output=True
            )
    except (OSError, subprocess.TimeoutExpired):
        pass


_CHECK_LOCK = threading.Lock()  # the disk work and the job both write check.json


class StateBusy(OSError):
    """Another run is writing check.json and did not finish in time."""


def _update_check(change: Callable[[dict[str, Any]], None]) -> None:
    """check.json: the job's own heartbeat and notification time, apart from status.json.
    `change` is given the file as it stands. Two threads of a run write it, and so can two
    runs, one started by hand while the scheduler's is going: the read and the write are one
    step under a lock both kinds share.

    Never written without that lock, and never over a file that could not be read: either
    would lose what another writer kept. Raises OSError then (`StateBusy` for the lock).
    A file that is there and is not JSON is not this job's, and starts empty."""
    folder = state_path()
    with _CHECK_LOCK, waited_lock(folder / "check.lock", CHECK_LOCK_SECONDS) as held:
        if not held:
            raise StateBusy(f"{folder / 'check.json'} is being written by another run")
        try:
            data = json.loads((folder / "check.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            data = {}
        except ValueError:
            data = {}  # not what this writes: there is nothing in it to keep
        data = data if isinstance(data, dict) else {}
        change(data)
        data["last_check"] = datetime.now(UTC).isoformat(timespec="seconds")
        tmp = folder / f".check.json.{os.getpid()}.tmp"
        try:
            tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
            _replace(tmp, folder / "check.json")
        except BaseException:
            tmp.unlink(missing_ok=True)  # a write that failed leaves nothing behind
            raise


def _replace(tmp: Path, path: Path) -> None:
    """`os.replace`, retried while a reader holds `path` open: Windows refuses to replace an
    open file (`PermissionError`) where POSIX does not, and `disk-status` or another run may be
    reading it at that moment (lushly-dev/afd#2538). Past `REPLACE_SECONDS` the error stands."""
    until = time.monotonic() + REPLACE_SECONDS
    while True:
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if time.monotonic() >= until:
                raise
            time.sleep(0.01)


def _write_check(update: dict[str, Any]) -> None:
    """The disk work's own notes in check.json, as it goes. A note that cannot be written
    (a full disk, which is when this runs) never fails the work: the run's record, written
    at its end, is what says the state could not be written."""
    try:
        _update_check(lambda data: data.update(update))
    except OSError:
        pass


def _newly_low(volumes: list[dict[str, Any]], last_apply: dict[str, Any]) -> list[str]:
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


def _outcome(previous: object, failure: str | None, found: dict[str, Any]) -> dict[str, Any]:
    """What check.json keeps of one part of the job (`disk_work`, `skill_usage`), given what
    it kept before: whether it worked, when it last did, and since when it has not."""
    now = datetime.now(UTC).isoformat(timespec="seconds")
    previous = previous if isinstance(previous, dict) else {}
    if failure is None:
        return {"at": now, "ok": True, "ok_at": now, **found}
    return {
        "at": now,
        "ok": False,
        "ok_at": previous.get("ok_at"),
        "failing_since": (previous.get("failing_since") if previous.get("ok") is False else None)
        or now,
        "error": failure,
        **found,
    }


def _failing(
    what: str, kept: dict[str, Any] | None, problems: list[str], warnings: list[str]
) -> None:
    """A collection the job keeps a line for that is failing: a warning, and a problem once
    it has failed for a day."""
    if not kept or kept.get("ok"):
        return
    failing = f"{what} not being collected: {kept.get('error') or 'it failed'}"
    # how long it has been failing, not how long since it worked: a machine that slept for
    # two days and fails once on waking has failed for an hour
    since = _age_hours(kept.get("failing_since") or kept.get("ok_at"))
    if since is not None and since * 3600 > USAGE_STALE_SECONDS:
        problems.append(f"{failing} (for {since:.0f} hours)")
    else:
        warnings.append(failing)


def _with_hint(text: str, path: str) -> str:
    hint = consent_hint(path)
    return f"{text}. {hint}" if hint else text


Said = tuple[str, str, float]  # what a step is doing, to which path, for how many seconds


def _look(step: Step) -> tuple[str, Said | None, int | None]:
    """`done`, `working` or `waiting`, what the step was doing, and which word it was: from
    one look, since a step can come back between two."""
    if step.done:
        return "done", None, None
    seen = step.seen()
    if seen is None:  # it came back this instant
        return "working", None, None
    what, path, lasted, quiet, word = seen
    limit = {"skill-usage-collect": USAGE_SECONDS, "gate-outcome-collect": GATE_SECONDS}.get(
        step.name, QUIET_SECONDS
    )
    return ("waiting" if quiet >= limit else "working"), (what, path, lasted), word


def _disk_outcome(step: Step, look: str, said: Said | None) -> tuple[str | None, dict[str, Any]]:
    """Why the disk work is not done, or None, and what else the status shows of it. For a
    step seen `done` or `waiting`: one that is working has no outcome yet."""
    if look == "waiting":
        path = said[1] if said else ""
        waiting = {"what": said[0], "path": path} if said else {"what": "starting", "path": ""}
        return (
            _with_hint(f"it has been {describe(said)} and has not come back", path),
            {"waiting_on": waiting},
        )
    if "raised" in step.outcome:
        return f"{type(step.outcome['raised']).__name__}: {step.outcome['raised']}", {}
    result = step.outcome["result"]
    if not result.success:
        return (result.error.message if result.error else "the disk work failed"), {}
    data = result.data if isinstance(result.data, dict) else {}
    found = {"ran": bool(data.get("ran"))}
    if data.get("reclaim_ok") is False:
        # it came back, and its receipt lists what it could not do: not a time it worked
        return (
            f"the reclaim had {data.get('failures', 0)} failures: read its receipt",
            {**found, "reclaim_ok": False},
        )
    return None, found


def _usage_outcome(step: Step, look: str, said: Said | None) -> tuple[str | None, dict[str, Any]]:
    """Why skill usage was not collected, or None, and how many events were added."""
    from botcore.commands.skill_usage.store import SHARING

    if look != "done":
        what, path = (said[0], said[1]) if said else ("starting", "")
        if what == SHARING:
            # the record is written before it is shared: what did not answer is the folder
            text = (
                f"this machine's record was collected, but the shared folder did not "
                f"answer in {USAGE_SECONDS:g} seconds: {path}"
            )
        else:
            text = f"it made no progress for {USAGE_SECONDS:g} seconds"
            if what != "starting":
                text += f": it was {what} {path}".rstrip()
        return _with_hint(text, path), {}
    if "raised" in step.outcome:
        return f"{type(step.outcome['raised']).__name__}: {step.outcome['raised']}", {}
    result = step.outcome["result"]
    data = result.data or {}
    raw_shared = data.get("shared")
    shared: dict[str, Any] = raw_shared if isinstance(raw_shared, dict) else {}
    if not result.success:
        return (result.error.message if result.error else "the collection failed"), {}
    if shared.get("error"):
        return f"the shared folder could not be written: {shared['error']}", {}
    return None, {"added": data.get("added", 0)}


def _gate_outcome(step: Step, look: str, said: Said | None) -> tuple[str | None, dict[str, Any]]:
    """Why gate outcomes were not all collected, or None, and each checkout's collection.
    `look` is `over` for a step left at GATE_TOTAL_SECONDS."""
    if look == "over":
        doing_now = f": it was {said[0]} {said[1]}".rstrip() if said else ""
        return (
            f"it was still collecting after {GATE_TOTAL_SECONDS / 60:g} minutes, the step's "
            f"limit{doing_now}; the next hour's collection goes on from where it got"
        ), {}
    if look != "done":
        what, path = (said[0], said[1]) if said else ("starting", "")
        text = f"it made no progress for {GATE_SECONDS:g} seconds"
        if what != "starting":
            text += f": it was {what} {path}".rstrip()
        return _with_hint(text, path), {}
    if "raised" in step.outcome:
        return f"{type(step.outcome['raised']).__name__}: {step.outcome['raised']}", {}
    data = step.outcome["result"]
    found = {"checkouts": data["checkouts"]}
    refused = [
        f"{entry['checkout']}: {entry['error']['code']}: {entry['error']['message']}"
        for entry in data["checkouts"]
        if "error" in entry
    ]
    if refused:
        return "the collection was refused for " + "; ".join(refused), found
    # collected, and its record could not be shared or folded: what the next hour must mend
    unmended = [
        f"{entry['checkout']}: {entry[key]['error']}"
        for entry in data["checkouts"]
        for key in ("shared", "folded")
        if isinstance(entry.get(key), dict) and entry[key].get("error")
    ]
    if unmended:
        return "collected, but " + "; ".join(unmended), found
    return None, found


def _kept(previous: object, failure: str | None, found: dict[str, Any]) -> dict[str, Any] | None:
    """What to keep of the disk work, or None to keep what is there. An hour with nothing
    due does not clear what a reclaim could not do: only another reclaim knows better."""
    before = previous if isinstance(previous, dict) else {}
    if failure is None and not found.get("ran") and before.get("reclaim_ok") is False:
        return None
    return _outcome(previous, failure, found)


async def _wait(steps: list[Step], until: Callable[[], bool]) -> None:
    """Wait for every step, or until `until` says to wait no longer. A host's other calls
    go on meanwhile."""
    while any(not step.done for step in steps) and not until():
        await asyncio.sleep(POLL_SECONDS)


class Unanswered(Exception):
    """The job's own settings or state file did not answer in time."""


async def _answered(what: str, path: object, work: Callable[[], Any], bounded: bool) -> Any:
    """A read or write of the job's own files, off the caller's loop. `bounded`, it is a
    step too: those files are small and local unless the owner pointed them at a drive, and
    a drive can wait for ever like any other. Raises Unanswered after `STATE_SECONDS`, and
    what the work raised."""
    if not bounded:
        return await asyncio.to_thread(work)

    def told() -> Any:
        doing(what, path)
        return work()

    began = time.monotonic()
    step = Step("job-files", told)
    await _wait([step], lambda: time.monotonic() - began >= STATE_SECONDS)
    if not step.done:
        raise Unanswered(f"{what} {path} did not answer in {STATE_SECONDS:g} seconds")
    if "raised" in step.outcome:
        raise step.outcome["raised"]
    return step.outcome["result"]


async def disk_run(force: bool = False, own_process: bool = False) -> CommandResult[dict[str, Any]]:
    """What the schedule runs: a free-space check, a reclaim when it is due or space is low,
    and then the hourly collections of skill usage and, for the checkouts the machine names, of
    gate outcomes.

    `own_process` says this process exists for the run and ends with it, as the scheduler's
    does. Such a run always ends. Both the disk work and the skill usage collection are
    waited for while they report progress; once a step has said nothing for `QUIET_SECONDS`
    (or `USAGE_SECONDS` for collection) it is waiting, for a drive or for the owner's answer
    to the operating system, and the run leaves it. A step that is left starts nothing more:
    it stops at its next word, and the status says what it was doing.

    In a process that lives on (a host, a caller's own program) a step left in a read would
    stay there, holding its lock. So there the call waits for its steps however long they
    take, as it did before, and records what they wait for meanwhile. A call that is
    cancelled, or fails, tells its steps to stop and gives them `LEAVE_SECONDS`.
    """
    try:
        settings, _path, _found = await _answered(
            "reading", settings_path(), load_machine_settings, own_process
        )
    except SettingsError as exc:
        return error(
            "DISK_SETTINGS_INVALID",
            str(exc),
            suggestion="Fix the machine settings file; the job will retry next hour",
        )
    except Unanswered as exc:
        return error(
            "DISK_STATE_UNANSWERED",
            str(exc),
            suggestion="The machine settings must be on a drive that answers; the "
            "job will retry next hour",
        )
    disk = Step("disk-work", lambda: asyncio.run(_disk_work(settings, force)))
    started: list[Step] = [disk]
    try:
        return await _run(settings, disk, started, own_process)
    finally:
        # however the call ends, nothing it started begins anything more. The scheduler's
        # process ends here; one that lives on gives a step that is working a moment to stop
        # (one held in a read stays there until it is let go, and then stops).
        for step in started:
            step.leave()
        if not own_process and any(not step.done for step in started):
            began = time.monotonic()
            await _wait(started, lambda: time.monotonic() - began >= LEAVE_SECONDS)


@dataclass
class _Collected:
    """A collection step of the job: skill usage's or gate outcomes'."""

    key: str  # its line in check.json and in the run's answer
    step: Step
    judge: Callable[[Step, str, Said | None], tuple[str | None, dict[str, Any]]]
    left: tuple[str, Said | None] | None = None  # what was seen of it when the run left it
    kept: dict[str, Any] | None = None  # what check.json keeps of it


async def _follow(collected: _Collected, own_process: bool, total: float | None = None) -> None:
    """Wait for a collection step while it reports progress. In the scheduler's run, leave it
    once it has been quiet for its limit, or once it has run `total` seconds in all."""
    step, began = collected.step, time.monotonic()

    def over() -> bool:
        return own_process and total is not None and time.monotonic() - began >= total

    while True:
        look, said, word = _look(step)
        if look == "working" and over():
            step.leave()  # it stops at its next word, having begun nothing more
            collected.left = ("over", said)
            return
        if look == "working":
            await _wait([step], lambda: _look(step)[0] == "waiting" or over())
        elif look == "done" or not own_process:
            return
        elif step.leave(word):
            collected.left = ("waiting", said)
            return


async def _run(  # noqa: C901 - one run, start to end
    settings: MachineSettings,
    disk: Step,
    started: list[Step],
    own_process: bool,
) -> CommandResult[dict[str, Any]]:
    unwritten: str | None = None
    # What was seen of the disk work when the run left it, and where it was. That stands for
    # the rest of the run: the step ends later only because it was told to stop.
    left: tuple[str, Said | None] | None = None
    where = ""
    collections: list[_Collected] = []

    async def record() -> tuple[str, Said | None, bool]:
        """Write what stands of each step. Returns what was seen of the disk work, and
        whether every collection is done. Each step is looked at once, and what is written is
        fixed then: a write that is slow finds nothing newer to pick up."""
        nonlocal unwritten
        seen = left or _look(disk)[:2]
        work = None if seen[0] == "working" else _disk_outcome(disk, *seen)
        pending: dict[str, tuple[str | None, dict[str, Any]]] = {}
        done = True
        for collected in collections:
            looked = collected.left or _look(collected.step)[:2]
            done = done and looked[0] == "done"
            if looked[0] != "working":  # a step that works has no outcome yet
                pending[collected.key] = collected.judge(collected.step, *looked)
        kept: dict[str, Any] = {}

        def change(data: dict[str, Any]) -> None:
            if work is not None:
                keep = _kept(data.get("disk_work"), *work)
                if keep is not None:
                    data["disk_work"] = keep
            for key, outcome in pending.items():
                kept[key] = data[key] = _outcome(data.get(key), *outcome)

        try:
            await _answered(
                "writing", state_path() / "check.json", lambda: _update_check(change), own_process
            )
            unwritten = None
        except (Unanswered, OSError) as exc:  # a drive that is away, or one that is full
            unwritten = str(exc)
        for collected in collections:
            if collected.key in pending:
                collected.kept = kept.get(collected.key) or _outcome(None, *pending[collected.key])
        return (*seen, done)

    while True:
        look, said, word = _look(disk)
        if look == "working":
            await _wait([disk], lambda: _look(disk)[0] == "waiting")
        elif look == "done" or not own_process:
            break
        else:
            # Leave it, for this run: the next hour's starts again, with the owner's answer
            # or not. Only if it has said nothing since this look: one that has spoken again
            # is working, and is waited for.
            stack = disk.where()
            if disk.leave(word):
                left, where = ("waiting", said), stack
                break
    if look != "done":
        await record()  # before the collections, which can take their minutes
    if settings.skill_usage_collect:
        from botcore.commands.skill_usage import skill_usage_collect

        usage = Step("skill-usage-collect", lambda: asyncio.run(skill_usage_collect()))
        started.append(usage)
        collections.append(_Collected("skill_usage", usage, _usage_outcome))
        # Waited for while it reports progress (reading a large store on a busy machine), and
        # left only once it has been quiet for USAGE_SECONDS (lushly-dev/afd#2160).
        await _follow(collections[-1], own_process)
    if settings.gate_outcome_checkouts:
        from botcore.commands.gate_outcome import hourly

        if collections:
            await record()  # skill usage's line, before a collection that can take its minutes
        checkouts = list(settings.gate_outcome_checkouts)
        gate = Step("gate-outcome-collect", lambda: hourly.collect_checkouts(checkouts))
        started.append(gate)
        collections.append(_Collected("gate_outcome", gate, _gate_outcome))
        await _follow(collections[-1], own_process, GATE_TOTAL_SECONDS)
    look, said, all_done = await record()
    if not own_process and (look != "done" or not all_done):
        # what was just written says a step was not done: wait for them all, and write how
        # they ended, even when they have ended meanwhile
        await _wait(started, lambda: False)
        look, said, all_done = await record()
    if look != "done":
        failure, _found = _disk_outcome(disk, "waiting", said)
        print(f"the disk work was left waiting here:\n{where or disk.where()}", file=sys.stderr)
        return error(
            "DISK_RUN_STALLED",
            f"The disk work did not finish: {failure}",
            suggestion="disk-status shows what it waits for; the job tries again next hour",
        )
    if "raised" in disk.outcome:
        raised = disk.outcome["raised"]
        print(raised_text(raised), file=sys.stderr, end="")
        return error(
            "DISK_RUN_FAILED",
            f"{type(raised).__name__}: {raised}",
            suggestion="disk-status shows the state; the job will try again next hour",
        )
    if unwritten:
        return error(
            "DISK_STATE_UNANSWERED",
            f"The run's state was not written: {unwritten}",
            suggestion="The state folder must be on a drive that answers and has room",
        )
    result: CommandResult[dict[str, Any]] = disk.outcome["result"]
    if result.success and isinstance(result.data, dict):
        for collected in collections:
            if collected.kept is not None:
                result.data[collected.key] = collected.kept
    return result


def job_folders(settings: MachineSettings) -> Iterator[Path]:
    """Every folder the disk work reads, each once: the watched volumes, the registered
    repositories and their worktrees, the folders searched for worktrees no repository
    lists (the machine's own and T3 Code's), the aged folders, and Cargo output moved out
    of the worktrees.

    In an order that names a place before anything reads it: a repository before git lists
    its worktrees, and the worktrees before Cargo's settings are read from each of them. A
    read that waits is then the read of the folder just named.
    """
    seen: set[Path] = set()

    def new(folders: Iterable[Path]) -> Iterator[Path]:
        for folder in folders:
            if folder not in seen:
                seen.add(folder)
                yield folder

    yield from new(expand(volume.mount) for volume in settings.volume)
    for repo in settings.repos:
        yield from new([expand(repo)])
        try:
            worktrees = list_worktrees(expand(repo))[1]
        except GitError:
            continue
        yield from new(worktree.path for worktree in worktrees)
    yield from new(expand(root) for root in settings.worktree_roots)
    yield from new(t3_worktree_roots(settings)[0])  # (it names T3 Code's settings itself)
    for aged in settings.aged:
        yield from new([aged_base(aged.path)])
    yield from new(cargo_roots(settings))


def _peek(folder: Path) -> None:
    """Whether a folder can be read: its first entry says so, however many it holds."""
    with os.scandir(folder) as entries:
        next(entries, None)


def _reach(settings: MachineSettings) -> None:
    """Read every folder the disk work reads, once, before anything is done with them.

    Where the operating system wants the owner's consent first, the run waits here, in its
    first second, and every hour: so the question comes up in the run that `disk-setup`
    starts, with the owner at the machine, and not a day later in the first reclaim the
    schedule runs alone.
    """
    for folder in job_folders(settings):
        doing("reading", folder)
        try:
            _peek(folder)
        except OSError:
            pass  # gone or not to be read: the reclaim says so of what it needs
    doing("checking free space")


async def _disk_work(settings: MachineSettings, force: bool) -> CommandResult[dict[str, Any]]:
    """The disk part of the job: nothing here waits on, or fails with, the collection."""
    from botcore.commands.disk.reclaim import disk_reclaim

    apply_tool_path(settings)
    volumes = _volumes_now(settings)
    low = [v["mount"] for v in volumes if v["below_threshold"]]
    if REACH:
        _reach(settings)
    last_apply = _read_status().get("last_apply") or {}
    age = _age_hours(last_apply.get("at"))
    newly_low = _newly_low(volumes, last_apply)
    due = force or bool(newly_low) or age is None or age * 3600 >= FULL_RUN_SECONDS
    if not due:
        _write_check({})
        return success(data={"ran": False, "low": low, "last_apply_hours_ago": age})
    result = await disk_reclaim(tier=2 if settings.remove_landed else 1, apply=True, pressure=False)
    if not result.success:
        _write_check({"last_error": result.error.message if result.error else "failed"})
        code = result.error.code if result.error else "DISK_RECLAIM_FAILED"
        return error(
            code,
            result.error.message if result.error else "the reclaim failed",
            suggestion="disk-status shows the state; the job will try again next hour",
        )
    data = result.data or {}
    still_low = data.get("still_low", [])
    check = _read_json("check.json")
    update: dict[str, Any] = {"last_error": None}
    if still_low and time.time() - float(check.get("notified_at") or 0) > NOTIFY_SECONDS:
        notify("Disk space is still low", ", ".join(still_low) + ": run botcore disk-report")
        update["notified_at"] = time.time()
    _write_check(update)
    return success(
        data={
            "ran": True,
            "low": low,
            "still_low": still_low,
            "reclaim_ok": not data.get("failures"),
            "failures": len(data.get("failures", [])),
            "receipt": data.get("receipt"),
        }
    )
