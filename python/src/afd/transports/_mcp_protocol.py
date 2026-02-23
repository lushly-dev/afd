"""Shared JSON-RPC logic for HTTP-based MCP transports.

This private module provides the base class for SseTransport and HttpTransport,
encapsulating MCP JSON-RPC request building, content extraction, and the
initialize handshake.
"""

from __future__ import annotations

import itertools
import json
from typing import Any, Dict, List, Optional

import httpx

from afd.transports.base import ToolExecutionError, ToolInfo, TransportError, TransportState

# MCP protocol version matching the TS client
MCP_PROTOCOL_VERSION = "2024-11-05"


class _HttpBasedTransport:
    """Base class for HTTP-based MCP transports.

    Provides shared JSON-RPC logic used by both HttpTransport and SseTransport.
    Subclasses must set ``_client`` (httpx.AsyncClient) and ``_message_url``
    before calling any request methods.
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
        self._url = url
        self._headers = headers or {}
        self._timeout = timeout
        self._client_name = client_name
        self._client_version = client_version
        self._state = TransportState.DISCONNECTED
        self._client: Optional[httpx.AsyncClient] = None
        self._message_url: str = self._derive_message_url(url)
        self._request_counter = itertools.count(1)
        self._server_info: Optional[Dict[str, Any]] = None
        self._capabilities: Optional[Dict[str, Any]] = None

    @property
    def state(self) -> TransportState:
        """Get the current connection state."""
        return self._state

    # ── JSON-RPC helpers ──────────────────────────────────────────────────

    def _next_request_id(self) -> int:
        """Return the next monotonically-increasing request ID."""
        return next(self._request_counter)

    async def _send_request(
        self,
        method: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Build a JSON-RPC request, POST it, and return the ``result`` field.

        Raises:
            RuntimeError: If not connected.
            TransportError: On HTTP or protocol errors.
        """
        if self._client is None:
            raise RuntimeError("Transport not connected. Call connect() first.")

        payload: Dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": self._next_request_id(),
            "method": method,
        }
        if params is not None:
            payload["params"] = params

        try:
            response = await self._client.post(
                self._message_url,
                json=payload,
                headers={"Content-Type": "application/json", **self._headers},
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise TransportError(str(exc), cause=exc)

        if not response.is_success:
            raise TransportError(
                f"HTTP {response.status_code}: {response.text}",
            )

        data = response.json()

        if "error" in data:
            err = data["error"]
            raise TransportError(
                f"JSON-RPC error {err.get('code', '?')}: {err.get('message', 'Unknown')}"
            )

        return data.get("result")

    # ── MCP operations ────────────────────────────────────────────────────

    async def _initialize(self) -> Dict[str, Any]:
        """Perform the MCP ``initialize`` handshake."""
        result = await self._send_request("initialize", {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": self._client_name,
                "version": self._client_version,
            },
        })
        init_result = result or {}
        self._server_info = init_result.get("serverInfo")
        self._capabilities = init_result.get("capabilities")
        return init_result

    async def call_tool(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Call a tool via the MCP ``tools/call`` method.

        Returns the extracted text content (parsed as JSON when possible).
        """
        result = await self._send_request("tools/call", {
            "name": name,
            "arguments": arguments or {},
        })
        return self._extract_content(result)

    async def list_tools(self) -> List[ToolInfo]:
        """List available tools via the MCP ``tools/list`` method."""
        result = await self._send_request("tools/list")
        tools: List[ToolInfo] = []
        for tool in (result or {}).get("tools", []):
            tools.append(ToolInfo(
                name=tool["name"],
                description=tool.get("description", ""),
                input_schema=tool.get("inputSchema"),
            ))
        return tools

    # ── Helpers ────────────────────────────────────────────────────────────

    @staticmethod
    def _derive_message_url(url: str) -> str:
        """Derive the ``/message`` endpoint from a given URL.

        If the URL ends with ``/sse``, replace with ``/message``.
        If it already ends with ``/message``, keep as-is.
        Otherwise, append ``/message``.
        """
        if url.endswith("/sse"):
            return url[: -len("/sse")] + "/message"
        if url.endswith("/message"):
            return url
        return url.rstrip("/") + "/message"

    @staticmethod
    def _extract_content(result: Any) -> Any:
        """Extract usable data from an MCP tool call result.

        MCP results contain a ``content`` array of ``{type, text}`` objects.
        This method joins text content and attempts JSON parsing.
        """
        if result is None:
            return None

        # Check for isError flag — tool-level error, not transport
        if isinstance(result, dict) and result.get("isError"):
            texts = [
                c["text"]
                for c in result.get("content", [])
                if c.get("type") == "text"
            ]
            raise ToolExecutionError(
                " ".join(texts) or "Tool execution failed"
            )

        content = result.get("content", []) if isinstance(result, dict) else []
        texts = [c["text"] for c in content if c.get("type") == "text"]
        combined = "".join(texts)

        if not combined:
            return result

        try:
            return json.loads(combined)
        except (json.JSONDecodeError, TypeError):
            return combined
