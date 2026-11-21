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
    "merge", "pull", "rebase", "cherry-pick", "reset", "restore", "checkout", "switch",
    "base:sync", "base-sync",
)  # fmt: skip
_DRIVE = re.compile(r"^[A-Za-z]:[\\/]")
_NESTED_WORKTREE = re.compile(r"^\.claude/worktrees/[^/]+/")
# When a turn began is not known: a load at any earlier time may have come after the change
UNKNOWN_START = "0001-01-01T00:00:00.000Z"

Needs = dict[tuple[str, str], set[str]]  # (skill, rule) -> the required paths changed


@dataclass
class Seen:
    """A turn, or one edit, in which a session changed a path that requires a skill.

    `at` is when the change is known to have been made by: an edit's own moment, or the end
    of the turn. `since` is set when part of it is known only from the end of the turn: the
    earliest that part can have happened."""

    key: str  # `run:<id>` for a turn, else the store's id for the item
    at: str
    since: str | None
    skill: str
    rule: str
    thread: str
    project_id: str | None


@dataclass
class Changes:
    seen: list[Seen] = field(default_factory=list)
    keys: set[str] | None = None  # every turn and item the store holds, when asked for


@dataclass
class _Edit:
    at: str
    key: str | None  # its turn, when the store says which
    item: str
    needs: Needs
    project_id: str | None
    placed: bool = False


@dataclass
class _Turn:
    at: str
    key: str
    needs: Needs
    project_id: str | None


def inside(file: str, checkouts: list[str | None]) -> str | None:
    """A changed file as a forward-slash path inside its session's checkout. A path that is
    not absolute is already inside it. Windows paths compare without regard to case. A
    checkout nested in another (`.claude/worktrees/<name>/`) is the checkout."""
    target = file.replace("\\", "/")
    windows = bool(_DRIVE.match(file))
    relative: str | None = None
    if not windows and not target.startswith("/"):
        relative = target.removeprefix("./")
    else:
        compared = target.casefold() if windows else target
        for checkout in checkouts:
            prefix = (checkout or "").replace("\\", "/").rstrip("/")
            if prefix and compared.startswith((prefix.casefold() if windows else prefix) + "/"):
                relative = target[len(prefix) + 1 :]
                break
    return (_NESTED_WORKTREE.sub("", relative) or None) if relative else None


def _changed_files(payload: dict) -> list[str]:
    """Every file a change touched: its `fileName`, and each file of a patch."""
    changes = payload.get("changes") if isinstance(payload.get("changes"), list) else []
    files = [payload.get("fileName"), *(t3._mapping(change).get("path") for change in changes)]
    return [file for file in files if t3._text(file)]


def _checkouts(
    thread_id: str, session: str, threads: dict[str, t3.Thread], family: t3._Family
) -> list[str | None]:
    """The checkouts a thread works in: its own, then those above it up to its session's.
    Past the session only while none is known, for a task that shares the checkout of the
    thread that started it. Never a sibling session's."""
    found: list[str | None] = []
    seen: set[str] = set()
    current: str | None = thread_id
    reached = False
    while current and current not in seen:
        seen.add(current)
        known = threads.get(current)
        found.append(known.worktree if known else None)
        reached = reached or current == session
        if reached and any(found):
            break
        current = family.parent(current)
    return found


def _moves(
    connection: sqlite3.Connection, family: t3._Family, sessions: set[str], since: str | None
) -> dict[str, list[str]]:
    """When each of these sessions, or a subagent of it, ran a command that moves its
    checkout. However the command ended: a merge that stopped on a conflict has already put
    other people's files in the checkout."""
    might = " or ".join(f"payload_json like '%{word}%'" for word in _MIGHT_MOVE)
    where, arguments = ("and updated_at >= ?", [since]) if since else ("", [])
    moves: dict[str, list[str]] = {}
    for thread_id, updated_at, payload_json in connection.execute(
        f"select thread_id, updated_at, payload_json from {t3.ITEMS} "
        f"where type = '{t3.COMMAND}' and ({might}) {where}",
        arguments,
    ):
        session = family.session(thread_id)
        moment = t3._moment(updated_at)
        if session not in sessions or moment is None:
            continue
        if moves_checkout(t3.command_of(t3._object(payload_json))):
            moves.setdefault(session, []).append(moment)
    return moves


def _merged(*all_needs: Needs) -> Needs:
    merged: Needs = {}
    for needs in all_needs:
        for pair, paths in needs.items():
            merged.setdefault(pair, set()).update(paths)
    return merged


def read_changes(  # noqa: C901, PLR0912, PLR0915 - one pass over the store
    connection: sqlite3.Connection,
    *,
    since: str | None,
    required: Callable[[str, str], list[tuple[str, str]]],
    all_keys: bool = False,
) -> Changes:
    """Every change to a required path the store shows at or after `since`.

    `required(workspace_root, path)` gives the (skill, rule) pairs a project requires for a
    path inside its checkout. One change is returned per turn and skill. An edit seen both as
    a file change and in its turn's checkpoint is one, at the edit's own time; where the
    checkpoint shows a required path no edit covers, the turn keeps its lower bound.
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
    edits: dict[str, list[_Edit]] = {}
    turns: dict[str, list[_Turn]] = {}
    shaped = {CHANGE: [0, 0], CHECKPOINT: [0, 0]}  # seen, as expected
    for item_id, thread_id, kind, updated_at, run_id, payload_json in rows:
        payload = t3._object(payload_json)
        shaped[kind][0] += 1
        session = family.session(thread_id)
        own, top = threads.get(thread_id), threads.get(session)
        project_id = (top.project_id if top else None) or (own.project_id if own else None)
        root = projects.get(project_id or "")
        key = f"run:{run_id}" if run_id else None
        needs: Needs = {}
        if kind == CHANGE:
            shaped[kind][1] += isinstance(payload.get("fileName"), str) and isinstance(
                payload.get("status"), str
            )
            at = t3._moment(payload.get("startedAt")) or t3._moment(updated_at)
            if not root or at is None or payload.get("status") != t3.DONE:
                continue
            checkouts = [*_checkouts(thread_id, session, threads, family), root]
            for file in _changed_files(payload):
                path = inside(file, checkouts)
                for pair in required(root, path) if path else []:
                    needs.setdefault(pair, set()).add(path)
            if needs:
                edits.setdefault(session, []).append(
                    _Edit(at, key, str(item_id), needs, project_id)
                )
        else:
            files = payload.get("files")
            shaped[kind][1] += isinstance(files, list)
            at = t3._moment(updated_at)
            if at is None:
                continue
            for file in files if isinstance(files, list) and root else []:
                path = t3._text(t3._mapping(file).get("path"))
                path = inside(path, []) if path else None
                for pair in required(root, path) if path else []:
                    needs.setdefault(pair, set()).add(path)
            turns.setdefault(session, []).append(_Turn(at, key or str(item_id), needs, project_id))
    missing = [
        f"{t3.ITEMS}.payload_json of {kind}"
        for kind, (seen, expected) in shaped.items()
        if seen and not expected
    ]
    if missing:
        raise t3.SchemaChanged(missing)

    # Only a session that changed a required path matters from here on
    relevant = {session for session, found in turns.items() if any(t.needs for t in found)}
    relevant |= set(edits)
    # Each one's first turn here began at its previous checkpoint, or when the session did
    before: dict[str, str] = {}
    if since and relevant:
        for thread_id, latest in connection.execute(
            f"select thread_id, max(updated_at) from {t3.ITEMS} "
            f"where type = '{CHECKPOINT}' and updated_at < ? group by thread_id",
            [since],
        ):
            session = family.session(thread_id)
            moment = t3._moment(latest)
            if session in relevant and moment:
                before[session] = max(before.get(session, ""), moment)
    starts = {
        session: before.get(session)
        or (t3._moment(threads[session].created_at) if session in threads else None)
        for session in relevant
    }
    checked = {session for session in relevant if any(t.needs for t in turns.get(session, []))}
    known = [starts[session] for session in checked if starts[session]]
    whole = not since or len(known) < len(checked)
    moves = _moves(connection, family, checked, None if whole else min(known)) if checked else {}

    def emit(turn_key: str, at: str, began: str | None, pair: tuple[str, str], session: str,
             project_id: str | None) -> None:  # fmt: skip
        result.seen.append(Seen(turn_key, at, began, pair[0], pair[1], session, project_id))

    for session in relevant:
        previous = starts[session]
        its_edits = edits.get(session, [])
        for turn in sorted(turns.get(session, []), key=lambda found: found.at):
            inside_turn = [
                edit
                for edit in its_edits
                if not edit.placed
                and (
                    edit.key == turn.key
                    if edit.key
                    else (previous is None or previous < edit.at) and edit.at <= turn.at
                )
            ]
            for edit in inside_turn:
                edit.placed = True
            moved = any(
                (previous is None or previous < moment) and moment <= turn.at
                for moment in moves.get(session, ())
            )
            edited = _merged(*(edit.needs for edit in inside_turn))
            left = {} if moved else turn.needs
            for pair in sorted(set(edited) | set(left)):
                began = previous or UNKNOWN_START
                if pair in edited:
                    at = min(edit.at for edit in inside_turn if pair in edit.needs)
                    covered = left.get(pair, set()) <= edited[pair]
                    emit(turn.key, at, None if covered else began, pair, session, turn.project_id)
                else:
                    emit(turn.key, turn.at, began, pair, session, turn.project_id)
            previous = turn.at
        loose: dict[tuple[str, tuple[str, str]], _Edit] = {}  # no checkpoint of its turn here
        for edit in its_edits:
            for pair in () if edit.placed else sorted(edit.needs):
                first = loose.setdefault((edit.key or edit.item, pair), edit)
                if edit.at < first.at:
                    loose[(edit.key or edit.item, pair)] = edit
        for (turn_key, pair), edit in loose.items():
            emit(turn_key, edit.at, None, pair, session, edit.project_id)
    result.seen.sort(key=lambda seen: seen.at)
    return result
