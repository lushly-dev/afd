"""The language-neutral vectors in spec/vectors/app-calls.json.

App-to-app calls and the ``apps`` exposure flag (spec/command-metadata.md, "App-to-app calls";
Loam phase 5, step 0b; #1513): verified against both the core ``CommandRegistry`` and
``MCPServer``'s in-process path, plus batch execution, middleware ordering, ``DirectCommandRegistry``
refusal and journal replay.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from afd.core.commands import (
    DEFAULT_EXPOSE,
    CallGrant,
    CommandContext,
    CommandDefinition,
    ExposeOptions,
    _CommandRegistryImpl,
    create_command_registry,
)
from afd.core.errors import ErrorCodes
from afd.core.journal import MemoryJournalSink
from afd.core.result import CommandResult, success
from afd.core.wire import to_wire
from afd.direct import (
    DirectCallContext,
    create_direct_client,
    create_direct_registry,
    create_registry,
)
from afd.server import ContextField, create_journal_middleware, create_server, define_command
from afd.server.factory import MCPServer, ServerConfig
from afd.server.journal import replay_journal

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "app-calls.json").read_text(
        encoding="utf-8"
    )
)


def _call_grant_for(grant: str) -> CallGrant | None:
    grants: dict[str, list[str]] = VECTORS["registry"]["grants"]
    if grant == "none":
        return None
    if grant == "throws":

        def _boom(_name: str, _context: CommandContext) -> bool:
            raise RuntimeError("the grant store is unreachable")

        return _boom
    if grant == "grants":

        def _check(name: str, context: CommandContext) -> bool:
            caller = context.extra.get("caller")
            return isinstance(caller, str) and name in grants.get(caller, ())

        return _check
    raise ValueError(f"unknown grant mode: {grant}")


def _make_expose(raw: dict[str, Any] | None) -> ExposeOptions:
    if raw is None:
        return DEFAULT_EXPOSE
    return ExposeOptions(**raw)


def _core_registry(grant: str):
    registry = create_command_registry(call_grant=_call_grant_for(grant))
    input_schema = VECTORS["registry"]["input"]
    for spec in VECTORS["registry"]["commands"]:
        name = spec["name"]
        expose = _make_expose(spec["expose"])

        async def _handler(
            input_data: Any,
            _context: CommandContext | None = None,
            *,
            _name: str = name,
        ) -> CommandResult[Any]:
            by = input_data.get("by", 1) if isinstance(input_data, dict) else 1
            return success({"command": _name, "by": by})

        registry.register(
            CommandDefinition(
                name=name,
                description=f"The fixture command {name}",
                input_schema=input_schema,
                expose=expose,
                handler=_handler,
            )
        )
    return registry


def _server_for(grant: str, *, middleware: list[Any] | None = None):
    server = create_server(
        "app-calls-fixture",
        call_grant=_call_grant_for(grant),
        middleware=middleware,
        context_fields=[ContextField(name="caller", meta="dev.example/caller", schema=str)],
    )
    input_schema = VECTORS["registry"]["input"]
    for spec in VECTORS["registry"]["commands"]:
        name = spec["name"]
        expose = _make_expose(spec["expose"])

        @server.command(
            name=name,
            description=f"The fixture command {name}",
            input_schema=input_schema,
            expose=expose,
        )
        async def _handler(
            input_data: Any,
            _context: CommandContext | None = None,
            *,
            _name: str = name,
        ) -> CommandResult[Any]:
            by = input_data.get("by", 1) if isinstance(input_data, dict) else 1
            return success({"command": _name, "by": by})

    return server


def _context_for(interface: str | None, caller: str | None) -> CommandContext | None:
    extra: dict[str, Any] = {}
    if interface is not None:
        extra["interface"] = interface
    if caller is not None:
        extra["caller"] = caller
    return CommandContext(extra=extra) if extra else None


def _check(result: CommandResult[Any], expected: dict[str, Any]) -> None:
    wire = to_wire(result)
    if expected.get("refused") is True:
        assert wire["success"] is False
        assert wire["error"] == VECTORS["refusal"]
        assert "data" not in wire
    elif "code" in expected:
        assert wire["success"] is False
        assert wire["error"]["code"] == expected["code"]
    else:
        assert wire["success"] is True, wire
        assert wire["data"] == expected["data"]


def test_refusal_code_and_no_gaps():
    assert VECTORS["gaps"] == {}
    assert VECTORS["refusal"]["code"] == ErrorCodes.CALL_NOT_GRANTED
    assert DEFAULT_EXPOSE.apps is False


@pytest.mark.parametrize("case", VECTORS["exposure"], ids=lambda case: case["description"])
def test_exposure(case):
    expose = _make_expose(case["expose"])
    server = create_server("exposure-check")
    cmd = CommandDefinition(
        name="tally-get",
        description="Read the count",
        expose=None if case["expose"] is None else expose,
        handler=lambda _inp, _ctx=None: success({}),  # type: ignore[arg-type]
    )
    for surface, expected in case["exposed"].items():
        assert getattr(expose, surface) is expected, surface
        assert server._is_exposed_to(cmd, surface) is expected, surface


@pytest.mark.asyncio
@pytest.mark.parametrize("case", VECTORS["calls"], ids=lambda case: case["description"])
async def test_calls_on_core_registry(case):
    call = case["call"]
    registry = _core_registry(case["grant"])
    result = await registry.execute(
        call["name"],
        call["input"],
        _context_for(call.get("interface"), call.get("caller")),
    )
    _check(result, case["expect"])


@pytest.mark.asyncio
@pytest.mark.parametrize("case", VECTORS["calls"], ids=lambda case: case["description"])
async def test_calls_on_server(case):
    call = case["call"]
    server = _server_for(case["grant"])
    result = await server.execute(
        call["name"],
        call["input"],
        _context_for(call.get("interface"), call.get("caller")),
    )
    _check(result, case["expect"])


@pytest.mark.asyncio
@pytest.mark.parametrize("case", VECTORS["batches"], ids=lambda case: case["description"])
async def test_batches_on_server(case):
    server = _server_for(case["grant"])
    payload: dict[str, Any] = {
        "commands": [
            {"command": item["command"], "input": item["input"]} for item in case["items"]
        ]
    }
    if "requestContext" in case:
        payload["context"] = case["requestContext"]
    batch = await server._execute_batch(
        payload,
        _context_for(case.get("interface"), case.get("caller")),
    )
    assert len(batch.results) == len(case["expect"])
    for entry, expected in zip(batch.results, case["expect"], strict=True):
        _check(entry.result, expected)


def test_list_by_exposure_apps():
    registry = _core_registry("none")
    assert [cmd.name for cmd in registry.list_by_exposure("apps")] == ["tally-get"]
    server = _server_for("none")
    assert [cmd.name for cmd in server.list_exposed_commands(interface="apps")] == ["tally-get"]


@pytest.mark.asyncio
async def test_truthy_non_bool_grant_is_refused():
    registry = create_command_registry(call_grant=lambda _name, _ctx: "yes")  # type: ignore[arg-type,return-value]

    async def _ok(_inp: Any, _ctx: Any = None) -> CommandResult[Any]:
        return success({})

    registry.register(
        CommandDefinition(
            name="tally-get",
            description="Read the count",
            expose=ExposeOptions(apps=True),
            handler=_ok,
        )
    )
    result = await registry.execute("tally-get", {}, CommandContext(extra={"interface": "apps"}))
    _check(result, {"refused": True})


@pytest.mark.asyncio
async def test_refusal_precedes_middleware_and_meta_tools():
    seen: list[tuple[str, Any, Any]] = []

    async def _mw(name: str, _input: Any, context: CommandContext, next_fn: Any) -> CommandResult:
        seen.append((name, context.extra.get("interface"), context.extra.get("caller")))
        return await next_fn()

    server = _server_for("grants", middleware=[_mw])
    ok = await server.execute("tally-get", {}, _context_for("apps", "checklist"))
    assert ok.success is True
    denied = await server.execute("tally-get", {}, _context_for("apps", "hello"))
    _check(denied, {"refused": True})
    meta = await server.execute("afd-call", {"command": "tally-get"}, _context_for("apps", "checklist"))
    _check(meta, {"refused": True})
    assert seen == [("tally-get", "apps", "checklist")]


def test_direct_registry_refuses_apps_interface():
    @define_command(name="tally-get", description="Read", expose=ExposeOptions(apps=True))
    async def tally_get(_input: Any) -> CommandResult[Any]:
        return success({})

    with pytest.raises(ValueError, match="interface='apps'"):
        create_direct_registry([tally_get], interface="apps")


@pytest.mark.asyncio
async def test_replay_checks_grant_again_and_cannot_be_downgraded():
    granted = True
    ran: list[str] = []
    sink = MemoryJournalSink()

    def _build(with_journal: bool):
        server = create_server(
            "apps-replay",
            call_grant=lambda name, ctx: granted
            and name == "tally-get"
            and ctx.extra.get("caller") == "checklist",
            context_fields=[ContextField(name="caller", meta="dev.example/caller", schema=str, journal=True)],
            middleware=[create_journal_middleware(sink)] if with_journal else [],
        )

        @server.command(
            name="tally-get",
            description="Read the count",
            expose=ExposeOptions(apps=True),
        )
        async def _tally_get(_input: Any) -> CommandResult[Any]:
            ran.append("tally-get")
            return success({"by": 1})

        return server

    first = await _build(True).execute(
        "tally-get", {}, CommandContext(extra={"interface": "apps", "caller": "checklist"})
    )
    assert first.success is True
    entries = await sink.read()
    assert entries[0].context_digest.interface == "apps"
    assert ran == ["tally-get"]

    # Replayed while granted: matches.
    same = await replay_journal(_build(False), entries)
    assert same.same == 1 and not same.diverged
    assert ran == ["tally-get", "tally-get"]

    # Grant revoked: replay refuses with CALL_NOT_GRANTED and does not run the handler.
    granted = False
    revoked = await replay_journal(_build(False), entries)
    assert revoked.different == 1
    _check(revoked.entries[0].replayed, {"refused": True})
    assert ran == ["tally-get", "tally-get"]

    # Replay context option cannot downgrade an apps entry to agent.
    for override in ({"interface": "agent"}, {"extra": {"interface": "agent"}}):
        downgraded = await replay_journal(_build(False), entries, context=override)
        assert downgraded.different == 1
        _check(downgraded.entries[0].replayed, {"refused": True})
        assert ran == ["tally-get", "tally-get"]

    # Replay snapshots entry.context_digest.interface BEFORE calling a context callback,
    # so mutating the entry inside the callback cannot bypass grant checking or target refusal.
    def _mutating_context(entry: Any) -> dict[str, Any]:
        if entry.context_digest is not None:
            entry.context_digest.interface = "agent"
        return {"interface": "agent"}

    mutated = await replay_journal(
        _build(False), copy.deepcopy(entries), context=_mutating_context
    )
    assert mutated.different == 1
    _check(mutated.entries[0].replayed, {"refused": True})
    assert ran == ["tally-get", "tally-get"]

    # A subclass overriding execute() (or an instance monkey-patching execute) is refused
    # even though it inherits from MCPServer or _CommandRegistryImpl.
    override_ran: list[str] = []

    class BypassServer(MCPServer):
        async def execute(self, name: str, input: Any, context: Any = None, **_kw: Any) -> Any:
            override_ran.append(f"server:{name}")
            return success({"by": 1})

    class BypassRegistry(_CommandRegistryImpl):
        async def execute(self, name: str, input: Any, context: Any = None, **_kw: Any) -> Any:
            override_ran.append(f"registry:{name}")
            return success({"by": 1})

    for target in (BypassServer(ServerConfig(name="bypass")), BypassRegistry()):
        report = await replay_journal(target, copy.deepcopy(entries))
        assert report.errors == 1
        assert "cannot check against a grant" in (report.entries[0].error or "")
    assert override_ran == []


@pytest.mark.asyncio
async def test_direct_surfaces_refuse_apps_context_before_lookup_or_allow():
    ran: list[str] = []

    @define_command(
        name="agent-only",
        description="Exposed to agent, not apps",
        expose=ExposeOptions(agent=True, apps=False),
    )
    async def agent_only(_input: Any) -> CommandResult[Any]:
        ran.append("agent-only")
        return success({"ok": True})

    simple = create_registry()
    simple.register("agent-only", lambda: (ran.append("simple"), success({"ok": True}))[1])
    direct_reg = create_direct_registry([agent_only])
    mw_called: list[str] = []

    async def _mw(name: str, _args: Any, _ctx: Any, nxt: Any) -> Any:
        mw_called.append(name)
        return await nxt()

    client_on_direct = create_direct_client(
        direct_reg, allow=lambda _n: False, middleware=[_mw]
    )
    client_on_simple = create_direct_client(simple, allow=lambda _n: False, middleware=[_mw])

    apps_ctx = CommandContext(extra={"interface": "apps"})
    apps_call_ctx = DirectCallContext(extra={"interface": "apps"})

    for target_name in ("agent-only", "missing-cmd"):
        _check(await simple.execute(target_name, {}, apps_ctx), {"refused": True})
        _check(await direct_reg.execute(target_name, {}, apps_ctx), {"refused": True})
        _check(
            await client_on_direct.call(target_name, {}, apps_call_ctx, output_budget="bad"),
            {"refused": True},
        )
        _check(
            await client_on_simple.call(target_name, {}, apps_call_ctx, output_budget="bad"),
            {"refused": True},
        )
        pipe_res = await client_on_direct.pipe(
            [{"command": target_name, "input": {}}], apps_call_ctx, output_budget="bad"
        )
        assert pipe_res.success is False
        _check(pipe_res.final, {"refused": True})

    assert ran == []
    assert mw_called == []


@pytest.mark.asyncio
async def test_route_tool_call_refuses_apps_caller_context():
    ran: list[str] = []
    server = create_server("apps-router")

    @server.command(
        name="mcp-open",
        description="Exposed to MCP only",
        expose=ExposeOptions(mcp=True, apps=False),
    )
    async def mcp_open(_input: Any) -> CommandResult[Any]:
        ran.append("mcp-open")
        return success({"ok": True})

    apps_ctx = CommandContext(extra={"interface": "apps"})
    call_res = await server.route_tool_call(
        "afd-call", {"command": "mcp-open", "input": {}}, caller_context=apps_ctx
    )
    _check(call_res, {"refused": True})

    direct_res = await server.route_tool_call("mcp-open", {}, caller_context=apps_ctx)
    _check(direct_res, {"refused": True})

    batch_res = await server.route_tool_call(
        "afd-batch",
        {"commands": [{"command": "mcp-open", "input": {}}]},
        caller_context=apps_ctx,
    )
    assert batch_res.success is False
    assert batch_res.error is not None
    assert to_wire(batch_res.error) == VECTORS["refusal"]

    pipe_res = await server.route_tool_call(
        "afd-pipe",
        {"steps": [{"command": "mcp-open", "input": {}}]},
        caller_context=apps_ctx,
    )
    assert len(pipe_res.steps) == 1
    assert pipe_res.steps[0].error is not None
    assert to_wire(pipe_res.steps[0].error) == VECTORS["refusal"]
    assert ran == []


@pytest.mark.asyncio
async def test_ungranted_app_refusal_precedes_hybrid_config_diagnostic_and_single_grant_eval():
    # Misconfigured hybrid server naming an unregistered or private (non-MCP) command:
    # ungranted apps callers must get the fixed refusal rather than a ValueError naming it.
    hybrid = create_server(
        "bad-hybrid",
        tool_strategy="hybrid",
        first_class_tools=["private-cmd"],
    )

    async def _private(_input: Any, _ctx: Any = None) -> CommandResult[Any]:
        return success({})

    hybrid._registry.register(
        CommandDefinition(
            name="private-cmd",
            description="Private command",
            expose=ExposeOptions(mcp=False, apps=False),
            handler=_private,
        )
    )

    refused = await hybrid.execute(
        "private-cmd", {}, CommandContext(extra={"interface": "apps"})
    )
    _check(refused, {"refused": True})
    routed_refused = await hybrid.route_tool_call(
        "afd-call",
        {"command": "private-cmd"},
        caller_context=CommandContext(extra={"interface": "apps"}),
    )
    _check(routed_refused, {"refused": True})

    # The host still receives the hybrid configuration diagnostic.
    with pytest.raises(ValueError, match="private-cmd"):
        await hybrid.execute("private-cmd", {})

    # A stateful one-use call_grant is evaluated once per granted MCPServer.execute call.
    remaining = 1

    def one_shot(_name: str, _ctx: CommandContext) -> bool:
        nonlocal remaining
        remaining -= 1
        return remaining >= 0

    one_shot_server = create_server("one-shot", call_grant=one_shot)

    @one_shot_server.command(
        name="tally-get",
        description="Read",
        expose=ExposeOptions(apps=True),
    )
    async def tally_get(_input: Any) -> CommandResult[Any]:
        return success({"by": 1})

    first = await one_shot_server.execute(
        "tally-get", {}, CommandContext(extra={"interface": "apps"})
    )
    assert first.success is True
    second = await one_shot_server.execute(
        "tally-get", {}, CommandContext(extra={"interface": "apps"})
    )
    _check(second, {"refused": True})


def test_non_callable_call_grant_rejected_at_construction():
    with pytest.raises(TypeError, match="call_grant"):
        create_command_registry(call_grant="nope")  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="call_grant"):
        create_server("bad-grant", call_grant="nope")  # type: ignore[arg-type]
