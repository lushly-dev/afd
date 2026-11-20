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
MAX_DEPTH = 12


# ── Volumes ─────────────────────────────────────────────────────────────────


def mount_point(path: Path) -> Path:
    """The mount point holding path, or path's nearest existing ancestor's."""
    current = Path(os.path.abspath(path))
    while not current.exists() and current.parent != current:
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
        }


def volume_state(mount: Path, expected_id: str | None, low_space_gb: float | None) -> VolumeState:
    mounted = os.path.ismount(mount)
    free = total = None
    found = None
    if mounted:
        usage = shutil.disk_usage(mount)
        free, total = usage.free, usage.total
        found = volume_id(mount) if expected_id is not None else None
    return VolumeState(str(mount), mounted, expected_id, found, free, total, low_space_gb)


def _gb(value: int | None) -> float | None:
    return None if value is None else round(value / 1024**3, 2)


# ── Processes ───────────────────────────────────────────────────────────────


@dataclass
class Processes:
    """Working directories and command lines of running processes."""

    cwds: list[str] = field(default_factory=list)
    cmdlines: list[str] = field(default_factory=list)
    method: str = "none"
    sees_cwds: bool = False


def _run_lines(args: list[str], timeout: float = 60) -> list[str] | None:
    try:
        done = subprocess.run(
            args, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout.splitlines()


def _darwin_processes() -> Processes:
    lines = _run_lines(["lsof", "-a", "-d", "cwd", "-Fn", "-w"])
    cmds = _run_lines(["ps", "-axww", "-o", "command="]) or []
    if lines is None:
        return Processes(cmdlines=cmds, method="ps")
    cwds = [line[1:] for line in lines if line.startswith("n")]
    return Processes(cwds, cmds, "lsof+ps", True)


def _linux_processes() -> Processes:
    cwds: list[str] = []
    cmds: list[str] = []
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
    script = "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"
    cmds = _run_lines(["powershell", "-NoProfile", "-NonInteractive", "-Command", script]) or []
    # Windows does not expose another process's working directory without native calls;
    # a folder in use as one cannot be deleted there, which a strip reports as partial.
    return Processes(cmdlines=[c for c in cmds if c.strip()], method="command-lines")


def running_processes() -> Processes:
    if sys.platform == "darwin":
        return _darwin_processes()
    if sys.platform == "win32":
        return _windows_processes()
    return _linux_processes()


def _norm(path: str) -> str:
    text = os.path.normpath(path)
    return text.lower() if os.name == "nt" else text


def busy_reason(worktree: Path, processes: Processes) -> str | None:
    """Why a process is using worktree, or None."""
    root = _norm(str(worktree))
    for cwd in processes.cwds:
        candidate = _norm(cwd)
        if candidate == root or candidate.startswith(root + os.sep):
            return "a process's working directory is inside it"
    flags = re.IGNORECASE if os.name == "nt" else 0
    pattern = re.compile(re.escape(str(worktree)) + r"(?=$|[/\\\s\"'])", flags)
    for line in processes.cmdlines:
        if pattern.search(line):
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


def find_candidates(
    worktree: Path, entries: list[DiskRegenerable], deadline: float,
) -> tuple[list[Candidate], bool]:
    """Paths under worktree that entries name: (candidates, whether the walk finished)."""
    compiled = [(compile_pattern(e.path), e) for e in entries]
    found: list[Candidate] = []
    stack: list[tuple[Path, str, int]] = [(worktree, "", 0)]
    while stack:
        if time.monotonic() > deadline:
            return found, False
        folder, prefix, depth = stack.pop()
        try:
            children = list(os.scandir(folder))
        except OSError:
            continue
        for child in children:
            rel = f"{prefix}{child.name}"
            link = is_link(child)
            folder_like = not link and child.is_dir(follow_symlinks=False)
            entry = _match(rel, compiled)
            if entry is not None:
                kind = "link" if link else ("dir" if folder_like else "file")
                found.append(Candidate(rel, entry, kind))
                continue
            if folder_like and child.name not in NEVER_ENTER and depth < MAX_DEPTH:
                stack.append((Path(child.path), rel + "/", depth + 1))
    return found, True


# ── Sizes ───────────────────────────────────────────────────────────────────


def allocated(path: Path, deadline: float) -> int | None:
    """Allocated bytes under path, links not followed, hard links counted once.

    None when the deadline passes first. Copy-on-write clones still count in full: their
    sharing is invisible to stat, which is why reclaimed space is measured from free space.
    """
    total = 0
    seen: set[tuple[int, int]] = set()
    stack = [path]
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
