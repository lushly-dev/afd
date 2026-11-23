"""Tests for botcore.utils.runner."""

from __future__ import annotations

import asyncio
import ctypes
import json
import os
import shutil
import sys
import time
from pathlib import Path

import pytest

from botcore.utils.runner import (
    MAX_OUTPUT_LENGTH,
    retry_async,
    run_command,
    run_external_tool,
    run_python_module,
    smart_truncate,
)


def test_smart_truncate_short() -> None:
    """Short output returned unchanged."""
    assert smart_truncate("hello") == "hello"


def test_smart_truncate_long() -> None:
    """Long output preserves head and tail with truncation marker."""
    text = "x" * 20_000
    result = smart_truncate(text, 8000)
    assert len(result) < len(text)
    assert "chars truncated" in result
    assert result.startswith("x" * 3000)
    assert result.endswith("x" * 4000)


def test_smart_truncate_respects_budgets_smaller_than_the_head_and_tail() -> None:
    """A budget under head+tail still shrinks the output rather than growing it."""
    result = smart_truncate("x" * 20_000, 100)
    assert len(result) < 20_000
    assert "chars truncated" in result


@pytest.mark.parametrize("max_len", [100, 8000, MAX_OUTPUT_LENGTH])
def test_smart_truncate_keeps_the_whole_budget(max_len: int) -> None:
    """The kept text fills the budget, split 40% head and 60% tail, at every budget size.

    The head and tail used to be pinned at 3,000 and 4,000 characters, the split that fitted
    the old 8,000 budget, so after MAX_OUTPUT_LENGTH rose to 100,000 a stream just over the
    cap still shrank to about 7,000 characters.
    """
    text = "h" * (max_len * 2) + "t" * (max_len * 2)
    result = smart_truncate(text, max_len)

    head_len = int(max_len * 0.4)
    tail_len = max_len - head_len
    assert result.startswith("h" * head_len + "\n")
    assert result.endswith("\n" + "t" * tail_len)
    marker = f"... [{len(text) - max_len:,} chars truncated] ..."
    assert marker in result
    assert len(result) == max_len + len(f"\n\n{marker}\n\n")


def test_smart_truncate_just_over_the_default_budget_cuts_only_the_excess() -> None:
    """Output one character over the default budget loses one character, not 93,000."""
    result = smart_truncate("x" * (MAX_OUTPUT_LENGTH + 1))
    assert "[1 chars truncated]" in result
    assert result.count("x") == MAX_OUTPUT_LENGTH


async def test_run_command_success() -> None:
    """Successful command returns success=True with output."""
    result = await run_command([sys.executable, "-c", "print('hello')"])
    assert result["success"] is True
    assert "hello" in result["output"]
    assert result["error"] is None


async def test_run_command_failure() -> None:
    """Failed command returns success=False with error output."""
    result = await run_command([sys.executable, "-c", "import sys; sys.exit(1)"])
    assert result["success"] is False


async def test_run_command_bad_executable() -> None:
    """Non-existent command returns success=False with error string."""
    result = await run_command(["__nonexistent_command_xyz__"])
    assert result["success"] is False
    assert result["error"] is not None


async def test_run_command_large_output() -> None:
    """Output exceeding MAX_OUTPUT_LENGTH is truncated."""
    code = f"print('x' * {MAX_OUTPUT_LENGTH + 5000})"
    result = await run_command([sys.executable, "-c", code])
    assert result["success"] is True
    assert "chars truncated" in result["output"]
    assert result["truncated"] is True


async def test_run_command_reports_untruncated_output() -> None:
    """Output within the budget is reported as untruncated."""
    result = await run_command([sys.executable, "-c", "print('hello')"])
    assert result["truncated"] is False


async def test_run_command_max_output_none_disables_truncation() -> None:
    """max_output=None returns the payload whole.

    Truncating a structured payload does not shorten it, it corrupts it: the caller gets a
    decode error instead of a smaller object. Machine-readable callers opt out entirely.
    """
    size = MAX_OUTPUT_LENGTH + 5000
    code = f"print('x' * {size})"
    result = await run_command([sys.executable, "-c", code], max_output=None)
    assert result["success"] is True
    assert result["truncated"] is False
    assert len(result["output"].strip()) == size


async def test_run_command_max_output_accepts_a_smaller_budget() -> None:
    """A caller can tighten the budget below the default."""
    code = "print('x' * 20000)"
    result = await run_command([sys.executable, "-c", code], max_output=9000)
    assert result["truncated"] is True
    assert len(result["output"]) < 20_000


async def test_run_command_json_payload_survives_default_budget() -> None:
    """A realistic structured payload round-trips without opting out.

    The 8000-character legacy budget silently corrupted JSON this size, which is the
    regression this default guards against.
    """
    code = (
        "import json; print(json.dumps([{'number': n, 'title': 'issue ' + str(n)} "
        "for n in range(1200)]))"
    )
    result = await run_command([sys.executable, "-c", code])
    assert result["truncated"] is False
    assert len(json.loads(result["output"])) == 1200


async def test_run_python_module() -> None:
    """run_python_module delegates to run_command correctly."""
    result = await run_python_module("platform")
    assert result["success"] is True
    assert result["output"]  # platform module prints platform info


# --- retry_async tests ---


async def test_retry_async_success_first_attempt() -> None:
    """Succeeds immediately when fn does not raise."""
    result = await retry_async(make_flaky(0, "ok"), attempts=3, delay_s=0)
    assert result == "ok"


async def test_retry_async_success_after_retries() -> None:
    """Succeeds after transient failures."""
    result = await retry_async(make_flaky(2, "ok"), attempts=3, delay_s=0)
    assert result == "ok"


async def test_retry_async_all_attempts_exhausted() -> None:
    """Raises last exception when all attempts fail."""
    with pytest.raises(RuntimeError, match="boom"):
        await retry_async(make_flaky(5, "ok"), attempts=3, delay_s=0)


async def test_retry_async_invalid_attempts() -> None:
    """Rejects attempts < 1."""
    with pytest.raises(ValueError, match="attempts must be >= 1"):
        await retry_async(make_flaky(0, "ok"), attempts=0, delay_s=0)


def make_flaky(fail_count: int, value: object) -> object:
    """Return an async callable that fails *fail_count* times then returns *value*."""
    calls = {"n": 0}

    async def _fn() -> object:
        calls["n"] += 1
        if calls["n"] <= fail_count:
            raise RuntimeError("boom")
        return value

    return _fn


async def test_runner_distinguishes_unavailable_error_and_check_failure():
    missing = await run_command(["botcore-unavailable-fixture-executable"])
    assert missing["failure_kind"] == "unavailable"
    missing_module = await run_python_module("botcore_unavailable_fixture_module")
    assert missing_module["failure_kind"] == "unavailable"
    timed_out = await run_command(
        [sys.executable, "-c", "import time; time.sleep(2)"], timeout=0.01
    )
    assert timed_out["failure_kind"] == "error"
    failed = await run_command([sys.executable, "-c", "raise SystemExit(2)"])
    assert failed["failure_kind"] == "failed"


def _pid_alive(pid: int) -> bool:
    if sys.platform == "win32":
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _wait_pid_dead(pid: int, timeout_s: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not _pid_alive(pid):
            return True
        time.sleep(0.05)
    return not _pid_alive(pid)


_SPAWN_GRANDCHILD = (
    "import os, pathlib, subprocess, sys, time; "
    "gc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
    "tmp = pathlib.Path(sys.argv[1] + '.tmp'); "
    "tmp.write_text(str(gc.pid), encoding='utf-8'); "
    "os.replace(tmp, sys.argv[1]); "
    "time.sleep(60)"
)

_SPAWN_GRANDCHILD_AND_EXIT = (
    "import os, pathlib, subprocess, sys; "
    "gc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
    "tmp = pathlib.Path(sys.argv[1] + '.tmp'); "
    "tmp.write_text(str(gc.pid), encoding='utf-8'); "
    "os.replace(tmp, sys.argv[1])"
)


async def test_run_command_kills_process_group_on_timeout(tmp_path: Path) -> None:
    """lushly-dev/afd#1794: timeout terminates both the child and its spawned grandchild."""
    pid_file = tmp_path / "grandchild.pid"
    result = await run_command(
        [sys.executable, "-c", _SPAWN_GRANDCHILD, str(pid_file)],
        timeout=2.5,
    )
    assert result["success"] is False
    assert result["failure_kind"] == "error"
    assert "timed out" in result["error"]
    assert pid_file.exists(), "Child did not spawn grandchild before timeout"
    grandchild_pid = int(pid_file.read_text(encoding="utf-8").strip())
    assert _wait_pid_dead(grandchild_pid), f"Grandchild {grandchild_pid} survived timeout"


async def test_run_command_kills_grandchild_even_when_parent_exits_early(tmp_path: Path) -> None:
    """lushly-dev/afd#1794: timeout and cancellation kill grandchildren inheriting pipes even
    after the direct child process has already exited."""
    pid_file_timeout = tmp_path / "grandchild-timeout.pid"
    result = await run_command(
        [sys.executable, "-c", _SPAWN_GRANDCHILD_AND_EXIT, str(pid_file_timeout)],
        timeout=2.5,
    )
    assert result["success"] is False
    assert result["failure_kind"] == "error"
    assert pid_file_timeout.exists()
    gc_timeout_pid = int(pid_file_timeout.read_text(encoding="utf-8").strip())
    assert _wait_pid_dead(gc_timeout_pid), f"Grandchild {gc_timeout_pid} survived timeout"

    pid_file_cancel = tmp_path / "grandchild-cancel.pid"
    task = asyncio.create_task(
        run_command(
            [sys.executable, "-c", _SPAWN_GRANDCHILD_AND_EXIT, str(pid_file_cancel)],
            timeout=60,
        )
    )
    deadline = time.monotonic() + 5.0
    while not pid_file_cancel.exists() and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    assert pid_file_cancel.exists()
    gc_cancel_pid = int(pid_file_cancel.read_text(encoding="utf-8").strip())
    await asyncio.sleep(0.2)  # let parent exit while grandchild keeps stdout pipe open

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert _wait_pid_dead(gc_cancel_pid), f"Grandchild {gc_cancel_pid} survived cancellation"


async def test_run_command_kills_process_group_on_cancellation(tmp_path: Path) -> None:
    """lushly-dev/afd#1794: cancelling run_command kills the process group and re-raises."""
    pid_file = tmp_path / "grandchild.pid"
    task = asyncio.create_task(
        run_command([sys.executable, "-c", _SPAWN_GRANDCHILD, str(pid_file)], timeout=60)
    )
    deadline = time.monotonic() + 5.0
    while not pid_file.exists() and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    assert pid_file.exists(), "Child did not spawn grandchild before cancel"
    grandchild_pid = int(pid_file.read_text(encoding="utf-8").strip())

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert _wait_pid_dead(grandchild_pid), f"Grandchild {grandchild_pid} survived cancellation"


async def test_run_external_tool_executes_resolved_which_path(monkeypatch) -> None:
    """lushly-dev/afd#1794: run_external_tool executes the resolved shutil.which path."""
    resolved = r"C:\tools\demo.cmd" if sys.platform == "win32" else "/usr/local/bin/demo"
    captured: dict[str, object] = {}

    async def _fake_run(command: list[str], cwd=None):
        captured["command"] = command
        captured["cwd"] = cwd
        return {"success": True, "output": "ok", "error": None, "truncated": False}

    monkeypatch.setattr(shutil, "which", lambda tool: resolved if tool == "demo" else None)
    monkeypatch.setattr("botcore.utils.runner.run_command", _fake_run)

    result = await run_external_tool("demo", ["--check"], "install demo")
    assert result is not None and result["success"] is True
    assert captured["command"] == [resolved, "--check"]
