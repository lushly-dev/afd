"""Tests for batch execution (P6)."""

from __future__ import annotations

from afd import SimpleRegistry, create_direct_client, error, success

from botcore.registry import MiddlewareRegistry, batch_execute


def _make_batch_registry():
    """Create a registry with commands for batch testing."""
    reg = SimpleRegistry()

    @reg.command("add")
    async def add(a: int = 0, b: int = 0):
        return success(data={"sum": a + b})

    @reg.command("greet")
    async def greet(name: str = "world"):
        return success(data={"greeting": f"Hello, {name}!"})

    @reg.command("fail-cmd")
    async def fail_cmd():
        return error("BATCH_FAIL", "Intentional failure")

    return reg


def _make_client(reg=None):
    if reg is None:
        reg = _make_batch_registry()
    mw_reg = MiddlewareRegistry(reg)
    return create_direct_client(mw_reg, source="test")


async def test_batch_all_succeed():
    """Batch of 3 succeeding commands."""
    client = _make_client()
    result = await batch_execute(client, [
        ("add", {"a": 1, "b": 2}),
        ("greet", {"name": "Alice"}),
        ("add", {"a": 10, "b": 20}),
    ])

    assert result.success is True
    assert result.summary.total == 3
    assert result.summary.success_count == 3
    assert result.summary.failure_count == 0
    assert result.results[0].result.data["sum"] == 3
    assert result.results[1].result.data["greeting"] == "Hello, Alice!"
    assert result.results[2].result.data["sum"] == 30


async def test_batch_failure_continues():
    """Batch with failure, stop_on_error=False continues."""
    client = _make_client()
    result = await batch_execute(client, [
        ("add", {"a": 1, "b": 1}),
        ("fail-cmd", {}),
        ("greet", {"name": "Bob"}),
    ], stop_on_error=False)

    assert result.summary.total == 3
    assert result.summary.success_count == 2
    assert result.summary.failure_count == 1
    assert result.results[2].result.data["greeting"] == "Hello, Bob!"


async def test_batch_failure_stops():
    """Batch with failure, stop_on_error=True stops."""
    client = _make_client()
    result = await batch_execute(client, [
        ("add", {"a": 1, "b": 1}),
        ("fail-cmd", {}),
        ("greet", {"name": "Bob"}),
    ], stop_on_error=True)

    # Should stop after failure — only 2 results
    assert len(result.results) == 2
    assert result.summary.success_count == 1
    assert result.summary.failure_count == 1


async def test_batch_empty():
    """Empty batch returns empty result."""
    client = _make_client()
    result = await batch_execute(client, [])

    assert result.summary.total == 0
    assert result.summary.success_count == 0


async def test_batch_result_has_timing():
    """BatchResult has timing information."""
    client = _make_client()
    result = await batch_execute(client, [
        ("add", {"a": 1, "b": 2}),
    ])

    assert result.timing.total_ms >= 0
    assert result.timing.average_ms >= 0
    assert result.timing.started_at is not None
    assert result.timing.completed_at is not None


async def test_batch_result_has_confidence():
    """BatchResult has computed confidence."""
    client = _make_client()
    result = await batch_execute(client, [
        ("add", {"a": 1, "b": 2}),
        ("greet", {"name": "Test"}),
    ])

    assert isinstance(result.confidence, float)
    assert 0 <= result.confidence <= 1
