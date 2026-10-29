"""Tests for botcore.registry."""

from __future__ import annotations

from afd import SimpleRegistry, success
from afd.testing import assert_success

from botcore.registry import get_client, registry, reset_client


def test_registry_is_simple_registry() -> None:
    """Global registry is an AFD SimpleRegistry instance."""
    assert isinstance(registry, SimpleRegistry)


def test_get_client_returns_client() -> None:
    """get_client returns a DirectClient that can be reused."""
    reset_client()
    client = get_client()
    assert client is not None
    # Second call returns the same instance
    assert get_client() is client
    reset_client()


def test_reset_client_clears_cache() -> None:
    """reset_client forces a new client on next get_client call."""
    reset_client()
    first = get_client()
    reset_client()
    second = get_client()
    assert first is not second
    reset_client()


async def test_client_calls_registered_command() -> None:
    """Client can call a command registered on the global registry."""
    @registry.command(name="test.ping", description="Ping for testing")
    async def _ping() -> dict:
        return success(data={"pong": True})

    reset_client()
    client = get_client()
    result = await client.call("test.ping")
    data = assert_success(result)
    assert data["pong"] is True
    reset_client()
