"""Portability checking — detect hardcoded paths for cross-platform compatibility."""

from __future__ import annotations

import fnmatch
import re
from pathlib import Path

from afd import CommandResult, error, success

from botcore.config import load_config
from botcore.utils.workspace import find_workspace

# Cross-platform path patterns
PATH_PATTERNS = {
    "windows_drive": {
        # Lookbehind keeps mid-word colons like `DTSTAMP:\d` or `User:\n` from matching —
        # a real drive letter is a single letter, not the tail of an identifier.
        "pattern": re.compile(r'(?<![A-Za-z0-9_])["\']?[A-Za-z]:\\[^"\']*["\']?'),
        "description": "Windows absolute path (D:\\...)",
        "severity": "error",
    },
    "windows_users": {
        "pattern": re.compile(r'["\']?C:\\Users\\[^"\'\\]+[^"\']*["\']?', re.IGNORECASE),
        "description": "Windows user home path",
        "severity": "error",
    },
    "unix_home": {
        "pattern": re.compile(r'["\']?/home/[a-zA-Z0-9_-]+[^"\']*["\']?'),
        "description": "Unix home directory path",
        "severity": "error",
    },
    "mac_users": {
        "pattern": re.compile(r'["\']?/Users/[a-zA-Z0-9_-]+[^"\']*["\']?'),
        "description": "macOS user directory path",
        "severity": "error",
    },
    "localhost_port": {
        "pattern": re.compile(r"https?://localhost:\d{4,5}"),
        "description": "Hardcoded localhost URL with port",
        "severity": "warning",
    },
    "127_0_0_1_port": {
        "pattern": re.compile(r"https?://127\.0\.0\.1:\d{4,5}"),
        "description": "Hardcoded 127.0.0.1 URL with port",
        "severity": "warning",
    },
}

DEFAULT_EXCLUDE_PATTERNS = [
    "**/node_modules/**",
    "**/.venv/**",
    "**/__pycache__/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/target/**",
    "**/*.min.js",
    "**/*.min.css",
    "**/package-lock.json",
    "**/pnpm-lock.yaml",
    "**/*.lock",
]

DEFAULT_ALLOWLIST_PATTERNS = [
    "**/.env.local",
    "**/.env.example",
    "**/test_*.py",
    "**/*_test.py",
    "**/tests/**",
    "**/examples/**",
    "**/fixtures/**",
    "**/*.md",
    "**/AGENTS.md",
    "**/portability.py",
]

# File extensions to check
_CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".yaml", ".yml",
    ".toml", ".html", ".css", ".scss", ".sh", ".ps1", ".bat", ".cmd",
}


def _matches_glob(path: Path, patterns: list[str]) -> bool:
    """Check if path matches any glob pattern."""
    path_str = str(path).replace("\\", "/")
    return any(fnmatch.fnmatch(path_str, pattern) for pattern in patterns)


async def dev_check_paths(
    path: str | None = None,
    include_warnings: bool = True,
) -> CommandResult[dict]:
    """Scan for hardcoded paths that break cross-platform portability.

    Detects:
    - Windows absolute paths (C:\\, D:\\, etc.)
    - Unix/Mac absolute paths (/home/user, /Users/name)
    - Hardcoded localhost URLs with ports

    Args:
        path: Directory to scan (defaults to workspace src/)
        include_warnings: Include warning-level issues (localhost URLs)
    """
    ws = find_workspace()
    check_path = Path(path) if path else (ws / "src" if ws else Path("src"))

    if not check_path.exists():
        return error(
            "PATH_NOT_FOUND",
            f"Path not found: {check_path}",
            suggestion="Verify the path exists or omit to use default src/",
        )

    config = load_config(workspace=ws)
    extra_excludes = config.path_check_exclude
    extra_allowlist = config.path_check_allowlist

    exclude_patterns = DEFAULT_EXCLUDE_PATTERNS + extra_excludes
    allowlist_patterns = DEFAULT_ALLOWLIST_PATTERNS + extra_allowlist

    results: dict = {
        "files_checked": 0,
        "errors": [],
        "warnings": [],
        "skipped": 0,
    }

    for file_path in check_path.rglob("*"):
        if not file_path.is_file():
            continue

        if file_path.suffix.lower() not in _CODE_EXTENSIONS:
            continue

        if _matches_glob(file_path, exclude_patterns):
            results["skipped"] += 1
            continue

        if _matches_glob(file_path, allowlist_patterns):
            results["skipped"] += 1
            continue

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        results["files_checked"] += 1
        relative_path = str(file_path.relative_to(ws) if ws else file_path)

        for line_num, line in enumerate(content.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith("//"):
                continue

            if "re.compile(" in line or "r'" in line or 'r"' in line:
                continue

            for pattern_name, pattern_info in PATH_PATTERNS.items():
                matches = pattern_info["pattern"].findall(line)
                if not matches:
                    continue

                severity = pattern_info["severity"]
                if severity == "warning" and not include_warnings:
                    continue

                issue = {
                    "file": relative_path,
                    "line": line_num,
                    "pattern": pattern_name,
                    "description": pattern_info["description"],
                    "matches": matches,
                    "content": line.strip()[:100],
                }

                if severity == "error":
                    results["errors"].append(issue)
                else:
                    results["warnings"].append(issue)

    results["errors"].sort(key=lambda x: (x["file"], x["line"]))
    results["warnings"].sort(key=lambda x: (x["file"], x["line"]))

    error_count = len(results["errors"])
    warning_count = len(results["warnings"])

    if error_count > 0:
        files_with_errors = set(e["file"] for e in results["errors"])
        return error(
            "HARDCODED_PATHS_FOUND",
            f"Found {error_count} hardcoded paths in {len(files_with_errors)} file(s)",
            suggestion="Replace hardcoded paths with environment variables or relative paths",
        )

    if warning_count > 0:
        return success(
            data=results,
            reasoning=f"{warning_count} warning(s) found (localhost URLs). "
            f"Checked {results['files_checked']} files.",
        )

    return success(
        data=results,
        reasoning=f"No hardcoded paths found in {results['files_checked']} files",
    )
