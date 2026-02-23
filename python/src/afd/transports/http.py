"""HTTP transport for MCP communication.

A simple request/response transport that sends JSON-RPC requests via HTTP POST.
No streaming or server-push — suitable for stateless interactions.

Example:
    >>> from afd.transports import HttpTransport
    >>>
    >>> transport = HttpTransport("http://localhost:3100/message")
    >>> await transport.connect()
    >>> result = await transport.call_tool("ping", {})
    >>> await transport.disconnect()
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from afd.transports.base import (
    ToolInfo,
    TransportError,
    TransportState,
)
from afd.transports._mcp_protocol import _HttpBasedTransport


class HttpTransport(_HttpBasedTransport):
    """HTTP POST transport for MCP.

    Connects via a health-check GET, then uses POST for all JSON-RPC calls.
    """

    def __init__(
        self,
        url: str,
        *,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0,
        client_name: str = "afd-python-client",
        client_version: str = "0.2.0",
    ) -> None:
        super().__init__(url, headers=headers, timeout=timeout, client_name=client_name, client_version=client_version)

    async def connect(self) -> None:
        """Establish connection: create HTTP client, run health check, initialize MCP."""
        if self._state == TransportState.CONNECTED:
            return

        self._state = TransportState.CONNECTING

        try:
            self._client = httpx.AsyncClient()

            # Health check (best-effort)
            health_url = self._message_url.replace("/message", "/health")
            try:
                resp = await self._client.get(
                    health_url,
                    headers=self._headers,
                    timeout=self._timeout,
                )
                # Ignore non-2xx — health endpoint may not exist
            except httpx.HTTPError:
                pass

            # MCP initialize handshake
            await self._initialize()

            self._state = TransportState.CONNECTED

        except Exception as exc:
            self._state = TransportState.ERROR
            # Clean up client on failure
            if self._client:
                await self._client.aclose()
                self._client = None
            if isinstance(exc, TransportError):
                raise
            raise TransportError(str(exc), cause=exc) from exc

    async def disconnect(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
        self._state = TransportState.DISCONNECTED
