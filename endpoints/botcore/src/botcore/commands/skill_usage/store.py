"""This machine's record of skill loads: where it lives, and reading and writing it.

Events are appended to `events.jsonl`, one per line, and never rewritten. Collection is what
makes the record durable: a harness may compact or delete what it recorded, and a load already
collected stays here. `state.json` holds what the next collection needs.

A machine may name a shared folder, one every machine can see. Collection then also writes
this machine's record to a folder of its own there, and a report reads every machine's.
Botcore does not sync the folder.
"""

from __future__ import annotations

import json
import os
import platform
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from botcore.commands.disk.settings import MACHINE_NAME, expand, load_machine_settings
from botcore.commands.skill_usage.events import Event

STATE_ENV = "BOTCORE_SKILL_USAGE_STATE"
T3_STORE_ENV = "BOTCORE_SKILL_USAGE_T3_STORE"
MACHINE_ENV = "BOTCORE_SKILL_USAGE_MACHINE"
SHARED_ENV = "BOTCORE_SKILL_USAGE_SHARED"
EVENTS_FILE = "events.jsonl"
STATE_FILE = "state.json"
SESSIONS_FILE = "sessions.json"
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
    """A machine's name that cannot be a folder's name."""


def checked_machine(name: str) -> str:
    """A machine's name, refused unless it can name the machine's folder in a shared one."""
    if not re.fullmatch(MACHINE_NAME.rstrip("$") + r"\Z", name):
        raise InvalidMachine(
            f"{name!r} cannot name a machine: use letters, digits, dots, hyphens and "
            "underscores, starting with a letter or digit, at most 63"
        )
    return name


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
    if not name:
        host = platform.node().split(".")[0].lower()
        name = re.sub(r"[^a-z0-9._-]+", "-", host).strip("-._")[:63] or "unknown"
    return Local(checked_machine(name), expand(shared) if shared else None)


def machine_name() -> str:
    """A short name for this machine: BOTCORE_SKILL_USAGE_MACHINE, the machine settings'
    `skill_usage_machine`, or its hostname."""
    return local().machine


def load_events(directory: Path) -> tuple[list[Event], int]:
    """Every stored event, each id once, and how many lines could not be read."""
    path = directory / EVENTS_FILE
    events: dict[str, Event] = {}
    unreadable = 0
    try:
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                except ValueError:
                    unreadable += 1
                    continue
                event = Event.from_json(data) if isinstance(data, dict) else None
                if event is None:
                    unreadable += 1
                elif event.id not in events:
                    events[event.id] = event
    except FileNotFoundError:
        return [], 0
    return list(events.values()), unreadable


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


def load_sessions(directory: Path) -> dict[str, dict]:
    """Every session a collection saw, by its id, whether or not it loaded a skill.

    A damaged file is an error, not an empty one: the next collection would write only the
    sessions the harness still holds over it, and the ones it has dropped would be gone.
    """
    path = directory / SESSIONS_FILE
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except ValueError as exc:
        raise RecordDamaged(
            f"{path} is not valid JSON ({exc}); move it aside to start it again"
        ) from exc
    if not isinstance(data, dict):
        raise RecordDamaged(f"{path} does not hold sessions; move it aside to start it again")
    return {key: value for key, value in data.items() if isinstance(value, dict)}


def save_sessions(directory: Path, sessions: dict[str, dict]) -> None:
    _replace(directory / SESSIONS_FILE, json.dumps(sessions, indent=1, sort_keys=True) + "\n")


# ── The shared folder ───────────────────────────────────────────────────────

# What another machine needs of a machine's state: never its folders
SHARED_STATE = ("version", "machine", "collected_at", "recognizer")


class SharedUnavailable(OSError):
    """The shared folder is not there: a drive not mounted, or a sync not set up."""


def publish(directory: Path, shared: Path, machine: str) -> bool:
    """Write this machine's record to its own folder in the shared one, each file in one
    step and only when it changed, so that a sync has nothing to send otherwise. Whether
    anything was written. The shared folder itself is never created: a missing one is a
    drive or a sync that is not there, and a new folder in its place would hide that."""
    if not shared.is_dir():
        raise SharedUnavailable(f"{shared} is not a folder this machine can see")
    target = shared / machine
    state = load_state(directory)
    files = {
        STATE_FILE: json.dumps(
            {key: state[key] for key in SHARED_STATE if key in state}, indent=2, sort_keys=True
        ).encode("utf-8")
        + b"\n"
    }
    for name in (EVENTS_FILE, SESSIONS_FILE):
        try:
            files[name] = (directory / name).read_bytes()
        except FileNotFoundError:
            continue
    written = False
    for name, data in files.items():
        destination = target / name
        try:
            if destination.read_bytes() == data:
                continue
        except FileNotFoundError:
            pass
        destination.parent.mkdir(exist_ok=True)
        temporary = destination.with_name(f"{name}.{os.getpid()}.tmp")
        temporary.write_bytes(data)
        os.replace(temporary, destination)
        written = True
    return written


@dataclass
class Record:
    """This machine's record and, where a shared folder is named, every other machine's."""

    events: list[Event] = field(default_factory=list)
    sessions: dict[str, dict] = field(default_factory=dict)
    state: dict = field(default_factory=dict)  # this machine's own
    # machine -> when it last collected, for every machine read
    collected: dict[str, str | None] = field(default_factory=dict)
    unreadable: dict[str, int] = field(default_factory=dict)  # machine -> lines not read
    recognizer: int | None = None  # the oldest rules any machine's record began under
    shared: Path | None = None
    missing: str | None = None  # why the shared folder was not read

    @property
    def damaged(self) -> int:
        return sum(self.unreadable.values())


def _later(one: dict, other: dict) -> dict:
    """Of two machines' entries for one session, the one that saw it last, with the pull
    requests either saw: a thread moved between machines is one session."""
    first, second = sorted((one, other), key=lambda entry: str(entry.get("updated_at") or ""))
    links: dict[str, dict | str] = {}
    for entry in (first, second):
        references = entry.get("pull_requests")
        for link in references if isinstance(references, list) else []:
            reference = link.get("ref") if isinstance(link, dict) else link
            if not isinstance(reference, str):
                continue
            held = links.get(reference)
            opened = isinstance(held, dict) and held.get("opened") is True
            if held is None or not opened:
                links[reference] = link
    return {**second, "pull_requests": list(links.values())}


def load_record(directory: Path, here: Local) -> Record:
    """The record to report from: this machine's, then each other machine's from the shared
    folder, every event and session once. This machine's own folder there is a copy and is
    not read. Raises `RecordDamaged` and `OSError` as the single readers do."""
    events, unreadable = load_events(directory)
    record = Record(events=events, sessions=load_sessions(directory), state=load_state(directory))
    record.shared = here.shared
    known = isinstance(record.state.get("recognizer"), int)
    record.recognizer = record.state["recognizer"] if known else None
    if events or record.state:
        record.collected[here.machine] = record.state.get("collected_at")
    if unreadable:
        record.unreadable[here.machine] = unreadable
    if here.shared is None:
        return record
    if not here.shared.is_dir():
        record.missing = f"{here.shared} is not a folder this machine can see"
        return record
    seen = {event.id for event in record.events}
    for folder in sorted(here.shared.iterdir()):
        machine = folder.name
        if machine == here.machine or not folder.is_dir() or machine.startswith("."):
            continue
        state = load_state(folder)
        theirs, unreadable = load_events(folder)
        try:
            sessions = load_sessions(folder)
        except RecordDamaged:  # a copy half written or half synced: say so, and read the rest
            sessions, unreadable = {}, unreadable + 1
        if not (state or theirs or sessions or unreadable):
            continue  # not a machine's record
        record.collected[machine] = state.get("collected_at")
        if unreadable:
            record.unreadable[machine] = unreadable
        rules = state.get("recognizer")
        if not isinstance(rules, int):
            rules = 0
        record.recognizer = rules if record.recognizer is None else min(record.recognizer, rules)
        for event in theirs:
            if event.id not in seen:
                seen.add(event.id)
                record.events.append(event)
        for session_id, entry in sessions.items():
            held = record.sessions.get(session_id)
            record.sessions[session_id] = entry if held is None else _later(held, entry)
    return record
