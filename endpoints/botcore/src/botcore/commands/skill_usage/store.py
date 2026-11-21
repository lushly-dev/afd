"""This machine's record of skill loads: where it lives, and reading and writing it.

Events are appended to `events.jsonl`, one per line, and never rewritten. Collection is what
makes the record durable: a harness may compact or delete what it recorded, and a load already
collected stays here. `state.json` holds what the next collection needs.
"""

from __future__ import annotations

import json
import os
import platform
import sys
from pathlib import Path

from botcore.commands.skill_usage.events import Event, Trigger

STATE_ENV = "BOTCORE_SKILL_USAGE_STATE"
T3_STORE_ENV = "BOTCORE_SKILL_USAGE_T3_STORE"
MACHINE_ENV = "BOTCORE_SKILL_USAGE_MACHINE"
EVENTS_FILE = "events.jsonl"
STATE_FILE = "state.json"
SESSIONS_FILE = "sessions.json"
# In a file of its own: a botcore that knows nothing of triggers reads events.jsonl and
# would take any event there for a load.
TRIGGERS_FILE = "triggers.jsonl"
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


def machine_name() -> str:
    """A short name for this machine; BOTCORE_SKILL_USAGE_MACHINE overrides it."""
    override = os.environ.get(MACHINE_ENV)
    if override:
        return override
    return platform.node().split(".")[0].lower() or "unknown"


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


def _append(path: Path, lines: list[str]) -> None:
    """Add lines to a file of the record. A final line an interrupted write left unfinished
    is closed first, so the next line is not joined to it and lost with it."""
    if not lines:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell():
            handle.seek(-1, os.SEEK_END)
            if handle.read(1) != b"\n":
                handle.write(b"\n")
        for line in lines:
            handle.write((line + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())


def append_events(directory: Path, events: list[Event]) -> None:
    """Add events to the record. A repeated id is harmless: readers keep the first."""
    _append(
        directory / EVENTS_FILE, [json.dumps(event.to_json(), sort_keys=True) for event in events]
    )


def load_triggers(directory: Path) -> tuple[list[Trigger], int]:
    """Every recorded change that required a skill, each id once, and how many lines could
    not be read."""
    triggers: dict[str, Trigger] = {}
    unreadable = 0
    try:
        with (directory / TRIGGERS_FILE).open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                except ValueError:
                    unreadable += 1
                    continue
                trigger = Trigger.from_json(data) if isinstance(data, dict) else None
                if trigger is None:
                    unreadable += 1
                elif trigger.id not in triggers:
                    triggers[trigger.id] = trigger
    except FileNotFoundError:
        return [], 0
    return list(triggers.values()), unreadable


def append_triggers(directory: Path, triggers: list[Trigger]) -> None:
    _append(
        directory / TRIGGERS_FILE,
        [json.dumps(trigger.to_json(), sort_keys=True) for trigger in triggers],
    )


def rewrite_triggers(directory: Path, triggers: list[Trigger]) -> None:
    """Replace the whole file: what a rebuild does, and nothing else."""
    lines = [json.dumps(trigger.to_json(), sort_keys=True) for trigger in triggers]
    _replace(directory / TRIGGERS_FILE, "".join(line + "\n" for line in lines))


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
