"""Command runner utilities for botcore."""

from __future__ import annotations

import asyncio
import contextlib
import ctypes
import importlib.util
import os
import shutil
import signal
import subprocess
import sys
import warnings
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, TypeVar

_T = TypeVar("_T")

# Output budget for a single stream, in characters. This is a context-economy guard for
# LLM-facing callers, not a memory guard -- the whole stream is read into memory either way.
# It was 8000 (~2000 tokens), sized for models whose entire context was a few thousand tokens.
# That budget silently corrupts structured output: truncating JSON yields a decode error rather
# than a smaller object. Pass ``max_output=None`` for machine-readable payloads.
MAX_OUTPUT_LENGTH = 100_000

# Share of the budget kept from the start of the stream; the rest is kept from the end. Tools
# print their summary first and their verdict or final error last, so both parts scale with
# the budget rather than staying pinned at the 3000/4000 split sized for the old 8000 budget.
_HEAD_SHARE = 0.4


def smart_truncate(output: str, max_len: int = MAX_OUTPUT_LENGTH) -> str:
    """Truncate output to ``max_len`` characters, keeping its head and tail.

    The kept text is split 40% head and 60% tail at every budget size, with a marker
    between them stating how many characters were cut. Output within the budget is
    returned whole.
    """
    if len(output) <= max_len:
        return output

    head_len = int(max_len * _HEAD_SHARE)
    tail_len = max_len - head_len
    head = output[:head_len]
    tail = output[len(output) - tail_len :]
    omitted = len(output) - head_len - tail_len

    return f"{head}\n\n... [{omitted:,} chars truncated] ...\n\n{tail}"


def _subprocess_group_kwargs() -> dict[str, Any]:
    """Start subprocesses in their own process group so timeouts/cancellations kill descendants."""
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _attach_win32_job(pid: int) -> int | None:
    """Assign *pid* to a fresh Win32 Job Object so descendants can be terminated even after
    *pid* exits. Returns the job handle, or ``None`` if unavailable."""
    if sys.platform != "win32":
        return None
    kernel32 = ctypes.windll.kernel32
    kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
    kernel32.CreateJobObjectW.restype = ctypes.c_void_p
    kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.AssignProcessToJobObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    kernel32.AssignProcessToJobObject.restype = ctypes.c_int
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.restype = ctypes.c_int

    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        return None
    # PROCESS_SET_QUOTA (0x0100) | PROCESS_TERMINATE (0x0001)
    proc_handle = kernel32.OpenProcess(0x0101, False, pid)
    if not proc_handle:
        kernel32.CloseHandle(job)
        return None
    try:
        if not kernel32.AssignProcessToJobObject(job, proc_handle):
            kernel32.CloseHandle(job)
            return None
        return int(job)
    finally:
        kernel32.CloseHandle(proc_handle)


def _terminate_win32_job(job: int | None) -> bool:
    """Terminate all processes in a Win32 Job Object. Returns True when terminated."""
    if sys.platform != "win32" or not job:
        return False
    kernel32 = ctypes.windll.kernel32
    kernel32.TerminateJobObject.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    kernel32.TerminateJobObject.restype = ctypes.c_int
    return bool(kernel32.TerminateJobObject(ctypes.c_void_p(job), 1))


def _close_win32_job(job: int | None) -> None:
    if sys.platform != "win32" or not job:
        return
    kernel32 = ctypes.windll.kernel32
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.restype = ctypes.c_int
    kernel32.CloseHandle(ctypes.c_void_p(job))


async def _kill_process_group(
    process: asyncio.subprocess.Process, job: int | None = None
) -> None:
    """Terminate *process* and any descendants it spawned (even if *process* already exited),
    then reap it."""
    pid = process.pid
    if sys.platform == "win32":
        terminated = _terminate_win32_job(job)
        if not terminated and pid is not None:
            taskkill = shutil.which("taskkill") or "taskkill"
            try:
                killer = await asyncio.create_subprocess_exec(
                    taskkill,
                    "/F",
                    "/T",
                    "/PID",
                    str(pid),
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                try:
                    await asyncio.wait_for(killer.wait(), timeout=15)
                except TimeoutError:
                    with contextlib.suppress(ProcessLookupError, OSError):
                        killer.kill()
                    with contextlib.suppress(Exception):
                        await killer.wait()
            except OSError:
                pass
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError, OSError):
                process.kill()
    else:
        killed_group = False
        if pid is not None:
            with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
                os.killpg(pid, signal.SIGKILL)
                killed_group = True
        if not killed_group and process.returncode is None:
            with contextlib.suppress(ProcessLookupError, OSError):
                process.kill()
    try:
        await asyncio.wait_for(process.communicate(), timeout=5)
    except TimeoutError:
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError, OSError):
                process.kill()
        with contextlib.suppress(Exception):
            await asyncio.wait_for(process.wait(), timeout=5)


async def run_command(
    command: list[str],
    cwd: Path | None = None,
    timeout: float = 300,
    max_output: int | None = MAX_OUTPUT_LENGTH,
) -> dict[str, Any]:
    """Run a command asynchronously and return result.

    Args:
        command: Command and arguments as list.
        cwd: Working directory (optional).
        timeout: Timeout in seconds (default 300).
        max_output: Per-stream character budget, or ``None`` to return output whole.
            Use ``None`` when parsing structured output -- truncation corrupts it.

    Returns:
        Dict with success, output, error, and truncated keys.
    """
    job: int | None = None
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            **_subprocess_group_kwargs(),
        )
        if process.pid is not None:
            job = _attach_win32_job(process.pid)

        try:
            stdout_data, stderr_data = await asyncio.wait_for(
                process.communicate(), timeout=timeout
            )
        except TimeoutError:
            await _kill_process_group(process, job)
            return {
                "success": False,
                "error": f"Command timed out after {timeout}s",
                "failure_kind": "error",
                "truncated": False,
            }
        except asyncio.CancelledError:
            try:
                await _kill_process_group(process, job)
            finally:
                if sys.platform == "win32":
                    _terminate_win32_job(job)
                elif process.pid is not None:
                    with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
                        os.killpg(process.pid, signal.SIGKILL)
                if process.returncode is None:
                    with contextlib.suppress(ProcessLookupError, OSError):
                        process.kill()
            raise

        output = stdout_data.decode("utf-8", errors="replace")
        error_output = stderr_data.decode("utf-8", errors="replace")

        truncated = max_output is not None and (
            len(output) > max_output or len(error_output) > max_output
        )
        if max_output is not None:
            if len(output) > max_output:
                output = smart_truncate(output, max_output)
            if len(error_output) > max_output:
                error_output = smart_truncate(error_output, max_output)

        return {
            "success": process.returncode == 0,
            "output": output,
            "error": error_output if process.returncode != 0 else None,
            "truncated": truncated,
            **({"failure_kind": "failed"} if process.returncode != 0 else {}),
        }
    except FileNotFoundError as exc:
        return {
            "success": False,
            "error": str(exc),
            "truncated": False,
            "failure_kind": "unavailable",
        }
    except Exception as exc:
        return {"success": False, "error": str(exc), "truncated": False, "failure_kind": "error"}
    finally:
        _close_win32_job(job)


async def run_external_tool(
    tool: str,
    args: list[str],
    install_hint: str,
    cwd: Path | None = None,
) -> dict[str, Any] | None:
    """Run an external tool, returning None with a warning if not installed.

    Args:
        tool: Executable name (e.g., "npx", "cargo").
        args: Arguments to pass after the tool name.
        install_hint: Installation command shown in the warning.
        cwd: Working directory.

    Returns:
        Result dict from run_command, or None if tool not found.
    """
    resolved = shutil.which(tool)
    if not resolved:
        warnings.warn(
            f"{tool} not found. Install with: {install_hint}",
            UserWarning,
            stacklevel=2,
        )
        return None
    return await run_command([resolved, *args], cwd=cwd)


async def run_python_module(
    module: str,
    args: list[str] | None = None,
    cwd: Path | None = None,
) -> dict[str, Any]:
    """Run a Python module (python -m module args).

    Args:
        module: Module name (e.g., "ruff", "pytest").
        args: Additional arguments.
        cwd: Working directory.

    Returns:
        Dict with success, output, and error keys.
    """
    try:
        available = importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        available = False
    if not available:
        return {
            "success": False,
            "error": f"Python module unavailable: {module}",
            "truncated": False,
            "failure_kind": "unavailable",
        }
    command = [sys.executable, "-m", module]
    if args:
        command.extend(args)
    return await run_command(command, cwd=cwd)


async def retry_async(
    fn: Callable[[], Awaitable[_T]],
    attempts: int = 10,
    delay_s: float = 0.3,
) -> _T:
    """Retry an async callable until it succeeds or attempts are exhausted.

    Args:
        fn: Zero-argument async callable to retry.
        attempts: Maximum number of attempts.
        delay_s: Delay between attempts in seconds.

    Returns:
        The return value of *fn* on success.

    Raises:
        The last exception raised by *fn* if all attempts fail.
    """
    if attempts < 1:
        raise ValueError(f"attempts must be >= 1, got {attempts}")
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            return await fn()
        except Exception as exc:
            last_exc = exc
            if attempt < attempts - 1:
                await asyncio.sleep(delay_s)
    raise last_exc  # type: ignore[misc]
