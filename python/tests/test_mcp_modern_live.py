"""MCP 2026-07-28 against a real AFD/MCPServer subprocess over Streamable HTTP.

The fixture serves both eras from one endpoint. These cases cover the modern
(stateless, per-request ``_meta``) era; ``test_mcp_protocol_live`` covers 2025
``initialize`` sessions.
"""

import json

import pytest

pytest.importorskip("mcp.client.streamable_http")

from mcp import Client, MCPError  # noqa: E402

from afd.client import McpClient, McpClientConfig  # noqa: E402
from tests.test_mcp_protocol_live import protocol_server  # noqa: E402

MODERN = "2026-07-28"


def payload(result):
    return json.loads(result.content[0].text)


@pytest.mark.parametrize("stateless", [False, True])
async def test_afd_client_negotiates_each_protocol_mode(stateless):
    async with protocol_server("individual", "streamable-http", stateless=stateless) as url:
        for mode, expected in (("auto", MODERN), ("modern", MODERN), ("legacy", "2025-11-25")):
            client = McpClient(
                McpClientConfig(url=url, protocol_mode=mode, auto_reconnect=False, timeout=5)
            )
            await client.connect()
            try:
                assert client._transport.protocol_version == expected, mode
                assert client.get_status().server_info["name"] == "protocol-fixture"
                result = await client.call("alpha-run", {"value": 4})
                assert result.success and result.data["value"] == 4
                hidden = await client.call("private-rotate", {})
                assert hidden.error.code == "COMMAND_NOT_FOUND"
            finally:
                await client.disconnect()


async def test_modern_mode_fails_against_a_2025_only_server():
    async with protocol_server("individual", "sse") as url:
        client = McpClient(
            McpClientConfig(
                url=url, transport="streamable-http", protocol_mode="modern",
                auto_reconnect=False, timeout=5,
            )
        )
        with pytest.raises(Exception):
            await client.connect()
        await client.disconnect()


async def test_meta_context_scopes_tools_and_calls_without_a_session():
    async with protocol_server("individual", "streamable-http", stateless=True) as url:
        async with Client(url, mode="auto") as client:
            assert client.protocol_version == MODERN
            everything = {tool.name for tool in (await client.list_tools()).tools}
            assert {"alpha-run", "beta-run"} <= everything
            alpha = await client.list_tools(meta={"dev.afd/context": "alpha"}, cache_mode="bypass")
            names = {tool.name for tool in alpha.tools}
            assert "alpha-run" in names and "beta-run" not in names

            denied = await client.call_tool(
                "afd-call",
                {"command": "beta-run", "input": {"value": 1}},
                meta={"dev.afd/context": "alpha"},
            )
            assert payload(denied)["success"] is False
            allowed = await client.call_tool(
                "alpha-run", {"value": 2}, meta={"dev.afd/context": "alpha"}
            )
            assert payload(allowed)["data"]["context"] == "alpha"

            entered = payload(await client.call_tool("afd-context-enter", {"context": "alpha"}))
            assert entered["success"] is True
            assert entered["data"] == {"entered": "alpha", "persisted": False}
            assert "dev.afd/context" in entered["reasoning"]
            listed = payload(await client.call_tool("afd-context-list", {}))
            assert "activeContext" not in listed["data"]

            with pytest.raises(MCPError) as raised:
                await client.list_tools(meta={"dev.afd/context": "nope"}, cache_mode="bypass")
            assert raised.value.code == -32602


async def test_server_discover_describes_the_server():
    async with protocol_server("lazy", "streamable-http", stateless=True) as url:
        import httpx2

        meta = {
            "io.modelcontextprotocol/protocolVersion": MODERN,
            "io.modelcontextprotocol/clientCapabilities": {},
        }
        async with httpx2.AsyncClient() as http:
            response = await http.post(
                url,
                headers={
                    "Accept": "application/json, text/event-stream",
                    "MCP-Protocol-Version": MODERN,
                    "Mcp-Method": "server/discover",
                },
                json={"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": {"_meta": meta}},
            )
        body = response.text
        data = json.loads(body.split("data: ", 1)[1].splitlines()[0]) if body.startswith("event") else json.loads(body)
        result = data["result"]
        assert MODERN in result["supportedVersions"]
        assert "afd-discover" in result["instructions"]
        assert "dev.afd/context" in result["instructions"]
        # The fixture configures contexts, so the default freshness hint is 0.
        assert result["ttlMs"] == 0
        assert result["cacheScope"] == "public"


HYBRID_LIST = [
    "afd-discover", "afd-detail", "afd-call", "afd-batch", "afd-pipe",
    "afd-context-list", "afd-context-enter", "afd-context-exit",
    "alpha-run", "beta-run", "probe-read",
]


@pytest.mark.parametrize("stateless", [False, True])
async def test_hybrid_list_is_fixed_and_first_class_calls_are_scoped_by_context(stateless):
    async with protocol_server("hybrid", "streamable-http", stateless=stateless) as url:
        async with Client(url, mode="auto") as client:
            assert client.protocol_version == MODERN
            for meta in (None, {"dev.afd/context": "alpha"}, {"dev.afd/context": "beta"}):
                listed = await client.list_tools(meta=meta, cache_mode="bypass")
                assert [tool.name for tool in listed.tools] == HYBRID_LIST
                # The list does not vary by context, so contexts keep the default hint.
                assert listed.ttl_ms == 300_000

            ran = await client.call_tool("alpha-run", {"value": 2}, meta={"dev.afd/context": "alpha"})
            assert payload(ran)["data"]["context"] == "alpha"
            denied = await client.call_tool("alpha-run", {"value": 2}, meta={"dev.afd/context": "beta"})
            assert denied.is_error is True
            assert payload(denied)["error"]["code"] == "COMMAND_NOT_IN_CONTEXT"
            assert "afd-context-enter" in payload(denied)["error"]["suggestion"]

            # A command outside the first-class set runs by name and through afd-call.
            direct = await client.call_tool("probe-write", {})
            assert payload(direct)["success"] is True
            via_call = await client.call_tool("afd-call", {"command": "probe-write"})
            assert payload(via_call)["data"]["writes"] == 2
            for name in ("private-rotate", "no-such-command"):
                hidden = payload(await client.call_tool(name, {}))
                assert hidden["error"]["code"] == "COMMAND_NOT_FOUND"
                assert hidden["error"]["suggestion"].endswith("Use afd-discover to list all commands.")

            helped = payload(await client.call_tool("afd-help", {}))["data"]
            assert helped["toolStrategy"] == "hybrid"
            assert helped["firstClassTools"] == ["alpha-run", "beta-run", "probe-read"]


async def test_hybrid_server_discover_reports_instructions_hints_and_no_list_changes():
    async with protocol_server("hybrid", "streamable-http", stateless=True) as url:
        import httpx2

        meta = {
            "io.modelcontextprotocol/protocolVersion": MODERN,
            "io.modelcontextprotocol/clientCapabilities": {},
        }
        async with httpx2.AsyncClient() as http:
            response = await http.post(
                url,
                headers={
                    "Accept": "application/json, text/event-stream",
                    "MCP-Protocol-Version": MODERN,
                    "Mcp-Method": "server/discover",
                },
                json={"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": {"_meta": meta}},
            )
        body = response.text
        data = json.loads(body.split("data: ", 1)[1].splitlines()[0]) if body.startswith("event") else json.loads(body)
        result = data["result"]
        assert (
            "The command tools listed are the common ones. Call afd-discover to find others, "
            "afd-detail for a schema, and afd-call to run one." in result["instructions"]
        )
        assert "dev.afd/context" in result["instructions"]
        assert result["ttlMs"] == 300_000
        assert result["cacheScope"] == "public"
        assert result["capabilities"]["tools"]["listChanged"] is False
