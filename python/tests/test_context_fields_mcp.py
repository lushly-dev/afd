"""Declared context fields over MCP (``spec/context-fields.md``).

Values come from ``tools/call``'s ``_meta`` on both eras, in process and over Streamable
HTTP (stateful and stateless), SSE and stdio; undeclared keys are dropped; an invalid value is
a ``VALIDATION_ERROR`` tool result naming the field; ``tools/list`` does not vary;
``server/discover`` and ``afd-help`` list the fields.

Mirrors ``packages/server/src/context-fields-mcp.test.ts``. Python has no ``createContext``
hook, so the only trusted values on an MCP call are the keys the router sets itself, which a
field cannot be named after; and it has no AFD HTTP lanes (``/rpc``, ``/batch``, ``/stream``),
so MCP's own transports are the HTTP surface.
"""

import json
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("mcp.client.streamable_http")

from mcp import Client, ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.sse import sse_client  # noqa: E402

from afd.server import (  # noqa: E402
    AFD_CONTEXT_FIELDS_META_KEY,
    ContextField,
    check_context_fields,
    describe_context_fields,
)
from afd.server.context_fields import (  # noqa: E402
    bind_context_field_values,
    context_field_values,
    current_context_field_values,
)
from tests.fixtures.context_fields_server import FIELDS, Scope, build_server  # noqa: E402
from tests.test_mcp_protocol_live import protocol_server  # noqa: E402

MODERN = "2026-07-28"
FIXTURE = "context_fields_server.py"

META = {
    "dev.example/scope": {"project": "p-1"},
    "dev.example/locale": "en-GB",
    "dev.example/other": "dropped",
}

# What scope-echo returns for META: the declared values, the undeclared key nowhere in
# context.extra, and only the router's own keys beside them.
DELIVERED = {
    "scope": {"project": "p-1"},
    "locale": "en-GB",
    "undeclared": None,
    "keys": ["active_context", "interface", "locale", "remote", "scope"],
}

DESCRIBED = [
    {
        "name": "scope",
        "meta": "dev.example/scope",
        "schema": Scope.model_json_schema(),
        "required": False,
        "journal": False,
    },
    {
        "name": "locale",
        "meta": "dev.example/locale",
        "schema": {"type": "string", "maxLength": 35},
        "required": False,
        "journal": False,
    },
]


def payload(result: Any) -> dict[str, Any]:
    return json.loads(result.content[0].text)


async def assert_delivers(call_tool: Callable[..., Any]) -> None:
    """Declared values reach the handler, undeclared keys are dropped, invalid values fail."""
    delivered = await call_tool("scope-echo", {}, meta=META)
    assert payload(delivered)["success"] is True
    assert payload(delivered)["data"] == DELIVERED

    invalid = await call_tool("scope-echo", {}, meta={"dev.example/scope": {"project": 7}})
    assert invalid.is_error is True
    error = payload(invalid)["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["message"] == "Context field 'scope' is not valid"
    assert error["details"]["field"] == "scope"
    assert error["details"]["meta"] == "dev.example/scope"
    assert '_meta["dev.example/scope"]' in error["suggestion"]

    too_long = await call_tool("scope-echo", {}, meta={"dev.example/locale": "x" * 36})
    assert payload(too_long)["error"]["details"]["field"] == "locale"

    plain = await call_tool("scope-echo", {})
    assert payload(plain)["data"]["keys"] == ["active_context", "interface", "remote"]


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════


def test_context_field_values_reads_declared_keys_only():
    fields = check_context_fields(FIELDS)
    assert context_field_values(fields, META) == {
        "scope": {"project": "p-1"},
        "locale": "en-GB",
    }
    # A null is passed on; validation treats it as no value.
    assert context_field_values(fields, {"dev.example/locale": None}) == {"locale": None}
    assert context_field_values(fields, None) == {}
    assert context_field_values(fields, ["dev.example/scope"]) == {}
    assert context_field_values([], META) == {}


def test_values_are_bound_per_call():
    assert current_context_field_values() == {}
    with bind_context_field_values({"locale": "en"}):
        assert current_context_field_values() == {"locale": "en"}
        with bind_context_field_values({}):
            assert current_context_field_values() == {}
        assert current_context_field_values() == {"locale": "en"}
    assert current_context_field_values() == {}


def test_describe_lists_fields_in_declaration_order_with_json_schema():
    fields = check_context_fields(
        [
            *FIELDS,
            ContextField(
                name="session_hint",
                meta="dev.example/session-hint",
                schema=str,
                journal=True,
                required=True,
            ),
        ]
    )
    assert describe_context_fields(fields) == [
        *DESCRIBED,
        {
            "name": "session_hint",
            "meta": "dev.example/session-hint",
            "schema": {"type": "string"},
            "required": True,
            "journal": True,
        },
    ]


def test_describe_lists_a_schema_without_json_schema_as_any_value():
    fields = check_context_fields(
        [ContextField(name="hook", meta="dev.example/hook", schema=Callable[[], Any])]
    )
    assert describe_context_fields(fields)[0]["schema"] == {}


# ═══════════════════════════════════════════════════════════════════════════════
# IN PROCESS, BOTH ERAS
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_tools_call_delivers_declared_meta_values(mode):
    async with Client(build_server()._create_mcp_server(), mode=mode) as client:
        assert (client.protocol_version == MODERN) is (mode == "auto")
        await assert_delivers(client.call_tool)


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_meta_tools_carry_the_values_to_every_item_and_step(mode):
    async with Client(build_server("lazy")._create_mcp_server(), mode=mode) as client:
        called = await client.call_tool("afd-call", {"command": "scope-echo"}, meta=META)
        assert payload(called)["data"] == DELIVERED

        batch = await client.call_tool(
            "afd-batch",
            {"commands": [{"command": "scope-echo"}, {"command": "scope-peek"}]},
            meta=META,
        )
        assert [item["result"]["data"] for item in payload(batch)["results"]] == [
            DELIVERED,
            DELIVERED,
        ]

        piped = await client.call_tool(
            "afd-pipe",
            {"steps": [{"command": "scope-echo", "as": "first"}, {"command": "scope-peek"}]},
            meta=META,
        )
        assert [step["data"] for step in payload(piped)["steps"]] == [DELIVERED, DELIVERED]

        invalid = await client.call_tool(
            "afd-batch",
            {"commands": [{"command": "scope-echo"}]},
            meta={"dev.example/scope": "p-1"},
        )
        item = payload(invalid)["results"][0]["result"]
        assert item["error"]["code"] == "VALIDATION_ERROR"
        assert item["error"]["details"]["field"] == "scope"


@pytest.mark.parametrize("strategy", ["grouped", "hybrid"])
async def test_every_tool_strategy_delivers_the_values(strategy):
    async with Client(build_server(strategy)._create_mcp_server()) as client:
        if strategy == "grouped":
            result = await client.call_tool("scope", {"action": "echo", "params": {}}, meta=META)
        else:
            # scope-peek is not first-class, so the call reaches it by name.
            assert "scope-peek" not in {tool.name for tool in (await client.list_tools()).tools}
            result = await client.call_tool("scope-peek", {}, meta=META)
        assert payload(result)["data"] == DELIVERED


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_tools_list_does_not_vary_by_a_declared_field(mode):
    async with Client(build_server()._create_mcp_server(), mode=mode) as client:
        plain = await client.list_tools()
        with_meta = await client.list_tools(meta=META, cache_mode="bypass")
        assert with_meta.tools == plain.tools
        assert with_meta.ttl_ms == plain.ttl_ms
        if mode == "auto":
            assert with_meta.ttl_ms == 300_000


async def test_a_required_field_fails_a_call_without_it_but_not_afd_commands():
    fields = [ContextField(name="scope", meta="dev.example/scope", schema=Scope, required=True)]
    async with Client(build_server(fields=fields)._create_mcp_server()) as client:
        missing = payload(await client.call_tool("scope-echo", {}))
        assert missing["error"]["code"] == "VALIDATION_ERROR"
        assert missing["error"]["message"] == "Context field 'scope' is required"
        helped = payload(await client.call_tool("afd-help", {}))
        assert helped["success"] is True
        assert helped["data"]["contextFields"][0]["required"] is True
        sent = await client.call_tool("scope-echo", {}, meta=META)
        assert payload(sent)["data"]["scope"] == {"project": "p-1"}


async def test_tool_arguments_never_carry_the_values():
    server = build_server()
    # An in-process call_tool routes like MCP, but has no request _meta to read.
    routed = await server.call_tool("scope-echo", {"_meta": META})
    assert routed.data["keys"] == ["active_context", "interface", "remote"]


# ═══════════════════════════════════════════════════════════════════════════════
# DISCOVERY
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_afd_help_lists_the_fields(mode):
    async with Client(build_server()._create_mcp_server(), mode=mode) as client:
        helped = payload(await client.call_tool("afd-help", {}))
        assert helped["data"]["contextFields"] == DESCRIBED


async def test_afd_help_omits_context_fields_when_none_are_declared():
    async with Client(build_server(fields=[])._create_mcp_server()) as client:
        helped = payload(await client.call_tool("afd-help", {}))
        assert "contextFields" not in helped["data"]
        assert client.session.discover_result is not None
        assert AFD_CONTEXT_FIELDS_META_KEY not in (client.session.discover_result.meta or {})


async def test_server_discover_lists_the_fields_in_process():
    async with Client(build_server()._create_mcp_server(), mode="auto") as client:
        discovered = client.session.discover_result
        assert discovered is not None
        assert discovered.meta[AFD_CONTEXT_FIELDS_META_KEY] == DESCRIBED
        # The SDK's own answer is kept: instructions, cache hint and serverInfo stamp.
        assert "AFD server" in discovered.instructions
        assert discovered.ttl_ms == 300_000
        assert discovered.meta["io.modelcontextprotocol/serverInfo"]["name"] == "fields-fixture"


def test_the_discover_hook_wraps_the_sdk_handler_once():
    server = build_server()
    sdk = server._create_mcp_server()
    lowlevel = sdk._lowlevel_server
    entry = lowlevel.get_request_handler("server/discover")
    assert entry is not None
    assert entry.handler.__name__ == "discover_with_fields"
    server._advertise_context_fields()
    assert lowlevel.get_request_handler("server/discover") is entry
    # Without fields, the SDK's handler is left alone.
    plain = build_server(fields=[])._create_mcp_server()._lowlevel_server
    assert plain.get_request_handler("server/discover").handler == plain._handle_discover


# ═══════════════════════════════════════════════════════════════════════════════
# REAL TRANSPORTS
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("stateless", [False, True])
@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_streamable_http_delivers_values_on_both_eras(mode, stateless):
    async with (
        protocol_server(
            "individual", "streamable-http", stateless=stateless, fixture=FIXTURE
        ) as url,
        Client(url, mode=mode) as client,
    ):
        assert (client.protocol_version == MODERN) is (mode == "auto")
        await assert_delivers(client.call_tool)
        plain = await client.list_tools()
        with_meta = await client.list_tools(meta=META, cache_mode="bypass")
        assert with_meta.tools == plain.tools
        helped = payload(await client.call_tool("afd-help", {}))
        assert helped["data"]["contextFields"] == DESCRIBED


async def test_sse_delivers_values():
    async with (
        protocol_server("individual", "sse", fixture=FIXTURE) as url,
        sse_client(url) as streams,
        ClientSession(streams[0], streams[1]) as session,
    ):
        await session.initialize()
        await assert_delivers(session.call_tool)


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_stdio_delivers_values_on_both_eras(mode):
    root = Path(__file__).resolve().parents[1]
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(root / "tests/fixtures" / FIXTURE), "0", "individual", "stdio"],
        env=dict(os.environ, PYTHONPATH=str(root / "src")),
    )
    async with Client(params, mode=mode) as client:
        assert (client.protocol_version == MODERN) is (mode == "auto")
        await assert_delivers(client.call_tool)


async def test_server_discover_over_http_lists_the_fields():
    import httpx2

    async with protocol_server(
        "individual", "streamable-http", stateless=True, fixture=FIXTURE
    ) as url:
        meta = {
            "io.modelcontextprotocol/protocolVersion": MODERN,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {"name": "test", "version": "0"},
        }
        async with httpx2.AsyncClient() as http:
            response = await http.post(
                url,
                headers={
                    "Accept": "application/json, text/event-stream",
                    "MCP-Protocol-Version": MODERN,
                    "Mcp-Method": "server/discover",
                },
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "server/discover",
                    "params": {"_meta": meta},
                },
            )
    body = response.text
    data = (
        json.loads(body.split("data: ", 1)[1].splitlines()[0])
        if body.startswith("event")
        else json.loads(body)
    )
    result = data["result"]
    assert MODERN in result["supportedVersions"]
    assert result["_meta"][AFD_CONTEXT_FIELDS_META_KEY] == DESCRIBED
    assert result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "fields-fixture"
    assert result["ttlMs"] == 300_000
