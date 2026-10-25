"""MCP Streamable HTTP transport, on the official MCP SDK client (``mcp.Client``).

It speaks MCP 2026-07-28 (stateless, per-request ``_meta``) to servers that offer
it, found by a ``server/discover`` probe, and falls back to the 2025 ``initialize``
handshake otherwise. That covers AFD servers' ``/mcp`` endpoint (TypeScript,
Python and Rust) and any server built on an official MCP SDK.

Example:
    >>> from afd.transports import StreamableHttpTransport
    >>>
    >>> transport = StreamableHttpTransport("http://localhost:3100/mcp")
    >>> await transport.connect()
    >>> result = await transport.call_tool("todo-list", {})
    >>> await transport.disconnect()
"""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any, AsyncIterator, Callable, Dict, Literal, Optional

from afd.transports.sse import SseTransport, _EndOfStreamSignal

ProtocolMode = Literal["auto", "legacy", "modern"]
"""How the transport negotiates the MCP revision.

- ``"auto"`` (default): probe ``server/discover``; use 2026-07-28 when offered,
  else the ``initialize`` handshake.
- ``"legacy"``: always use the 2025 ``initialize`` handshake.
- ``"modern"``: require 2026-07-28 and fail otherwise.
"""

MODERN_PROTOCOL_VERSION = "2026-07-28"


class StreamableHttpTransport(SseTransport):
    """Streamable HTTP transport backed by ``mcp.Client``.

    It shares :class:`SseTransport`'s owner task (the SDK's task groups must exit in
    the task that entered them), reconnect callbacks and call deadline.
    """

    def __init__(
        self,
        url: str,
        *,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0,
        client_name: str = "afd-python-client",
        client_version: str = "0.2.0",
        mode: ProtocolMode = "auto",
        on_close: Optional[Callable[[], None]] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
    ) -> None:
        if mode not in ("auto", "legacy", "modern"):
            raise ValueError("mode must be 'auto', 'legacy' or 'modern'")
        super().__init__(
            url,
            headers=headers,
            timeout=timeout,
            client_name=client_name,
            client_version=client_version,
            on_close=on_close,
            on_error=on_error,
        )
        # Requests go to the URL itself, not to a derived /message endpoint.
        self._message_url = url
        self._mode = mode
        self._protocol_version: Optional[str] = None

    @property
    def protocol_version(self) -> Optional[str]:
        """The negotiated revision, such as ``"2026-07-28"`` or ``"2025-11-25"``."""
        return self._protocol_version

    async def _open_session(self, stack: AsyncExitStack, stop: asyncio.Event) -> Any:
        try:
            import httpx2
            from mcp import Client
            from mcp.client.streamable_http import streamable_http_client
            from mcp.types import Implementation
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise ImportError(
                "MCP client dependencies not installed. Install with: pip install afd[client]"
            ) from exc

        url, headers, timeout = self._url, self._headers, self._timeout

        @asynccontextmanager
        async def streams() -> AsyncIterator[Any]:
            http = httpx2.AsyncClient(headers=headers, timeout=timeout)
            async with http, streamable_http_client(url, http_client=http) as opened:
                read, write, *rest = opened
                yield (_EndOfStreamSignal(read, stop.set), write, *rest)

        # A pinned version skips server/discover (and with it the server's identity),
        # so "modern" negotiates like "auto" and then insists on 2026-07-28.
        client = Client(
            streams(),
            mode="legacy" if self._mode == "legacy" else "auto",
            read_timeout_seconds=float(timeout),
            client_info=Implementation(name=self._client_name, version=self._client_version),
        )
        await stack.enter_async_context(client)
        self._protocol_version = client.protocol_version
        if self._mode == "modern" and client.protocol_version != MODERN_PROTOCOL_VERSION:
            from afd.transports.base import TransportError

            raise TransportError(
                f"The server does not offer MCP {MODERN_PROTOCOL_VERSION} "
                f"(negotiated {client.protocol_version}); use protocol_mode 'auto'"
            )
        return client, client.server_info, client.server_capabilities
