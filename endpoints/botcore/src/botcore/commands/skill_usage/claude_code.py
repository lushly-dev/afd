"""Claude Code's own transcripts as a source: the sessions that never ran under T3 Code.

Claude Code writes each session as a file of JSON lines under `~/.claude/projects/<folder>/`,
and each of its subagents in a file beside it. A tool call T3 Code ran is in T3 Code's
store, which knows more of its session (the thread, its lineage, its pull requests), so it
is left to that source. Which calls those are is told two ways: the row that holds one names
the program that started the session, and the store holds the harness's own id of every tool
call it recorded.

Read-only, and nothing but what a load is leaves a transcript: no prompt, command or file.
An id is kept only when it is shaped like one.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass, field
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
T3_STARTED = "t3-code"  # a row's `entrypoint` when T3 Code started the session
READ_TOOLS = {"read"}
EDIT_TOOLS = {"edit", "write", "multiedit", "notebookedit"}
GIT_SECONDS = 10
SAMPLE = 8  # the calls kept of a transcript, to see later whether T3 Code's store holds them
FIRST_LINE = 1 << 20
# Only lines that can hold a tool call, its result or a typed command are parsed: a
# transcript is mostly text that is none of them
_WANTED = ('"tool_use"', '"tool_result"', "command-name")
# A command a person typed, as Claude Code writes it: the message is the two tags and what
# follows, never a sentence that quotes one
_ENVELOPE = ("<command-name>", "<command-message>")
_COMMAND = re.compile(r"<command-name>\s*/([A-Za-z0-9][A-Za-z0-9._:-]*)\s*</command-name>")
# What an id looks like, and a model's name. One that does not is not kept: both go into the
# record whole
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")
_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:\[\]-]{0,63}")


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
    # transcript -> what was last seen of its files, the sessions it gave and some of its
    # calls. One that is gone keeps its entry: what it gave is still in the record
    files: dict[str, dict] = field(default_factory=dict)
    read: list[str] = field(default_factory=list)  # the transcripts read this time
    # The sessions (as the record names them) that a transcript read this time gave before or
    # gives now: what the record holds of them is replaced by what was read
    replaced: set[str] = field(default_factory=set)
    failed: list[str] = field(default_factory=list)  # could not be read whole: left as it was
    transcripts: int = 0
    unchanged: int = 0
    left_to_t3: int = 0  # tool calls that are T3 Code's


def _regular(file: Path) -> os.stat_result | None:
    """A file's status when it is a file to read: not a folder, a pipe or a loop of links."""
    try:
        status = file.stat()
    except OSError:
        return None
    return status if stat.S_ISREG(status.st_mode) else None


def _first_row(file: Path) -> dict:
    try:
        with file.open(encoding="utf-8", errors="replace") as handle:
            row = json.loads(handle.readline(FIRST_LINE))
    except (OSError, ValueError):
        return {}
    return row if isinstance(row, dict) else {}


def _transcripts(root: Path) -> dict[str, list[Path]]:
    """Each session's transcript with its subagents' files, by the session's id. A subagent's
    file sits in the session's own folder, or, as older versions wrote it, beside the
    transcript under a name of its own: its rows say which session it worked for."""
    found: dict[str, list[Path]] = {}
    beside: list[Path] = []
    try:
        folders = sorted(folder for folder in root.iterdir() if folder.is_dir())
    except OSError:
        return found
    for folder in folders:
        try:
            tops = sorted(folder.glob("*.jsonl"))
        except OSError:
            continue
        for top in tops:
            if not _ID.fullmatch(top.stem):
                continue
            if top.stem.startswith("agent-"):
                beside.append(top)
                continue
            nested = folder / top.stem / "subagents"
            try:
                more = sorted(nested.glob("*.jsonl")) if nested.is_dir() else []
            except OSError:
                more = []
            found.setdefault(top.stem, []).extend([top, *more])
    for agent in beside:
        row = _first_row(agent)
        parent = row.get("sessionId")
        ours = isinstance(parent, str) and parent in found and row.get("isSidechain") is True
        found.setdefault(parent if ours else agent.stem, []).append(agent)
    return found


def _stamp(files: list[Path]) -> str | None:
    """What changes when any of a transcript's files does. None when one cannot be read."""
    seen = hashlib.sha256()
    for file in files:
        status = _regular(file)
        if status is None:
            return None
        seen.update(
            f"{file.parent.name}/{file.name}:{status.st_size}:{status.st_mtime_ns};".encode()
        )
    return seen.hexdigest()[:32]


class _Stalled(Exception):
    """git did not answer in time: nothing more is asked of it in this collection."""


class _Checkouts:
    """The repository a session worked in, from the folder it ran in: its main checkout,
    never a worktree, whose folder is often named after a branch. A worktree that is gone is
    found through the nearest folder that is still there. A folder in no repository is no
    project: a session can run anywhere, and a folder's name is not ours to record."""

    def __init__(self) -> None:
        self.known: dict[str, str | None] = {}
        self.stalled = False

    def of(self, cwd: str) -> str | None:
        if cwd not in self.known:
            if self.stalled:
                raise _Stalled
            self.known[cwd] = self._find(cwd)
        return self.known[cwd]

    def _find(self, cwd: str) -> str | None:
        folder = Path(cwd)
        if not folder.is_absolute():
            return None
        try:
            while not folder.is_dir():
                if folder.parent == folder:
                    return None
                folder = folder.parent
        except OSError:
            return None
        try:
            common = git_out(folder, "rev-parse", "--git-common-dir", timeout=GIT_SECONDS).strip()
        except GitError as exc:
            if "timed out" in str(exc):
                self.stalled = True
                raise _Stalled from exc
            return None
        if not common:
            return None
        shared = Path(common) if Path(common).is_absolute() else folder / common
        try:
            shared = shared.resolve()
        except OSError:
            return None
        return str(shared.parent if shared.name == ".git" else shared)


@dataclass
class _Call:
    """A tool call as a transcript shows it, before its result is known."""

    session: str
    tool: str
    arguments: dict
    at: str | None
    model: str | None
    subagent: bool
    by_t3: bool  # the row that holds it names T3 Code as what started the session


@dataclass
class _Seen:
    """What a transcript's files hold of one session."""

    cwd: str | None = None
    first: str | None = None
    last: str | None = None
    started_by: set[str] = field(default_factory=set)


@dataclass
class _Transcript:
    """What one transcript's files hold of skill loads."""

    sessions: dict[str, _Seen] = field(default_factory=dict)
    calls: dict[str, _Call] = field(default_factory=dict)
    finished: set[str] = field(default_factory=set)
    typed: list[tuple[str, str, str, str]] = field(default_factory=list)  # session, row, name, at


def _parts(row: dict) -> list[dict]:
    message = row.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    return [part for part in content if isinstance(part, dict)] if isinstance(content, list) else []


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _identifier(value: object) -> str | None:
    return value if isinstance(value, str) and _ID.fullmatch(value) else None


def _note(found: _Transcript, row: dict, home: str, others: set[str], subagent: bool) -> None:
    """Take from one row what it holds. A row belongs to the session it names. One that
    names another session whose own transcript is here is that transcript's, copied when the
    session was continued, and is passed over: the other file has it."""
    sidechain = subagent or row.get("isSidechain") is True
    session = _identifier(row.get("sessionId")) or home
    if session != home and not sidechain and session in others:
        return
    seen = found.sessions.setdefault(session, _Seen())
    seen.cwd = seen.cwd or _text(row.get("cwd"))
    started_by = _text(row.get("entrypoint"))
    if started_by:
        seen.started_by.add(started_by)
    at = _moment(row.get("timestamp"))
    if at:
        seen.first = min(seen.first or at, at)
        seen.last = max(seen.last or at, at)
    message = row.get("message") if isinstance(row.get("message"), dict) else {}
    kind = row.get("type")
    if kind == "assistant":
        for part in _parts(row):
            call, tool = _identifier(part.get("id")), _text(part.get("name"))
            arguments = part.get("input")
            if part.get("type") == "tool_use" and call and tool and isinstance(arguments, dict):
                model = _text(message.get("model"))
                model = model if model and _MODEL.fullmatch(model) else None
                by_t3 = started_by == T3_STARTED
                found.calls.setdefault(
                    call, _Call(session, tool, arguments, at, model, sidechain, by_t3)
                )
    elif kind == "user":
        for part in _parts(row):
            call = _identifier(part.get("tool_use_id"))
            if part.get("type") == "tool_result" and call and part.get("is_error") is not True:
                found.finished.add(call)
        # a command a person typed: a subagent's brief and a line the harness wrote are not
        text = message.get("content")
        typed = isinstance(text, str) and text.lstrip().startswith(_ENVELOPE)
        if typed and not sidechain and row.get("isMeta") is not True and at:
            named = _COMMAND.search(text)
            row_id = _identifier(row.get("uuid"))
            if named and row_id and started_by != T3_STARTED:
                found.typed.append((session, row_id, named.group(1), at))


def _transcript(home: str, files: list[Path], others: set[str]) -> _Transcript | None:
    """What a transcript's files hold, or None when one of them could not be read whole:
    half of a session is not what the record should be replaced with."""
    found = _Transcript()
    for file in files:
        subagent = file.stem != home
        try:
            with file.open(encoding="utf-8", errors="replace") as handle:
                placed = False
                for line in handle:
                    # where a session ran and what started it is on its rows: the first that
                    # says is read, whatever else it holds
                    wanted = any(marker in line for marker in _WANTED)
                    if not wanted and (placed or '"entrypoint"' not in line):
                        continue
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue  # a line still being written
                    if isinstance(row, dict):
                        _note(found, row, home, others, subagent)
                        placed = placed or bool(row.get("entrypoint"))
        except OSError:
            return None
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


def _entry(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _names(value: object) -> list[str]:
    return [name for name in value if isinstance(name, str)] if isinstance(value, list) else []


def read(root: Path, known: dict, held: set[str], *, everything: bool = False) -> ClaudeRead:
    """Every skill load in the transcripts that is not T3 Code's, from the transcripts that
    changed since `known` was written (all of them with `everything`); and the sessions
    those loads and their rows belong to.

    `held` is the harness's own id of every Claude tool call T3 Code is known to have
    recorded. A call is T3 Code's when `held` has it or its row names T3 Code as what
    started the session; a session all of whose calls are T3 Code's is left to it. A
    transcript is read again when its files changed, and when a call it gave as its own has
    since turned up in `held`.
    """
    result = ClaudeRead(files={name: _entry(entry) for name, entry in known.items()})
    checkouts = _Checkouts()
    found = _transcripts(root)
    others = set(found)
    for home, files in found.items():
        result.transcripts += 1
        before = _entry(known.get(home))
        stamp = _stamp(files)
        claimed = any(call in held for call in _names(before.get("calls")))
        if stamp is not None and not everything and not claimed and before.get("stamp") == stamp:
            result.unchanged += 1
            continue
        parsed = _transcript(home, files, others) if stamp is not None else None
        try:
            checkout = {
                session: checkouts.of(seen.cwd) if seen.cwd else None
                for session, seen in (parsed.sessions if parsed else {}).items()
            }
        except _Stalled:
            parsed = None
        if parsed is None:  # as it was: what the record holds of it stays, and it is tried again
            result.failed.append(home)
            continue
        result.read.append(home)
        own: dict[str, list[str]] = {}  # session -> its calls that are not T3 Code's
        t3: set[str] = set()  # sessions with a call that is
        for call_id, call in parsed.calls.items():
            if call.by_t3 or call_id in held:
                t3.add(call.session)
                result.left_to_t3 += 1
            else:
                own.setdefault(call.session, []).append(call_id)
        gave: list[str] = []
        for session, seen in parsed.sessions.items():
            # T3 Code's own session: it started it, or holds a call of it, and none is ours
            if session not in own and (session in t3 or seen.started_by == {T3_STARTED}):
                continue
            thread = f"{PREFIX}{session}"
            gave.append(thread)
            if checkout[session]:
                result.projects[checkout[session]] = checkout[session]
            result.sessions.append(
                Session(
                    id=thread,
                    root=thread,
                    agent=MAIN,
                    harness=HARNESS,
                    project_id=checkout[session],
                    created_at=seen.first,
                    updated_at=seen.last,
                    pull_requests=(),
                )
            )
        for session, call_ids in own.items():
            thread = f"{PREFIX}{session}"
            for call_id in call_ids:
                call = parsed.calls[call_id]
                if call_id not in parsed.finished or not call.at:
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
                            project_id=checkout[session],
                            model=call.model,
                        )
                    )
        for session, row_id, name, at in parsed.typed:
            skill = clean_skill_name(name)
            thread = f"{PREFIX}{session}"
            if skill and thread in gave:
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
                        project_id=checkout[session],
                        model=None,
                    )
                )
        result.replaced.update(_names(before.get("sessions")), gave)
        sample = [call_id for call_ids in own.values() for call_id in call_ids][:SAMPLE]
        result.files[home] = {"stamp": stamp, "sessions": gave, "calls": sample}
    result.loads.sort(key=lambda load: (load.at, load.thread, load.item))
    return result
