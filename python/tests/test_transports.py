"""Tests for the transport layer."""

import pytest

from afd import success
from afd.transports import (
    MockTransport,
    Transport,
    TransportConfig,
    TransportState,
)
from afd.transports.base import ToolInfo, ToolNotFoundError


# ============================================================================
# TransportConfig tests
# ============================================================================


class TestTransportConfig:
    """Tests for TransportConfig."""

    def test_default_values(self):
        config = TransportConfig()
        assert config.timeout_ms == 30000
        assert config.retry_attempts == 3
        assert config.retry_delay_ms == 1000
        assert config.extra == {}

    def test_custom_values(self):
        config = TransportConfig(
            timeout_ms=5000,
            retry_attempts=5,
            extra={"custom": "value"},
        )
        assert config.timeout_ms == 5000
        assert config.retry_attempts == 5
        assert config.extra == {"custom": "value"}


class TestTransportState:
    """Tests for TransportState enum."""

    def test_all_states_defined(self):
        assert TransportState.DISCONNECTED == "disconnected"
        assert TransportState.CONNECTING == "connecting"
        assert TransportState.CONNECTED == "connected"
        assert TransportState.RECONNECTING == "reconnecting"
        assert TransportState.ERROR == "error"


# ============================================================================
# MockTransport tests
# ============================================================================


class TestMockTransportBasics:
    """Basic tests for MockTransport."""

    def test_initial_state(self):
        transport = MockTransport()
        assert transport.state == TransportState.DISCONNECTED
        assert transport.calls == []

    @pytest.mark.asyncio
    async def test_connect(self):
        transport = MockTransport()
        await transport.connect()
        assert transport.state == TransportState.CONNECTED

    @pytest.mark.asyncio
    async def test_disconnect(self):
        transport = MockTransport()
        await transport.connect()
        await transport.disconnect()
        assert transport.state == TransportState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_connect_failure(self):
        transport = MockTransport()
        transport.set_should_fail_connect(True, "Test error")
        
        with pytest.raises(ConnectionError, match="Test error"):
            await transport.connect()
        
        assert transport.state == TransportState.ERROR


class TestMockTransportTools:
    """Tests for MockTransport tool handling."""

    @pytest.mark.asyncio
    async def test_register_and_call_tool(self):
        transport = MockTransport()
        await transport.connect()
        
        async def echo(args):
            return success({"echo": args.get("message", "")})
        
        transport.register_tool("echo", echo)
        result = await transport.call_tool("echo", {"message": "hello"})
        
        assert result.success is True
        assert result.data["echo"] == "hello"

    @pytest.mark.asyncio
    async def test_mock_response(self):
        transport = MockTransport()
        await transport.connect()
        
        transport.add_mock_response("ping", {"status": "pong"})
        result = await transport.call_tool("ping", {})
        
        assert result == {"status": "pong"}

    @pytest.mark.asyncio
    async def test_tool_not_found(self):
        transport = MockTransport()
        await transport.connect()
        
        with pytest.raises(ToolNotFoundError) as exc:
            await transport.call_tool("nonexistent", {})
        
        assert exc.value.tool_name == "nonexistent"

    @pytest.mark.asyncio
    async def test_list_tools(self):
        transport = MockTransport()
        
        async def tool1(args):
            return success({})
        
        transport.register_tool("tool1", tool1, description="First tool")
        transport.add_mock_response("tool2", {})
        
        tools = await transport.list_tools()
        names = [t.name for t in tools]
        
        assert "tool1" in names
        assert "tool2" in names


class TestMockTransportCallRecording:
    """Tests for MockTransport call recording."""

    @pytest.mark.asyncio
    async def test_records_calls(self):
        transport = MockTransport()
        await transport.connect()
        
        transport.add_mock_response("ping", {"status": "pong"})
        
        await transport.call_tool("ping", {"a": 1})
        await transport.call_tool("ping", {"b": 2})
        
        assert transport.call_count("ping") == 2
        assert transport.call_count() == 2

    @pytest.mark.asyncio
    async def test_last_call(self):
        transport = MockTransport()
        await transport.connect()
        
        transport.add_mock_response("ping", {"status": "pong"})
        
        await transport.call_tool("ping", {"x": 1})
        await transport.call_tool("ping", {"x": 2})
        
        last = transport.last_call("ping")
        assert last is not None
        assert last.arguments == {"x": 2}

    @pytest.mark.asyncio
    async def test_get_calls(self):
        transport = MockTransport()
        await transport.connect()
        
        transport.add_mock_response("a", "response_a")
        transport.add_mock_response("b", "response_b")
        
        await transport.call_tool("a", {"v": 1})
        await transport.call_tool("b", {"v": 2})
        await transport.call_tool("a", {"v": 3})
        
        a_calls = transport.get_calls("a")
        assert len(a_calls) == 2
        assert a_calls[0].arguments == {"v": 1}
        assert a_calls[1].arguments == {"v": 3}

    @pytest.mark.asyncio
    async def test_clear_calls(self):
        transport = MockTransport()
        await transport.connect()
        
        transport.add_mock_response("ping", {})
        await transport.call_tool("ping", {})
        
        assert transport.call_count() == 1
        transport.clear_calls()
        assert transport.call_count() == 0

    @pytest.mark.asyncio
    async def test_reset(self):
        transport = MockTransport()
        await transport.connect()
        
        async def tool(args):
            return success({})
        
        transport.register_tool("tool", tool)
        transport.add_mock_response("mock", {})
        await transport.call_tool("tool", {})
        
        transport.reset()
        
        assert transport.state == TransportState.DISCONNECTED
        assert transport.call_count() == 0
        assert await transport.list_tools() == []


class TestMockTransportProtocol:
    """Tests that MockTransport implements Transport protocol."""

    def test_implements_protocol(self):
        transport = MockTransport()
        assert isinstance(transport, Transport)

    @pytest.mark.asyncio
    async def test_protocol_methods(self):
        transport = MockTransport()
        
        # Connect
        await transport.connect()
        assert transport.state == TransportState.CONNECTED
        
        # List tools
        tools = await transport.list_tools()
        assert isinstance(tools, list)
        
        # Disconnect
        await transport.disconnect()
        assert transport.state == TransportState.DISCONNECTED


class TestToolInfo:
    """Tests for ToolInfo dataclass."""

    def test_basic_tool_info(self):
        info = ToolInfo(name="test", description="Test tool")
        assert info.name == "test"
        assert info.description == "Test tool"
        assert info.input_schema is None

    def test_tool_info_with_schema(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
        }
        info = ToolInfo(name="test", description="Test", input_schema=schema)
        assert info.input_schema == schema


class TestFastMCPTransportRunAsync:
    """run_async used to call FastMCP.run_async, which does not exist."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("transport_name", "method"),
        [
            ("stdio", "run_stdio_async"),
            ("sse", "run_sse_async"),
            ("streamable-http", "run_streamable_http_async"),
        ],
    )
    async def test_dispatches_to_the_fastmcp_runner(self, monkeypatch, transport_name, method):
        from unittest.mock import AsyncMock

        from afd.transports import FastMCPTransport

        transport = FastMCPTransport(server_name="run-test")
        await transport.connect()
        runner = AsyncMock()
        monkeypatch.setattr(transport.mcp, method, runner)

        await transport.run_async(transport_name)

        runner.assert_awaited_once_with()

    @pytest.mark.asyncio
    async def test_unknown_transport_raises(self):
        from afd.transports import FastMCPTransport

        transport = FastMCPTransport(server_name="run-test")
        await transport.connect()

        with pytest.raises(ValueError, match="Unknown transport"):
            await transport.run_async("carrier-pigeon")
