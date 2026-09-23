"""Shared JSON-RPC logic for HTTP-based MCP transports.

This private module provides the base class for SseTransport and HttpTransport,
encapsulating MCP JSON-RPC request building, content extraction, and the
initialize handshake.
"""

from __future__ import annotations

import itertools
import json
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlsplit, urlunsplit

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
            raise TransportError(str(exc), cause=exc) from exc

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
        """Derive the JSON-RPC ``POST`` endpoint from a server URL.

        The AFD TypeScript server answers JSON-RPC synchronously on
        ``/message``, next to ``/sse``, the same endpoint its client uses:

        - ``http://host:3100/sse`` becomes ``http://host:3100/message``;
        - a bare origin (``http://host:3100``) gets ``/message``;
        - any other URL, such as an explicit ``/message`` or ``/messages/``
          endpoint, is used as given.
        """
        parts = urlsplit(url)
        path = parts.path.rstrip("/")
        if path.endswith("/sse"):
            path = path[: -len("/sse")] + "/message"
        elif path == "":
            path = "/message"
        else:
            return url
        return urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))

    @staticmethod
    def _derive_health_url(message_url: str) -> str:
        """Derive a best-effort health endpoint from the message URL."""
        parts = urlsplit(message_url)
        path = parts.path.rstrip("/")
        for suffix in ("/message", "/messages"):
            if path.endswith(suffix):
                path = path[: -len(suffix)]
                break
        return urlunsplit((parts.scheme, parts.netloc, path + "/health", "", ""))

    @staticmethod
    def _extract_content(result: Any) -> Any:
        """Extract usable data from an MCP tool call result.

        MCP results contain a ``content`` array of ``{type, text}`` objects.
        This method joins text content and attempts JSON parsing.

        A result flagged ``isError`` whose text is an AFD result (a
        CommandResult, BatchResult or PipelineResult, as the TypeScript and
        Python servers send for failures) is returned like any other result,
        so its ``error.code`` and ``error.suggestion`` survive. Any other
        ``isError`` result raises ``ToolExecutionError``.
        """
        if result is None:
            return None

        content = result.get("content", []) if isinstance(result, dict) else []
        texts = [
            c["text"]
            for c in content
            if isinstance(c, dict) and c.get("type") == "text" and isinstance(c.get("text"), str)
        ]
        combined = "".join(texts)

        try:
            parsed: Any = json.loads(combined) if combined else _NO_JSON
        except (json.JSONDecodeError, TypeError):
            parsed = _NO_JSON

        # Check for isError flag — tool-level error, not transport
        if isinstance(result, dict) and result.get("isError"):
            if is_afd_result(parsed):
                return parsed
            raise ToolExecutionError(
                " ".join(texts) or "Tool execution failed"
            )

        if not combined:
            return result

        return combined if parsed is _NO_JSON else parsed


_NO_JSON = object()


def is_afd_result(value: Any) -> bool:
    """Return True for a parsed CommandResult, BatchResult or PipelineResult body."""
    if not isinstance(value, dict):
        return False
    if isinstance(value.get("success"), bool):
        return True
    return isinstance(value.get("steps"), list) and isinstance(value.get("metadata"), dict)


def derive_stream_url(url: str, command_name: str) -> str:
    """Derive the ``/stream/<command>`` URL from a server URL.

    ``/sse``, ``/message`` and ``/messages`` are replaced; the command name is
    URL-encoded. ``http://host:3100/sse`` and ``todo-list`` give
    ``http://host:3100/stream/todo-list``.
    """
    parts = urlsplit(url)
    path = parts.path.rstrip("/")
    for suffix in ("/sse", "/message", "/messages"):
        if path.endswith(suffix):
            path = path[: -len(suffix)]
            break
    stream_path = f"{path}/stream/{quote(command_name, safe='')}"
    return urlunsplit((parts.scheme, parts.netloc, stream_path, "", ""))
