"""Cross-platform utilities for subprocess execution and path operations.

Abstracts OS differences and provides typed return models for command execution,
file discovery, OS detection, path normalization, and temporary directories.

Example:
    >>> from afd.platform import exec_command, is_exec_error
    >>> result = await exec_command(["git", "status"])
    >>> if not is_exec_error(result):
    ...     print(result.stdout)

    >>> from afd.platform import find_up
    >>> path = find_up("pyproject.toml")
    >>> if path:
    ...     print("Found at:", path)
"""

import asyncio
import os
import platform
import sys
import tempfile
from enum import Enum
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field


# ═══════════════════════════════════════════════════════════════════════════════
# PLATFORM CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

is_windows: bool = sys.platform == "win32"
"""Whether the current platform is Windows."""

is_mac: bool = sys.platform == "darwin"
"""Whether the current platform is macOS."""

is_linux: bool = sys.platform.startswith("linux")
"""Whether the current platform is Linux."""


# ═══════════════════════════════════════════════════════════════════════════════
# OS INFO
# ═══════════════════════════════════════════════════════════════════════════════


class OsInfo(BaseModel):
    """Operating system capability detection flags.

    Attributes:
        name: OS name (e.g., "Linux", "Darwin", "Windows").
        version: OS version string.
        arch: CPU architecture (e.g., "x86_64", "arm64").
        is_windows: Whether the current platform is Windows.
        is_mac: Whether the current platform is macOS.
        is_linux: Whether the current platform is Linux.
        has_symlinks: Whether the OS supports symbolic links.
        path_separator: The OS path separator character.

    Example:
        >>> info = get_os_info()
        >>> info.is_linux
        True
    """

    name: str
    version: str
    arch: str
    is_windows: bool
    is_mac: bool
    is_linux: bool
    has_symlinks: bool
    path_separator: str


def get_os_info() -> OsInfo:
    """Detect OS capabilities and return structured info.

    Returns:
        An OsInfo instance with platform details.

    Example:
        >>> info = get_os_info()
        >>> info.name in ("Linux", "Darwin", "Windows")
        True
    """
    return OsInfo(
        name=platform.system(),
        version=platform.version(),
        arch=platform.machine(),
        is_windows=is_windows,
        is_mac=is_mac,
        is_linux=is_linux,
        has_symlinks=os.name != "nt" or _check_windows_symlink_support(),
        path_separator=os.sep,
    )


def _check_windows_symlink_support() -> bool:
    """Check if Windows supports symlinks (requires elevated privileges)."""
    try:
        tmp = Path(tempfile.mkdtemp())
        target = tmp / "target"
        target.mkdir()
        link = tmp / "link"
        link.symlink_to(target)
        link.unlink()
        target.rmdir()
        tmp.rmdir()
        return True
    except OSError:
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# EXEC TYPES AND ERROR CODES
# ═══════════════════════════════════════════════════════════════════════════════


class ExecErrorCode(str, Enum):
    """Error codes for exec_command() failures.

    Attributes:
        TIMEOUT: Process exceeded timeout.
        SIGNAL: Process was killed by a signal.
        EXIT_CODE: Process exited with non-zero exit code.
        SPAWN_FAILED: Failed to spawn the process.
    """

    TIMEOUT = "TIMEOUT"
    SIGNAL = "SIGNAL"
    EXIT_CODE = "EXIT_CODE"
    SPAWN_FAILED = "SPAWN_FAILED"


class ExecOptions(BaseModel):
    """Options for cross-platform command execution.

    Attributes:
        cwd: Working directory for the command.
        timeout: Timeout in milliseconds.
        debug: Enable debug logging of commands (default: False).
        env: Environment variables to merge with os.environ.

    Example:
        >>> opts = ExecOptions(cwd="/tmp", timeout=5000, debug=True)
    """

    cwd: Optional[str] = None
    timeout: Optional[int] = Field(default=None, gt=0)
    debug: bool = False
    env: Optional[dict[str, str]] = None


class ExecResult(BaseModel):
    """Result from exec_command() with error codes for observability.

    Attributes:
        stdout: Standard output (trimmed).
        stderr: Standard error (trimmed).
        exit_code: Process exit code.
        error_code: Error code if failed, None if success.
        duration_ms: Duration in milliseconds.

    Example:
        >>> result = ExecResult(stdout="hello", stderr="", exit_code=0, duration_ms=42)
        >>> is_exec_error(result)
        False
    """

    stdout: str
    stderr: str
    exit_code: int
    error_code: Optional[ExecErrorCode] = None
    duration_ms: float


def create_exec_result(
    stdout: str,
    stderr: str,
    exit_code: int,
    duration_ms: float,
    error_code: Optional[ExecErrorCode] = None,
) -> ExecResult:
    """Factory function for ExecResult.

    Args:
        stdout: Standard output (trimmed).
        stderr: Standard error (trimmed).
        exit_code: Process exit code.
        duration_ms: Duration in milliseconds.
        error_code: Error code if failed.

    Returns:
        An ExecResult instance.

    Example:
        >>> result = create_exec_result("ok", "", 0, 15.5)
        >>> result.exit_code
        0
    """
    return ExecResult(
        stdout=stdout,
        stderr=stderr,
        exit_code=exit_code,
        duration_ms=duration_ms,
        error_code=error_code,
    )


def is_exec_error(result: ExecResult) -> bool:
    """Type guard: check if ExecResult indicates an error.

    Args:
        result: An ExecResult to check.

    Returns:
        True if the result has an error code.

    Example:
        >>> result = create_exec_result("", "fail", 1, 10, ExecErrorCode.EXIT_CODE)
        >>> is_exec_error(result)
        True
    """
    return result.error_code is not None


# ═══════════════════════════════════════════════════════════════════════════════
# EXEC FUNCTION
# ═══════════════════════════════════════════════════════════════════════════════


async def exec_command(
    cmd: list[str],
    options: Optional[ExecOptions] = None,
) -> ExecResult:
    """Execute a command asynchronously with cross-platform support.

    Args:
        cmd: Command as list of strings [command, ...args].
        options: Execution options (cwd, timeout, env, debug).

    Returns:
        An ExecResult with stdout, stderr, exit_code, duration_ms, and error_code.

    Example:
        >>> result = await exec_command(["echo", "hello"])
        >>> result.stdout
        'hello'
        >>> result.exit_code
        0
    """
    opts = options or ExecOptions()

    if not cmd:
        return create_exec_result(
            "", "Command must be a non-empty list", 1, 0.0, ExecErrorCode.SPAWN_FAILED
        )

    if opts.debug:
        print(f"[exec] {' '.join(cmd)}")

    env = None
    if opts.env:
        env = {**os.environ, **opts.env}

    start_time = asyncio.get_event_loop().time()

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=opts.cwd,
            env=env,
        )

        timeout_seconds = opts.timeout / 1000.0 if opts.timeout else None

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            duration_ms = (asyncio.get_event_loop().time() - start_time) * 1000
            return create_exec_result(
                "", "", 1, duration_ms, ExecErrorCode.TIMEOUT
            )

        duration_ms = (asyncio.get_event_loop().time() - start_time) * 1000
        stdout = stdout_bytes.decode("utf-8", errors="replace").strip()
        stderr = stderr_bytes.decode("utf-8", errors="replace").strip()
        exit_code = process.returncode or 0

        if exit_code != 0:
            return create_exec_result(
                stdout, stderr, exit_code, duration_ms, ExecErrorCode.EXIT_CODE
            )

        return create_exec_result(stdout, stderr, exit_code, duration_ms)

    except FileNotFoundError as e:
        duration_ms = (asyncio.get_event_loop().time() - start_time) * 1000
        return create_exec_result("", str(e), 1, duration_ms, ExecErrorCode.SPAWN_FAILED)
    except PermissionError as e:
        duration_ms = (asyncio.get_event_loop().time() - start_time) * 1000
        return create_exec_result("", str(e), 1, duration_ms, ExecErrorCode.SPAWN_FAILED)
    except OSError as e:
        duration_ms = (asyncio.get_event_loop().time() - start_time) * 1000
        return create_exec_result("", str(e), 1, duration_ms, ExecErrorCode.SPAWN_FAILED)


# ═══════════════════════════════════════════════════════════════════════════════
# PATH UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════


def find_up(filename: str, cwd: Optional[str] = None) -> Optional[str]:
    """Find a file by walking up parent directories.

    Args:
        filename: Name of file to find.
        cwd: Starting directory (defaults to os.getcwd()).

    Returns:
        Absolute path to the found file, or None if not found.

    Example:
        >>> path = find_up("pyproject.toml")
        >>> path is not None or path is None  # depends on cwd
        True
    """
    current = Path(cwd) if cwd else Path.cwd()
    current = current.resolve()

    while True:
        candidate = current / filename
        if candidate.is_file():
            return str(candidate)

        parent = current.parent
        if parent == current:
            return None
        current = parent


def get_temp_dir() -> str:
    """Get the system temporary directory.

    Returns:
        Path to the system temp directory.

    Example:
        >>> import os
        >>> temp = get_temp_dir()
        >>> os.path.isdir(temp)
        True
    """
    return tempfile.gettempdir()


def normalize_path(path: str) -> str:
    """Normalize a path to use the platform's path separator.

    Args:
        path: Path with potentially mixed separators.

    Returns:
        Path with consistent separators for the current OS.

    Example:
        >>> # On Linux/macOS:
        >>> normalize_path("foo/bar\\\\baz")
        'foo/bar/baz'
    """
    return path.replace("\\", os.sep).replace("/", os.sep)
