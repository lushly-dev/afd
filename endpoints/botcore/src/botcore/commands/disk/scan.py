"""Filesystem reads for the disk-* commands: volumes, processes, activity, patterns, sizes.

Nothing here deletes anything. Sizes are allocated blocks, links are never followed, and every
walk stops at a time budget rather than running for minutes on a large tree.
"""

from __future__ import annotations

import os
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from botcore.config import DiskRegenerable

DAY = 86400.0
# Folders a pattern search never enters: their contents belong to a package manager or git,
# and a pattern such as "**/dist" must not match a package's own dist inside node_modules.
NEVER_ENTER = {".git", "node_modules", ".venv", "venv", "__pycache__"}
# How deep a `**` pattern is searched. afd's main checkout passes 12 inside CMake-fetched sources.
MAX_DEPTH = 32


def long_path(path: Path | str) -> str:
    """Windows long-path syntax for an absolute path, so a deep folder is still readable when
    the system's 260-character limit is on. Other platforms: unchanged."""
    text = str(path)
    if os.name != "nt" or text.replace("/", "\\").startswith(("\\\\?\\", "\\\\.\\")):
        return text
    absolute = os.path.abspath(text)
    if absolute.startswith("\\\\"):
        return "\\\\?\\UNC\\" + absolute[2:]
    return "\\\\?\\" + absolute


# ── Volumes ─────────────────────────────────────────────────────────────────


def exists(path: Path) -> bool:
    """Path.exists() that answers False instead of raising on a permission error.

    Only for deciding what to look at: a check whose answer protects something reads the file
    itself and treats an unreadable answer as "yes".
    """
    try:
        os.stat(path)
    except (OSError, ValueError):
        return False
    return True


def is_dir(path: Path) -> bool:
    try:
        return stat.S_ISDIR(os.stat(path).st_mode)
    except (OSError, ValueError):
        return False


def is_file(path: Path) -> bool:
    try:
        return stat.S_ISREG(os.stat(path).st_mode)
    except (OSError, ValueError):
        return False


def mount_point(path: Path) -> Path:
    """The mount point holding path, or path's nearest existing ancestor's."""
    current = Path(os.path.abspath(path))
    while not exists(current) and current.parent != current:
        current = current.parent
    while not os.path.ismount(current) and current.parent != current:
        current = current.parent
    return current


def _darwin_volume_id(mount: Path) -> str | None:
    try:
        done = subprocess.run(
            ["diskutil", "info", "-plist", str(mount)],
            capture_output=True, timeout=30, check=False,
        )
        if done.returncode != 0:
            return None
        info = plistlib.loads(done.stdout)
    except (OSError, subprocess.TimeoutExpired, plistlib.InvalidFileException):
        return None
    value = info.get("VolumeUUID")
    return str(value) if value else None


def _linux_volume_id(mount: Path) -> str | None:
    try:
        done = subprocess.run(
            ["findmnt", "-n", "-o", "UUID", "--mountpoint", str(mount)],
            capture_output=True, text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    value = done.stdout.strip()
    return value or None


def _windows_volume_id(mount: Path) -> str | None:
    import ctypes

    buffer = ctypes.create_unicode_buffer(64)
    root = str(mount)
    if not root.endswith("\\"):
        root += "\\"
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    if not kernel32.GetVolumeNameForVolumeMountPointW(root, buffer, len(buffer)):
        return None
    return buffer.value or None


def volume_id(mount: Path) -> str | None:
    """A stable identifier for the volume mounted at mount, or None when unknown."""
    if not os.path.ismount(mount):
        return None
    if sys.platform == "darwin":
        return _darwin_volume_id(mount)
    if sys.platform == "win32":
        return _windows_volume_id(mount)
    return _linux_volume_id(mount)


@dataclass
class VolumeState:
    """Free space and identity of one volume."""

    mount: str
    mounted: bool
    id_expected: str | None
    id_found: str | None
    free_bytes: int | None
    total_bytes: int | None
    low_space_gb: float | None
    error: str | None = None

    @property
    def verified(self) -> bool:
        """Mounted, and the identifier matches when one was recorded."""
        if not self.mounted:
            return False
        return self.id_expected is None or self.id_expected == self.id_found

    @property
    def low(self) -> bool:
        if self.free_bytes is None or self.low_space_gb is None:
            return False
        return self.free_bytes < self.low_space_gb * 1024**3

    def as_dict(self) -> dict:
        return {
            "mount": self.mount,
            "mounted": self.mounted,
            "verified": self.verified,
            "id_expected": self.id_expected,
            "id_found": self.id_found,
            "free_gb": _gb(self.free_bytes),
            "total_gb": _gb(self.total_bytes),
            "low_space_gb": self.low_space_gb,
            "below_threshold": self.low,
            "error": self.error,
        }


def volume_state(mount: Path, expected_id: str | None, low_space_gb: float | None) -> VolumeState:
    """Free space and identity. A drive letter on Windows counts as mounted only if readable."""
    mounted = os.path.ismount(mount)
    free = total = None
    found = None
    problem = None
    if mounted:
        try:
            usage = shutil.disk_usage(mount)
            free, total = usage.free, usage.total
        except PermissionError:
            problem = "no permission to read the volume"
            mounted = False
        except OSError as exc:
            problem = f"not readable: {exc.strerror or exc}"
            mounted = False
    if mounted and expected_id is not None:
        found = volume_id(mount)
    state = VolumeState(str(mount), mounted, expected_id, found, free, total, low_space_gb, problem)
    return state


def _gb(value: int | None) -> float | None:
    return None if value is None else round(value / 1024**3, 2)


# ── Processes ───────────────────────────────────────────────────────────────


@dataclass
class Processes:
    """Working directories and command lines of running processes.

    `ok` is False when listing them failed: nothing may then be called unused.
    """

    cwds: list[str] = field(default_factory=list)
    cmdlines: list[str] = field(default_factory=list)
    method: str = "none"
    sees_cwds: bool = False
    ok: bool = True


def _run_lines(args: list[str], timeout: float = 60, ok_codes: tuple[int, ...] = (0,)):
    """A command's output lines, or None when it could not run or failed."""
    try:
        done = subprocess.run(
            args, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode not in ok_codes:
        return None
    return done.stdout.splitlines()


def _darwin_processes() -> Processes:
    # lsof exits 1 when some processes cannot be inspected; its output is still complete for ours
    lines = _run_lines(["lsof", "-a", "-d", "cwd", "-Fn", "-w"], ok_codes=(0, 1))
    cmds = _run_lines(["ps", "-axww", "-o", "command="])
    if cmds is None or lines is None or not lines:
        return Processes(cmdlines=cmds or [], method="lsof+ps", ok=False)
    cwds = [line[1:] for line in lines if line.startswith("n")]
    return Processes(cwds, cmds, "lsof+ps", True)


def _linux_processes() -> Processes:
    cwds: list[str] = []
    cmds: list[str] = []
    if not Path("/proc/self/cwd").exists():
        return Processes(method="proc", ok=False)
    for entry in Path("/proc").glob("[0-9]*"):
        try:
            cwds.append(os.readlink(entry / "cwd"))
        except OSError:
            pass
        try:
            raw = (entry / "cmdline").read_bytes()
            cmds.append(raw.replace(b"\0", b" ").decode(errors="replace"))
        except OSError:
            pass
    return Processes(cwds, cmds, "proc", True)


def _windows_processes() -> Processes:
    script = (
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
        "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"
    )
    cmds = _run_lines(["powershell", "-NoProfile", "-NonInteractive", "-Command", script])
    # Windows does not expose another process's working directory without native calls;
    # a folder in use as one cannot be deleted there, which a strip reports as partial.
    if not cmds:
        return Processes(method="command-lines", ok=False)
    return Processes(cmdlines=[c for c in cmds if c.strip()], method="command-lines")


def running_processes() -> Processes:
    if sys.platform == "darwin":
        return _darwin_processes()
    if sys.platform == "win32":
        return _windows_processes()
    return _linux_processes()


def busy_reason(worktree: Path, processes: Processes, windows: bool | None = None) -> str | None:
    """Why a process is or may be using worktree, or None.

    On Windows, paths compare case-insensitively and with either slash, since tools write
    both `D:\\work\\repo` and `D:/work/repo`.
    """
    if not processes.ok:
        return "running processes could not be listed"
    win = os.name == "nt" if windows is None else windows

    def norm(text: str) -> str:
        return text.replace("/", "\\").lower() if win else text

    sep = "\\" if win else "/"
    root = norm(os.path.normpath(str(worktree)) if not win else str(worktree)).rstrip(sep)
    for cwd in processes.cwds:
        candidate = norm(cwd).rstrip(sep)
        if candidate == root or candidate.startswith(root + sep):
            return "a process's working directory is inside it"
    pattern = re.compile(re.escape(root) + r"(?=$|[/\\\s\"'])")
    for line in processes.cmdlines:
        if pattern.search(norm(line)):
            return "a running process names it on its command line"
    return None


# ── Activity ────────────────────────────────────────────────────────────────


def _mtime(path: Path) -> float | None:
    try:
        return path.lstat().st_mtime
    except OSError:
        return None


def last_activity(
    worktree: Path, admin: Path | None, changed: list[str], build_dirs: list[Path],
) -> float | None:
    """The newest of git's records for the worktree, changed files and build-output folders."""
    times: list[float] = []
    if admin is not None:
        for name in ("HEAD", "index", "logs/HEAD", "ORIG_HEAD", "FETCH_HEAD"):
            value = _mtime(admin / name)
            if value is not None:
                times.append(value)
    for rel in changed:
        value = _mtime(worktree / rel)
        if value is not None:
            times.append(value)
    for folder in build_dirs:
        value = _mtime(folder)
        if value is not None:
            times.append(value)
    return max(times) if times else None


# ── Patterns ────────────────────────────────────────────────────────────────


def compile_pattern(pattern: str) -> re.Pattern[str]:
    """A [disk] glob as a regex over forward-slash relative paths: `**` spans folders."""
    out = ""
    parts = pattern.strip("/").split("/")
    for index, part in enumerate(parts):
        last = index == len(parts) - 1
        if part == "**":
            out += ".*" if last else "(?:.*/)?"
            continue
        piece = ""
        for char in part:
            if char == "*":
                piece += "[^/]*"
            elif char == "?":
                piece += "[^/]"
            else:
                piece += re.escape(char)
        out += piece if last else piece + "/"
    return re.compile(f"^{out}$", re.IGNORECASE if os.name == "nt" else 0)


@dataclass
class Candidate:
    """A path inside a worktree that a [disk] pattern names."""

    rel: str
    pattern: DiskRegenerable
    kind: str  # "dir", "file" or "link"


def is_link(entry: os.DirEntry[str]) -> bool:
    """A symlink, or on Windows any reparse point (junctions included)."""
    if entry.is_symlink():
        return True
    if os.name == "nt":
        try:
            attributes = entry.stat(follow_symlinks=False).st_file_attributes  # type: ignore[attr-defined]
        except OSError:
            return True
        return bool(attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)  # type: ignore[attr-defined]
    return False


def _match(rel: str, compiled: list[tuple[re.Pattern[str], DiskRegenerable]]):
    for regex, entry in compiled:
        if regex.match(rel):
            return entry
    return None


def _holds_checkout(folder: str) -> bool:
    return os.path.lexists(os.path.join(folder, ".git"))


def find_candidates(
    worktree: Path, entries: list[DiskRegenerable], deadline: float,
) -> tuple[list[Candidate], bool]:
    """Paths under worktree that entries name: (candidates, whether the walk saw everything).

    Never enters package folders, links or a folder holding another checkout (a nested
    worktree such as `.claude/worktrees/x` is its own worktree, with its own age and lock). A
    folder that could not be read, or a depth cutoff, makes the walk incomplete, and an
    incomplete walk must not make anything ready: a recent build may be in what was missed.
    """
    if not entries:
        return [], True
    compiled = [(compile_pattern(e.path), e) for e in entries]
    recursive = any("**" in e.path for e in entries)
    # Without `**`, nothing deeper than the longest pattern can match: stopping there is complete
    limit = MAX_DEPTH if recursive else max(len(e.path.strip("/").split("/")) for e in entries)
    found: list[Candidate] = []
    complete = True
    stack: list[tuple[Path, str, int]] = [(Path(long_path(worktree)), "", 0)]
    while stack:
        if time.monotonic() > deadline:
            return found, False
        folder, prefix, depth = stack.pop()
        try:
            children = list(os.scandir(folder))
        except OSError:
            complete = False
            continue
        for child in children:
            rel = f"{prefix}{child.name}"
            link = is_link(child)
            folder_like = not link and child.is_dir(follow_symlinks=False)
            nested = folder_like and _holds_checkout(child.path)
            entry = _match(rel, compiled)
            if entry is not None:
                if link:
                    kind = "link"
                elif nested:
                    kind = "checkout"
                else:
                    kind = "dir" if folder_like else "file"
                found.append(Candidate(rel, entry, kind))
                continue
            if not folder_like or nested or child.name in NEVER_ENTER:
                continue
            if depth + 1 >= limit:
                complete = complete and not recursive
                continue
            stack.append((Path(child.path), rel + "/", depth + 1))
    return found, complete


# ── Sizes ───────────────────────────────────────────────────────────────────


def allocated(path: Path, deadline: float) -> int | None:
    """Allocated bytes under path, links not followed, hard links counted once.

    None when the deadline passes first. Copy-on-write clones still count in full: their
    sharing is invisible to stat, which is why reclaimed space is measured from free space.
    """
    total = 0
    seen: set[tuple[int, int]] = set()
    stack = [Path(long_path(path))]
    while stack:
        if time.monotonic() > deadline:
            return None
        current = stack.pop()
        try:
            info = current.lstat()
        except OSError:
            continue
        if stat.S_ISLNK(info.st_mode):
            continue
        if stat.S_ISDIR(info.st_mode):
            if os.name == "nt" and getattr(info, "st_file_attributes", 0) & 0x400:
                continue  # a junction
            try:
                stack.extend(Path(e.path) for e in os.scandir(current))
            except OSError:
                pass
            continue
        if info.st_nlink > 1:
            key = (info.st_dev, info.st_ino)
            if key in seen:
                continue
            seen.add(key)
        blocks = getattr(info, "st_blocks", None)
        total += blocks * 512 if blocks is not None else info.st_size
    return total


def newest_mtime(path: Path) -> float | None:
    """The newest modification time of path and its immediate children."""
    times = []
    value = _mtime(path)
    if value is not None:
        times.append(value)
    try:
        for child in os.scandir(path):
            try:
                times.append(child.stat(follow_symlinks=False).st_mtime)
            except OSError:
                pass
    except OSError:
        pass
    return max(times) if times else None
