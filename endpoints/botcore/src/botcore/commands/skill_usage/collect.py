"""`skill-usage-collect`: copy new skill loads from what the harnesses record into this
machine's record.

Nothing is added to a skill and no agent reports anything: the loads are read from records the
harnesses already keep. Running it again adds only what is new.
"""

from __future__ import annotations

import dataclasses
import hashlib
import os
import re
import sqlite3
import stat
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.lock import LockHeld, RunLock
from botcore.commands.disk.scan import volume_id
from botcore.commands.disk.settings import SettingsError
from botcore.commands.disk.steps import doing, run_blocking
from botcore.commands.skill.frontmatter import split_frontmatter
from botcore.commands.skill.lint import listing_characters
from botcore.commands.skill_usage import claude_code, t3
from botcore.commands.skill_usage.events import EDIT, RECOGNIZER, TYPED, Event, is_skill_folder
from botcore.commands.skill_usage.external import (
    apply_aliases,
    extra_skill_dirs_for_root,
    repo_skills_config_at,
    repo_skills_config_on_disk,
    skill_dirs_for,
    update_external_and_observed,
)
from botcore.commands.skill_usage.store import (
    LOCK_FILE,
    SHARING,
    InvalidMachine,
    Local,
    append_events,
    as_inventory,
    checked_machine,
    load_events,
    load_sessions,
    load_state,
    local,
    newest_inventory,
    publish,
    rewrite_events,
    save_sessions,
    save_state,
    state_dir,
    t3_store_path,
    unreadable_lines,
)

STATE_VERSION = 1
INVENTORY_VERSION = 2  # bumps when what skill_inventory reads from a commit expands (#1830)
OVERLAP = timedelta(days=1)  # re-read this much, for items a harness finished writing late
FULL_EVERY = timedelta(days=7)  # then read everything: a thread moved here can be older
GIT_SECONDS = 30.0
SKILL_DIRS = (".claude/skills", ".agents/skills", ".codex/skills")
# The branch changes are merged to, where a checkout says which it is
DEFAULT_BRANCHES = (
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
    "refs/heads/main",
    "refs/heads/master",
)
_TIP = "%(refname)%09%(objectname)%09%(committerdate:iso-strict)%09%(symref)"
_ORIGIN, _LOCAL = "refs/remotes/origin/", "refs/heads/"
# What git says of a folder that is no repository (its messages are asked for in English)
_NOT_A_REPOSITORY = "not a git repository"
_LINK = "120000"  # a tree entry that is a link: its blob is the path it points to
# How long a folder that is not there, and that nothing shows was removed, keeps speaking for
# its project: a volume away for longer speaks no more, until it is read again
GONE_AFTER = timedelta(days=30)
NOTHING_HELD: dict[str, object] = {"at": None, "commit": None, "held": {}, "renames": {}}
UNKNOWN_PROJECT = "unknown"
_REMOTE = re.compile(r"[:/]([^/:\s]+/[^/\s]+?)(?:\.git)?/?$")


def _stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _parse(stamp: object) -> datetime | None:
    try:
        moment = datetime.fromisoformat(stamp) if isinstance(stamp, str) else None
    except ValueError:
        return None
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _mapping(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _strings(value: object) -> list[str]:
    return [entry for entry in value if isinstance(entry, str)] if isinstance(value, list) else []


def _renames(value: object) -> dict[str, str]:
    return {
        old: new
        for old, new in _mapping(value).items()
        if isinstance(old, str) and isinstance(new, str)
    }


def _pathspecs(skill_dirs: tuple[str, ...] = SKILL_DIRS) -> tuple[str, ...]:
    return tuple(f":(glob){folder}/*/SKILL.md" for folder in skill_dirs)


def skill_on_disk(root: str, name: str, skill_dirs: tuple[str, ...] | None = None) -> bool:
    """Whether a checkout holds a skill of this name in its default or configured skill folders."""
    dirs = (
        skill_dirs
        if skill_dirs is not None
        else skill_dirs_for(repo_skills_config_on_disk(Path(root)))
    )
    return any((Path(root) / folder / name / "SKILL.md").is_file() for folder in dirs)


def _tips(root: Path, refs: tuple[str, ...]) -> dict[str, tuple[str, datetime, str]]:
    """Each of some refs a checkout has: its commit, when that was committed, and the ref it
    stands for where it is a name for another. Raises GitError."""
    text = git_out(root, "for-each-ref", f"--format={_TIP}", *refs, timeout=GIT_SECONDS)
    tips: dict[str, tuple[str, datetime, str]] = {}
    for line in text.splitlines():
        ref, commit, stamp, target = (*line.split("\t"), "", "", "")[:4]
        when = _parse(stamp.strip())
        if when is not None and commit:
            tips[ref] = (commit, when, target.strip())
    return tips


def default_tip(root: Path) -> tuple[str, str, str] | None:
    """The tip of the branch changes are merged to, as a checkout has it: the ref, its
    commit, and when that was committed. None when the folder names no such branch, or is
    no repository. Raises GitError when git could not say (it did not start or answer in
    time, a ref is broken, the folder is one it refuses): that says nothing of what the
    branch holds, and `_name_projects` decides what the folder then stands for.

    Never the checked-out commit: on a topic branch that is unmerged work, and a checkout
    left on an old branch would speak for the project as it was. The branch is named first
    (`origin/HEAD`'s, else `main`, else `master`), so that no other branch speaks for it
    however new. Then of the remote's copy and the checkout's own the one ahead, since a
    checkout that was not fetched has the remote's behind and one that was not pushed has
    it ahead: the one the other leads to, whatever their times, and the newer only where
    neither does."""
    try:
        tips = _tips(root, DEFAULT_BRANCHES)
    except GitError as exc:
        if _NOT_A_REPOSITORY in str(exc):
            return None
        raise
    named = tips.get(f"{_ORIGIN}HEAD", ("", None, ""))[2].removeprefix(_ORIGIN)
    name = named or next(
        (name for name in ("main", "master") if {_ORIGIN + name, _LOCAL + name} & set(tips)),
        None,
    )
    if name is None:
        return None
    theirs, ours = _ORIGIN + name, _LOCAL + name
    if name not in ("main", "master"):
        tips = _tips(root, (theirs, ours))
    found = [(ref, *tips[ref][:2]) for ref in (theirs, ours) if ref in tips]
    if not found:
        return None
    ref, commit, when = found[0]
    if len(found) > 1 and found[1][1] != commit:
        base = git_out(
            root, "merge-base", commit, found[1][1], ok_codes=(0, 1), timeout=GIT_SECONDS
        ).strip()
        if base == commit or (base != found[1][1] and found[1][2] > when):
            ref, commit, when = found[1]  # ours is ahead, or the newer of two that parted
    return ref, commit, when.astimezone(UTC).isoformat()


def _facts(raw: bytes) -> list[int]:
    """A SKILL.md's size and what it adds to every session's skill listing, from its bytes.
    Line ends count as one character, as a file read as text has them, so a checkout that
    writes them the Windows way says the same as the commit. A front matter that cannot be
    read (a date there is no day for raises where bad YAML is caught) is none: one skill's
    file never stops a collection."""
    text = raw.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    try:
        described = split_frontmatter(text)[0]
    except ValueError:
        described = None
    return [len(text.encode("utf-8")), listing_characters(text, described)]


def held_in_folder(root: Path, skill_dirs: tuple[str, ...] = SKILL_DIRS) -> dict[str, list[int]]:
    """Each skill a folder holds as it lies, with its facts (`_facts`). For a project that is
    not a repository, names no branch that changes are merged to, or that git could not
    read, with no commit on record (`_name_projects`). Only a `SKILL.md` that is a file is
    read: a pipe by that name would hold the collection until something wrote to it."""
    found: dict[str, list[int]] = {}
    for folder in skill_dirs:
        try:
            children = sorted(Path(root, folder).iterdir())
        except (OSError, ValueError):
            continue
        for child in children:
            if not is_skill_folder(child.name):
                continue
            try:
                if not (child / "SKILL.md").is_file():
                    continue
                raw = (child / "SKILL.md").read_bytes()
            except (OSError, ValueError):
                continue
            found.setdefault(child.name, _facts(raw))
    return found


def folder_there(path: Path) -> bool | None:
    """Whether a folder is there. False only where it is known not to be: nothing has that
    name, or it is no folder, or the way to it leads through something that is none. None
    where that cannot be told (the user may not look, a drive does not answer): never taken
    for a folder that is gone."""
    try:
        mode = os.stat(path).st_mode
    except (FileNotFoundError, NotADirectoryError):
        return False
    except (OSError, ValueError):
        return None
    return stat.S_ISDIR(mode)


def _valid_path(value: object) -> bool:
    return isinstance(value, str) and bool(value) and "\x00" not in value


def _volume_id(
    mount: Path,
    cache: dict[tuple[str, int], str | None] | None = None,
    device: int | None = None,
) -> str | None:
    """A volume's stable identifier at `mount`. Cached by `(mount, device)` while recording
    present folders in a collection; `storage_there` always queries live before dropping an
    account so a disk swapped mid-collection is never mistaken for the one seen earlier."""
    if cache is not None and device is not None:
        key = (str(mount), device)
        if key in cache:
            return cache[key]
        found = volume_id(mount)
        value = found if isinstance(found, str) and found else None
        cache[key] = value
        return value
    found = volume_id(mount)
    return found if isinstance(found, str) and found else None


def storage_of(
    folder: Path, volume_ids: dict[tuple[str, int], str | None] | None = None
) -> dict | None:
    """What a folder that is there is kept on, by which to tell later whether that is still
    there: its volume's mount point with the volume's own identifier (`volume`, `id`), or its
    device number (`volume`, `device`) where the system gives no identifier; or, inside a cloud
    drive's folder (`Library/CloudStorage/<drive>`), that drive's own folder (`folder`), which
    the drive's app takes away when it is signed out. The folder is taken as its links resolve:
    a link to a checkout on another volume is on that volume. None where it cannot be told."""
    try:
        real = Path(os.path.realpath(folder, strict=True))
    except (OSError, ValueError):
        return None
    parts = real.parts
    for at in range(len(parts) - 2):
        if parts[at : at + 2] == ("Library", "CloudStorage"):
            return {"folder": str(Path(*parts[: at + 3]))}
    for above in (real, *real.parents):
        if os.path.ismount(above):
            try:
                device = os.stat(above).st_dev
            except (OSError, ValueError):
                return None
            identifier = _volume_id(above, volume_ids, device)
            if identifier is not None:
                return {"volume": str(above), "id": identifier}
            return {"volume": str(above), "device": device}
    return None


def storage_there(kept_on: dict) -> bool:
    """Whether what a folder was kept on (`storage_of`) is there now: the same volume,
    mounted where it was, or a cloud drive's folder that is there.

    The volume's root is looked at, not only asked after: Windows calls every drive letter
    and every share a mount point from its name alone, there or not. And it must be the
    volume that was there, by its identifier where one was recorded, else by its device
    number: another disk at the same place is not it. A volume known by its identifier is
    still recognised when it comes back under another device number; one known only by its
    device number is taken as away when that number changes, which only waits."""
    folder, volume = kept_on.get("folder"), kept_on.get("volume")
    if isinstance(folder, str):
        return _valid_path(folder) and folder_there(Path(folder)) is True
    if not isinstance(volume, str) or not _valid_path(volume):
        return False
    try:
        device = os.stat(volume).st_dev
        mounted = os.path.ismount(volume)
    except (OSError, ValueError):
        return False
    if not mounted:
        return False
    if "id" in kept_on:
        identifier = kept_on["id"]
        return (
            isinstance(identifier, str)
            and bool(identifier)
            and _volume_id(Path(volume)) == identifier
        )
    expected = kept_on.get("device")
    return type(expected) is int and device == expected


def _storage(value: object) -> dict[str, dict]:
    """What each folder was kept on, as the state holds it: only what `storage_of` writes."""
    found: dict[str, dict] = {}
    for root, kept_on in _mapping(value).items():
        kept_on = _mapping(kept_on)
        folder, volume = kept_on.get("folder"), kept_on.get("volume")
        identifier, device = kept_on.get("id"), kept_on.get("device")
        if not isinstance(root, str):
            continue
        if _valid_path(folder):
            found[root] = {"folder": folder}
        elif _valid_path(volume) and isinstance(identifier, str) and identifier:
            found[root] = {"volume": volume, "id": identifier}
        elif _valid_path(volume) and "id" not in kept_on and type(device) is int:
            found[root] = {"volume": volume, "device": device}
    return found


def held_at(
    root: Path, commit: str, skill_dirs: tuple[str, ...] = SKILL_DIRS
) -> dict[str, list[int]]:
    """Each skill a project holds at a commit, with its facts. Read from git's objects: what
    is checked out or changed in the folder plays no part, so every machine that has the
    commit says the same of it. A `SKILL.md` that is a link is not followed. Raises
    GitError, and ValueError for an answer from git that cannot be read."""
    listed = git_out(root, "ls-tree", "-r", "-z", commit, "--", *skill_dirs, timeout=GIT_SECONDS)
    blobs: dict[str, str] = {}  # a name two folders hold is the first folder's, as on disk
    for folder in skill_dirs:
        for entry in listed.split("\0"):
            about, _, path = entry.partition("\t")
            mode, kind, blob = (*about.split(), "", "", "")[:3]
            name, _, file = path.removeprefix(f"{folder}/").partition("/")
            if kind != "blob" or mode == _LINK:
                continue  # a link's blob is a path, not the file
            if path.startswith(f"{folder}/") and file == "SKILL.md" and is_skill_folder(name):
                blobs.setdefault(name, blob)
    if not blobs:
        return {}
    # every file in one call, and its bytes as git holds them
    raw = git_out(
        root, "cat-file", "--batch", stdin="".join(f"{blob}\n" for blob in blobs.values()),
        timeout=GIT_SECONDS,
    ).encode("utf-8", errors="surrogateescape")  # fmt: skip
    found: dict[str, list[int]] = {}
    at = 0
    for name, blob in blobs.items():
        end = raw.index(b"\n", at)
        told = raw[at:end].split()
        if len(told) != 3 or told[0].decode("ascii", "replace") != blob or told[1] != b"blob":
            raise ValueError(f"git cat-file: {raw[at:end][:80]!r}")
        size = int(told[2])
        found[name] = _facts(raw[end + 1 : end + 1 + size])
        at = end + 1 + size + 1
    return found


def skill_inventory(root: Path, last: dict | None = None) -> dict:
    """What a project holds, as one of its folders says (`store.as_inventory`): its skills
    and their renames at the tip of its default branch, both read from that one commit, or
    as the folder lies where it names no such branch. `last` is what this folder said
    before: a branch that has not moved is not read again. Raises GitError, and ValueError
    for an answer from git that cannot be read: nothing is known of the branch this time."""
    tip = default_tip(root)
    if tip is None:
        cfg = repo_skills_config_on_disk(root)
        dirs = skill_dirs_for(cfg)
        raw_held = held_in_folder(root) if dirs == SKILL_DIRS else held_in_folder(root, dirs)
        raw_renames = (
            skill_renames(root) if dirs == SKILL_DIRS else skill_renames(root, skill_dirs=dirs)
        )
        inventory: dict = {
            "at": None,
            "commit": None,
            "held": apply_aliases(raw_held, cfg.aliases),
            "renames": raw_renames or {},
        }
        if cfg.aliases:
            inventory["aliases"] = dict(cfg.aliases)
        return inventory
    _ref, commit, at = tip
    if last is not None and last["commit"] == commit:
        return last
    cfg = repo_skills_config_at(root, commit)
    dirs = skill_dirs_for(cfg)
    raw_held = held_at(root, commit) if dirs == SKILL_DIRS else held_at(root, commit, dirs)
    raw_renames = (
        _renames_in(root, commit) if dirs == SKILL_DIRS else _renames_in(root, commit, dirs)
    )
    inventory = {
        "at": at,
        "commit": commit,
        "held": apply_aliases(raw_held, cfg.aliases),
        "renames": raw_renames,
    }
    if cfg.aliases:
        inventory["aliases"] = dict(cfg.aliases)
    return inventory


def skill_renames(
    root: Path, ref: str = "HEAD", skill_dirs: tuple[str, ...] = SKILL_DIRS
) -> dict[str, str] | None:
    """Old skill name to new, from the renames in a history; None when git cannot say. A
    skill folder renamed in one commit keeps one identity in the report this way, with
    nothing to configure. The history read is the one whose skills the report lists: the
    default branch's, at the commit its skills were read from (`skill_inventory`), or the
    checkout's own where it names none."""
    try:
        return _renames_in(root, ref, skill_dirs)
    except GitError:
        return None


def _renames_in(root: Path, ref: str, skill_dirs: tuple[str, ...] = SKILL_DIRS) -> dict[str, str]:
    text = git_out(
        root, "log", ref, "--diff-filter=R", "-M50%", "--name-status", "--format=",
        "--", *_pathspecs(skill_dirs), timeout=GIT_SECONDS,
    )  # fmt: skip
    renames: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) != 3 or not parts[0].startswith("R"):
            continue
        old, new = (Path(part).parent.name for part in parts[1:])
        # between names a load can be recorded under, as the lists hold only those: the
        # triggers report reads these as they come, and must name a skill as the usage
        # report does
        if old != new and is_skill_folder(old) and is_skill_folder(new):
            renames.setdefault(old, new)  # newest first: the latest rename of a name wins
    return renames


_ORIGIN_SECTION = re.compile(r'^\s*\[\s*(?i:remote)\s+"origin"\s*\]\s*(?:[#;].*)?$')
_ANY_SECTION = re.compile(r"^\s*\[")
_URL_LINE = re.compile(r"^\s*url\s*=\s*(.+?)\s*$", re.IGNORECASE)


def _git_config_paths(root: Path) -> list[Path]:
    """Candidate git config files for a checkout or worktree, without invoking git."""
    for candidate in (root, *root.parents):
        dotgit = candidate / ".git"
        try:
            is_dir = dotgit.is_dir()
            is_file = not is_dir and dotgit.is_file()
        except OSError:
            return []
        if is_dir:
            return [dotgit / "config"]
        if is_file:
            try:
                first = dotgit.read_text(encoding="utf-8", errors="replace").splitlines()[0]
            except (OSError, IndexError):
                return []
            if not first.lower().startswith("gitdir:"):
                return []
            raw_dir = first.split(":", 1)[1].strip()
            if not raw_dir:
                return []
            try:
                gitdir = Path(raw_dir)
                if not gitdir.is_absolute():
                    gitdir = (dotgit.parent / gitdir).resolve()
                configs = [gitdir / "config"]
                commondir_file = gitdir / "commondir"
                if commondir_file.is_file():
                    raw_common = commondir_file.read_text(
                        encoding="utf-8", errors="replace"
                    ).strip()
                    if raw_common:
                        common = Path(raw_common)
                        if not common.is_absolute():
                            common = (gitdir / common).resolve()
                        configs.append(common / "config")
            except OSError:
                return []
            return configs
    return []


def _parse_origin_url(text: str) -> str | None:
    """Return the first `url` inside `[remote "origin"]` in a git config file."""
    in_origin = False
    for line in text.splitlines():
        if _ORIGIN_SECTION.match(line):
            in_origin = True
            continue
        if _ANY_SECTION.match(line):
            in_origin = False
            continue
        if not in_origin:
            continue
        match = _URL_LINE.match(line)
        if not match:
            continue
        value = match.group(1).strip()
        if value.startswith('"') and '"' in value[1:]:
            value = value[1 : value.index('"', 1)]
        else:
            value = re.split(r"\s+[#;]", value, maxsplit=1)[0].strip()
        value = _CONFIG_ESCAPE.sub(lambda m: _CONFIG_ESCAPES.get(m[1], m[1]), value)
        if value:
            return value
    return None


#: Git config escapes (`git remote add` writes each backslash of a Windows path twice).
_CONFIG_ESCAPE = re.compile(r"\\(.)")
_CONFIG_ESCAPES = {"n": "\n", "t": "\t", "b": "\b"}


def _origin_from_git_config(root: Path) -> str | None:
    """Read `[remote "origin"]` url directly from `.git/config` when git refuses the folder."""
    for config in _git_config_paths(root):
        try:
            text = config.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        url = _parse_origin_url(text)
        if url:
            return url
    return None


def project_remote(root: Path) -> str | None:
    """`owner/name` from a checkout's origin: the same on every machine and for every clone."""
    try:
        url = git_out(root, "remote", "get-url", "origin", timeout=GIT_SECONDS).strip()
    except GitError:
        url = _origin_from_git_config(root) or ""
    return remote_repo(url)


def remote_repo(url: str) -> str | None:
    """`owner/name` from an origin URL or path. A Windows path's backslashes separate as `/`
    does, so a local origin names the same repository on every system."""
    match = _REMOTE.search(url.replace("\\", "/"))
    return match.group(1) if match else None


def _upgrade_remote_projects(projects: dict, refiled: dict[str, str] | None) -> None:
    """Move folders on `remote: false` projects to `owner/name` once git can read their origin.

    When every root of an unsplit old project moves to the same `owner/name`, drop the old
    project and record `refiled[old_name] = remote` so historical events and sessions are
    refiled too. If a multi-root project moves only part of its roots (or moves roots to
    different origins), mark it `split` and keep its historical records under `old_name` so
    later staged moves never misattribute them.
    """
    for old_name in list(projects):
        old_entry = projects[old_name]
        if old_entry["remote"]:
            continue
        moved_to: set[str] = set()
        remaining_roots: list[str] = []
        for root in old_entry["roots"]:
            folder = Path(root)
            if folder.is_absolute():
                doing("reading what the project holds in", folder)
                remote = project_remote(folder) if folder_there(folder) is True else None
            else:
                remote = None
            if remote is None or remote == old_name:
                remaining_roots.append(root)
                continue
            moved_to.add(remote)
            target = projects.setdefault(
                remote,
                {
                    "remote": True,
                    "roots": [],
                    "renames": {},
                    "accounts": {},
                    "storage": {},
                    "missing": {},
                },
            )
            target["remote"] = True
            if root not in target["roots"]:
                target["roots"] = [*target["roots"], root]
            for field in ("accounts", "storage", "missing"):
                if root in old_entry[field]:
                    target[field].setdefault(root, old_entry[field].pop(root))
            target["renames"] = {**old_entry["renames"], **target["renames"]}
        old_entry["roots"] = remaining_roots
        if moved_to and (remaining_roots or len(moved_to) > 1):
            old_entry["split"] = True
        if not remaining_roots and len(moved_to) == 1 and not old_entry.get("split"):
            destination = next(iter(moved_to))
            del projects[old_name]
            if refiled is not None:
                refiled[old_name] = destination


def _name_projects(
    previous: dict,
    roots: dict[str, str],
    again: bool = False,
    now: datetime | None = None,
    refiled: dict[str, str] | None = None,
) -> tuple[dict, dict[str, str]]:
    """Name each workspace root, and return the projects to keep with project id to name.
    `again` reads what every folder holds once more, whether or not its branch has moved;
    `now` is when, for a folder that is not there.

    A project is named after its origin, so two clones are one project and the name is the
    same on every machine. One with no origin takes its folder's name, and a second folder of
    that name with no origin gets a suffix, so two unrelated projects never share counts.

    When a stored project with no origin on record (`remote: false`) has a folder whose origin
    git can now read, that folder moves to the `owner/name` project. If no folders remain on
    the old project and every moved folder went to the same `owner/name`, the old project is
    removed and `refiled[old_name] = remote` is recorded so historical events and sessions can
    be refiled to the canonical project name.
    """
    projects: dict[str, dict] = {
        name: {
            "remote": bool(entry.get("remote")),
            **({"split": True} if entry.get("split") else {}),
            "roots": _strings(entry.get("roots")),
            "renames": _renames(entry.get("renames")),
            "accounts": {
                root: account
                for root, value in _mapping(entry.get("accounts")).items()
                if isinstance(root, str) and (account := as_inventory(value)) is not None
            },
            "storage": _storage(entry.get("storage")),
            "missing": {
                root: since
                for root, since in _mapping(entry.get("missing")).items()
                if isinstance(root, str) and _parse(since) is not None
            },
        }
        for name, entry in previous.items()
        if isinstance(name, str) and isinstance(entry, dict)
    }
    _upgrade_remote_projects(projects, refiled)
    by_root = {root: name for name, entry in projects.items() for root in entry["roots"]}
    names: dict[str, str] = {}
    for project_id, root in roots.items():
        name = by_root.get(root)
        if name is None:
            folder = Path(root)
            # asked the way that never raises: a folder the user may not look at is one
            # nothing is known of, and it takes its folder's name
            remote = project_remote(folder) if folder_there(folder) is True else None
            # a store copied from another system writes its folders that system's way: the
            # last part by either separator, never the whole path
            name = remote or re.split(r"[\\/]+", root.rstrip("\\/"))[-1] or project_id
            if not remote and name in projects and not projects[name].get("remote"):
                name = f"{name}~{hashlib.sha256(root.encode()).hexdigest()[:6]}"
            entry = projects.setdefault(
                name,
                {
                    "remote": bool(remote),
                    "roots": [],
                    "renames": {},
                    "accounts": {},
                    "storage": {},
                    "missing": {},
                },
            )
            entry["roots"] = [*entry["roots"], root]
            by_root[root] = name
        names[project_id] = name
    volume_ids: dict[tuple[str, int], str | None] = {}
    for entry in projects.values():
        # Each folder's own account, kept by folder: one whose volume is away this time
        # still speaks through what it said last, and so does one git cannot say anything
        # of, where what it said was of a commit. So an older clone that does answer never
        # takes the project back. A folder read again replaces its own, whatever it now
        # says, and one that was removed says nothing more (`_gone`).
        accounts = {root: entry["accounts"][root] for root in entry["roots"]
                    if root in entry["accounts"]}  # fmt: skip
        storage = {root: kept for root, kept in entry["storage"].items() if root in accounts}
        missing = {root: since for root, since in entry["missing"].items() if root in accounts}
        for root in entry["roots"]:
            folder = Path(root)
            doing("reading what the project holds in", folder)
            # A path of another system (a store copied from one) is no place on this one:
            # nothing here says anything of it.
            there = folder_there(folder) if folder.is_absolute() else None
            if there is not True:
                if there is False and root in accounts and _gone(root, storage, missing, now):
                    del accounts[root]
                    storage.pop(root, None)
                    missing.pop(root, None)
                continue
            missing.pop(root, None)
            kept_on = storage_of(folder, volume_ids)
            if kept_on is not None:
                prior = storage.get(root)
                # a transient volume_id failure (e.g. diskutil timeout) must not downgrade a
                # previously recorded identifier on the same mount to a device number
                if not (
                    "id" not in kept_on
                    and "volume" in kept_on
                    and isinstance(prior, dict)
                    and "id" in prior
                    and prior.get("volume") == kept_on["volume"]
                ):
                    storage[root] = kept_on
            last = accounts.get(root)
            try:
                account = skill_inventory(folder, None if again else last)
            except (GitError, ValueError):
                # Git could not say. A folder that has said something of a commit keeps it,
                # through a rebuild too: an hour's failure must not put the files as they
                # lie, work under way and all, in its place. One that never has is read as
                # it lies, whatever stopped git: that is all there is to know of a
                # repository git refuses for good (one another account owns), and for one
                # that only timed out it lasts until git answers. Such an account is older
                # than any commit.
                if last is not None and last["commit"]:
                    continue
                cfg = repo_skills_config_on_disk(folder)
                account = {
                    **NOTHING_HELD,
                    "held": apply_aliases(held_in_folder(folder, skill_dirs_for(cfg)), cfg.aliases),
                }
                if cfg.aliases:
                    account["aliases"] = dict(cfg.aliases)
            accounts[root] = account
            entry["renames"] = {**entry["renames"], **account["renames"]}
        entry["accounts"] = accounts
        entry["storage"] = storage
        entry["missing"] = missing
        # the newest of them; and an entry all the same for a project no folder ever spoke
        # for, so that a reader knows this was looked for (shallow-copied so observed sizes
        # do not mutate the cached per-checkout account dict)
        winner = newest_inventory(list(accounts.values()))
        entry["skills"] = dict(winner) if winner is not None else dict(NOTHING_HELD)
    return projects, names


def _gone(root: str, storage: dict, missing: dict, now: datetime | None) -> bool:
    """Whether a folder that is not there speaks for its project no more.

    It does not once it was removed: what it was kept on when it was last read is there, and
    it is not. That is not known where nothing was recorded of it (an account an earlier
    botcore wrote), or where what it was on is away too: then it may only be away, and it
    keeps speaking, from when it was first found missing, for `GONE_AFTER`. Past that a
    volume has been away so long that what it held says little of the project now, and a
    folder nothing was recorded of is taken as removed.
    """
    kept_on = storage.get(root)
    if kept_on is not None and storage_there(kept_on):
        return True
    now = now or datetime.now(UTC)
    since = _parse(missing.get(root))
    if since is None:
        missing[root] = now.isoformat()
        return False
    return now - since > GONE_AFTER


def _read_t3(
    path: Path, since: str | None, all_items: bool = False, natives: bool = False
) -> t3.T3Read:
    doing("reading T3 Code's store", path)
    connection = t3.open_store(path)
    try:
        with t3.progress(connection, path):
            t3.check_schema(connection)
            return t3.read(
                connection,
                since=since,
                all_items=all_items,
                natives=natives,
                path=path,
                dirs_for_root=extra_skill_dirs_for_root,
            )
    except sqlite3.Error as exc:
        raise t3.StoreUnreadable(str(exc)) from exc
    finally:
        connection.close()


# What an event's id begins with, by the source it was read from
PREFIXES = {t3.SOURCE: "t3", claude_code.SOURCE: "cc"}


def _events(  # noqa: PLR0913 - one source's loads and what names them
    loads: list[t3.Load], source: str, names: dict[str, str], projects: dict, machine: str,
    known: set[tuple[str, str]], external_skills: set[str] | None = None,
) -> list[Event]:  # fmt: skip
    """A source's loads as events. A typed name is kept only when it is a skill: the record
    already knows it, this read shows it loaded another way, the project's checkout holds it,
    or a personal/external skill folder holds it."""
    events: list[Event] = []
    for load in loads:
        events.append(
            Event(
                id=f"{PREFIXES[source]}:{load.skill}@{load.item}",
                at=load.at,
                skill=load.skill,
                path=load.path,
                harness=load.harness,
                source=source,
                thread=load.thread,
                root=load.root,
                agent=load.agent,
                project=names.get(load.project_id or "", UNKNOWN_PROJECT),
                machine=machine,
                model=load.model,
                native=load.native,
            )
        )
    loaded = known | {(event.project, event.skill) for event in events if event.path != TYPED}
    ext = external_skills or set()
    root_dirs: dict[str, tuple[str, ...]] = {}

    def dirs_of(root: str) -> tuple[str, ...]:
        if root not in root_dirs:
            root_dirs[root] = skill_dirs_for(repo_skills_config_on_disk(Path(root)))
        return root_dirs[root]

    def is_skill(event: Event) -> bool:
        if (event.project, event.skill) in loaded or event.skill in ext:
            return True
        roots = _strings(_mapping(projects.get(event.project)).get("roots"))
        return any(skill_on_disk(root, event.skill, dirs_of(root)) for root in roots)

    return [event for event in events if event.path != TYPED or is_skill(event)]


def _failure(code: str, message: str, suggestion: str) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion)


def _item(event: Event) -> str | None:
    """The store's id for the item an event was recognised in."""
    return event.id.partition("@")[2] or None


def settings_refused(exc: Exception) -> CommandResult[dict]:
    """The refusal for machine settings that cannot say this machine's name or shared folder."""
    if isinstance(exc, InvalidMachine):
        message = str(exc)
        if "skill_usage_dirs" in message or "BOTCORE_SKILL_USAGE_USER_DIRS" in message:
            return _failure(
                "INVALID_INPUT",
                message,
                "Set skill_usage_dirs in the machine settings (or BOTCORE_SKILL_USAGE_USER_DIRS) "
                "to full paths with no '..' segments or NUL bytes",
            )
        return _failure(
            "INVALID_INPUT", message,
            "Set skill_usage_machine (for example macbook-air) and skill_usage_shared (a "
            "full path) in the machine settings, or BOTCORE_SKILL_USAGE_MACHINE and "
            "BOTCORE_SKILL_USAGE_SHARED",
        )  # fmt: skip
    return _failure(
        "MACHINE_SETTINGS_INVALID", f"The machine settings could not be read: {exc}",
        "Fix the file it names, or move it aside: they say this machine's name and its "
        "shared folder",
    )  # fmt: skip


def _published(result: CommandResult[dict], directory: Path, here: Local) -> CommandResult[dict]:
    """A collection's result, after this machine's record went to the shared folder. A
    shared folder that cannot be written does not undo the collection: the record here is
    whole, and the next collection writes it there."""
    if not result.success or here.shared is None or result.data is None:
        return result
    doing(SHARING, here.shared)
    shared: dict = {"path": str(here.shared), "exists": here.shared.is_dir()}
    try:
        shared["written"] = publish(directory, here.shared, here.machine)
    except OSError as exc:
        shared["written"], shared["error"] = False, str(exc)
        result.reasoning = (
            f"{result.reasoning}. The shared folder could not be written ({exc}), so other "
            "machines do not see this collection yet"
        )
    result.data["shared"] = shared
    return result


async def skill_usage_collect(  # noqa: PLR0911 - one refusal per way a source can fail
    since_days: int | None = None, t3_store: str | None = None, machine: str | None = None,
    rebuild: bool = False,
) -> CommandResult[dict]:  # fmt: skip
    """Add the skill loads recorded since the last collection to this machine's record.

    Reads T3 Code's store (Claude and Codex threads alike) and, for the sessions T3 Code did
    not run, Claude Code's transcripts; both read-only. It continues from the last
    collection of the store and reads everything again once a week, since a thread moved to
    this machine can be older than the last collection; of the transcripts it opens only
    those that changed.

    Args:
        since_days: Re-read this many days of T3 Code's store instead of continuing from the
            last collection of it.
        t3_store: Read this T3 Code store instead of this machine's; needs `machine`.
        machine: The machine a store named with `t3_store` came from.
        rebuild: Read everything and replace what was recognised before in items the store
            still holds, after an upgrade changed what counts as a load. Events whose items
            the store no longer holds are kept.
    """
    if since_days is not None and not 0 <= since_days <= 3660:
        return _failure(
            "INVALID_INPUT", "since_days must be between 0 and 3660",
            "Pass a number of days to re-read, or leave it out to continue from the last "
            "collection",
        )  # fmt: skip
    if t3_store is not None and not machine:
        return _failure(
            "INVALID_INPUT", "A store named with t3_store needs the machine it came from",
            "Pass machine with the name of the machine the store was copied from, or leave "
            "t3_store out to read this machine's own store",
        )  # fmt: skip

    def _run_collect() -> CommandResult[dict]:  # noqa: PLR0911
        try:
            here = local()
            resolved_machine = checked_machine(machine) if machine else here.machine
        except (SettingsError, InvalidMachine) as exc:
            return settings_refused(exc)
        directory = state_dir()
        path = Path(t3_store).expanduser() if t3_store is not None else t3_store_path()
        absent: list[dict] = []
        if path is None:
            absent.append({"source": t3.SOURCE, "status": "off"})
        elif not path.is_file():
            if t3_store is not None:
                return _failure(
                    "SOURCE_NOT_FOUND", f"No T3 Code store at {path}",
                    "Pass the path of statev2.sqlite in T3 Code's user data folder, or leave "
                    "t3_store out to read this machine's",
                )  # fmt: skip
            absent.append({"source": t3.SOURCE, "status": "absent", "path": str(path)})
            path = None
        # a store copied from another machine is read alone: these transcripts are not its own
        transcripts = None if t3_store is not None else claude_code.projects_dir()
        if transcripts is None and t3_store is None:
            absent.append({"source": claude_code.SOURCE, "status": "off"})
        elif transcripts is not None and not transcripts.is_dir():
            absent.append(
                {"source": claude_code.SOURCE, "status": "absent", "path": str(transcripts)}
            )
            transcripts = None
        if path is None and transcripts is None:
            return success(
                {
                    "machine": resolved_machine,
                    "state_dir": str(directory),
                    "added": 0,
                    "sources": absent,
                },
                reasoning="This machine has neither a T3 Code store nor Claude Code transcripts "
                "to read; nothing was collected",
            )
        try:
            with RunLock(directory / LOCK_FILE):
                result = _collect(
                    directory,
                    path,
                    transcripts,
                    since_days,
                    resolved_machine,
                    rebuild,
                    here.machine,
                    user_dirs=() if t3_store is not None else here.skill_dirs,
                    scan_user_dirs=t3_store is None,
                )
                if result.success and result.data is not None:
                    result.data["sources"] += absent
                return _published(result, directory, here)
        except LockHeld:
            return _failure(
                "COLLECT_RUNNING", "Another skill-usage-collect is running on this machine",
                "Run it again in a moment; the scheduled collection may be under way",
            )  # fmt: skip
        except t3.SchemaChanged as exc:
            return _failure(
                "SOURCE_SCHEMA_CHANGED", f"T3 Code's store no longer has {', '.join(exc.missing)}",
                "This botcore cannot read this T3 Code release's store: update botcore. Nothing "
                "was collected, and what was collected before is kept",
            )  # fmt: skip
        except t3.StoreUnreadable as exc:
            return _failure(
                "SOURCE_UNREADABLE", f"T3 Code's store at {path} could not be read: {exc}",
                "Run it again: T3 Code may have been writing. If it keeps failing, check that "
                "the file can be read by this user",
            )  # fmt: skip
        except OSError as exc:
            return _failure(
                "RECORD_UNAVAILABLE",
                f"The skill usage record in {directory} could not be used: {exc}",
                "Check that it is a folder this user can write, or set BOTCORE_SKILL_USAGE_STATE "
                "to one that is",
            )

    return await run_blocking(_run_collect)


def _collect(  # noqa: C901, PLR0912, PLR0913, PLR0915 - one collection, start to end
    directory: Path, path: Path | None, transcripts: Path | None, since_days: int | None,
    machine: str, rebuild: bool, this_machine: str, user_dirs: tuple[Path, ...] = (),
    scan_user_dirs: bool = True,
) -> CommandResult[dict]:  # fmt: skip
    stored, unreadable = load_events(directory)
    state = load_state(directory)
    sessions = load_sessions(directory)  # before anything is written: a damaged file refuses
    now = datetime.now(UTC)
    sources = _mapping(state.get("sources"))
    stores = _mapping(_mapping(sources.get(t3.SOURCE)).get("stores"))
    read_sources: list[dict] = []

    found, since = t3.T3Read(), None
    if path is not None:
        last = _mapping(stores.get(str(path)))  # a store never read before starts from nothing
        full_at = _parse(last.get("full_at"))
        newest = _parse(last.get("newest"))
        if rebuild:
            since = None
        elif since_days is not None:
            since = _stamp(now - timedelta(days=since_days))
        elif full_at is None or newest is None or now - full_at > FULL_EVERY:
            since = None
        else:
            since = _stamp(newest - OVERLAP)
        wanted = transcripts is not None  # what T3 Code holds, from the snapshot of its loads
        found = _read_t3(path, since, all_items=rebuild, natives=wanted)
        if since is not None and any(session_id not in sessions for session_id in found.behind):
            # a session this record has never seen, with work older than the last collection,
            # was moved to this machine: what it did before is behind where this read began
            since = None
            found = _read_t3(path, since, all_items=rebuild, natives=wanted)
        stores[str(path)] = {
            "newest": found.newest or last.get("newest"),
            "full_at": _stamp(now) if since is None else last.get("full_at"),
        }

    known_ids = {event.id for event in stored}
    known_skills = {(event.project, event.skill) for event in stored}
    claude = claude_code.ClaudeRead()
    if transcripts is not None:
        seen = _mapping(_mapping(sources.get(claude_code.SOURCE)).get("files"))
        # a call T3 Code recorded is T3 Code's, whether its store still holds it or only the
        # record does: the thread may have been dropped since
        recorded = {
            event.native.partition(":")[2]
            for event in stored
            if event.source == t3.SOURCE and event.native and event.harness == claude_code.HARNESS
        }
        doing("reading Claude Code's transcripts in", transcripts)
        claude = claude_code.read(
            transcripts,
            seen,
            found.natives | recorded,
            everything=rebuild,
            dirs_for_root=extra_skill_dirs_for_root,
        )

    refiled: dict[str, str] = {}
    previous_projects = _mapping(state.get("projects"))
    inv_version = state.get("inventory_version")
    refresh_inventory = rebuild or type(inv_version) is not int or inv_version < INVENTORY_VERSION
    projects, names = _name_projects(
        previous_projects,
        {**found.projects, **claude.projects},
        again=refresh_inventory,
        now=now,
        refiled=refiled,
    )
    refiled_events = False
    if refiled:
        for old_name, target_name in refiled.items():
            old_prev = _mapping(previous_projects.get(old_name))
            old_obs = _mapping(old_prev.get("observed_files"))
            if old_obs and target_name in projects:
                projects[target_name].setdefault("observed_files", {}).update(old_obs)
        updated_stored: list[Event] = []
        for event in stored:
            target = refiled.get(event.project)
            if target is not None:
                updated_stored.append(dataclasses.replace(event, project=target))
                refiled_events = True
            else:
                updated_stored.append(event)
        stored = updated_stored
        for entry in sessions.values():
            target = refiled.get(entry.get("project") or "")
            if target is not None:
                entry["project"] = target
        known_skills = {(event.project, event.skill) for event in stored}
    # A session stays in the project it was filed under: its checkout may have been moved
    # or removed since, and where it ran is not where its folder leads today
    claude_items: list[t3.Load | t3.Session] = [*claude.loads, *claude.sessions]
    for item in claude_items:
        thread = item.thread if isinstance(item, t3.Load) else item.id
        filed = _mapping(sessions.get(thread)).get("project")
        if item.project_id is None and isinstance(filed, str) and filed != UNKNOWN_PROJECT:
            item.project_id = f"filed:{thread}"
            names[item.project_id] = filed
    # Record where loaded skill files live (outside configured project skill folders) and
    # scan personal/external skill folders so their sizes and quiet list are available too
    all_loads = [
        (names.get(load.project_id or "", UNKNOWN_PROJECT), load)
        for load in [*found.loads, *claude.loads]
    ]
    external = update_external_and_observed(
        loads=all_loads,
        projects=projects,
        previous_projects=previous_projects,
        previous_external=_mapping(state.get("external")),
        user_dirs=user_dirs,
        scan_user_dirs=scan_user_dirs,
        facts_fn=_facts,
        storage_of_fn=storage_of,
        gone_fn=_gone,
        now=now,
    )
    external_skill_names = set(_mapping(external.get("held"))) | set(
        _mapping(external.get("observed"))
    )
    from_t3 = _events(
        found.loads, t3.SOURCE, names, projects, machine, known_skills, external_skill_names
    )
    # a skill that T3 Code's sessions loaded in this very read is a skill to a command typed
    # elsewhere
    loaded = known_skills | {(e.project, e.skill) for e in from_t3 if e.path != TYPED}
    # a load T3 Code's store shows too is one load, and T3 Code's event stands: whenever its
    # store came to hold the call, and whether or not the transcript was read again since
    shown = {
        event.native for event in [*stored, *from_t3] if event.native and event.source == t3.SOURCE
    }
    fresh: dict[str, Event] = {}
    for event in _events(
        claude.loads, claude_code.SOURCE, names, projects, machine, loaded, external_skill_names
    ):
        if event.native not in shown:
            fresh.setdefault(event.id, event)  # once, however many transcripts hold the call
    from_claude = list(fresh.values())
    events = [*from_t3, *from_claude]
    read_now = {event.id for event in events}

    def gone(event: Event) -> bool:
        """What was read again and is no longer a load. An event leaves the record only
        when what it was read from was in front of this collection and did not give it
        again: an item the store has dropped, a call whose file is gone or no longer holds
        it, stays. For T3 Code's store that is a rebuild; a transcript is read whole each
        time, so a call that has become T3 Code's, or changed, goes at once."""
        if event.id in read_now:
            return False
        if event.source == t3.SOURCE:
            return rebuild and path is not None and _item(event) in (found.items or set())
        if event.source == claude_code.SOURCE:
            return _item(event) in claude.seen or event.native in shown
        return False

    dropped = [event for event in stored if gone(event)]
    added = [event for event in events if event.id not in known_ids]
    # everything is read: from here the record is written, events, sessions, then state.
    # A collection the job has left stops before the first of them, never between two.
    doing("writing this machine's record in", directory)
    if dropped or rebuild or refiled_events:
        lost = {event.id for event in dropped}
        kept = [event for event in stored if event.id not in lost]
        current = {event.id: event for event in events}
        kept = [current.pop(event.id, event) for event in kept]  # read again: the new reading
        preserved = unreadable_lines(directory) if (unreadable and not rebuild) else []
        rewrite_events(
            directory,
            sorted([*kept, *current.values()], key=lambda event: event.at),
            extra_lines=preserved,
        )
        total = len(kept) + len(current)
    else:
        append_events(directory, added)
        total = len(known_ids) + len(added)
    removed = {
        source: sum(event.source == source for event in dropped)
        for source in (t3.SOURCE, claude_code.SOURCE)
    }

    # a session met this time that is T3 Code's, and that no transcript gives, is not ours
    given = {name for entry in claude.files.values() for name in _strings(entry.get("sessions"))}
    for thread in claude.t3_sessions - given:
        sessions.pop(thread, None)
    for session in [*found.sessions, *claude.sessions]:
        sessions[session.id] = {
            "root": session.root,
            "parent": session.parent,
            "agent": session.agent,
            "harness": session.harness,
            "project": names.get(session.project_id or "", UNKNOWN_PROJECT),
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "pull_requests": [
                {"ref": reference, "linked_at": linked_at, "opened": opened}
                for reference, linked_at, opened in session.pull_requests
            ],
            "machine": machine,
        }
    save_sessions(directory, sessions)

    if transcripts is not None:
        sources = {**sources, claude_code.SOURCE: {"files": claude.files}}
    saved_state: dict = {
        "version": STATE_VERSION,
        "inventory_version": INVENTORY_VERSION,
        "machine": this_machine,
        # what tells this record from another machine's of the same name
        "record_id": state.get("record_id") or uuid.uuid4().hex,
        "collected_at": _stamp(now),
        # the rules every event still re-readable was recognised by: a rebuild, or a
        # record that began under them
        "recognizer": RECOGNIZER if rebuild or not stored else state.get("recognizer", 0),
        "sources": {**sources, t3.SOURCE: {"stores": stores}},
        "projects": projects,
    }
    if external:
        saved_state["external"] = external
    save_state(directory, saved_state)
    if path is not None:
        new = [event for event in added if event.source == t3.SOURCE]
        read_sources.append(
            {
                "source": t3.SOURCE,
                "status": "read",
                "path": str(path),
                "since": since,
                "scanned": found.scanned,
                "found": len(from_t3),
                "added": len(new),
            }
        )
        if rebuild:
            read_sources[-1]["removed"] = removed[t3.SOURCE]
    if transcripts is not None:
        new = [event for event in added if event.source == claude_code.SOURCE]
        read_sources.append(
            {
                "source": claude_code.SOURCE,
                "status": "read",
                "path": str(transcripts),
                "transcripts": claude.transcripts,
                "read": len(claude.read),
                "unchanged": claude.unchanged,
                "not_read": len(claude.failed),
                "calls_left_to_t3": claude.left_to_t3,
                "found": len(from_claude),
                "added": len(new),
                "removed": removed[claude_code.SOURCE],
            }
        )
    data: dict = {
        "machine": machine,
        "state_dir": str(directory),
        "sources": read_sources,
        "added": len(added),
        "events": total,
        "sessions": len(sessions),
    }
    edits = sum(event.path == EDIT for event in added)
    data["loads_added"], data["edits_added"] = len(added) - edits, edits
    reasoning = (
        f"Added {len(added) - edits} skill loads and {edits} changes to skill files; this "
        f"machine's record now holds {total} events"
    )
    if rebuild:
        data["removed"] = sum(removed.values())
        reasoning = (
            f"Rebuilt the record: {len(added)} events added and {data['removed']} no longer "
            f"recognised removed; it now holds {total}"
        )
    return success(data, reasoning=reasoning)
