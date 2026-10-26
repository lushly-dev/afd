"""
AFD Linter - Multi-language linting for Agent-First Development patterns.

Supports Python, TypeScript, and Rust codebases.
"""

import logging
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from enum import Enum
from pathlib import Path
from typing import Any, ClassVar

logger = logging.getLogger("afd.lint")

# ─── Suppression / calibration primitives ────────────────────────────────────
#
# These make the linter *configurable* without forking. They cover the three
# false-positive classes that a real consumer (Microsoft Fabric Zero) had to
# post-filter downstream: story/test fixtures, framework/tooling paths, and
# comment/data-URI/annotated direct-fetch matches. Every suppression is counted
# on the LintResult so the calibration stays auditable.

# Story and unit/spec test files are not product architecture surface, so the
# UI-directory rules (business-logic and direct-fetch) are near-universal false
# positives there. Matched as a dotted filename marker so any code extension
# (`.ts`, `.tsx`, `.js`, `.jsx`) is covered.
_STORY_TEST_MARKERS = (".stories.", ".test.", ".spec.")

# Only the UI-directory rules are excluded on story/test files; correctness
# rules (CommandResult shape, actionable errors, kebab naming) still apply.
_STORY_TEST_EXCLUDED_RULES = frozenset({"afd-no-business-in-ui", "afd-no-direct-fetch"})

# Inline suppression directive. A reason is MANDATORY: the directive only
# suppresses when non-whitespace text follows the colon, so every suppression
# stays auditable. The directive is line-scoped (it suppresses *every* rule that
# fires on the target line), and applies whether it sits on the flagged line or
# the line directly above it.
_DIRECTIVE_RE = re.compile(r"afd-lint-disable:\s*(\S.*)")

# First visible argument of a `fetch(` call, up to the first comma or ')'.
_FETCH_ARG_RE = re.compile(r"""fetch\s*\(\s*(?P<quote>['"`])?(?P<arg>[^,)\n]*)""")

# Suppression reason labels reported in LintResult.suppressed_by_reason.
_REASON_STORY_TEST = "story-or-test-file"
_REASON_RULE_PATH = "rule-path-exclude"
_REASON_COMMENT = "comment-line"
_REASON_DATA_URI = "data-uri-fetch"
_REASON_DIRECTIVE = "inline-directive"
_REASON_SEVERITY_OFF = "severity-off"

# Value accepted by `rule_severity_overrides` to turn a rule off entirely.
_SEVERITY_OFF = "off"

_RULE_DIRECT_FETCH = "afd-no-direct-fetch"
_RULE_AMBIENT_TIME = "afd-no-ambient-time"
_RULE_AMBIENT_RANDOM = "afd-no-ambient-random"

# Ambient time and randomness inside a command handler make its result depend on
# the wall clock or an unseeded generator, so tests and replays cannot pin it.
# Handlers read `context.clock` / `context.random` instead. Matched against
# source with strings and comments blanked out (see `_mask_ts_source`).
_AMBIENT_TIME_PATTERNS = (
    (re.compile(r"\bDate\s*\.\s*now\s*\("), "Date.now()"),
    # Argument-less only: `new Date(x)` converts a value and is deterministic.
    (re.compile(r"\bnew\s+Date\b\s*(?:\(\s*\)|(?![\s(]))"), "new Date()"),
    (re.compile(r"\bperformance\s*\.\s*now\s*\("), "performance.now()"),
)
_AMBIENT_RANDOM_PATTERNS = (
    (re.compile(r"\bMath\s*\.\s*random\s*\("), "Math.random()"),
    (re.compile(r"\bcrypto\s*\.\s*randomUUID\s*\("), "crypto.randomUUID()"),
)

_DEFINE_COMMAND_RE = re.compile(r"\bdefineCommand\b")
# A `handler` property at the start of an options-object property:
# `handler: ...`, `handler(...)`, `async handler(...)` or `handler<T>(...)`.
_HANDLER_KEY_RE = re.compile(r"\s*(?:async\s+)?handler\s*[:(<]")


def _normalize_path(path: str) -> str:
    """Normalize path separators so Windows backslash paths match too."""
    return path.replace("\\", "/")


def _is_story_or_test_file(path: str) -> bool:
    """True when the file is a Storybook story or unit/spec test fixture.

    JS/TS naming assumption, deliberate: only dotted markers (``.stories.``,
    ``.test.``, ``.spec.``) are recognized. Python's ``test_*.py`` prefix
    convention is not — pytest files rarely live under UI directories, and
    widening the match risks skipping real product files.
    """
    name = _normalize_path(path).rsplit("/", 1)[-1].lower()
    return any(marker in name for marker in _STORY_TEST_MARKERS)


def _is_comment_line(line: str) -> bool:
    """True when the line is a single-line or block-comment line.

    Line-scoped by design: a `fetch(` opening on a code line whose *tail* is a
    block comment is still real code and stays flagged. Multi-line `/* ... */`
    blocks are only recognized on lines that themselves begin with a comment
    marker — full block-comment tracking is intentionally out of scope.

    JS/TS comment markers only, deliberate: Python's ``#`` is not recognized
    even though afd-no-direct-fetch also runs on Python files. A ``#``-comment
    false positive there stays flagged (annotate it with ``afd-lint-disable:``
    if reviewed); keeping the marker set small avoids excusing error-severity
    matches on non-comment ``#`` lines in the other linted languages.
    """
    stripped = line.strip()
    return stripped.startswith(("//", "*", "/*"))


def _is_data_uri_fetch(line: str) -> bool:
    """True when the flagged fetch loads a `data:` URI string literal.

    Scoped to the string-literal case only (`fetch('data:...')`) — a local,
    no-network blob read. Bare identifiers are deliberately *not* treated as
    data URIs; that heuristic is repo-specific and stays with consumers.
    """
    match = _FETCH_ARG_RE.search(line)
    if not match or not match.group("quote"):
        return False
    return match.group("arg").strip().startswith("data:")


def _has_directive(line: str | None) -> bool:
    """True when the line carries an `afd-lint-disable: <reason>` directive."""
    if not line:
        return False
    match = _DIRECTIVE_RE.search(line)
    return bool(match and match.group(1).strip())


def _mask_ts_source(content: str) -> str:
    """Blank out string literals and comments, keeping offsets and newlines.

    The result has the same length as ``content`` and a newline wherever
    ``content`` has one, so offsets and line numbers carry over unchanged.
    Code inside template-literal ``${...}`` stays visible. Regex literals are
    blanked too, found with the usual heuristic: a ``/`` where an expression
    can start (see ``_regex_can_start``). A regex the heuristic misses can
    throw off the scan for the rest of that file, which at worst misses or
    misplaces a handler.
    """
    out = list(content)
    n = len(content)
    i = 0
    # Brace depth of each open `${` in a template literal, innermost last.
    template_stack: list[int] = []
    depth = 0

    def blank(start: int, end: int) -> None:
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "

    def scan_template(start: int) -> int:
        """Blank template text from ``start``; return where code resumes."""
        k = start
        while k < n:
            ch = content[k]
            if ch == "\\":
                k += 2
                continue
            if ch == "`":
                blank(start, k)
                return k + 1
            if ch == "$" and k + 1 < n and content[k + 1] == "{":
                blank(start, k)
                template_stack.append(depth)
                return k + 2
            k += 1
        blank(start, n)
        return n

    while i < n:
        ch = content[i]
        nxt = content[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            end = content.find("\n", i)
            end = n if end == -1 else end
            blank(i, end)
            i = end
        elif ch == "/" and nxt == "*":
            end = content.find("*/", i + 2)
            end = n if end == -1 else end + 2
            blank(i, end)
            i = end
        elif ch in ("'", '"'):
            k = i + 1
            while k < n and content[k] not in (ch, "\n"):
                k += 2 if content[k] == "\\" else 1
            end = min(k + 1, n)
            blank(i + 1, min(k, n))
            i = end
        elif ch == "`":
            i = scan_template(i + 1)
        elif ch == "/" and _regex_can_start(out, i):
            end = _regex_end(content, i)
            if end is None:
                i += 1  # no closing slash on this line: division after all
            else:
                blank(i + 1, end)
                i = end + 1
        elif ch == "{":
            depth += 1
            i += 1
        elif ch == "}":
            if template_stack and template_stack[-1] == depth:
                template_stack.pop()
                i = scan_template(i + 1)
            else:
                depth -= 1
                i += 1
        else:
            i += 1
    return "".join(out)


# Characters and keywords after which a `/` starts a regex rather than dividing.
_REGEX_PRECEDING_CHARS = frozenset("(,=:[!&|?{};+-*%<>~^")
_REGEX_PRECEDING_WORDS = frozenset({
    "return",
    "typeof",
    "case",
    "do",
    "else",
    "in",
    "of",
    "void",
    "yield",
    "await",
    "delete",
    "throw",
    "new",
})


def _regex_can_start(out: Sequence[str], i: int) -> bool:
    """True when a ``/`` at ``i`` sits where an expression can start."""
    k = i - 1
    while k >= 0 and out[k].isspace():
        k -= 1
    if k < 0:
        return True
    prev = out[k]
    if prev in _REGEX_PRECEDING_CHARS:
        return True
    if prev.isalnum() or prev in "_$":
        start = k
        while start > 0 and (out[start - 1].isalnum() or out[start - 1] in "_$"):
            start -= 1
        return "".join(out[start : k + 1]) in _REGEX_PRECEDING_WORDS
    return False


def _regex_end(content: str, i: int) -> int | None:
    """Index of the slash closing the regex opened at ``i``, or None."""
    in_class = False
    k = i + 1
    while k < len(content) and content[k] != "\n":
        ch = content[k]
        if ch == "\\":
            k += 2
            continue
        if ch == "[":
            in_class = True
        elif ch == "]":
            in_class = False
        elif ch == "/" and not in_class:
            return k
        k += 1
    return None


_OPENERS = {"(": ")", "[": "]", "{": "}"}
_CLOSERS = frozenset(_OPENERS.values())


def _match_close(masked: str, open_idx: int) -> int:
    """Index of the bracket closing the one at ``open_idx``, or len on EOF."""
    depth = 0
    for k in range(open_idx, len(masked)):
        ch = masked[k]
        if ch in _OPENERS:
            depth += 1
        elif ch in _CLOSERS:
            depth -= 1
            if depth == 0:
                return k
    return len(masked)


def _property_end(masked: str, start: int, limit: int) -> int:
    """End of the object property value starting at ``start``.

    Stops at the first ``,`` or closing bracket at the property's own depth, so
    block bodies, expression bodies and method shorthand are all covered. A
    comma inside type arguments at that depth (``Promise<Result<A, B>>``,
    ``async <T, U>(...)``) does not end the property: a ``<`` directly after a
    name or after ``async`` opens type arguments when its ``>`` closes before
    the property can end, so an unspaced comparison (``a<b``) is not read as
    one.
    """
    depth = 0
    angle = 0
    for k in range(start, limit):
        ch = masked[k]
        if ch in _OPENERS:
            depth += 1
        elif ch in _CLOSERS:
            if depth == 0:
                return k
            depth -= 1
        elif depth == 0 and ch == "<" and _opens_type_arguments(masked, k, limit):
            angle += 1
        elif depth == 0 and ch == ">" and angle and masked[k - 1] != "=":
            angle -= 1
        elif ch == "," and depth == 0 and not angle:
            return k
    return limit


def _opens_type_arguments(masked: str, k: int, limit: int) -> bool:
    """True when the ``<`` at ``k`` opens type arguments.

    It must follow a name directly or ``async``, and its matching ``>`` must
    come before a ``;`` or a closing bracket of the enclosing scope.
    """
    prev = masked[k - 1] if k else ""
    if not (prev.isalnum() or prev in "_$"):
        j = k - 1
        while j >= 0 and masked[j].isspace():
            j -= 1
        if masked[max(j - 4, 0) : j + 1] != "async" or (
            j >= 5 and (masked[j - 5].isalnum() or masked[j - 5] in "_$")
        ):
            return False
    angle = depth = 0
    for m in range(k, limit):
        ch = masked[m]
        if ch in _OPENERS:
            depth += 1
        elif ch in _CLOSERS:
            if depth == 0:
                return False
            depth -= 1
        elif depth == 0 and ch == ";":
            return False
        elif ch == "<":
            angle += 1
        elif ch == ">" and masked[m - 1] != "=":
            angle -= 1
            if angle == 0:
                return True
    return False


def _ts_handler_spans(masked: str) -> list[tuple[int, int]]:
    """Source spans of the inline handlers of ``defineCommand(...)`` calls.

    Only the ``handler`` property at the top level of the options object
    counts. A handler passed by reference (``handler: runCreate``) yields a
    span holding just that name, so its body elsewhere is not checked.
    """
    spans: list[tuple[int, int]] = []
    for match in _DEFINE_COMMAND_RE.finditer(masked):
        k = match.end()
        while k < len(masked) and masked[k].isspace():
            k += 1
        if k < len(masked) and masked[k] == "<":
            # Skip explicit type arguments: defineCommand<Input, Output>(...).
            angle = 0
            while k < len(masked):
                if masked[k] == "<":
                    angle += 1
                elif masked[k] == ">" and masked[k - 1] != "=":
                    angle -= 1
                    if angle == 0:
                        k += 1
                        break
                k += 1
            while k < len(masked) and masked[k].isspace():
                k += 1
        if k >= len(masked) or masked[k] != "(":
            continue  # an import or other mention, not a call
        call_end = _match_close(masked, k)
        brace = masked.find("{", k, call_end)
        if brace == -1:
            continue
        obj_end = _match_close(masked, brace)
        # Walk the options object's own properties, skipping nested values.
        pos = brace + 1
        while pos < obj_end:
            prop_end = _property_end(masked, pos, obj_end)
            if _HANDLER_KEY_RE.match(masked, pos, prop_end):
                spans.append((pos, prop_end))
            pos = prop_end + 1
    return spans


def _flagged_and_above(lines: Sequence[str], line_no: int) -> tuple[str | None, str | None]:
    """Return (flagged line, line directly above), 1-based, or None if absent."""
    idx = line_no - 1
    flagged = lines[idx] if 0 <= idx < len(lines) else None
    above = lines[idx - 1] if 0 <= idx - 1 < len(lines) else None
    return flagged, above


class Severity(Enum):
    """Lint issue severity levels."""

    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class Language(Enum):
    """Supported languages for linting."""

    PYTHON = "python"
    TYPESCRIPT = "typescript"
    RUST = "rust"


@dataclass
class LintIssue:
    """A single lint issue found in the code."""

    rule: str
    message: str
    file: str
    line: int
    severity: Severity = Severity.ERROR
    suggestion: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "rule": self.rule,
            "message": self.message,
            "file": self.file,
            "line": self.line,
            "severity": self.severity.value,
            "suggestion": self.suggestion,
        }


@dataclass
class LintResult:
    """Result of running the linter."""

    files_checked: int = 0
    error_count: int = 0
    warning_count: int = 0
    issues: list[LintIssue] = field(default_factory=list)
    # Suppression bookkeeping (additive, backward compatible). Counts issues the
    # linter's calibration dropped before they reached `issues`, so consumers can
    # audit exactly what was filtered and why.
    suppressed_total: int = 0
    suppressed_by_rule: dict[str, int] = field(default_factory=dict)
    suppressed_by_reason: dict[str, int] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        """True if no errors were found."""
        return self.error_count == 0

    def add_issue(self, issue: LintIssue) -> None:
        """Add an issue and update counts."""
        self.issues.append(issue)
        if issue.severity == Severity.ERROR:
            self.error_count += 1
        elif issue.severity == Severity.WARNING:
            self.warning_count += 1

    def add_suppression(self, rule: str, reason: str) -> None:
        """Record that one issue was suppressed by calibration."""
        self.suppressed_total += 1
        self.suppressed_by_rule[rule] = self.suppressed_by_rule.get(rule, 0) + 1
        self.suppressed_by_reason[reason] = self.suppressed_by_reason.get(reason, 0) + 1

    def suppressed_summary(self) -> dict[str, Any]:
        """Return a JSON-serializable summary of suppressed issues."""
        return {
            "total": self.suppressed_total,
            "by_rule": dict(self.suppressed_by_rule),
            "by_reason": dict(self.suppressed_by_reason),
        }


class AFDLinter:
    """Multi-language linter for AFD patterns."""

    # File extensions by language
    EXTENSIONS: ClassVar[Mapping[Language, frozenset[str]]] = {
        Language.PYTHON: frozenset({".py"}),
        Language.TYPESCRIPT: frozenset({".ts", ".tsx", ".js", ".jsx"}),
        Language.RUST: frozenset({".rs"}),
    }

    # Directories to skip
    SKIP_DIRS: ClassVar[frozenset[str]] = frozenset({
        # Package managers
        "node_modules",
        ".venv",
        "venv",
        ".env",
        # Build artifacts
        "__pycache__",
        ".git",
        "dist",
        "build",
        "target",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        # IDE/tool data
        ".lushx",
        ".claude",
        ".agent",
        ".idea",
        ".vscode",
        # Browser/profile data
        "chrome-profile",
        "chromadb",
        "Default",
        "Extensions",
        # Generated code
        ".next",
        ".nuxt",
        ".output",
        ".turbo",
    })

    # Additional path patterns to skip (substrings)
    SKIP_PATH_PATTERNS: ClassVar[frozenset[str]] = frozenset({
        "chrome-profile",
        "chromadb",
        "Extensions/",
        ".lushx/",
        ".claude/",
        "/.git/",
        "\\\\Extensions\\\\",
    })

    def __init__(
        self,
        *,
        exclude_story_test_files: bool = True,
        rule_path_excludes: Mapping[str, Sequence[str]] | None = None,
        rule_severity_overrides: Mapping[str, Severity | str] | None = None,
    ) -> None:
        """Initialize the linter.

        Args:
            exclude_story_test_files: When True (default), the UI-directory rules
                (``afd-no-business-in-ui``, ``afd-no-direct-fetch``) skip
                Storybook story files and unit/spec test files
                (``*.stories.*``, ``*.test.*``, ``*.spec.*``). These are
                demonstrably not product architecture surface — a real consumer
                (Fabric Zero) saw 23 of 298 business-logic warnings come from
                story files alone. Set False to restore the pre-calibration
                behavior and flag them.
            rule_path_excludes: Optional mapping of rule id to path
                substrings/prefixes. An issue is suppressed when its file path
                contains any substring listed for that rule. Path separators are
                normalized, so Windows backslash paths match forward-slash
                patterns. Lets a project exclude its own framework/tooling paths
                from a specific rule without forking. Default None preserves the
                pre-existing behavior for every rule.
            rule_severity_overrides: Optional mapping of rule id to the
                severity its findings are reported at: ``"error"``,
                ``"warning"`` (or the matching ``Severity`` members) or
                ``"off"``. Since ``passed`` is derived from the error count,
                this decides which rules gate a build. ``"off"`` records every
                finding of the rule as suppressed with reason
                ``severity-off`` instead of dropping it silently. Default None
                keeps each rule's built-in severity.

        Raises:
            ValueError: If ``rule_severity_overrides`` names an unknown rule id
                or an unsupported severity, so a typo cannot silently change
                nothing.
        """
        self.exclude_story_test_files = exclude_story_test_files
        self._rule_path_excludes: dict[str, list[str]] = {
            rule: [_normalize_path(p) for p in patterns]
            for rule, patterns in (rule_path_excludes or {}).items()
        }
        self._rules: dict[str, Callable[..., None]] = {
            # Python rules
            "afd-command-result": self._check_command_result,
            "afd-actionable-errors": self._check_actionable_errors,
            "afd-no-direct-fetch": self._check_no_direct_fetch,
            # TypeScript rules
            "afd-kebab-naming": self._check_kebab_naming,
            "afd-no-business-in-ui": self._check_no_business_in_ui,
            _RULE_AMBIENT_TIME: self._check_no_ambient_in_handlers,
            _RULE_AMBIENT_RANDOM: self._check_no_ambient_in_handlers,
            # Cross-language rules
            "afd-layer-imports": self._check_layer_imports,
        }
        self._severity_overrides = self._validate_severity_overrides(
            rule_severity_overrides or {}
        )

    def _validate_severity_overrides(
        self, overrides: Mapping[str, Severity | str]
    ) -> dict[str, Severity | None]:
        """Resolve overrides to a Severity, or None for ``"off"``."""
        allowed = {"error": Severity.ERROR, "warning": Severity.WARNING, _SEVERITY_OFF: None}
        if not isinstance(overrides, Mapping):
            raise ValueError(
                "rule_severity_overrides must map rule ids to 'error', 'warning' or 'off'"
            )
        resolved: dict[str, Severity | None] = {}
        for rule, value in overrides.items():
            if rule not in self._rules:
                known = ", ".join(sorted(self._rules))
                raise ValueError(
                    f"Unknown rule id {rule!r} in rule_severity_overrides. Known rules: {known}"
                )
            key = value.value if isinstance(value, Severity) else value
            if not isinstance(key, str) or key not in allowed:
                raise ValueError(
                    f"Unsupported severity {value!r} for rule {rule!r} in "
                    "rule_severity_overrides. Use 'error', 'warning' or 'off'."
                )
            resolved[rule] = allowed[key]
        return resolved

    def lint(self, path: Path) -> LintResult:
        """Lint all supported files in the given path."""
        result = LintResult()

        for file_path in self._find_files(path):
            result.files_checked += 1
            language = self._detect_language(file_path)

            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue  # unreadable (vanished, permissions): nothing to lint
            try:
                self._lint_file(file_path, content, language, result)
            except Exception:
                # A rule bug must not end the run, nor pass silently.
                logger.warning("Linting %s failed", file_path, exc_info=True)

        return result

    def _find_files(self, path: Path) -> list[Path]:
        """Find all lintable files in the path."""
        all_extensions = set()
        for exts in self.EXTENSIONS.values():
            all_extensions.update(exts)

        files = []
        for file_path in path.rglob("*"):
            if not file_path.is_file():
                continue

            # Skip by directory name
            if any(skip in file_path.parts for skip in self.SKIP_DIRS):
                continue

            # Skip by path pattern (substring)
            path_str = str(file_path)
            if any(pattern in path_str for pattern in self.SKIP_PATH_PATTERNS):
                continue

            if file_path.suffix.lower() in all_extensions:
                files.append(file_path)

        return files

    def _detect_language(self, file_path: Path) -> Language:
        """Detect the language of a file by extension."""
        suffix = file_path.suffix.lower()
        for lang, exts in self.EXTENSIONS.items():
            if suffix in exts:
                return lang
        return Language.PYTHON  # Default fallback

    def _lint_file(
        self, file_path: Path, content: str, language: Language, result: LintResult
    ) -> None:
        """Run all applicable rules on a file."""
        relative_path = str(file_path)
        # Split once; reused by every rule's suppression check (comment/data-URI
        # inspection and inline-directive lookups) with no extra disk reads.
        # split("\n") — NOT splitlines() — so this array exactly mirrors the
        # `content[:match.start()].count("\n") + 1` line numbering every rule
        # uses. splitlines() also breaks on \r, \f, \v, U+0085, U+2028/2029,
        # which would desync issue.line from the array on such files. CRLF files
        # keep a trailing "\r" per line; the strip()-based checks tolerate it.
        lines = content.split("\n")

        # Run language-specific rules
        if language == Language.PYTHON:
            self._check_command_result(relative_path, content, lines, result)
            self._check_actionable_errors(relative_path, content, lines, result)
            self._check_no_direct_fetch(relative_path, content, lines, result)

        elif language == Language.TYPESCRIPT:
            self._check_kebab_naming(relative_path, content, lines, result)
            self._check_no_business_in_ui(relative_path, content, lines, result)
            self._check_no_direct_fetch(relative_path, content, lines, result)
            self._check_no_ambient_in_handlers(relative_path, content, lines, result)

        elif language == Language.RUST:
            self._check_command_result_rust(relative_path, content, lines, result)

        # Cross-language rules
        self._check_layer_imports(relative_path, content, lines, language, result)

    # ═══════════════════════════════════════════════════════════════════════════
    # SUPPRESSION / CALIBRATION
    # ═══════════════════════════════════════════════════════════════════════════

    def _emit(self, issue: LintIssue, lines: Sequence[str], result: LintResult) -> None:
        """Add an issue unless calibration suppresses it; record either way.

        Severity overrides apply here so every rule is covered in one place. A
        rule set to ``"off"`` wins over every other suppression reason, since it
        is configuration for the whole rule rather than for a file or line.
        """
        if issue.rule in self._severity_overrides:
            severity = self._severity_overrides[issue.rule]
            if severity is None:
                result.add_suppression(issue.rule, _REASON_SEVERITY_OFF)
                return
            issue = replace(issue, severity=severity)
        reason = self._suppression_reason(issue, lines)
        if reason is None:
            result.add_issue(issue)
        else:
            result.add_suppression(issue.rule, reason)

    def _suppression_reason(self, issue: LintIssue, lines: Sequence[str]) -> str | None:
        """Return the reason to suppress this issue, or None to keep it.

        Order matters: file-level classifications (story/test, per-rule path
        excludes) win over line-level ones, and the auditable inline directive
        wins over the direct-fetch content heuristics.
        """
        # 1. Story/test fixtures are not product architecture surface (UI rules only).
        if (
            self.exclude_story_test_files
            and issue.rule in _STORY_TEST_EXCLUDED_RULES
            and _is_story_or_test_file(issue.file)
        ):
            return _REASON_STORY_TEST

        # 2. Per-rule path excludes (project framework/tooling calibration).
        norm_file = _normalize_path(issue.file)
        if any(pattern in norm_file for pattern in self._rule_path_excludes.get(issue.rule, ())):
            return _REASON_RULE_PATH

        # 3. Inline suppression directive — linter-wide, line-scoped, reason required.
        flagged, above = _flagged_and_above(lines, issue.line)
        if _has_directive(flagged) or _has_directive(above):
            return _REASON_DIRECTIVE

        # 4. Direct-fetch content heuristics: comments and data: URI literals.
        if issue.rule == _RULE_DIRECT_FETCH and flagged is not None:
            if _is_comment_line(flagged):
                return _REASON_COMMENT
            if _is_data_uri_fetch(flagged):
                return _REASON_DATA_URI

        return None

    # ═══════════════════════════════════════════════════════════════════════════
    # PYTHON RULES
    # ═══════════════════════════════════════════════════════════════════════════

    def _check_command_result(
        self, file_path: str, content: str, lines: Sequence[str], result: LintResult
    ) -> None:
        """Check that async handlers return CommandResult."""
        # Look for async def handler/execute without CommandResult return type
        handler_pattern = re.compile(
            r"async\s+def\s+(handler|execute)\s*\([^)]*\)\s*(?:->([^:]+))?:",
            re.MULTILINE,
        )

        for match in handler_pattern.finditer(content):
            return_type = match.group(2)
            if return_type and "CommandResult" not in return_type:
                line_num = content[: match.start()].count("\n") + 1
                self._emit(
                    LintIssue(
                        rule="afd-command-result",
                        message=f"Handler '{match.group(1)}' should return CommandResult",
                        file=file_path,
                        line=line_num,
                        severity=Severity.ERROR,
                        suggestion="Use -> CommandResult[YourDataType] as return annotation",
                    ),
                    lines,
                    result,
                )

    def _check_actionable_errors(
        self, file_path: str, content: str, lines: Sequence[str], result: LintResult
    ) -> None:
        """Check that error() calls include suggestion parameter."""
        # Only check files that import from afd or look like command handlers
        is_afd_file = (
            "from afd " in content
            or "import afd" in content
            or "CommandResult" in content
            or "-> CommandResult" in content
        )

        if not is_afd_file:
            return

        # Look for error() calls that look like AFD error() - typically:
        # error("CODE", "message", ...) or error(code="...", ...)
        # Pattern: error( followed by a string (error code)
        error_pattern = re.compile(
            r"\berror\s*\(\s*['\"][A-Z_]+['\"]",  # error("ERROR_CODE"
            re.MULTILINE,
        )

        for match in error_pattern.finditer(content):
            # Check if suggestion is provided in the same call
            # Look ahead for closing paren and check for suggestion=
            call_start = match.start()
            paren_depth = 0
            call_end = call_start

            for i, char in enumerate(content[call_start:], call_start):
                if char == "(":
                    paren_depth += 1
                elif char == ")":
                    paren_depth -= 1
                    if paren_depth == 0:
                        call_end = i
                        break

            call_content = content[call_start:call_end]
            if "suggestion=" not in call_content and "suggestion =" not in call_content:
                line_num = content[:call_start].count("\n") + 1
                self._emit(
                    LintIssue(
                        rule="afd-actionable-errors",
                        message="error() call missing 'suggestion' parameter",
                        file=file_path,
                        line=line_num,
                        severity=Severity.WARNING,
                        suggestion="Add suggestion='How to fix this' to help agents recover",
                    ),
                    lines,
                    result,
                )

    def _check_no_direct_fetch(
        self, file_path: str, content: str, lines: Sequence[str], result: LintResult
    ) -> None:
        """Check for direct API calls in UI layer.

        Suppression (comment lines, ``data:`` URI literals, inline directives,
        story/test files, per-rule path excludes) is applied centrally in
        ``_emit`` so it stays consistent across rules and is counted for audit.
        """
        # Only check files in UI-like directories
        ui_patterns = ["components/", "ui/", "views/", "/app/"]
        is_ui_file = any(p in file_path.replace("\\", "/") for p in ui_patterns)

        if not is_ui_file:
            return

        fetch_patterns = [
            (r"\bfetch\s*\(", "fetch()"),
            (r"\baxios\.", "axios"),
            (r"\bhttpx\.", "httpx"),
            (r"\.get\s*\(['\"]https?://", "HTTP GET"),
            (r"\.post\s*\(['\"]https?://", "HTTP POST"),
        ]

        for pattern, name in fetch_patterns:
            for match in re.finditer(pattern, content):
                line_num = content[: match.start()].count("\n") + 1
                self._emit(
                    LintIssue(
                        rule="afd-no-direct-fetch",
                        message=f"Direct {name} call in UI layer",
                        file=file_path,
                        line=line_num,
                        severity=Severity.ERROR,
                        suggestion="Move API calls to a service/command layer and call via DirectClient",
                    ),
                    lines,
                    result,
                )

    # ═══════════════════════════════════════════════════════════════════════════
    # TYPESCRIPT RULES
    # ═══════════════════════════════════════════════════════════════════════════

    def _check_kebab_naming(
        self, file_path: str, content: str, lines: Sequence[str], result: LintResult
    ) -> None:
        """Check that command names are kebab-case."""
        # Only check defineCommand patterns - more accurate than generic name: patterns
        pattern = r"defineCommand\s*\(\s*\{\s*name\s*:\s*['\"]([^'\"]+)['\"]"

        for match in re.finditer(pattern, content):
            name = match.group(1)
            # Only flag if:
            # 1. It's not already kebab-case AND
            # 2. It looks like a command name (has hyphen/dot separator)
            if not self._is_kebab_case(name) and ("-" in name or "." in name):
                line_num = content[: match.start()].count("\n") + 1
                self._emit(
                    LintIssue(
                        rule="afd-kebab-naming",
                        message=f"Command name '{name}' is not kebab-case",
                        file=file_path,
                        line=line_num,
                        severity=Severity.ERROR,
                        suggestion=f"Use kebab-case: '{self._to_kebab_case(name)}'",
                    ),
                    lines,
                    result,
                )

    def _check_no_business_in_ui(
        self, file_path: str, content: str, lines: Sequence[str], result: LintResult
    ) -> None:
        """Check for business logic patterns in UI components.

        Story/test files and per-rule path excludes are filtered centrally in
        ``_emit`` (see ``AFDLinter.__init__``).
        """
        # Only check files in component directories
        ui_patterns = ["components/", "ui/", "views/"]
        is_ui_file = any(p in file_path.replace("\\", "/") for p in ui_patterns)

        if not is_ui_file:
            return

        # Business logic patterns
        patterns = [
            (r"\.map\s*\([^)]+\)\.filter\s*\(", "chained .map().filter()"),
            (r"\.filter\s*\([^)]+\)\.map\s*\(", "chained .filter().map()"),
            (r"\.reduce\s*\(", ".reduce()"),
            (r"new\s+Date\s*\(", "Date calculation"),
            (r"Math\.(floor|ceil|round|abs)\s*\(", "Math calculation"),
        ]

        for pattern, description in patterns:
            for match in re.finditer(pattern, content):
                line_num = content[: match.start()].count("\n") + 1
                self._emit(
                    LintIssue(
                        rule="afd-no-business-in-ui",
                        message=f"Business logic pattern ({description}) in UI component",
                        file=file_path,
                        line=line_num,
                        severity=Severity.WARNING,
                        suggestion="Move data transformations to a service/selector layer",
                    ),
                    lines,
                    result,
                )

    def _check_no_ambient_in_handlers(
        self, file_path: str, content: str, lines: Sequence[str], result: LintResult
    ) -> None:
        """Flag ambient time and randomness inside ``defineCommand`` handlers.

        Covers both ``afd-no-ambient-time`` and ``afd-no-ambient-random``. Only
        inline handler bodies are checked: calls elsewhere in the file, and in
        functions a handler references by name, are not flagged.
        """
        if "defineCommand" not in content:
            return
        masked = _mask_ts_source(content)
        rules = (
            (
                _RULE_AMBIENT_TIME,
                _AMBIENT_TIME_PATTERNS,
                "Read time from the context: (context.clock ?? systemClock).now()",
            ),
            (
                _RULE_AMBIENT_RANDOM,
                _AMBIENT_RANDOM_PATTERNS,
                "Read randomness from the context: (context.random ?? systemRandom).next(), and derive IDs from it",
            ),
        )
        for start, end in _ts_handler_spans(masked):
            for rule, patterns, suggestion in rules:
                for pattern, name in patterns:
                    for match in pattern.finditer(masked, start, end):
                        line_num = content[: match.start()].count("\n") + 1
                        self._emit(
                            LintIssue(
                                rule=rule,
                                message=f"Ambient {name} in command handler",
                                file=file_path,
                                line=line_num,
                                severity=Severity.WARNING,
                                suggestion=suggestion,
                            ),
                            lines,
                            result,
                        )

    # ═══════════════════════════════════════════════════════════════════════════
    # RUST RULES
    # ═══════════════════════════════════════════════════════════════════════════

    def _check_command_result_rust(
        self, file_path: str, content: str, lines: Sequence[str], result: LintResult
    ) -> None:
        """Check that Rust handlers return CommandResult."""
        # Look for fn handler without CommandResult return
        handler_pattern = re.compile(
            r"(pub\s+)?(async\s+)?fn\s+(handler|execute)\s*[<(][^{]+\s*->\s*([^{]+)\s*\{",
            re.MULTILINE,
        )

        for match in handler_pattern.finditer(content):
            return_type = match.group(4)
            if "CommandResult" not in return_type and "Result<" not in return_type:
                line_num = content[: match.start()].count("\n") + 1
                self._emit(
                    LintIssue(
                        rule="afd-command-result",
                        message=f"Handler '{match.group(3)}' should return CommandResult",
                        file=file_path,
                        line=line_num,
                        severity=Severity.ERROR,
                        suggestion="Use -> CommandResult<T> as return type",
                    ),
                    lines,
                    result,
                )

    # ═══════════════════════════════════════════════════════════════════════════
    # CROSS-LANGUAGE RULES
    # ═══════════════════════════════════════════════════════════════════════════

    def _check_layer_imports(
        self,
        file_path: str,
        content: str,
        lines: Sequence[str],
        language: Language,
        result: LintResult,
    ) -> None:
        """Check for improper cross-layer imports."""
        # Determine file's layer from path
        path_lower = file_path.replace("\\", "/").lower()

        # UI layer files
        ui_patterns = ["components/", "ui/", "views/", "/app/pages/"]
        is_ui = any(p in path_lower for p in ui_patterns)

        if not is_ui:
            return

        # Imports that UI shouldn't make directly
        forbidden_patterns: list[tuple[str, str]] = []

        if language == Language.PYTHON:
            forbidden_patterns = [
                (r"from\s+\w+\.services\s+import", "services layer"),
                (r"from\s+\w+\.core\s+import", "core layer"),
                (r"import\s+\w+\.services\.", "services layer"),
            ]
        elif language == Language.TYPESCRIPT:
            forbidden_patterns = [
                (r"from\s+['\"][^'\"]*\/services\/", "services layer"),
                (r"from\s+['\"][^'\"]*\/core\/", "core layer"),
                (r"import\s+.*from\s+['\"][^'\"]*\/api\/", "API layer"),
            ]

        for pattern, layer_name in forbidden_patterns:
            for match in re.finditer(pattern, content):
                line_num = content[: match.start()].count("\n") + 1
                self._emit(
                    LintIssue(
                        rule="afd-layer-imports",
                        message=f"UI component importing directly from {layer_name}",
                        file=file_path,
                        line=line_num,
                        severity=Severity.WARNING,
                        suggestion="Import from adapters or use DirectClient for commands",
                    ),
                    lines,
                    result,
                )

    # ═══════════════════════════════════════════════════════════════════════════
    # HELPERS
    # ═══════════════════════════════════════════════════════════════════════════

    def _is_kebab_case(self, name: str) -> bool:
        """Check if a name is kebab-case."""
        return bool(re.match(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$", name))

    def _to_kebab_case(self, name: str) -> str:
        """Convert a name to kebab-case."""
        # Handle camelCase and PascalCase
        s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1-\2", name)
        s2 = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", s1)
        # Replace dots and underscores with hyphens
        s3 = re.sub(r"[._]", "-", s2)
        return s3.lower()
