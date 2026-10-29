"""Tests for botcore.commands.dev.portability — hardcoded path detection."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from afd.testing import assert_error, assert_success

from botcore.commands.dev.portability import _matches_glob, dev_check_paths

# ── _matches_glob ────────────────────────────────────────────────────────


def test_matches_glob_positive() -> None:
    """Matches glob pattern correctly."""
    assert _matches_glob(Path("foo/node_modules/bar.js"), ["**/node_modules/**"]) is True


def test_matches_glob_negative() -> None:
    """Non-matching path returns False."""
    assert _matches_glob(Path("src/app.py"), ["**/node_modules/**"]) is False


def test_matches_glob_multiple_patterns() -> None:
    """Matches if any pattern matches."""
    patterns = ["**/.venv/**", "**/dist/**"]
    assert _matches_glob(Path("project/dist/bundle.js"), patterns) is True
    assert _matches_glob(Path("project/src/app.js"), patterns) is False


# ── dev_check_paths ──────────────────────────────────────────────────────


async def test_check_paths_no_issues(tmp_path) -> None:
    """Clean code passes portability check."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.toml").write_text('config_dir = "relative/path"\n')

    with (
        patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.portability.DEFAULT_ALLOWLIST_PATTERNS", []),
    ):
        result = await dev_check_paths(path=str(src))

    data = assert_success(result)
    assert len(data["errors"]) == 0


async def test_check_paths_detects_windows_drive(tmp_path) -> None:
    """Detects hardcoded Windows drive paths."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "config.toml").write_text('DATA_DIR = "C:\\\\Users\\\\admin\\\\data"\n')

    with (
        patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.portability.DEFAULT_ALLOWLIST_PATTERNS", []),
    ):
        result = await dev_check_paths(path=str(src))

    assert_error(result, "HARDCODED_PATHS_FOUND")


async def test_check_paths_ignores_escape_sequences(tmp_path) -> None:
    """Mid-word colon-backslash pairs like `DTSTAMP:\\d` or `User:\\n` are not drive paths."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.ts").write_text(
        "expect(ical).toMatch(/DTSTAMP:\\d{8}/);\n"
        "sections.push(`User:\\n${ctx.join('\\n')}`);\n"
    )

    with (
        patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.portability.DEFAULT_ALLOWLIST_PATTERNS", []),
    ):
        result = await dev_check_paths(path=str(src))

    data = assert_success(result)
    assert len(data["errors"]) == 0


async def test_check_paths_detects_unix_home(tmp_path) -> None:
    """Detects hardcoded Unix home paths."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "config.toml").write_text('LOG_DIR = "/home/deploy/logs"\n')

    with (
        patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.portability.DEFAULT_ALLOWLIST_PATTERNS", []),
    ):
        result = await dev_check_paths(path=str(src))

    assert_error(result, "HARDCODED_PATHS_FOUND")


async def test_check_paths_detects_mac_users(tmp_path) -> None:
    """Detects hardcoded macOS user paths."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "config.toml").write_text('CACHE = "/Users/developer/cache"\n')

    with (
        patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.portability.DEFAULT_ALLOWLIST_PATTERNS", []),
    ):
        result = await dev_check_paths(path=str(src))

    assert_error(result, "HARDCODED_PATHS_FOUND")


async def test_check_paths_detects_localhost_warning(tmp_path) -> None:
    """Detects hardcoded localhost URLs as warnings."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "config.toml").write_text('API_URL = "http://localhost:3000/api"\n')

    with (
        patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.portability.DEFAULT_ALLOWLIST_PATTERNS", []),
    ):
        result = await dev_check_paths(path=str(src))

    data = assert_success(result)
    assert len(data["warnings"]) >= 1


async def test_check_paths_excludes_warnings_when_disabled(tmp_path) -> None:
    """Warnings excluded when include_warnings=False."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "config.toml").write_text('API = "http://127.0.0.1:8080/api"\n')

    with (
        patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.portability.DEFAULT_ALLOWLIST_PATTERNS", []),
    ):
        result = await dev_check_paths(path=str(src), include_warnings=False)

    data = assert_success(result)
    assert len(data["warnings"]) == 0


async def test_check_paths_skips_comments(tmp_path) -> None:
    """Skips paths in comments."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "app.toml").write_text('# Default: /home/user/.config\nconfig = "safe"\n')

    with (
        patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.portability.DEFAULT_ALLOWLIST_PATTERNS", []),
    ):
        result = await dev_check_paths(path=str(src))

    data = assert_success(result)
    assert len(data["errors"]) == 0


async def test_check_paths_skips_regex_patterns(tmp_path) -> None:
    """Skips lines containing regex patterns (re.compile, r-strings)."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "parser.toml").write_text(
        "# regex: re.compile(r'/home/[a-z]+/data')\n"
    )

    with (
        patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path),
        patch("botcore.commands.dev.portability.DEFAULT_ALLOWLIST_PATTERNS", []),
    ):
        result = await dev_check_paths(path=str(src))

    data = assert_success(result)
    assert len(data["errors"]) == 0


async def test_check_paths_skips_non_code_extensions(tmp_path) -> None:
    """Skips files with non-code extensions."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "data.bin").write_bytes(b"/home/user/bad/path")

    with patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path):
        result = await dev_check_paths(path=str(src))

    data = assert_success(result)
    assert data["files_checked"] == 0


async def test_check_paths_path_not_found(tmp_path) -> None:
    """Returns error for nonexistent path."""
    with patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path):
        result = await dev_check_paths(path=str(tmp_path / "nonexistent"))

    assert_error(result, "PATH_NOT_FOUND")


async def test_check_paths_respects_exclude_patterns(tmp_path) -> None:
    """Files matching exclude patterns are skipped."""
    src = tmp_path / "src"
    nm = src / "node_modules" / "pkg"
    nm.mkdir(parents=True)
    (nm / "index.js").write_text('const p = "/home/admin/data";\n')

    with patch("botcore.commands.dev.portability.find_workspace", return_value=tmp_path):
        result = await dev_check_paths(path=str(src))

    data = assert_success(result)
    # node_modules should be excluded
    assert data["files_checked"] == 0
