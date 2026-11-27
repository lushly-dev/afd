"""The only code in the disk-* commands that deletes files.

`remove_inside(path, root)` deletes path only if it resolves inside root. It never follows a
symbolic link or a Windows junction (a link is removed as a link, its target untouched), never
deletes through a folder holding `.git` (a nested checkout is left whole and listed in `kept`),
never crosses onto another mounted volume, and keeps going past a file it cannot delete,
reporting it, so a partial strip is visible rather than fatal.

On macOS and Linux the walk holds an open handle to each folder and deletes by name relative to
it, so a folder swapped for a link while the walk runs cannot redirect it elsewhere. Windows has
no such calls; there every folder is checked again, by identity, just before it is entered, and
a read-only file has its read-only flag cleared before a second attempt.
"""

from __future__ import annotations

import os
import stat
from dataclasses import dataclass, field
from pathlib import Path

from botcore.commands.disk.scan import long_path
from botcore.commands.disk.steps import doing, each

REPARSE_POINT = 0x400  # FILE_ATTRIBUTE_REPARSE_POINT
DIRECTORY = 0x10  # FILE_ATTRIBUTE_DIRECTORY
KEPT_CHECKOUT = "holds a git checkout; left in place"
HANDLES = os.name != "nt" and os.unlink in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW")


class UnsafePath(Exception):
    """A path that must not be deleted: outside its root, or the root itself."""


@dataclass
class Removal:
    """What one remove_inside call did."""

    path: str
    removed_files: int = 0
    removed_bytes: int = 0
    errors: list[str] = field(default_factory=list)
    kept: list[str] = field(default_factory=list)  # nested git checkouts, left whole on purpose

    @property
    def complete(self) -> bool:
        return not self.errors and not self.kept

    def fail(self, where: str, exc: OSError | str) -> None:
        text = exc if isinstance(exc, str) else (exc.strerror or str(exc))
        self.errors.append(f"{where}: {text}")

    def keep(self, where: str) -> None:
        """A folder holding `.git`: never deleted through, which is the rule working."""
        self.kept.append(f"{where}: {KEPT_CHECKOUT}")


def _long(path: str) -> str:
    """Windows long-path syntax; the same helper the walk uses, so both read paths alike."""
    return long_path(path)


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
    if os.path.dirname(real_root) == real_root:
        raise UnsafePath(f"refusing a filesystem root as the root: {root}")
    parent = _key(os.path.realpath(os.path.dirname(os.path.abspath(path))))
    target = os.path.join(parent, os.path.basename(os.path.normpath(path)))
    if _key(target) == real_root:
        raise UnsafePath(f"{path} is the root itself")
    if parent != real_root and not parent.startswith(real_root + os.sep):
        raise UnsafePath(f"{path} is not inside {root}")


def _size(info: os.stat_result) -> int:
    blocks = getattr(info, "st_blocks", None)
    return blocks * 512 if blocks is not None else info.st_size


# ── macOS and Linux: by open folder handle ──────────────────────────────────


def _unlink_at(name: str, dir_fd: int, info: os.stat_result, where: str, out: Removal) -> None:
    doing("removing", where)  # right before it goes: a step that was left stops here
    try:
        os.unlink(name, dir_fd=dir_fd)
    except FileNotFoundError:
        return
    except OSError as exc:
        out.fail(where, exc)
        return
    out.removed_files += 1
    out.removed_bytes += 0 if stat.S_ISLNK(info.st_mode) else _size(info)


def _clear_at(dir_fd: int, where: str, device: int, out: Removal) -> bool:
    """Delete everything in the open folder dir_fd. True when it is empty afterwards."""
    doing("clearing", where)
    empty = True
    with os.scandir(dir_fd) as entries:
        children = list(each("removing", where, entries))
    if any(child.name == ".git" for child in children):
        out.keep(where)
        return False
    for child in children:
        here = os.path.join(where, child.name)
        doing("looking at", here)  # every file: a folder of very many is work, not waiting
        try:
            info = child.stat(follow_symlinks=False)
        except FileNotFoundError:
            continue
        except OSError as exc:
            out.fail(here, exc)
            empty = False
            continue
        if not stat.S_ISDIR(info.st_mode):
            _unlink_at(child.name, dir_fd, info, here, out)
            continue
        if info.st_dev != device:
            out.fail(here, "another volume is mounted here; left in place")
            empty = False
            continue
        if not _remove_dir_at(child.name, dir_fd, here, device, out):
            empty = False
    return empty


def _remove_dir_at(name: str, parent_fd: int, where: str, device: int, out: Removal) -> bool:
    o_directory: int = getattr(os, "O_DIRECTORY", 0)
    o_nofollow: int = getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(name, os.O_RDONLY | o_directory | o_nofollow, dir_fd=parent_fd)
    except FileNotFoundError:
        return True
    except OSError as exc:  # ELOOP: swapped for a link since it was listed
        out.fail(where, exc)
        return False
    try:
        if os.fstat(fd).st_dev != device:
            out.fail(where, "another volume is mounted here; left in place")
            return False
        empty = _clear_at(fd, where, device, out)
    finally:
        os.close(fd)
    if not empty:
        return False
    doing("removing", where)
    try:
        os.rmdir(name, dir_fd=parent_fd)
    except FileNotFoundError:
        pass
    except OSError as exc:
        out.fail(where, exc)
        return False
    return True


def _remove_by_handle(path: Path, out: Removal) -> None:
    parent = os.path.realpath(os.path.dirname(os.path.abspath(path)))
    name = os.path.basename(os.path.normpath(path))
    o_directory: int = getattr(os, "O_DIRECTORY", 0)
    parent_fd = os.open(parent, os.O_RDONLY | o_directory)
    try:
        opened, expected = os.fstat(parent_fd), os.stat(parent)
        if (opened.st_dev, opened.st_ino) != (expected.st_dev, expected.st_ino):
            out.fail(str(path), "its folder changed while it was being opened")
            return
        try:
            info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        if stat.S_ISDIR(info.st_mode):
            _remove_dir_at(name, parent_fd, str(path), info.st_dev, out)
        else:
            _unlink_at(name, parent_fd, info, str(path), out)
    finally:
        os.close(parent_fd)


# ── Windows: by path, identity checked before entering each folder ──────────


def _unlink_path(path: str, info: os.stat_result, out: Removal) -> None:
    doing("removing", path)  # right before it goes: a step that was left stops here
    try:
        os.unlink(path)
    except FileNotFoundError:
        return
    except PermissionError:
        try:  # git marks pack files read-only; clear only that flag, keep the rest of the mode
            doing("removing", path)  # the first try can have waited at the volume
            os.chmod(path, info.st_mode | stat.S_IWRITE)
            doing("removing", path)
            os.unlink(path)
        except OSError as exc:
            out.fail(path, exc)
            return
    except OSError as exc:
        out.fail(path, exc)
        return
    out.removed_files += 1
    out.removed_bytes += _size(info)


def _remove_link_path(path: str, info: os.stat_result, out: Removal) -> None:
    """Remove a link without touching its target. A directory link or junction is rmdir'd."""
    doing("removing", path)
    try:
        if getattr(info, "st_file_attributes", 0) & DIRECTORY or stat.S_ISDIR(info.st_mode):
            os.rmdir(path)
        else:
            os.unlink(path)
    except FileNotFoundError:
        return
    except OSError as exc:
        out.fail(path, exc)
        return
    out.removed_files += 1


def _holds_reported(folder: str, out: Removal) -> bool:
    """Whether something under folder is already in out's errors or kept: then the folder
    is left because of it, as the handle walk leaves it, and needs no line of its own."""
    inside = os.path.join(folder, "")
    return any(line.startswith(inside) for line in (*out.kept, *out.errors))


def _remove_dir_path(top: str, device: int, out: Removal) -> bool:
    expected = os.lstat(top)
    stack: list[tuple[str, bool, tuple[int, int]]] = [
        (top, False, (expected.st_dev, expected.st_ino))
    ]
    ok = True
    while stack:
        current, visited, identity = stack.pop()
        doing("removing", current)
        if visited:
            try:
                os.rmdir(current)
            except FileNotFoundError:
                pass
            except OSError as exc:
                ok = False
                if not _holds_reported(current, out):  # what is left in it is already told
                    out.fail(current, exc)
            continue
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            continue
        if _is_link(info) or (info.st_dev, info.st_ino) != identity or info.st_dev != device:
            out.fail(current, "changed or is on another volume; left in place")
            ok = False
            continue
        doing("clearing", current)  # the words the handle walk says, so either is followed
        try:
            with os.scandir(current) as entries:
                names = [entry.name for entry in each("removing", current, entries)]
        except OSError as exc:
            out.fail(current, exc)
            ok = False
            continue
        if ".git" in names:
            out.keep(current)
            ok = False
            continue
        stack.append((current, True, identity))
        for name in names:
            child = os.path.join(current, name)
            doing("looking at", child)  # every file; each removal says "removing" right before
            try:
                child_info = os.lstat(child)
            except FileNotFoundError:
                continue
            except OSError as exc:  # said, so that a kept checkout beside it hides nothing
                out.fail(child, exc)
                ok = False
                continue
            if _is_link(child_info):
                _remove_link_path(child, child_info, out)
            elif stat.S_ISDIR(child_info.st_mode):
                stack.append((child, False, (child_info.st_dev, child_info.st_ino)))
            else:
                _unlink_path(child, child_info, out)
    return ok


def _remove_by_path(path: Path, out: Removal) -> None:
    target = _long(str(path))
    try:
        info = os.lstat(target)
    except FileNotFoundError:
        return
    if _is_link(info):
        _remove_link_path(target, info, out)
    elif stat.S_ISDIR(info.st_mode):
        _remove_dir_path(target, info.st_dev, out)
    else:
        _unlink_path(target, info, out)


def remove_inside(path: Path, root: Path) -> Removal:
    """Delete path (a file, a link or a folder) if it lies inside root. Never follows links."""
    check_inside(path, root)
    out = Removal(str(path))
    try:
        if HANDLES:
            _remove_by_handle(path, out)
        else:
            _remove_by_path(path, out)
    except OSError as exc:
        out.fail(str(path), exc)
    return out
