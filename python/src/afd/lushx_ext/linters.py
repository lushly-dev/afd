"""
AFD Linter - Multi-language linting for Agent-First Development patterns.

Supports Python, TypeScript, and Rust codebases.
"""

import logging
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
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

_RULE_DIRECT_FETCH = "afd-no-direct-fetch"


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
            # Cross-language rules
            "afd-layer-imports": self._check_layer_imports,
        }

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

        elif language == Language.RUST:
            self._check_command_result_rust(relative_path, content, lines, result)

        # Cross-language rules
        self._check_layer_imports(relative_path, content, lines, language, result)

    # ═══════════════════════════════════════════════════════════════════════════
    # SUPPRESSION / CALIBRATION
    # ═══════════════════════════════════════════════════════════════════════════

    def _emit(self, issue: LintIssue, lines: Sequence[str], result: LintResult) -> None:
        """Add an issue unless calibration suppresses it; record either way."""
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
