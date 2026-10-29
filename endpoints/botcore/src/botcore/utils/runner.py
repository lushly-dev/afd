"""Command runner utilities for botcore."""

from __future__ import annotations

import asyncio
import importlib.util
import shutil
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


def smart_truncate(output: str, max_len: int = MAX_OUTPUT_LENGTH) -> str:
    """Truncate output while preserving head and tail."""
    if len(output) <= max_len:
        return output

    head_len = min(3000, max_len // 2)
    tail_len = min(4000, max_len - head_len)
    head = output[:head_len]
    tail = output[-tail_len:]
    omitted = len(output) - head_len - tail_len

    return f"{head}\n\n... [{omitted:,} chars truncated] ...\n\n{tail}"


async def run_command(
    command: list[str],
    cwd: Path | None = None,
    timeout: int = 300,
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
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )

        try:
            stdout_data, stderr_data = await asyncio.wait_for(
                process.communicate(), timeout=timeout
            )
        except TimeoutError:
            process.kill()
            await process.communicate()
            return {
                "success": False,
                "error": f"Command timed out after {timeout}s",
                "failure_kind": "error",
                "truncated": False,
            }

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
    if not shutil.which(tool):
        warnings.warn(
            f"{tool} not found. Install with: {install_hint}",
            UserWarning,
            stacklevel=2,
        )
        return None
    return await run_command([tool, *args], cwd=cwd)


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
