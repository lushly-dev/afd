"""What T3 Code's store shows of the paths a session changed, for the skills a repository
requires.

Two things show a change. A `file_change` item is one edit a tool made, at the moment it made
it. A `checkpoint` lists the files a turn left changed in the session's checkout, whatever
made them, so it sees an edit by a script too; but it says only that the change happened
during the turn, and after a turn that moved the checkout to other commits (a merge, a rebase,
a checkout of another branch) it lists other people's changes, so such a turn is not read.

The paths are read here and go no further: what leaves is which skill a change required.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field

from botcore.commands.skill_usage import t3
from botcore.commands.skill_usage.events import moves_checkout

CHANGE, CHECKPOINT = "file_change", "checkpoint"
# Words one of which every checkout-moving command holds: a cheap first cut before parsing
_MIGHT_MOVE = (
    "merge", "pull", "rebase", "cherry-pick", "reset", "checkout", "switch", "base:sync",
    "base-sync",
)  # fmt: skip
_DRIVE = re.compile(r"^[A-Za-z]:[\\/]")
# When a turn began is not known: a load at any earlier time may have come after the change
UNKNOWN_START = "0001-01-01T00:00:00.000Z"


@dataclass
class Seen:
    """A turn, or one edit, in which a session changed a path that requires a skill."""

    key: str  # `run:<id>` for a turn, else the store's id for the item
    at: str
    since: str | None  # the earliest it can have happened, when only a checkpoint shows it
    skill: str
    rule: str
    thread: str
    project_id: str | None


@dataclass
class Changes:
    seen: list[Seen] = field(default_factory=list)
    keys: set[str] | None = None  # every turn and item the store holds, when asked for


def inside(file: str, checkouts: list[str | None]) -> str | None:
    """A changed file as a forward-slash path inside its session's checkout. A path that is
    not absolute is already inside it. Windows paths compare without regard to case."""
    target = file.replace("\\", "/")
    windows = bool(_DRIVE.match(file))
    if not windows and not target.startswith("/"):
        return target.removeprefix("./") or None
    for checkout in checkouts:
        prefix = (checkout or "").replace("\\", "/").rstrip("/")
        if not prefix:
            continue
        head = target[: len(prefix) + 1]
        if (head.casefold() if windows else head) == (
            prefix.casefold() if windows else prefix
        ) + "/":
            return target[len(prefix) + 1 :] or None
    return None


def _changed_files(payload: dict) -> list[str]:
    """Every file a change touched: its `fileName`, and each file of a patch."""
    changes = payload.get("changes") if isinstance(payload.get("changes"), list) else []
    files = [payload.get("fileName"), *(t3._mapping(change).get("path") for change in changes)]
    return [file for file in files if t3._text(file)]


def _checkouts(
    thread_id: str, threads: dict[str, t3.Thread], family: t3._Family
) -> list[str | None]:
    """The checkouts a thread works in: its own, then those of the threads above it. Never
    another session's: an edit there is not this session's change to its own work."""
    found: list[str | None] = []
    seen: set[str] = set()
    current: str | None = thread_id
    while current and current not in seen:
        seen.add(current)
        known = threads.get(current)
        found.append(known.worktree if known else None)
        current = family.parent(current)
    return found


def _moves(
    connection: sqlite3.Connection, family: t3._Family, since: str | None
) -> dict[str, list[str]]:
    """When each session, or a subagent of it, ran a command that moved its checkout."""
    might = " or ".join(f"payload_json like '%{word}%'" for word in _MIGHT_MOVE)
    where, arguments = ("and updated_at >= ?", [since]) if since else ("", [])
    moves: dict[str, list[str]] = {}
    for thread_id, updated_at, payload_json in connection.execute(
        f"select thread_id, updated_at, payload_json from {t3.ITEMS} "
        f"where type = '{t3.COMMAND}' and ({might}) {where}",
        arguments,
    ):
        payload = t3._object(payload_json)
        if payload.get("status") == t3.DONE and moves_checkout(t3.command_of(payload)):
            moves.setdefault(family.session(thread_id), []).append(updated_at)
    return moves


def read_changes(  # noqa: C901, PLR0912, PLR0915 - one pass over the store
    connection: sqlite3.Connection,
    *,
    since: str | None,
    required: Callable[[str, str], list[tuple[str, str]]],
    all_keys: bool = False,
) -> Changes:
    """Every change to a required path the store shows at or after `since`.

    `required(workspace_root, path)` gives the (skill, rule) pairs a project requires for a
    path inside its checkout. One change is returned per turn and skill: an edit seen both as
    a file change and in its turn's checkpoint is one, at the edit's own time.
    """
    result = Changes()
    projects = {
        project_id: root
        for project_id, root in connection.execute(
            f"select project_id, workspace_root from {t3.PROJECTS}"
        )
        if t3._text(root)
    }
    threads = t3._threads(connection)
    family = t3._Family(threads, t3._parents(connection))
    run_column = "run_id" if "run_id" in t3._columns(connection, t3.ITEMS) else "null"
    if all_keys:
        result.keys = {
            str(row[0]) for row in connection.execute(f"select turn_item_id from {t3.ITEMS}")
        }
        if run_column != "null":
            result.keys |= {
                f"run:{row[0]}"
                for row in connection.execute(
                    f"select distinct run_id from {t3.ITEMS} where run_id is not null"
                )
            }

    where, arguments = ("and updated_at >= ?", [since]) if since else ("", [])
    rows = connection.execute(
        f"""
        select turn_item_id, thread_id, type, updated_at, {run_column}, payload_json
        from {t3.ITEMS} where type in ('{CHANGE}', '{CHECKPOINT}') {where}
        order by updated_at
        """,
        arguments,
    )
    edits: dict[tuple[str, str, str], tuple[str, str, str | None]] = {}  # precise evidence
    turns: dict[str, list[tuple[str, str, set[tuple[str, str]], str | None]]] = {}
    shaped = {CHANGE: [0, 0], CHECKPOINT: [0, 0]}  # seen, as expected
    for item_id, thread_id, kind, updated_at, run_id, payload_json in rows:
        payload = t3._object(payload_json)
        shaped[kind][0] += 1
        session = family.session(thread_id)
        own, top = threads.get(thread_id), threads.get(session)
        project_id = (top.project_id if top else None) or (own.project_id if own else None)
        root = projects.get(project_id or "")
        key = f"run:{run_id}" if run_id else str(item_id)
        if kind == CHANGE:
            shaped[kind][1] += isinstance(payload.get("fileName"), str) and isinstance(
                payload.get("status"), str
            )
            if not root or payload.get("status") != t3.DONE:
                continue
            checkouts = [*_checkouts(thread_id, threads, family), root]
            at = t3._text(payload.get("startedAt")) or updated_at
            for file in _changed_files(payload):
                path = inside(file, checkouts)
                for skill, rule in required(root, path) if path else []:
                    earlier = edits.get((session, key, skill))
                    if earlier is None or at < earlier[0]:
                        edits[(session, key, skill)] = (at, rule, project_id)
        else:
            files = payload.get("files")
            shaped[kind][1] += isinstance(files, list)
            paths = (
                [t3._text(t3._mapping(file).get("path")) for file in files or []]
                if isinstance(files, list)
                else []
            )
            needs = {
                pair
                for path in paths
                if path
                for pair in (required(root, path.replace("\\", "/")) if root else [])
            }
            turns.setdefault(session, []).append((updated_at, key, needs, project_id))
    missing = [
        f"{t3.ITEMS}.payload_json of {kind}"
        for kind, (seen, ok) in shaped.items()
        if seen and not ok
    ]
    if missing:
        raise t3.SchemaChanged(missing)

    # the checkpoint before the window, per session: the lower bound of its first turn here
    before: dict[str, str] = {}
    if since:
        for thread_id, latest in connection.execute(
            f"select thread_id, max(updated_at) from {t3.ITEMS} "
            f"where type = '{CHECKPOINT}' and updated_at < ? group by thread_id",
            [since],
        ):
            session = family.session(thread_id)
            before[session] = max(before.get(session, ""), latest)
    # the turn before each session's first checkpoint here began at its previous checkpoint,
    # or when the session did; commands are read from the earliest of those on
    starts = {
        session: before.get(session)
        or (threads[session].created_at if session in threads else None)
        for session in turns
    }
    known_starts = [start for start in starts.values() if start]
    whole = not since or len(known_starts) < len(starts)
    moves = _moves(connection, family, None if whole else min(known_starts)) if turns else {}

    for session, checkpoints in turns.items():
        previous = starts[session]
        for at, key, needs, project_id in sorted(checkpoints, key=lambda entry: entry[0]):
            moved = any(
                (previous is None or previous < moment) and moment <= at
                for moment in moves.get(session, ())
            )
            for skill, rule in () if moved else sorted(needs):
                if (session, key, skill) not in edits:
                    began = previous or UNKNOWN_START
                    result.seen.append(Seen(key, at, began, skill, rule, session, project_id))
            previous = at
    for (session, key, skill), (at, rule, project_id) in edits.items():
        result.seen.append(Seen(key, at, None, skill, rule, session, project_id))
    result.seen.sort(key=lambda seen: seen.at)
    return result
