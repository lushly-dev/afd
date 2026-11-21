"""`skill-usage-collect`: copy new skill loads from what the harnesses record into this
machine's record.

Nothing is added to a skill and no agent reports anything: the loads are read from records the
harnesses already keep. Running it again adds only what is new.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from afd import CommandResult, error, success

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.skill_usage import t3
from botcore.commands.skill_usage.events import Event
from botcore.commands.skill_usage.store import (
    append_events,
    load_events,
    load_state,
    machine_name,
    save_state,
    state_dir,
    t3_store_path,
)

STATE_VERSION = 1
OVERLAP = timedelta(days=1)  # re-read this much, for items a harness finished writing late
FULL_EVERY = timedelta(days=7)  # then read everything: a thread moved here can be older
GIT_SECONDS = 30.0
_REFS = ("refs/remotes/origin/HEAD", "refs/remotes/origin/main", "HEAD")
_PATHSPECS = tuple(f":(glob){folder}/*/SKILL.md" for folder in t3.SKILL_DIRS)


def _stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _parse(stamp: str) -> datetime | None:
    try:
        moment = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _since(since_days: int | None, newest: str | None, now: datetime) -> str | None:
    if since_days is not None:
        return _stamp(now - timedelta(days=since_days))
    previous = _parse(newest) if newest else None
    return _stamp(previous - OVERLAP) if previous else None


def skill_renames(root: Path) -> dict[str, str] | None:
    """Old skill name to new, from the renames in a checkout's history; None when git cannot
    say. A skill folder renamed in one commit keeps one identity in the report this way,
    with nothing to configure."""
    for ref in _REFS:
        try:
            git_out(
                root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}", timeout=GIT_SECONDS
            )
        except GitError:
            continue
        try:
            text = git_out(
                root,
                "log",
                ref,
                "--diff-filter=R",
                "-M50%",
                "--name-status",
                "--format=",
                "--",
                *_PATHSPECS,
                timeout=GIT_SECONDS,
            )
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
    return None


def _projects(previous: dict, found: dict[str, str]) -> dict:
    projects = {name: dict(entry) for name, entry in previous.items() if isinstance(entry, dict)}
    for name, root in found.items():
        entry = projects.setdefault(name, {})
        entry["root"] = root
        if Path(root).is_dir():
            renames = skill_renames(Path(root))
            if renames is not None:
                entry["renames"] = renames
    return projects


def _read_t3(path: Path, since: str | None, machine: str, known: set[tuple[str, str]]) -> t3.T3Read:
    connection = t3.open_store(path)
    try:
        t3.check_schema(connection)
        return t3.read(
            connection,
            since=since,
            machine=machine,
            known_skill=lambda project, name: (project, name) in known,
        )
    except sqlite3.Error as exc:
        raise t3.StoreUnreadable(str(exc)) from exc
    finally:
        connection.close()


async def skill_usage_collect(
    since_days: int | None = None,
    t3_store: str | None = None,
) -> CommandResult[dict]:
    """Add the skill loads recorded since the last collection to this machine's record.

    Reads T3 Code's store (Claude and Codex threads alike), read-only. It continues from the
    last collection and reads everything again once a week, since a thread moved to this
    machine can be older than the last collection. `since_days` re-reads that many days
    instead; `t3_store` names a store other than this machine's.
    """
    if since_days is not None and since_days < 0:
        return error(
            "INVALID_INPUT",
            "since_days cannot be negative",
            suggestion="Pass a number of days to re-read, or leave it out to continue from "
            "the last collection",
        )
    directory = state_dir()
    stored, _ = load_events(directory)
    state = load_state(directory)
    known_ids = {event.id for event in stored}
    known_skills = {(event.project, event.skill) for event in stored}
    machine = machine_name()
    now = datetime.now(UTC)
    source_state = state.get("sources") if isinstance(state.get("sources"), dict) else {}
    last = source_state.get(t3.SOURCE) if isinstance(source_state.get(t3.SOURCE), dict) else {}

    path = Path(t3_store).expanduser() if t3_store is not None else t3_store_path()
    report: dict = {"source": t3.SOURCE}
    added: list[Event] = []
    projects = state.get("projects") if isinstance(state.get("projects"), dict) else {}
    if path is None:
        report["status"] = "off"
    elif not path.is_file():
        if t3_store is not None:
            return error(
                "SOURCE_NOT_FOUND",
                f"No T3 Code store at {path}",
                suggestion="Pass the path of statev2.sqlite in T3 Code's user data folder, "
                "or leave t3_store out to read this machine's",
            )
        report.update(status="absent", path=str(path))
    else:
        full_at = _parse(last["full_at"]) if isinstance(last.get("full_at"), str) else None
        if since_days is None and (full_at is None or now - full_at > FULL_EVERY):
            since = None
        else:
            since = _since(since_days, last.get("newest"), now)
        try:
            found = _read_t3(path, since, machine, known_skills)
        except t3.SchemaChanged as exc:
            return error(
                "SOURCE_SCHEMA_CHANGED",
                f"T3 Code's store no longer has {', '.join(exc.missing)}",
                suggestion="This botcore cannot read this T3 Code release's store: update "
                "botcore. Nothing was collected, and what was collected before is kept",
            )
        except t3.StoreUnreadable as exc:
            return error(
                "SOURCE_UNREADABLE",
                f"T3 Code's store at {path} could not be read: {exc}",
                suggestion="Run it again: T3 Code may have been writing. If it keeps "
                "failing, check that the file can be read by this user",
            )
        added = [event for event in found.events if event.id not in known_ids]
        append_events(directory, added)
        report.update(
            status="read",
            path=str(path),
            since=since,
            scanned=found.scanned,
            found=len(found.events),
            added=len(added),
        )
        projects = _projects(projects, found.projects)
        last = {
            "newest": found.newest or last.get("newest"),
            "path": str(path),
            "full_at": _stamp(now) if since is None else last.get("full_at"),
        }

    save_state(
        directory,
        {
            "version": STATE_VERSION,
            "machine": machine,
            "collected_at": _stamp(now),
            "sources": {**source_state, t3.SOURCE: last},
            "projects": projects,
        },
    )
    total = len(known_ids) + len(added)
    return success(
        {
            "machine": machine,
            "state_dir": str(directory),
            "sources": [report],
            "added": len(added),
            "events": total,
        },
        reasoning=f"Added {len(added)} skill loads; this machine's record now holds {total}",
    )
