"""The only code in the disk-* commands that deletes files.

`remove_inside(path, root)` deletes path only if it resolves inside root, never follows a
symbolic link or a Windows junction (a link is removed as a link, its target untouched), clears
the read-only flag git puts on pack files, uses long-path syntax on Windows, and keeps going past
a file it cannot delete, reporting it, so a partial strip is visible rather than fatal.
"""

from __future__ import annotations

import os
import stat
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPARSE_POINT = 0x400  # FILE_ATTRIBUTE_REPARSE_POINT
DIRECTORY = 0x10  # FILE_ATTRIBUTE_DIRECTORY


class UnsafePath(Exception):
    """A path that must not be deleted: outside its root, or the root itself."""


@dataclass
class Removal:
    """What one remove_inside call did."""

    path: str
    removed_files: int = 0
    removed_bytes: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return not self.errors


def _long(path: str) -> str:
    """Windows long-path syntax for an absolute path; other platforms unchanged."""
    if sys.platform != "win32" or path.startswith("\\\\?\\"):
        return path
    absolute = os.path.abspath(path)
    if absolute.startswith("\\\\"):
        return "\\\\?\\UNC\\" + absolute[2:]
    return "\\\\?\\" + absolute


def _is_link(info: os.stat_result) -> bool:
    if stat.S_ISLNK(info.st_mode):
        return True
    return bool(getattr(info, "st_file_attributes", 0) & REPARSE_POINT)


def _key(path: str) -> str:
    return os.path.normcase(os.path.normpath(path))


def check_inside(path: Path, root: Path) -> None:
    """Raise UnsafePath unless path's parent resolves inside root and path is not root.

    The parent is resolved, not path itself, so a link at path counts as inside even when it
    points elsewhere: removing it removes only the link.
    """
    real_root = _key(os.path.realpath(root))
    parent = _key(os.path.realpath(os.path.dirname(os.path.abspath(path))))
    target = os.path.join(parent, os.path.basename(os.path.normpath(path)))
    if _key(target) == real_root:
        raise UnsafePath(f"{path} is the root itself")
    if parent != real_root and not parent.startswith(real_root + os.sep):
        raise UnsafePath(f"{path} is not inside {root}")
    if os.path.dirname(real_root) == real_root:
        raise UnsafePath(f"refusing a filesystem root as the root: {root}")


def _unlink(path: str, removal: Removal, size: int) -> None:
    try:
        os.unlink(path)
    except PermissionError:
        try:
            os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
            os.unlink(path)
        except OSError as exc:
            removal.errors.append(f"{path}: {exc.strerror or exc}")
            return
    except FileNotFoundError:
        return
    except OSError as exc:
        removal.errors.append(f"{path}: {exc.strerror or exc}")
        return
    removal.removed_files += 1
    removal.removed_bytes += size


def _remove_link(path: str, info: os.stat_result, removal: Removal) -> None:
    """Remove a link without touching its target. A directory link on Windows is rmdir'd."""
    try:
        attributes = getattr(info, "st_file_attributes", 0)
        if stat.S_ISDIR(info.st_mode) or (os.name == "nt" and attributes & DIRECTORY):
            os.rmdir(path)
        else:
            os.unlink(path)
    except FileNotFoundError:
        return
    except OSError as exc:
        removal.errors.append(f"{path}: {exc.strerror or exc}")
        return
    removal.removed_files += 1


def _size(info: os.stat_result) -> int:
    blocks = getattr(info, "st_blocks", None)
    return blocks * 512 if blocks is not None else info.st_size


def _remove_tree(top: str, removal: Removal) -> None:
    """Depth-first removal that never descends through a link or junction."""
    stack: list[tuple[str, bool]] = [(top, False)]
    while stack:
        current, visited = stack.pop()
        if visited:
            try:
                os.rmdir(current)
            except FileNotFoundError:
                pass
            except OSError as exc:
                removal.errors.append(f"{current}: {exc.strerror or exc}")
            continue
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            continue
        except OSError as exc:
            removal.errors.append(f"{current}: {exc.strerror or exc}")
            continue
        if _is_link(info):
            _remove_link(current, info, removal)
        elif stat.S_ISDIR(info.st_mode):
            stack.append((current, True))
            try:
                names = os.listdir(current)
            except OSError as exc:
                removal.errors.append(f"{current}: {exc.strerror or exc}")
                continue
            stack.extend((os.path.join(current, name), False) for name in names)
        else:
            _unlink(current, removal, _size(info))


def remove_inside(path: Path, root: Path) -> Removal:
    """Delete path (a file, a link or a folder) if it lies inside root. Never follows links."""
    check_inside(path, root)
    removal = Removal(str(path))
    target = _long(str(path))
    try:
        info = os.lstat(target)
    except FileNotFoundError:
        return removal
    if _is_link(info):
        _remove_link(target, info, removal)
    elif stat.S_ISDIR(info.st_mode):
        _remove_tree(target, removal)
    else:
        _unlink(target, removal, _size(info))
    return removal
