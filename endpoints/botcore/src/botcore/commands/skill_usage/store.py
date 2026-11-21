"""This machine's record of skill loads: where it lives, and reading and writing it.

Events are appended to `events.jsonl`, one per line, and never rewritten. Collection is what
makes the record durable: a harness may compact or delete what it recorded, and a load already
collected stays here. `state.json` holds what the next collection needs.

A machine may name a shared folder, one every machine can see. Collection then also writes
this machine's record to a folder of its own there, and a report reads every machine's.
Botcore does not sync the folder.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from botcore.commands.disk.settings import expand, load_machine_settings
from botcore.commands.skill_usage.events import Event

STATE_ENV = "BOTCORE_SKILL_USAGE_STATE"
T3_STORE_ENV = "BOTCORE_SKILL_USAGE_T3_STORE"
MACHINE_ENV = "BOTCORE_SKILL_USAGE_MACHINE"
SHARED_ENV = "BOTCORE_SKILL_USAGE_SHARED"
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


@dataclass
class Local:
    """What this machine says of itself."""

    machine: str  # its name in the record
    shared: Path | None  # the folder every machine can see, when one is named


def local() -> Local:
    """This machine's name and shared folder: the environment first, then the machine
    settings, then its hostname and no shared folder. Raises `SettingsError` when the
    machine settings cannot be read, and `InvalidMachine`."""
    name, shared = os.environ.get(MACHINE_ENV), os.environ.get(SHARED_ENV)
    if not name or shared is None:  # an empty BOTCORE_SKILL_USAGE_SHARED means none
        settings = load_machine_settings()[0]
        name = name or settings.skill_usage_machine
        shared = settings.skill_usage_shared or "" if shared is None else shared
    folder = expand(shared) if shared else None
    if folder is not None and not folder.is_absolute():
        # a job does not run where a person does: a relative folder would be two folders
        raise InvalidMachine(f"The shared folder must be a full path, not {shared!r}")
    return Local(checked_machine(name) if name else default_machine(), folder)


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
    line an interrupted write left unfinished is closed first, so the next event is not
    joined to it and lost with it."""
    if not events:
        return
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / EVENTS_FILE).open("a+b") as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell():
            handle.seek(-1, os.SEEK_END)
            if handle.read(1) != b"\n":
                handle.write(b"\n")
        for event in events:
            handle.write((json.dumps(event.to_json(), sort_keys=True) + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())


def _replace(path: Path, text: str) -> None:
    """Write a file in one step, so a reader never sees half of it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, path)


def rewrite_events(directory: Path, events: list[Event]) -> None:
    """Replace the whole record: what a rebuild does, and nothing else."""
    lines = [json.dumps(event.to_json(), sort_keys=True) for event in events]
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
    if not shared.is_dir():
        raise SharedUnavailable(f"{shared} is not a folder this machine can see")
    target = shared / machine
    if _same_folder(target, directory):
        raise SharedUnavailable(
            f"{target} is where this machine keeps its own record: name another folder as "
            "the shared one"
        )
    state = load_state(directory)
    held = _load_json(target / STATE_FILE)
    mine, theirs = state.get("record_id"), held.get("record_id")
    if theirs and theirs != mine:
        raise SharedUnavailable(
            f"{target} holds the record of another machine named {machine}: give this "
            "machine a name of its own (skill_usage_machine), or remove that folder if it "
            "is this machine's old record"
        )
    events, unreadable = load_events(directory)
    sessions = load_sessions(directory)
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
    shared_state["files"] = {name: _digest(data) for name, data in files.items()}
    files[STATE_FILE] = json.dumps(shared_state, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    target.mkdir(exist_ok=True)
    for left in target.glob("*.tmp"):  # what a write that was cut short left behind
        left.unlink(missing_ok=True)
    written = False
    for name, data in files.items():
        destination = target / name
        try:
            if destination.read_bytes() == data:
                continue
        except FileNotFoundError:
            pass
        temporary = destination.with_name(f"{name}.{os.getpid()}.tmp")
        temporary.write_bytes(data)
        os.replace(temporary, destination)
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
    return ({True: 0, False: 1}.get(link.get("opened"), 2), when is None, when or "")


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


def load_record(directory: Path, here: Local) -> Record:
    """The record to report from: this machine's and each other machine's from the shared
    folder, every event and session once, and the same whichever machine reads it. This
    machine's own folder there is a copy and is not read. A folder that cannot be read, or
    is not whole, is named in `partial` and not read. Raises `RecordDamaged` and `OSError`
    for this machine's own record, as the single readers do."""
    events, unreadable = load_events(directory)
    record = Record(state=load_state(directory), shared=here.shared)
    known = isinstance(record.state.get("recognizer"), int)
    record.recognizer = record.state["recognizer"] if known else None
    machines: dict[str, tuple[list[Event], dict[str, dict]]] = {}
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
            if empty:
                continue  # not a machine's record
            if copy is None or machine in machines:
                # a sync part way through, a write cut short, or two folders for one name:
                # new sessions read with old events would show sessions that loaded nothing
                record.partial.append(folder.name)
                continue
            machines[machine] = (copy.events, copy.sessions)
            record.collected[machine] = copy.state.get("collected_at")
            if copy.unreadable:
                record.unreadable[machine] = copy.unreadable
            rules = copy.state.get("recognizer")
            rules = rules if isinstance(rules, int) else 0
            record.recognizer = (
                rules if record.recognizer is None else min(record.recognizer, rules)
            )
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
