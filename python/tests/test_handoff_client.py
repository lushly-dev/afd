"""Tests for handoff client connection layer.

Tests cover:
- HandoffConnectionState enum
- Protocol handler registry (register, unregister, list, clear)
- connect_handoff dispatch
- ReconnectingHandoffConnection (backoff, reconnect command, callbacks)
- Utility functions (build_authenticated_endpoint, parse_handoff_endpoint, etc.)
- DirectClient convenience methods
"""

# afd-override: max-lines=500

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from afd.handoff_client import (
    HandoffConnection,
    HandoffConnectionOptions,
    HandoffConnectionState,
    ReconnectingHandoffConnection,
    ReconnectionOptions,
    build_authenticated_endpoint,
    clear_handoff_handlers,
    connect_handoff,
    create_reconnecting_handoff,
    get_handoff_handler,
    get_handoff_ttl,
    has_handoff_handler,
    is_handoff_expired,
    list_handoff_handlers,
    parse_handoff_endpoint,
    register_builtin_handlers,
    register_handoff_handler,
    unregister_handoff_handler,
)


# ═══════════════════════════════════════════════════════════════════════════════
# TEST HELPERS
# ═══════════════════════════════════════════════════════════════════════════════


class MockConnection:
    """A mock HandoffConnection for testing."""

    def __init__(
        self,
        protocol: str = "mock",
        endpoint: str = "mock://test",
    ) -> None:
        self._protocol = protocol
        self._endpoint = endpoint
        self._state = HandoffConnectionState.DISCONNECTED
        self._message_callbacks: List[Callable] = []
        self._error_callbacks: List[Callable] = []
        self._close_callbacks: List[Callable] = []
        self.connect_count = 0
        self.disconnect_count = 0
        self.sent_data: List[Any] = []

    async def connect(self) -> None:
        self.connect_count += 1
        self._state = HandoffConnectionState.CONNECTED

    async def disconnect(self) -> None:
        self.disconnect_count += 1
        self._state = HandoffConnectionState.DISCONNECTED

    async def send(self, data: Any) -> None:
        self.sent_data.append(data)

    def on_message(self, callback: Callable) -> None:
        self._message_callbacks.append(callback)

    def on_error(self, callback: Callable) -> None:
        self._error_callbacks.append(callback)

    def on_close(self, callback: Callable) -> None:
        self._close_callbacks.append(callback)

    @property
    def is_connected(self) -> bool:
        return self._state == HandoffConnectionState.CONNECTED

    @property
    def state(self) -> HandoffConnectionState:
        return self._state

    @property
    def protocol(self) -> str:
        return self._protocol

    @property
    def endpoint(self) -> str:
        return self._endpoint


@pytest.fixture(autouse=True)
def _clean_handlers():
    """Clear protocol handlers before and after each test."""
    clear_handoff_handlers()
    yield
    clear_handoff_handlers()


# ═══════════════════════════════════════════════════════════════════════════════
# HandoffConnectionState
# ═══════════════════════════════════════════════════════════════════════════════


class TestHandoffConnectionState:
    """Tests for HandoffConnectionState enum."""

    def test_enum_values(self):
        assert HandoffConnectionState.CONNECTING == "connecting"
        assert HandoffConnectionState.CONNECTED == "connected"
        assert HandoffConnectionState.RECONNECTING == "reconnecting"
        assert HandoffConnectionState.DISCONNECTED == "disconnected"
        assert HandoffConnectionState.FAILED == "failed"

    def test_all_states_exist(self):
        states = [s.value for s in HandoffConnectionState]
        assert len(states) == 5
        assert "connecting" in states
        assert "connected" in states
        assert "reconnecting" in states
        assert "disconnected" in states
        assert "failed" in states

    def test_is_string_enum(self):
        assert isinstance(HandoffConnectionState.CONNECTED, str)
        assert HandoffConnectionState.CONNECTED == "connected"


# ═══════════════════════════════════════════════════════════════════════════════
# Protocol Handler Registry
# ═══════════════════════════════════════════════════════════════════════════════


class TestProtocolHandlerRegistry:
    """Tests for protocol handler registration."""

    def test_register_handler(self):
        async def mock_handler(handoff, options):
            return MockConnection()

        register_handoff_handler("test-proto", mock_handler)
        assert has_handoff_handler("test-proto") is True
        assert get_handoff_handler("test-proto") is mock_handler

    def test_unregister_handler(self):
        async def mock_handler(handoff, options):
            return MockConnection()

        register_handoff_handler("test-proto", mock_handler)
        assert unregister_handoff_handler("test-proto") is True
        assert has_handoff_handler("test-proto") is False

    def test_unregister_nonexistent_returns_false(self):
        assert unregister_handoff_handler("nonexistent") is False

    def test_has_handler(self):
        assert has_handoff_handler("nope") is False

        async def handler(h, o):
            return MockConnection()

        register_handoff_handler("nope", handler)
        assert has_handoff_handler("nope") is True

    def test_list_handlers(self):
        assert list_handoff_handlers() == []

        async def h1(handoff, options):
            return MockConnection()

        async def h2(handoff, options):
            return MockConnection()

        register_handoff_handler("ws", h1)
        register_handoff_handler("sse", h2)
        assert sorted(list_handoff_handlers()) == ["sse", "ws"]

    def test_clear_handlers(self):
        async def handler(h, o):
            return MockConnection()

        register_handoff_handler("a", handler)
        register_handoff_handler("b", handler)
        assert len(list_handoff_handlers()) == 2

        clear_handoff_handlers()
        assert list_handoff_handlers() == []

    def test_override_handler(self):
        async def handler1(h, o):
            return MockConnection(protocol="v1")

        async def handler2(h, o):
            return MockConnection(protocol="v2")

        register_handoff_handler("proto", handler1)
        register_handoff_handler("proto", handler2)
        assert get_handoff_handler("proto") is handler2


# ═══════════════════════════════════════════════════════════════════════════════
# connect_handoff
# ═══════════════════════════════════════════════════════════════════════════════


class TestConnectHandoff:
    """Tests for connect_handoff dispatch."""

    @pytest.mark.asyncio
    async def test_dispatches_to_registered_handler(self):
        mock_conn = MockConnection()

        async def handler(handoff, options):
            return mock_conn

        register_handoff_handler("test-ws", handler)

        result = await connect_handoff(
            {"protocol": "test-ws", "endpoint": "ws://test"}
        )
        assert result is mock_conn

    @pytest.mark.asyncio
    async def test_raises_for_unknown_protocol(self):
        with pytest.raises(ValueError, match="No protocol handler registered for 'unknown'"):
            await connect_handoff(
                {"protocol": "unknown", "endpoint": "unknown://test"}
            )

    @pytest.mark.asyncio
    async def test_error_lists_available_protocols(self):
        async def handler(h, o):
            return MockConnection()

        register_handoff_handler("ws", handler)
        register_handoff_handler("sse", handler)

        with pytest.raises(ValueError, match="Available protocols:"):
            await connect_handoff(
                {"protocol": "webrtc", "endpoint": "webrtc://test"}
            )

    @pytest.mark.asyncio
    async def test_passes_options_to_handler(self):
        captured_options = {}

        async def handler(handoff, options):
            captured_options["options"] = options
            return MockConnection()

        register_handoff_handler("test", handler)

        opts = HandoffConnectionOptions(on_message=lambda msg: None)
        await connect_handoff({"protocol": "test", "endpoint": "test://x"}, opts)
        assert captured_options["options"] is opts

    @pytest.mark.asyncio
    async def test_default_options_when_none(self):
        captured = {}

        async def handler(handoff, options):
            captured["options"] = options
            return MockConnection()

        register_handoff_handler("test", handler)
        await connect_handoff({"protocol": "test", "endpoint": "test://x"})
        assert isinstance(captured["options"], HandoffConnectionOptions)


# ═══════════════════════════════════════════════════════════════════════════════
# ReconnectingHandoffConnection
# ═══════════════════════════════════════════════════════════════════════════════


class TestReconnectingHandoff:
    """Tests for ReconnectingHandoffConnection."""

    @pytest.mark.asyncio
    async def test_initial_connect(self):
        mock_conn = MockConnection()

        async def handler(handoff, options):
            return mock_conn

        register_handoff_handler("mock", handler)

        handoff = {"protocol": "mock", "endpoint": "mock://test"}
        conn = await create_reconnecting_handoff(None, handoff)
        assert conn.protocol == "mock"
        assert conn.endpoint == "mock://test"
        assert mock_conn.connect_count == 1

    @pytest.mark.asyncio
    async def test_send_delegates_to_inner(self):
        mock_conn = MockConnection()

        async def handler(handoff, options):
            return mock_conn

        register_handoff_handler("mock", handler)

        handoff = {"protocol": "mock", "endpoint": "mock://test"}
        conn = await create_reconnecting_handoff(None, handoff)
        # The inner connection is connected after connect()
        conn._state = HandoffConnectionState.CONNECTED
        await conn.send({"msg": "hello"})
        assert mock_conn.sent_data == [{"msg": "hello"}]

    @pytest.mark.asyncio
    async def test_send_raises_when_not_connected(self):
        mock_conn = MockConnection()

        async def handler(handoff, options):
            return mock_conn

        register_handoff_handler("mock", handler)

        handoff = {"protocol": "mock", "endpoint": "mock://test"}
        conn = await create_reconnecting_handoff(None, handoff)
        conn._state = HandoffConnectionState.DISCONNECTED
        with pytest.raises(RuntimeError, match="Cannot send"):
            await conn.send({"msg": "fail"})

    @pytest.mark.asyncio
    async def test_close_sets_disconnected(self):
        mock_conn = MockConnection()

        async def handler(handoff, options):
            return mock_conn

        register_handoff_handler("mock", handler)

        handoff = {"protocol": "mock", "endpoint": "mock://test"}
        conn = await create_reconnecting_handoff(None, handoff)
        await conn.close()
        assert conn.state == HandoffConnectionState.DISCONNECTED
        assert conn._closed is True

    @pytest.mark.asyncio
    @patch("afd.handoff_client.asyncio.sleep", new_callable=AsyncMock)
    async def test_backoff_calculation(self, mock_sleep):
        """Backoff uses exponential formula with jitter."""
        call_count = 0

        async def handler(handoff, options):
            nonlocal call_count
            call_count += 1
            c = MockConnection()
            if call_count <= 2:
                raise ConnectionError("fail")
            return c

        register_handoff_handler("mock", handler)

        handoff = {"protocol": "mock", "endpoint": "mock://test"}
        opts = ReconnectionOptions(
            backoff_ms=1000,
            max_backoff_ms=30000,
            max_attempts=5,
        )
        conn = ReconnectingHandoffConnection(None, handoff, opts)

        # Simulate reconnection attempts
        conn._reconnect_attempt = 0
        await conn._attempt_reconnect()

        # asyncio.sleep should have been called with backoff value (in seconds)
        if mock_sleep.called:
            delay = mock_sleep.call_args[0][0]
            # First attempt: min(1000 * 2^0 + jitter, 30000) / 1000
            assert 1.0 <= delay <= 1.2  # 1000ms + up to 100ms jitter

    @pytest.mark.asyncio
    @patch("afd.handoff_client.asyncio.sleep", new_callable=AsyncMock)
    async def test_reconnect_command_calls_client(self, mock_sleep):
        """Reconnection uses the reconnect command if provided."""
        mock_client = MagicMock()
        new_handoff = {
            "protocol": "mock",
            "endpoint": "mock://reconnected",
            "credentials": None,
            "metadata": None,
        }
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.data = new_handoff
        mock_client.call = AsyncMock(return_value=mock_result)

        connect_calls = []

        async def handler(handoff, options):
            connect_calls.append(handoff.get("endpoint"))
            return MockConnection(endpoint=handoff.get("endpoint", ""))

        register_handoff_handler("mock", handler)

        handoff = {"protocol": "mock", "endpoint": "mock://original"}
        opts = ReconnectionOptions(
            reconnect_command="chat-reconnect",
            reconnect_args={"room": "abc"},
            session_id="session-123",
            max_attempts=3,
        )
        conn = ReconnectingHandoffConnection(mock_client, handoff, opts)
        await conn._attempt_reconnect()

        mock_client.call.assert_called_once_with(
            "chat-reconnect",
            {"room": "abc", "session_id": "session-123"},
        )

    @pytest.mark.asyncio
    @patch("afd.handoff_client.asyncio.sleep", new_callable=AsyncMock)
    async def test_max_attempts_triggers_failed(self, mock_sleep):
        """Exceeding max attempts sets state to failed."""
        failed_called = []

        async def handler(handoff, options):
            raise ConnectionError("always fails")

        register_handoff_handler("mock", handler)

        handoff = {"protocol": "mock", "endpoint": "mock://test"}
        opts = ReconnectionOptions(
            max_attempts=1,
            on_reconnect_failed=lambda: failed_called.append(True),
        )
        conn = ReconnectingHandoffConnection(None, handoff, opts)
        conn._reconnect_attempt = 1  # Already at max

        await conn._attempt_reconnect()
        assert conn.state == HandoffConnectionState.FAILED
        assert len(failed_called) == 1

    @pytest.mark.asyncio
    @patch("afd.handoff_client.asyncio.sleep", new_callable=AsyncMock)
    async def test_on_reconnect_callback(self, mock_sleep):
        """on_reconnect is called with attempt number."""
        attempts = []

        async def handler(handoff, options):
            return MockConnection()

        register_handoff_handler("mock", handler)

        handoff = {"protocol": "mock", "endpoint": "mock://test"}
        opts = ReconnectionOptions(
            max_attempts=3,
            on_reconnect=lambda n: attempts.append(n),
        )
        conn = ReconnectingHandoffConnection(None, handoff, opts)
        await conn._attempt_reconnect()
        assert attempts == [1]

    @pytest.mark.asyncio
    async def test_is_reconnecting_property(self):
        mock_conn = MockConnection()

        async def handler(handoff, options):
            return mock_conn

        register_handoff_handler("mock", handler)

        handoff = {"protocol": "mock", "endpoint": "mock://test"}
        conn = await create_reconnecting_handoff(None, handoff)
        assert conn.is_reconnecting is False
        assert conn.reconnect_attempt == 0


# ═══════════════════════════════════════════════════════════════════════════════
# build_authenticated_endpoint
# ═══════════════════════════════════════════════════════════════════════════════


class TestBuildAuthenticatedEndpoint:
    """Tests for build_authenticated_endpoint utility."""

    def test_no_credentials(self):
        result = build_authenticated_endpoint("wss://example.com/chat")
        assert result == "wss://example.com/chat"

    def test_no_token(self):
        result = build_authenticated_endpoint(
            "wss://example.com/chat",
            {"session_id": "abc"},
        )
        assert result == "wss://example.com/chat"

    def test_appends_token(self):
        result = build_authenticated_endpoint(
            "wss://example.com/chat",
            {"token": "my-token"},
        )
        assert "token=my-token" in result
        assert result.startswith("wss://example.com/chat")

    def test_preserves_existing_query_params(self):
        result = build_authenticated_endpoint(
            "wss://example.com/chat?room=123",
            {"token": "my-token"},
        )
        assert "room=123" in result
        assert "token=my-token" in result

    def test_none_credentials(self):
        result = build_authenticated_endpoint("wss://example.com/chat", None)
        assert result == "wss://example.com/chat"


# ═══════════════════════════════════════════════════════════════════════════════
# parse_handoff_endpoint
# ═══════════════════════════════════════════════════════════════════════════════


class TestParseHandoffEndpoint:
    """Tests for parse_handoff_endpoint utility."""

    def test_ws_url(self):
        result = parse_handoff_endpoint("ws://localhost:8080/chat")
        assert result["protocol"] == "ws"
        assert result["host"] == "localhost"
        assert result["port"] == 8080
        assert result["path"] == "/chat"
        assert result["secure"] is False

    def test_wss_url(self):
        result = parse_handoff_endpoint("wss://example.com/stream")
        assert result["protocol"] == "wss"
        assert result["host"] == "example.com"
        assert result["port"] is None
        assert result["path"] == "/stream"
        assert result["secure"] is True

    def test_https_url(self):
        result = parse_handoff_endpoint("https://api.example.com:443/events")
        assert result["protocol"] == "https"
        assert result["host"] == "api.example.com"
        assert result["port"] == 443
        assert result["secure"] is True

    def test_query_in_path(self):
        result = parse_handoff_endpoint("wss://example.com/chat?room=123&user=bob")
        assert result["path"] == "/chat?room=123&user=bob"

    def test_http_url(self):
        result = parse_handoff_endpoint("http://localhost:3000/sse")
        assert result["protocol"] == "http"
        assert result["secure"] is False


# ═══════════════════════════════════════════════════════════════════════════════
# is_handoff_expired
# ═══════════════════════════════════════════════════════════════════════════════


class TestIsHandoffExpired:
    """Tests for is_handoff_expired utility."""

    def test_no_expiration(self):
        handoff = {"protocol": "ws", "endpoint": "ws://x"}
        assert is_handoff_expired(handoff) is False

    def test_no_metadata(self):
        handoff = {"protocol": "ws", "endpoint": "ws://x", "metadata": None}
        assert is_handoff_expired(handoff) is False

    def test_future_expiration(self):
        handoff = {
            "protocol": "ws",
            "endpoint": "ws://x",
            "metadata": {"expires_at": "2099-12-31T23:59:59Z"},
        }
        assert is_handoff_expired(handoff) is False

    def test_past_expiration(self):
        handoff = {
            "protocol": "ws",
            "endpoint": "ws://x",
            "metadata": {"expires_at": "2020-01-01T00:00:00Z"},
        }
        assert is_handoff_expired(handoff) is True

    def test_no_expires_at_in_metadata(self):
        handoff = {
            "protocol": "ws",
            "endpoint": "ws://x",
            "metadata": {"description": "test"},
        }
        assert is_handoff_expired(handoff) is False


# ═══════════════════════════════════════════════════════════════════════════════
# get_handoff_ttl
# ═══════════════════════════════════════════════════════════════════════════════


class TestGetHandoffTTL:
    """Tests for get_handoff_ttl utility."""

    def test_no_expiration(self):
        handoff = {"protocol": "ws", "endpoint": "ws://x"}
        assert get_handoff_ttl(handoff) is None

    def test_no_metadata(self):
        handoff = {"protocol": "ws", "endpoint": "ws://x", "metadata": None}
        assert get_handoff_ttl(handoff) is None

    def test_positive_ttl(self):
        handoff = {
            "protocol": "ws",
            "endpoint": "ws://x",
            "metadata": {"expires_at": "2099-12-31T23:59:59Z"},
        }
        ttl = get_handoff_ttl(handoff)
        assert ttl is not None
        assert ttl > 0

    def test_expired_returns_zero(self):
        handoff = {
            "protocol": "ws",
            "endpoint": "ws://x",
            "metadata": {"expires_at": "2020-01-01T00:00:00Z"},
        }
        assert get_handoff_ttl(handoff) == 0

    def test_no_expires_at_in_metadata(self):
        handoff = {
            "protocol": "ws",
            "endpoint": "ws://x",
            "metadata": {"description": "test"},
        }
        assert get_handoff_ttl(handoff) is None


# ═══════════════════════════════════════════════════════════════════════════════
# DirectClient Handoff Methods
# ═══════════════════════════════════════════════════════════════════════════════


class TestDirectClientHandoffMethods:
    """Tests for DirectClient handoff convenience methods."""

    @pytest.mark.asyncio
    async def test_client_connect_handoff(self):
        """DirectClient.connect_handoff delegates to module function."""
        from afd.direct import DirectClient, SimpleRegistry

        mock_conn = MockConnection()

        async def handler(handoff, options):
            return mock_conn

        register_handoff_handler("mock", handler)

        registry = SimpleRegistry()
        client = DirectClient(registry)
        handoff = {"protocol": "mock", "endpoint": "mock://test"}

        result = await client.connect_handoff(handoff)
        assert result is mock_conn

    @pytest.mark.asyncio
    async def test_client_create_reconnecting_handoff(self):
        """DirectClient.create_reconnecting_handoff creates a wrapper."""
        from afd.direct import DirectClient, SimpleRegistry

        mock_conn = MockConnection()

        async def handler(handoff, options):
            return mock_conn

        register_handoff_handler("mock", handler)

        registry = SimpleRegistry()
        client = DirectClient(registry)
        handoff = {"protocol": "mock", "endpoint": "mock://test"}

        result = await client.create_reconnecting_handoff(handoff)
        assert isinstance(result, ReconnectingHandoffConnection)
        assert result.protocol == "mock"


# ═══════════════════════════════════════════════════════════════════════════════
# Built-in Handlers
# ═══════════════════════════════════════════════════════════════════════════════


class TestBuiltinHandlers:
    """Tests for built-in handler registration."""

    def test_register_builtin_handlers(self):
        """register_builtin_handlers registers available handlers."""
        register_builtin_handlers()
        # At minimum, the handlers should attempt registration.
        # Whether they succeed depends on installed deps.
        handlers = list_handoff_handlers()
        # We can't guarantee websockets/httpx are installed,
        # but the function should not raise.
        assert isinstance(handlers, list)

    @pytest.mark.asyncio
    async def test_sse_send_raises(self):
        """SSE connections raise NotImplementedError on send."""
        from afd.handoff_client import SseHandoffHandler

        try:
            import httpx  # noqa: F401

            handoff = {
                "protocol": "sse",
                "endpoint": "https://example.com/events",
            }
            conn = await SseHandoffHandler.handle(handoff, HandoffConnectionOptions())
            await conn.connect()
            with pytest.raises(NotImplementedError, match="server-push only"):
                await conn.send({"test": True})
        except ImportError:
            pytest.skip("httpx not installed")
