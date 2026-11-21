"""`skill-usage-collect`: copy new skill loads from what the harnesses record into this
machine's record.

Nothing is added to a skill and no agent reports anything: the loads are read from records the
harnesses already keep. Running it again adds only what is new.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.lock import LockHeld, RunLock
from botcore.commands.skill_usage import t3
from botcore.commands.skill_usage.events import TYPED, Event
from botcore.commands.skill_usage.store import (
    LOCK_FILE,
    append_events,
    load_events,
    load_sessions,
    load_state,
    machine_name,
    rewrite_events,
    save_sessions,
    save_state,
    state_dir,
    t3_store_path,
)

STATE_VERSION = 1
OVERLAP = timedelta(days=1)  # re-read this much, for items a harness finished writing late
FULL_EVERY = timedelta(days=7)  # then read everything: a thread moved here can be older
GIT_SECONDS = 30.0
SKILL_DIRS = (".claude/skills", ".agents/skills", ".codex/skills")
UNKNOWN_PROJECT = "unknown"
_PATHSPECS = tuple(f":(glob){folder}/*/SKILL.md" for folder in SKILL_DIRS)
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


def skill_on_disk(root: str, name: str) -> bool:
    """Whether a checkout holds a skill of this name."""
    return any((Path(root) / folder / name / "SKILL.md").is_file() for folder in SKILL_DIRS)


def skill_renames(root: Path) -> dict[str, str] | None:
    """Old skill name to new, from the renames in a checkout's history; None when git cannot
    say. A skill folder renamed in one commit keeps one identity in the report this way, with
    nothing to configure. The history read is the checkout's own (`HEAD`), the one whose
    files the report lists, so a rename is known as soon as the checkout has it."""
    try:
        text = git_out(
            root, "log", "HEAD", "--diff-filter=R", "-M50%", "--name-status", "--format=",
            "--", *_PATHSPECS, timeout=GIT_SECONDS,
        )  # fmt: skip
    except GitError:
        return None
    renames: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) != 3 or not parts[0].startswith("R"):
            continue
        old, new = (Path(part).parent.name for part in parts[1:])
        if old != new:
            renames.setdefault(old, new)  # newest first: the latest rename of a name wins
    return renames


def project_remote(root: Path) -> str | None:
    """`owner/name` from a checkout's origin: the same on every machine and for every clone."""
    try:
        url = git_out(root, "remote", "get-url", "origin", timeout=GIT_SECONDS).strip()
    except GitError:
        return None
    match = _REMOTE.search(url)
    return match.group(1) if match else None


def _name_projects(previous: dict, roots: dict[str, str]) -> tuple[dict, dict[str, str]]:
    """Name each workspace root, and return the projects to keep with project id to name.

    A project is named after its origin, so two clones are one project and the name is the
    same on every machine. One with no origin takes its folder's name, and a second folder of
    that name with no origin gets a suffix, so two unrelated projects never share counts.
    """
    projects = {name: dict(entry) for name, entry in previous.items() if isinstance(entry, dict)}
    by_root = {
        root: name for name, entry in projects.items() for root in _mapping(entry).get("roots", [])
    }
    names: dict[str, str] = {}
    for project_id, root in roots.items():
        name = by_root.get(root)
        if name is None:
            folder = Path(root)
            remote = project_remote(folder) if folder.is_dir() else None
            name = remote or folder.name or project_id
            if not remote and name in projects and not projects[name].get("remote"):
                name = f"{name}~{hashlib.sha256(root.encode()).hexdigest()[:6]}"
            entry = projects.setdefault(name, {"remote": bool(remote), "roots": []})
            entry["roots"] = [*entry.get("roots", []), root]
            by_root[root] = name
        names[project_id] = name
    for entry in projects.values():
        for root in entry.get("roots", []):
            if Path(root).is_dir():
                renames = skill_renames(Path(root))
                if renames is not None:
                    entry["renames"] = {**_mapping(entry.get("renames")), **renames}
    return projects, names


def _read_t3(path: Path, since: str | None, all_items: bool = False) -> t3.T3Read:
    connection = t3.open_store(path)
    try:
        t3.check_schema(connection)
        return t3.read(connection, since=since, all_items=all_items)
    except sqlite3.Error as exc:
        raise t3.StoreUnreadable(str(exc)) from exc
    finally:
        connection.close()


def _events(
    found: t3.T3Read, names: dict[str, str], projects: dict, machine: str,
    known: set[tuple[str, str]],
) -> list[Event]:  # fmt: skip
    """The loads as events. A typed name is kept only when it is a skill: the record already
    knows it, this read shows it loaded another way, or the project's checkout holds it."""
    events: list[Event] = []
    for load in found.loads:
        events.append(
            Event(
                id=f"t3:{load.skill}@{load.item}",
                at=load.at,
                skill=load.skill,
                path=load.path,
                harness=load.harness,
                source=t3.SOURCE,
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

    def is_skill(event: Event) -> bool:
        roots = _mapping(projects.get(event.project)).get("roots", [])
        return (event.project, event.skill) in loaded or any(
            skill_on_disk(root, event.skill) for root in roots
        )

    return [event for event in events if event.path != TYPED or is_skill(event)]


def _failure(code: str, message: str, suggestion: str) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion)


def _item(event: Event) -> str | None:
    """The store's id for the item an event was recognised in."""
    return event.id.partition("@")[2] or None


async def skill_usage_collect(  # noqa: PLR0911 - one refusal per way a source can fail
    since_days: int | None = None, t3_store: str | None = None, machine: str | None = None,
    rebuild: bool = False,
) -> CommandResult[dict]:  # fmt: skip
    """Add the skill loads recorded since the last collection to this machine's record.

    Reads T3 Code's store (Claude and Codex threads alike), read-only. It continues from the
    last collection of that store and reads everything again once a week, since a thread
    moved to this machine can be older than the last collection.

    Args:
        since_days: Re-read this many days instead of continuing from the last collection.
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
    directory = state_dir()
    path = Path(t3_store).expanduser() if t3_store is not None else t3_store_path()
    if path is None:
        return success(
            {"machine": machine or machine_name(), "state_dir": str(directory), "added": 0,
             "sources": [{"source": t3.SOURCE, "status": "off"}]},
            reasoning="T3 Code's store is turned off for this machine; nothing was read",
        )  # fmt: skip
    if not path.is_file():
        if t3_store is not None:
            return _failure(
                "SOURCE_NOT_FOUND", f"No T3 Code store at {path}",
                "Pass the path of statev2.sqlite in T3 Code's user data folder, or leave "
                "t3_store out to read this machine's",
            )  # fmt: skip
        return success(
            {"machine": machine or machine_name(), "state_dir": str(directory), "added": 0,
             "sources": [{"source": t3.SOURCE, "status": "absent", "path": str(path)}]},
            reasoning=f"This machine has no T3 Code store at {path}; nothing was read",
        )  # fmt: skip
    try:
        with RunLock(directory / LOCK_FILE):
            return _collect(directory, path, since_days, machine or machine_name(), rebuild)
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
            "RECORD_UNAVAILABLE", f"The skill usage record in {directory} could not be used: {exc}",
            "Check that it is a folder this user can write, or set BOTCORE_SKILL_USAGE_STATE "
            "to one that is",
        )  # fmt: skip


def _collect(
    directory: Path, path: Path, since_days: int | None, machine: str, rebuild: bool,
) -> CommandResult[dict]:  # fmt: skip
    stored, _ = load_events(directory)
    state = load_state(directory)
    now = datetime.now(UTC)
    sources = _mapping(state.get("sources"))
    stores = _mapping(_mapping(sources.get(t3.SOURCE)).get("stores"))
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

    found = _read_t3(path, since, all_items=rebuild)
    projects, names = _name_projects(_mapping(state.get("projects")), found.projects)
    known_ids = {event.id for event in stored}
    known_skills = {(event.project, event.skill) for event in stored}
    events = _events(found, names, projects, machine, known_skills)
    added = [event for event in events if event.id not in known_ids]
    removed = 0
    if rebuild:
        held = found.items or set()
        kept = [event for event in stored if event.source != t3.SOURCE or _item(event) not in held]
        removed = len(stored) - len(kept) - (len(events) - len(added))
        rewrite_events(directory, sorted(kept + events, key=lambda event: event.at))
        total = len(kept) + len(events)
    else:
        append_events(directory, added)
        total = len(known_ids) + len(added)

    sessions = load_sessions(directory)
    for session in found.sessions:
        sessions[session.id] = {
            "root": session.root,
            "agent": session.agent,
            "harness": session.harness,
            "project": names.get(session.project_id or "", UNKNOWN_PROJECT),
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "pull_requests": list(session.pull_requests),
            "machine": machine,
        }
    save_sessions(directory, sessions)

    stores[str(path)] = {
        "newest": found.newest or last.get("newest"),
        "full_at": _stamp(now) if since is None else last.get("full_at"),
    }
    save_state(
        directory,
        {
            "version": STATE_VERSION,
            "machine": machine_name(),
            "collected_at": _stamp(now),
            "sources": {**sources, t3.SOURCE: {"stores": stores}},
            "projects": projects,
        },
    )
    source: dict = {
        "source": t3.SOURCE,
        "status": "read",
        "path": str(path),
        "since": since,
        "scanned": found.scanned,
        "found": len(events),
        "added": len(added),
    }
    data: dict = {
        "machine": machine,
        "state_dir": str(directory),
        "sources": [source],
        "added": len(added),
        "events": total,
        "sessions": len(sessions),
    }
    reasoning = f"Added {len(added)} skill loads; this machine's record now holds {total}"
    if rebuild:
        source["removed"] = data["removed"] = removed
        reasoning = (
            f"Rebuilt the record: {len(added)} loads added and {removed} no longer recognised "
            f"removed; it now holds {total}"
        )
    return success(data, reasoning=reasoning)
