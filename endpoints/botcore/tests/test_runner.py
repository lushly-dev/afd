"""Tests for botcore.utils.runner."""

from __future__ import annotations

import json
import sys

import pytest

from botcore.utils.runner import (
    MAX_OUTPUT_LENGTH,
    retry_async,
    run_command,
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
