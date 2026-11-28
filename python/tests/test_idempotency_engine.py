"""Idempotency keys in Python beyond the shared vectors (``spec/idempotency.md``): the proposal's
exit criteria, the store (S12), cancellation while the store awaits (S5, S7), the surfaces of D3
and D4, and the clients that send a key (K1).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

pytest.importorskip("mcp")

from click.testing import CliRunner  # noqa: E402

from afd import (  # noqa: E402
    Actor,
    CommandResult,
    DirectCallContext,
    DirectClient,
    ExposeOptions,
    create_command_registry,
    error,
    parse_journal,
    serialize_journal,
    success,
)
from afd.cli.main import _load_surface_commands, cli  # noqa: E402
from afd.client import McpClient, McpClientConfig  # noqa: E402
from afd.core.commands import CommandContext, CommandDefinition  # noqa: E402
from afd.core.journal import JournalContextDigest, JournalEntry  # noqa: E402
from afd.direct import SimpleRegistry  # noqa: E402
from afd.server import (  # noqa: E402
    ContextField,
    IdempotencyOptions,
    IdempotencyReservationRequest,
    IdempotencySettlement,
    InMemoryIdempotencyStore,
    create_idempotency_step,
    create_retry_middleware,
    create_server,
    define_command,
)
from afd.testing.surface.validate import validate_command_surface  # noqa: E402
from afd.transports.mock import MockTransport  # noqa: E402
from tests.test_cli_surface_commands import ServerTransport  # noqa: E402

MCP = ExposeOptions(mcp=True)
AGENT = Actor(kind="agent", id="advisor")
KEY = "dev.afd/idempotencyKey"


def _command(name: str, handler: Any, **fields: Any) -> CommandDefinition:
    return CommandDefinition(name=name, description=name, handler=handler, expose=MCP, **fields)


# ═══════════════════════════════════════════════════════════════════════════════
# THE PROPOSAL'S EXIT CRITERIA
# ═══════════════════════════════════════════════════════════════════════════════


async def test_a_handler_that_outlives_its_deadline_is_not_applied_again():
    """Its effect is applied, the engine cancels it at the deadline (S7, ``cancels``), and a repeat
    with the same key is told the outcome is unknown instead of applying it a second time."""
    applied: list[str] = []
    release = asyncio.Event()

    async def place(input: Any, context: Any) -> CommandResult[Any]:
        applied.append(input["sku"])
        await release.wait()
        return success({"placed": len(applied)})

    server = create_server("orders", default_timeout_ms=None, idempotency=IdempotencyOptions())
    server.register(_command("order-place", place, mutation=True, idempotency="keyed"))
    context = CommandContext(actor=AGENT, idempotency_key="k1", timeout=30)

    first = await server.execute("order-place", {"sku": "a"}, context)
    assert first.error.code == "TIMEOUT"
    assert first.error.recovery.kind == "retry"
    repeat = await server.execute("order-place", {"sku": "a"}, context)
    release.set()
    assert repeat.error.code == "OUTCOME_UNKNOWN"
    assert repeat.error.recovery.kind == "external"
    assert applied == ["a"]


@pytest.mark.parametrize(
    ("declaration", "with_key", "with_step"),
    [
        # A `keyed` command keeps its promise through the step here (D5), so a retry with its
        # key reaches the store, which answers OUTCOME_UNKNOWN.
        ({"idempotency": "keyed"}, True, True),
        ({"idempotency": "keyed"}, False, True),
        ({"idempotency": "keyed"}, False, False),
        ({}, True, True),
        ({}, False, True),
        ({}, True, False),
        ({}, False, False),
    ],
)
async def test_a_mutation_that_returns_timeout_after_its_effect_is_applied_once(
    declaration, with_key, with_step
):
    """With the retry middleware installed, a ``keyed`` or undeclared mutation whose handler
    returns ``TIMEOUT`` after its effect is applied once, with a key and without."""
    applied = 0

    async def charge(input: Any, context: Any) -> CommandResult[Any]:
        nonlocal applied
        applied += 1
        return error("TIMEOUT", "The downstream call timed out", suggestion="Check", retryable=True)

    server = create_server(
        "payments",
        default_timeout_ms=None,
        middleware=[create_retry_middleware(retry_delay=0, max_retries=3)],
        idempotency=IdempotencyOptions() if with_step else None,
    )
    server.register(_command("payment-charge", charge, mutation=True, **declaration))
    result = await server.execute(
        "payment-charge",
        {},
        CommandContext(actor=AGENT, idempotency_key="k1" if with_key else None),
    )
    assert not result.success
    assert applied == 1


async def test_a_natural_command_is_repeated_by_design():
    runs = 0

    async def set_title(input: Any, context: Any) -> CommandResult[Any]:
        nonlocal runs
        runs += 1
        return error("TIMEOUT", "Timed out", suggestion="Retry", retryable=True)

    server = create_server(
        "titles",
        default_timeout_ms=None,
        middleware=[create_retry_middleware(retry_delay=0, max_retries=2)],
    )
    server.register(_command("title-set", set_title, mutation=True, idempotency="natural"))
    await server.execute("title-set", {}, CommandContext(actor=AGENT))
    assert runs == 3


# ═══════════════════════════════════════════════════════════════════════════════
# THE STORE (S12) AND CANCELLATION WHILE IT AWAITS (S5, S7)
# ═══════════════════════════════════════════════════════════════════════════════


def _request(now: float = 0, digest: str = "d") -> IdempotencyReservationRequest:
    return IdempotencyReservationRequest(
        digest=digest, reserved_at=now, expires_at=now + 100, lease_ends_at=now + 10
    )


def test_the_store_settles_only_its_own_reservation_and_forgets_at_expiry():
    store = InMemoryIdempotencyStore()
    made = store.reserve("s", _request(), 0)
    assert made.reserved
    held = store.reserve("s", _request(), 1)
    assert not held.reserved and held.record.state == "reserved"
    # Another reservation's identity changes nothing.
    store.complete("s", "someone-else", IdempotencySettlement("unknown"))
    store.release("s", "someone-else")
    assert store.get("s", 1).state == "reserved"
    store.complete("s", made.reservation, IdempotencySettlement("result", success({"n": 1})))
    stored = store.get("s", 100)
    assert stored.state == "stored" and stored.result.data == {"n": 1}
    # A copy: changing what a caller holds does not change what the store keeps.
    stored.result.data["n"] = 2
    assert store.get("s", 100).result.data == {"n": 1}
    assert store.get("s", 101) is None
    assert store.reserve("s", _request(101), 101).reserved


def test_the_store_sweeps_expired_records_when_it_grows():
    store = InMemoryIdempotencyStore(sweep_at=2)
    store.reserve("a", _request(0), 0)
    store.reserve("b", _request(0), 0)
    store.reserve("c", _request(200), 200)
    assert store.size == 1
    with pytest.raises(ValueError, match="sweep_at"):
        InMemoryIdempotencyStore(sweep_at=0)


class AsyncStore:
    """A host store whose methods are coroutines, and whose ``reserve`` waits to be let go."""

    def __init__(self) -> None:
        self.inner = InMemoryIdempotencyStore()
        self.entered = asyncio.Event()
        self.release_reserve = asyncio.Event()
        self.hold = False
        self.released: list[str] = []

    async def reserve(self, scope: str, request: Any, now: float) -> Any:
        if self.hold:
            self.hold = False
            self.entered.set()
            await self.release_reserve.wait()
        return self.inner.reserve(scope, request, now)

    async def complete(self, scope: str, reservation: str, settlement: Any) -> None:
        await asyncio.sleep(0)
        self.inner.complete(scope, reservation, settlement)

    async def release(self, scope: str, reservation: str) -> None:
        self.released.append(reservation)
        self.inner.release(scope, reservation)

    async def get(self, scope: str, now: float) -> Any:
        return self.inner.get(scope, now)


def _keyed_server(store: Any, handler: Any) -> Any:
    server = create_server(
        "orders", default_timeout_ms=None, idempotency=IdempotencyOptions(store=store)
    )
    server.register(_command("order-place", handler, mutation=True, idempotency="keyed"))
    return server


async def test_a_call_cancelled_while_an_async_store_reserves_leaves_no_reservation():
    store = AsyncStore()
    runs = 0

    async def place(input: Any, context: Any) -> CommandResult[Any]:
        nonlocal runs
        runs += 1
        return success({"placed": runs})

    server = _keyed_server(store, place)
    context = CommandContext(actor=AGENT, idempotency_key="k1")
    store.hold = True
    call = asyncio.ensure_future(server.execute("order-place", {}, context))
    await store.entered.wait()
    call.cancel()
    store.release_reserve.set()
    with pytest.raises(asyncio.CancelledError):
        await call
    for _ in range(5):
        await asyncio.sleep(0)
    # The reservation the store made after the call was cancelled was released, so a repeat runs.
    assert len(store.released) == 1
    repeat = await server.execute("order-place", {}, context)
    assert repeat.success and repeat.data == {"placed": 1}
    assert runs == 1


async def test_an_async_store_settles_a_result_and_answers_repeats():
    store = AsyncStore()

    async def place(input: Any, context: Any) -> CommandResult[Any]:
        return success({"placed": True})

    server = _keyed_server(store, place)
    context = CommandContext(actor=AGENT, idempotency_key="k1")
    assert (await server.execute("order-place", {}, context)).success
    replay = await server.execute("order-place", {}, context)
    assert replay.metadata.model_extra["idempotentReplay"] is True


async def test_a_handler_that_raises_leaves_the_outcome_unknown():
    async def place(input: Any, context: Any) -> CommandResult[Any]:
        raise RuntimeError("boom")

    server = _keyed_server(InMemoryIdempotencyStore(), place)
    context = CommandContext(actor=AGENT, idempotency_key="k1")
    assert (await server.execute("order-place", {}, context)).error.code == (
        "COMMAND_EXECUTION_ERROR"
    )
    assert (await server.execute("order-place", {}, context)).error.code == "OUTCOME_UNKNOWN"


async def test_the_replay_marker_is_the_engines_even_without_a_key():
    async def place(input: Any, context: Any) -> CommandResult[Any]:
        return success({}, metadata={"idempotentReplay": True, "note": "kept"})

    server = _keyed_server(InMemoryIdempotencyStore(), place)
    result = await server.execute("order-place", {}, CommandContext(actor=AGENT))
    assert "idempotentReplay" not in (result.metadata.model_extra or {})
    assert result.metadata.model_extra["note"] == "kept"


# ═══════════════════════════════════════════════════════════════════════════════
# OPTIONS AND DECLARATIONS
# ═══════════════════════════════════════════════════════════════════════════════


def test_options_are_checked_when_the_server_is_made():
    with pytest.raises(ValueError, match="ttl_ms"):
        create_server("x", idempotency=IdempotencyOptions(ttl_ms=0))
    with pytest.raises(ValueError, match="lease_ms"):
        create_server("x", idempotency=IdempotencyOptions(lease_ms=1.5))  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="reserve"):
        create_server("x", idempotency=IdempotencyOptions(store=object()))  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="IdempotencyOptions"):
        create_server("x", idempotency={"ttl_ms": 1})  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="create_idempotency_step"):
        create_command_registry(idempotency=IdempotencyOptions())


def test_an_unknown_declaration_is_refused():
    with pytest.raises(ValueError, match="natural"):
        define_command(name="thing-do", description="Does a thing", idempotency="always")  # type: ignore[arg-type]
    server = create_server("x")
    with pytest.raises(ValueError, match="keyed"):
        server.register(_command("thing-do", lambda i, c: None, idempotency="once"))


def test_idempotency_key_is_a_reserved_context_field_name():
    for name in ("idempotency_key", "idempotencyKey"):
        with pytest.raises(ValueError, match="AFD sets itself"):
            create_server(
                "x", context_fields=[ContextField(name=name, meta="dev.example/k", schema=str)]
            )


async def test_detail_and_help_report_the_declaration():
    server = create_server("orders", tool_strategy="lazy", bootstrap=True)

    @server.command(
        name="order-place",
        description="Place an order",
        mutation=True,
        idempotency="keyed",
        expose=MCP,
    )
    async def place(input: Any) -> CommandResult[Any]:
        return success({})

    @server.command(name="order-list", description="List orders", expose=MCP)
    async def listed(input: Any) -> CommandResult[Any]:
        return success([])

    detail = await server.execute("afd-detail", {"command": ["order-place", "order-list"]})
    by_name = {entry["name"]: entry for entry in detail.data}
    assert by_name["order-place"]["idempotency"] == "keyed"
    assert by_name["order-list"].get("idempotency") is None
    helped = await server.execute("afd-help", {"format": "full"})
    infos = {info.name: info for info in helped.data.commands}
    assert infos["order-place"].idempotency == "keyed"
    assert infos["order-list"].idempotency is None
    brief = await server.execute("afd-help", {})
    assert all(info.idempotency is None for info in brief.data.commands)


async def test_validate_surface_notes_an_undeclared_mutation():
    server = create_server("orders", tool_strategy="individual", bootstrap=True)
    for name, fields in {
        "order-place": {"mutation": True, "idempotency": "keyed"},
        "order-cancel": {"mutation": True},
        "order-list": {},
    }.items():
        server.register(_command(name, lambda i, c: success({}), **fields))
    # Through afd-help and afd-schema, as `afd validate --surface` reads a bootstrap server.
    commands, _, _ = await _load_surface_commands(ServerTransport(server))
    result = validate_command_surface(commands)
    assert "missing-idempotency" in result.summary.rules_evaluated
    noted = [f.commands for f in result.findings if f.rule == "missing-idempotency"]
    assert noted == [["order-cancel"]]


# ═══════════════════════════════════════════════════════════════════════════════
# REGISTRIES AND CLIENTS
# ═══════════════════════════════════════════════════════════════════════════════


async def test_a_core_registry_takes_a_step():
    runs = 0

    async def place(input: Any, context: Any) -> CommandResult[Any]:
        nonlocal runs
        runs += 1
        return success({"placed": runs})

    registry = create_command_registry(idempotency=create_idempotency_step())
    registry.register(_command("order-place", place, mutation=True, idempotency="keyed"))
    context = CommandContext(actor=AGENT, idempotency_key="k1")
    assert (await registry.execute("order-place", {}, context)).data == {"placed": 1}
    assert (await registry.execute("order-place", {}, context)).data == {"placed": 1}
    assert runs == 1


async def test_direct_client_delivers_the_key_and_derives_a_pipelines():
    seen: list[str | None] = []
    registry = SimpleRegistry(idempotency=create_idempotency_step())

    @registry.command(name="order-place", idempotency="keyed")
    async def place(sku: str = "a", *, context: Any) -> CommandResult[Any]:
        seen.append(context.idempotency_key)
        return success({"placed": len(seen)})

    client = DirectClient(registry)
    first = await client.call("order-place", {}, DirectCallContext(idempotency_key="k1"))
    again = await client.call("order-place", {}, DirectCallContext(idempotency_key="k1"))
    assert first.data == again.data == {"placed": 1}
    assert again.metadata.model_extra["idempotentReplay"] is True
    invalid = await client.call("order-place", {}, DirectCallContext(idempotency_key="k1:0"))
    assert invalid.error.code == "VALIDATION_ERROR"
    piped = await client.pipe(
        [{"command": "order-place", "input": {"sku": "a"}}, {"command": "order-place"}],
        DirectCallContext(idempotency_key="p1"),
    )
    assert piped.success
    assert seen == ["k1", "p1:step:0", "p1:step:1"]


async def test_mcp_client_sends_the_key_in_meta():
    transport = MockTransport()

    async def answer(args: dict[str, Any]) -> Any:
        return {"success": True, "data": args}

    transport.register_tool("order-place", answer)
    transport.register_tool("afd-batch", answer)
    transport.register_tool("afd-pipe", answer)
    client = McpClient(McpClientConfig(url="mock://"), transport=transport)
    await client.connect()
    try:
        await client.call("order-place", {"sku": "a"}, idempotency_key="k1")
        await client.call("order-place", {"sku": "a"})
        await client.batch([{"command": "order-place", "input": {}}], idempotency_key="b1")
        await client.pipe([{"command": "order-place"}], idempotency_key="p1")
    finally:
        await client.disconnect()
    assert [call.meta for call in transport.calls] == [
        {KEY: "k1"},
        None,
        {KEY: "b1"},
        {KEY: "p1"},
    ]


async def test_mcp_client_refuses_a_key_its_transport_cannot_send():
    class Plain:
        state = None

        async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
            raise AssertionError("nothing may be sent")

    client = McpClient(McpClientConfig(url="mock://"))
    client._transport = Plain()  # type: ignore[assignment]
    client._require_connected = lambda: None  # type: ignore[method-assign]
    refused = await client.call("order-place", {}, idempotency_key="k1")
    # Refused before dispatch: not OUTCOME_UNKNOWN, since nothing was sent.
    assert refused.error.code == "UNSUPPORTED_OPTION"
    assert "Nothing was sent" in refused.error.suggestion


def _cli_module(tmp_path: Any) -> Any:
    path = tmp_path / "commands.py"
    path.write_text(
        """from afd import create_direct_registry, success
from afd.server import IdempotencyOptions, define_command

RUNS = []

@define_command(name="order-place", description="Place an order", mutation=True,
                idempotency="keyed")
async def place(input, context):
    RUNS.append(context.idempotency_key)
    return success({"key": context.idempotency_key, "runs": len(RUNS)})

registry = create_direct_registry([place], idempotency=IdempotencyOptions())
"""
    )
    return path


def test_afd_call_sends_the_idempotency_key(tmp_path):
    path = _cli_module(tmp_path)
    result = CliRunner().invoke(
        cli, ["--json", "call", "order-place", "--module", str(path), "--idempotency-key", "k1"]
    )
    assert result.exit_code == 0, result.output
    assert json.loads(result.stdout)["data"]["key"] == "k1"


def test_afd_call_refuses_a_key_of_the_wrong_form(tmp_path):
    path = _cli_module(tmp_path)
    result = CliRunner().invoke(
        cli, ["call", "order-place", "--module", str(path), "--idempotency-key", "a:b"]
    )
    assert result.exit_code != 0
    assert "--idempotency-key" in result.output


def test_afd_call_sends_the_key_over_a_transport(monkeypatch):
    transport = MockTransport()
    transport.register_tool("order-place", lambda args: _async({"success": True, "data": {}}))
    import sys

    # `afd.cli.main` is also the name of the CLI's entry function, so take the module itself.
    monkeypatch.setattr(sys.modules["afd.cli.main"], "_get_transport", lambda *a, **k: transport)
    result = CliRunner().invoke(
        cli, ["call", "order-place", "--server", "mock", "--idempotency-key", "k1"]
    )
    assert result.exit_code == 0, result.output
    assert transport.calls[0].meta == {KEY: "k1"}


async def _async(value: Any) -> Any:
    return value


# ═══════════════════════════════════════════════════════════════════════════════
# THE JOURNAL MEMBER
# ═══════════════════════════════════════════════════════════════════════════════


def test_the_journal_member_round_trips_in_the_spec_order():
    entry = JournalEntry(
        seq=1,
        timestamp="2026-11-27T00:00:00.000Z",
        trace_id="t1",
        idempotency_key="b1:0",
        command="note-add",
        input={},
        context_digest=JournalContextDigest(hash="sha256:00"),
        result={"success": True},
        duration_ms=1,
    )
    text = serialize_journal([entry])
    assert list(json.loads(text.splitlines()[0])) == [
        "seq",
        "timestamp",
        "traceId",
        "idempotencyKey",
        "command",
        "input",
        "contextDigest",
        "result",
        "durationMs",
    ]
    [parsed] = parse_journal(text)
    assert parsed.idempotency_key == "b1:0"
    with pytest.raises(ValueError):
        parse_journal(text.replace('"b1:0"', "7"))


# ═══════════════════════════════════════════════════════════════════════════════
# THE KEY ON EVERY ROUTE (K1, K3, K6)
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("mode", ["legacy", "auto"])
async def test_an_approved_rerun_keeps_the_calls_key(mode):
    """A call held for approval and asked in band runs again once approved: with its key."""
    from mcp import Client

    from tests.test_approval_relay import _answer, _gated_server

    seen: list[str | None] = []
    server, approve = _gated_server(tool_strategy="individual")

    @server.command(
        name="todo-clear",
        description="Delete every todo",
        mutation=True,
        approval="required",
        expose=MCP,
    )
    async def clear(input: Any, context: CommandContext) -> CommandResult[Any]:
        seen.append(context.idempotency_key)
        return success({"cleared": True})

    approve(relay="mcp-elicitation", include_token=False)
    async with Client(
        server._create_mcp_server(), mode=mode, elicitation_callback=_answer([], "accept")
    ) as client:
        result = await client.call_tool("todo-clear", {}, meta={KEY: "k1"})
    assert json.loads(result.content[0].text)["success"] is True
    assert seen == ["k1"]


async def test_a_host_verified_command_gets_the_calls_key():
    from afd.server.human_relay import RELAY_INPUT_KEY
    from tests.test_human_relay import _http_call, _ScriptedRelay

    seen: list[str | None] = []
    server = create_server("hv", tool_strategy="individual", human_relay=_ScriptedRelay())

    @server.command(
        name="wire-send",
        description="Send a wire",
        mutation=True,
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send(input: Any, context: CommandContext) -> CommandResult[Any]:
        seen.append(context.idempotency_key)
        return success({"sent": True})

    meta = {KEY: "k1"}
    first = await _http_call(server, "wire-send", {}, extra_meta=meta)
    second = await _http_call(
        server,
        "wire-send",
        {},
        request_state=first["result"]["requestState"],
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
        extra_meta=meta,
    )
    assert json.loads(second["result"]["content"][0]["text"])["success"] is True
    assert seen == ["k1"]


async def test_a_key_the_context_hook_sets_wins_over_meta():
    from tests.test_human_relay import _http_call

    seen: list[str | None] = []

    def hook(request: Any, context: CommandContext) -> CommandContext:
        context.idempotency_key = "hostkey"
        return context

    server = create_server("hook", tool_strategy="individual", context_hook=hook)

    @server.command(name="note-add", description="Add a note", mutation=True, expose=MCP)
    async def add(input: Any, context: CommandContext) -> CommandResult[Any]:
        seen.append(context.idempotency_key)
        return success({})

    await _http_call(server, "note-add", {}, extra_meta={KEY: "k1"})
    await _http_call(server, "note-add", {})
    assert seen == ["hostkey", "hostkey"]


async def test_a_nested_direct_client_call_starts_without_the_key():
    seen: list[tuple[str, str | None]] = []
    registry = SimpleRegistry()
    client = DirectClient(registry)

    @registry.command(name="inner-run")
    async def inner(*, context: Any) -> CommandResult[Any]:
        seen.append(("inner", context.idempotency_key))
        return success({})

    @registry.command(name="outer-run")
    async def outer(*, context: Any) -> CommandResult[Any]:
        seen.append(("outer", context.idempotency_key))
        await client.call("inner-run", {}, context)
        return success({})

    assert (await client.call("outer-run", {}, DirectCallContext(idempotency_key="k1"))).success
    assert seen == [("outer", "k1"), ("inner", None)]


async def test_a_dict_context_is_never_marked():
    runs: list[Any] = []

    async def place(input: Any, context: Any) -> CommandResult[Any]:
        runs.append(context["idempotency_key"])
        return success({"n": len(runs)})

    registry = create_command_registry(idempotency=create_idempotency_step())
    registry.register(_command("order-place", place, mutation=True, idempotency="keyed"))
    context = {"idempotency_key": "k1"}
    await registry.execute("order-place", {}, context)
    repeat = await registry.execute("order-place", {}, context)
    assert context == {"idempotency_key": "k1"}
    assert repeat.metadata.model_extra["idempotentReplay"] is True
    assert runs == ["k1"]


async def test_an_anonymous_caller_without_a_connection_is_refused():
    """The SDK's in-process client on 2026-07-28 dispatches without a connection, so an anonymous
    caller cannot be told apart from another (S3)."""
    from mcp import Client

    async def place(input: Any, context: Any) -> CommandResult[Any]:
        return success({})

    server = create_server("orders", tool_strategy="individual", idempotency=IdempotencyOptions())
    server.register(_command("order-place", place, mutation=True, idempotency="keyed"))
    async with Client(server._create_mcp_server()) as client:
        refused = json.loads(
            (await client.call_tool("order-place", {}, meta={KEY: "k1"})).content[0].text
        )
        plain = json.loads((await client.call_tool("order-place", {})).content[0].text)
    assert refused["error"]["code"] == "UNAUTHORIZED"
    assert plain["success"] is True


async def test_a_command_a_middleware_runs_during_the_call_starts_without_the_key():
    from mcp import Client
    from mcp.client._memory import InMemoryTransport

    seen: list[tuple[str, str | None]] = []

    async def nest(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        if name == "outer-run":
            await server.call_tool("inner-run", {})
        return await next_fn()

    server = create_server("k6", tool_strategy="individual", middleware=[nest])

    @server.command(name="inner-run", description="Run the inner step", expose=MCP)
    async def inner(input: Any, context: CommandContext) -> CommandResult[Any]:
        seen.append(("inner", context.idempotency_key))
        return success({})

    @server.command(name="outer-run", description="Run the outer step", expose=MCP)
    async def outer(input: Any, context: CommandContext) -> CommandResult[Any]:
        seen.append(("outer", context.idempotency_key))
        await server.call_tool("inner-run", {})
        return success({})

    async with Client(InMemoryTransport(server._create_mcp_server())) as client:
        await client.call_tool("outer-run", {}, meta={KEY: "k1"})
    assert seen == [("inner", None), ("outer", "k1"), ("inner", None)]


async def test_a_pipeline_a_handler_runs_on_its_context_starts_without_the_key():
    seen: list[tuple[str, str | None]] = []
    registry = SimpleRegistry()
    client = DirectClient(registry)

    @registry.command(name="inner-run")
    async def inner(*, context: Any) -> CommandResult[Any]:
        seen.append(("inner", context.idempotency_key))
        return success({})

    @registry.command(name="outer-run")
    async def outer(*, context: Any) -> CommandResult[Any]:
        seen.append(("outer", context.idempotency_key))
        await client.pipe([{"command": "inner-run", "input": {}}], context=context)
        return success({})

    assert (await client.call("outer-run", {}, DirectCallContext(idempotency_key="k1"))).success
    assert seen == [("outer", "k1"), ("inner", None)]


def test_the_scope_binds_only_admitted_credentials_behind_an_auth_layer(monkeypatch):
    """Behind AFD's auth layer the step binds what it admitted, never the SDK's token (K5, M8),
    as the approver's principal binding does."""
    from afd.server import idempotency_lane

    sdk = object()
    monkeypatch.setattr(idempotency_lane, "sdk_credentials", lambda: sdk)
    bare = CommandContext()
    assert idempotency_lane.idempotency_credentials(bare, auth_layer=True) is None
    assert idempotency_lane.idempotency_credentials(bare) is sdk
    admitted = object()
    with_admitted = CommandContext()
    object.__setattr__(with_admitted, "credentials", admitted)
    assert idempotency_lane.idempotency_credentials(with_admitted, auth_layer=True) is admitted


def test_behind_an_auth_layer_the_sdk_token_does_not_identify_an_http_caller(monkeypatch):
    """S3: behind AFD's auth layer only admitted credentials identify an HTTP caller."""
    from types import SimpleNamespace

    from afd.server import idempotency_lane

    monkeypatch.setattr(idempotency_lane, "sdk_access_token", lambda: "sdk-token")
    step = object()
    http = SimpleNamespace(request=object())
    bare = idempotency_lane.idempotency_caller(step, http, None, None, False, auth_layer=True)
    assert bare is not None and bare.identified is False
    plain = idempotency_lane.idempotency_caller(step, http, None, None, False)
    assert plain is not None and plain.identified is True
    admitted = idempotency_lane.idempotency_caller(
        step, http, None, object(), False, auth_layer=True
    )
    assert admitted is not None and admitted.identified is True


async def _two_connections_with(actor: Actor) -> tuple[list[dict[str, Any]], int]:
    """Two stdio connections to a server whose middleware sets ``actor``, each calling a keyed
    command with one key: the two answers and how often the handler ran."""
    from mcp import Client
    from mcp.client._memory import InMemoryTransport

    from tests.test_idempotency_vectors import tool_value

    runs = 0

    async def authenticate(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        context.actor = actor
        return await next_fn()

    server = create_server(
        "s3-after-middleware",
        tool_strategy="individual",
        middleware=[authenticate],
        idempotency=IdempotencyOptions(),
    )

    @server.command(
        name="order-place",
        description="Place an order",
        mutation=True,
        idempotency="keyed",
        expose=MCP,
    )
    async def place(input: Any, context: CommandContext) -> CommandResult[Any]:
        nonlocal runs
        runs += 1
        return success({"placed": runs})

    sdk = server._create_mcp_server()
    answers = []
    async with Client(InMemoryTransport(sdk)) as first, Client(InMemoryTransport(sdk)) as second:
        for client in (first, second):
            answers.append(tool_value(await client.call_tool("order-place", {}, meta={KEY: "k1"})))
    return answers, runs


async def test_an_actor_a_middleware_sets_scopes_the_key_not_the_stdio_connection():
    """S3 and K5: decided from the context as middleware left it, so two connections whose
    middleware names one actor share the key."""
    answers, runs = await _two_connections_with(Actor(kind="agent", id="advisor"))
    assert answers[0]["success"] is True
    assert answers[1]["metadata"]["idempotentReplay"] is True
    assert runs == 1


async def test_a_label_alone_does_not_share_a_key_across_stdio_connections():
    """S3: M8 binds no label, so an agent with only a label is anonymous and its keys stay with
    its connection."""
    answers, runs = await _two_connections_with(Actor(kind="agent", label="helper"))
    assert all(answer["success"] is True for answer in answers)
    assert "idempotentReplay" not in (answers[1].get("metadata") or {})
    assert runs == 2


async def test_without_a_connection_a_hooks_bare_agent_is_refused_before_confirmation():
    """S3 with spec/dispatch.md: on a request with no connection, a caller the hook leaves
    anonymous (a bare agent names no one) is refused with K2, before the handler; one the hook
    names is scoped by its principal binding."""
    from mcp import Client

    from tests.test_idempotency_vectors import tool_value

    async def served(actor: Actor) -> tuple[list[dict[str, Any]], int]:
        runs = 0

        def hook(_request: Any, context: CommandContext) -> CommandContext:
            context.actor = actor
            return context

        server = create_server(
            "s3-no-connection",
            tool_strategy="individual",
            context_hook=hook,
            idempotency=IdempotencyOptions(),
        )

        @server.command(
            name="order-place",
            description="Place an order",
            mutation=True,
            idempotency="keyed",
            expose=MCP,
        )
        async def place(input: Any, context: CommandContext) -> CommandResult[Any]:
            nonlocal runs
            runs += 1
            return success({"placed": runs})

        async with Client(server._create_mcp_server()) as client:
            answers = [
                tool_value(await client.call_tool("order-place", {}, meta={KEY: "k1"}))
                for _ in range(2)
            ]
        return answers, runs

    bare, bare_runs = await served(Actor(kind="agent", label="helper"))
    assert [answer["error"]["code"] for answer in bare] == ["UNAUTHORIZED", "UNAUTHORIZED"]
    assert bare_runs == 0
    named, named_runs = await served(Actor(kind="agent", id="advisor"))
    assert named[1]["metadata"]["idempotentReplay"] is True
    assert named_runs == 1
