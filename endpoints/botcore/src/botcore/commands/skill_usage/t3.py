"""T3 Code's local store as a source of skill loads.

T3 Code records every tool call, shell command and message of the threads it runs, for each
provider it drives, so one read covers Claude and Codex alike. The store is another program's
internal schema, not an interface: it is opened read-only, everything is read from one
snapshot, the tables, columns and payload fields used here are checked, and a change is
reported instead of guessed at.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from botcore.commands.skill_usage.events import (
    DELEGATE,
    EDIT,
    FILE_READ,
    MAIN,
    SHELL_READ,
    SKILL_TOOL,
    SUBAGENT,
    TYPED,
    clean_skill_name,
    skill_of_file,
    skill_of_folder,
    skills_read_by,
    typed_skill,
)

SOURCE = "t3-code"
ITEMS = "orchestration_v2_projection_turn_items"
THREADS = "orchestration_v2_projection_threads"
SUBAGENTS = "orchestration_v2_projection_subagents"
RUNS = "orchestration_v2_projection_runs"
PROJECTS = "projection_projects"
REQUIRED: dict[str, set[str]] = {
    ITEMS: {"turn_item_id", "thread_id", "type", "updated_at", "payload_json"},
    THREADS: {"thread_id", "project_id", "payload_json"},
    PROJECTS: {"project_id", "workspace_root"},
}
# Tables an older store may lack. One that is present must have these columns.
OPTIONAL: dict[str, set[str]] = {
    SUBAGENTS: {"thread_id", "child_thread_id"},
    RUNS: {"run_id", "payload_json"},
}
TOOL, COMMAND, MESSAGE, CHANGE = "dynamic_tool", "command_execution", "user_message", "file_change"
KINDS = (TOOL, COMMAND, MESSAGE, CHANGE)
MIN_ITEMS_TO_JUDGE_KINDS = 50
HARNESSES = {"claudeAgent": "claude", "codex": "codex"}
READ_TOOLS = {"read", "read_file", "view"}
FILE_KEYS = ("file_path", "filePath", "path")
DONE = "completed"
PERSON = "user"
DELEGATED_PREFIX = "thread:delegated-task:"
SUBAGENT_PREFIXES = ("thread:subagent:", "thread:provider:")
FORK = "fork"


class StoreUnreadable(Exception):
    """The store exists but could not be opened or queried."""


class SchemaChanged(Exception):
    """A table, column or payload field this reader needs is gone."""

    def __init__(self, missing: list[str]) -> None:
        super().__init__(", ".join(missing))
        self.missing = missing


@dataclass
class Thread:
    project_id: str | None
    parent: str | None
    relationship: str | None
    remote_parent: str | None  # the thread, on another machine, that delegated this one
    provider: str | None
    model: str | None  # its current setting: the truth only for a thread that cannot switch
    created_at: str | None = None
    updated_at: str | None = None
    pull_requests: tuple[tuple[str, str | None], ...] = ()  # (owner/name#number, linked at)
    worktree: str | None = None  # the checkout it works in


@dataclass
class Load:
    """One load as the store shows it, before its project is named."""

    item: str  # the store's own id for the recorded item
    native: str | None
    at: str
    skill: str
    path: str
    harness: str
    thread: str
    root: str
    agent: str
    project_id: str | None
    model: str | None


@dataclass
class Session:
    """A session the store holds, whether or not it loaded a skill: the denominator of every
    rate, and what ties a session to the pull requests it produced."""

    id: str
    root: str
    agent: str
    harness: str
    project_id: str | None
    created_at: str | None
    updated_at: str | None
    pull_requests: tuple[tuple[str, str | None], ...]


@dataclass
class T3Read:
    loads: list[Load] = field(default_factory=list)
    sessions: list[Session] = field(default_factory=list)
    projects: dict[str, str] = field(default_factory=dict)  # project id -> workspace root
    items: set[str] | None = None  # every item the store holds, when asked for
    scanned: int = 0
    newest: str | None = None


def open_store(path: Path) -> sqlite3.Connection:
    """Open the store without being able to change it, and hold one snapshot of it: every
    query on the connection then sees the same committed state, however long the read takes
    and whatever T3 Code writes meanwhile."""
    try:
        connection = sqlite3.connect(
            f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=10, isolation_level=None
        )
        connection.execute("begin")
        connection.execute("select 1 from sqlite_master limit 1").fetchall()
    except sqlite3.Error as exc:
        raise StoreUnreadable(str(exc)) from exc
    return connection


def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"pragma table_info({table})")}


def check_schema(connection: sqlite3.Connection) -> None:
    """Raise SchemaChanged naming every table or column that is missing."""
    missing: list[str] = []
    for table, needed in REQUIRED.items():
        have = _columns(connection, table)
        if not have:
            missing.append(table)
        else:
            missing.extend(f"{table}.{column}" for column in sorted(needed - have))
    for table, needed in OPTIONAL.items():
        have = _columns(connection, table)
        if have:
            missing.extend(f"{table}.{column}" for column in sorted(needed - have))
    if missing:  # before any query that needs what is missing
        raise SchemaChanged(missing)
    total = connection.execute(f"select count(*) from {ITEMS}").fetchone()[0]
    kinds = ", ".join(f"'{kind}'" for kind in KINDS)
    known = connection.execute(f"select count(*) from {ITEMS} where type in ({kinds})").fetchone()[
        0
    ]
    if total >= MIN_ITEMS_TO_JUDGE_KINDS and not known:
        raise SchemaChanged([f"{ITEMS}.type values ({', '.join(KINDS)})"])


def _object(text: str | None) -> dict:
    try:
        data = json.loads(text) if text else None
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _mapping(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _moment(value: object) -> str | None:
    """A time as the store wrote it, kept only when it is a time: no other text reaches the
    record through a field that should hold one."""
    try:
        parsed = datetime.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None
    if parsed is None:
        return None
    parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _pull_requests(value: object) -> tuple[tuple[str, str | None], ...]:
    """The pull requests T3 Code linked to a thread, as `owner/name#number`, each with when
    it was linked."""
    found: list[tuple[str, str | None]] = []
    for entry in value if isinstance(value, list) else []:
        entry = _mapping(entry)
        repository, number = _text(entry.get("repository")), entry.get("number")
        if repository and isinstance(number, int):
            found.append((f"{repository}#{number}", _moment(entry.get("linkedAt"))))
    return tuple(found)


def _threads(connection: sqlite3.Connection) -> dict[str, Thread]:
    provider = "default_provider" if "default_provider" in _columns(connection, THREADS) else "null"
    threads: dict[str, Thread] = {}
    rows = connection.execute(
        f"select thread_id, project_id, {provider}, payload_json from {THREADS}"
    )
    for thread_id, project_id, default_provider, payload_json in rows:
        payload = _object(payload_json)
        lineage = _mapping(payload.get("lineage"))
        threads[thread_id] = Thread(
            project_id=_text(project_id),
            parent=_text(lineage.get("parentThreadId")),
            relationship=_text(lineage.get("relationshipToParent")),
            remote_parent=_text(_mapping(payload.get("delegatedFrom")).get("threadId")),
            provider=_text(default_provider),
            model=_text(_mapping(payload.get("modelSelection")).get("model")),
            created_at=_text(payload.get("createdAt")),
            updated_at=_text(payload.get("updatedAt")),
            pull_requests=_pull_requests(payload.get("pullRequests")),
            worktree=_text(payload.get("worktreePath")),
        )
    return threads


def _parents(connection: sqlite3.Connection) -> dict[str, str]:
    """Child thread to the thread that started it, where the store keeps that table."""
    if not _columns(connection, SUBAGENTS):
        return {}
    rows = connection.execute(
        f"select child_thread_id, thread_id from {SUBAGENTS} where child_thread_id is not null"
    )
    return {child: parent for child, parent in rows if parent}


def _models(connection: sqlite3.Connection) -> dict[str, str]:
    """Run to the model it ran on. A session's own model setting is its latest, so it would
    relabel an earlier run after a switch. A subagent's thread has no runs and cannot switch,
    so its setting is used for it."""
    if not _columns(connection, RUNS):
        return {}
    models: dict[str, str] = {}
    for run_id, payload_json in connection.execute(f"select run_id, payload_json from {RUNS}"):
        model = _text(_mapping(_object(payload_json).get("modelSelection")).get("model"))
        if model:
            models[run_id] = model
    return models


class _Family:
    """Which session and which person-started thread a thread belongs to."""

    def __init__(self, threads: dict[str, Thread], parents: dict[str, str]) -> None:
        self.threads = threads
        self.parents = parents

    def parent(self, thread_id: str) -> str | None:
        known = self.threads.get(thread_id)
        return (known.parent if known else None) or self.parents.get(thread_id)

    def _starts_session(self, thread_id: str) -> bool:
        """A delegated task, here or from another machine, and a fork a person continued are
        sessions of their own."""
        known = self.threads.get(thread_id)
        return thread_id.startswith(DELEGATED_PREFIX) or bool(
            known and (known.remote_parent or known.relationship == FORK)
        )

    def session(self, thread_id: str) -> str:
        seen = {thread_id}
        while not self._starts_session(thread_id):
            parent = self.parent(thread_id)
            if not parent or parent in seen:
                break
            seen.add(parent)
            thread_id = parent
        return thread_id

    def root(self, thread_id: str) -> str:
        """The thread a person started. For a task delegated from another machine that is
        the delegating thread's id there, which that machine's record uses too."""
        seen = {thread_id}
        while True:
            known = self.threads.get(thread_id)
            if known and known.relationship == FORK:
                return thread_id
            if known and known.remote_parent:
                return known.remote_parent
            parent = self.parent(thread_id)
            if not parent or parent in seen:
                return thread_id
            seen.add(parent)
            thread_id = parent

    def role(self, thread_id: str, session: str) -> str:
        if thread_id != session or thread_id.startswith(SUBAGENT_PREFIXES):
            return SUBAGENT
        known = self.threads.get(session)
        delegated = session.startswith(DELEGATED_PREFIX) or bool(known and known.remote_parent)
        return DELEGATE if delegated else MAIN


@dataclass
class _Shapes:
    """Whether the recorded items still look as this reader expects. Rows that match the
    query but none of which carries the fields read here mean the payload changed, which
    would otherwise read as nobody loading a skill."""

    seen: dict[str, int] = field(default_factory=lambda: dict.fromkeys(KINDS, 0))
    shaped: dict[str, int] = field(default_factory=lambda: dict.fromkeys(KINDS, 0))

    def note(self, kind: str, payload: dict) -> None:
        self.seen[kind] += 1
        status = isinstance(payload.get("status"), str)
        if kind == TOOL:
            ok = isinstance(payload.get("toolName"), str) and status
        elif kind == COMMAND:
            ok = "input" in payload and status
        elif kind == CHANGE:
            ok = isinstance(payload.get("fileName"), str) and status
        else:
            ok = isinstance(payload.get("text"), str) and isinstance(payload.get("createdBy"), str)
        self.shaped[kind] += ok

    def check(self) -> None:
        fields = {
            TOOL: "toolName, status",
            COMMAND: "input, status",
            MESSAGE: "text, createdBy",
            CHANGE: "fileName, status",
        }
        missing = [
            f"{ITEMS}.payload_json of {kind} ({fields[kind]})"
            for kind in KINDS
            if self.seen[kind] and not self.shaped[kind]
        ]
        if missing:
            raise SchemaChanged(missing)


def command_of(payload: dict) -> str:
    """The command a recorded item ran, as text; never its output."""
    command = payload.get("input")
    if isinstance(command, dict):
        command = command.get("command")
    if isinstance(command, list):
        command = " ".join(str(part) for part in command)
    return command if isinstance(command, str) else ""


def _loads(kind: str, payload: dict) -> list[tuple[str, str]]:
    """(skill, path) for each load one recorded item shows, and for each change to a skill's
    files (path `edit`). A tool call, command or change counts only once it completed, and a
    message only when the person wrote it."""
    if kind == MESSAGE:
        if payload.get("createdBy") != PERSON:  # a brief an agent or the system wrote
            return []
        name = typed_skill(_text(payload.get("text")) or "")
        return [(name, TYPED)] if name else []
    if payload.get("status") != DONE:
        return []
    if kind == CHANGE:
        changes = payload.get("changes") if isinstance(payload.get("changes"), list) else []
        files = [payload.get("fileName"), *(_mapping(change).get("path") for change in changes)]
        names: list[str] = []
        for file in files:
            name = skill_of_folder(_text(file) or "")
            if name and name not in names:
                names.append(name)
        return [(name, EDIT) for name in names]
    if kind == TOOL:
        tool = _text(payload.get("toolName")) or ""
        tool_input = _mapping(payload.get("input"))
        if tool == "Skill":
            name = clean_skill_name(_text(tool_input.get("skill")) or "")
            return [(name, SKILL_TOOL)] if name else []
        if tool.lower() in READ_TOOLS:
            for key in FILE_KEYS:
                name = skill_of_file(_text(tool_input.get(key)) or "")
                if name:
                    return [(name, FILE_READ)]
        return []
    return [(name, SHELL_READ) for name in skills_read_by(command_of(payload))]


def _sessions(threads: dict[str, Thread], family: _Family) -> list[Session]:
    sessions: list[Session] = []
    for thread_id, thread in threads.items():
        if thread_id.startswith(SUBAGENT_PREFIXES) or family.session(thread_id) != thread_id:
            continue
        sessions.append(
            Session(
                id=thread_id,
                root=family.root(thread_id),
                agent=family.role(thread_id, thread_id),
                harness=HARNESSES.get(thread.provider or "", thread.provider or "other"),
                project_id=thread.project_id,
                created_at=thread.created_at,
                updated_at=thread.updated_at,
                pull_requests=thread.pull_requests,
            )
        )
    return sessions


def read(connection: sqlite3.Connection, *, since: str | None, all_items: bool = False) -> T3Read:
    """Every skill load, and change to a skill's files, the store shows at or after `since`
    (an ISO time), oldest first; and every session it holds.

    A typed name is returned as a load too; the caller keeps it only when the name is a skill.
    `all_items` also returns the id of every item the store holds, for a rebuild.
    """
    result = T3Read()
    for project_id, workspace_root in connection.execute(
        f"select project_id, workspace_root from {PROJECTS}"
    ):
        if _text(workspace_root):
            result.projects[project_id] = workspace_root
    threads = _threads(connection)
    family = _Family(threads, _parents(connection))
    children = [
        thread_id
        for thread_id in threads
        if thread_id.startswith((DELEGATED_PREFIX, *SUBAGENT_PREFIXES))
    ]
    if children and not any(family.parent(thread_id) for thread_id in children):
        # every subagent would become a session of its own, and every share would shrink
        raise SchemaChanged([f"{THREADS}.payload_json lineage.parentThreadId"])
    result.sessions = _sessions(threads, family)
    models = _models(connection)
    if all_items:
        result.items = {
            str(row[0]) for row in connection.execute(f"select turn_item_id from {ITEMS}")
        }
    run_column = "run_id" if "run_id" in _columns(connection, ITEMS) else "null"

    where, arguments = "", []
    if since:
        where, arguments = "and updated_at >= ?", [since]
    result.newest = _text(connection.execute(f"select max(updated_at) from {ITEMS}").fetchone()[0])
    rows = connection.execute(
        f"""
        select turn_item_id, thread_id, type, updated_at, {run_column}, payload_json from {ITEMS}
        where (
            (type = '{TOOL}'
                and (payload_json like '%SKILL.md%' or payload_json like '%"Skill"%'))
            or (type = '{COMMAND}' and payload_json like '%SKILL.md%')
            or (type = '{CHANGE}' and payload_json like '%skills%')
            or type = '{MESSAGE}'
        ) {where}
        order by updated_at
        """,
        arguments,
    )

    shapes = _Shapes()
    for item_id, thread_id, kind, updated_at, run_id, payload_json in rows:
        result.scanned += 1
        payload = _object(payload_json)
        shapes.note(kind, payload)
        loads = _loads(kind, payload)
        if not loads:
            continue
        session = family.session(thread_id)
        own, top = threads.get(thread_id), threads.get(session)
        native = _mapping(payload.get("nativeItemRef"))
        driver = _text(native.get("driver")) or (own.provider if own else None) or ""
        harness = HARNESSES.get(driver, driver or "other")
        native_id = _text(native.get("nativeId"))
        for name, path in loads:
            result.loads.append(
                Load(
                    item=str(item_id),
                    native=f"{harness}:{native_id}" if native_id else None,
                    at=_text(payload.get("startedAt"))
                    or _text(payload.get("updatedAt"))
                    or updated_at,
                    skill=name,
                    path=path,
                    harness=harness,
                    thread=session,
                    root=family.root(thread_id),
                    agent=family.role(thread_id, session),
                    project_id=(top.project_id if top else None)
                    or (own.project_id if own else None),
                    model=models.get(run_id)
                    if run_id
                    else (own.model if own and thread_id != session else None),
                )
            )
    shapes.check()
    result.loads.sort(key=lambda load: load.at)
    return result
