"""
AFD Linter - Multi-language linting for Agent-First Development patterns.

Supports Python, TypeScript, and Rust codebases.
"""

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


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


class AFDLinter:
    """Multi-language linter for AFD patterns."""

    # File extensions by language
    EXTENSIONS: dict[Language, set[str]] = {
        Language.PYTHON: {".py"},
        Language.TYPESCRIPT: {".ts", ".tsx", ".js", ".jsx"},
        Language.RUST: {".rs"},
    }

    # Directories to skip
    SKIP_DIRS = {
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
    }

    # Additional path patterns to skip (substrings)
    SKIP_PATH_PATTERNS = {
        "chrome-profile",
        "chromadb",
        "Extensions/",
        ".lushx/",
        ".claude/",
        "/.git/",
        "\\\\Extensions\\\\",
    }

    def __init__(self) -> None:
        """Initialize the linter."""
        self._rules: dict[str, callable] = {
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
                self._lint_file(file_path, content, language, result)
            except Exception:
                continue

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

        # Run language-specific rules
        if language == Language.PYTHON:
            self._check_command_result(relative_path, content, result)
            self._check_actionable_errors(relative_path, content, result)
            self._check_no_direct_fetch(relative_path, content, result)

        elif language == Language.TYPESCRIPT:
            self._check_kebab_naming(relative_path, content, result)
            self._check_no_business_in_ui(relative_path, content, result)
            self._check_no_direct_fetch(relative_path, content, result)

        elif language == Language.RUST:
            self._check_command_result_rust(relative_path, content, result)

        # Cross-language rules
        self._check_layer_imports(relative_path, content, language, result)

    # ═══════════════════════════════════════════════════════════════════════════
    # PYTHON RULES
    # ═══════════════════════════════════════════════════════════════════════════

    def _check_command_result(
        self, file_path: str, content: str, result: LintResult
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
                result.add_issue(
                    LintIssue(
                        rule="afd-command-result",
                        message=f"Handler '{match.group(1)}' should return CommandResult",
                        file=file_path,
                        line=line_num,
                        severity=Severity.ERROR,
                        suggestion="Use -> CommandResult[YourDataType] as return annotation",
                    )
                )

    def _check_actionable_errors(
        self, file_path: str, content: str, result: LintResult
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
                result.add_issue(
                    LintIssue(
                        rule="afd-actionable-errors",
                        message="error() call missing 'suggestion' parameter",
                        file=file_path,
                        line=line_num,
                        severity=Severity.WARNING,
                        suggestion="Add suggestion='How to fix this' to help agents recover",
                    )
                )

    def _check_no_direct_fetch(
        self, file_path: str, content: str, result: LintResult
    ) -> None:
        """Check for direct API calls in UI layer."""
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
                result.add_issue(
                    LintIssue(
                        rule="afd-no-direct-fetch",
                        message=f"Direct {name} call in UI layer",
                        file=file_path,
                        line=line_num,
                        severity=Severity.ERROR,
                        suggestion="Move API calls to a service/command layer and call via DirectClient",
                    )
                )

    # ═══════════════════════════════════════════════════════════════════════════
    # TYPESCRIPT RULES
    # ═══════════════════════════════════════════════════════════════════════════

    def _check_kebab_naming(
        self, file_path: str, content: str, result: LintResult
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
                result.add_issue(
                    LintIssue(
                        rule="afd-kebab-naming",
                        message=f"Command name '{name}' is not kebab-case",
                        file=file_path,
                        line=line_num,
                        severity=Severity.ERROR,
                        suggestion=f"Use kebab-case: '{self._to_kebab_case(name)}'",
                    )
                )

    def _check_no_business_in_ui(
        self, file_path: str, content: str, result: LintResult
    ) -> None:
        """Check for business logic patterns in UI components."""
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
                result.add_issue(
                    LintIssue(
                        rule="afd-no-business-in-ui",
                        message=f"Business logic pattern ({description}) in UI component",
                        file=file_path,
                        line=line_num,
                        severity=Severity.WARNING,
                        suggestion="Move data transformations to a service/selector layer",
                    )
                )

    # ═══════════════════════════════════════════════════════════════════════════
    # RUST RULES
    # ═══════════════════════════════════════════════════════════════════════════

    def _check_command_result_rust(
        self, file_path: str, content: str, result: LintResult
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
                result.add_issue(
                    LintIssue(
                        rule="afd-command-result",
                        message=f"Handler '{match.group(3)}' should return CommandResult",
                        file=file_path,
                        line=line_num,
                        severity=Severity.ERROR,
                        suggestion="Use -> CommandResult<T> as return type",
                    )
                )

    # ═══════════════════════════════════════════════════════════════════════════
    # CROSS-LANGUAGE RULES
    # ═══════════════════════════════════════════════════════════════════════════

    def _check_layer_imports(
        self,
        file_path: str,
        content: str,
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
                result.add_issue(
                    LintIssue(
                        rule="afd-layer-imports",
                        message=f"UI component importing directly from {layer_name}",
                        file=file_path,
                        line=line_num,
                        severity=Severity.WARNING,
                        suggestion="Import from adapters or use DirectClient for commands",
                    )
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
