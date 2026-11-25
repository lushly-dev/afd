"""One skill load, and how a load is recognised in what a harness records.

An event says that a skill was loaded: which one, when, by which harness and agent, in which
project, and how it was loaded. It never holds a prompt, a command, arguments or file contents;
the text a load is recognised in is read and discarded, and a name that is not shaped like a
skill's is dropped rather than stored.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import asdict, dataclass

# How a skill reached the agent
SKILL_TOOL = "skill_tool"  # the harness's Skill tool
FILE_READ = "file_read"  # a file tool read SKILL.md
SHELL_READ = "shell_read"  # a shell command printed SKILL.md
TYPED = "typed"  # the person named the skill in their message
PATHS = (SKILL_TOOL, FILE_READ, SHELL_READ, TYPED)
# Not a load: the session changed a file of the skill. A session that edits a skill reads it
# as the subject of its work, so the report counts it as authoring the skill, not using it.
EDIT = "edit"

# The version of the rules in this module that recognised an event. A record holding events
# of an older version can be rebuilt from what the harness still has.
RECOGNIZER = 2

# Who loaded it. A session is a thread a person started or a task delegated to its own
# agent; a subagent works inside one and reports back to it.
MAIN = "main"  # the agent of a thread a person started
DELEGATE = "delegate"  # the agent of a delegated task
SUBAGENT = "subagent"  # a subagent inside either

_NAME = r"[A-Za-z0-9][A-Za-z0-9._-]*"
_SKILL_NAME = re.compile(rf"{_NAME}(?::{_NAME})?")  # a skill, or a plugin's `plugin:skill`
_SKILL_FOLDER_NAME = re.compile(_NAME)
_LONGEST_NAME = 100
_SKILL_FILE = re.compile(rf"(?:^|[/\\])skills[/\\]+({_NAME})[/\\]+SKILL\.md$")
_SKILL_FOLDER = re.compile(rf"(?:^|[/\\])skills[/\\]+({_NAME})[/\\]+[^/\\]")
_TYPED = re.compile(rf"^\s*[$/]({_NAME}(?::{_NAME})?)(?=\s|$)")

_SHELLS = {"bash", "zsh", "sh", "dash", "ksh", "fish", "pwsh", "powershell", "cmd"}
_POWERSHELL_SHELLS = {"pwsh", "powershell"}
_POSIX_SHELLS = {"bash", "zsh", "sh", "dash", "ksh", "fish"}
_SCRIPT_FLAG = re.compile(r"-[a-z]*c|-command|/c|/k", re.IGNORECASE)
_HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")
_PS_ASSIGNMENT = re.compile(r"^\s*\$[A-Za-z_][A-Za-z0-9_:]*\s*=")
_PS_CMDLET = re.compile(
    r"^\s*(?:&\s*)?(?:Get|Set|Write|Out|Select|Measure|New|Remove|Copy|Move|Test|"
    r"Join|Split|Invoke|ForEach|Where|Import|Export|ConvertFrom|ConvertTo|Start|Stop|"
    r"Push|Pop|Add|Clear)-[A-Za-z]+\b",
    re.IGNORECASE,
)
_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_ESCAPABLE_IN_QUOTES = '"\\$`'
_ESCAPABLE = " \t\n\"';|&<>#"
_PREFIXES = {"command", "exec", "sudo", "time", "noglob", "nocorrect", "builtin", "env"}
_READERS = {
    "cat", "bat", "batcat", "less", "more", "head", "tail", "nl", "awk", "type", "gc",
    "get-content",
}  # fmt: skip
# A command the read is piped into that shows the agent a count, a digest or a search result,
# not the skill
_SINKS = {
    "wc", "grep", "egrep", "fgrep", "rg", "ag", "ack", "shasum", "sha1sum", "sha256sum", "md5",
    "md5sum", "cksum", "diff", "cmp", "findstr", "out-null", "measure-object", "select-string",
    "sls",
}  # fmt: skip
_GIT_OPTIONS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace"}
_GIT_NOT_CONTENT = {"--stat", "--name-only", "--name-status", "--numstat", "--shortstat", "--"}


@dataclass(frozen=True)
class Event:
    """A skill load. `thread` is the session it happened in (a subagent's load counts under
    the session it works for) and `root` the thread a person started, which a delegated
    task's session differs from. `native` is the harness's own id for the recorded item,
    where it has one: the same load read from another source of that harness carries it too."""

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
    native: str | None = None
    v: int = RECOGNIZER

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict) -> Event | None:
        """The event a stored line holds, or None when the line is not one."""
        fields = {name: data.get(name) for name in cls.__dataclass_fields__}
        required = ("id", "at", "skill", "path", "thread")
        if not all(isinstance(fields[name], str) and fields[name] for name in required):
            return None
        fallbacks = {
            "harness": "other", "source": "unknown", "root": fields["thread"], "agent": MAIN,
            "project": "unknown", "machine": "unknown",
        }  # fmt: skip
        for name, fallback in fallbacks.items():
            if not isinstance(fields[name], str) or not fields[name]:
                fields[name] = fallback
        for name in ("model", "native"):
            if not isinstance(fields[name], str):
                fields[name] = None
        if not isinstance(fields["v"], int):
            fields["v"] = 0
        return cls(**dict(fields))  # type: ignore[arg-type]


def is_skill_folder(name: object) -> bool:
    """Whether a name is one a skill's folder can have and a load be recorded under. No
    other is a skill a report could count, and nothing else is kept or shared as a name:
    not a path, not a sentence."""
    return (
        isinstance(name, str)
        and len(name) <= _LONGEST_NAME
        and _SKILL_FOLDER_NAME.fullmatch(name) is not None
    )


def clean_skill_name(raw: str) -> str | None:
    """The skill a tool's `skill` input names, or None when it is not a skill's name.

    Claude Code scopes a skill to a folder as `<folder>:<skill>`; the folder is dropped, so
    one skill keeps one name. A plugin's `plugin:skill` is kept. Anything else is refused, so
    a malformed input can never put other text in the record.
    """
    name = raw.strip()
    scope, separator, rest = name.rpartition(":")
    if separator and (scope.startswith(".") or "/" in scope or "\\" in scope):
        name = rest
    return name if _SKILL_NAME.fullmatch(name) else None


def skill_of_file(path: str, extra_dirs: Sequence[str] = ()) -> str | None:
    """The skill whose SKILL.md this file path names: `…/skills/<name>/SKILL.md`, or
    `…/<extra_dir>/<name>/SKILL.md` for a repository's configured extra skill folders."""
    text = path.strip()
    match = _SKILL_FILE.search(text)
    if match:
        return match.group(1)
    if extra_dirs:
        norm = text.replace("\\", "/")
        for folder in extra_dirs:
            extra_match = re.search(rf"(?:^|/){re.escape(folder)}/+({_NAME})/+SKILL\.md$", norm)
            if extra_match:
                return extra_match.group(1)
    return None


def skill_of_folder(path: str, extra_dirs: Sequence[str] = ()) -> str | None:
    """The skill a file belongs to: any file under `…/skills/<name>/` or a configured
    `…/<extra_dir>/<name>/`."""
    text = path.strip()
    if extra_dirs:
        norm = text.replace("\\", "/")
        for folder in extra_dirs:
            extra_match = re.search(rf"(?:^|/){re.escape(folder)}/+({_NAME})/+[^/]", norm)
            if extra_match:
                return extra_match.group(1)
    match = _SKILL_FOLDER.search(text)
    if match:
        return match.group(1)
    return None


def typed_skill(text: str) -> str | None:
    """The name a message starts with when it opens by naming a skill (`$name` or `/name`).

    The caller decides whether the name is a skill; a message can open with `$` for other
    reasons.
    """
    match = _TYPED.match(text)
    return match.group(1) if match else None


# ── shell commands ──────────────────────────────────────────────────────────


@dataclass
class _Command:
    words: list[str]
    writes_output: bool  # its output goes to a file, not to the agent
    then: str  # the operator after it: "|", "&&", "||", ";", "&", a newline or ""


@dataclass
class _ShellFeatures:
    has_heredoc: bool = False
    has_here_string: bool = False
    has_ps_statement: bool = False
    unclosed_quote: bool = False


def _has_here_string_closer(lines: list[str], start: int, closer: str) -> bool:
    return any(later.lstrip().startswith(closer) for later in lines[start:])


def _scan_feature_line(  # noqa: C901, PLR0912, PLR0913 - single-line lexical scanner
    line: str,
    lines: list[str],
    line_index: int,
    *,
    powershell: bool,
    quote: str | None,
    pending: list[str],
    features: _ShellFeatures,
) -> str | None:
    escape = "`" if powershell else "\\"
    trimmed = line.rstrip()
    at_statement = quote is None
    index = 0
    while index < len(line):
        char = line[index]
        if quote:
            if char == escape and quote == '"':
                index += 1
            elif char == quote:
                quote = None
            index += 1
            continue
        if at_statement:
            rest = line[index:]
            if _PS_ASSIGNMENT.match(rest) or _PS_CMDLET.match(rest):
                features.has_ps_statement = True
            if not char.isspace():
                at_statement = False
        if (
            index == len(trimmed) - 2
            and trimmed.endswith(('@"', "@'"))
            and _has_here_string_closer(lines, line_index + 1, trimmed[-1] + "@")
        ):
            pending.append(trimmed[-1] + "@")
            break
        if char in "\"'":
            quote = char
        elif char == escape:
            index += 1
        elif char == "#" and (index == 0 or line[index - 1].isspace()):
            break
        elif char in ";|":
            at_statement = True
        elif char == "&" and line[index : index + 2] == "&&":
            at_statement = True
            index += 1
        elif line.startswith("<<<", index):
            features.has_heredoc = True
            index += 2
        elif line.startswith("<<", index):
            marker = _HEREDOC.match(line, index)
            if marker:
                features.has_heredoc = True
                if not powershell:
                    pending.append(marker.group(2))
                index = marker.end() - 1
        index += 1
    return quote


def _scan_features(script: str, *, powershell: bool) -> _ShellFeatures:
    """Scan a script under POSIX or PowerShell quoting for dialect indicators."""
    lines = script.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    features = _ShellFeatures()
    pending: list[str] = []
    quote: str | None = None
    for line_index, line in enumerate(lines):
        if pending:
            until = pending[0]
            if line.strip() == until or (until.endswith("@") and line.lstrip().startswith(until)):
                if until.endswith("@"):
                    features.has_here_string = True
                pending.pop(0)
            continue
        quote = _scan_feature_line(
            line,
            lines,
            line_index,
            powershell=powershell,
            quote=quote,
            pending=pending,
            features=features,
        )
    features.unclosed_quote = quote is not None
    return features


def _is_powershell(script: str) -> bool:
    """Whether an unwrapped script uses PowerShell quoting (backtick escapes, literal backslashes).

    Scans unquoted operators and statement boundaries under POSIX quoting first so a bash
    command writing a `.ps1` in a `<<` here-document or printing PowerShell text inside quotes
    stays POSIX (#1847). Only an unquoted POSIX `<<` forces POSIX; `<<` inside PowerShell
    strings or here-strings does not. If POSIX scanning sees PowerShell syntax or ends with an
    unclosed quote (as `"C:\\dir\\"` or `"a`\"b"` does), re-scans under PowerShell quoting.
    """
    posix = _scan_features(script, powershell=False)
    if posix.has_heredoc and not posix.unclosed_quote:
        return False
    if not posix.unclosed_quote and not posix.has_ps_statement and not posix.has_here_string:
        return False
    ps = _scan_features(script, powershell=True)
    if ps.has_heredoc:
        return False
    return ps.has_here_string or ps.has_ps_statement


def _without_here_documents(script: str, powershell: bool = False) -> str:
    """Drop the bodies of here-documents and PowerShell here-strings: they are data.

    Only an opener outside quotes starts one. A script handed to a shell in quotes keeps its
    here-documents, which are dropped when that script is read in turn; dropping them here
    would take the terminator with the body and leave the inner one open.
    """
    lines = script.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    kept: list[str] = []
    pending: list[str] = []  # the terminators of the bodies still to drop, in order
    quote: str | None = None
    for line in lines:
        if pending:
            until = pending[0]
            if line.strip() == until or (until.endswith("@") and line.lstrip().startswith(until)):
                pending.pop(0)
            continue
        kept.append(line)
        trimmed = line.rstrip()
        index = 0
        while index < len(line):
            char = line[index]
            if quote:
                if char == ("`" if powershell else "\\") and quote == '"':
                    index += 1
                elif char == quote:
                    quote = None
            elif powershell and index == len(trimmed) - 2 and trimmed.endswith(('@"', "@'")):
                pending.append(trimmed[-1] + "@")
                kept[-1] = trimmed[:-2]  # the opener is not a quote left open
                break
            elif char in "\"'":
                quote = char
            elif char == ("`" if powershell else "\\"):
                index += 1
            elif char == "#" and (index == 0 or line[index - 1].isspace()):
                break
            elif not powershell and line.startswith("<<<", index):
                index += 2  # a here-string: the word after it is data on the same line
            elif not powershell and line.startswith("<<", index):
                marker = _HEREDOC.match(line, index)
                if marker:
                    pending.append(marker.group(2))
                    index = marker.end() - 1
            index += 1
    return "\n".join(kept)


def _commands(script: str, powershell: bool = False) -> list[_Command]:  # noqa: C901, PLR0912, PLR0915 - one scanner
    """Split a script into its simple commands, honouring quotes, comments and redirects."""
    commands: list[_Command] = []
    words: list[str] = []
    word: list[str] = []
    started = False  # a word is under way, even an empty quoted one
    quote: str | None = None
    writes = False
    drop_next = False  # the next word is a redirect's target or a here-document's marker
    index, size = 0, len(script)

    def end_word() -> None:
        nonlocal started, drop_next
        if started:
            if drop_next:
                drop_next = False
            else:
                words.append("".join(word))
        word.clear()
        started = False

    def end_command(operator: str) -> None:
        nonlocal words, writes, drop_next
        end_word()
        if words or writes:
            commands.append(_Command(words, writes, operator))
        words, writes, drop_next = [], False, False

    while index < size:
        char = script[index]
        following = script[index + 1 : index + 2]
        if quote:
            if powershell and char == "`" and quote == '"' and following:
                word.append(following)
                index += 2
            elif (
                not powershell
                and char == "\\"
                and quote == '"'
                and following
                and following in _ESCAPABLE_IN_QUOTES
            ):
                word.append(following)
                index += 2
            elif char == quote:
                quote = None
                index += 1
            else:
                word.append(char)
                index += 1
            continue
        if char in "\"'":
            quote, started = char, True
            index += 1
        elif powershell and char == "`" and following:
            if following != "\n":
                word.append(following)
                started = True
            index += 2
        elif not powershell and char == "\\" and following and following in _ESCAPABLE:
            # an escaped shell character; a Windows path's backslash is none of these
            if following != "\n":
                word.append(following)
                started = True
            index += 2
        elif char == "#" and not started:
            while index < size and script[index] != "\n":
                index += 1
        elif char in " \t":
            end_word()
            index += 1
        elif char in "\n;":
            end_command(char)
            index += 1
        elif char == "|":
            end_command("||" if following == "|" else "|")
            index += 2 if following == "|" else 1
        elif char == "&" and following == "&":
            end_command("&&")
            index += 2
        elif char == "&" and following == ">":
            end_word()
            writes, drop_next = True, True
            index += 2
        elif char == "&":
            if words or started:
                end_command("&")
            index += 1  # otherwise PowerShell's call operator: `& Get-Content …`
        elif char == ">":
            descriptor = "".join(word) if started else ""
            if descriptor.isdigit():
                word.clear()
                started = False
            else:
                end_word()
                descriptor = "1"
            index += 2 if following == ">" else 1
            if script[index : index + 1] == "&":  # `2>&1`: another descriptor, not a file
                index += 1
                while index < size and script[index].isdigit():
                    index += 1
            else:
                drop_next = True
                writes = writes or descriptor == "1"
        elif char == "<" and following == "<":
            end_word()
            drop_next = True
            index += 3 if script[index + 2 : index + 3] == "-" else 2
        elif char == "<":
            end_word()  # `cat < file`: the file is read, so it stays an operand
            index += 1
        else:
            word.append(char)
            started = True
            index += 1
    end_command("")
    return commands


def _program(words: list[str]) -> tuple[str, list[str]]:
    """A command's program name, lower-cased and without its folder, and its arguments."""
    remaining = list(words)
    while remaining:
        name = re.split(r"[/\\]", remaining[0].lstrip("({"))[-1].lower().removesuffix(".exe")
        if not _ASSIGNMENT.match(remaining[0]) and name not in _PREFIXES:
            return name, [argument.rstrip(")}") for argument in remaining[1:]]
        remaining.pop(0)
    return "", []


def _script(name: str, arguments: list[str]) -> str | None:
    """The script a shell is asked to run (`zsh -lc "<script>"`, `pwsh -Command …`,
    `cmd /c …`). The command was split as a shell splits it, so a script quoted in pieces
    (`'…'"'"'…'`, the way a single quote is put inside single quotes) is whole here."""
    if name not in _SHELLS:
        return None
    for position, argument in enumerate(arguments):
        if _SCRIPT_FLAG.fullmatch(argument):
            rest = arguments[position + 1 :]
            return " ".join(rest[1:] if rest[:1] == ["--"] else rest) or None
    return None


def _printed_by_git(arguments: list[str]) -> list[str]:
    """The files `git show <revision>:<path>` or `git cat-file -p` prints, as paths."""
    rest = list(arguments)
    while rest and rest[0].startswith("-"):
        option = rest.pop(0)
        if option in _GIT_OPTIONS_WITH_VALUE and rest:
            rest.pop(0)
    if not rest:
        return []
    subcommand, rest = rest[0], rest[1:]
    prints = subcommand == "show" or (subcommand == "cat-file" and "-p" in rest)
    if not prints or _GIT_NOT_CONTENT & set(rest):
        return []
    return [
        argument.partition(":")[2]
        for argument in rest
        if not argument.startswith("-") and ":" in argument
    ]


def _operands(arguments: list[str], script_flag: bool = False) -> list[str]:
    """A command's file operands: not its options, and for `sed` and `awk` not the script
    file `-f` names (for `tail` and `less`, `-f` takes no value)."""
    operands: list[str] = []
    skip = False
    for argument in arguments:
        if skip:
            skip = False
        elif script_flag and argument == "-f":
            skip = True
        elif not argument.startswith("-"):
            operands.append(argument)
    return operands


def _files_read(name: str, arguments: list[str]) -> list[tuple[str, bool]]:
    """(path, on_disk) for each file a command reads; `on_disk` is False for git object reads."""
    if name in _READERS:
        return [(path, True) for path in _operands(arguments, script_flag=name == "awk")]
    if name == "sed":
        in_place = any(
            argument.startswith(("-i", "--in-place"))
            or (re.fullmatch(r"-[A-Za-z]+", argument) and "i" in argument)
            for argument in arguments
        )
        return [] if in_place else [(path, True) for path in _operands(arguments, script_flag=True)]
    if name == "git":
        return [(path, False) for path in _printed_by_git(arguments)]
    return []


def _reaches_agent(commands: list[_Command], position: int) -> bool:
    """Whether a command's output is shown, not sent to a file or, anywhere down its pipe,
    into a count, a digest or a search."""
    while True:
        if commands[position].writes_output:
            return False
        if commands[position].then != "|" or position + 1 >= len(commands):
            return True
        position += 1
        if _program(commands[position].words)[0] in _SINKS:
            return False


def skill_files_read_by(
    command: str,
    depth: int = 0,
    *,
    _powershell: bool | None = None,
    extra_dirs: Sequence[str] = (),
) -> list[tuple[str, str | None]]:
    """(skill, file_path) for each skill whose SKILL.md a shell command shows the agent, in
    order, each skill once. `file_path` is None for git-object reads (`git show`), which name
    no file on disk."""
    powershell = _is_powershell(command) if _powershell is None else _powershell
    found: dict[str, str | None] = {}
    commands = _commands(
        _without_here_documents(command, powershell=powershell), powershell=powershell
    )
    for position, simple in enumerate(commands):
        if not _reaches_agent(commands, position):
            continue
        name, arguments = _program(simple.words)
        script = _script(name, arguments)
        if script is not None:
            if depth < 3:
                child_ps = (
                    True if name in _POWERSHELL_SHELLS else False if name in _POSIX_SHELLS else None
                )
                pairs = skill_files_read_by(
                    script, depth + 1, _powershell=child_ps, extra_dirs=extra_dirs
                )
            else:
                pairs = []
        else:
            pairs = [
                (skill, path.strip() if on_disk else None)
                for path, on_disk in _files_read(name, arguments)
                if (skill := skill_of_file(path, extra_dirs))
            ]
        for skill, file_path in pairs:
            if not skill:
                continue
            if skill not in found or (found[skill] is None and file_path is not None):
                found[skill] = file_path
    return list(found.items())


def skills_read_by(
    command: str,
    depth: int = 0,
    *,
    _powershell: bool | None = None,
    extra_dirs: Sequence[str] = (),
) -> list[str]:
    """The skills whose SKILL.md a shell command shows the agent, in order, each once.

    Only a command that prints the file counts: `cat`, `sed`, `head`, `tail`, `nl`, `less`,
    `more`, `bat`, `awk`, `type`, `Get-Content`, and `git show <revision>:<path>`. A search, a
    diff, a listing or an edit that names the file does not count, nor does a read whose
    output goes to a file or into a count, a digest or a search. Quoted text, comments and
    here-document bodies are data, not commands. A script handed to a shell is read as that
    shell reads it.
    """
    return [
        skill
        for skill, _ in skill_files_read_by(
            command, depth, _powershell=_powershell, extra_dirs=extra_dirs
        )
    ]
