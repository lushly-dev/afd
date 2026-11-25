"""Settings for the disk-* commands: the machine's own file, and each repository's [disk].

The machine file is the owner's: it names the repositories, volumes and cache folders the
commands may touch. A repository's `[disk]` section only names paths inside its own worktrees,
and is read from its landing ref, never from a branch checked out in a worktree, so a branch
under review cannot change what a scheduled run deletes.
"""

from __future__ import annotations

import json
import os
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.steps import doing
from botcore.config import DiskConfig

SETTINGS_ENV = "BOTCORE_DISK_SETTINGS"
STATE_ENV = "BOTCORE_DISK_STATE"
T3_SETTINGS_ENV = "BOTCORE_DISK_T3_SETTINGS"


class VolumeSettings(BaseModel):
    """A volume the commands watch; `id` is recorded by setup and checked on every run."""

    model_config = ConfigDict(extra="forbid")

    mount: str
    id: str | None = None
    low_space_gb: float = Field(default=30, ge=0)


class AgedFolder(BaseModel):
    """A cache folder outside any worktree. A path ending in `/*` makes each child one entry."""

    model_config = ConfigDict(extra="forbid")

    path: str
    max_age_days: float | None = Field(default=None, ge=0)
    max_gb: float | None = Field(default=None, ge=0)


class MachineSettings(BaseModel):
    """The per-user settings file (disk.toml)."""

    model_config = ConfigDict(extra="forbid")

    repos: list[str] = []
    strip_after_days: float = Field(default=3, ge=0)
    remove_landed_after_days: float = Field(default=7, ge=0)
    # Whether the scheduled job removes finished worktrees (tier 2): `disk-setup --remove-landed`
    remove_landed: bool = False
    # disk-report warns when a repository has more worktrees than this idle for
    # strip_after_days or longer; 0 turns the warning off
    idle_worktree_limit: int = Field(default=20, ge=0)
    caches: list[str] = ["pnpm", "uv"]
    # Extra folders searched for worktrees no registered repository knows (orphans)
    worktree_roots: list[str] = []
    # T3 Code's settings.json; None = the default location, "" = don't read it
    t3_settings: str | None = None
    # Absolute paths of the tools the scheduled job runs (git, pnpm, uv, gh, node), recorded
    # by setup because a scheduler does not start jobs with the user's shell PATH
    tools: dict[str, str] = {}
    # Skill usage (the skill-usage commands): whether the scheduled job collects it; this
    # machine's name in the record, its hostname when left out; and a folder every machine
    # can see, where each also writes its record so that a report reads them all. The name
    # and the folder are checked where they are used: a wrong one stops the collection, and
    # never the disk work
    skill_usage_collect: bool = True
    skill_usage_machine: str | None = None
    skill_usage_shared: str | None = None
    # Machines the triggers report read here does not wait for before it calls a change a
    # miss: ones the owner knows are switched off. It waits for every other machine
    skill_usage_away: list[str] = []
    # Additional skill folders outside any project (e.g. plugin skill folders) to include in
    # skill-usage sizes and the quiet list alongside personal skill folders
    skill_usage_dirs: list[str] = []
    volume: list[VolumeSettings] = []
    aged: list[AgedFolder] = []


class SettingsError(Exception):
    """The machine settings file exists but cannot be read or validated."""


def _base(env: str, windows_default: Path, posix_default: Path) -> Path:
    value = os.environ.get(env)
    if value:
        return Path(value)
    return windows_default if sys.platform == "win32" else posix_default


def settings_path() -> Path:
    """Where the machine settings live; BOTCORE_DISK_SETTINGS overrides it."""
    override = os.environ.get(SETTINGS_ENV)
    if override:
        return Path(override)
    home = Path.home()
    if sys.platform == "win32":
        base = _base("APPDATA", home / "AppData" / "Roaming", home)
    else:
        base = _base("XDG_CONFIG_HOME", home, home / ".config")
    return base / "botcore" / "disk.toml"


def state_path() -> Path:
    """Where receipts and the status file live; BOTCORE_DISK_STATE overrides it."""
    override = os.environ.get(STATE_ENV)
    if override:
        return Path(override)
    home = Path.home()
    if sys.platform == "win32":
        base = _base("LOCALAPPDATA", home / "AppData" / "Local", home)
    else:
        base = _base("XDG_STATE_HOME", home, home / ".local" / "state")
    return base / "botcore" / "disk"


def expand(path: str) -> Path:
    """Expand `~` and environment variables in a settings path."""
    return Path(os.path.expandvars(os.path.expanduser(path)))


def load_machine_settings() -> tuple[MachineSettings, Path, bool]:
    """Read the machine settings: (settings, path, whether the file exists)."""
    path = settings_path()
    if not path.exists():
        return MachineSettings(), path, False
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        raise SettingsError(f"{path}: {exc}") from exc
    try:
        return MachineSettings(**raw), path, True
    except ValidationError as exc:
        raise SettingsError(f"{path}: {exc}") from exc


@dataclass
class RepoDiskConfig:
    """A repository's [disk] section as read from a ref of its main checkout."""

    config: DiskConfig | None
    ref: str | None
    source: str | None
    error: str | None = None


# A landing branch, never the main checkout's HEAD, which may be a feature branch
_CONFIG_REFS = (
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
    "refs/heads/main",
    "refs/heads/master",
)


def _show(main: Path, ref: str, name: str) -> str | None:
    try:
        return git_out(main, "show", f"{ref}:{name}")
    except GitError:
        return None


def _section(main: Path, ref: str) -> tuple[dict[str, Any] | None, str | None]:
    """The botcore table at ref, with botcore's precedence: pyproject's [tool.botcore] wins."""
    text = _show(main, ref, "pyproject.toml")
    if text is not None:
        try:
            table = tomllib.loads(text).get("tool", {}).get("botcore")
        except tomllib.TOMLDecodeError:
            table = None
        if table is not None:
            return dict(table), "pyproject.toml"
    text = _show(main, ref, "botcore.toml")
    if text is None:
        return None, None
    try:
        return tomllib.loads(text), "botcore.toml"
    except tomllib.TOMLDecodeError as exc:
        raise ValueError(f"botcore.toml at {ref} does not parse: {exc}") from exc


def read_repo_disk_config(main: Path) -> RepoDiskConfig:
    """Read [disk] from the first landing ref that exists: origin's HEAD, origin/main, main."""
    for ref in _CONFIG_REFS:
        try:
            git_out(main, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")
        except GitError:
            continue
        try:
            table, source = _section(main, ref)
        except ValueError as exc:
            return RepoDiskConfig(None, ref, "botcore.toml", str(exc))
        if table is None:
            return RepoDiskConfig(DiskConfig(), ref, None)
        try:
            config = DiskConfig.model_validate(table.get("disk", {}))
        except ValidationError as exc:
            first = exc.errors()[0]
            where = ".".join(str(part) for part in first.get("loc", ())) or "[disk]"
            message = f"[disk] at {ref} is not valid for this botcore: {where}: {first['msg']}"
            return RepoDiskConfig(None, ref, source, message)
        return RepoDiskConfig(config, ref, source)
    return RepoDiskConfig(
        None,
        None,
        None,
        "no landing branch (origin's HEAD, origin/main or main) to read [disk] from",
    )


def t3_settings_file(settings: MachineSettings) -> Path | None:
    """T3 Code's settings.json, or None when disabled or absent."""
    if settings.t3_settings == "":
        return None
    override = os.environ.get(T3_SETTINGS_ENV)
    if override is not None:
        return Path(override) if override else None
    if settings.t3_settings:
        return expand(settings.t3_settings)
    return Path.home() / ".t3" / "userdata" / "settings.json"


def t3_worktree_roots(settings: MachineSettings) -> tuple[list[Path], bool]:
    """T3 Code's managed worktree folders, and whether its settings could be read.

    Mirrors T3 Code's own resolution: its default folder always counts, `~` expands, and
    relative and filesystem-root values are ignored. T3 Code's storage cleanup removes the
    worktrees under these folders. Paths are resolved through links.
    """
    path = t3_settings_file(settings)
    if path is None:
        return [], True
    home = Path.home()
    values = [str(home / ".t3" / "worktrees")]
    read_ok = True
    doing("reading", path)
    try:
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, ValueError):
        data, read_ok = {}, False
    if not isinstance(data, dict):
        data, read_ok = {}, False
    values.append(data.get("worktreesDirectory") or "")
    values += [v for v in data.get("previousWorktreesDirectories") or [] if isinstance(v, str)]
    roots: list[Path] = []
    for value in values:
        if not value:
            continue
        expanded = Path(os.path.expanduser(value))
        if not expanded.is_absolute() or expanded.parent == expanded:
            continue
        doing("resolving", expanded)
        resolved = Path(os.path.realpath(expanded))
        if resolved.parent != resolved and resolved not in roots:
            roots.append(resolved)
    return roots, read_ok
