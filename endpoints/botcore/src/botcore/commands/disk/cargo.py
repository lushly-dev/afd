"""Where Cargo puts this machine's build output, and whether a disk-* rule reaches it.

Cargo's default is `target/` inside each workspace, so a worktree's Rust output goes with the
worktree: tier 1 strips it once the worktree is idle, and removing the worktree deletes it.
`CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`, `CARGO_BUILD_BUILD_DIR` or a `target-dir` or
`build-dir` in a Cargo config can move it. Output moved out of the worktrees outlives them, so
an `[[aged]]` folder in the machine settings has to clear it; `disk-setup` and `disk-status`
say when none does, and name an entry only for a folder that holds nothing but Cargo output.

Config files are found as Cargo finds them for a build in each registered worktree:
`.cargo/config` (or `.cargo/config.toml`; `config` wins when both exist) in the worktree and
every folder above it, then `$CARGO_HOME`'s, each with its `include` files. Values are taken
literally, as Cargo takes them (no `~` or variable expansion), and a config file's relative
path is relative to the folder holding its `.cargo`. A nested workspace's own `.cargo` below a
worktree's top folder is not read. Environment variables are read from the process running the
check: a shell, an agent's host or Factory may each see different ones.
"""

from __future__ import annotations

import json
import os
import shutil
import tomllib
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from botcore.commands.disk.caches import HASH_BUCKET, parse_aged_pattern, unsafe_aged_root
from botcore.commands.disk.git import GitError, list_worktrees, path_key
from botcore.commands.disk.scan import exists, is_dir, is_file, is_link
from botcore.commands.disk.settings import MachineSettings, expand, t3_worktree_roots
from botcore.commands.disk.steps import doing, each

SUGGESTED_AGE_DAYS = 2
SUGGESTED_MAX_GB = 150
MIN_SUGGESTED_MAX_GB = 40
KINDS = ("target-dir", "build-dir")
# Each overrides every config file's key of its kind; the first one set wins
ENVIRONMENT = {
    "target-dir": ("CARGO_TARGET_DIR", "CARGO_BUILD_TARGET_DIR"),
    "build-dir": ("CARGO_BUILD_BUILD_DIR",),
}
CONFIG_NAMES = ("config", "config.toml")
MAX_INCLUDE_DEPTH = 10
SYSTEM_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}  # left by file browsers
CARGO_MARKERS = ("CACHEDIR.TAG", ".cargo-lock", ".rustc_info.json")
_WORKSPACE = "{workspace-root}"
_PER_WORKSPACE = "{workspace-path-hash}"


def suggested_max_gb(root: Path) -> int:
    """Default size cap for a per-workspace Cargo build folder: 20% of its volume, clamped to
    `[MIN_SUGGESTED_MAX_GB, SUGGESTED_MAX_GB]`."""
    current = Path(os.path.abspath(root))
    while not exists(current) and current.parent != current:
        current = current.parent
    try:
        total_gb = shutil.disk_usage(current).total / 1024**3
    except OSError:
        return SUGGESTED_MAX_GB
    return int(round(min(SUGGESTED_MAX_GB, max(MIN_SUGGESTED_MAX_GB, total_gb * 0.20))))


@dataclass(frozen=True)
class Placement:
    """Where one setting puts Cargo output, for the worktrees it applies to."""

    kind: str  # "target-dir" (final binaries, and everything without a build-dir) or "build-dir"
    source: str  # the environment variable or config file that sets it
    value: str  # as written there
    state: str  # "inside" each worktree, "moved" to `root`, or "unknown" (relative to the build)
    root: str | None = None  # the folder outside every worktree that holds it
    per_workspace: bool = False  # one subfolder per workspace under root (a hash template)
    aged: str | None = None  # the [[aged]] entry that would clear it, when root is Cargo's alone
    covered_by: str | None = None  # the machine settings' [[aged]] path that clears it
    suggested_max_gb: int | None = None  # recommended max_gb cap for `aged`

    @property
    def problem(self) -> str | None:  # noqa: PLR0911 - one message per arrangement
        where = f"Cargo's {self.kind} ({self.source})"
        if self.state == "unknown":
            return (
                f"{where} is {self.value!r}, which lands outside the worktree relative to "
                "where Cargo runs, so no [[aged]] folder can name it: use an absolute folder "
                "of its own"
            )
        if self.state != "moved" or self.covered_by:
            return None
        if not self.per_workspace:
            own = Path(self.root or "").parent / "cargo-build"
            return (
                f"{where} puts every workspace's output in one folder, {self.root}: parallel "
                "worktrees wait on its lock, and nothing can tell which output a removed "
                f"worktree left. Unset it (Cargo then keeps {self.kind} in each worktree); "
                "to keep build output off the worktrees' disk, set build-dir to "
                f"{json.dumps(str(own / _PER_WORKSPACE))} and give "
                f"{json.dumps(str(own / '*'))} an [[aged]] entry. Or cap this folder with an "
                "[[aged]] entry that sets max_gb"
            )
        if self.aged is None:
            return (
                f"{where} puts build output under {self.root}, which also holds other "
                "things (or is a drive's top folder, the home folder or Cargo's own): point "
                "it at a folder of its own, then give that folder's `/*` an [[aged]] entry"
            )
        max_gb = self.suggested_max_gb if self.suggested_max_gb is not None else SUGGESTED_MAX_GB
        return (
            f"{where} puts build output under {self.root}, which no [[aged]] folder clears, "
            "so it outlives the worktrees. Add to the machine settings:\n"
            f"[[aged]]\npath = {json.dumps(self.aged)}\n"
            f"max_age_days = {SUGGESTED_AGE_DAYS}\nmax_gb = {max_gb}"
        )


def cargo_home() -> Path:
    value = os.environ.get("CARGO_HOME")
    return Path(value) if value else Path.home() / ".cargo"


def _inside(inner: str, outer: str) -> bool:
    return inner == outer or inner.startswith(outer.rstrip(os.sep) + os.sep)


# ── Config files ────────────────────────────────────────────────────────────


class _Configs:
    """Cargo config files, read once each, with their includes merged as Cargo merges them:
    included files first, in order, then the file's own keys."""

    def __init__(self) -> None:
        self.files: dict[str, dict[str, tuple[str, Path]]] = {}
        self.problems: list[str] = []

    def in_folder(self, cargo_dir: Path) -> Path | None:
        for name in CONFIG_NAMES:
            if is_file(cargo_dir / name):
                return cargo_dir / name
        return None

    def settings(self, path: Path, depth: int = 0) -> dict[str, tuple[str, Path]]:
        """{kind: (value, file that set it)} for one config file and its includes."""
        key = path_key(path)
        if key in self.files:
            return self.files[key]
        self.files[key] = {}  # a cycle reads as empty
        doing("reading", path)
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
            self.problems.append(f"Cargo's config {path} could not be read: {exc}")
            return {}
        merged: dict[str, tuple[str, Path]] = {}
        for include, optional in _includes(data.get("include")):
            target = path.parent / include
            if not include.endswith(".toml"):
                self.problems.append(
                    f"Cargo's config {path} includes {include}, which Cargo "
                    "refuses: an include must end in .toml"
                )
            elif depth >= MAX_INCLUDE_DEPTH:
                self.problems.append(f"Cargo's config {path} includes too deeply to follow")
            elif is_file(target):
                merged.update(self.settings(target, depth + 1))
            elif not optional:
                self.problems.append(f"Cargo's config {path} includes {target}, which is missing")
        build = data.get("build")
        for kind in KINDS:
            value = build.get(kind) if isinstance(build, dict) else None
            if isinstance(value, str) and value:
                merged[kind] = (value, path)
        self.files[key] = merged
        return merged


def _includes(value: object) -> list[tuple[str, bool]]:
    items = value if isinstance(value, list) else [value] if value is not None else []
    found = []
    for item in items:
        if isinstance(item, str):
            found.append((item, False))
        elif isinstance(item, dict) and isinstance(item.get("path"), str):
            found.append((item["path"], bool(item.get("optional", False))))
    return found


def _chain(place: Path, configs: _Configs) -> list[Path]:
    """The config files a build in `place` reads, nearest first, $CARGO_HOME's last."""
    files: list[Path] = []
    seen: set[str] = set()
    for folder in [place, *place.parents]:
        found = configs.in_folder(folder / ".cargo")
        if found and path_key(found) not in seen:
            seen.add(path_key(found))
            files.append(found)
    home = configs.in_folder(cargo_home())
    if home and path_key(home) not in seen:
        files.append(home)
    return files


# ── Where a setting puts output ─────────────────────────────────────────────


def _place(kind: str, source: str, value: str, base: Path | None, place: Path) -> Placement:
    """Resolve one setting for a build in `place`. `base` resolves a config file's relative
    value; None means an environment variable's, relative to wherever Cargo runs in `place`."""
    text = value
    templated = kind == "build-dir"  # only build-dir takes templates
    if templated:
        text = text.replace("{cargo-cache-home}", str(cargo_home()))
    # Relative to the workspace, or (an environment variable's) to wherever Cargo runs
    relative_to_build = (templated and _WORKSPACE in text) or (
        base is None and not Path(text).is_absolute()
    )
    if templated:
        text = text.replace(_WORKSPACE, str(place))
    per_workspace = templated and _PER_WORKSPACE in text
    prefix = text.split(_PER_WORKSPACE, 1)[0] if per_workspace else text
    path = Path(prefix)
    if not path.is_absolute():
        path = (base or place) / path
    resolved = os.path.normpath(str(path))
    if _inside(path_key(resolved), path_key(place)):
        return Placement(kind, source, value, "inside")
    if relative_to_build:
        return Placement(kind, source, value, "unknown")
    if per_workspace and not prefix.endswith(("/", "\\")):
        # a name prefix: [[aged]] names folders
        root, aged, cap = os.path.dirname(resolved), None, None
    else:
        root = resolved
        aged = str(Path(root) / "*") if per_workspace and _cargo_only(Path(root)) else None
        cap = suggested_max_gb(Path(root)) if aged is not None else None
    return Placement(kind, source, value, "moved", root, per_workspace, aged, None, cap)


def _looks_like_cargo_dir(folder: Path) -> bool:
    """Whether `folder` holds recognizable Cargo target/build-dir artifacts and not a project
    checkout or unrelated user files."""
    if os.path.lexists(folder / ".git"):
        return False
    try:
        children = list(each("reading", folder, os.scandir(folder)))
    except OSError:
        return False
    allowed_top_files = SYSTEM_FILES | set(CARGO_MARKERS)
    has_marker = False
    subdirs: list[Path] = []
    for child in children:
        if is_link(child):
            return False
        if not child.is_dir(follow_symlinks=False):
            if child.name not in allowed_top_files:
                return False
            if child.name in CARGO_MARKERS:
                has_marker = True
        else:
            subdirs.append(Path(child.path))
    if has_marker:
        return True
    cargo_sub_markers = (".cargo-lock", ".rustc_info.json")
    for sub in subdirs:
        if sub.name == "target":
            continue  # a Rust project's `target/` directory, not a build-dir itself
        if is_dir(sub / ".fingerprint") or any(is_file(sub / name) for name in cargo_sub_markers):
            return True
        try:
            grandchildren = list(each("reading", sub, os.scandir(sub)))
        except OSError:
            continue
        for grandchild in grandchildren:
            if is_link(grandchild) or not grandchild.is_dir(follow_symlinks=False):
                continue
            if is_dir(Path(grandchild.path) / ".fingerprint"):
                return True
    return False


def _cargo_only(root: Path) -> bool:
    """Whether an [[aged]] entry for root's children would clear nothing but Cargo output."""
    if unsafe_aged_root(root) or os.path.ismount(root):
        return False
    home = path_key(cargo_home())
    if _inside(home, path_key(root)):  # Cargo's own folder or one holding it
        return False
    if not is_dir(root):
        return True  # nothing there yet: the setting was just made
    doing("reading", root)
    try:
        children = list(each("reading", root, os.scandir(root)))
    except OSError:
        return False
    allowed_files = SYSTEM_FILES | {"CACHEDIR.TAG"}
    for child in children:
        if (
            child.name in allowed_files
            and not is_link(child)
            and not child.is_dir(follow_symlinks=False)
        ):
            continue
        if is_link(child) or not child.is_dir(follow_symlinks=False):
            return False
        if not (HASH_BUCKET.match(child.name) or _looks_like_cargo_dir(Path(child.path))):
            return False
    return True


def _covered_by(
    found: Placement,
    settings: MachineSettings,
    protected: list[Path],
) -> str | None:
    """The [[aged]] path that clears this output, if any. A folder shared by every workspace is
    always in use, so only a size cap (max_gb) clears it; per-workspace folders need an entry
    for root's own children that sets an age or a size."""
    root = path_key(found.root or "")
    for aged in settings.aged:
        if aged.max_age_days is None and aged.max_gb is None:
            continue  # it never makes anything eligible
        base, depth, raw = parse_aged_pattern(aged.path)
        if not raw.strip() or not base.is_absolute() or unsafe_aged_root(base, protected):
            continue  # the planner refuses it
        key = path_key(base)
        if found.per_workspace and depth in (1, 2) and key == root:
            return aged.path
        if aged.max_gb is not None and (
            key == root or (depth == 1 and key == path_key(os.path.dirname(found.root or "")))
        ):
            return aged.path
    return None


# ── The check ───────────────────────────────────────────────────────────────


def _places(settings: MachineSettings) -> tuple[list[Path], list[Path]]:
    """Every registered checkout (or the working directory when none is registered), and the
    folders the [[aged]] planner refuses to clear: checkouts, git folders, T3 Code's roots."""
    places: list[Path] = []
    protected: list[Path] = list(t3_worktree_roots(settings)[0])
    for repo in settings.repos:
        try:
            common, worktrees = list_worktrees(expand(repo))
        except GitError:
            places.append(expand(repo))
            continue
        places += [w.path for w in worktrees]
        protected.append(common)
    places = places or [Path.cwd()]
    return places, protected + places


def cargo_outputs(
    settings: MachineSettings,
    places: list[Path] | None = None,
) -> tuple[list[Placement], list[str]]:
    """Each distinct place Cargo output goes for the registered worktrees, and the problems
    reading Cargo's config."""
    configs = _Configs()
    found: dict[tuple[str, str, str, str, str | None], Placement] = {}
    if places is None:
        places, protected = _places(settings)
    else:
        protected = list(places)
    for place in places:
        chain = _chain(place, configs)
        for kind in KINDS:
            setting = _setting(kind, chain, configs)
            if setting is None:
                continue
            source, value, base = setting
            placed = _place(kind, source, value, base, place)
            if placed.state == "inside":
                continue
            placed = Placement(
                **{**asdict(placed), "covered_by": _covered_by(placed, settings, protected)}
            )
            found.setdefault((kind, source, value, placed.state, placed.root), placed)
    return list(found.values()), list(dict.fromkeys(configs.problems))


def _setting(
    kind: str,
    chain: list[Path],
    configs: _Configs,
) -> tuple[str, str, Path | None] | None:
    """(source, value, base for a relative value) of the setting that wins for one build."""
    for name in ENVIRONMENT[kind]:
        if os.environ.get(name):
            return name, os.environ[name], None
    for path in chain:
        merged = configs.settings(path)
        if kind in merged:
            value, defined = merged[kind]
            return str(defined), value, defined.parent.parent
    return None


def cargo_check(settings: MachineSettings, places: list[Path] | None = None) -> dict[str, Any]:
    """The Cargo arrangement as plain data for disk-setup and disk-status."""
    outputs, problems = cargo_outputs(settings, places)
    return {
        "arrangement": "moved out of the worktrees" if outputs else "inside each worktree",
        "settings": [asdict(o) for o in outputs],
        "problems": [o.problem for o in outputs if o.problem] + problems,
    }


def cargo_roots(settings: MachineSettings) -> list[Path]:
    """Folders outside the worktrees that hold Cargo output: their volumes are watched too."""
    return [Path(o.root) for o in cargo_outputs(settings)[0] if o.root]
