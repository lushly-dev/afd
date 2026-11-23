"""Tests for command ``tool_meta`` (T1–T3) and ``advertised_input_schema`` (V1–V2)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from afd import ExposeOptions, create_command_registry, success
from afd.core.commands import CommandDefinition, command_to_mcp_tool
from afd.core.meta_keys import assert_advertised_input_schema, assert_tool_meta, check_meta_entry
from afd.server import create_server, define_command

MCP = ExposeOptions(mcp=True)

SPEC_VECTORS = Path(__file__).resolve().parents[2] / "spec" / "vectors" / "mcp-resources.json"


def _load_vectors() -> dict[str, Any]:
    return json.loads(SPEC_VECTORS.read_text(encoding="utf-8"))


def test_spec_tool_meta_key_vectors():
    vectors = _load_vectors()
    for case in vectors["toolMetaKeys"]:
        key = case["key"]
        value = case["value"]
        allowed = case["allowed"]
        reason = check_meta_entry(key, value, allow_ui=True)
        if allowed:
            assert reason is None, f"expected key {key!r} with {value!r} to be allowed, got: {reason}"
            assert_tool_meta("demo-cmd", {key: value})
        else:
            assert reason is not None, f"expected key {key!r} with {value!r} to be refused"
            with pytest.raises(ValueError, match="demo-cmd"):
                assert_tool_meta("demo-cmd", {key: value})


def test_tool_meta_rejects_non_json_values_and_case_insensitive_reserved_prefixes():
    with pytest.raises(ValueError, match="demo-cmd"):
        assert_tool_meta("demo-cmd", {"com.example/nan": float("nan")})
    with pytest.raises(ValueError, match="demo-cmd"):
        assert_tool_meta("demo-cmd", {"com.example/obj": object()})
    with pytest.raises(ValueError, match="demo-cmd"):
        assert_tool_meta("demo-cmd", {"DEV.AFD/custom": 1})
    with pytest.raises(ValueError, match="demo-cmd"):
        assert_tool_meta("demo-cmd", {"IO.ModelContextProtocol/x": 1})
    with pytest.raises(ValueError, match="demo-cmd"):
        assert_tool_meta("demo-cmd", {"dev.MCP/x": 1})


def test_tool_meta_rejected_at_define_and_registry_registration():
    with pytest.raises(ValueError, match="bad-cmd"):

        @define_command(
            name="bad-cmd",
            description="Invalid tool_meta",
            tool_meta={"dev.afd/secret": True},
        )
        async def _bad(_input: Any) -> Any:
            return success({})

    registry = create_command_registry()

    async def _handler(_input: Any, _ctx: Any = None) -> Any:
        return success({})

    with pytest.raises(ValueError, match="bad-reg"):
        registry.register(
            CommandDefinition(
                name="bad-reg",
                description="Invalid via registry",
                handler=_handler,
                tool_meta={"approval": "required"},
            )
        )


async def test_tool_meta_emitted_across_strategies_and_detail_never_on_meta_or_group():
    extra = {
        "dev.umbel/origin": {"plugin": "hello", "kind": "compiled"},
        "ui": {"resourceUri": "ui://hello/view.html", "visibility": ["model", "app"]},
    }

    for strategy in ("individual", "grouped", "hybrid", "lazy"):
        kwargs: dict[str, Any] = {"tool_strategy": strategy}
        if strategy == "hybrid":
            kwargs["first_class_tools"] = ["hello-greet"]
        server = create_server("meta-test", **kwargs)

        @server.command(
            name="hello-greet",
            description="Greet a person",
            category="hello",
            expose=MCP,
            tool_meta=extra,
        )
        async def greet(_input: Any) -> Any:
            return success({"ok": True})

        tools = {tool["name"]: tool for tool in server.get_tool_definitions()}

        # Meta-tools never carry extra tool_meta.
        for meta_name in ("afd-discover", "afd-detail", "afd-call", "afd-batch", "afd-pipe"):
            assert "_meta" not in tools[meta_name]

        if strategy in ("individual", "hybrid"):
            meta = tools["hello-greet"]["_meta"]
            assert meta["dev.umbel/origin"] == extra["dev.umbel/origin"]
            assert meta["ui"] == extra["ui"]
            assert meta["category"] == "hello"
        elif strategy == "grouped":
            group = tools["hello"]
            # Grouped tool itself has only _meta.actions, never command tool_meta keys at top level.
            assert set(group["_meta"].keys()) == {"actions"}
            action_entry = group["_meta"]["actions"][0]
            assert action_entry["dev.umbel/origin"] == extra["dev.umbel/origin"]
            assert action_entry["ui"] == extra["ui"]

        # afd-detail returns toolMeta on every strategy.
        detail = await server.call_tool("afd-detail", {"command": "hello-greet"})
        assert detail.success is True
        assert detail.data[0]["toolMeta"] == extra


def test_tool_meta_empty_dict_omitted():
    async def _handler(_input: Any, _ctx: Any = None) -> Any:
        return success({})

    cmd_empty = CommandDefinition(name="plain-cmd", description="Plain", handler=_handler, tool_meta={})
    cmd_none = CommandDefinition(name="plain-cmd", description="Plain", handler=_handler)
    assert command_to_mcp_tool(cmd_empty) == command_to_mcp_tool(cmd_none)


def test_advertised_input_schema_validation_rules():
    assert_advertised_input_schema("ok-cmd", None)
    assert_advertised_input_schema("ok-cmd", {"type": "object", "properties": {}})

    for bad in ("not-a-dict", [], {"type": "string"}, {"properties": {}}, {"type": "object", "x": float("nan")}):
        with pytest.raises(ValueError, match="bad-schema"):
            assert_advertised_input_schema("bad-schema", bad)  # type: ignore[arg-type]


async def test_advertised_input_schema_surfaces_and_runtime_validation():
    # Advertised schema uses JSON Schema keywords AFD's runtime validator refuses ($ref / oneOf).
    advertised = {
        "type": "object",
        "$defs": {"Item": {"type": "string"}},
        "properties": {
            "name": {"$ref": "#/$defs/Item", "description": "Person to greet"},
            "free": True,
            "count": {"type": ["integer", "null"], "description": "Optional count"},
        },
        "required": ["name"],
    }
    validation = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 2},
        },
        "required": ["name"],
    }

    for strategy in ("individual", "grouped", "hybrid", "lazy"):
        kwargs: dict[str, Any] = {"tool_strategy": strategy, "bootstrap": True}
        if strategy == "hybrid":
            kwargs["first_class_tools"] = ["wrap-greet"]
        server = create_server("schema-test", **kwargs)

        @server.command(
            name="wrap-greet",
            description="Wrapped command",
            category="wrap",
            expose=MCP,
            input_schema=validation,
            advertised_input_schema=advertised,
        )
        async def wrap_greet(inp: dict[str, Any]) -> Any:
            return success({"greeted": inp["name"]})

        tools = {tool["name"]: tool for tool in server.get_tool_definitions()}
        if strategy in ("individual", "hybrid"):
            assert tools["wrap-greet"]["inputSchema"] == advertised
        elif strategy == "grouped":
            action = tools["wrap"]["_meta"]["actions"][0]
            assert action["inputSchema"] == advertised

        # afd-detail, afd-schema (json & typescript), afd-docs all show the advertised schema.
        detail = await server.call_tool("afd-detail", {"command": "wrap-greet"})
        assert detail.data[0]["inputSchema"] == advertised

        schema_res = await server.execute("afd-schema", {"format": "json"})
        by_name = {item.name: item for item in schema_res.data.schemas}
        assert by_name["wrap-greet"].input_schema == advertised

        ts_res = await server.execute("afd-schema", {"format": "typescript"})
        assert ts_res.success is True
        ts_by_name = {item.name: item for item in ts_res.data.schemas}
        assert "free?: unknown;" in (ts_by_name["wrap-greet"].typescript or "")
        assert "count?: number | null;" in (ts_by_name["wrap-greet"].typescript or "")

        docs_res = await server.execute("afd-docs", {"command": "wrap-greet"})
        md = docs_res.data.markdown
        assert "Person to greet" in md
        assert "number | null" in md
        assert "free" in md
        assert "minLength" not in md

        # Runtime calls validate against the validation schema (minLength: 2), not advertised!
        too_short = await server.call_tool("afd-call", {"command": "wrap-greet", "input": {"name": "x"}})
        assert too_short.success is False
        assert too_short.error.code == "VALIDATION_ERROR"

        valid = await server.call_tool("afd-call", {"command": "wrap-greet", "input": {"name": "Ada"}})
        assert valid.success is True
        assert valid.data == {"greeted": "Ada"}


def test_advertised_schema_allows_deep_nesting_and_snapshots_metadata():
    # 35 nested object levels exceed 64 dict levels but must still pass V2.
    deep: dict[str, Any] = {"type": "string"}
    for i in range(35):
        deep = {"type": "object", "properties": {f"level_{i}": deep}}
    assert_advertised_input_schema("deep-cmd", deep)

    # Mutating caller inputs after registration must not alter registered metadata (T3).
    registry = create_command_registry()
    tags = ["a"]
    raw_meta = {"com.example/flags": tags}
    raw_schema: dict[str, Any] = {"type": "object", "properties": {"x": {"type": "string"}}}

    async def _handler(_input: Any, _ctx: Any = None) -> Any:
        return success({})

    registry.register(
        CommandDefinition(
            name="snap-cmd",
            description="Snapshot test",
            handler=_handler,
            tool_meta=raw_meta,
            advertised_input_schema=raw_schema,
        )
    )
    tags.append("mutated")
    raw_schema["properties"]["injected"] = {"type": "boolean"}
    tool = command_to_mcp_tool(registry.get("snap-cmd"))  # type: ignore[arg-type]
    assert tool["_meta"]["com.example/flags"] == ["a"]
    assert "injected" not in tool["inputSchema"]["properties"]


async def test_advertised_schema_confirmations_and_direct_client():
    from afd import DirectClient, create_direct_registry

    # Validation schema declares `confirm`, advertised schema does not: enforce must advertise confirm.
    server = create_server("confirm-adv", tool_strategy="individual", confirmations="enforce")

    @server.command(
        name="danger-run",
        description="Dangerous op",
        expose=MCP,
        confirm_prompt="Run danger?",
        input_schema={
            "type": "object",
            "properties": {"id": {"type": "string"}, "confirm": {"type": "boolean"}},
            "required": ["id"],
        },
        advertised_input_schema={
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
    )
    async def danger_run(inp: dict[str, Any]) -> Any:
        return success(inp)

    tools = {t["name"]: t for t in server.get_tool_definitions()}
    assert "confirm" in tools["danger-run"]["inputSchema"]["properties"]

    # DirectClient validates against input_schema, not advertised_input_schema.
    @define_command(
        name="direct-wrap",
        description="Direct wrapped",
        input_schema={
            "type": "object",
            "properties": {"name": {"type": "string", "minLength": 3}},
            "required": ["name"],
        },
        advertised_input_schema={
            "type": "object",
            "$defs": {"N": {"type": "string"}},
            "properties": {"name": {"$ref": "#/$defs/N"}},
            "required": ["name"],
        },
    )
    async def direct_wrap(inp: dict[str, Any]) -> Any:
        return success({"ok": inp["name"]})

    reg = create_direct_registry([direct_wrap])
    client = DirectClient(reg)
    bad = await client.call("direct-wrap", {"name": "ab"})
    assert bad.success is False and bad.error.code == "VALIDATION_ERROR"
    ok = await client.call("direct-wrap", {"name": "abc"})
    assert ok.success is True and ok.data == {"ok": "abc"}


async def test_tool_meta_and_advertised_schema_over_real_mcp_transports():
    from tests.test_mcp_resources_vectors import (
        LEGACY,
        _http_client,
        _legacy_http,
        _legacy_http_session,
        _modern_http,
        _modern_meta,
        _stream_session,
    )

    extra = {"dev.umbel/origin": {"plugin": "hello"}, "ui": {"resourceUri": "ui://hello/view.html"}}
    advertised = {
        "type": "object",
        "$defs": {"Name": {"type": "string"}},
        "properties": {"name": {"$ref": "#/$defs/Name"}},
        "required": ["name"],
    }
    server = create_server("wire-meta", tool_strategy="individual")

    @server.command(
        name="hello-greet",
        description="Greet",
        expose=MCP,
        input_schema={"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
        advertised_input_schema=advertised,
        tool_meta=extra,
    )
    async def greet(inp: dict[str, Any]) -> Any:
        return success({"hi": inp["name"]})

    async with _http_client(server, stateless=True) as http:
        _, tl = await _modern_http(http, "tools/list")
        tool = next(t for t in tl["result"]["tools"] if t["name"] == "hello-greet")
        assert tool["inputSchema"] == advertised
        assert tool["_meta"]["dev.umbel/origin"] == extra["dev.umbel/origin"]
        assert tool["_meta"]["ui"] == extra["ui"]

    async with _http_client(server, stateless=False) as http:
        sid, _ = await _legacy_http_session(http)
        tl = await _legacy_http(http, sid, "tools/list")
        tool = next(t for t in tl["result"]["tools"] if t["name"] == "hello-greet")
        assert tool["inputSchema"] == advertised
        assert tool["_meta"]["dev.umbel/origin"] == extra["dev.umbel/origin"]

    async with _stream_session(server) as (send, notify):
        await send(
            "initialize",
            {"protocolVersion": LEGACY, "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}},
            req_id=1,
        )
        await notify("notifications/initialized")
        tl = await send("tools/list", req_id=2)
        tool = next(t for t in tl["result"]["tools"] if t["name"] == "hello-greet")
        assert tool["inputSchema"] == advertised
        assert tool["_meta"]["ui"] == extra["ui"]

    server_modern = create_server("wire-meta-modern", tool_strategy="individual")

    @server_modern.command(
        name="hello-greet",
        description="Greet",
        expose=MCP,
        input_schema={"type": "object", "properties": {"name": {"type": "string"}}},
        advertised_input_schema=advertised,
        tool_meta=extra,
    )
    async def greet_m(inp: dict[str, Any]) -> Any:
        return success(inp)

    async with _stream_session(server_modern) as (send, _):
        tl = await send("tools/list", {"_meta": _modern_meta()}, req_id=1)
        tool = next(t for t in tl["result"]["tools"] if t["name"] == "hello-greet")
        assert tool["inputSchema"] == advertised
        assert tool["_meta"]["dev.umbel/origin"] == extra["dev.umbel/origin"]
