"""Tests for SseTransport."""

import asyncio
import json as json_mod

import pytest
import httpx

from afd.transports.sse import SseTransport
from afd.transports.base import TransportError, TransportState


# ============================================================================
# URL derivation (inherited from _HttpBasedTransport)
# ============================================================================


class TestSseUrlDerivation:
    """Tests for message URL derivation on SSE transport."""

    def test_sse_url_becomes_message(self):
        t = SseTransport("http://localhost:3100/sse")
        assert t._message_url == "http://localhost:3100/message"

    def test_bare_url_gets_message(self):
        t = SseTransport("http://localhost:3100")
        assert t._message_url == "http://localhost:3100/message"


# ============================================================================
# State transitions
# ============================================================================


class TestSseTransportState:
    """Tests for SseTransport state transitions."""

    def test_initial_state(self):
        t = SseTransport("http://localhost:3100/sse")
        assert t.state == TransportState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_connect_sets_connected(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_responses(monkeypatch)

        await t.connect()
        assert t.state == TransportState.CONNECTED
        await t.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect_sets_disconnected(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_responses(monkeypatch)

        await t.connect()
        await t.disconnect()
        assert t.state == TransportState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_disconnect_cancels_sse_task(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_responses(monkeypatch)

        await t.connect()
        assert t._sse_task is not None
        await t.disconnect()
        assert t._sse_task is None

    @pytest.mark.asyncio
    async def test_connect_failure_sets_error(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_failure(monkeypatch)

        with pytest.raises(TransportError):
            await t.connect()
        assert t.state == TransportState.ERROR

    @pytest.mark.asyncio
    async def test_double_connect_is_noop(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_responses(monkeypatch)

        await t.connect()
        await t.connect()
        assert t.state == TransportState.CONNECTED
        await t.disconnect()


# ============================================================================
# call_tool
# ============================================================================


class TestSseCallTool:
    """Tests for call_tool via SseTransport."""

    @pytest.mark.asyncio
    async def test_call_tool_returns_parsed_json(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_responses(monkeypatch, tool_response={"id": "42"})

        await t.connect()
        result = await t.call_tool("todo-get", {"id": "42"})
        assert result == {"id": "42"}
        await t.disconnect()

    @pytest.mark.asyncio
    async def test_call_tool_without_connect_raises(self):
        t = SseTransport("http://localhost:3100/sse")

        with pytest.raises(RuntimeError, match="not connected"):
            await t.call_tool("test", {})


# ============================================================================
# list_tools
# ============================================================================


class TestSseListTools:
    """Tests for list_tools via SseTransport."""

    @pytest.mark.asyncio
    async def test_list_tools(self, monkeypatch):
        tools_data = [{"name": "ping", "description": "Pong"}]
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_responses(monkeypatch, tools_list=tools_data)

        await t.connect()
        tools = await t.list_tools()
        assert len(tools) == 1
        assert tools[0].name == "ping"
        await t.disconnect()


# ============================================================================
# Callbacks
# ============================================================================


class TestSseCallbacks:
    """Tests for on_close and on_error callbacks."""

    def test_callbacks_stored(self):
        close_called = False
        error_called = False

        def on_close():
            nonlocal close_called
            close_called = True

        def on_error(exc):
            nonlocal error_called
            error_called = True

        t = SseTransport(
            "http://localhost:3100/sse",
            on_close=on_close,
            on_error=on_error,
        )
        assert t._on_close is on_close
        assert t._on_error is on_error


# ============================================================================
# Helpers — mock httpx + SSE
# ============================================================================


def _make_jsonrpc_response(result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": 1, "result": result}


class _FakeAsyncStream:
    """Fake async iterator for SSE stream mocking."""

    async def aiter_lines(self):
        # Yield nothing — just a keepalive
        return
        yield  # noqa: unreachable — makes this an async generator

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


def _mock_sse_responses(
    monkeypatch,
    *,
    tool_response: dict | None = None,
    tools_list: list | None = None,
):
    """Patch httpx.AsyncClient to return predictable responses for SSE transport."""

    async def mock_post(self_client, url, *, json=None, headers=None, timeout=None):
        method = json.get("method", "") if json else ""

        if method == "initialize":
            body = _make_jsonrpc_response({
                "protocolVersion": "2024-11-05",
                "serverInfo": {"name": "test-server", "version": "1.0.0"},
                "capabilities": {},
            })
        elif method == "tools/list":
            body = _make_jsonrpc_response({"tools": tools_list or []})
        elif method == "tools/call":
            content_text = json_mod.dumps(tool_response or {})
            body = _make_jsonrpc_response({
                "content": [{"type": "text", "text": content_text}],
            })
        else:
            body = _make_jsonrpc_response({})

        return httpx.Response(200, json=body)

    def mock_stream(self_client, method, url, *, headers=None):
        return _FakeAsyncStream()

    async def mock_aclose(self_client):
        pass

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    monkeypatch.setattr(httpx.AsyncClient, "stream", mock_stream)
    monkeypatch.setattr(httpx.AsyncClient, "aclose", mock_aclose)


def _mock_sse_failure(monkeypatch):
    """Patch httpx to simulate POST failure during initialize."""

    async def mock_post(self_client, url, *, json=None, headers=None, timeout=None):
        raise httpx.ConnectError("Connection refused")

    def mock_stream(self_client, method, url, *, headers=None):
        return _FakeAsyncStream()

    async def mock_aclose(self_client):
        pass

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    monkeypatch.setattr(httpx.AsyncClient, "stream", mock_stream)
    monkeypatch.setattr(httpx.AsyncClient, "aclose", mock_aclose)
