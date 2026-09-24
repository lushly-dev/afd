"""Handoff connection client for AFD commands.

Provides protocol handlers and connection management for handoff results,
allowing clients to connect to streaming protocols (WebSocket, SSE, etc.)
returned by handoff commands.

The built-in handlers read the connection in a background task: every message
reaches ``on_message``, and a close by the server reaches ``on_disconnect``.
A credentials token is sent in an ``Authorization: Bearer`` header, never in
the URL.

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

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass
from enum import Enum
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Optional,
    Protocol,
    Set,
    Tuple,
    runtime_checkable,
)
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

logger = logging.getLogger("afd.handoff")

DEFAULT_OPEN_TIMEOUT_S = 10.0
"""Seconds the built-in handlers wait for a WebSocket or SSE handshake."""


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
        ...     async def close(self): ...
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

    async def close(self) -> None:
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
        on_connect: Called when the connection is established (receives the connection).
        on_message: Called when a message is received.
        on_disconnect: Called with (code, reason) when the connection closes,
            whether the server or ``close()`` closed it.
        on_error: Called when an error occurs.
        on_state_change: Called when connection state changes.
    """

    on_connect: Optional[Callable[[Any], None]] = None
    on_message: Optional[Callable[[Any], None]] = None
    on_disconnect: Optional[Callable[[Optional[int], Optional[str]], None]] = None
    on_error: Optional[Callable[[Exception], None]] = None
    on_state_change: Optional[Callable[[HandoffConnectionState], None]] = None


def _call_safely(callback: Optional[Callable[..., Any]], *args: Any) -> None:
    """Run a user callback. An exception is logged, never raised into our tasks."""
    if callback is None:
        return
    try:
        callback(*args)
    except Exception:
        logger.exception("Handoff callback %r raised", callback)


def _field(mapping: Any, camel: str, snake: str, default: Any = None) -> Any:
    """A handoff field by its wire (camelCase) or snake_case name."""
    if not isinstance(mapping, dict):
        return default
    if camel in mapping:
        return mapping[camel]
    return mapping.get(snake, default)


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

    connection = await handler(handoff, options or HandoffConnectionOptions())
    await connection.connect()
    return connection


async def _close_quietly(connection: Any) -> None:
    """Close a connection, logging (not raising) a failure."""
    try:
        await connection.close()
    except Exception:
        logger.debug("Closing handoff connection failed", exc_info=True)


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
    on_connect: Optional[Callable[[Any], None]] = None
    on_message: Optional[Callable[[Any], None]] = None
    on_disconnect: Optional[Callable[[Optional[int], Optional[str]], None]] = None
    on_error: Optional[Callable[[Exception], None]] = None
    on_state_change: Optional[Callable[[HandoffConnectionState], None]] = None
    on_reconnect: Optional[Callable[[int], None]] = None
    on_reconnect_failed: Optional[Callable[[], None]] = None


class ReconnectingHandoffConnection:
    """Wraps a HandoffConnection with automatic reconnection logic.

    Provides exponential backoff and session resumption via a reconnect command.
    Each underlying connection has a generation number: events from an older
    connection are ignored, so a late disconnect can never start a second
    reconnect loop. ``close()`` cancels a reconnect in progress and closes any
    connection it opened, and every background task is kept and awaited.

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
        self._connection: Optional[HandoffConnection] = None
        self._state = HandoffConnectionState.DISCONNECTED
        self._reconnect_attempt = 0
        self._is_reconnecting = False
        self._closed = False
        self._generation = 0
        self._connected_generation = -1
        self._reconnect_task: Optional[asyncio.Task[None]] = None
        self._tasks: Set[asyncio.Task[Any]] = set()

        # Resolve reconnection defaults from handoff metadata (TS parity)
        metadata_reconnect = _field(handoff.get("metadata"), "reconnect", "reconnect") or {}
        resolved = ReconnectionOptions(
            reconnect_command=options.reconnect_command,
            reconnect_args=options.reconnect_args,
            session_id=options.session_id,
            max_attempts=(
                options.max_attempts
                if options.max_attempts != 5
                else _field(metadata_reconnect, "maxAttempts", "max_attempts", 5)
            ),
            backoff_ms=(
                options.backoff_ms
                if options.backoff_ms != 1000
                else _field(metadata_reconnect, "backoffMs", "backoff_ms", 1000)
            ),
            max_backoff_ms=options.max_backoff_ms,
            on_connect=options.on_connect,
            on_message=options.on_message,
            on_disconnect=options.on_disconnect,
            on_error=options.on_error,
            on_state_change=options.on_state_change,
            on_reconnect=options.on_reconnect,
            on_reconnect_failed=options.on_reconnect_failed,
        )
        self._options = resolved

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
        _call_safely(self._options.on_state_change, new_state)

    def _active(self, generation: int) -> bool:
        return not self._closed and generation == self._generation

    def _track(self, task: "asyncio.Task[Any]") -> "asyncio.Task[Any]":
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def _connect(self, reconnecting: bool = False) -> None:
        """Open a new underlying connection (a new generation).

        Raises:
            ConnectionError: If ``close()`` ran while the connection was opening
                (the new connection is closed first).
        """
        self._generation += 1
        generation = self._generation
        self._set_state(
            HandoffConnectionState.RECONNECTING if reconnecting else HandoffConnectionState.CONNECTING
        )

        def on_message(message: Any) -> None:
            if self._active(generation):
                _call_safely(self._options.on_message, message)

        def on_error(exc: Exception) -> None:
            if self._active(generation):
                _call_safely(self._options.on_error, exc)

        conn_options = HandoffConnectionOptions(
            on_connect=lambda _connection: self._handle_connect(generation),
            on_message=on_message,
            on_disconnect=lambda code, reason: self._handle_disconnect(generation, code, reason),
            on_error=on_error,
            on_state_change=None,
        )

        connection = await connect_handoff(self._handoff, conn_options)
        if not self._active(generation):
            await _close_quietly(connection)
            raise ConnectionError("Handoff connection was closed while it was opening")
        self._connection = connection
        # Handlers that never call on_connect are connected once connect() returns.
        self._handle_connect(generation)

    def _handle_connect(self, generation: int) -> None:
        if not self._active(generation) or self._connected_generation == generation:
            return
        self._connected_generation = generation
        self._reconnect_attempt = 0
        self._set_state(HandoffConnectionState.CONNECTED)
        _call_safely(self._options.on_connect, self)

    def _handle_disconnect(
        self, generation: int, code: Optional[int] = None, reason: Optional[str] = None
    ) -> None:
        if not self._active(generation):
            return  # an older connection, or close() already reported it
        self._generation += 1  # ignore anything else this connection reports
        self._connection = None

        policy = _field(self._handoff.get("metadata"), "reconnect", "reconnect") or {}
        if policy.get("allowed", True) is False:
            self._set_state(HandoffConnectionState.DISCONNECTED)
            _call_safely(self._options.on_disconnect, code, reason)
            return
        self._start_reconnect()

    def _start_reconnect(self) -> Optional["asyncio.Task[None]"]:
        """Start the reconnect loop, or return the one already running."""
        if self._closed:
            return None
        if self._reconnect_task is not None and not self._reconnect_task.done():
            return self._reconnect_task
        self._generation += 1
        previous, self._connection = self._connection, None
        if previous is not None:
            self._track(asyncio.ensure_future(_close_quietly(previous)))
        task = asyncio.ensure_future(self._attempt_reconnect())
        self._reconnect_task = task
        self._track(task)
        return task

    async def _attempt_reconnect(self) -> None:
        """Reconnect with exponential backoff until connected, closed or out of attempts.

        A failed attempt schedules the next one, so the connection ends either
        CONNECTED, FAILED (``on_reconnect_failed``) or closed.
        """
        if self._closed:
            return
        self._is_reconnecting = True
        try:
            while not self._closed:
                self._reconnect_attempt += 1
                attempt = self._reconnect_attempt
                if attempt > self._options.max_attempts:
                    self._set_state(HandoffConnectionState.FAILED)
                    _call_safely(self._options.on_reconnect_failed)
                    return

                self._set_state(HandoffConnectionState.RECONNECTING)
                _call_safely(self._options.on_reconnect, attempt)
                delay_ms = min(
                    self._options.backoff_ms * (2 ** (attempt - 1)) + random.random() * 100,
                    self._options.max_backoff_ms,
                )
                await asyncio.sleep(delay_ms / 1000.0)
                if self._closed:
                    return

                if self._options.reconnect_command and self._client is not None:
                    await self._refresh_handoff()
                    if self._closed:
                        return

                try:
                    await self._connect(reconnecting=True)
                except Exception as exc:
                    if not self._closed:
                        _call_safely(self._options.on_error, exc)
                    continue
                self._reconnect_attempt = 0
                return
        finally:
            self._is_reconnecting = False

    async def _refresh_handoff(self) -> None:
        """Ask the reconnect command for a fresh handoff (keep the old one on failure)."""
        from afd.core.handoff import is_handoff

        args = dict(self._options.reconnect_args or {})
        if self._options.session_id:
            args["session_id"] = self._options.session_id
        try:
            result = await self._client.call(self._options.reconnect_command, args)
        except Exception as exc:
            _call_safely(self._options.on_error, exc)
            return
        data = getattr(result, "data", None)
        if getattr(result, "success", False) and data and is_handoff(data):
            self._handoff = dict(data)

    async def send(self, data: Any) -> None:
        """Send data through the connection.

        Raises:
            RuntimeError: If the connection is not in connected state.
        """
        if not self._connection or self._state != HandoffConnectionState.CONNECTED:
            raise RuntimeError("Cannot send: connection not in connected state")
        await self._connection.send(data)

    async def close(self) -> None:
        """Close the connection and stop reconnection attempts.

        Cancels a reconnect in progress, waits for every background task, and
        closes the current connection, so nothing stays open afterwards.
        """
        if self._closed:
            return
        self._closed = True
        self._is_reconnecting = False
        self._generation += 1

        current = asyncio.current_task()
        if self._reconnect_task is not None and self._reconnect_task is not current:
            self._reconnect_task.cancel()
        pending = [task for task in self._tasks if task is not current]
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

        connection, self._connection = self._connection, None
        if connection is not None:
            await _close_quietly(connection)
        self._set_state(HandoffConnectionState.DISCONNECTED)
        _call_safely(self._options.on_disconnect, None, None)

    async def reconnect(self) -> None:
        """Manually trigger a reconnection and wait for it to finish.

        Raises:
            RuntimeError: If the connection was closed.
        """
        if self._closed:
            raise RuntimeError("Cannot reconnect a closed connection")
        self._reconnect_attempt = 0
        task = self._start_reconnect()
        if task is not None:
            # Cancelling the caller must not kill the loop; close() stops it.
            await asyncio.shield(task)


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


def _auth_headers(credentials: Any, base: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Connection headers: base headers, credentials headers, and the bearer token.

    The token becomes ``Authorization: Bearer <token>`` unless the credentials
    already set an Authorization header. It is never put in the URL, where it
    would reach server and proxy logs.
    """
    headers: Dict[str, str] = dict(base or {})
    if not isinstance(credentials, dict):
        return headers
    extra = credentials.get("headers")
    if isinstance(extra, dict):
        headers.update({str(key): str(value) for key, value in extra.items()})
    token = credentials.get("token")
    if token and not any(key.lower() == "authorization" for key in headers):
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _decode_message(raw: Any) -> Any:
    """A JSON message as its value; anything else (text or bytes) unchanged."""
    text = raw
    if isinstance(raw, (bytes, bytearray)):
        try:
            text = bytes(raw).decode("utf-8")
        except UnicodeDecodeError:
            return raw
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return raw


class _StreamConnection:
    """Shared lifecycle of the built-in connections.

    ``connect()`` opens the transport and starts a reader task that dispatches
    every message and reports the disconnect when the stream ends. ``close()``
    stops the reader, closes the transport and reports the disconnect once.
    """

    def __init__(
        self,
        endpoint: str,
        headers: Dict[str, str],
        options: HandoffConnectionOptions,
        protocol: str,
        open_timeout: float = DEFAULT_OPEN_TIMEOUT_S,
    ) -> None:
        self._endpoint_url = endpoint
        self._headers = headers
        self._options = options
        self._protocol_name = protocol
        self._open_timeout = open_timeout
        self._state = HandoffConnectionState.DISCONNECTED
        self._message_callbacks: List[Callable[[Any], None]] = []
        self._error_callbacks: List[Callable[[Exception], None]] = []
        self._close_callbacks: List[Callable[[], None]] = []
        self._reader: Optional[asyncio.Task[None]] = None
        self._closed = False
        self._finished = False

    # Transport hooks for subclasses.
    async def _open(self) -> None:
        raise NotImplementedError

    async def _read_loop(self) -> Tuple[Optional[int], Optional[str]]:
        raise NotImplementedError

    async def _close_transport(self) -> None:
        raise NotImplementedError

    def _set_state(self, state: HandoffConnectionState) -> None:
        self._state = state
        _call_safely(self._options.on_state_change, state)

    def _emit_message(self, message: Any) -> None:
        _call_safely(self._options.on_message, message)
        for callback in list(self._message_callbacks):
            _call_safely(callback, message)

    def _emit_error(self, exc: Exception) -> None:
        _call_safely(self._options.on_error, exc)
        for callback in list(self._error_callbacks):
            _call_safely(callback, exc)

    def _finish(self, code: Optional[int], reason: Optional[str]) -> None:
        """Report the disconnect (once)."""
        if self._finished:
            return
        self._finished = True
        self._set_state(HandoffConnectionState.DISCONNECTED)
        for callback in list(self._close_callbacks):
            _call_safely(callback)
        _call_safely(self._options.on_disconnect, code, reason)

    async def connect(self) -> None:
        if self._closed:
            raise RuntimeError("Cannot connect: the connection was closed")
        self._set_state(HandoffConnectionState.CONNECTING)
        try:
            await self._open()
        except BaseException:
            self._set_state(HandoffConnectionState.FAILED)
            raise
        if self._closed:  # close() ran during the handshake
            await self._close_transport()
            return
        self._set_state(HandoffConnectionState.CONNECTED)
        self._reader = asyncio.ensure_future(self._run_reader())
        _call_safely(self._options.on_connect, self)

    async def _run_reader(self) -> None:
        code: Optional[int] = None
        reason: Optional[str] = None
        try:
            code, reason = await self._read_loop()
        except asyncio.CancelledError:
            raise  # close() reports the disconnect
        except Exception as exc:
            if not self._closed:
                self._emit_error(exc)
        if self._closed:
            return
        await self._close_transport()
        self._finish(code, reason)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        reader = self._reader
        if reader is not None and reader is not asyncio.current_task() and not reader.done():
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)
        await self._close_transport()
        self._finish(1000, "Client close")

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


class WebSocketHandoffHandler:
    """WebSocket protocol handler using the ``websockets`` library (14+)."""

    @staticmethod
    async def handle(
        handoff: Dict[str, Any],
        options: HandoffConnectionOptions,
    ) -> HandoffConnection:
        """Create a WebSocket connection from a handoff result."""
        try:
            import websockets  # noqa: F401
        except ImportError as e:
            raise ImportError(
                "websockets is required for WebSocket handoff connections. "
                "Install with: pip install afd[client]"
            ) from e

        return _WebSocketConnection(
            endpoint=handoff["endpoint"],
            headers=_auth_headers(handoff.get("credentials")),
            options=options,
            protocol=handoff.get("protocol", "websocket"),
        )


class _WebSocketConnection(_StreamConnection):
    """Internal WebSocket HandoffConnection implementation."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._ws: Any = None

    async def _open(self) -> None:
        from websockets.asyncio.client import connect

        self._ws = await connect(
            self._endpoint_url,
            additional_headers=self._headers or None,
            open_timeout=self._open_timeout,
        )

    async def _read_loop(self) -> Tuple[Optional[int], Optional[str]]:
        from websockets.exceptions import ConnectionClosed

        ws = self._ws
        try:
            async for raw in ws:
                self._emit_message(_decode_message(raw))
        except ConnectionClosed:
            pass  # an abnormal close; the code says why
        return ws.close_code, ws.close_reason

    async def _close_transport(self) -> None:
        ws = self._ws
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                logger.debug("Closing WebSocket failed", exc_info=True)

    async def send(self, data: Any) -> None:
        if self._ws is None or self._state != HandoffConnectionState.CONNECTED:
            raise RuntimeError("Cannot send: WebSocket is not in connected state")
        await self._ws.send(data if isinstance(data, (str, bytes)) else json.dumps(data))


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

        return _SseConnection(
            endpoint=handoff["endpoint"],
            headers=_auth_headers(
                handoff.get("credentials"), {"Accept": "text/event-stream"}
            ),
            options=options,
            protocol=handoff.get("protocol", "sse"),
        )


class _SseConnection(_StreamConnection):
    """Internal SSE HandoffConnection: a streaming GET read by ``httpx``.

    Each event's ``data`` reaches ``on_message`` (parsed as JSON when it is
    JSON). The connection is server-push only.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._client: Any = None
        self._response: Any = None

    async def _open(self) -> None:
        import httpx

        self._client = httpx.AsyncClient(timeout=httpx.Timeout(self._open_timeout, read=None))
        try:
            request = self._client.build_request("GET", self._endpoint_url, headers=self._headers)
            self._response = await self._client.send(request, stream=True)
            if not self._response.is_success:
                raise ConnectionError(
                    f"SSE handoff endpoint returned HTTP {self._response.status_code}"
                )
            content_type = self._response.headers.get("content-type", "")
            if not content_type.startswith("text/event-stream"):
                raise ConnectionError(
                    "SSE handoff endpoint did not return text/event-stream "
                    f"(got {content_type or 'no content type'})"
                )
        except BaseException:
            await self._close_transport()
            raise

    async def _read_loop(self) -> Tuple[Optional[int], Optional[str]]:
        from afd.core.sse import SseDecoder

        decoder = SseDecoder()
        async for line in self._response.aiter_lines():
            event = decoder.decode(line)
            if event is not None:
                self._emit_message(_decode_message(event.data))
        return None, "Stream ended"

    async def _close_transport(self) -> None:
        response, self._response = self._response, None
        client, self._client = self._client, None
        try:
            if response is not None:
                await response.aclose()
        except Exception:
            logger.debug("Closing SSE response failed", exc_info=True)
        try:
            if client is not None:
                await client.aclose()
        except Exception:
            logger.debug("Closing SSE client failed", exc_info=True)

    async def send(self, data: Any) -> None:
        raise NotImplementedError("SSE connections are server-push only; send() is not supported")


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

    The built-in handlers do not use this: they send the token in an
    ``Authorization`` header, because a token in a URL reaches server and
    proxy logs. Use it only for a custom handler whose server requires it.

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


def _expiry_timestamp(handoff: Dict[str, Any]) -> Optional[float]:
    """The handoff's expiry as a POSIX timestamp, or None if absent or invalid."""
    expires_at = _field(handoff.get("metadata"), "expiresAt", "expires_at")
    if not isinstance(expires_at, str) or not expires_at:
        return None

    from datetime import datetime

    try:
        return datetime.fromisoformat(expires_at.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def is_handoff_expired(handoff: Dict[str, Any]) -> bool:
    """Check if handoff credentials have expired.

    Args:
        handoff: HandoffResult dict (``expiresAt`` or ``expires_at``).

    Returns:
        True if credentials have expired.

    Example:
        >>> is_handoff_expired({"protocol": "ws", "endpoint": "ws://x",
        ...     "metadata": {"expiresAt": "2020-01-01T00:00:00Z"}})
        True
    """
    expiry = _expiry_timestamp(handoff)
    return expiry is not None and expiry < time.time()


def get_handoff_ttl(handoff: Dict[str, Any]) -> Optional[int]:
    """Get the time until handoff credentials expire in milliseconds.

    Args:
        handoff: HandoffResult dict (``expiresAt`` or ``expires_at``).

    Returns:
        Milliseconds until expiration, None if no expiration set, 0 if expired.

    Example:
        >>> get_handoff_ttl({"protocol": "ws", "endpoint": "ws://x"})  # no expiry
    """
    expiry = _expiry_timestamp(handoff)
    if expiry is None:
        return None
    ttl_ms = int((expiry - time.time()) * 1000)
    return ttl_ms if ttl_ms > 0 else 0
