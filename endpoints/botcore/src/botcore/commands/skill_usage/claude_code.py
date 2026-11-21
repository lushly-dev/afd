"""Claude Code's own transcripts as a source: the sessions that never ran under T3 Code.

Claude Code writes each session as a file of JSON lines under `~/.claude/projects/<folder>/`,
and each of its subagents in a folder beside it. A session T3 Code ran is in T3 Code's store,
which knows more of it (its thread, its lineage, its pull requests), so it is left to that
source. Which sessions those are is told two ways: the transcript names the program that
started it, and the store holds the harness's own id of every tool call it recorded.

Read-only, and nothing but what a load is leaves a transcript: no prompt, command or file.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from botcore.commands.disk.git import GitError, git_out
from botcore.commands.skill_usage.events import (
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
)
from botcore.commands.skill_usage.t3 import Load, Session, _moment

SOURCE = "claude-code"
DIR_ENV = "BOTCORE_SKILL_USAGE_CLAUDE_DIR"
HARNESS = "claude"
PREFIX = "claude-code:"  # of a session's id in the record: T3 Code's threads have their own
T3_STARTED = "t3-code"  # the transcript's `entrypoint` when T3 Code started the session
READ_TOOLS = {"read"}
EDIT_TOOLS = {"edit", "write", "multiedit", "notebookedit"}
GIT_SECONDS = 10
HEAD = 50  # the lines of a transcript read for what started the session, and where
# Only lines that can hold a load, a result or what started the session are parsed: a
# transcript is mostly text that is none of them
_WANTED = ('"tool_use"', '"tool_result"', "<command-name>")
_COMMAND = re.compile(r"<command-name>\s*/?([A-Za-z0-9][A-Za-z0-9._:-]*)\s*</command-name>")


def projects_dir() -> Path | None:
    """Where Claude Code keeps its transcripts on this machine. BOTCORE_SKILL_USAGE_CLAUDE_DIR
    overrides it, and an empty value turns the source off."""
    override = os.environ.get(DIR_ENV)
    if override is not None:
        return Path(override).expanduser() if override else None
    base = os.environ.get("CLAUDE_CONFIG_DIR")
    return (Path(base).expanduser() if base else Path.home() / ".claude") / "projects"


@dataclass
class ClaudeRead:
    loads: list[Load] = field(default_factory=list)
    sessions: list[Session] = field(default_factory=list)
    projects: dict[str, str] = field(default_factory=dict)  # checkout -> checkout
    # session -> what was last seen of its files, and whether it is T3 Code's
    files: dict[str, dict] = field(default_factory=dict)
    read: list[str] = field(default_factory=list)  # the sessions read this time
    sessions_seen: int = 0
    left_to_t3: int = 0
    unchanged: int = 0


def _session_files(root: Path) -> dict[str, list[Path]]:
    """Each session's transcript, and its subagents' beside it."""
    found: dict[str, list[Path]] = {}
    try:
        folders = sorted(folder for folder in root.iterdir() if folder.is_dir())
    except OSError:
        return found
    for folder in folders:
        try:
            transcripts = sorted(folder.glob("*.jsonl"))
        except OSError:
            continue
        for transcript in transcripts:
            subagents = folder / transcript.stem / "subagents"
            try:
                beside = sorted(subagents.glob("*.jsonl")) if subagents.is_dir() else []
            except OSError:
                beside = []
            found.setdefault(transcript.stem, []).extend([transcript, *beside])
    return found


def _stamp(files: list[Path]) -> list[int]:
    """What changes when a session's files do: how many, their size and their newest change."""
    size = newest = 0
    for file in files:
        try:
            status = file.stat()
        except OSError:
            continue
        size += status.st_size
        newest = max(newest, status.st_mtime_ns)
    return [len(files), size, newest]


class _Checkouts:
    """The checkout a session worked in, from the folder it ran in. A worktree that is gone
    is found through the nearest folder that is still there: one inside its repository
    leads to the repository."""

    def __init__(self) -> None:
        self.known: dict[str, str | None] = {}

    def of(self, cwd: str) -> str | None:
        if cwd not in self.known:
            self.known[cwd] = self._find(cwd)
        return self.known[cwd]

    def _find(self, cwd: str) -> str | None:
        folder = Path(cwd)
        if not folder.is_absolute():
            return None
        while not folder.is_dir():
            if folder.parent == folder:
                return None
            folder = folder.parent
        try:
            top = git_out(folder, "rev-parse", "--show-toplevel", timeout=GIT_SECONDS).strip()
        except (GitError, OSError):
            # no repository: the folder itself is the project, when it is the one the
            # session ran in; a folder above one that is gone says nothing of it
            return cwd if folder == Path(cwd) else None
        return top or None


@dataclass
class _Call:
    """A tool call as a transcript shows it, before its result is known."""

    tool: str
    arguments: dict
    at: str | None
    model: str | None
    subagent: bool


@dataclass
class _Transcript:
    """What one session's files hold of skill loads."""

    started_by: str | None = None
    cwd: str | None = None
    first: str | None = None
    calls: dict[str, _Call] = field(default_factory=dict)
    finished: set[str] = field(default_factory=set)
    typed: list[tuple[str, str, str | None]] = field(default_factory=list)  # row, name, at


def _parts(row: dict) -> list[dict]:
    message = row.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    return [part for part in content if isinstance(part, dict)] if isinstance(content, list) else []


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _note(found: _Transcript, row: dict, subagent: bool) -> None:
    found.started_by = found.started_by or _text(row.get("entrypoint"))
    found.cwd = found.cwd or _text(row.get("cwd"))
    at = _moment(row.get("timestamp"))
    found.first = found.first or at
    message = row.get("message") if isinstance(row.get("message"), dict) else {}
    sidechain = subagent or row.get("isSidechain") is True
    kind = row.get("type")
    if kind == "assistant":
        for part in _parts(row):
            call, tool = _text(part.get("id")), _text(part.get("name"))
            arguments = part.get("input")
            if part.get("type") == "tool_use" and call and tool and isinstance(arguments, dict):
                model = _text(message.get("model"))
                found.calls.setdefault(call, _Call(tool, arguments, at, model, sidechain))
    elif kind == "user":
        for part in _parts(row):
            call = _text(part.get("tool_use_id"))
            if part.get("type") == "tool_result" and call and part.get("is_error") is not True:
                found.finished.add(call)
        # a command a person typed: a subagent's brief and a line the harness wrote are not
        text = message.get("content")
        if isinstance(text, str) and not sidechain and row.get("isMeta") is not True:
            named = _COMMAND.search(text)
            row_id = _text(row.get("uuid"))
            if named and row_id:
                found.typed.append((row_id, named.group(1), at))


def _transcript(files: list[Path]) -> _Transcript:
    found = _Transcript()
    for number, file in enumerate(files):
        try:
            with file.open(encoding="utf-8", errors="replace") as handle:
                for count, line in enumerate(handle):
                    # what started the session and where is in its first lines, if anywhere
                    known = count >= HEAD or (found.started_by and found.cwd and found.first)
                    if known and not any(wanted in line for wanted in _WANTED):
                        continue
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue  # a line still being written
                    if isinstance(row, dict):
                        _note(found, row, subagent=number > 0)
        except OSError:
            continue
    return found


def _loads_of(call: _Call) -> list[tuple[str, str]]:
    """(skill, path) for each load a finished tool call shows, and for a change to a
    skill's files."""
    tool = call.tool.lower()
    if call.tool == "Skill":
        name = clean_skill_name(_text(call.arguments.get("skill")) or "")
        return [(name, SKILL_TOOL)] if name else []
    file = _text(call.arguments.get("file_path")) or _text(call.arguments.get("notebook_path"))
    if tool in READ_TOOLS:
        name = skill_of_file(file or "")
        return [(name, FILE_READ)] if name else []
    if tool in EDIT_TOOLS:
        name = skill_of_folder(file or "")
        return [(name, EDIT)] if name else []
    if call.tool == "Bash":
        command = _text(call.arguments.get("command"))
        return [(name, SHELL_READ) for name in skills_read_by(command)] if command else []
    return []


def read(
    root: Path, known: dict, t3_calls: Callable[[], set[str]], *, everything: bool = False
) -> ClaudeRead:
    """Every skill load in the transcripts of sessions T3 Code did not run, from the sessions
    whose files changed since `known` was written (all of them with `everything`); and those
    sessions. `t3_calls` gives the tool-call ids T3 Code's store holds, and is asked only
    when a session has to be told from T3 Code's."""
    result = ClaudeRead()
    checkouts = _Checkouts()
    held: set[str] | None = None
    for session, files in _session_files(root).items():
        result.sessions_seen += 1
        stamp = _stamp(files)
        before = known.get(session) if isinstance(known.get(session), dict) else {}
        if before.get("t3") is True:  # once T3 Code's, always: it is never read again
            result.files[session] = {"stamp": stamp, "t3": True}
            result.left_to_t3 += 1
            continue
        if not everything and before.get("stamp") == stamp:
            result.files[session] = before
            result.unchanged += 1
            continue
        found = _transcript(files)
        mine = found.started_by == T3_STARTED
        if not mine and found.calls:
            held = t3_calls() if held is None else held
            mine = any(call in held for call in found.calls)
        result.files[session] = {"stamp": stamp, "t3": mine}
        if mine:
            result.left_to_t3 += 1
            continue
        result.read.append(session)
        thread = f"{PREFIX}{session}"
        checkout = checkouts.of(found.cwd) if found.cwd else None
        if checkout:
            result.projects[checkout] = checkout
        changed = datetime.fromtimestamp(stamp[2] / 1e9, UTC).isoformat() if stamp[2] else None
        result.sessions.append(
            Session(
                id=thread,
                root=thread,
                agent=MAIN,
                harness=HARNESS,
                project_id=checkout,
                created_at=found.first,
                updated_at=_moment(changed) or found.first,
                pull_requests=(),
            )
        )
        for call_id, call in found.calls.items():
            if call_id not in found.finished or not call.at:
                continue  # only a call that came back, and came back without an error
            for skill, path in _loads_of(call):
                result.loads.append(
                    Load(
                        item=call_id,
                        native=f"{HARNESS}:{call_id}",
                        at=call.at,
                        skill=skill,
                        path=path,
                        harness=HARNESS,
                        thread=thread,
                        root=thread,
                        agent=SUBAGENT if call.subagent else MAIN,
                        project_id=checkout,
                        model=call.model,
                    )
                )
        for row_id, name, at in found.typed:
            skill = clean_skill_name(name)
            if skill and at:
                result.loads.append(
                    Load(
                        item=row_id,
                        native=None,
                        at=at,
                        skill=skill,
                        path=TYPED,
                        harness=HARNESS,
                        thread=thread,
                        root=thread,
                        agent=MAIN,
                        project_id=checkout,
                        model=None,
                    )
                )
    result.loads.sort(key=lambda load: load.at)
    return result
