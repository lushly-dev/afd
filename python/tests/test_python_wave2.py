"""Python Wave 2 runtime contract against the TypeScript reference."""

import asyncio

import pytest

from afd import ExposeOptions, success
from afd.core.result import CommandError, failure
from afd.core.wire import to_wire
from afd.direct import DirectCallContext, DirectClient, DirectClientOptions, create_direct_registry
from afd.server import create_server, define_command
from afd.server.decorators import command_to_definition, get_command_metadata


def test_failure_accepts_every_non_payload_result_option():
    result = failure(
        CommandError(code="TEST", message="Held", suggestion="Retry"),
        confidence=0.4, reasoning="Try a different route", sources=[], plan=[],
        alternatives=[], warnings=[], suggestions=["Try again"],
        metadata={"traceId": "test"}, undo_command="item-restore", undo_args={"id": 1},
    )
    assert to_wire(result) == {
        "success": False, "error": {"code": "TEST", "message": "Held", "suggestion": "Retry"},
        "confidence": 0.4, "reasoning": "Try a different route", "sources": [], "plan": [],
        "alternatives": [], "warnings": [], "suggestions": ["Try again"],
        "metadata": {"traceId": "test"}, "undoCommand": "item-restore", "undoArgs": {"id": 1},
    }
    with pytest.raises(TypeError):
        failure(result.error, data="cannot override")


@pytest.mark.parametrize("via_server", [False, True])
async def test_decorators_preserve_planning_metadata_and_handoff(via_server):
    server = create_server("metadata")
    decorate = server.command if via_server else define_command

    @decorate(name="chat-connect", description="Connect to chat", errors=["OFFLINE"],
              execution_time="slow", handoff=True, handoff_protocol="websocket",
              expose=ExposeOptions(mcp=True))
    async def connect(args):
        return success(args)

    if not via_server:
        server.register(connect)
    metadata = get_command_metadata(connect)
    definition = command_to_definition(connect)
    assert metadata.errors == definition.errors == ["OFFLINE"]
    assert metadata.execution_time == definition.execution_time == "slow"
    assert definition.handoff and definition.handoff_protocol == "websocket"
    assert {"handoff", "handoff:websocket"} <= set(definition.tags)
    detail = await server.execute("afd-detail", {"command": ["chat-connect"]})
    command = detail.data[0]
    assert command["errors"] == ["OFFLINE"]
    assert command["executionTime"] == "slow"
    assert command["handoff"] is True


def command(name="item-read", **metadata):
    @define_command(name=name, description="Read an item", **metadata)
    async def read(args, context):
        return success({"input": args, "source": context.extra.get("source")})
    return read


async def test_registry_execute_checks_exposure_even_if_discovery_is_bypassed():
    registry = create_direct_registry([command(expose=ExposeOptions(agent=False))])
    assert registry.list_command_names() == []
    result = await registry.execute("item-read", {})
    assert result.error.code == "COMMAND_NOT_EXPOSED"
    assert result.error.suggestion
    assert (await DirectClient(registry).call("item-read", {})).error.code == "UNKNOWN_TOOL"


@pytest.mark.parametrize("allow", [lambda _: False, lambda _: 1, lambda _: (_ for _ in ()).throw(ValueError())])
async def test_client_allow_fails_closed_before_lookup_and_middleware(allow):
    events = []
    async def middleware(name, args, context, next_fn):
        events.append(name)
        return await next_fn()
    client = DirectClient(create_direct_registry([command()]),
                          DirectClientOptions(allow=allow, middleware=[middleware]))
    for name in ("item-read", "item-missing"):
        result = await client.call(name)
        assert result.error.code == "COMMAND_NOT_ALLOWED"
        assert result.error.suggestion
    assert client.list_commands() == client.list_command_names() == []
    assert not client.has_command("item-read")
    assert events == []


async def test_client_middleware_wraps_registry_middleware_in_order():
    events = []
    def middleware(label):
        async def run(name, args, context, next_fn):
            events.append(label + ":before")
            context.extra["source"] = label
            result = await next_fn()
            events.append(label + ":after")
            return result
        return run
    registry = create_direct_registry([command()], middleware=[middleware("registry")])
    client = DirectClient(registry, DirectClientOptions(
        allow=lambda name: name == "item-read", middleware=[middleware("first"), middleware("second")]))
    result = await client.call("item-read", {"id": 1})
    assert result.success and result.data == {"input": {"id": 1}, "source": "registry"}
    assert events == ["first:before", "second:before", "registry:before", "registry:after", "second:after", "first:after"]
    assert client.has_command("item-read")
    assert client.list_command_names() == ["item-read"]
    assert [c.name for c in client.list_commands()] == ["item-read"]


async def test_client_middleware_errors_are_sanitized_and_time_is_bounded():
    async def raises(*args):
        raise RuntimeError("SECRET")
    registry = create_direct_registry([command()])
    result = await DirectClient(registry, DirectClientOptions(middleware=[raises])).call("item-read")
    assert result.error.code == "COMMAND_EXECUTION_ERROR"
    assert "SECRET" not in str(to_wire(result))
    cancelled = asyncio.Event()
    async def waits(name, args, context, next_fn):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    result = await DirectClient(registry, DirectClientOptions(middleware=[waits])).call(
        "item-read", context=DirectCallContext(timeout=10))
    assert result.error.code == "TIMEOUT"
    await asyncio.wait_for(cancelled.wait(), 1)


def test_handoff_default_policy_is_fresh_and_explicit_policy_replaces_it():
    from afd.core.handoff import create_handoff

    first = create_handoff("websocket", "wss://example.test")
    assert first["metadata"]["reconnect"] == {"allowed": True, "maxAttempts": 3, "backoffMs": 1000}
    first["metadata"]["reconnect"]["maxAttempts"] = 99
    assert create_handoff("sse", "https://example.test")["metadata"]["reconnect"]["maxAttempts"] == 3
    assert create_handoff("sse", "https://example.test", reconnect_allowed=False)["metadata"]["reconnect"] == {"allowed": False}
    assert create_handoff("sse", "https://example.test", reconnect_max_attempts=0,
                          reconnect_backoff_ms=0)["metadata"]["reconnect"] == {
        "allowed": True, "maxAttempts": 0, "backoffMs": 0,
    }


@pytest.mark.parametrize(("options", "expected"), [
    ({}, (7, 250)), ({"max_attempts": 3, "backoff_ms": 1000}, (3, 1000)),
    ({"max_attempts": 0, "backoff_ms": 0}, (0, 0)),
])
def test_handoff_client_explicit_options_win_even_when_equal_to_defaults(options, expected):
    from afd.handoff_client import ReconnectingHandoffConnection, ReconnectionOptions

    connection = ReconnectingHandoffConnection(None, {
        "protocol": "sse", "endpoint": "https://example.test",
        "metadata": {"reconnect": {"allowed": True, "maxAttempts": 7, "backoffMs": 250}},
    }, ReconnectionOptions(**options))
    assert (connection._options.max_attempts, connection._options.backoff_ms) == expected
    legacy = ReconnectingHandoffConnection(None, {"protocol": "sse", "endpoint": "https://example.test"},
                                           ReconnectionOptions())
    assert (legacy._options.max_attempts, legacy._options.backoff_ms) == (3, 1000)


async def test_client_factory_options_and_pipeline_allow():
    from afd.direct import create_direct_client

    client = create_direct_client(create_direct_registry([command(), command("item-delete")]),
                                  allow=lambda name: name == "item-read")
    result = await client.pipe([{"command": "item-read"}, {"command": "item-delete"}])
    assert not result.success
    assert result.final.error.code == "COMMAND_NOT_ALLOWED"
    unknown = await client.call("item-missing")
    assert unknown.error.code == "COMMAND_NOT_ALLOWED"


async def test_nested_registry_and_server_calls_cannot_widen_carried_allow():
    calls = []
    registry = None

    @define_command(name="item-delete", description="Delete item")
    async def delete(args):
        calls.append(args)
        return success(args)

    @define_command(name="item-wrap", description="Wrap an inner call")
    async def wrap(args, context):
        assert not callable(context._direct_allow)
        # Ordinary JSON context fields have no policy authority.
        context.extra["allow"] = lambda _: True
        if args.get("server"):
            return await registry._server.execute("item-delete", {}, context)
        return await registry.execute("item-delete", {}, context, allow=lambda _: True)

    registry = create_direct_registry([wrap, delete])
    client = DirectClient(registry, DirectClientOptions(allow=lambda name: name == "item-wrap"))
    for args in ({}, {"server": True}):
        result = await client.call("item-wrap", args)
        assert result.error.code == "COMMAND_NOT_ALLOWED"
    assert calls == []
    # A trusted raw host call with no carried policy still runs.
    assert (await registry.execute("item-delete", {})).success
    denied = await registry.execute("not-registered", {}, allow=lambda _: False)
    assert denied.error.code == "COMMAND_NOT_ALLOWED"


@pytest.mark.parametrize("interface", ["", "unknown", "mcp"])
async def test_registry_invalid_or_unexposed_interface_never_bypasses_exposure(interface):
    registry = create_direct_registry([command(expose=ExposeOptions(agent=False))], interface=interface)
    assert registry.list_command_names() == []
    result = await registry.execute("item-read", {}, DirectCallContext(extra={"interface": "agent", "remote": True}))
    assert result.error.code == "COMMAND_NOT_EXPOSED"


def test_null_handoff_policy_fields_use_defaults():
    from afd.handoff_client import ReconnectingHandoffConnection, ReconnectionOptions

    connection = ReconnectingHandoffConnection(None, {
        "protocol": "sse", "endpoint": "https://example.test",
        "metadata": {"reconnect": {"allowed": True, "maxAttempts": None, "backoffMs": None}},
    }, ReconnectionOptions())
    assert (connection._options.max_attempts, connection._options.backoff_ms) == (3, 1000)


async def test_client_observer_never_sees_legacy_approval_tokens():
    from afd.direct import SimpleRegistry

    registry = SimpleRegistry()
    @registry.command("item-delete")
    async def delete():
        return failure(CommandError(code="APPROVAL_REQUIRED", message="Held", suggestion="Ask",
                                    details={"approvalToken": "SECRET", "summary": "Delete?"}))
    observed = []
    async def observer(name, args, context, next_fn):
        result = await next_fn()
        observed.append(to_wire(result))
        return result
    result = await DirectClient(registry, DirectClientOptions(middleware=[observer])).call("item-delete")
    assert result.error.code == "APPROVAL_REQUIRED"
    assert observed and "SECRET" not in str(observed)
    assert "approvalToken" not in str(observed)


async def test_approval_retry_gets_fresh_actor_for_mutating_client_middleware():
    from afd import Actor
    from afd.server import create_approval_middleware

    actors = []
    @define_command(name="item-delete", description="Delete item", approval="required")
    async def delete(args, context):
        actors.append(context.actor.id)
        return success(args)
    gate = create_approval_middleware(secret="test-secret-0123456789abcdef0123456789", commands=[delete])
    registry = create_direct_registry([delete], middleware=[gate])
    seen = []
    async def refine(name, args, context, next_fn):
        seen.append(context.actor.id)
        context.actor.id += ":refined"
        return await next_fn()
    actor = Actor(kind="human", id="owner")
    client = DirectClient(registry, DirectClientOptions(
        actor=actor, middleware=[refine], on_approval_needed=lambda _: True))
    result = await client.call("item-delete", {})
    assert result.success
    assert seen == ["owner", "owner"]
    assert actors == ["owner:refined"]
    assert actor.id == "owner"


@pytest.mark.parametrize("kind", ["simple", "core"])
async def test_legacy_registry_nested_calls_keep_private_policy(kind):
    from afd.core.commands import CommandDefinition, create_command_registry
    from afd.direct import SimpleRegistry

    ran = []
    registry = SimpleRegistry() if kind == "simple" else create_command_registry()
    async def inner(args=None, context=None):
        ran.append(True)
        return success(args)
    async def outer(args=None, context=None):
        return await registry.execute("item-delete", {}, context)
    if kind == "simple":
        async def simple_outer(*, context):
            return await outer(context=context)
        registry.register("item-wrap", simple_outer)
        registry.register("item-delete", inner)
    else:
        registry.register(CommandDefinition(name="item-wrap", description="Wrap call", handler=outer))
        registry.register(CommandDefinition(name="item-delete", description="Delete item", handler=inner))
        # The core registry uses has/list rather than the DirectRegistry adapter names.
        registry.has_command = registry.has
        registry.list_command_names = lambda: [c.name for c in registry.list()]
    client = DirectClient(registry, DirectClientOptions(allow=lambda name: name == "item-wrap"))
    result = await client.call("item-wrap", {})
    assert result.error.code == "COMMAND_NOT_ALLOWED"
    assert ran == []


async def test_unknown_suggestions_hide_denied_names_and_forged_policy_denies():
    from afd.core.commands import CommandContext

    registry = create_direct_registry([command(), command("item-ready")])
    client = DirectClient(registry, DirectClientOptions(allow=lambda name: name != "item-read"))
    unknown = await client.call("item-rea")
    assert unknown.error.code == "UNKNOWN_TOOL"
    assert "item-read" not in unknown.data.available_tools
    forged = CommandContext(_direct_allow=lambda _: True)
    denied = await registry.execute("item-read", {}, forged)
    assert denied.error.code == "COMMAND_NOT_ALLOWED"
