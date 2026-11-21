"""T3 Code's local store as a source of skill loads.

T3 Code records every tool call, shell command and message of the threads it runs, for each
provider it drives, so one read covers Claude and Codex alike. The store is another program's
internal schema, not an interface: it is opened read-only, the tables and columns used here are
checked first, and a change is reported instead of guessed at.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from botcore.commands.skill_usage.events import (
    DELEGATE,
    FILE_READ,
    MAIN,
    SHELL_READ,
    SKILL_TOOL,
    SUBAGENT,
    TYPED,
    Event,
    skill_of_file,
    skills_read_by,
    typed_skill,
)

SOURCE = "t3-code"
ITEMS = "orchestration_v2_projection_turn_items"
THREADS = "orchestration_v2_projection_threads"
SUBAGENTS = "orchestration_v2_projection_subagents"
PROJECTS = "projection_projects"
REQUIRED: dict[str, set[str]] = {
    ITEMS: {"thread_id", "type", "updated_at", "payload_json"},
    THREADS: {"thread_id", "project_id", "payload_json"},
    PROJECTS: {"project_id", "workspace_root"},
}
HARNESSES = {"claudeAgent": "claude", "codex": "codex"}
READ_TOOLS = {"read", "read_file", "view"}
SKILL_DIRS = (".claude/skills", ".agents/skills", ".codex/skills")
DELEGATED_PREFIX = "thread:delegated-task:"
SUBAGENT_PREFIXES = ("thread:subagent:", "thread:provider:")
UNKNOWN_PROJECT = "unknown"


class StoreUnreadable(Exception):
    """The store exists but could not be opened or queried."""


class SchemaChanged(Exception):
    """A table or column this reader needs is gone."""

    def __init__(self, missing: list[str]) -> None:
        super().__init__(", ".join(missing))
        self.missing = missing


@dataclass
class Thread:
    project_id: str | None
    parent: str | None
    root: str | None
    model: str | None
    provider: str | None


@dataclass
class T3Read:
    events: list[Event] = field(default_factory=list)
    projects: dict[str, str] = field(default_factory=dict)  # project name -> workspace root
    scanned: int = 0
    newest: str | None = None


def open_store(path: Path) -> sqlite3.Connection:
    """Open the store without being able to change it."""
    try:
        connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=10)
        connection.execute("select 1 from sqlite_master limit 1").fetchall()
    except sqlite3.Error as exc:
        raise StoreUnreadable(str(exc)) from exc
    connection.row_factory = sqlite3.Row
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
    if missing:
        raise SchemaChanged(missing)


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
            root=_text(lineage.get("rootThreadId")),
            model=_text(_mapping(payload.get("modelSelection")).get("model")),
            provider=_text(default_provider),
        )
    return threads


def _parents(connection: sqlite3.Connection) -> dict[str, str]:
    """Child thread to the thread that started it, where the store keeps that table."""
    if not {"thread_id", "child_thread_id"} <= _columns(connection, SUBAGENTS):
        return {}
    rows = connection.execute(
        f"select child_thread_id, thread_id from {SUBAGENTS} where child_thread_id is not null"
    )
    return {child: parent for child, parent in rows if parent}


def _parent(thread_id: str, threads: dict[str, Thread], parents: dict[str, str]) -> str | None:
    known = threads.get(thread_id)
    return (known.parent if known else None) or parents.get(thread_id)


def _session(thread_id: str, threads: dict[str, Thread], parents: dict[str, str]) -> str:
    """The session a thread works for: itself when a person started it or it is a delegated
    task, otherwise the nearest such thread above it."""
    seen = {thread_id}
    while not thread_id.startswith(DELEGATED_PREFIX):
        parent = _parent(thread_id, threads, parents)
        if not parent or parent in seen:
            break
        seen.add(parent)
        thread_id = parent
    return thread_id


def _root(thread_id: str, threads: dict[str, Thread], parents: dict[str, str]) -> str:
    """The thread a person started, above this one."""
    known = threads.get(thread_id)
    if known and known.root:
        return known.root
    seen = {thread_id}
    while True:
        parent = _parent(thread_id, threads, parents)
        if not parent or parent in seen:
            return thread_id
        seen.add(parent)
        thread_id = parent


def _role(thread_id: str, session: str, root: str) -> str:
    if thread_id != session or thread_id.startswith(SUBAGENT_PREFIXES):
        return SUBAGENT
    return MAIN if session == root else DELEGATE


def skill_on_disk(root: str, name: str) -> bool:
    """Whether a checkout holds a skill of this name."""
    return any((Path(root) / folder / name / "SKILL.md").is_file() for folder in SKILL_DIRS)


def _loads(kind: str, payload: dict) -> list[tuple[str, str]]:
    """(skill, path) for each load one recorded item shows, typed names included."""
    if kind == "dynamic_tool":
        tool = _text(payload.get("toolName")) or ""
        tool_input = _mapping(payload.get("input"))
        if tool == "Skill":
            name = _text(tool_input.get("skill"))
            return [(name, SKILL_TOOL)] if name else []
        if tool.lower() in READ_TOOLS:
            target = _text(tool_input.get("file_path")) or _text(tool_input.get("path")) or ""
            name = skill_of_file(target)
            return [(name, FILE_READ)] if name else []
        return []
    if kind == "command_execution":
        command = payload.get("input")
        if isinstance(command, dict):
            command = command.get("command")
        if isinstance(command, list):
            command = " ".join(str(part) for part in command)
        return [(name, SHELL_READ) for name in skills_read_by(command)] if _text(command) else []
    if kind == "user_message":
        if payload.get("createdBy") == "agent":  # a brief one agent wrote for another
            return []
        name = typed_skill(_text(payload.get("text")) or "")
        return [(name, TYPED)] if name else []
    return []


def read(
    connection: sqlite3.Connection,
    *,
    since: str | None,
    machine: str,
    known_skill: Callable[[str, str], bool],
) -> T3Read:
    """Every skill load the store shows at or after `since` (an ISO time), oldest first.

    `known_skill(project, name)` says whether a name is already known as a skill there; a
    typed name counts only when it is, when this read shows the skill loaded another way, or
    when the project's checkout holds it.
    """
    result = T3Read()
    projects: dict[str, tuple[str, str]] = {}  # project id -> (name, workspace root)
    for project_id, workspace_root in connection.execute(
        f"select project_id, workspace_root from {PROJECTS}"
    ):
        if _text(workspace_root):
            name = Path(workspace_root).name or project_id
            projects[project_id] = (name, workspace_root)
            result.projects[name] = workspace_root
    threads = _threads(connection)
    parents = _parents(connection)

    where, arguments = "", []
    if since:
        where, arguments = "and updated_at >= ?", [since]
    newest = connection.execute(f"select max(updated_at) from {ITEMS}").fetchone()[0]
    result.newest = _text(newest)
    rows = connection.execute(
        f"""
        select thread_id, type, updated_at, payload_json from {ITEMS}
        where (
            (type = 'dynamic_tool'
                and (payload_json like '%SKILL.md%' or payload_json like '%"Skill"%'))
            or (type = 'command_execution' and payload_json like '%SKILL.md%')
            or type = 'user_message'
        ) {where}
        order by updated_at
        """,
        arguments,
    )

    typed: list[Event] = []
    seen: set[tuple[str, str]] = set()  # (project, skill) loaded some other way in this read
    for thread_id, kind, updated_at, payload_json in rows:
        result.scanned += 1
        payload = _object(payload_json)
        loads = _loads(kind, payload)
        if not loads:
            continue
        root = _root(thread_id, threads, parents)
        session = _session(thread_id, threads, parents)
        own, top = threads.get(thread_id), threads.get(root)
        project_id = (top.project_id if top else None) or (own.project_id if own else None)
        project = projects.get(project_id or "", (UNKNOWN_PROJECT, ""))[0]
        native = _mapping(payload.get("nativeItemRef"))
        driver = _text(native.get("driver")) or (own.provider if own else None) or ""
        harness = HARNESSES.get(driver, driver or "other")
        # The harness's own id for the item, where it has one, so that the same load read from
        # another source of that harness is the same event
        native_id = _text(native.get("nativeId"))
        item = (
            f"{harness}:{native_id}"
            if native_id
            else f"t3:{_text(payload.get('id')) or f'{thread_id}@{updated_at}'}"
        )
        for name, path in loads:
            event = Event(
                id=f"{item}:{name}",
                at=_text(payload.get("startedAt")) or _text(payload.get("updatedAt")) or updated_at,
                skill=name,
                path=path,
                harness=harness,
                source=SOURCE,
                thread=session,
                root=root,
                agent=_role(thread_id, session, root),
                project=project,
                machine=machine,
                model=(own.model if own else None) or (top.model if top else None),
            )
            if path == TYPED:
                typed.append(event)
            else:
                seen.add((project, name))
                result.events.append(event)

    roots = dict(projects.values())
    for event in typed:
        key = (event.project, event.skill)
        root_folder = roots.get(event.project)
        if (
            key in seen
            or known_skill(*key)
            or (root_folder and skill_on_disk(root_folder, event.skill))
        ):
            result.events.append(event)
    result.events.sort(key=lambda event: event.at)
    return result
