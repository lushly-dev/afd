"""MCP Client for connecting to remote MCP servers.

Provides a high-level client that wraps transport-level operations in
AFD semantics — ``call()`` returns ``CommandResult``, events notify
state changes, and reconnection is handled automatically.

Example:
    >>> from afd.client import McpClient, McpClientConfig
    >>>
    >>> client = McpClient(McpClientConfig(url="http://localhost:3100/sse"))
    >>> await client.connect()
    >>> result = await client.call("todo-create", {"title": "Hello"})
    >>> print(result.data)
    >>> await client.disconnect()
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import (
    Any,
    AsyncGenerator,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    Sequence,
)

from pydantic import ValidationError

from afd.core.result import CommandResult, error as result_error, success
from afd.transports.base import (
    ToolExecutionError,
    ToolNotFoundError,
    ToolInfo,
    TransportError,
    TransportState,
)

# Lazy imports for optional transports
_Transport = Any  # Actual Transport protocol from base

logger = logging.getLogger("afd.client")


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG / STATUS
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class McpClientConfig:
    """Configuration for McpClient.

    Attributes:
        url: Server URL (e.g., ``http://localhost:3100/mcp``).
        endpoint: Alias for ``url`` (preferred in browser SDKs).
        transport: ``"streamable-http"`` (MCP Streamable HTTP; 2026-07-28 when the
            server offers it), or the deprecated ``"sse"`` and ``"http"``
            transports of an AFD server's 2024-11-05 lane. Default: inferred from
            the URL (``sse`` for ``/sse``, ``http`` for ``/message`` or
            ``/messages``, ``streamable-http`` otherwise).
        protocol_mode: Negotiation of the ``streamable-http`` transport:
            ``"auto"`` (default), ``"legacy"`` or ``"modern"``.
        auto_reconnect: Automatically reconnect on disconnect.
        max_reconnect_attempts: Maximum reconnection attempts.
        reconnect_delay: Base delay in seconds between attempts (exponential backoff).
        headers: Custom HTTP headers.
        timeout: Request timeout in seconds (Python convention; TS uses milliseconds).
        client_name: Client name sent in the MCP initialize handshake.
        client_version: Client version sent in the MCP initialize handshake.
        debug: Enable debug logging.
    """

    url: str = ""
    endpoint: Optional[str] = None
    transport: Optional[Literal["streamable-http", "sse", "http"]] = None
    protocol_mode: Literal["auto", "legacy", "modern"] = "auto"
    auto_reconnect: bool = True
    max_reconnect_attempts: int = 5
    reconnect_delay: float = 1.0
    headers: Dict[str, str] = field(default_factory=dict)
    timeout: float = 30.0
    client_name: str = "afd-python-client"
    client_version: str = "0.2.0"
    debug: bool = False

    @property
    def resolved_url(self) -> str:
        """Return ``url`` or ``endpoint``, preferring ``url``."""
        return self.url or self.endpoint or ""

    @property
    def resolved_transport(self) -> str:
        """``transport``, or the one the URL implies."""
        return self.transport or infer_transport(self.resolved_url)


def infer_transport(url: str) -> str:
    """The transport a URL implies: ``sse`` for ``/sse``, ``http`` for ``/message``
    or ``/messages``, ``streamable-http`` otherwise (such as an AFD ``/mcp`` URL)."""
    from urllib.parse import urlsplit

    path = urlsplit(url).path.rstrip("/")
    if path.endswith("/sse"):
        return "sse"
    if path.endswith("/message") or path.endswith("/messages"):
        return "http"
    return "streamable-http"


@dataclass
class ClientStatus:
    """Snapshot of client status.

    Attributes:
        state: Current transport state.
        url: Server URL (None when disconnected).
        server_info: Server info from MCP initialize handshake.
        capabilities: Server capabilities from MCP initialize handshake.
        connected_at: Timestamp of connection.
        reconnect_attempts: Number of reconnection attempts since last connect.
        tools_count: Number of cached tools.
        pending_requests: Number of in-flight requests.
    """

    state: TransportState = TransportState.DISCONNECTED
    url: Optional[str] = None
    server_info: Optional[Dict[str, Any]] = None
    capabilities: Optional[Dict[str, Any]] = None
    connected_at: Optional[datetime] = None
    reconnect_attempts: int = 0
    tools_count: int = 0
    pending_requests: int = 0


# ═══════════════════════════════════════════════════════════════════════════════
# MCP CLIENT
# ═══════════════════════════════════════════════════════════════════════════════


class McpClient:
    """High-level MCP client for consuming remote MCP servers.

    Wraps a ``Transport`` (SSE or HTTP) and provides AFD-compatible
    operations: ``call()`` returns ``CommandResult``, ``batch()`` and
    ``pipe()`` delegate to server-side batch/pipeline commands, and
    ``stream()`` yields SSE chunks.

    Example:
        >>> client = McpClient(McpClientConfig(url="http://localhost:3100/sse"))
        >>> await client.connect()
        >>> result = await client.call("ping", {})
        >>> assert result.success
        >>> await client.disconnect()
    """

    def __init__(
        self,
        config: Optional[McpClientConfig] = None,
        *,
        transport: Optional[Any] = None,
    ) -> None:
        """Initialize the client.

        Args:
            config: Client configuration.
            transport: Optional pre-built transport for testing/DI.
        """
        self._config = config or McpClientConfig()
        self._transport = transport
        self._owns_transport = transport is None
        self._tools: List[ToolInfo] = []
        self._connected_at: Optional[datetime] = None
        self._reconnect_attempts = 0
        self._event_handlers: Dict[str, List[Callable[..., None]]] = {}
        self._generation = 0
        self._active = False
        self._reconnect_task: Optional[asyncio.Task] = None
        self._state = TransportState.DISCONNECTED

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def connect(self) -> None:
        """Connect to the MCP server.

        Creates the transport (if not injected), connects it, and fetches
        the initial tool list.

        Raises:
            TransportError: On connection failure.
            ValueError: If no URL is configured.
        """
        if self.is_connected():
            raise RuntimeError("Already connected")
        await self._stop_reconnect()
        self._generation += 1
        generation = self._generation
        self._active = False
        if self._transport is not None:
            await self._transport.disconnect()
        self._active = True
        self._reconnect_attempts = 0
        if self._transport is None:
            self._transport = _create_transport(self._config)
        self._bind_transport_events()
        self._set_state(TransportState.CONNECTING)
        try:
            await self._transport.connect()
            tools = await self._transport.list_tools()
            if generation != self._generation or not self._active:
                return
            self._tools = tools
            self._connected_at = datetime.now(timezone.utc)
            self._set_state(TransportState.CONNECTED)
            self._emit("connected")
        except BaseException as exc:
            if generation == self._generation:
                self._active = False
                await self._transport.disconnect()
                self._clear_connection()
                self._set_state(TransportState.ERROR)
                if isinstance(exc, Exception):
                    self._emit("error", exc)
            raise

    async def disconnect(self) -> None:
        """Disconnect and cancel any pending reconnect delay or handshake."""
        self._active = False
        self._generation += 1
        await self._stop_reconnect()
        if self._transport:
            await self._transport.disconnect()
        self._clear_connection()
        self._set_state(TransportState.DISCONNECTED)
        self._emit("disconnected", "Manual disconnect")

    def is_connected(self) -> bool:
        """Check if the client and transport are connected."""
        return (
            self._state == TransportState.CONNECTED
            and self._transport is not None
            and self._transport.state == TransportState.CONNECTED
        )

    # ── Tool queries ──────────────────────────────────────────────────────

    async def list_tools(self) -> List[ToolInfo]:
        """Refresh and return the list of available tools."""
        self._require_connected()
        self._tools = await self._request("list_tools")
        return self._tools

    def get_tools(self) -> List[ToolInfo]:
        """Return the cached tools list (no network call)."""
        return list(self._tools)

    # ── Call operations ───────────────────────────────────────────────────

    async def call(
        self,
        name: str,
        args: Optional[Dict[str, Any]] = None,
    ) -> CommandResult:
        """Call a command and return a ``CommandResult``.

        This is the primary method for AFD usage.  The raw MCP result is
        unwrapped: if the data is already a ``CommandResult`` dict (camelCase
        from TypeScript/Rust servers, or snake_case) it is parsed with all its
        fields, including a failure sent with ``isError: true``; otherwise it
        is wrapped in ``success()``.

        Args:
            name: Tool/command name.
            args: Command arguments.

        Returns:
            CommandResult (success or failure).
        """
        self._require_connected()

        try:
            data = await self._request("call_tool", name, args or {})

            # A CommandResult-shaped dict keeps every field it carries
            if isinstance(data, dict) and isinstance(data.get("success"), bool):
                return _parse_command_result(data)

            return success(data)

        except ToolExecutionError as exc:
            return result_error(
                code="TOOL_ERROR",
                message=str(exc),
                suggestion="Check the command input and try again",
            )
        except TransportError as exc:
            return result_error(
                code="TRANSPORT_ERROR",
                message=str(exc),
                suggestion="Check the server connection and try again",
            )
        except Exception as exc:
            return result_error(
                code="CLIENT_ERROR",
                message=str(exc),
                suggestion="Check the command name and arguments",
            )

    async def call_tool(
        self,
        name: str,
        args: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Call a tool and return the raw result (no CommandResult wrapping).

        Args:
            name: Tool name.
            args: Tool arguments.

        Returns:
            Raw tool result.
        """
        self._require_connected()
        return await self._request("call_tool", name, args or {})

    # ── Batch / Pipeline ──────────────────────────────────────────────────

    async def batch(
        self,
        commands: Sequence[Dict[str, Any]],
        options: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Execute a batch of commands via the ``afd-batch`` tool.

        Args:
            commands: List of ``{"name": ..., "input": ...}`` dicts.
            options: Batch options (e.g., ``{"stopOnError": True}``).

        Returns:
            Batch result from the server.
        """
        self._require_connected()
        normalized_commands: list[Dict[str, Any]] = []
        for command in commands:
            payload = dict(command)
            if "command" not in payload and "name" in payload:
                payload["command"] = payload.pop("name")
            normalized_commands.append(payload)
        return await self._request("call_tool", "afd-batch", {
            "commands": normalized_commands,
            "options": options or {},
        })

    async def pipe(
        self,
        steps: Sequence[Dict[str, Any]],
        options: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Execute a pipeline via the ``afd-pipe`` tool.

        Args:
            steps: Pipeline steps with variable references.
            options: Pipeline options.

        Returns:
            Pipeline result from the server.
        """
        self._require_connected()
        return await self._request("call_tool", "afd-pipe", {
            "steps": list(steps),
            "options": options or {},
        })

    # ── Streaming ─────────────────────────────────────────────────────────

    async def stream(
        self,
        name: str,
        args: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream results from a command via SSE.

        POSTs to ``/stream/{name}`` next to the server's ``/sse`` endpoint
        (the name is URL-encoded) and yields parsed SSE data events. An HTTP
        error status yields a single ``STREAM_ERROR`` error chunk.

        Args:
            name: Command name.
            args: Command arguments.

        Yields:
            Parsed JSON chunks from the SSE stream (wire format, camelCase).
            Use :func:`afd.core.streaming.parse_stream_chunk` for models.
        """
        self._require_connected()

        import httpx

        from afd.core.sse import SseDecoder
        from afd.transports._mcp_protocol import derive_stream_url

        base_url = self._config.resolved_url
        if self._config.resolved_transport == "streamable-http":
            # An AFD server serves /mcp and /stream side by side.
            from urllib.parse import urlsplit, urlunsplit

            parts = urlsplit(base_url)
            path = parts.path.rstrip("/")
            if path.endswith("/mcp"):
                base_url = urlunsplit(parts._replace(path=path[: -len("/mcp")]))
        stream_url = derive_stream_url(base_url, name)

        async with httpx.AsyncClient() as http_client:
            async with http_client.stream(
                "POST",
                stream_url,
                json=args or {},
                headers={
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                    **self._config.headers,
                },
                timeout=self._config.timeout,
            ) as response:
                if not response.is_success:
                    body = await response.aread()
                    yield _stream_http_error(response.status_code, response.reason_phrase, body)
                    return
                decoder = SseDecoder()
                async for line in response.aiter_lines():
                    event = decoder.decode(line)
                    if event is None:
                        continue
                    payload = event.data.strip()
                    if payload == "[DONE]":
                        return
                    try:
                        yield json.loads(payload)
                    except json.JSONDecodeError:
                        yield {"raw": payload}

    # ── Events ────────────────────────────────────────────────────────────

    def on(
        self,
        event: str,
        handler: Callable[..., None],
    ) -> Callable[[], None]:
        """Subscribe to a client event.

        Supported events: ``state_change``, ``connected``, ``disconnected``,
        ``reconnecting``, ``error``.

        Args:
            event: Event name.
            handler: Callback function.

        Returns:
            An unsubscribe function.
        """
        handlers = self._event_handlers.setdefault(event, [])
        handlers.append(handler)

        def unsubscribe() -> None:
            if handler in handlers:
                handlers.remove(handler)

        return unsubscribe

    def _emit(self, event: str, *args: Any) -> None:
        """Emit an event to all registered handlers."""
        for handler in self._event_handlers.get(event, []):
            try:
                handler(*args)
            except Exception:
                # A handler error must not crash the client, but must not vanish.
                logger.exception("McpClient %r event handler raised", event)

    # ── Reconnection ──────────────────────────────────────────────────────

    def _set_state(self, state: TransportState) -> None:
        self._state = state
        self._emit("state_change", state)

    def _clear_connection(self) -> None:
        self._tools = []
        self._connected_at = None

    def _bind_transport_events(self) -> None:
        # Built-in SSE transports report an idle server close as well as calls
        # failing. HTTP failures are detected by _request(). Injected transports
        # keep their existing callbacks/API.
        if hasattr(self._transport, "set_callbacks"):
            transport = self._transport
            transport.set_callbacks(
                on_close=lambda: self._connection_lost(transport),
                on_error=lambda exc: self._connection_lost(transport, exc),
            )

    def _connection_lost(self, transport: Any, exc: Optional[Exception] = None) -> None:
        if not self._active or transport is not self._transport or self._state != TransportState.CONNECTED:
            return
        self._clear_connection()
        self._set_state(TransportState.DISCONNECTED)
        self._emit("disconnected", str(exc) if exc else "Connection closed")
        if exc is not None:
            self._emit("error", exc)
        if self._config.auto_reconnect:
            self._set_state(TransportState.RECONNECTING)
            self._reconnect_task = asyncio.create_task(self._attempt_reconnect())

    async def _request(self, method: str, *args: Any) -> Any:
        """Report lost connections without replaying a possibly executed mutation."""
        transport = self._transport
        try:
            return await getattr(transport, method)(*args)
        except TransportError as exc:
            if not isinstance(exc, (ToolExecutionError, ToolNotFoundError)) and transport.state != TransportState.CONNECTED:
                self._connection_lost(transport, exc)
            raise

    async def _stop_reconnect(self) -> None:
        task = self._reconnect_task
        self._reconnect_task = None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _attempt_reconnect(self) -> bool:
        """Restore discovery after loss; never replay an in-flight command."""
        generation = self._generation
        last_error: Optional[Exception] = None
        if not self._config.auto_reconnect or not self._active:
            return False
        try:
            for attempt in range(1, self._config.max_reconnect_attempts + 1):
                if not self._active or generation != self._generation:
                    return False
                self._reconnect_attempts = attempt
                self._emit("reconnecting", attempt, self._config.max_reconnect_attempts)
                self._set_state(TransportState.RECONNECTING)
                await asyncio.sleep(self._config.reconnect_delay * (2 ** (attempt - 1)))
                if not self._active or generation != self._generation:
                    return False
                try:
                    await self._transport.disconnect()
                    # Reuse injected transports, which may not have a URL config.
                    if self._owns_transport:
                        self._transport = _create_transport(self._config)
                    self._bind_transport_events()
                    await self._transport.connect()
                    tools = await self._transport.list_tools()
                    if not self._active or generation != self._generation:
                        await self._transport.disconnect()
                        return False
                    self._tools = tools
                    self._connected_at = datetime.now(timezone.utc)
                    self._reconnect_attempts = 0
                    self._set_state(TransportState.CONNECTED)
                    self._emit("connected")
                    return True
                except Exception as exc:
                    last_error = exc
                    await self._transport.disconnect()
            self._clear_connection()
            self._set_state(TransportState.ERROR)
            self._emit("error", last_error or TransportError("Max reconnection attempts reached"))
            return False
        finally:
            if self._reconnect_task is asyncio.current_task():
                self._reconnect_task = None

    # ── Status ────────────────────────────────────────────────────────────

    def get_status(self) -> ClientStatus:
        """Get a snapshot of the client's current status."""
        state = self._state
        return ClientStatus(
            state=state,
            url=self._config.resolved_url if state != TransportState.DISCONNECTED else None,
            server_info=getattr(self._transport, '_server_info', None) if self._transport else None,
            capabilities=getattr(self._transport, '_capabilities', None) if self._transport else None,
            connected_at=self._connected_at,
            reconnect_attempts=self._reconnect_attempts,
            tools_count=len(self._tools),
        )

    # ── Internal ──────────────────────────────────────────────────────────

    def _require_connected(self) -> None:
        """Raise if not connected."""
        if not self.is_connected():
            raise RuntimeError(
                "Client not connected. Call connect() first."
            )

    def _debug(self, message: str) -> None:
        """Debug logging."""
        if self._config.debug:
            print(f"[McpClient] {message}")


# ═══════════════════════════════════════════════════════════════════════════════
# RESULT PARSING
# ═══════════════════════════════════════════════════════════════════════════════


def _parse_command_result(data: Dict[str, Any]) -> CommandResult:
    """Parse a CommandResult dict, keeping sources, plan, metadata and the rest."""
    try:
        return CommandResult.model_validate(data)
    except ValidationError as exc:
        return result_error(
            code="INVALID_RESULT",
            message="The server returned a malformed CommandResult",
            suggestion="Check that the server returns AFD CommandResult JSON",
            details={
                "errors": [
                    {
                        "path": ".".join(str(part) for part in issue.get("loc", ())),
                        "message": issue.get("msg", "Invalid value"),
                    }
                    for issue in exc.errors()
                ]
            },
        )


def _stream_http_error(status: int, reason: str, body: bytes) -> Dict[str, Any]:
    """A wire-format error chunk for a stream request that got an HTTP error."""
    message = f"HTTP {status}: {reason}" if reason else f"HTTP {status}"
    try:
        payload = json.loads(body) if body else None
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = None
    server_error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(server_error, dict) and isinstance(server_error.get("message"), str):
        message = f"HTTP {status}: {server_error['message']}"
    return {
        "type": "error",
        "error": {
            "code": "STREAM_ERROR",
            "message": message,
            "suggestion": "Check the command name and arguments",
            "retryable": status >= 500,
        },
        "chunksBeforeError": 0,
        "recoverable": False,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# FACTORY
# ═══════════════════════════════════════════════════════════════════════════════


def _create_transport(config: McpClientConfig) -> Any:
    """Create a transport instance from config."""
    url = config.resolved_url
    if not url:
        raise ValueError("McpClientConfig.url (or endpoint) is required")

    transport = config.resolved_transport
    if transport == "streamable-http":
        from afd.transports.streamable_http import StreamableHttpTransport

        return StreamableHttpTransport(
            url,
            headers=config.headers or None,
            timeout=config.timeout,
            client_name=config.client_name,
            client_version=config.client_version,
            mode=config.protocol_mode,
        )
    if transport == "http":
        from afd.transports.http import HttpTransport

        return HttpTransport(
            url,
            headers=config.headers or None,
            timeout=config.timeout,
            client_name=config.client_name,
            client_version=config.client_version,
        )
    else:
        from afd.transports.sse import SseTransport

        return SseTransport(
            url,
            headers=config.headers or None,
            timeout=config.timeout,
            client_name=config.client_name,
            client_version=config.client_version,
        )


def create_client(
    url: str,
    *,
    transport: Optional[Literal["streamable-http", "sse", "http"]] = None,
    auto_reconnect: bool = True,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 30.0,
    debug: bool = False,
) -> McpClient:
    """Create an McpClient with sensible defaults.

    Args:
        url: Server URL.
        transport: Transport type; inferred from the URL when omitted.
        auto_reconnect: Enable auto-reconnect.
        headers: Custom HTTP headers.
        timeout: Request timeout in seconds.
        debug: Enable debug logging.

    Returns:
        Configured McpClient instance.

    Example:
        >>> client = create_client("http://localhost:3100/mcp")
        >>> await client.connect()
        >>> result = await client.call("ping")
    """
    return McpClient(McpClientConfig(
        url=url,
        transport=transport,
        auto_reconnect=auto_reconnect,
        headers=headers or {},
        timeout=timeout,
        debug=debug,
    ))
