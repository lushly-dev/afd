"""`skill-usage-collect`: copy new skill loads from what the harnesses record into this
machine's record.

Nothing is added to a skill and no agent reports anything: the loads are read from records the
harnesses already keep. Running it again adds only what is new.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.disk.lock import LockHeld, RunLock
from botcore.commands.disk.settings import SettingsError
from botcore.commands.disk.steps import doing
from botcore.commands.skill_usage import claude_code, t3
from botcore.commands.skill_usage.events import EDIT, RECOGNIZER, TYPED, Event
from botcore.commands.skill_usage.store import (
    LOCK_FILE,
    SHARING,
    InvalidMachine,
    Local,
    append_events,
    checked_machine,
    load_events,
    load_sessions,
    load_state,
    local,
    publish,
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


def _strings(value: object) -> list[str]:
    return [entry for entry in value if isinstance(entry, str)] if isinstance(value, list) else []


def _renames(value: object) -> dict[str, str]:
    return {
        old: new
        for old, new in _mapping(value).items()
        if isinstance(old, str) and isinstance(new, str)
    }


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
    projects = {
        name: {
            "remote": bool(entry.get("remote")),
            "roots": _strings(entry.get("roots")),
            "renames": _renames(entry.get("renames")),
        }
        for name, entry in previous.items()
        if isinstance(name, str) and isinstance(entry, dict)
    }
    by_root = {root: name for name, entry in projects.items() for root in entry["roots"]}
    names: dict[str, str] = {}
    for project_id, root in roots.items():
        name = by_root.get(root)
        if name is None:
            folder = Path(root)
            remote = project_remote(folder) if folder.is_dir() else None
            # a store copied from another system writes its folders that system's way: the
            # last part by either separator, never the whole path
            name = remote or re.split(r"[\\/]+", root.rstrip("\\/"))[-1] or project_id
            if not remote and name in projects and not projects[name].get("remote"):
                name = f"{name}~{hashlib.sha256(root.encode()).hexdigest()[:6]}"
            entry = projects.setdefault(name, {"remote": bool(remote), "roots": [], "renames": {}})
            entry["roots"] = [*entry["roots"], root]
            by_root[root] = name
        names[project_id] = name
    for entry in projects.values():
        for root in entry["roots"]:
            if Path(root).is_dir():
                renames = skill_renames(Path(root))
                if renames is not None:
                    entry["renames"] = {**entry["renames"], **renames}
    return projects, names


def _read_t3(
    path: Path, since: str | None, all_items: bool = False, natives: bool = False
) -> t3.T3Read:
    doing("reading T3 Code's store", path)
    connection = t3.open_store(path)
    try:
        t3.check_schema(connection)
        return t3.read(connection, since=since, all_items=all_items, natives=natives)
    except sqlite3.Error as exc:
        raise t3.StoreUnreadable(str(exc)) from exc
    finally:
        connection.close()


# What an event's id begins with, by the source it was read from
PREFIXES = {t3.SOURCE: "t3", claude_code.SOURCE: "cc"}


def _events(  # noqa: PLR0913 - one source's loads and what names them
    loads: list[t3.Load], source: str, names: dict[str, str], projects: dict, machine: str,
    known: set[tuple[str, str]],
) -> list[Event]:  # fmt: skip
    """A source's loads as events. A typed name is kept only when it is a skill: the record
    already knows it, this read shows it loaded another way, or the project's checkout holds
    it."""
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

    def is_skill(event: Event) -> bool:
        roots = _strings(_mapping(projects.get(event.project)).get("roots"))
        return (event.project, event.skill) in loaded or any(
            skill_on_disk(root, event.skill) for root in roots
        )

    return [event for event in events if event.path != TYPED or is_skill(event)]


def _failure(code: str, message: str, suggestion: str) -> CommandResult[dict]:
    return error(code, message, suggestion=suggestion)


def _item(event: Event) -> str | None:
    """The store's id for the item an event was recognised in."""
    return event.id.partition("@")[2] or None


def settings_refused(exc: Exception) -> CommandResult[dict]:
    """The refusal for machine settings that cannot say this machine's name or shared folder."""
    if isinstance(exc, InvalidMachine):
        return _failure(
            "INVALID_INPUT", str(exc),
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
    try:
        here = local()
        machine = checked_machine(machine) if machine else here.machine
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
        absent.append({"source": claude_code.SOURCE, "status": "absent", "path": str(transcripts)})
        transcripts = None
    if path is None and transcripts is None:
        return success(
            {"machine": machine, "state_dir": str(directory), "added": 0, "sources": absent},
            reasoning="This machine has neither a T3 Code store nor Claude Code transcripts "
            "to read; nothing was collected",
        )
    try:
        with RunLock(directory / LOCK_FILE):
            result = _collect(
                directory, path, transcripts, since_days, machine, rebuild, here.machine
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
            "RECORD_UNAVAILABLE", f"The skill usage record in {directory} could not be used: {exc}",
            "Check that it is a folder this user can write, or set BOTCORE_SKILL_USAGE_STATE "
            "to one that is",
        )  # fmt: skip


def _collect(  # noqa: C901, PLR0912, PLR0913, PLR0915 - one collection, start to end
    directory: Path, path: Path | None, transcripts: Path | None, since_days: int | None,
    machine: str, rebuild: bool, this_machine: str,
) -> CommandResult[dict]:  # fmt: skip
    stored, _ = load_events(directory)
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
        claude = claude_code.read(transcripts, seen, found.natives | recorded, everything=rebuild)

    projects, names = _name_projects(
        _mapping(state.get("projects")), {**found.projects, **claude.projects}
    )
    # A session stays in the project it was filed under: its checkout may have been moved
    # or removed since, and where it ran is not where its folder leads today
    for item in [*claude.loads, *claude.sessions]:
        thread = item.thread if isinstance(item, t3.Load) else item.id
        filed = _mapping(sessions.get(thread)).get("project")
        if item.project_id is None and isinstance(filed, str) and filed != UNKNOWN_PROJECT:
            item.project_id = f"filed:{thread}"
            names[item.project_id] = filed
    from_t3 = _events(found.loads, t3.SOURCE, names, projects, machine, known_skills)
    # a skill that T3 Code's sessions loaded in this very read is a skill to a command typed
    # elsewhere
    loaded = known_skills | {(e.project, e.skill) for e in from_t3 if e.path != TYPED}
    # a load T3 Code's store shows too is one load, and T3 Code's event stands: whenever its
    # store came to hold the call, and whether or not the transcript was read again since
    shown = {
        event.native for event in [*stored, *from_t3] if event.native and event.source == t3.SOURCE
    }
    fresh: dict[str, Event] = {}
    for event in _events(claude.loads, claude_code.SOURCE, names, projects, machine, loaded):
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
    if dropped or rebuild:
        lost = {event.id for event in dropped}
        kept = [event for event in stored if event.id not in lost]
        current = {event.id: event for event in events}
        kept = [current.pop(event.id, event) for event in kept]  # read again: the new reading
        rewrite_events(directory, sorted([*kept, *current.values()], key=lambda event: event.at))
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
    save_state(
        directory,
        {
            "version": STATE_VERSION,
            "machine": this_machine,
            # what tells this record from another machine's of the same name
            "record_id": state.get("record_id") or uuid.uuid4().hex,
            "collected_at": _stamp(now),
            # the rules every event still re-readable was recognised by: a rebuild, or a
            # record that began under them
            "recognizer": RECOGNIZER if rebuild or not stored else state.get("recognizer", 0),
            "sources": {**sources, t3.SOURCE: {"stores": stores}},
            "projects": projects,
        },
    )
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
