"""Handoff connection client for AFD commands.

Provides protocol handlers and connection management for handoff results,
allowing clients to connect to streaming protocols (WebSocket, SSE, etc.)
returned by handoff commands.

Example:
    >>> from afd import connect_handoff, register_builtin_handlers
    >>> from afd.core.handoff import is_handoff
    >>>
    >>> register_builtin_handlers()
    >>>
    >>> result = await client.call('chat-connect', {'room_id': 'room-123'})
    >>> if result.success and is_handoff(result.data):
    ...     conn = await connect_handoff(result.data, HandoffConnectionOptions(
    ...         on_message=lambda msg: print('Message:', msg),
    ...     ))
    ...     await conn.send({'type': 'message', 'text': 'Hello!'})
"""

# afd-override: max-lines=500

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Optional,
    Protocol,
    runtime_checkable,
)
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse


# ═══════════════════════════════════════════════════════════════════════════════
# CONNECTION TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class HandoffConnectionState(str, Enum):
    """Connection state for handoff connections."""

    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    DISCONNECTED = "disconnected"
    FAILED = "failed"


@runtime_checkable
class HandoffConnection(Protocol):
    """Protocol for active handoff connections.

    Implement this to create custom protocol handlers.

    Example:
        >>> class MyConnection:
        ...     async def connect(self): ...
        ...     async def disconnect(self): ...
        ...     async def send(self, data): ...
        ...     def on_message(self, callback): ...
        ...     def on_error(self, callback): ...
        ...     def on_close(self, callback): ...
        ...     @property
        ...     def is_connected(self): return True
        ...     @property
        ...     def state(self): return HandoffConnectionState.CONNECTED
        ...     @property
        ...     def protocol(self): return "custom"
        ...     @property
        ...     def endpoint(self): return "wss://example.com"
    """

    async def connect(self) -> None:
        """Establish the connection."""
        ...

    async def disconnect(self) -> None:
        """Close the connection."""
        ...

    async def send(self, data: Any) -> None:
        """Send data through the connection."""
        ...

    def on_message(self, callback: Callable[[Any], None]) -> None:
        """Register a message callback."""
        ...

    def on_error(self, callback: Callable[[Exception], None]) -> None:
        """Register an error callback."""
        ...

    def on_close(self, callback: Callable[[], None]) -> None:
        """Register a close callback."""
        ...

    @property
    def is_connected(self) -> bool:
        """Whether the connection is currently active."""
        ...

    @property
    def state(self) -> HandoffConnectionState:
        """Current connection state."""
        ...

    @property
    def protocol(self) -> str:
        """The protocol of this connection."""
        ...

    @property
    def endpoint(self) -> str:
        """The endpoint URL of this connection."""
        ...


@dataclass
class HandoffConnectionOptions:
    """Options for connecting to a handoff endpoint.

    Attributes:
        on_connect: Called when the connection is established.
        on_message: Called when a message is received.
        on_disconnect: Called when the connection is closed.
        on_error: Called when an error occurs.
        on_state_change: Called when connection state changes.
    """

    on_connect: Optional[Callable[[], None]] = None
    on_message: Optional[Callable[[Any], None]] = None
    on_disconnect: Optional[Callable[[Optional[int], Optional[str]], None]] = None
    on_error: Optional[Callable[[Exception], None]] = None
    on_state_change: Optional[Callable[[HandoffConnectionState], None]] = None


# ═══════════════════════════════════════════════════════════════════════════════
# PROTOCOL HANDLER REGISTRY
# ═══════════════════════════════════════════════════════════════════════════════

ProtocolHandler = Callable[
    [Dict[str, Any], HandoffConnectionOptions],
    Awaitable[HandoffConnection],
]
"""Handler function for a specific protocol.

Takes a handoff dict and connection options, returns a HandoffConnection.
"""

_protocol_handlers: Dict[str, ProtocolHandler] = {}


def register_handoff_handler(protocol: str, handler: ProtocolHandler) -> None:
    """Register a protocol handler.

    Args:
        protocol: Protocol identifier (e.g., 'websocket', 'sse').
        handler: Async function that creates a HandoffConnection.
    """
    _protocol_handlers[protocol] = handler


def unregister_handoff_handler(protocol: str) -> bool:
    """Unregister a protocol handler.

    Returns:
        True if a handler was removed, False if none existed.
    """
    return _protocol_handlers.pop(protocol, None) is not None


def get_handoff_handler(protocol: str) -> Optional[ProtocolHandler]:
    """Get a registered protocol handler."""
    return _protocol_handlers.get(protocol)


def has_handoff_handler(protocol: str) -> bool:
    """Check if a protocol handler is registered."""
    return protocol in _protocol_handlers


def list_handoff_handlers() -> List[str]:
    """List all registered protocol identifiers."""
    return list(_protocol_handlers.keys())


def clear_handoff_handlers() -> None:
    """Clear all registered protocol handlers."""
    _protocol_handlers.clear()


# ═══════════════════════════════════════════════════════════════════════════════
# CONNECTION FACTORY
# ═══════════════════════════════════════════════════════════════════════════════


async def connect_handoff(
    handoff: Dict[str, Any],
    options: Optional[HandoffConnectionOptions] = None,
) -> HandoffConnection:
    """Connect to a handoff endpoint using the appropriate protocol handler.

    Args:
        handoff: HandoffResult dict from a command.
        options: Connection options and callbacks.

    Returns:
        A HandoffConnection for the protocol.

    Raises:
        ValueError: If no handler is registered for the protocol.

    Example:
        >>> conn = await connect_handoff(
        ...     {"protocol": "websocket", "endpoint": "wss://example.com/chat"},
        ...     HandoffConnectionOptions(on_message=lambda msg: print(msg)),
        ... )
    """
    protocol = handoff.get("protocol", "")
    handler = _protocol_handlers.get(protocol)

    if not handler:
        available = ", ".join(list_handoff_handlers()) or "none"
        raise ValueError(
            f"No protocol handler registered for '{protocol}'. "
            f"Available protocols: {available}. "
            f"Register a handler with register_handoff_handler('{protocol}', handler)."
        )

    return await handler(handoff, options or HandoffConnectionOptions())


# ═══════════════════════════════════════════════════════════════════════════════
# RECONNECTION
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class ReconnectionOptions:
    """Options for creating a reconnecting handoff connection.

    Attributes:
        reconnect_command: Command to call for reconnection.
        reconnect_args: Arguments to pass to the reconnect command.
        session_id: Session ID for reconnection.
        max_attempts: Maximum reconnection attempts.
        backoff_ms: Base backoff time in milliseconds.
        max_backoff_ms: Maximum backoff time in milliseconds.
        on_connect: Called when connected.
        on_message: Called on message received.
        on_disconnect: Called on disconnect.
        on_error: Called on error.
        on_state_change: Called on state change.
        on_reconnect: Called when a reconnection attempt starts.
        on_reconnect_failed: Called when all reconnection attempts fail.
    """

    reconnect_command: Optional[str] = None
    reconnect_args: Optional[Dict[str, Any]] = None
    session_id: Optional[str] = None
    max_attempts: int = 5
    backoff_ms: int = 1000
    max_backoff_ms: int = 30000
    on_connect: Optional[Callable[[], None]] = None
    on_message: Optional[Callable[[Any], None]] = None
    on_disconnect: Optional[Callable[[Optional[int], Optional[str]], None]] = None
    on_error: Optional[Callable[[Exception], None]] = None
    on_state_change: Optional[Callable[[HandoffConnectionState], None]] = None
    on_reconnect: Optional[Callable[[int], None]] = None
    on_reconnect_failed: Optional[Callable[[], None]] = None


class ReconnectingHandoffConnection:
    """Wraps a HandoffConnection with automatic reconnection logic.

    Provides exponential backoff and session resumption via a reconnect command.

    Attributes:
        state: Current connection state.
        protocol: The protocol of this connection.
        endpoint: The endpoint URL.
        reconnect_attempt: Current reconnection attempt number.
        is_reconnecting: Whether currently reconnecting.
        is_connected: Whether the connection is active.
    """

    def __init__(
        self,
        client: Any,
        handoff: Dict[str, Any],
        options: ReconnectionOptions,
    ) -> None:
        self._client = client
        self._handoff = dict(handoff)
        self._options = options
        self._connection: Optional[HandoffConnection] = None
        self._state = HandoffConnectionState.DISCONNECTED
        self._reconnect_attempt = 0
        self._is_reconnecting = False
        self._closed = False

    @property
    def state(self) -> HandoffConnectionState:
        return self._state

    @property
    def protocol(self) -> str:
        return self._handoff.get("protocol", "")

    @property
    def endpoint(self) -> str:
        return self._handoff.get("endpoint", "")

    @property
    def reconnect_attempt(self) -> int:
        return self._reconnect_attempt

    @property
    def is_reconnecting(self) -> bool:
        return self._is_reconnecting

    @property
    def is_connected(self) -> bool:
        return self._state == HandoffConnectionState.CONNECTED

    def _set_state(self, new_state: HandoffConnectionState) -> None:
        self._state = new_state
        if self._options.on_state_change:
            self._options.on_state_change(new_state)

    async def _connect(self, reconnecting: bool = False) -> None:
        if reconnecting:
            self._set_state(HandoffConnectionState.RECONNECTING)
        else:
            self._set_state(HandoffConnectionState.CONNECTING)

        conn_options = HandoffConnectionOptions(
            on_connect=self._handle_connect,
            on_message=self._options.on_message,
            on_disconnect=self._handle_disconnect,
            on_error=self._options.on_error,
            on_state_change=None,
        )

        self._connection = await connect_handoff(self._handoff, conn_options)
        await self._connection.connect()

    def _handle_connect(self) -> None:
        self._set_state(HandoffConnectionState.CONNECTED)
        self._reconnect_attempt = 0
        self._is_reconnecting = False
        if self._options.on_connect:
            self._options.on_connect()

    def _handle_disconnect(
        self, code: Optional[int] = None, reason: Optional[str] = None
    ) -> None:
        if self._closed:
            self._set_state(HandoffConnectionState.DISCONNECTED)
            if self._options.on_disconnect:
                self._options.on_disconnect(code, reason)
            return

        max_attempts = self._options.max_attempts
        metadata = self._handoff.get("metadata") or {}
        reconnect_policy = metadata.get("reconnect") or {}
        can_reconnect = (
            reconnect_policy.get("allowed", True) is not False
            and self._reconnect_attempt < max_attempts
        )

        if can_reconnect:
            asyncio.ensure_future(self._attempt_reconnect())
        else:
            self._set_state(HandoffConnectionState.DISCONNECTED)
            if self._options.on_disconnect:
                self._options.on_disconnect(code, reason)

    async def _attempt_reconnect(self) -> None:
        if self._closed or self._is_reconnecting:
            return

        self._is_reconnecting = True
        self._reconnect_attempt += 1

        if self._reconnect_attempt > self._options.max_attempts:
            self._is_reconnecting = False
            self._set_state(HandoffConnectionState.FAILED)
            if self._options.on_reconnect_failed:
                self._options.on_reconnect_failed()
            return

        if self._options.on_reconnect:
            self._options.on_reconnect(self._reconnect_attempt)

        delay_ms = min(
            self._options.backoff_ms * (2 ** (self._reconnect_attempt - 1))
            + random.random() * 100,
            self._options.max_backoff_ms,
        )
        await asyncio.sleep(delay_ms / 1000.0)

        if self._closed:
            return

        if self._options.reconnect_command and self._client is not None:
            try:
                from afd.core.handoff import is_handoff

                args = dict(self._options.reconnect_args or {})
                if self._options.session_id:
                    args["session_id"] = self._options.session_id

                result = await self._client.call(
                    self._options.reconnect_command, args
                )

                if result.success and result.data and is_handoff(result.data):
                    self._handoff = dict(result.data)
            except Exception:
                pass

        try:
            await self._connect(reconnecting=True)
        except Exception:
            if self._reconnect_attempt >= self._options.max_attempts:
                self._is_reconnecting = False
                self._set_state(HandoffConnectionState.FAILED)
                if self._options.on_reconnect_failed:
                    self._options.on_reconnect_failed()

    async def send(self, data: Any) -> None:
        """Send data through the connection.

        Raises:
            RuntimeError: If the connection is not in connected state.
        """
        if not self._connection or self._state != HandoffConnectionState.CONNECTED:
            raise RuntimeError("Cannot send: connection not in connected state")
        await self._connection.send(data)

    async def close(self) -> None:
        """Close the connection and stop reconnection attempts."""
        self._closed = True
        self._is_reconnecting = False
        if self._connection:
            await self._connection.disconnect()
        self._set_state(HandoffConnectionState.DISCONNECTED)

    async def reconnect(self) -> None:
        """Manually trigger a reconnection."""
        if self._is_reconnecting:
            return
        self._reconnect_attempt = 0
        await self._attempt_reconnect()


async def create_reconnecting_handoff(
    client: Any,
    handoff: Dict[str, Any],
    options: Optional[ReconnectionOptions] = None,
) -> ReconnectingHandoffConnection:
    """Create a reconnecting handoff connection with automatic retry logic.

    Args:
        client: DirectClient to use for reconnection commands.
        handoff: The initial handoff result dict.
        options: Reconnection options and callbacks.

    Returns:
        A ReconnectingHandoffConnection with auto-reconnect.

    Example:
        >>> conn = await create_reconnecting_handoff(client, handoff_data,
        ...     ReconnectionOptions(
        ...         reconnect_command='chat-reconnect',
        ...         session_id='session-abc',
        ...         on_reconnect=lambda n: print(f'Reconnecting ({n})'),
        ...     ),
        ... )
    """
    opts = options or ReconnectionOptions()
    conn = ReconnectingHandoffConnection(client, handoff, opts)
    await conn._connect(reconnecting=False)
    return conn


# ═══════════════════════════════════════════════════════════════════════════════
# BUILT-IN HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════


class WebSocketHandoffHandler:
    """WebSocket protocol handler using the ``websockets`` library."""

    @staticmethod
    async def handle(
        handoff: Dict[str, Any],
        options: HandoffConnectionOptions,
    ) -> HandoffConnection:
        """Create a WebSocket connection from a handoff result."""
        try:
            import websockets
        except ImportError as e:
            raise ImportError(
                "websockets is required for WebSocket handoff connections. "
                "Install with: pip install afd[client]"
            ) from e

        endpoint = build_authenticated_endpoint(
            handoff["endpoint"],
            handoff.get("credentials"),
        )
        headers = {}
        creds = handoff.get("credentials")
        if creds and creds.get("headers"):
            headers.update(creds["headers"])

        return _WebSocketConnection(
            endpoint=endpoint,
            headers=headers,
            options=options,
            protocol=handoff.get("protocol", "websocket"),
            raw_endpoint=handoff["endpoint"],
        )


class _WebSocketConnection:
    """Internal WebSocket HandoffConnection implementation."""

    def __init__(
        self,
        endpoint: str,
        headers: Dict[str, str],
        options: HandoffConnectionOptions,
        protocol: str,
        raw_endpoint: str,
    ) -> None:
        self._endpoint_url = endpoint
        self._headers = headers
        self._options = options
        self._protocol_name = protocol
        self._raw_endpoint = raw_endpoint
        self._ws: Any = None
        self._state = HandoffConnectionState.DISCONNECTED
        self._message_callbacks: List[Callable[[Any], None]] = []
        self._error_callbacks: List[Callable[[Exception], None]] = []
        self._close_callbacks: List[Callable[[], None]] = []

    async def connect(self) -> None:
        import websockets

        self._state = HandoffConnectionState.CONNECTING
        if self._options.on_state_change:
            self._options.on_state_change(self._state)

        self._ws = await websockets.connect(
            self._endpoint_url,
            additional_headers=self._headers if self._headers else None,
        )
        self._state = HandoffConnectionState.CONNECTED
        if self._options.on_state_change:
            self._options.on_state_change(self._state)
        if self._options.on_connect:
            self._options.on_connect()

    async def disconnect(self) -> None:
        if self._ws:
            await self._ws.close()
            self._ws = None
        self._state = HandoffConnectionState.DISCONNECTED
        for cb in self._close_callbacks:
            cb()
        if self._options.on_state_change:
            self._options.on_state_change(self._state)

    async def send(self, data: Any) -> None:
        if not self._ws:
            raise RuntimeError("WebSocket is not connected")
        import json

        await self._ws.send(json.dumps(data) if not isinstance(data, str) else data)

    def on_message(self, callback: Callable[[Any], None]) -> None:
        self._message_callbacks.append(callback)

    def on_error(self, callback: Callable[[Exception], None]) -> None:
        self._error_callbacks.append(callback)

    def on_close(self, callback: Callable[[], None]) -> None:
        self._close_callbacks.append(callback)

    @property
    def is_connected(self) -> bool:
        return self._state == HandoffConnectionState.CONNECTED

    @property
    def state(self) -> HandoffConnectionState:
        return self._state

    @property
    def protocol(self) -> str:
        return self._protocol_name

    @property
    def endpoint(self) -> str:
        return self._raw_endpoint


class SseHandoffHandler:
    """SSE (Server-Sent Events) protocol handler using the ``httpx`` library."""

    @staticmethod
    async def handle(
        handoff: Dict[str, Any],
        options: HandoffConnectionOptions,
    ) -> HandoffConnection:
        """Create an SSE connection from a handoff result."""
        try:
            import httpx  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "httpx is required for SSE handoff connections. "
                "Install with: pip install afd[client]"
            ) from e

        endpoint = handoff["endpoint"]
        headers: Dict[str, str] = {"Accept": "text/event-stream"}
        creds = handoff.get("credentials")
        if creds:
            if creds.get("token"):
                headers["Authorization"] = f"Bearer {creds['token']}"
            if creds.get("headers"):
                headers.update(creds["headers"])

        return _SseConnection(
            endpoint=endpoint,
            headers=headers,
            options=options,
            protocol=handoff.get("protocol", "sse"),
        )


class _SseConnection:
    """Internal SSE HandoffConnection implementation."""

    def __init__(
        self,
        endpoint: str,
        headers: Dict[str, str],
        options: HandoffConnectionOptions,
        protocol: str,
    ) -> None:
        self._endpoint_url = endpoint
        self._headers = headers
        self._options = options
        self._protocol_name = protocol
        self._state = HandoffConnectionState.DISCONNECTED
        self._message_callbacks: List[Callable[[Any], None]] = []
        self._error_callbacks: List[Callable[[Exception], None]] = []
        self._close_callbacks: List[Callable[[], None]] = []

    async def connect(self) -> None:
        self._state = HandoffConnectionState.CONNECTED
        if self._options.on_state_change:
            self._options.on_state_change(self._state)
        if self._options.on_connect:
            self._options.on_connect()

    async def disconnect(self) -> None:
        self._state = HandoffConnectionState.DISCONNECTED
        for cb in self._close_callbacks:
            cb()
        if self._options.on_state_change:
            self._options.on_state_change(self._state)

    async def send(self, data: Any) -> None:
        raise NotImplementedError("SSE connections are server-push only; send() is not supported")

    def on_message(self, callback: Callable[[Any], None]) -> None:
        self._message_callbacks.append(callback)

    def on_error(self, callback: Callable[[Exception], None]) -> None:
        self._error_callbacks.append(callback)

    def on_close(self, callback: Callable[[], None]) -> None:
        self._close_callbacks.append(callback)

    @property
    def is_connected(self) -> bool:
        return self._state == HandoffConnectionState.CONNECTED

    @property
    def state(self) -> HandoffConnectionState:
        return self._state

    @property
    def protocol(self) -> str:
        return self._protocol_name

    @property
    def endpoint(self) -> str:
        return self._endpoint_url


def register_builtin_handlers() -> None:
    """Register built-in WebSocket and SSE handlers if their deps are available.

    Silently skips handlers whose dependencies are not installed.
    """
    try:
        import websockets  # noqa: F401
        register_handoff_handler("websocket", WebSocketHandoffHandler.handle)
    except ImportError:
        pass

    try:
        import httpx  # noqa: F401
        register_handoff_handler("sse", SseHandoffHandler.handle)
    except ImportError:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
# UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════


def build_authenticated_endpoint(
    endpoint: str,
    credentials: Optional[Dict[str, Any]] = None,
) -> str:
    """Build an endpoint URL with authentication token as query parameter.

    Args:
        endpoint: The base endpoint URL.
        credentials: Optional credentials dict with 'token' field.

    Returns:
        The URL with token appended if provided.

    Example:
        >>> build_authenticated_endpoint("wss://example.com/chat", {"token": "abc"})
        'wss://example.com/chat?token=abc'
    """
    if not credentials or not credentials.get("token"):
        return endpoint

    parsed = urlparse(endpoint)
    params = parse_qs(parsed.query)
    params["token"] = [credentials["token"]]
    new_query = urlencode(params, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def parse_handoff_endpoint(endpoint: str) -> Dict[str, Any]:
    """Parse a handoff endpoint URL and extract connection details.

    Args:
        endpoint: The endpoint URL.

    Returns:
        Dict with protocol, host, port, path, and secure fields.

    Example:
        >>> parse_handoff_endpoint("wss://example.com:8080/chat?room=1")
        {'protocol': 'wss', 'host': 'example.com', 'port': 8080, 'path': '/chat?room=1', 'secure': True}
    """
    parsed = urlparse(endpoint)
    scheme = parsed.scheme
    is_secure = scheme in ("wss", "https")
    port = parsed.port
    path = parsed.path
    if parsed.query:
        path = f"{path}?{parsed.query}"

    return {
        "protocol": scheme,
        "host": parsed.hostname or "",
        "port": port,
        "path": path,
        "secure": is_secure,
    }


def is_handoff_expired(handoff: Dict[str, Any]) -> bool:
    """Check if handoff credentials have expired.

    Args:
        handoff: HandoffResult dict.

    Returns:
        True if credentials have expired.

    Example:
        >>> is_handoff_expired({"protocol": "ws", "endpoint": "ws://x",
        ...     "metadata": {"expires_at": "2020-01-01T00:00:00Z"}})
        True
    """
    metadata = handoff.get("metadata")
    if not metadata:
        return False

    expires_at = metadata.get("expires_at")
    if not expires_at:
        return False

    from datetime import datetime, timezone

    try:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        return expiry.timestamp() < time.time()
    except (ValueError, AttributeError):
        return False


def get_handoff_ttl(handoff: Dict[str, Any]) -> Optional[int]:
    """Get the time until handoff credentials expire in milliseconds.

    Args:
        handoff: HandoffResult dict.

    Returns:
        Milliseconds until expiration, None if no expiration set, 0 if expired.

    Example:
        >>> get_handoff_ttl({"protocol": "ws", "endpoint": "ws://x"})  # no expiry
    """
    metadata = handoff.get("metadata")
    if not metadata:
        return None

    expires_at = metadata.get("expires_at")
    if not expires_at:
        return None

    from datetime import datetime, timezone

    try:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        ttl_ms = int((expiry.timestamp() - time.time()) * 1000)
        return ttl_ms if ttl_ms > 0 else 0
    except (ValueError, AttributeError):
        return None
