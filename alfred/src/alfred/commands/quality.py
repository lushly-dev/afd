"""alfred_quality — Command description semantic quality validation.

Scans for command definitions in TypeScript and Python, then validates
description quality: length, imperative mood, near-duplicates.
"""

from __future__ import annotations

import ast
import os
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from afd.core.result import CommandResult, success
from afd.lushx_ext.linters import AFDLinter


@dataclass
class QualityIssue:
    """A single quality issue found in a command description."""

    command: str
    file: str
    line: int
    check: str
    message: str
    suggestion: str | None = None

    def to_dict(self) -> dict:
        return {
            "command": self.command,
            "file": self.file,
            "line": self.line,
            "check": self.check,
            "message": self.message,
            "suggestion": self.suggestion,
        }


@dataclass
class CommandDef:
    """A parsed command definition."""

    name: str
    description: str
    file: str
    line: int


# ─── File discovery ──────────────────────────────────────────────────────────

_TS_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"}


def _iter_source_files(root: Path, extensions: set[str]) -> Iterator[Path]:
    """Yield files under ``root`` with one of ``extensions``.

    Directories in ``AFDLinter.SKIP_DIRS`` (``node_modules``, ``.venv``,
    ``dist``, ...) are pruned, so the walk never descends into them.
    ``AFDLinter.SKIP_PATH_PATTERNS`` (``.claude/``, ``/.git/``, ...) are
    matched against the path relative to ``root``, so a root that itself
    lies under such a directory is still scanned.
    """
    skip_dirs = AFDLinter.SKIP_DIRS
    skip_patterns = AFDLinter.SKIP_PATH_PATTERNS

    def skipped(relative: str) -> bool:
        return any(p in relative for p in skip_patterns)

    for dirpath, dirnames, filenames in os.walk(root):
        relative_dir = Path(dirpath).relative_to(root).as_posix()
        prefix = "/" if relative_dir == "." else f"/{relative_dir}/"
        dirnames[:] = sorted(
            name
            for name in dirnames
            if name not in skip_dirs and not skipped(f"{prefix}{name}/")
        )
        for filename in sorted(filenames):
            path = Path(dirpath) / filename
            if path.suffix.lower() in extensions and not skipped(f"{prefix}{filename}"):
                yield path


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None


# ─── TypeScript parsing ──────────────────────────────────────────────────────

_DEFINE_COMMAND_RE = re.compile(r"\bdefineCommand\b")
_JS_ESCAPES = {
    "n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0",
}


def _mask_comments(text: str) -> str:
    """Blank out JS comments (keeping offsets), leaving strings intact."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch in "'\"`":
            i = _skip_js_string(text, i)
        elif text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end == -1 else end
            out[i:end] = " " * (end - i)
            i = end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end == -1 else end + 2
            out[i:end] = [c if c == "\n" else " " for c in text[i:end]]
            i = end
        else:
            i += 1
    return "".join(out)


def _skip_js_string(text: str, start: int) -> int:
    """Index just past the string or template literal starting at ``start``."""
    quote = text[start]
    i, n = start + 1, len(text)
    while i < n:
        ch = text[i]
        if ch == "\\":
            i += 2
        elif ch == quote:
            return i + 1
        elif quote == "`" and text.startswith("${", i):
            i = _skip_js_braces(text, i + 1)
        elif quote != "`" and ch == "\n":
            return i
        else:
            i += 1
    return n


def _skip_js_braces(text: str, start: int) -> int:
    """Index just past the ``}`` matching the ``{`` at ``start``."""
    depth = 0
    i, n = start, len(text)
    while i < n:
        ch = text[i]
        if ch in "'\"`":
            i = _skip_js_string(text, i)
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def _skip_type_arguments(text: str, start: int) -> int:
    """Index just past the ``<...>`` type argument list starting at ``start``."""
    depth = 0
    braces = 0
    i, n = start, min(len(text), start + 5000)
    while i < n:
        ch = text[i]
        if ch in "'\"`":
            i = _skip_js_string(text, i)
            continue
        if text.startswith("=>", i):
            i += 2
            continue
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth -= 1
            if depth == 0:
                return i + 1
        elif ch == "{":
            braces += 1
        elif ch == "}":
            braces -= 1
        elif ch == ";" and braces <= 0:
            return -1  # a statement ended: not a type argument list after all
        i += 1
    return -1


def _split_top_level(body: str) -> list[str]:
    """Split an object literal body at its top-level commas."""
    parts: list[str] = []
    depth = 0
    last = 0
    i, n = 0, len(body)
    while i < n:
        ch = body[i]
        if ch in "'\"`":
            i = _skip_js_string(body, i)
            continue
        if ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(body[last:i])
            last = i + 1
        i += 1
    parts.append(body[last:])
    return parts


def _decode_js_string(literal: str) -> str | None:
    """The value of a quoted JS string or a template without ``${}``."""
    quote, inner = literal[0], literal[1:-1]
    if quote == "`" and "${" in inner:
        return None
    out: list[str] = []
    i = 0
    while i < len(inner):
        ch = inner[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        nxt = inner[i + 1] if i + 1 < len(inner) else ""
        if nxt == "u" and inner[i + 2 : i + 3] == "{":
            end = inner.find("}", i + 3)
            out.append(chr(int(inner[i + 3 : end], 16)))
            i = end + 1
        elif nxt == "u":
            out.append(chr(int(inner[i + 2 : i + 6], 16)))
            i += 6
        elif nxt == "x":
            out.append(chr(int(inner[i + 2 : i + 4], 16)))
            i += 4
        elif nxt == "\n":
            i += 2  # line continuation
        else:
            out.append(_JS_ESCAPES.get(nxt, nxt))
            i += 2
    return "".join(out)


def _string_value(expression: str) -> str | None:
    """The value of a string literal expression, or None if it is not one.

    Supports single/double quotes, templates without substitutions,
    concatenation with ``+``, and a trailing ``as const``.
    """
    expression = re.sub(r"\s+as\s+const\s*$", "", expression.strip())
    pieces: list[str] = []
    i, n = 0, len(expression)
    while i < n:
        while i < n and expression[i].isspace():
            i += 1
        if i >= n or expression[i] not in "'\"`":
            return None
        end = _skip_js_string(expression, i)
        literal = expression[i:end]
        if len(literal) < 2 or literal[-1] != literal[0]:
            return None
        try:
            value = _decode_js_string(literal)
        except (ValueError, IndexError):
            return None
        if value is None:
            return None
        pieces.append(value)
        i = end
        while i < n and expression[i].isspace():
            i += 1
        if i < n:
            if expression[i] != "+":
                return None
            i += 1
    return "".join(pieces) if pieces else None


_PROPERTY_RE = re.compile(
    r"^\s*(?:(?P<quote>['\"])(?P<qkey>[\w$]+)(?P=quote)|(?P<key>[A-Za-z_$][\w$]*))\s*:(?P<value>.*)$",
    re.DOTALL,
)


def _object_string_properties(body: str) -> dict[str, str]:
    """Top-level string-literal properties of an object literal body."""
    properties: dict[str, str] = {}
    for part in _split_top_level(body):
        m = _PROPERTY_RE.match(part)
        if not m:
            continue
        key = m.group("qkey") or m.group("key")
        value = _string_value(m.group("value"))
        if value is not None and key not in properties:
            properties[key] = value
    return properties


def parse_ts_define_commands(content: str, file: str = "") -> list[CommandDef]:
    """Find ``defineCommand(...)`` calls in TypeScript/JavaScript source.

    Handles generic calls (``defineCommand<In, Out>({...})``), nested objects
    before ``description`` (``expose: { mcp: true }``), any quoting and
    escapes (``"Don't"``, ``'Don\\'t'``), templates without substitutions,
    and string concatenation. Only top-level ``name`` and ``description``
    properties of the definition object count. Calls in comments are ignored.
    """
    code = _mask_comments(content)
    commands: list[CommandDef] = []
    for m in _DEFINE_COMMAND_RE.finditer(code):
        i = m.end()
        while i < len(code) and code[i].isspace():
            i += 1
        if i < len(code) and code[i] == "<":
            i = _skip_type_arguments(code, i)
            if i < 0:
                continue
            while i < len(code) and code[i].isspace():
                i += 1
        if i >= len(code) or code[i] != "(":
            continue  # an import, a type reference, or a mention
        i += 1
        while i < len(code) and code[i].isspace():
            i += 1
        if i >= len(code) or code[i] != "{":
            continue
        end = _skip_js_braces(code, i)
        properties = _object_string_properties(code[i + 1 : end - 1])
        name = properties.get("name")
        description = properties.get("description")
        if name is None or description is None:
            continue
        commands.append(CommandDef(
            name=name,
            description=description,
            file=file,
            line=code[: m.start()].count("\n") + 1,
        ))
    return commands


def _find_ts_commands(root: Path) -> list[CommandDef]:
    """Find defineCommand() calls in TypeScript and JavaScript files."""
    commands: list[CommandDef] = []
    for path in _iter_source_files(root, _TS_EXTENSIONS):
        content = _read(path)
        if content is not None and "defineCommand" in content:
            commands.extend(parse_ts_define_commands(content, str(path)))
    return commands


# ─── Python parsing ──────────────────────────────────────────────────────────


def _is_command_factory(func: ast.expr) -> bool:
    """``x.command(...)``, ``define_command(...)`` or ``x.define_command(...)``."""
    if isinstance(func, ast.Name):
        return func.id == "define_command"
    if isinstance(func, ast.Attribute):
        return func.attr in {"command", "define_command"}
    return False


def _str_constant(node: ast.expr | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def parse_py_commands(content: str, file: str = "") -> list[CommandDef]:
    """Find ``@x.command(...)`` decorators and ``define_command(...)`` calls.

    Names and descriptions may be keyword or positional arguments. The source
    is parsed with ``ast``, so any quoting, escapes and implicit string
    concatenation work. Files that do not parse are skipped.
    """
    try:
        tree = ast.parse(content)
    except (SyntaxError, ValueError):
        return []

    candidates: list[ast.Call] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            candidates.extend(
                d for d in node.decorator_list
                if isinstance(d, ast.Call) and _is_command_factory(d.func)
            )
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, (ast.Name, ast.Attribute))
            and getattr(node.func, "id", getattr(node.func, "attr", None)) == "define_command"
        ):
            candidates.append(node)

    commands: list[CommandDef] = []
    seen: set[int] = set()
    for call in candidates:
        if id(call) in seen:
            continue
        seen.add(id(call))
        keywords = {k.arg: k.value for k in call.keywords if k.arg}
        name = _str_constant(keywords.get("name")) or _str_constant(
            call.args[0] if call.args else None
        )
        description = _str_constant(keywords.get("description")) or _str_constant(
            call.args[1] if len(call.args) > 1 else None
        )
        if name is None or description is None:
            continue
        commands.append(CommandDef(
            name=name, description=description, file=file, line=call.lineno
        ))
    commands.sort(key=lambda c: c.line)
    return commands


def _find_py_commands(root: Path) -> list[CommandDef]:
    """Find @server.command() or define_command() definitions in Python files."""
    commands: list[CommandDef] = []
    for path in _iter_source_files(root, {".py"}):
        content = _read(path)
        if content is not None and ("command" in content):
            commands.extend(parse_py_commands(content, str(path)))
    return commands


# ─── Quality checks ─────────────────────────────────────────────────────────

_MIN_DESC_LENGTH = 10
_MAX_DESC_LENGTH = 120

_IMPERATIVE_VERBS = {
    "get", "list", "create", "update", "delete", "remove", "add", "set",
    "check", "validate", "run", "execute", "start", "stop", "find", "search",
    "fetch", "send", "connect", "disconnect", "export", "import", "generate",
    "build", "deploy", "test", "lint", "format", "parse", "resolve", "scan",
    "echo", "ping", "greet", "register", "publish", "subscribe", "notify",
    "query", "count", "aggregate", "transform", "convert", "normalize",
    "evaluate", "compute", "calculate", "measure", "report", "analyze",
}


def _check_length(cmd: CommandDef) -> QualityIssue | None:
    """Check description is neither too short nor too long."""
    length = len(cmd.description)
    if length < _MIN_DESC_LENGTH:
        return QualityIssue(
            command=cmd.name,
            file=cmd.file,
            line=cmd.line,
            check="description-too-short",
            message=f"Description is only {length} chars (min {_MIN_DESC_LENGTH})",
            suggestion="Add more detail about what the command does and returns",
        )
    if length > _MAX_DESC_LENGTH:
        return QualityIssue(
            command=cmd.name,
            file=cmd.file,
            line=cmd.line,
            check="description-too-long",
            message=f"Description is {length} chars (max {_MAX_DESC_LENGTH})",
            suggestion="Shorten the description; move details to docs or examples",
        )
    return None


def _check_imperative(cmd: CommandDef) -> QualityIssue | None:
    """Check description starts with an imperative verb."""
    words = cmd.description.split()
    first_word = words[0].lower().rstrip("s") if words else ""
    if first_word not in _IMPERATIVE_VERBS:
        return QualityIssue(
            command=cmd.name,
            file=cmd.file,
            line=cmd.line,
            check="not-imperative",
            message=(
                f"Description starts with '{words[0] if words else ''}' "
                "instead of an imperative verb"
            ),
            suggestion="Start with a verb like 'Get', 'Create', 'List', 'Validate', etc.",
        )
    return None


def _check_duplicates(commands: list[CommandDef]) -> list[QualityIssue]:
    """Check for near-duplicate descriptions using word overlap."""
    issues: list[QualityIssue] = []

    def _words(text: str) -> set[str]:
        return {w.lower() for w in re.findall(r"\w+", text) if len(w) > 2}

    for i, a in enumerate(commands):
        for b in commands[i + 1 :]:
            words_a = _words(a.description)
            words_b = _words(b.description)
            if not words_a or not words_b:
                continue
            overlap = len(words_a & words_b) / min(len(words_a), len(words_b))
            if overlap > 0.8:
                issues.append(QualityIssue(
                    command=a.name,
                    file=a.file,
                    line=a.line,
                    check="near-duplicate",
                    message=f"Description is {overlap:.0%} similar to '{b.name}'",
                    suggestion="Differentiate descriptions to help agents distinguish commands",
                ))

    return issues


# ─── Command ─────────────────────────────────────────────────────────────────


async def alfred_quality(path: str | None = None) -> CommandResult[dict]:
    """Validate semantic quality of command descriptions.

    Scans for defineCommand() (TypeScript) and @server.command() (Python)
    definitions, then checks:
    - Description length (not too short, not too long)
    - Imperative mood (starts with a verb)
    - Near-duplicate descriptions (>80% word overlap)

    Args:
        path: Directory to scan. Defaults to current working directory.

    Returns:
        CommandResult with quality issues and summary.
    """
    root = Path(path) if path else Path(".")

    ts_commands = _find_ts_commands(root)
    py_commands = _find_py_commands(root)
    all_commands = ts_commands + py_commands

    issues: list[QualityIssue] = []

    for cmd in all_commands:
        length_issue = _check_length(cmd)
        if length_issue:
            issues.append(length_issue)
        imperative_issue = _check_imperative(cmd)
        if imperative_issue:
            issues.append(imperative_issue)

    issues.extend(_check_duplicates(all_commands))

    return success(
        data={
            "commands_scanned": len(all_commands),
            "typescript_commands": len(ts_commands),
            "python_commands": len(py_commands),
            "issue_count": len(issues),
            "issues": [i.to_dict() for i in issues],
        },
        confidence=1.0,
        reasoning=(
            f"Scanned {len(all_commands)} command definitions "
            f"({len(ts_commands)} TS, {len(py_commands)} Python): "
            f"{len(issues)} quality issues found"
        ),
    )
