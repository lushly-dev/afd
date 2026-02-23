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
    Tuple,
    Union,
)

from afd.core.result import CommandResult, error as result_error, success
from afd.transports.base import (
    ToolInfo,
    TransportError,
    TransportState,
)

# Lazy imports for optional transports
_Transport = Any  # Actual Transport protocol from base


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG / STATUS
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class McpClientConfig:
    """Configuration for McpClient.

    Attributes:
        url: Server URL (e.g., ``http://localhost:3100/sse``).
        transport: Transport type — ``"sse"`` or ``"http"``.
        auto_reconnect: Automatically reconnect on disconnect.
        max_reconnect_attempts: Maximum reconnection attempts.
        reconnect_delay: Base delay in seconds between attempts (exponential backoff).
        headers: Custom HTTP headers.
        timeout: Request timeout in seconds.
        debug: Enable debug logging.
    """

    url: str = ""
    transport: Literal["sse", "http"] = "sse"
    auto_reconnect: bool = True
    max_reconnect_attempts: int = 5
    reconnect_delay: float = 1.0
    headers: Dict[str, str] = field(default_factory=dict)
    timeout: float = 30.0
    debug: bool = False


@dataclass
class ClientStatus:
    """Snapshot of client status.

    Attributes:
        state: Current transport state.
        url: Server URL (None when disconnected).
        connected_at: Timestamp of connection.
        reconnect_attempts: Number of reconnection attempts since last connect.
        tools_count: Number of cached tools.
    """

    state: TransportState = TransportState.DISCONNECTED
    url: Optional[str] = None
    connected_at: Optional[datetime] = None
    reconnect_attempts: int = 0
    tools_count: int = 0


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
        self._tools: List[ToolInfo] = []
        self._connected_at: Optional[datetime] = None
        self._reconnect_attempts = 0
        self._event_handlers: Dict[str, List[Callable[..., None]]] = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def connect(self) -> None:
        """Connect to the MCP server.

        Creates the transport (if not injected), connects it, and fetches
        the initial tool list.

        Raises:
            TransportError: On connection failure.
            ValueError: If no URL is configured.
        """
        if self._transport and self._transport.state == TransportState.CONNECTED:
            return

        if self._transport is None:
            self._transport = _create_transport(self._config)

        self._emit("state_change", TransportState.CONNECTING)

        try:
            await self._transport.connect()
            self._connected_at = datetime.now(timezone.utc)
            self._reconnect_attempts = 0

            # Fetch initial tools
            self._tools = await self._transport.list_tools()

            self._emit("state_change", TransportState.CONNECTED)
            self._emit("connected")

        except Exception as exc:
            self._emit("state_change", TransportState.ERROR)
            self._emit("error", exc)
            raise

    async def disconnect(self) -> None:
        """Disconnect from the MCP server."""
        if self._transport:
            await self._transport.disconnect()

        self._tools = []
        self._connected_at = None
        self._emit("state_change", TransportState.DISCONNECTED)
        self._emit("disconnected", "Manual disconnect")

    def is_connected(self) -> bool:
        """Check if the client is connected."""
        return (
            self._transport is not None
            and self._transport.state == TransportState.CONNECTED
        )

    # ── Tool queries ──────────────────────────────────────────────────────

    async def list_tools(self) -> List[ToolInfo]:
        """Refresh and return the list of available tools."""
        self._require_connected()
        self._tools = await self._transport.list_tools()
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
        unwrapped: if the data is already a ``CommandResult`` dict it is
        returned directly; otherwise it is wrapped in ``success()``.

        Args:
            name: Tool/command name.
            args: Command arguments.

        Returns:
            CommandResult (success or failure).
        """
        self._require_connected()

        try:
            data = await self._transport.call_tool(name, args or {})

            # If already a CommandResult-shaped dict, return as-is
            if isinstance(data, dict) and "success" in data:
                return CommandResult(**{
                    "success": data["success"],
                    "data": data.get("data"),
                    "error": data.get("error"),
                    "reasoning": data.get("reasoning"),
                    "confidence": data.get("confidence"),
                    "warnings": data.get("warnings"),
                })

            return success(data)

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
        return await self._transport.call_tool(name, args or {})

    # ── Batch / Pipeline ──────────────────────────────────────────────────

    async def batch(
        self,
        commands: Sequence[Dict[str, Any]],
        options: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Execute a batch of commands via the ``afd.batch`` tool.

        Args:
            commands: List of ``{"name": ..., "input": ...}`` dicts.
            options: Batch options (e.g., ``{"stopOnError": True}``).

        Returns:
            Batch result from the server.
        """
        self._require_connected()
        return await self._transport.call_tool("afd.batch", {
            "commands": list(commands),
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
        return await self._transport.call_tool("afd-pipe", {
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

        POSTs to ``/stream/{name}`` and yields parsed SSE data events.

        Args:
            name: Command name.
            args: Command arguments.

        Yields:
            Parsed JSON chunks from the SSE stream.
        """
        self._require_connected()

        import httpx

        base_url = self._config.url.rstrip("/")
        stream_url = f"{base_url}/stream/{name}"

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
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        payload = line[len("data: "):]
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
                pass  # Don't let handler errors crash the client

    # ── Reconnection ──────────────────────────────────────────────────────

    async def _attempt_reconnect(self) -> bool:
        """Attempt to reconnect with exponential backoff.

        Returns:
            True if reconnection succeeded, False if max attempts exceeded.
        """
        if not self._config.auto_reconnect:
            return False

        max_attempts = self._config.max_reconnect_attempts

        while self._reconnect_attempts < max_attempts:
            self._reconnect_attempts += 1
            delay = self._config.reconnect_delay * (2 ** (self._reconnect_attempts - 1))

            self._emit("reconnecting", self._reconnect_attempts, max_attempts)
            self._emit("state_change", TransportState.RECONNECTING)

            await asyncio.sleep(delay)

            try:
                if self._transport:
                    await self._transport.disconnect()
                self._transport = _create_transport(self._config)
                await self._transport.connect()
                self._connected_at = datetime.now(timezone.utc)
                self._tools = await self._transport.list_tools()
                self._emit("state_change", TransportState.CONNECTED)
                self._emit("connected")
                return True
            except Exception as exc:
                self._emit("error", exc)

        self._emit("state_change", TransportState.ERROR)
        return False

    # ── Status ────────────────────────────────────────────────────────────

    def get_status(self) -> ClientStatus:
        """Get a snapshot of the client's current status."""
        state = (
            self._transport.state
            if self._transport
            else TransportState.DISCONNECTED
        )
        return ClientStatus(
            state=state,
            url=self._config.url if state != TransportState.DISCONNECTED else None,
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
# FACTORY
# ═══════════════════════════════════════════════════════════════════════════════


def _create_transport(config: McpClientConfig) -> Any:
    """Create a transport instance from config."""
    if not config.url:
        raise ValueError("McpClientConfig.url is required")

    if config.transport == "http":
        from afd.transports.http import HttpTransport

        return HttpTransport(
            config.url,
            headers=config.headers or None,
            timeout=config.timeout,
        )
    else:
        from afd.transports.sse import SseTransport

        return SseTransport(
            config.url,
            headers=config.headers or None,
            timeout=config.timeout,
        )


def create_client(
    url: str,
    *,
    transport: Literal["sse", "http"] = "sse",
    auto_reconnect: bool = True,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 30.0,
    debug: bool = False,
) -> McpClient:
    """Create an McpClient with sensible defaults.

    Args:
        url: Server URL.
        transport: Transport type.
        auto_reconnect: Enable auto-reconnect.
        headers: Custom HTTP headers.
        timeout: Request timeout in seconds.
        debug: Enable debug logging.

    Returns:
        Configured McpClient instance.

    Example:
        >>> client = create_client("http://localhost:3100/sse")
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
