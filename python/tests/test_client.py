"""Tests for McpClient."""

import pytest

from afd.client import McpClient, McpClientConfig, ClientStatus, create_client
from afd.transports.base import ToolInfo, TransportError, TransportState
from afd.transports.mock import MockTransport
from afd import success, failure, create_error


# ============================================================================
# Helpers
# ============================================================================


def _connected_transport() -> MockTransport:
    """Create a MockTransport pre-loaded with common tools."""
    t = MockTransport()
    t.add_mock_response("ping", {"status": "pong"})
    return t


async def _connected_client(transport: MockTransport | None = None) -> McpClient:
    """Create and connect a client with a mock transport."""
    t = transport or _connected_transport()
    client = McpClient(transport=t)
    await client.connect()
    return client


# ============================================================================
# Config defaults
# ============================================================================


class TestMcpClientConfig:
    """Tests for McpClientConfig defaults."""

    def test_defaults(self):
        config = McpClientConfig()
        assert config.url == ""
        assert config.transport == "sse"
        assert config.auto_reconnect is True
        assert config.max_reconnect_attempts == 5
        assert config.reconnect_delay == 1.0
        assert config.headers == {}
        assert config.timeout == 30.0
        assert config.debug is False

    def test_custom_config(self):
        config = McpClientConfig(
            url="http://localhost:3100/sse",
            transport="http",
            auto_reconnect=False,
            timeout=10.0,
        )
        assert config.url == "http://localhost:3100/sse"
        assert config.transport == "http"
        assert config.auto_reconnect is False
        assert config.timeout == 10.0


# ============================================================================
# ClientStatus
# ============================================================================


class TestClientStatus:
    """Tests for ClientStatus."""

    def test_defaults(self):
        status = ClientStatus()
        assert status.state == TransportState.DISCONNECTED
        assert status.url is None
        assert status.connected_at is None
        assert status.reconnect_attempts == 0
        assert status.tools_count == 0


# ============================================================================
# Initial state
# ============================================================================


class TestMcpClientInitialState:
    """Tests for initial client state."""

    def test_not_connected(self):
        client = McpClient()
        assert not client.is_connected()

    def test_get_status_disconnected(self):
        client = McpClient()
        status = client.get_status()
        assert status.state == TransportState.DISCONNECTED

    def test_empty_tools(self):
        client = McpClient()
        assert client.get_tools() == []


# ============================================================================
# Connect / disconnect
# ============================================================================


class TestMcpClientLifecycle:
    """Tests for connect and disconnect."""

    @pytest.mark.asyncio
    async def test_connect_with_transport(self):
        transport = _connected_transport()
        client = McpClient(transport=transport)

        await client.connect()
        assert client.is_connected()

    @pytest.mark.asyncio
    async def test_disconnect(self):
        client = await _connected_client()
        await client.disconnect()
        assert not client.is_connected()

    @pytest.mark.asyncio
    async def test_status_after_connect(self):
        client = await _connected_client()
        status = client.get_status()
        assert status.state == TransportState.CONNECTED
        assert status.connected_at is not None
        assert status.reconnect_attempts == 0

    @pytest.mark.asyncio
    async def test_tools_fetched_on_connect(self):
        transport = MockTransport()

        async def handler(args):
            return success({"ok": True})

        transport.register_tool("my-tool", handler, description="Test tool")
        client = McpClient(transport=transport)
        await client.connect()

        tools = client.get_tools()
        assert len(tools) == 1
        assert tools[0].name == "my-tool"


# ============================================================================
# Events
# ============================================================================


class TestMcpClientEvents:
    """Tests for event subscribe/unsubscribe."""

    @pytest.mark.asyncio
    async def test_connected_event(self):
        events = []
        transport = _connected_transport()
        client = McpClient(transport=transport)
        client.on("connected", lambda: events.append("connected"))

        await client.connect()
        assert "connected" in events

    @pytest.mark.asyncio
    async def test_disconnected_event(self):
        events = []
        client = await _connected_client()
        client.on("disconnected", lambda reason: events.append(reason))

        await client.disconnect()
        assert "Manual disconnect" in events

    @pytest.mark.asyncio
    async def test_state_change_events(self):
        states = []
        transport = _connected_transport()
        client = McpClient(transport=transport)
        client.on("state_change", lambda s: states.append(s))

        await client.connect()
        assert TransportState.CONNECTING in states
        assert TransportState.CONNECTED in states

    def test_unsubscribe(self):
        events = []
        client = McpClient()
        unsub = client.on("connected", lambda: events.append("yes"))

        client._emit("connected")
        assert len(events) == 1

        unsub()
        client._emit("connected")
        assert len(events) == 1  # no new event


# ============================================================================
# call()
# ============================================================================


class TestMcpClientCall:
    """Tests for call() returning CommandResult."""

    @pytest.mark.asyncio
    async def test_call_wraps_in_success(self):
        transport = MockTransport()
        transport.add_mock_response("ping", {"status": "pong"})

        client = await _connected_client(transport)
        result = await client.call("ping", {})

        assert result.success is True
        assert result.data == {"status": "pong"}

    @pytest.mark.asyncio
    async def test_call_returns_command_result_as_is(self):
        transport = MockTransport()
        transport.add_mock_response("cmd", {
            "success": True,
            "data": {"id": "42"},
            "reasoning": "Found it",
        })

        client = await _connected_client(transport)
        result = await client.call("cmd", {})

        assert result.success is True
        assert result.data == {"id": "42"}
        assert result.reasoning == "Found it"

    @pytest.mark.asyncio
    async def test_call_unknown_tool_returns_failure(self):
        transport = MockTransport()
        client = await _connected_client(transport)

        # MockTransport raises ToolNotFoundError which is a TransportError subclass
        result = await client.call("nonexistent", {})
        assert result.success is False

    @pytest.mark.asyncio
    async def test_call_without_connect_raises(self):
        client = McpClient()

        with pytest.raises(RuntimeError, match="not connected"):
            await client.call("test", {})


# ============================================================================
# call_tool()
# ============================================================================


class TestMcpClientCallTool:
    """Tests for call_tool() raw pass-through."""

    @pytest.mark.asyncio
    async def test_call_tool_returns_raw(self):
        transport = MockTransport()
        transport.add_mock_response("raw-tool", {"raw": True})

        client = await _connected_client(transport)
        result = await client.call_tool("raw-tool", {})
        assert result == {"raw": True}


# ============================================================================
# batch()
# ============================================================================


class TestMcpClientBatch:
    """Tests for batch()."""

    @pytest.mark.asyncio
    async def test_batch_calls_afd_batch_tool(self):
        transport = MockTransport()
        transport.add_mock_response("afd.batch", {
            "success": True,
            "results": [{"success": True}],
        })

        client = await _connected_client(transport)
        result = await client.batch([
            {"name": "todo-create", "input": {"title": "Test"}},
        ])

        assert result["success"] is True

        # Verify it called afd.batch
        last = transport.last_call("afd.batch")
        assert last is not None
        assert len(last.arguments["commands"]) == 1


# ============================================================================
# pipe()
# ============================================================================


class TestMcpClientPipe:
    """Tests for pipe()."""

    @pytest.mark.asyncio
    async def test_pipe_calls_afd_pipe_tool(self):
        transport = MockTransport()
        transport.add_mock_response("afd-pipe", {
            "success": True,
            "steps": [],
        })

        client = await _connected_client(transport)
        result = await client.pipe([
            {"command": "user-get", "input": {"id": 1}, "as": "user"},
        ])

        assert result["success"] is True

        last = transport.last_call("afd-pipe")
        assert last is not None
        assert len(last.arguments["steps"]) == 1


# ============================================================================
# create_client factory
# ============================================================================


class TestCreateClient:
    """Tests for create_client factory function."""

    def test_creates_client(self):
        client = create_client("http://localhost:3100/sse")
        assert isinstance(client, McpClient)
        assert client._config.url == "http://localhost:3100/sse"
        assert client._config.transport == "sse"

    def test_custom_params(self):
        client = create_client(
            "http://localhost:3100/message",
            transport="http",
            auto_reconnect=False,
            timeout=5.0,
        )
        assert client._config.transport == "http"
        assert client._config.auto_reconnect is False
        assert client._config.timeout == 5.0


# ============================================================================
# list_tools / get_tools
# ============================================================================


class TestMcpClientTools:
    """Tests for tool listing."""

    @pytest.mark.asyncio
    async def test_list_tools_refreshes(self):
        transport = MockTransport()

        async def handler(args):
            return success({})

        transport.register_tool("a", handler, description="Tool A")
        client = await _connected_client(transport)

        # Add another tool and refresh
        transport.register_tool("b", handler, description="Tool B")
        tools = await client.list_tools()
        assert len(tools) == 2

    @pytest.mark.asyncio
    async def test_get_tools_returns_cached(self):
        transport = MockTransport()

        async def handler(args):
            return success({})

        transport.register_tool("a", handler, description="Tool A")
        client = await _connected_client(transport)

        tools = client.get_tools()
        assert len(tools) == 1
        assert tools[0].name == "a"
