"""SSE (Server-Sent Events) transport for MCP communication.

Connects via SSE to receive server-push events and sends requests via
HTTP POST — matching the TypeScript SseTransport pattern.

Example:
    >>> from afd.transports import SseTransport
    >>>
    >>> transport = SseTransport("http://localhost:3100/sse")
    >>> await transport.connect()
    >>> result = await transport.call_tool("ping", {})
    >>> await transport.disconnect()
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Dict, List, Optional

import httpx

from afd.transports.base import (
    ToolInfo,
    TransportError,
    TransportState,
)
from afd.transports._mcp_protocol import _HttpBasedTransport


class SseTransport(_HttpBasedTransport):
    """SSE + POST transport for MCP.

    Opens an SSE connection for server-push events and uses POST for
    JSON-RPC requests.  A background ``asyncio.Task`` runs the SSE
    listener; tool calls still go through ``_send_request`` (POST).
    """

    def __init__(
        self,
        url: str,
        *,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0,
        client_name: str = "afd-python-client",
        client_version: str = "0.2.0",
        on_close: Optional[Callable[[], None]] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
    ) -> None:
        super().__init__(url, headers=headers, timeout=timeout, client_name=client_name, client_version=client_version)
        self._sse_task: Optional[asyncio.Task[None]] = None
        self._on_close = on_close
        self._on_error = on_error

    async def connect(self) -> None:
        """Connect: create HTTP client, start SSE listener, initialize MCP."""
        if self._state == TransportState.CONNECTED:
            return

        self._state = TransportState.CONNECTING

        try:
            self._client = httpx.AsyncClient()

            # Start SSE listener in the background
            self._sse_task = asyncio.create_task(self._run_sse_listener())

            # MCP initialize handshake (via POST)
            await self._initialize()

            self._state = TransportState.CONNECTED

        except Exception as exc:
            self._state = TransportState.ERROR
            await self._cleanup()
            if isinstance(exc, TransportError):
                raise
            raise TransportError(str(exc), cause=exc) from exc

    async def disconnect(self) -> None:
        """Cancel SSE listener and close the HTTP client."""
        await self._cleanup()
        self._state = TransportState.DISCONNECTED

    # ── SSE listener ──────────────────────────────────────────────────────

    async def _run_sse_listener(self) -> None:
        """Background task that consumes SSE events from the server.

        Uses ``httpx_sse`` when available; falls back to a basic line parser.
        Server-push events are currently logged/discarded — tool calls use
        the POST path.  Subclasses can override to handle specific events.
        """
        try:
            try:
                from httpx_sse import aconnect_sse
            except ImportError:
                # No httpx_sse — run a minimal keepalive listener
                await self._run_basic_sse_listener()
                return

            async with aconnect_sse(
                self._client,
                "GET",
                self._url,
                headers=self._headers,
            ) as event_source:
                async for event in event_source.aiter_sse():
                    # Server-push events can be handled here in the future.
                    # For now, we just keep the connection alive.
                    pass

        except asyncio.CancelledError:
            return
        except Exception as exc:
            if self._on_error:
                self._on_error(exc)
            if self._state == TransportState.CONNECTED:
                self._state = TransportState.ERROR
                if self._on_close:
                    self._on_close()

    async def _run_basic_sse_listener(self) -> None:
        """Minimal SSE listener without httpx_sse."""
        try:
            async with self._client.stream(
                "GET",
                self._url,
                headers={**self._headers, "Accept": "text/event-stream"},
            ) as response:
                async for _line in response.aiter_lines():
                    # Keep connection alive; server-push handling is future work
                    pass
        except asyncio.CancelledError:
            return
        except Exception as exc:
            if self._on_error:
                self._on_error(exc)
            if self._state == TransportState.CONNECTED:
                self._state = TransportState.ERROR
                if self._on_close:
                    self._on_close()

    # ── Cleanup ───────────────────────────────────────────────────────────

    async def _cleanup(self) -> None:
        """Cancel SSE task and close HTTP client."""
        if self._sse_task and not self._sse_task.done():
            self._sse_task.cancel()
            try:
                await self._sse_task
            except asyncio.CancelledError:
                pass
        self._sse_task = None

        if self._client:
            await self._client.aclose()
            self._client = None
