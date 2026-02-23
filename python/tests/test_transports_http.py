"""Tests for HttpTransport."""

import json

import pytest
import httpx

from afd.transports.http import HttpTransport
from afd.transports.base import TransportError, TransportState, ToolInfo
from afd.transports._mcp_protocol import _HttpBasedTransport


# ============================================================================
# URL derivation
# ============================================================================


class TestUrlDerivation:
    """Tests for message URL derivation."""

    def test_sse_url_becomes_message(self):
        t = HttpTransport("http://localhost:3100/sse")
        assert t._message_url == "http://localhost:3100/message"

    def test_message_url_kept(self):
        t = HttpTransport("http://localhost:3100/message")
        assert t._message_url == "http://localhost:3100/message"

    def test_bare_url_gets_message(self):
        t = HttpTransport("http://localhost:3100")
        assert t._message_url == "http://localhost:3100/message"

    def test_trailing_slash(self):
        t = HttpTransport("http://localhost:3100/")
        assert t._message_url == "http://localhost:3100/message"


# ============================================================================
# State transitions
# ============================================================================


class TestHttpTransportState:
    """Tests for HttpTransport state transitions."""

    def test_initial_state(self):
        t = HttpTransport("http://localhost:3100/sse")
        assert t.state == TransportState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_connect_sets_connected(self, monkeypatch):
        t = HttpTransport("http://localhost:3100/sse")
        _mock_http_responses(monkeypatch, t)

        await t.connect()
        assert t.state == TransportState.CONNECTED

    @pytest.mark.asyncio
    async def test_disconnect_sets_disconnected(self, monkeypatch):
        t = HttpTransport("http://localhost:3100/sse")
        _mock_http_responses(monkeypatch, t)

        await t.connect()
        await t.disconnect()
        assert t.state == TransportState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_connect_failure_sets_error(self, monkeypatch):
        t = HttpTransport("http://localhost:3100/sse")
        _mock_http_failure(monkeypatch, t)

        with pytest.raises(TransportError):
            await t.connect()
        assert t.state == TransportState.ERROR

    @pytest.mark.asyncio
    async def test_double_connect_is_noop(self, monkeypatch):
        t = HttpTransport("http://localhost:3100/sse")
        _mock_http_responses(monkeypatch, t)

        await t.connect()
        await t.connect()  # should not raise
        assert t.state == TransportState.CONNECTED


# ============================================================================
# call_tool
# ============================================================================


class TestHttpCallTool:
    """Tests for call_tool via HttpTransport."""

    @pytest.mark.asyncio
    async def test_call_tool_returns_parsed_json(self, monkeypatch):
        t = HttpTransport("http://localhost:3100/sse")
        _mock_http_responses(monkeypatch, t, tool_response={"id": "123", "title": "Test"})

        await t.connect()
        result = await t.call_tool("todo-create", {"title": "Test"})
        assert result == {"id": "123", "title": "Test"}

    @pytest.mark.asyncio
    async def test_call_tool_without_connect_raises(self):
        t = HttpTransport("http://localhost:3100/sse")

        with pytest.raises(RuntimeError, match="not connected"):
            await t.call_tool("test", {})

    @pytest.mark.asyncio
    async def test_call_tool_jsonrpc_error(self, monkeypatch):
        t = HttpTransport("http://localhost:3100/sse")
        _mock_http_responses(monkeypatch, t, jsonrpc_error=True)

        await t.connect()
        with pytest.raises(TransportError, match="JSON-RPC error"):
            await t.call_tool("bad-tool", {})


# ============================================================================
# list_tools
# ============================================================================


class TestHttpListTools:
    """Tests for list_tools via HttpTransport."""

    @pytest.mark.asyncio
    async def test_list_tools(self, monkeypatch):
        tools_data = [
            {"name": "ping", "description": "Health check"},
            {"name": "todo-create", "description": "Create todo", "inputSchema": {"type": "object"}},
        ]
        t = HttpTransport("http://localhost:3100/sse")
        _mock_http_responses(monkeypatch, t, tools_list=tools_data)

        await t.connect()
        tools = await t.list_tools()

        assert len(tools) == 2
        assert tools[0].name == "ping"
        assert tools[1].input_schema == {"type": "object"}


# ============================================================================
# Helpers — mock httpx responses
# ============================================================================


def _make_jsonrpc_response(result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": 1, "result": result}


def _make_jsonrpc_error() -> dict:
    return {"jsonrpc": "2.0", "id": 1, "error": {"code": -32600, "message": "Invalid request"}}


def _mock_http_responses(
    monkeypatch,
    transport: HttpTransport,
    *,
    tool_response: dict | None = None,
    tools_list: list | None = None,
    jsonrpc_error: bool = False,
):
    """Patch httpx.AsyncClient to return predictable responses."""
    call_count = {"n": 0}

    async def mock_post(self_client, url, *, json=None, headers=None, timeout=None):
        call_count["n"] += 1
        method = json.get("method", "") if json else ""

        if jsonrpc_error and method != "initialize":
            body = _make_jsonrpc_error()
        elif method == "initialize":
            body = _make_jsonrpc_response({
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "test-server", "version": "1.0.0"},
                "capabilities": {},
            })
        elif method == "tools/list":
            body = _make_jsonrpc_response({"tools": tools_list or []})
        elif method == "tools/call":
            content_text = __import__("json").dumps(tool_response or {})
            body = _make_jsonrpc_response({
                "content": [{"type": "text", "text": content_text}],
            })
        else:
            body = _make_jsonrpc_response({})

        return httpx.Response(200, json=body)

    async def mock_get(self_client, url, *, headers=None, timeout=None):
        return httpx.Response(200, json={"status": "ok"})

    async def mock_aclose(self_client):
        pass

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)
    monkeypatch.setattr(httpx.AsyncClient, "aclose", mock_aclose)


def _mock_http_failure(monkeypatch, transport: HttpTransport):
    """Patch httpx to simulate connection failure."""

    async def mock_post(self_client, url, *, json=None, headers=None, timeout=None):
        raise httpx.ConnectError("Connection refused")

    async def mock_get(self_client, url, *, headers=None, timeout=None):
        return httpx.Response(200, json={"status": "ok"})

    async def mock_aclose(self_client):
        pass

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)
    monkeypatch.setattr(httpx.AsyncClient, "aclose", mock_aclose)
