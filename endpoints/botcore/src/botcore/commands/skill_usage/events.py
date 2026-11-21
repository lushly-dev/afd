"""One skill load, and how a load is recognised in what a harness records.

An event says that a skill was loaded: which one, when, by which harness and agent, in which
project, and how it was loaded. It never holds a prompt, a command, arguments or file contents;
the text a load is recognised in is read and discarded.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

# How a skill reached the agent
SKILL_TOOL = "skill_tool"  # the harness's Skill tool
FILE_READ = "file_read"  # a file tool read SKILL.md
SHELL_READ = "shell_read"  # a shell command printed SKILL.md
TYPED = "typed"  # the person named the skill in their message
PATHS = (SKILL_TOOL, FILE_READ, SHELL_READ, TYPED)

# Who loaded it. A session is a thread a person started or a task delegated to its own
# agent; a subagent works inside one and reports back to it.
MAIN = "main"  # the agent of a thread a person started
DELEGATE = "delegate"  # the agent of a delegated task
SUBAGENT = "subagent"  # a subagent inside either

_NAME = r"[A-Za-z0-9][A-Za-z0-9._-]*"
_SKILL_FILE = re.compile(rf"skills[/\\]+({_NAME})[/\\]+SKILL\.md")
_SKILL_FILE_AT_END = re.compile(rf"skills[/\\]+({_NAME})[/\\]+SKILL\.md$")
_SEGMENT = re.compile(r"&&|\|\||[;|\n]")
_WRAPPER = re.compile(
    r"^\s*(?:(?:/usr)?/bin/)?(?:bash|zsh|sh|pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*[\"']?",
    re.IGNORECASE,
)
_READ_VERB = re.compile(
    r"^(?:cat|bat|less|more|head|tail|nl|type|gc|get-content|sed\s+-n)(?=\s)", re.IGNORECASE
)
_REDIRECT = re.compile(r"\d*>>?\s*\S+")
# `git show <revision>:<path>` prints a file as a revision holds it, which is how a reviewer
# loads a skill from the base instead of the branch; with `-- <path>` it prints a diff
_GIT_PRINT = re.compile(r"^git\s+(?:\S+\s+)*?(?:show|cat-file\s+-p)\s", re.IGNORECASE)
_SKILL_FILE_AT_REVISION = re.compile(rf"[^\s:]+:[^\s:]*skills[/\\]+({_NAME})[/\\]+SKILL\.md")
_TYPED = re.compile(r"^\s*[$/]([a-z0-9][a-z0-9:._-]*)(?=\s|$)")


@dataclass(frozen=True)
class Event:
    """A skill load. `thread` is the session it happened in (a subagent's load counts under
    the session it works for) and `root` the thread a person started, which a delegated
    task's session differs from."""

    id: str
    at: str
    skill: str
    path: str
    harness: str
    source: str
    thread: str
    root: str
    agent: str
    project: str
    machine: str
    model: str | None = None

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict) -> Event | None:
        """The event a stored line holds, or None when the line is not one."""
        try:
            event = cls(**{name: data.get(name) for name in cls.__dataclass_fields__})
        except TypeError:
            return None
        required = (event.id, event.at, event.skill, event.path, event.thread)
        if not all(isinstance(value, str) and value for value in required):
            return None
        return event


def skill_of_file(path: str) -> str | None:
    """The skill whose SKILL.md this file path names."""
    match = _SKILL_FILE_AT_END.search(path.strip().strip("\"'"))
    return match.group(1) if match else None


def skills_read_by(command: str) -> list[str]:
    """The skills whose SKILL.md a shell command prints, in order and without repeats.

    Only a command that reads the file counts, `git show <revision>:<path>` included: a
    search, a diff, a listing or a write that merely names it does not. A redirect's target
    is a write, so it is left out.
    """
    found: list[str] = []
    for segment in _SEGMENT.split(command):
        segment = _WRAPPER.sub("", segment).lstrip(" \t\"'(")
        if _READ_VERB.match(segment):
            pattern = _SKILL_FILE
        elif _GIT_PRINT.match(segment):
            pattern = _SKILL_FILE_AT_REVISION
        else:
            continue
        for name in pattern.findall(_REDIRECT.sub(" ", segment)):
            if name not in found:
                found.append(name)
    return found


def typed_skill(text: str) -> str | None:
    """The name a message starts with when it opens by naming a skill (`$name` or `/name`).

    The caller decides whether the name is a skill; a message can open with `$` for other
    reasons.
    """
    match = _TYPED.match(text)
    return match.group(1) if match else None
