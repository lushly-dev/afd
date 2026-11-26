"""Specification-authored execution-controls vectors (spec/vectors/execution-controls.json).

Runs every case in the vector file and asserts that ``gaps.python`` is absent (#2129).
"""

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from afd import ExposeOptions, error, success
from afd.core.commands import CommandContext
from afd.server import (
    DEFAULT_COMMAND_TIMEOUT_MS,
    DEFAULT_MAX_BATCH_PARALLELISM,
    DEFAULT_MAX_BATCH_SIZE,
    DEFAULT_MAX_VALIDATION_ISSUES,
    create_retry_middleware,
    create_server,
)
from afd.server.batch_execution import execute_batch

VECTORS = json.loads(
    (
        Path(__file__).resolve().parents[2] / "spec" / "vectors" / "execution-controls.json"
    ).read_text(encoding="utf-8")
)

EXECUTED_CONTROLS = {
    "deadline",
    "defaultDeadline",
    "singleCancellation",
    "batchCancellation",
    "batchLimits",
    "validationIssueCap",
    "retryMutation",
}
BATCH_LIMIT_CASES = [c for c in VECTORS["cases"] if c["control"] == "batchLimits"]
VALIDATION_CAP_CASES = [c for c in VECTORS["cases"] if c["control"] == "validationIssueCap"]
RETRY_MUTATION_CASES = [c for c in VECTORS["cases"] if c["control"] == "retryMutation"]


def _case(case_id: str) -> dict[str, Any]:
    return next(c for c in VECTORS["cases"] if c["id"] == case_id)


def test_defaults_and_no_remaining_python_gaps():
    defaults = VECTORS["defaults"]
    assert DEFAULT_COMMAND_TIMEOUT_MS == defaults["defaultTimeoutMs"] == 30000
    assert DEFAULT_MAX_BATCH_SIZE == defaults["maxBatchSize"] == 500
    assert DEFAULT_MAX_BATCH_PARALLELISM == defaults["maxBatchParallelism"] == 16
    assert DEFAULT_MAX_VALIDATION_ISSUES == defaults["maxValidationIssues"] == 100
    assert "python" not in VECTORS["gaps"]
    for case in VECTORS["cases"]:
        assert case["control"] in EXECUTED_CONTROLS


async def test_per_call_deadline_timeout():
    case = _case("per-call-deadline-timeout")
    call = case["call"]
    expected = case["expect"]

    server = create_server("execution-controls-deadline")
    observed_signal: asyncio.Event | None = None

    @server.command(
        name=call["command"], description="Slow command", expose=ExposeOptions(mcp=True)
    )
    async def work_slow(input: Any, context: CommandContext):
        nonlocal observed_signal
        observed_signal = context.signal
        await asyncio.sleep(call["handler"]["delayMs"] / 1000.0)
        return success({"done": True})

    result = await server.execute(call["command"], {}, CommandContext(timeout=call["timeoutMs"]))
    assert result.success is expected["success"]
    assert result.error is not None
    assert result.error.code == expected["code"]
    assert result.error.retryable is expected["retryable"]
    assert result.error.details == {
        "command": call["command"],
        "timeoutMs": call["timeoutMs"],
    }
    assert observed_signal is not None
    assert observed_signal.is_set() is expected["signalAborted"]


async def test_server_default_deadline():
    case = _case("server-default-deadline")
    server_cfg = case["server"]
    call = case["call"]
    expected = case["expect"]

    server = create_server(
        "execution-controls-default-deadline",
        default_timeout_ms=server_cfg["defaultTimeoutMs"],
    )
    observed_signal: asyncio.Event | None = None

    @server.command(
        name=call["command"], description="Slow command", expose=ExposeOptions(mcp=True)
    )
    async def work_slow(input: Any, context: CommandContext):
        nonlocal observed_signal
        observed_signal = context.signal
        await asyncio.sleep(call["handler"]["delayMs"] / 1000.0)
        return success({"done": True})

    result = await server.execute(call["command"], {})
    assert result.success is expected["success"]
    assert result.error is not None
    assert result.error.code == expected["code"]
    assert result.error.retryable is expected["retryable"]
    assert result.error.details == {
        "command": call["command"],
        "timeoutMs": server_cfg["defaultTimeoutMs"],
    }
    assert observed_signal is not None
    assert observed_signal.is_set() is expected["signalAborted"]


async def test_default_deadline_disabled_and_invalid_options():
    with pytest.raises(ValueError):
        create_server("bad-timeout", default_timeout_ms=-1)
    with pytest.raises(ValueError):
        create_server("bad-cap", max_validation_issues=0)

    for disabled in (0, None):
        server = create_server("no-deadline", default_timeout_ms=disabled)

        @server.command(name="work-quick", description="Quick", expose=ExposeOptions(mcp=True))
        async def work_quick(input: Any):
            await asyncio.sleep(0.01)
            return success({"ok": True})

        res = await server.execute("work-quick", {})
        assert res.success is True


async def test_pre_cancelled_single_command():
    case = _case("pre-cancelled-single-command")
    call = case["call"]
    expected = case["expect"]

    middleware_called = False
    handler_ran = False

    async def spy_middleware(name: str, data: Any, ctx: CommandContext, next_fn: Any):
        nonlocal middleware_called
        middleware_called = True
        return await next_fn()

    server = create_server("execution-controls-cancel", middleware=[spy_middleware])

    @server.command(name=call["command"], description="Run work", expose=ExposeOptions(mcp=True))
    async def work_run(input: Any):
        nonlocal handler_ran
        handler_ran = True
        return success({"ok": True})

    sig = asyncio.Event()
    sig.set()
    result = await server.execute(call["command"], {}, CommandContext(signal=sig))
    assert result.success is expected["success"]
    assert result.error is not None
    assert result.error.code == expected["code"]
    assert result.error.retryable is expected["retryable"]
    assert handler_ran is expected["handlerRan"]
    assert middleware_called is False


async def test_pre_cancelled_batch():
    case = _case("pre-cancelled-batch")
    expected = case["expect"]
    calls = 0

    async def run_command(name: str, payload: Any, context: CommandContext):
        nonlocal calls
        calls += 1
        return success(payload)

    sig = asyncio.Event()
    sig.set()
    result = await execute_batch(
        case["request"],
        CommandContext(signal=sig),
        run_command=run_command,
        max_batch_size=DEFAULT_MAX_BATCH_SIZE,
        max_batch_parallelism=DEFAULT_MAX_BATCH_PARALLELISM,
    )
    assert result.success is expected["success"]
    assert calls == expected["calls"]
    assert len(result.results) == len(case["request"]["commands"])
    for item in result.results:
        assert item.result.success is False
        assert item.result.error is not None
        assert item.result.error.code == expected["itemCode"]
        assert item.duration_ms == expected["durationMs"]


async def test_mid_batch_cancellation_stops_queued_work_and_preserves_in_flight():
    sig = asyncio.Event()
    started_first = asyncio.Event()
    release_first = asyncio.Event()
    started: list[int] = []

    async def run_command(name: str, payload: Any, context: CommandContext):
        idx = payload["index"]
        started.append(idx)
        if idx == 0:
            started_first.set()
            await release_first.wait()
        return success({"index": idx})

    request = {
        "commands": [
            {"command": "work-run", "input": {"index": 0}},
            {"command": "work-run", "input": {"index": 1}},
        ],
        "options": {"parallelism": 1},
    }
    task = asyncio.create_task(
        execute_batch(
            request,
            CommandContext(signal=sig),
            run_command=run_command,
            max_batch_size=DEFAULT_MAX_BATCH_SIZE,
            max_batch_parallelism=DEFAULT_MAX_BATCH_PARALLELISM,
        )
    )
    await started_first.wait()
    sig.set()
    release_first.set()
    result = await task
    assert started == [0]
    assert result.results[0].result.success is True
    assert result.results[1].result.success is False
    assert result.results[1].result.error is not None
    assert result.results[1].result.error.code == "COMMAND_CANCELLED"
    assert result.results[1].duration_ms == 0


@pytest.mark.parametrize("case", BATCH_LIMIT_CASES, ids=[c["id"] for c in BATCH_LIMIT_CASES])
async def test_batch_limits(case: dict[str, Any]):
    limits = case["limits"]
    server = create_server(
        "execution-controls-vectors",
        max_batch_size=limits["maxBatchSize"],
        max_batch_parallelism=limits["maxBatchParallelism"],
    )
    calls = 0

    @server.command(name="work-run", description="Echo input", expose=ExposeOptions(mcp=True))
    async def work_run(input: Any):
        nonlocal calls
        calls += 1
        return success(input)

    request = {
        "commands": [
            {"command": "work-run", "input": {"index": i}} for i in range(case["commandCount"])
        ],
        "options": {"parallelism": case["parallelism"]},
    }
    result = await server.call_tool("afd-batch", request)
    expected = case["expect"]

    assert result.success is expected["success"]
    if expected["success"]:
        assert result.summary.total == expected["total"]
        assert result.summary.success_count == expected["successCount"]
        assert calls == expected["total"]
    else:
        assert result.error is not None
        assert result.error.code == expected["code"]
        assert bool(result.error.retryable) is expected["retryable"]
        assert calls == expected["calls"]
        assert len(result.results) == expected["resultsLength"]


@pytest.mark.parametrize("case", VALIDATION_CAP_CASES, ids=[c["id"] for c in VALIDATION_CAP_CASES])
async def test_validation_issue_cap(case: dict[str, Any]):
    expected = case["expect"]
    limit = case["limit"]
    count = case["invalidItemCount"]

    class ManyValues(BaseModel):
        values: list[str]

    server = create_server("execution-controls-val-cap", max_validation_issues=limit)

    @server.command(
        name="validate-pydantic",
        description="Validate with Pydantic model",
        input_schema=ManyValues,
        expose=ExposeOptions(mcp=True),
    )
    async def validate_pydantic(input: ManyValues):
        return success(input)

    @server.command(
        name="validate-schema",
        description="Validate with JSON Schema",
        input_schema={
            "type": "object",
            "properties": {"values": {"type": "array", "items": {"type": "string"}}},
            "required": ["values"],
        },
        expose=ExposeOptions(mcp=True),
    )
    async def validate_schema_cmd(input: Any):
        return success(input)

    for cmd_name in ("validate-pydantic", "validate-schema"):
        result = await server.execute(cmd_name, {"values": [0] * count})
        assert result.success is expected["success"]
        assert result.error is not None
        assert result.error.code == expected["code"]
        assert bool(result.error.retryable) is expected["retryable"]
        details = result.error.details or {}
        assert len(details["errors"]) == expected["reportedErrors"]
        if expected["truncated"]:
            assert details.get("truncated") is True
            assert details.get("limit") == expected["detailsLimit"]
            assert details.get("totalErrors") == count
            assert f"Showing first {limit} validation issues" in (result.error.suggestion or "")
        else:
            assert "truncated" not in details
            assert "limit" not in details
            assert "totalErrors" not in details


async def test_over_limit_batch_refused_before_confirmations():
    """Over-limit afd-batch rejects with INVALID_BATCH_REQUEST before confirm_prompt gates."""
    calls = 0
    server = create_server(
        "execution-controls-batch-before-confirm",
        max_batch_size=2,
        max_batch_parallelism=2,
        confirmations="enforce",
    )

    @server.command(
        name="gated-work",
        description="Confirmation-gated command",
        confirm_prompt="Confirm gated work?",
        expose=ExposeOptions(mcp=True),
    )
    async def gated_work(input: Any):
        nonlocal calls
        calls += 1
        return success(input)

    over_size = await server.call_tool(
        "afd-batch",
        {
            "commands": [
                {"command": "gated-work", "input": {}},
                {"command": "gated-work", "input": {}},
                {"command": "gated-work", "input": {}},
            ]
        },
    )
    assert over_size.success is False
    assert over_size.error is not None
    assert over_size.error.code == "INVALID_BATCH_REQUEST"
    assert over_size.error.retryable is False
    assert calls == 0


async def test_timeout_keeps_signal_set_for_cleanup_and_preserves_partial_caller_signal_digest():
    """Timed-out cooperative handler keeps observing signal.is_set() during cleanup, and
    passing only caller signal (cancel=None) does not add synthetic 'cancel' to journal digest."""
    from afd.core.journal import MemoryJournalSink
    from afd.server.journal import create_journal_middleware

    seen_in_cleanup: list[bool] = []
    cleanup_done = asyncio.Event()

    server = create_server("execution-controls-timeout-cleanup", default_timeout_ms=25)

    @server.command(name="slow-cleanup", description="Checks signal in finally after timeout")
    async def slow_cleanup(input: Any, context: CommandContext | None = None):
        try:
            await asyncio.sleep(5)
            return success({"done": True})
        finally:
            # Yield across a tick so _execute_command's finally has already run.
            await asyncio.sleep(0)
            seen_in_cleanup.append(bool(context and context.signal and context.signal.is_set()))
            cleanup_done.set()

    res = await server.execute("slow-cleanup", {})
    assert res.success is False
    assert res.error is not None and res.error.code == "TIMEOUT"
    await asyncio.wait_for(cleanup_done.wait(), timeout=2.0)
    assert seen_in_cleanup == [True]

    # Passing only signal (cancel=None) keeps 'signal' in journal digest and omits synthesized 'cancel'.
    sink = MemoryJournalSink()
    j_server = create_server(
        "execution-controls-journal-partial-signal",
        middleware=[create_journal_middleware(sink=sink)],
    )
    j_server_no_timeout = create_server(
        "execution-controls-journal-no-timeout",
        default_timeout_ms=None,
        middleware=[create_journal_middleware(sink=sink)],
    )

    for srv in (j_server, j_server_no_timeout):

        @srv.command(name="echo-ok", description="Quick echo")
        async def echo_ok(input: Any):
            return success(input)

    caller_sig = asyncio.Event()
    trace = "trace-partial-sig"
    ok1 = await j_server.execute(
        "echo-ok", {"v": 1}, context=CommandContext(trace_id=trace, signal=caller_sig)
    )
    ok2 = await j_server_no_timeout.execute(
        "echo-ok", {"v": 1}, context=CommandContext(trace_id=trace, signal=caller_sig)
    )
    ok3 = await j_server_no_timeout.execute(
        "echo-ok",
        {"v": 1},
        context=CommandContext(trace_id=trace, signal=caller_sig, cancel=caller_sig),
    )
    assert ok1.success is True and ok2.success is True and ok3.success is True
    entries = await sink.read()
    assert len(entries) == 3
    assert entries[0].context_digest.hash == entries[1].context_digest.hash
    assert entries[0].context_digest.hash != entries[2].context_digest.hash


def test_retry_mutation_cases_present():
    assert [c["id"] for c in RETRY_MUTATION_CASES] == [
        "retry-read-after-timeout",
        "retry-mutation-not-repeated",
        "retry-mutation-with-option",
    ]


@pytest.mark.parametrize("case", RETRY_MUTATION_CASES, ids=[c["id"] for c in RETRY_MUTATION_CASES])
async def test_retry_mutation(case: dict[str, Any]):
    """The retry middleware repeats a mutation only with ``retry_mutations`` (#2673)."""
    retry = case["retry"]
    server = create_server(
        "execution-controls-retry",
        middleware=[
            create_retry_middleware(
                max_retries=retry["maxRetries"],
                retry_delay=retry["retryDelayMs"],
                jitter=retry["jitter"],
                retry_mutations=retry.get("retryMutations", False),
            )
        ],
    )
    runs = 0

    @server.command(
        name=case["command"]["name"],
        description="Fails once, then succeeds",
        mutation=case["command"]["mutation"],
    )
    async def flaky(input: Any):
        nonlocal runs
        runs += 1
        if runs == 1:
            code = case["handler"]["failFirst"]["code"]
            return error(code, "Downstream timed out", suggestion="Check, then retry")
        return success({"runs": runs})

    result = await server.execute(case["command"]["name"], {})
    expected = case["expect"]
    assert runs == expected["handlerRuns"]
    assert result.success is expected["success"]
    if "code" in expected:
        assert result.error is not None
        assert result.error.code == expected["code"]
