"""Direct-client deadlines and JSON-shaped shallow validation contracts."""

import asyncio
import time

import pytest

from afd import success
from afd.direct import CommandParameter, DirectCallContext, DirectClient, SimpleRegistry


@pytest.mark.parametrize(("kind", "value"), [
    ("number", True), ("number", False), ("number", "1"),
    ("object", "bad"), ("object", []), ("object", None),
    ("array", "bad"), ("array", {}), ("array", (1,)),
    ("boolean", 1), ("string", 1),
])
async def test_shallow_invalid_types_do_not_execute(kind, value):
    registry = SimpleRegistry()
    calls = []

    async def record(value):
        calls.append(value)
        return success(value)

    registry.register("value-record", record, parameters=[CommandParameter("value", kind)])
    result = await DirectClient(registry).call("value-record", {"value": value})
    assert result.error.code == "VALIDATION_ERROR"
    assert calls == []


@pytest.mark.parametrize(("kind", "value"), [
    ("number", 1), ("number", 0.25), ("object", {}), ("array", []),
    ("boolean", False), ("string", ""),
])
async def test_valid_shallow_types(kind, value):
    registry = SimpleRegistry()

    async def record(value):
        return success(value)

    registry.register("value-record", record, parameters=[CommandParameter("value", kind)])
    result = await DirectClient(registry).call("value-record", {"value": value})
    assert result.success
    assert result.data == value


async def test_millisecond_deadline_signals_cancellation_without_waiting_for_handler():
    cancelled = asyncio.Event()
    release = asyncio.Event()
    finished = asyncio.Event()
    registry = SimpleRegistry()

    async def ignores_cancellation():
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()
        finally:
            finished.set()
        return success("completed")

    registry.register("slow-record", ignores_cancellation)
    started = time.monotonic()
    try:
        result = await DirectClient(registry).call("slow-record", {}, DirectCallContext(timeout=10))
        assert time.monotonic() - started < 0.5
        assert result.error.code == "TIMEOUT"
        assert result.error.details == {"command": "slow-record", "timeoutMs": 10}
        assert "check its effect" in result.error.suggestion
        await asyncio.wait_for(cancelled.wait(), 1)
        assert not finished.is_set()
    finally:
        release.set()
        await asyncio.wait_for(finished.wait(), 1)


async def test_caller_cancellation_propagates_and_cancels_execution():
    entered = asyncio.Event()
    cancelled = asyncio.Event()
    registry = SimpleRegistry()

    async def slow():
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    registry.register("slow-record", slow)
    call = asyncio.create_task(DirectClient(registry).call("slow-record", {}, DirectCallContext(timeout=1000)))
    await entered.wait()
    call.cancel()
    with pytest.raises(asyncio.CancelledError):
        await call
    await asyncio.wait_for(cancelled.wait(), 1)


@pytest.mark.parametrize("timeout", [None, 0, -1, float("inf"), float("nan"), True])
async def test_non_positive_or_non_finite_deadlines_are_not_enforced(timeout):
    registry = SimpleRegistry()

    async def record():
        await asyncio.sleep(0.002)
        return success(None)

    registry.register("value-record", record)
    assert (await DirectClient(registry).call("value-record", {}, DirectCallContext(timeout=timeout))).success


async def test_large_finite_deadline_does_not_overflow_timer():
    registry = SimpleRegistry()

    async def record():
        return success(None)

    registry.register("value-record", record)
    result = await DirectClient(registry).call("value-record", {}, DirectCallContext(timeout=10 ** 400))
    assert result.success
