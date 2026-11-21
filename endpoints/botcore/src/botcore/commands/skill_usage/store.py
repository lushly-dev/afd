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

from botcore.commands.skill_usage.events import Event

STATE_ENV = "BOTCORE_SKILL_USAGE_STATE"
T3_STORE_ENV = "BOTCORE_SKILL_USAGE_T3_STORE"
MACHINE_ENV = "BOTCORE_SKILL_USAGE_MACHINE"
EVENTS_FILE = "events.jsonl"
STATE_FILE = "state.json"


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


def append_events(directory: Path, events: list[Event]) -> None:
    """Add events to the record. A repeated id is harmless: readers keep the first."""
    if not events:
        return
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / EVENTS_FILE).open("a", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event.to_json(), sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def load_state(directory: Path) -> dict:
    """What the last collection left for the next one; empty when there was none."""
    try:
        data = json.loads((directory / STATE_FILE).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(directory: Path, state: dict) -> None:
    """Replace the state file in one step, so a reader never sees half of it."""
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / f"{STATE_FILE}.{os.getpid()}.tmp"
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, directory / STATE_FILE)
