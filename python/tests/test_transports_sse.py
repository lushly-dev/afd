"""Tests for SseTransport."""

import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from afd.transports.base import ToolExecutionError, TransportError, TransportState
from afd.transports.sse import SseTransport


class TestSseUrlDerivation:
    """Tests for message URL derivation on SSE transport."""

    def test_sse_url_becomes_message_endpoint(self):
        t = SseTransport("http://localhost:3100/sse")
        assert t._message_url == "http://localhost:3100/message"

    def test_bare_url_gets_message_endpoint(self):
        t = SseTransport("http://localhost:3100")
        assert t._message_url == "http://localhost:3100/message"

    def test_message_url_is_kept(self):
        t = SseTransport("http://localhost:3100/message")
        assert t._message_url == "http://localhost:3100/message"


class TestSseTransportState:
    """Tests for SseTransport state transitions."""

    def test_initial_state(self):
        t = SseTransport("http://localhost:3100/sse")
        assert t.state == TransportState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_connect_sets_connected(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_session(monkeypatch)

        await t.connect()
        assert t.state == TransportState.CONNECTED
        await t.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect_sets_disconnected(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_session(monkeypatch)

        await t.connect()
        await t.disconnect()
        assert t.state == TransportState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_connect_failure_sets_error(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_session(monkeypatch, init_error=RuntimeError("boom"))

        with pytest.raises(TransportError, match="boom"):
            await t.connect()
        assert t.state == TransportState.ERROR

    @pytest.mark.asyncio
    async def test_double_connect_is_noop(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_session(monkeypatch)

        await t.connect()
        first_session = t._session
        await t.connect()
        assert t.state == TransportState.CONNECTED
        assert t._session is first_session
        await t.disconnect()


class TestSseCallTool:
    """Tests for call_tool via SseTransport."""

    @pytest.mark.asyncio
    async def test_call_tool_returns_parsed_json(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_session(monkeypatch, tool_response={"content": [{"type": "text", "text": "{\"id\": \"42\"}"}], "isError": False})

        await t.connect()
        result = await t.call_tool("todo-get", {"id": "42"})
        assert result == {"id": "42"}
        await t.disconnect()

    @pytest.mark.asyncio
    async def test_call_tool_raises_tool_execution_error(self, monkeypatch):
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_session(monkeypatch, tool_response={"isError": True, "content": [{"type": "text", "text": "Nope"}]})

        await t.connect()
        with pytest.raises(ToolExecutionError, match="Nope"):
            await t.call_tool("todo-get", {"id": "42"})
        await t.disconnect()

    @pytest.mark.asyncio
    async def test_call_tool_without_connect_raises(self):
        t = SseTransport("http://localhost:3100/sse")

        with pytest.raises(RuntimeError, match="not connected"):
            await t.call_tool("test", {})


class TestSseListTools:
    """Tests for list_tools via SseTransport."""

    @pytest.mark.asyncio
    async def test_list_tools(self, monkeypatch):
        tools_data = [
            {
                "name": "ping",
                "description": "Pong",
                "inputSchema": {"type": "object"},
                "_meta": {"outputSchema": {"type": "object"}},
            }
        ]
        t = SseTransport("http://localhost:3100/sse")
        _mock_sse_session(monkeypatch, tools_list=tools_data)

        await t.connect()
        tools = await t.list_tools()
        assert len(tools) == 1
        assert tools[0].name == "ping"
        assert tools[0].input_schema == {"type": "object"}
        assert tools[0].meta == {"outputSchema": {"type": "object"}}
        await t.disconnect()


class TestSseCallbacks:
    """Tests for on_close and on_error callbacks."""

    @pytest.mark.asyncio
    async def test_disconnect_triggers_on_close(self, monkeypatch):
        closed = False

        def on_close():
            nonlocal closed
            closed = True

        t = SseTransport("http://localhost:3100/sse", on_close=on_close)
        _mock_sse_session(monkeypatch)

        await t.connect()
        await t.disconnect()
        assert closed is True

    @pytest.mark.asyncio
    async def test_connect_failure_triggers_on_error(self, monkeypatch):
        errors: list[str] = []

        def on_error(exc):
            errors.append(str(exc))

        t = SseTransport("http://localhost:3100/sse", on_error=on_error)
        _mock_sse_session(monkeypatch, init_error=RuntimeError("boom"))

        with pytest.raises(TransportError, match="boom"):
            await t.connect()
        assert errors == ["boom"]


class _FakeModel:
    def __init__(self, payload):
        self._payload = payload

    def model_dump(self, **kwargs):
        return self._payload


class _FakeCallToolResult:
    def __init__(self, payload):
        self._payload = payload

    def model_dump(self, **kwargs):
        return self._payload


def _mock_sse_session(
    monkeypatch,
    *,
    tool_response: dict | None = None,
    tools_list: list[dict] | None = None,
    init_error: Exception | None = None,
):
    """Patch the upstream MCP SSE/session modules with lightweight fakes."""

    class FakeClientSession:
        def __init__(self, *streams):
            self._streams = streams

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def initialize(self):
            if init_error is not None:
                raise init_error
            return SimpleNamespace(
                serverInfo=_FakeModel({"name": "test-server", "version": "1.0.0"}),
                capabilities=_FakeModel({}),
            )

        async def call_tool(self, name, arguments=None):
            _ = name, arguments
            payload = tool_response or {"content": [{"type": "text", "text": "{}"}], "isError": False}
            return _FakeCallToolResult(payload)

        async def list_tools(self):
            fake_tools = [_FakeModel(item) for item in (tools_list or [])]
            return SimpleNamespace(tools=fake_tools)

    @asynccontextmanager
    async def fake_sse_client(url, headers=None, timeout=None):
        _ = url, headers, timeout
        yield (object(), object())

    monkeypatch.setitem(sys.modules, "mcp.client.sse", SimpleNamespace(sse_client=fake_sse_client))
    monkeypatch.setitem(sys.modules, "mcp.client.session", SimpleNamespace(ClientSession=FakeClientSession))
