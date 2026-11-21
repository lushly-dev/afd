"""Where Cargo puts this machine's build output, and whether a disk-* rule reaches it.

Cargo's default is `target/` inside each workspace, so a worktree's Rust output goes with the
worktree: tier 1 strips it once the worktree is idle, and removing the worktree deletes it. A
machine may move it with `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`, `CARGO_BUILD_BUILD_DIR`
or `[build] target-dir` / `build-dir` in Cargo's own config. Output moved out of the worktrees
outlives them, so an `[[aged]]` folder in the machine settings has to cover it; `disk-setup` and
`disk-status` say when none does. Only the user's own Cargo config is read: a repository's
`.cargo/config.toml` is the repository's business and points inside it.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import asdict, dataclass
from pathlib import Path

from botcore.commands.disk.git import path_key
from botcore.commands.disk.settings import MachineSettings, expand

SUGGESTED_AGE_DAYS = 7
# Environment variables first: each overrides the config file's key of the same kind
SOURCES = {
    "target-dir": ("CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR"),
    "build-dir": ("CARGO_BUILD_BUILD_DIR",),
}


@dataclass
class CargoOutput:
    """Where one kind of Cargo output goes when a setting moves it."""

    kind: str  # "target-dir" (final binaries, and everything without a build-dir) or "build-dir"
    source: str  # the environment variable or config file that sets it
    value: str  # as written there
    root: str | None  # the folder outside every worktree that holds it; None: inside each
    aged: str | None  # the [[aged]] path that would cover it
    covered_by: str | None  # the machine settings' [[aged]] path that already covers it

    @property
    def problem(self) -> str | None:
        if self.root is None or self.covered_by:
            return None
        add = (f'add [[aged]] path = "{self.aged}" max_age_days = {SUGGESTED_AGE_DAYS} to the '
               "machine settings" if self.aged else
               "give it a folder of its own and cover that with an [[aged]] entry")
        return (f"Cargo's {self.kind} ({self.source}) puts build output in {self.root}, which "
                f"no [[aged]] folder covers, so nothing removes it when a worktree goes: {add}")


def cargo_home() -> Path:
    value = os.environ.get("CARGO_HOME")
    return Path(value) if value else Path.home() / ".cargo"


def _user_config() -> tuple[dict, Path | None, str | None]:
    """Cargo's user config: (its [build] table, its path, why it could not be read)."""
    for name in ("config.toml", "config"):
        path = cargo_home() / name
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            continue
        except OSError as exc:
            return {}, path, f"{path} could not be read: {exc.strerror or exc}"
        try:
            build = tomllib.loads(text).get("build", {})
        except tomllib.TOMLDecodeError as exc:
            return {}, path, f"{path} is not valid TOML: {exc}"
        return (build if isinstance(build, dict) else {}), path, None
    return {}, None, None


def _locate(value: str, base: Path | None) -> tuple[str | None, str | None]:
    """(root, aged path) for a setting's value. `base` resolves a relative value (a config
    file's: relative to the folder holding `.cargo`); None means relative to wherever Cargo
    runs, which is inside each worktree."""
    text = value.replace("{cargo-cache-home}", str(cargo_home()))
    if "{workspace-root}" in text:
        return None, None
    prefix, templated, _rest = text.partition("{")
    path = Path(os.path.expandvars(os.path.expanduser(prefix)))
    if not path.is_absolute():
        if base is None:
            return None, None
        path = base / path
    if not templated:
        return str(path), str(path)
    if prefix.endswith(("/", "\\")):  # one folder per workspace, under this one
        return str(path), str(path / "*")
    return str(path.parent), None  # a name prefix: [[aged]] cannot name only those entries


def _covered_by(root: str, settings: MachineSettings) -> str | None:
    key = path_key(root)
    for aged in settings.aged:
        text = aged.path.rstrip()
        base = path_key(expand(text[:-2] if text.endswith(("/*", "\\*")) else text))
        if key == base or key.startswith(base.rstrip(os.sep) + os.sep):
            return aged.path
    return None


def cargo_outputs(settings: MachineSettings) -> tuple[list[CargoOutput], str | None]:
    """Each Cargo setting that moves build output, and a problem reading Cargo's config."""
    build, config_path, problem = _user_config()
    found = []
    for kind, names in SOURCES.items():
        source = value = None
        base: Path | None = None
        for name in names:
            if os.environ.get(name):
                source, value = name, os.environ[name]
                break
        else:
            if isinstance(build.get(kind), str) and build[kind] and config_path:
                source, value = str(config_path), build[kind]
                base = config_path.parent.parent
        if value is None or source is None:
            continue
        root, aged = _locate(value, base)
        found.append(CargoOutput(kind, source, value, root, aged,
                                 _covered_by(root, settings) if root else None))
    return found, problem


def cargo_check(settings: MachineSettings) -> dict:
    """The Cargo arrangement as plain data for disk-setup and disk-status."""
    outputs, problem = cargo_outputs(settings)
    problems = [o.problem for o in outputs if o.problem]
    if problem:
        problems.append(problem)
    moved = [o for o in outputs if o.root]
    return {
        "arrangement": "moved out of the worktrees" if moved else "inside each worktree",
        "settings": [asdict(o) for o in outputs],
        "problems": problems,
    }


def cargo_roots(settings: MachineSettings) -> list[Path]:
    """Folders outside the worktrees that hold Cargo output: their volumes are watched too."""
    return [Path(o.root) for o in cargo_outputs(settings)[0] if o.root]
