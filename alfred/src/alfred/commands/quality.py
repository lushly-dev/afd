"""alfred_quality — Command description semantic quality validation.

Scans for command definitions in TypeScript and Python, then validates
description quality: length, imperative mood, near-duplicates.
"""

import re
from dataclasses import dataclass, field
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


# ─── Parsing ─────────────────────────────────────────────────────────────────


def _find_ts_commands(root: Path) -> list[CommandDef]:
    """Find defineCommand() calls in TypeScript files."""
    commands: list[CommandDef] = []

    linter = AFDLinter()
    all_extensions = {".ts", ".tsx", ".js", ".jsx"}

    for file_path in root.rglob("*"):
        if not file_path.is_file():
            continue
        if any(skip in file_path.parts for skip in linter.SKIP_DIRS):
            continue
        path_str = str(file_path)
        if any(p in path_str for p in linter.SKIP_PATH_PATTERNS):
            continue
        if file_path.suffix.lower() not in all_extensions:
            continue

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        # Match: defineCommand({ name: 'foo', description: 'bar' ... })
        pattern = re.compile(
            r"defineCommand\s*\(\s*\{[^}]*?"
            r"name\s*:\s*['\"]([^'\"]+)['\"]"
            r"[^}]*?"
            r"description\s*:\s*['\"]([^'\"]+)['\"]",
            re.DOTALL,
        )
        for m in pattern.finditer(content):
            line_num = content[: m.start()].count("\n") + 1
            commands.append(CommandDef(
                name=m.group(1),
                description=m.group(2),
                file=str(file_path),
                line=line_num,
            ))

    return commands


def _find_py_commands(root: Path) -> list[CommandDef]:
    """Find @server.command() or @define_command() in Python files."""
    commands: list[CommandDef] = []

    linter = AFDLinter()

    for file_path in root.rglob("*.py"):
        if not file_path.is_file():
            continue
        if any(skip in file_path.parts for skip in linter.SKIP_DIRS):
            continue
        path_str = str(file_path)
        if any(p in path_str for p in linter.SKIP_PATH_PATTERNS):
            continue

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        # Match: @server.command(name="foo", description="bar")
        # or:    @define_command(name="foo", description="bar")
        pattern = re.compile(
            r"(?:@\w+\.command|@define_command)\s*\("
            r"[^)]*?"
            r"name\s*=\s*['\"]([^'\"]+)['\"]"
            r"[^)]*?"
            r"description\s*=\s*['\"]([^'\"]+)['\"]",
            re.DOTALL,
        )
        for m in pattern.finditer(content):
            line_num = content[: m.start()].count("\n") + 1
            commands.append(CommandDef(
                name=m.group(1),
                description=m.group(2),
                file=str(file_path),
                line=line_num,
            ))

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
    first_word = cmd.description.split()[0].lower().rstrip("s") if cmd.description.split() else ""
    if first_word not in _IMPERATIVE_VERBS:
        return QualityIssue(
            command=cmd.name,
            file=cmd.file,
            line=cmd.line,
            check="not-imperative",
            message=f"Description starts with '{cmd.description.split()[0]}' instead of an imperative verb",
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
