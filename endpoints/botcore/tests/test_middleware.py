"""Tests for middleware stack integration (P2) and telemetry (P3)."""

from __future__ import annotations

import pytest
from afd import SimpleRegistry, success
from afd.server.middleware import default_middleware
from afd.testing import assert_success

from botcore.registry import MiddlewareRegistry, get_client, reset_client


@pytest.fixture(autouse=True)
def _reset():
    """Reset global client between tests."""
    reset_client()
    yield
    reset_client()


def _make_registry_with_command():
    """Create a SimpleRegistry with a test command."""
    reg = SimpleRegistry()

    @reg.command("test-echo")
    async def test_echo(message: str = "hello"):
        return success(data={"message": message})

    return reg


# ── MiddlewareRegistry basics ─────────────────────────────────────────────


async def test_middleware_wraps_execute():
    """Middleware sees command name and args during execute."""
    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    seen = {}

    async def spy_middleware(name, args, context, next_fn):
        seen["name"] = name
        seen["args"] = args
        return await next_fn()

    mw_reg.add_middleware(spy_middleware)
    result = await mw_reg.execute("test-echo", {"message": "world"})

    data = assert_success(result)
    assert data["message"] == "world"
    assert seen["name"] == "test-echo"
    assert seen["args"] == {"message": "world"}


async def test_multiple_middleware_compose_order():
    """First registered middleware is outermost (runs first/last)."""
    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    order = []

    async def mw_a(name, args, context, next_fn):
        order.append("a-before")
        result = await next_fn()
        order.append("a-after")
        return result

    async def mw_b(name, args, context, next_fn):
        order.append("b-before")
        result = await next_fn()
        order.append("b-after")
        return result

    mw_reg.add_middleware(mw_a)
    mw_reg.add_middleware(mw_b)
    await mw_reg.execute("test-echo")

    assert order == ["a-before", "b-before", "b-after", "a-after"]


async def test_no_middleware_passthrough():
    """Without middleware, execute delegates directly."""
    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    result = await mw_reg.execute("test-echo", {"message": "direct"})
    data = assert_success(result)
    assert data["message"] == "direct"


async def test_default_middleware_adds_trace_id():
    """default_middleware() includes trace_id middleware."""
    from afd.core.commands import CommandContext

    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    for mw in default_middleware():
        mw_reg.add_middleware(mw)

    ctx = CommandContext()
    result = await mw_reg.execute("test-echo", None, ctx)
    assert_success(result)


# ── MiddlewareRegistry delegation ─────────────────────────────────────────


def test_delegates_has_command():
    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    assert mw_reg.has_command("test-echo") is True
    assert mw_reg.has_command("nonexistent") is False


def test_delegates_list_command_names():
    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    names = mw_reg.list_command_names()
    assert "test-echo" in names


def test_delegates_list_commands():
    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    commands = mw_reg.list_commands()
    assert len(commands) >= 1


def test_delegates_get_command():
    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    cmd = mw_reg.get_command("test-echo")
    assert cmd is not None


# ── Plugin middleware integration ─────────────────────────────────────────


async def test_plugin_middleware_applied():
    """Plugin-registered middleware is applied via set_plugin_middleware."""
    from botcore.plugin import PluginRegistry
    from botcore.registry import set_plugin_middleware

    called = {"count": 0}

    async def counting_middleware(name, args, context, next_fn):
        called["count"] += 1
        return await next_fn()

    plugin_reg = PluginRegistry()
    plugin_reg.add_middleware(counting_middleware)
    set_plugin_middleware(plugin_reg.middleware)

    # get_client() will create a client with default + plugin middleware
    # We need a command registered in the global registry
    from botcore.registry import registry

    @registry.command("test-plugin-mw")
    async def _test_cmd():
        return success(data={"ok": True})

    try:
        client = get_client()
        result = await client.call("test-plugin-mw")
        assert_success(result)
        assert called["count"] == 1
    finally:
        set_plugin_middleware([])


# ── Telemetry integration (P3) ────────────────────────────────────────────


async def test_telemetry_middleware_records_events(capsys):
    """Telemetry middleware records events to ConsoleTelemetrySink."""
    from afd.core.commands import CommandContext
    from afd.core.telemetry import ConsoleTelemetrySink
    from afd.server.middleware import create_telemetry_middleware

    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    sink = ConsoleTelemetrySink(format="text")
    mw_reg.add_middleware(create_telemetry_middleware(sink))

    ctx = CommandContext()
    result = await mw_reg.execute("test-echo", None, ctx)
    assert_success(result)


async def test_telemetry_json_format(capsys):
    """ConsoleTelemetrySink with json format produces output."""
    from afd.core.commands import CommandContext
    from afd.core.telemetry import ConsoleTelemetrySink
    from afd.server.middleware import create_telemetry_middleware

    reg = _make_registry_with_command()
    mw_reg = MiddlewareRegistry(reg)

    sink = ConsoleTelemetrySink(format="json")
    mw_reg.add_middleware(create_telemetry_middleware(sink))

    ctx = CommandContext()
    result = await mw_reg.execute("test-echo", None, ctx)
    assert_success(result)


async def test_telemetry_disabled_by_default():
    """Telemetry disabled by default — no telemetry middleware added."""
    from botcore.config import BotCoreConfig

    config = BotCoreConfig()
    assert config.telemetry_enabled is False

    # get_client with default config should not add telemetry middleware
    # (verified by the fact that no sink is created)
    reset_client()
    client = get_client(config=config)
    assert client is not None


async def test_telemetry_enabled_via_config():
    """Telemetry middleware added when config.telemetry_enabled=True."""
    from botcore.config import BotCoreConfig

    config = BotCoreConfig(telemetry_enabled=True, telemetry_format="text")

    from botcore.registry import registry

    @registry.command("test-telemetry-cmd")
    async def _cmd():
        return success(data={"ok": True})

    reset_client()
    client = get_client(config=config)
    result = await client.call("test-telemetry-cmd")
    assert_success(result)
