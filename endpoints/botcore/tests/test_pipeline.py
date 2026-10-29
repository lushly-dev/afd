"""Tests for DirectClient pipeline support (P5)."""

from __future__ import annotations

from afd import SimpleRegistry, create_direct_client, error, success
from afd.testing import assert_error, assert_success

from botcore.registry import MiddlewareRegistry


def _make_pipeline_registry():
    """Create a registry with commands suitable for pipeline testing."""
    reg = SimpleRegistry()

    @reg.command("greet")
    async def greet(name: str = "world"):
        return success(data={"greeting": f"Hello, {name}!", "name": name})

    @reg.command("uppercase")
    async def uppercase(text: str = ""):
        return success(data={"result": text.upper(), "original": text})

    @reg.command("failing")
    async def failing():
        return error("DELIBERATE_FAIL", "This command always fails")

    @reg.command("count-chars")
    async def count_chars(text: str = ""):
        return success(data={"length": len(text), "text": text})

    return reg


def _make_client(reg=None):
    """Create a DirectClient from a registry."""
    if reg is None:
        reg = _make_pipeline_registry()
    mw_reg = MiddlewareRegistry(reg)
    return create_direct_client(mw_reg, source="test")


async def test_simple_two_step_pipeline():
    """Two-step pipeline with $prev variable resolution."""
    client = _make_client()
    result = await client.pipe([
        {"command": "greet", "input": {"name": "Alice"}},
        {"command": "uppercase", "input": {"text": "$prev.greeting"}},
    ])

    assert result.success is True
    data = assert_success(result.final)
    assert data["result"] == "HELLO, ALICE!"


async def test_pipeline_with_alias():
    """Pipeline step with alias and $steps.alias.field access."""
    client = _make_client()
    result = await client.pipe([
        {"command": "greet", "input": {"name": "Bob"}, "as": "g"},
        {"command": "count-chars", "input": {"text": "$steps.g.greeting"}},
    ])

    assert result.success is True
    data = assert_success(result.final)
    assert data["text"] == "Hello, Bob!"
    assert data["length"] == len("Hello, Bob!")


async def test_pipeline_failure_propagation():
    """Pipeline failure at step 2 stops execution."""
    client = _make_client()
    result = await client.pipe([
        {"command": "greet", "input": {"name": "Test"}},
        {"command": "failing"},
    ])

    assert result.success is False
    # First step succeeded, second failed
    assert_success(result.steps[0].result)
    assert_error(result.steps[1].result, "DELIBERATE_FAIL")


async def test_pipeline_with_when_true():
    """Pipeline step with when condition that evaluates to true."""
    client = _make_client()
    result = await client.pipe([
        {"command": "greet", "input": {"name": "Alice"}, "as": "g"},
        {"command": "uppercase", "input": {"text": "$steps.g.greeting"}, "when": "$steps.g.name"},
    ])

    assert result.success is True
    data = assert_success(result.final)
    assert data["result"] == "HELLO, ALICE!"


async def test_pipeline_with_when_unresolved_skips_step():
    """A when condition on a missing field skips the step instead of running it."""
    client = _make_client()
    result = await client.pipe([
        {"command": "greet", "input": {"name": "Alice"}, "as": "g"},
        {"command": "uppercase", "input": {"text": "x"}, "when": "$steps.g.missing"},
    ])

    assert result.success is True
    skipped = assert_success(result.steps[1].result)
    assert skipped["skipped"] is True
    assert assert_success(result.final)["greeting"] == "Hello, Alice!"


async def test_handler_exception_is_redacted():
    """A raising handler returns a generic error without leaking the exception text."""
    reg = _make_pipeline_registry()

    @reg.command("boom")
    async def boom():
        raise RuntimeError("secret detail")

    result = await _make_client(reg).call("boom", {})

    assert_error(result, "COMMAND_EXECUTION_ERROR")
    assert "secret detail" not in result.error.message
    assert result.error.suggestion


async def test_single_step_pipeline():
    """Single-step pipeline works as a simple call."""
    client = _make_client()
    result = await client.pipe([
        {"command": "greet", "input": {"name": "Solo"}},
    ])

    assert result.success is True
    data = assert_success(result.final)
    assert data["greeting"] == "Hello, Solo!"


async def test_pipeline_three_steps():
    """Three-step pipeline chains data through multiple commands."""
    client = _make_client()
    result = await client.pipe([
        {"command": "greet", "input": {"name": "Chain"}, "as": "g"},
        {"command": "count-chars", "input": {"text": "$steps.g.greeting"}, "as": "c"},
        {"command": "greet", "input": {"name": "Done"}},
    ])

    assert result.success is True
    assert len(result.steps) == 3
    data = assert_success(result.final)
    assert data["greeting"] == "Hello, Done!"
