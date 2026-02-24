"""Tests for afd.platform module."""

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from afd.platform import (
    ExecErrorCode,
    ExecOptions,
    ExecResult,
    OsInfo,
    create_exec_result,
    exec_command,
    find_up,
    get_os_info,
    get_temp_dir,
    is_exec_error,
    is_linux,
    is_mac,
    is_windows,
    normalize_path,
)


# ═══════════════════════════════════════════════════════════════════════════════
# PLATFORM CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestPlatformConstants:
    """Tests for platform detection constants."""

    def test_exactly_one_platform_is_true(self):
        # At least one must be true (we're running on some OS)
        assert is_windows or is_mac or is_linux

    def test_is_windows_matches_sys_platform(self):
        assert is_windows == (sys.platform == "win32")

    def test_is_mac_matches_sys_platform(self):
        assert is_mac == (sys.platform == "darwin")

    def test_is_linux_matches_sys_platform(self):
        assert is_linux == sys.platform.startswith("linux")


# ═══════════════════════════════════════════════════════════════════════════════
# OS INFO
# ═══════════════════════════════════════════════════════════════════════════════


class TestOsInfo:
    """Tests for OsInfo and get_os_info()."""

    def test_os_info_model(self):
        info = OsInfo(
            name="Linux",
            version="5.15.0",
            arch="x86_64",
            is_windows=False,
            is_mac=False,
            is_linux=True,
            has_symlinks=True,
            path_separator="/",
        )
        assert info.name == "Linux"
        assert info.is_linux is True
        assert info.has_symlinks is True

    def test_get_os_info_returns_os_info(self):
        info = get_os_info()
        assert isinstance(info, OsInfo)
        assert info.name != ""
        assert info.arch != ""

    def test_get_os_info_platform_flags_consistent(self):
        info = get_os_info()
        assert info.is_windows == is_windows
        assert info.is_mac == is_mac
        assert info.is_linux == is_linux

    def test_get_os_info_path_separator(self):
        info = get_os_info()
        assert info.path_separator == os.sep


# ═══════════════════════════════════════════════════════════════════════════════
# EXEC ERROR CODE
# ═══════════════════════════════════════════════════════════════════════════════


class TestExecErrorCode:
    """Tests for ExecErrorCode enum."""

    def test_timeout_value(self):
        assert ExecErrorCode.TIMEOUT == "TIMEOUT"

    def test_signal_value(self):
        assert ExecErrorCode.SIGNAL == "SIGNAL"

    def test_exit_code_value(self):
        assert ExecErrorCode.EXIT_CODE == "EXIT_CODE"

    def test_spawn_failed_value(self):
        assert ExecErrorCode.SPAWN_FAILED == "SPAWN_FAILED"


# ═══════════════════════════════════════════════════════════════════════════════
# EXEC OPTIONS
# ═══════════════════════════════════════════════════════════════════════════════


class TestExecOptions:
    """Tests for ExecOptions model."""

    def test_default_options(self):
        opts = ExecOptions()
        assert opts.cwd is None
        assert opts.timeout is None
        assert opts.debug is False
        assert opts.env is None

    def test_custom_options(self):
        opts = ExecOptions(cwd="/tmp", timeout=5000, debug=True, env={"KEY": "val"})
        assert opts.cwd == "/tmp"
        assert opts.timeout == 5000
        assert opts.debug is True
        assert opts.env == {"KEY": "val"}

    def test_timeout_must_be_positive(self):
        with pytest.raises(Exception):
            ExecOptions(timeout=0)

        with pytest.raises(Exception):
            ExecOptions(timeout=-1)


# ═══════════════════════════════════════════════════════════════════════════════
# EXEC RESULT
# ═══════════════════════════════════════════════════════════════════════════════


class TestExecResult:
    """Tests for ExecResult and factory function."""

    def test_success_result(self):
        result = ExecResult(stdout="hello", stderr="", exit_code=0, duration_ms=42.0)
        assert result.stdout == "hello"
        assert result.exit_code == 0
        assert result.error_code is None

    def test_error_result(self):
        result = ExecResult(
            stdout="",
            stderr="not found",
            exit_code=1,
            error_code=ExecErrorCode.EXIT_CODE,
            duration_ms=10.0,
        )
        assert result.exit_code == 1
        assert result.error_code == ExecErrorCode.EXIT_CODE

    def test_create_exec_result_success(self):
        result = create_exec_result("ok", "", 0, 15.5)
        assert result.stdout == "ok"
        assert result.exit_code == 0
        assert result.error_code is None
        assert result.duration_ms == 15.5

    def test_create_exec_result_with_error(self):
        result = create_exec_result("", "fail", 1, 10.0, ExecErrorCode.EXIT_CODE)
        assert result.error_code == ExecErrorCode.EXIT_CODE

    def test_create_exec_result_timeout(self):
        result = create_exec_result("", "", 1, 5000.0, ExecErrorCode.TIMEOUT)
        assert result.error_code == ExecErrorCode.TIMEOUT


# ═══════════════════════════════════════════════════════════════════════════════
# IS EXEC ERROR
# ═══════════════════════════════════════════════════════════════════════════════


class TestIsExecError:
    """Tests for is_exec_error() type guard."""

    def test_returns_false_for_success(self):
        result = create_exec_result("ok", "", 0, 10.0)
        assert is_exec_error(result) is False

    def test_returns_true_for_exit_code_error(self):
        result = create_exec_result("", "fail", 1, 10.0, ExecErrorCode.EXIT_CODE)
        assert is_exec_error(result) is True

    def test_returns_true_for_timeout(self):
        result = create_exec_result("", "", 1, 5000.0, ExecErrorCode.TIMEOUT)
        assert is_exec_error(result) is True

    def test_returns_true_for_spawn_failed(self):
        result = create_exec_result("", "not found", 1, 0.0, ExecErrorCode.SPAWN_FAILED)
        assert is_exec_error(result) is True


# ═══════════════════════════════════════════════════════════════════════════════
# EXEC COMMAND
# ═══════════════════════════════════════════════════════════════════════════════


class TestExecCommand:
    """Tests for exec_command() async function."""

    async def test_empty_command_returns_spawn_failed(self):
        result = await exec_command([])
        assert is_exec_error(result)
        assert result.error_code == ExecErrorCode.SPAWN_FAILED
        assert "non-empty" in result.stderr.lower()

    async def test_echo_command(self):
        result = await exec_command(["echo", "hello world"])
        assert result.stdout == "hello world"
        assert result.exit_code == 0
        assert result.error_code is None
        assert result.duration_ms >= 0

    async def test_exit_code_nonzero(self):
        result = await exec_command(["false"])
        assert result.exit_code != 0
        assert result.error_code == ExecErrorCode.EXIT_CODE

    async def test_stderr_captured(self):
        result = await exec_command(["ls", "/nonexistent_path_abc123"])
        assert result.exit_code != 0
        assert result.stderr != ""

    async def test_missing_command_returns_spawn_failed(self):
        result = await exec_command(["nonexistent_command_xyz123"])
        assert is_exec_error(result)
        assert result.error_code == ExecErrorCode.SPAWN_FAILED

    async def test_timeout_kills_process(self):
        result = await exec_command(
            ["sleep", "10"],
            ExecOptions(timeout=100),
        )
        assert is_exec_error(result)
        assert result.error_code == ExecErrorCode.TIMEOUT

    async def test_cwd_option(self):
        result = await exec_command(["pwd"], ExecOptions(cwd="/tmp"))
        assert result.exit_code == 0
        # /tmp might resolve to /private/tmp on macOS
        assert "tmp" in result.stdout.lower()

    async def test_env_option(self):
        result = await exec_command(
            ["env"],
            ExecOptions(env={"AFD_TEST_VAR": "test_value_123"}),
        )
        assert result.exit_code == 0
        assert "AFD_TEST_VAR=test_value_123" in result.stdout

    async def test_debug_logging(self, capsys):
        await exec_command(["echo", "test"], ExecOptions(debug=True))
        captured = capsys.readouterr()
        assert "[exec] echo test" in captured.out

    async def test_duration_ms_measured(self):
        result = await exec_command(["sleep", "0.05"])
        assert result.duration_ms >= 40  # at least ~40ms for 50ms sleep


# ═══════════════════════════════════════════════════════════════════════════════
# FIND UP
# ═══════════════════════════════════════════════════════════════════════════════


class TestFindUp:
    """Tests for find_up() file discovery."""

    def test_finds_existing_file(self, tmp_path):
        # Create a file in the temp directory
        marker = tmp_path / "marker.txt"
        marker.write_text("found")

        result = find_up("marker.txt", cwd=str(tmp_path))
        assert result is not None
        assert result == str(marker)

    def test_finds_file_in_parent(self, tmp_path):
        # Create file in parent, search from child
        marker = tmp_path / "marker.txt"
        marker.write_text("found")
        child = tmp_path / "subdir"
        child.mkdir()

        result = find_up("marker.txt", cwd=str(child))
        assert result is not None
        assert result == str(marker)

    def test_finds_file_in_grandparent(self, tmp_path):
        marker = tmp_path / "marker.txt"
        marker.write_text("found")
        child = tmp_path / "a" / "b"
        child.mkdir(parents=True)

        result = find_up("marker.txt", cwd=str(child))
        assert result is not None
        assert result == str(marker)

    def test_returns_none_when_not_found(self, tmp_path):
        result = find_up("nonexistent_file_xyz.txt", cwd=str(tmp_path))
        assert result is None

    def test_uses_cwd_when_not_specified(self):
        # Should not raise - just returns path or None
        result = find_up("pyproject.toml")
        # We might or might not find it depending on cwd
        assert result is None or os.path.isfile(result)


# ═══════════════════════════════════════════════════════════════════════════════
# GET TEMP DIR
# ═══════════════════════════════════════════════════════════════════════════════


class TestGetTempDir:
    """Tests for get_temp_dir()."""

    def test_returns_string(self):
        result = get_temp_dir()
        assert isinstance(result, str)

    def test_returns_existing_directory(self):
        result = get_temp_dir()
        assert os.path.isdir(result)

    def test_matches_tempfile_gettempdir(self):
        assert get_temp_dir() == tempfile.gettempdir()


# ═══════════════════════════════════════════════════════════════════════════════
# NORMALIZE PATH
# ═══════════════════════════════════════════════════════════════════════════════


class TestNormalizePath:
    """Tests for normalize_path()."""

    def test_forward_slashes_on_posix(self):
        if os.sep == "/":
            assert normalize_path("foo/bar/baz") == "foo/bar/baz"

    def test_backslashes_converted_on_posix(self):
        if os.sep == "/":
            assert normalize_path("foo\\bar\\baz") == "foo/bar/baz"

    def test_mixed_separators_normalized(self):
        if os.sep == "/":
            assert normalize_path("foo/bar\\baz") == "foo/bar/baz"

    def test_empty_string(self):
        assert normalize_path("") == ""

    def test_single_component(self):
        assert normalize_path("foo") == "foo"


# ═══════════════════════════════════════════════════════════════════════════════
# ROOT IMPORTS
# ═══════════════════════════════════════════════════════════════════════════════


class TestRootImports:
    """Tests that platform utilities are importable from package root."""

    def test_exec_types_importable(self):
        from afd import ExecErrorCode, ExecOptions, ExecResult
        assert ExecErrorCode.TIMEOUT == "TIMEOUT"

    def test_exec_functions_importable(self):
        from afd import create_exec_result, exec_command, is_exec_error
        assert callable(exec_command)
        assert callable(create_exec_result)
        assert callable(is_exec_error)

    def test_platform_constants_importable(self):
        from afd import is_linux, is_mac, is_windows
        assert isinstance(is_linux, bool)
        assert isinstance(is_mac, bool)
        assert isinstance(is_windows, bool)

    def test_os_info_importable(self):
        from afd import OsInfo, get_os_info
        info = get_os_info()
        assert isinstance(info, OsInfo)

    def test_path_utilities_importable(self):
        from afd import find_up, get_temp_dir, normalize_path
        assert callable(find_up)
        assert callable(get_temp_dir)
        assert callable(normalize_path)
