"""This machine's record of skill loads: where it lives, and reading and writing it.

Events are appended to `events.jsonl`, one per line, and never rewritten. Collection is what
makes the record durable: a harness may compact or delete what it recorded, and a load already
collected stays here. `state.json` holds what the next collection needs.

A machine may name a shared folder, one every machine can see. Collection then also writes
this machine's record to a folder of its own there, and a report reads every machine's.
Botcore does not sync the folder.
"""

from __future__ import annotations

import errno
import hashlib
import json
import os
import platform
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from botcore.commands.disk.settings import expand, load_machine_settings
from botcore.commands.disk.steps import doing
from botcore.commands.skill_usage.events import Event, clean_skill_name, is_skill_folder

STATE_ENV = "BOTCORE_SKILL_USAGE_STATE"
T3_STORE_ENV = "BOTCORE_SKILL_USAGE_T3_STORE"
MACHINE_ENV = "BOTCORE_SKILL_USAGE_MACHINE"
SHARED_ENV = "BOTCORE_SKILL_USAGE_SHARED"
AWAY_ENV = "BOTCORE_SKILL_USAGE_AWAY"
USER_DIRS_ENV = "BOTCORE_SKILL_USAGE_USER_DIRS"
TAIL = 1 << 16  # more than any event's line
EVENTS_FILE = "events.jsonl"
STATE_FILE = "state.json"
SESSIONS_FILE = "sessions.json"
RECORD_FILES = (EVENTS_FILE, STATE_FILE, SESSIONS_FILE)
LOCK_FILE = "collect.lock"


def state_dir() -> Path:
    """Where the events and the state file live; BOTCORE_SKILL_USAGE_STATE overrides it."""
    override = os.environ.get(STATE_ENV)
    if override:
        return Path(override)
    home = Path.home()
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
    else:
        base = Path(os.environ.get("XDG_STATE_HOME") or home / ".local" / "state")
    return base / "botcore" / "skill-usage"


def t3_store_path() -> Path | None:
    """T3 Code's store on this machine. BOTCORE_SKILL_USAGE_T3_STORE overrides it, and an
    empty value turns the source off."""
    override = os.environ.get(T3_STORE_ENV)
    if override is not None:
        return Path(override).expanduser() if override else None
    return Path.home() / ".t3" / "userdata" / "statev2.sqlite"


class InvalidMachine(ValueError):
    """What a machine says of itself cannot be used: a name that cannot be a folder's, or a
    shared folder that is not a full path."""


# A machine's name is a folder's name on every system: lower case, since a shared drive
# does not tell Bench from bench; no name Windows keeps for a device; no trailing dot
_MACHINE = re.compile(r"[a-z0-9][a-z0-9._-]{0,62}")
_DEVICES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"{port}{n}" for port in ("com", "lpt") for n in range(10)),
}


def checked_machine(name: str) -> str:
    """A machine's name as the record writes it, refused unless it can name a folder."""
    lowered = name.lower()
    if (
        not _MACHINE.fullmatch(lowered)
        or lowered.endswith(".")
        or lowered.split(".")[0] in _DEVICES
    ):
        raise InvalidMachine(
            f"{name!r} cannot name a machine: use letters, digits, dots, hyphens and "
            "underscores, starting with a letter or digit, at most 63, and no device name"
        )
    return lowered


def default_machine() -> str:
    """This machine's hostname, made fit to be its name."""
    host = platform.node().split(".")[0].lower()
    name = re.sub(r"[^a-z0-9._-]+", "-", host).strip("-._")[:63]
    try:
        return checked_machine(name)
    except InvalidMachine:
        return "unknown"


def _default_user_skill_dirs() -> list[Path]:
    """A person's own skill folders outside any project."""
    base = os.environ.get("CLAUDE_CONFIG_DIR")
    claude_skills = (Path(base).expanduser() if base else Path.home() / ".claude") / "skills"
    return [claude_skills, Path.home() / ".agents" / "skills", Path.home() / ".codex" / "skills"]


@dataclass
class Local:
    """What this machine says of itself."""

    machine: str  # its name in the record
    shared: Path | None  # the folder every machine can see, when one is named
    # The machines the owner says are switched off: not waited for before a miss is called
    away: frozenset[str] = frozenset()
    # Skill folders outside any project (personal folders and configured skill_usage_dirs)
    skill_dirs: tuple[Path, ...] = ()


def _checked_skill_dir(entry: str, setting_label: str) -> Path:
    """Validate an external skill folder path: no NUL bytes, no '..' traversal, must be absolute."""
    if "\x00" in entry:
        raise InvalidMachine(f"{setting_label} entries may not contain NUL bytes: {entry!r}")
    if ".." in Path(entry).parts:
        raise InvalidMachine(f"{setting_label} entries may not contain '..': {entry!r}")
    candidate = expand(entry)
    if "\x00" in str(candidate) or ".." in candidate.parts:
        raise InvalidMachine(f"{setting_label} entries may not contain '..' or NUL: {entry!r}")
    if not candidate.is_absolute():
        raise InvalidMachine(f"{setting_label} entries must be full paths, not {entry!r}")
    return candidate


def local() -> Local:
    """This machine's name, its shared folder, the machines it does not wait for and its
    personal/external skill folders: the environment first, then the machine settings, then
    defaults. Raises `SettingsError` when the machine settings cannot be read, and
    `InvalidMachine`."""
    name, shared = os.environ.get(MACHINE_ENV), os.environ.get(SHARED_ENV)
    listed = os.environ.get(AWAY_ENV)
    away = listed.split(",") if listed is not None else None
    user_dirs_env = os.environ.get(USER_DIRS_ENV)
    extra_user_dirs: list[str] = []
    if not name or shared is None or away is None or user_dirs_env is None:
        settings = load_machine_settings()[0]
        name = name or settings.skill_usage_machine
        shared = settings.skill_usage_shared or "" if shared is None else shared
        away = settings.skill_usage_away if away is None else away
        extra_user_dirs = settings.skill_usage_dirs
    folder = expand(shared) if shared else None
    if folder is not None and not folder.is_absolute():
        # a job does not run where a person does: a relative folder would be two folders
        raise InvalidMachine(f"The shared folder must be a full path, not {shared!r}")
    if user_dirs_env is not None:
        raw_dirs = [part.strip() for part in user_dirs_env.split(os.pathsep) if part.strip()]
        resolved_dirs = [_checked_skill_dir(entry, USER_DIRS_ENV) for entry in raw_dirs]
        skill_dirs = tuple(dict.fromkeys(resolved_dirs))
    else:
        resolved_dirs = list(_default_user_skill_dirs())
        for entry in extra_user_dirs:
            text = entry.strip()
            if not text:
                continue
            resolved_dirs.append(_checked_skill_dir(text, "skill_usage_dirs"))
        skill_dirs = tuple(dict.fromkeys(resolved_dirs))
    return Local(
        checked_machine(name) if name else default_machine(),
        folder,
        frozenset(checked_machine(other.strip()) for other in away if other.strip()),
        skill_dirs,
    )


def machine_name() -> str:
    """A short name for this machine: BOTCORE_SKILL_USAGE_MACHINE, the machine settings'
    `skill_usage_machine`, or its hostname."""
    return local().machine


def parse_events(data: bytes) -> tuple[list[Event], int]:
    """The events in the bytes of an events file, each id once, and how many lines could
    not be read."""
    events: dict[str, Event] = {}
    unreadable = 0
    for line in data.decode("utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            unreadable += 1
            continue
        event = Event.from_json(parsed) if isinstance(parsed, dict) else None
        if event is None:
            unreadable += 1
        elif event.id not in events:
            events[event.id] = event
    return list(events.values()), unreadable


def load_events(directory: Path) -> tuple[list[Event], int]:
    """Every stored event, each id once, and how many lines could not be read."""
    try:
        return parse_events((directory / EVENTS_FILE).read_bytes())
    except FileNotFoundError:
        return [], 0


def append_events(directory: Path, events: list[Event]) -> None:
    """Add events to the record. A repeated id is harmless: readers keep the first. A final
    line an interrupted write left unfinished is seen to first. One that stopped part way
    through an event is taken off: the collection that was writing it never saved where it
    had got to, so this one has read that event again, and a line that cannot be read would
    stop every report that must not miss a load. One that holds a whole event and lacks only
    its end is closed: that event is already known, and would not be collected again."""
    if not events:
        return
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / EVENTS_FILE).open("a+b") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        if size:
            handle.seek(max(0, size - TAIL))
            tail = handle.read()
            if not tail.endswith(b"\n"):
                kept = tail.rfind(b"\n") + 1  # 0 when the tail holds no whole line
                whole = parse_events(tail[kept:])[1] == 0
                if not whole and (kept or size <= TAIL):
                    handle.truncate(size - len(tail) + kept)
                else:  # a whole event, or a line longer than any event: not ours to drop
                    handle.write(b"\n")
        for event in events:
            handle.write((json.dumps(event.to_json(), sort_keys=True) + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())


def _replace(path: Path, text: str) -> None:
    """Write a file in one step, so a reader never sees half of it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    # newline="\n": text mode would write \r\n on Windows, and the record's lines must be
    # the bytes append_events and the shared copy write
    temporary.write_text(text, encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def unreadable_lines(directory: Path) -> list[str]:
    """Raw lines in `events.jsonl` that `parse_events` could not parse as valid events."""
    try:
        data = (directory / EVENTS_FILE).read_bytes()
    except FileNotFoundError:
        return []
    bad: list[str] = []
    for line in data.decode("utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            bad.append(line)
            continue
        if not isinstance(parsed, dict) or Event.from_json(parsed) is None:
            bad.append(line)
    return bad


def rewrite_events(
    directory: Path, events: list[Event], extra_lines: list[str] | tuple[str, ...] = ()
) -> None:
    """Replace the whole record, optionally keeping raw lines (e.g. unreadable lines during
    automatic refiling so damage evidence is never silently dropped)."""
    lines = [json.dumps(event.to_json(), sort_keys=True) for event in events]
    lines.extend(extra_lines)
    _replace(directory / EVENTS_FILE, "".join(line + "\n" for line in lines))


def _load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def load_state(directory: Path) -> dict:
    """What the last collection left for the next one; empty when there was none."""
    return _load_json(directory / STATE_FILE)


def save_state(directory: Path, state: dict) -> None:
    _replace(directory / STATE_FILE, json.dumps(state, indent=2, sort_keys=True) + "\n")


class RecordDamaged(OSError):
    """A file of the record exists and cannot be read as what it should hold."""


def parse_sessions(data: bytes, path: Path) -> dict[str, dict]:
    """The sessions in the bytes of a sessions file. A damaged file is an error, not an
    empty one: the next collection would write only the sessions the harness still holds
    over it, and the ones it has dropped would be gone."""
    try:
        parsed = json.loads(data.decode("utf-8"))
    except ValueError as exc:
        raise RecordDamaged(
            f"{path} is not valid JSON ({exc}); move it aside to start it again"
        ) from exc
    if not isinstance(parsed, dict):
        raise RecordDamaged(f"{path} does not hold sessions; move it aside to start it again")
    return {key: value for key, value in parsed.items() if isinstance(value, dict)}


def load_sessions(directory: Path) -> dict[str, dict]:
    """Every session a collection saw, by its id, whether or not it loaded a skill."""
    path = directory / SESSIONS_FILE
    try:
        return parse_sessions(path.read_bytes(), path)
    except FileNotFoundError:
        return {}


def save_sessions(directory: Path, sessions: dict[str, dict]) -> None:
    _replace(directory / SESSIONS_FILE, json.dumps(sessions, indent=1, sort_keys=True) + "\n")


# ── The shared folder ───────────────────────────────────────────────────────

# What another machine needs of a machine's state: never its folders
SHARED_STATE = ("version", "collected_at", "recognizer", "record_id")
# What a session's entry holds, and so all of one that is shared
SESSION_TEXT = ("root", "parent", "agent", "harness", "project", "created_at", "updated_at")


class SharedUnavailable(OSError):
    """The shared folder cannot take this machine's record: it is not there (a drive not
    mounted, a sync not set up), or the machine's folder in it is another record's."""


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _copy_bytes(path: Path) -> bytes:
    """A file of a shared copy as it lies now (a read a cloud drive can hold)."""
    return path.read_bytes()


def _write_bytes(path: Path, data: bytes) -> None:
    """A file of a shared copy beside the one it will replace (a write the drive can hold)."""
    path.write_bytes(data)


def _leftovers(folder: Path) -> list[Path]:
    """Temporary files a publish that was cut short left in a machine's shared folder."""
    return list(folder.glob("*.tmp"))


def _shared_link(link: object) -> dict | str | None:
    """A session's pull request as it is shared: its reference, when, and who opened it."""
    if isinstance(link, str):
        return link  # as an earlier botcore wrote it
    if not isinstance(link, dict) or not isinstance(link.get("ref"), str):
        return None
    when, opened = link.get("linked_at"), link.get("opened")
    return {
        "ref": link["ref"],
        "linked_at": when if isinstance(when, str) else None,
        "opened": opened if isinstance(opened, bool) else None,
    }


def _shared_session(entry: dict, machine: str) -> dict:
    """A session's entry as it is shared: the fields this module writes, and nothing a hand
    or another program may have added to the file."""
    found = {
        key: entry.get(key) if isinstance(entry.get(key), str) else None for key in SESSION_TEXT
    }
    links = entry.get("pull_requests")
    shared = [_shared_link(link) for link in links] if isinstance(links, list) else []
    return {**found, "machine": machine, "pull_requests": [link for link in shared if link]}


def _same_folder(one: Path, other: Path) -> bool:
    try:
        return one.resolve() == other.resolve()
    except OSError:
        return False


def _renames(state: dict) -> dict[str, dict[str, str]]:
    """Each project's renamed skills, old name to new, as a machine's state holds them: a
    reader with no checkout of a project knows a skill's name from the machines that have."""
    found: dict[str, dict[str, str]] = {}
    projects = state.get("projects")
    for name, entry in projects.items() if isinstance(projects, dict) else []:
        renames = entry.get("renames") if isinstance(entry, dict) else None
        pairs = _pairs(renames)
        if isinstance(name, str) and pairs:
            found[name] = pairs
    return found


def _pairs(renames: object) -> dict[str, str]:
    """Renamed skills, old name to new: names a skill's folder can have, and no other text."""
    return {
        old: new
        for old, new in (renames.items() if isinstance(renames, dict) else [])
        if is_skill_folder(old) and is_skill_folder(new)
    }


_COMMIT = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")


def _moment(stamp: object) -> datetime | None:
    try:
        moment = datetime.fromisoformat(stamp) if isinstance(stamp, str) else None
    except ValueError:
        return None
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _valid_skill_key(name: object, *, allow_scoped: bool) -> bool:
    if not isinstance(name, str):
        return False
    return clean_skill_name(name) == name if allow_scoped else is_skill_folder(name)


def _facts_map(value: object, *, allow_scoped: bool = False) -> dict[str, list[int]]:
    """Validated `{skill: [size_bytes, listing_chars]}` map: skill names and non-negative ints
    only, never file paths or arbitrary strings."""
    return {
        name: list(facts)
        for name, facts in (value.items() if isinstance(value, dict) else [])
        if _valid_skill_key(name, allow_scoped=allow_scoped)
        and isinstance(facts, list)
        and len(facts) == 2  # noqa: PLR2004
        and all(type(number) is int and number >= 0 for number in facts)
    }


def as_inventory(value: object) -> dict | None:
    """What a project holds, as a collection wrote it: `{"at", "commit", "held", "renames"}`,
    plus optional `"observed"` for loaded skills kept outside the project's configured skill
    folders. `held` has each skill's SKILL.md size and what it adds to every session's skill
    listing; `renames` is old name to new. `at` and `commit` say which commit of the project's
    default branch both were read from, and are None for a folder read as it lay. None for
    anything else.

    Only what a collection could have written comes back, since it is shared: a commit that
    is one with a time that is one, names a skill's folder can have, and counts. A file
    changed by hand never puts a path or a sentence in another machine's hands."""
    if not isinstance(value, dict) or not isinstance(value.get("held"), dict):
        return None
    moment, commit = _moment(value.get("at")), value.get("commit")
    dated = moment is not None and isinstance(commit, str) and _COMMIT.fullmatch(commit) is not None
    inventory: dict = {
        "at": moment.astimezone(UTC).isoformat() if dated and moment is not None else None,
        "commit": commit if dated else None,
        "held": _facts_map(value["held"]),
        "renames": _pairs(value.get("renames")),
    }
    observed = _facts_map(value.get("observed"), allow_scoped=True)
    if observed:
        inventory["observed"] = observed
    aliases = _pairs(value.get("aliases"))
    if aliases:
        inventory["aliases"] = aliases
    return inventory


def as_external(value: object) -> dict | None:
    """Skills kept outside any project: `held` (from personal/configured external folders) and
    `observed` (from loaded SKILL.md files outside projects). Only validated names and counts,
    never file paths. None when both are empty."""
    if not isinstance(value, dict):
        return None
    held = _facts_map(value.get("held"))
    observed = _facts_map(value.get("observed"), allow_scoped=True)
    if not held and not observed:
        return None
    return {"held": held, "observed": observed}


def _read_at(inventory: dict) -> datetime:
    return _moment(inventory.get("at")) or datetime.min.replace(tzinfo=UTC)


def newest_inventory(found: list[dict]) -> dict | None:
    """Of several accounts of what a project holds, the one read from the newest commit. A
    folder read as it lay is older than any commit, and one that held nothing older still.
    Of two as new, the first."""
    return max(found, key=lambda one: (_read_at(one), bool(one["held"]))) if found else None


def _skills(state: dict) -> dict[str, dict]:
    """What each project holds, as a machine's state has it: the skills a report lists, their
    sizes and their names now, known to a reader whatever its own checkout is at."""
    found: dict[str, dict] = {}
    projects = state.get("projects")
    for name, entry in projects.items() if isinstance(projects, dict) else []:
        inventory = as_inventory(entry.get("skills") if isinstance(entry, dict) else None)
        if isinstance(name, str) and inventory is not None:
            found[name] = inventory
    return found


def _earlier(folder: Path, events: list[Event], sessions: dict[str, dict]) -> bool:
    """Whether a folder under this machine's name holds an earlier copy of this record,
    whatever id it carries: everything in it is in the record here. A machine whose state
    was lost begins a new id, and must not be shut out of its own folder; another machine's
    record holds sessions this one never had."""
    try:
        copy = _read_copy(folder)
    except (OSError, ValueError):
        return False
    if copy is None or not (copy.events or copy.sessions):
        return False
    return {event.id for event in copy.events} <= {event.id for event in events} and set(
        copy.sessions
    ) <= set(sessions)


# What a collection says it is doing while it reads or writes the shared folder: the hourly
# job reads it to tell a shared folder that does not answer from a collection that did not run
SHARING = "writing the shared folder"


def publish(directory: Path, shared: Path, machine: str) -> bool:
    """Write this machine's record to its own folder in the shared one. Whether anything
    was written: a file that did not change is left alone, so a sync has nothing to send.

    What is written is what was read and understood, never the files as they lie: an event
    line that cannot be read stays on this machine, and the state says how many there are.
    The state goes last and names the other two files by their digests, since a sync
    delivers files one at a time and a reader must not take new sessions with old events.

    The shared folder itself is never created: a missing one is a drive or a sync that is
    not there, and a new folder in its place would hide that. Nor is another record's
    folder written over: two machines that took one name would each hide the other.
    """
    # what the hourly job is told when this does not come back names the folder that was
    # being read: the shared one, or this machine's own
    doing(SHARING, shared)
    if not shared.is_dir():
        raise SharedUnavailable(f"{shared} is not a folder this machine can see")
    target = shared / machine
    if _same_folder(target, directory):
        raise SharedUnavailable(
            f"{target} is where this machine keeps its own record: name another folder as "
            "the shared one"
        )
    doing("reading this machine's record in", directory)
    state = load_state(directory)
    events, unreadable = load_events(directory)
    sessions = load_sessions(directory)
    doing(SHARING, shared)
    theirs = _load_json(target / STATE_FILE).get("record_id")
    if theirs and theirs != state.get("record_id") and not _earlier(target, events, sessions):
        raise SharedUnavailable(
            f"{target} holds the record of another machine named {machine}: give this "
            "machine a name of its own (skill_usage_machine), or remove that folder if it "
            "is this machine's old record"
        )
    files = {
        EVENTS_FILE: "".join(
            json.dumps(event.to_json(), sort_keys=True) + "\n" for event in events
        ).encode("utf-8"),
        SESSIONS_FILE: (
            json.dumps(
                {key: _shared_session(entry, machine) for key, entry in sessions.items()},
                indent=1,
                sort_keys=True,
            )
            + "\n"
        ).encode("utf-8"),
    }
    shared_state = {key: state[key] for key in SHARED_STATE if key in state}
    shared_state["machine"] = machine
    shared_state["unreadable"] = unreadable
    shared_state["renames"] = _renames(state)
    shared_state["skills"] = _skills(state)
    external = as_external(state.get("external"))
    if external is not None:
        shared_state["external"] = external
    shared_state["files"] = {name: _digest(data) for name, data in files.items()}
    files[STATE_FILE] = json.dumps(shared_state, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    doing(SHARING, shared)  # said before anything is written: a step that was left stops here
    target.mkdir(exist_ok=True)
    for left in _leftovers(target):  # what a write that was cut short left behind
        doing(SHARING, shared)
        left.unlink(missing_ok=True)
    written = False
    for name, data in files.items():
        destination = target / name
        try:
            if _copy_bytes(destination) == data:
                continue
        except FileNotFoundError:
            pass
        doing(SHARING, shared)  # after the copy was read, and before it is replaced
        temporary = destination.with_name(f"{name}.{os.getpid()}.tmp")
        _write_bytes(temporary, data)
        doing(SHARING, shared)  # the write can wait at the drive too: asked again before
        os.replace(temporary, destination)  # the copy that lies there is replaced
        written = True
    return written


@dataclass
class Copy:
    """A machine's shared copy, read whole."""

    state: dict
    events: list[Event]
    unreadable: int
    sessions: dict[str, dict]


def _read_copy(folder: Path) -> Copy | None:
    """A machine's folder in the shared one, when it holds the files its state names: every
    one, and no other version of any. What is parsed is the bytes that were checked, so a
    sync that lands in between changes nothing. None when the copy is not whole."""
    state = _load_json(folder / STATE_FILE)
    files = state.get("files")
    if not isinstance(files, dict) or str(state.get("machine")).lower() != folder.name.lower():
        return None
    data: dict[str, bytes] = {}
    for name in (EVENTS_FILE, SESSIONS_FILE):
        try:
            data[name] = (folder / name).read_bytes()
        except FileNotFoundError:
            return None
        if files.get(name) != _digest(data[name]):
            return None
    events, unreadable = parse_events(data[EVENTS_FILE])
    left = state.get("unreadable")
    unreadable += left if isinstance(left, int) and left > 0 else 0
    sessions = parse_sessions(data[SESSIONS_FILE], folder / SESSIONS_FILE)
    return Copy(state, events, unreadable, sessions)


@dataclass
class Record:
    """This machine's record and, where a shared folder is named, every other machine's."""

    events: list[Event] = field(default_factory=list)
    sessions: dict[str, dict] = field(default_factory=dict)
    state: dict = field(default_factory=dict)  # this machine's own
    # machine -> when it last collected, for every machine read
    collected: dict[str, str | None] = field(default_factory=dict)
    unreadable: dict[str, int] = field(default_factory=dict)  # machine -> lines not read
    partial: list[str] = field(default_factory=list)  # machines whose copy is not whole
    recognizer: int | None = None  # the oldest rules any machine's record began under
    # project -> old skill name -> new, as every machine that holds the project knows them;
    # the machine whose account of the project is used (`skills`) has the last word
    renames: dict[str, dict[str, str]] = field(default_factory=dict)
    # project -> what it holds (`as_inventory`), from the machine that read the newest commit
    skills: dict[str, dict] = field(default_factory=dict)
    # project -> configured [skills.aliases] from the selected inventory commit only
    aliases: dict[str, dict[str, str]] = field(default_factory=dict)
    # project -> skill -> [size, listing], for loaded files inside a project outside its
    # configured skill folders, merged across machines (newest collected_at first)
    project_observed: dict[str, dict[str, list[int]]] = field(default_factory=dict)
    # skill -> [size, listing], for personal/external skill folders across machines
    external_held: dict[str, list[int]] = field(default_factory=dict)
    # skill -> [size, listing], for loaded skill files outside any project across machines
    external_observed: dict[str, list[int]] = field(default_factory=dict)
    shared: Path | None = None
    missing: str | None = None  # why the shared folder was not read

    @property
    def damaged(self) -> int:
        return sum(self.unreadable.values())

    @property
    def whole(self) -> bool:
        """Whether everything the machines wrote was read: no copy skipped, and the shared
        folder there."""
        return not self.partial and self.missing is None


def _link_rank(link: object) -> tuple[int, bool, str]:
    """Orders two machines' links to one pull request, whichever is read first: the one
    that opened it, then one that says it did not; and of two times the earlier, which
    makes a load before the opening harder to claim."""
    if not isinstance(link, dict):
        return (3, True, "")
    when = link.get("linked_at")
    when = when if isinstance(when, str) else None
    opened = link.get("opened")
    rank = 0 if opened is True else 1 if opened is False else 2
    return (rank, when is None, when or "")


def _merged(one: dict, other: dict) -> dict:
    """Two machines' entries for one session: a thread moved between machines is one
    session. The later entry's fields, each kept from the earlier where the later does not
    know it, and every pull request either saw. The same whichever machine reads."""
    first, second = sorted(
        (one, other),
        key=lambda entry: (str(entry.get("updated_at") or ""), json.dumps(entry, sort_keys=True)),
    )
    merged = {**first, **{key: value for key, value in second.items() if value is not None}}
    links: dict[str, object] = {}
    for entry in (first, second):
        found = entry.get("pull_requests")
        for link in found if isinstance(found, list) else []:
            reference = link.get("ref") if isinstance(link, dict) else link
            if not isinstance(reference, str):
                continue
            if reference not in links or _link_rank(link) < _link_rank(links[reference]):
                links[reference] = link
    merged["pull_requests"] = [links[reference] for reference in sorted(links)]
    return merged


def _name_skills(
    record: Record,
    renames: dict[str, dict],
    skills: dict[str, dict],
    externals: dict[str, dict | None],
) -> None:
    """Settle, from what each machine says, what every project holds, what external/observed
    skills exist, and what skills are called now: the same whichever machine reads."""
    for machine in sorted(renames, reverse=True):  # the first by name has the last word
        for project, pairs in renames[machine].items():
            record.renames.setdefault(project, {}).update(pairs)
    held: dict[str, list[dict]] = {}
    for machine in sorted(skills):  # of two machines at one commit, the first by name
        for project, inventory in skills[machine].items():
            held.setdefault(project, []).append(inventory)
    record.skills = {
        project: inv
        for project, found in held.items()
        if (inv := newest_inventory(found)) is not None
    }
    for project, inventory in record.skills.items():
        # a skill's name now and the list it is looked up in come from one commit: where two
        # machines' histories say otherwise of a name, the one whose list is used is right.
        # Configured aliases belong strictly to the selected commit so removing one takes effect.
        record.renames[project] = {**record.renames.get(project, {}), **inventory["renames"]}
        aliases = inventory.get("aliases")
        if isinstance(aliases, dict) and aliases:
            record.aliases[project] = dict(aliases)
    # External and observed skill facts: newest collection wins, first machine by name on ties
    min_time = datetime.min.replace(tzinfo=UTC)
    by_name = sorted(set(skills) | set(externals))
    preferred = sorted(
        by_name,
        key=lambda machine: _moment(record.collected.get(machine)) or min_time,
        reverse=True,
    )
    for machine in preferred:
        for project, inventory in skills.get(machine, {}).items():
            observed = inventory.get("observed")
            if isinstance(observed, dict):
                target = record.project_observed.setdefault(project, {})
                for name, facts in observed.items():
                    target.setdefault(name, facts)
        ext = externals.get(machine)
        if ext is not None:
            for name, facts in ext["held"].items():
                record.external_held.setdefault(name, facts)
            for name, facts in ext["observed"].items():
                record.external_observed.setdefault(name, facts)


def load_record(directory: Path, here: Local) -> Record:
    """The record to report from: this machine's and each other machine's from the shared
    folder, every event and session once, and the same whichever machine reads it. This
    machine's own folder there is a copy and is not read. A folder that cannot be read, or
    is not whole, is named in `partial` and not read. Raises `RecordDamaged` and `OSError`
    for this machine's own record, as the single readers do."""
    for there in (directory, *directory.parents):  # the nearest part of the path that exists
        if there.exists():
            if not there.is_dir():
                # Windows reads a file under a file as missing: that would pass for no record
                raise NotADirectoryError(errno.ENOTDIR, "not a folder", str(there))
            break
    events, unreadable = load_events(directory)
    record = Record(state=load_state(directory), shared=here.shared)
    known = isinstance(record.state.get("recognizer"), int)
    record.recognizer = record.state["recognizer"] if known else None
    machines: dict[str, tuple[list[Event], dict[str, dict]]] = {}
    renames = {here.machine: _renames(record.state)}
    skills = {here.machine: _skills(record.state)}
    externals: dict[str, dict | None] = {here.machine: as_external(record.state.get("external"))}
    sessions = load_sessions(directory)
    if events or record.state or sessions:
        machines[here.machine] = (events, sessions)
        record.collected[here.machine] = record.state.get("collected_at")
    if unreadable:
        record.unreadable[here.machine] = unreadable
    if here.shared is not None:
        try:
            folders = sorted(here.shared.iterdir())
        except OSError:
            folders = []
            record.missing = f"{here.shared} is not a folder this machine can see"
        for folder in folders:
            machine = folder.name.lower()
            if machine == here.machine or folder.name.startswith("."):
                continue
            try:
                if folder.is_symlink() or not folder.is_dir():
                    continue
                copy = _read_copy(folder)
                empty = copy is None and not any((folder / n).exists() for n in RECORD_FILES)
            except (OSError, ValueError):  # a folder or a file that cannot be read
                copy, empty = None, False
            if empty and not _MACHINE.fullmatch(machine):
                continue  # not a machine's record, nor a folder that could become one
            if copy is None or machine in machines:
                # a sync part way through (it makes a folder before it fills it), a write
                # cut short, or two folders for one name: new sessions read with old events
                # would show sessions that loaded nothing
                record.partial.append(folder.name)
                continue
            machines[machine] = (copy.events, copy.sessions)
            told = copy.state.get("renames")
            told = told if isinstance(told, dict) else {}
            renames[machine] = _renames(
                {"projects": {name: {"renames": pairs} for name, pairs in told.items()}}
            )
            told = copy.state.get("skills")
            told = told if isinstance(told, dict) else {}
            skills[machine] = _skills({"projects": {n: {"skills": v} for n, v in told.items()}})
            externals[machine] = as_external(copy.state.get("external"))
            record.collected[machine] = copy.state.get("collected_at")
            if copy.unreadable:
                record.unreadable[machine] = copy.unreadable
            rules = copy.state.get("recognizer")
            rules = rules if isinstance(rules, int) else 0
            record.recognizer = (
                rules if record.recognizer is None else min(record.recognizer, rules)
            )
    _name_skills(record, renames, skills, externals)
    seen: set[tuple[str, str]] = set()
    for machine in sorted(machines):  # by name, so that every reader merges alike
        theirs, entries = machines[machine]
        for event in theirs:
            if (event.id, event.thread) not in seen:  # one load, unless two sessions claim it
                seen.add((event.id, event.thread))
                record.events.append(event)
        for session_id, entry in entries.items():
            held = record.sessions.get(session_id)
            record.sessions[session_id] = entry if held is None else _merged(held, entry)
    return record
