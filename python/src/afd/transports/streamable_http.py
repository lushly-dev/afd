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
from dataclasses import dataclass
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Literal, Optional, Union

from afd.transports.sse import SseTransport, _EndOfStreamSignal

ProtocolMode = Literal["auto", "legacy", "modern"]
"""How the transport negotiates the MCP revision.

- ``"auto"`` (default): probe ``server/discover``; use 2026-07-28 when offered,
  else the ``initialize`` handshake.
- ``"legacy"``: always use the 2025 ``initialize`` handshake.
- ``"modern"``: require 2026-07-28 and fail otherwise.
"""

MODERN_PROTOCOL_VERSION = "2026-07-28"


@dataclass
class ElicitationRequest:
    """A form elicitation a server asks the user to answer (MCP ``elicitation/create``).

    Attributes:
        message: The question to show.
        requested_schema: JSON Schema of the form: a flat object of primitive properties.
    """

    message: str
    requested_schema: Dict[str, Any]


@dataclass
class ElicitationResponse:
    """The user's answer: ``accept`` with the form content, ``decline`` (an explicit no)
    or ``cancel``."""

    action: Literal["accept", "decline", "cancel"]
    content: Optional[Dict[str, Union[str, int, float, bool, List[str]]]] = None


ElicitationHandler = Callable[[ElicitationRequest], Awaitable[ElicitationResponse]]
"""Answers a server's elicitation, such as a confirmation of a destructive command."""


def input_required_result(input_requests: Any) -> Dict[str, Any]:
    """The tool result for an ``input_required`` answer the client cannot fulfil: an
    ``INPUT_REQUIRED`` failure carrying what the server asked, as TypeScript's client returns."""
    import json

    failure = {
        "success": False,
        "error": {
            "code": "INPUT_REQUIRED",
            "message": "The server needs input from the user before it can run this call",
            "suggestion": (
                "Create the client with on_elicitation to answer the server, "
                "or use a client that supports elicitation"
            ),
            "retryable": False,
        },
        "data": {"inputRequests": input_requests or {}},
    }
    return {
        "content": [{"type": "text", "text": json.dumps(failure)}],
        "structuredContent": failure,
        "isError": True,
    }


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
        on_elicitation: Optional[ElicitationHandler] = None,
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
        self._on_elicitation = on_elicitation
        # Elicitations being answered now, and the seconds spent answering so far.
        self._answering = 0
        self._answered_seconds = 0.0
        self._idle = asyncio.Event()
        self._idle.set()
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
            # With a handler the SDK declares elicitation and answers input_required
            # rounds itself; without one, `_call_tool_payload` returns them unanswered.
            elicitation_callback=(
                _elicitation_callback(self._answer) if self._on_elicitation else None
            ),
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

    async def _bounded(self, operation: Any) -> Any:
        """:meth:`SseTransport._bounded`, except that time a person spends answering an
        elicitation does not count against the deadline: a confirmation can take longer
        than a request, and a timeout here reads as a lost connection."""
        loop = asyncio.get_running_loop()
        task = asyncio.ensure_future(operation)
        start, answered_before = loop.time(), self._answered_seconds
        while True:
            if self._answering:
                idle = asyncio.ensure_future(self._idle.wait())
                await asyncio.wait({task, idle}, return_when=asyncio.FIRST_COMPLETED)
                idle.cancel()
            else:
                answered = self._answered_seconds - answered_before
                remaining = start + self._timeout + answered - loop.time()
                if remaining <= 0:
                    break
                await asyncio.wait({task}, timeout=remaining)
            if task.done():
                return task.result()
        task.cancel()
        task.add_done_callback(lambda finished: finished.cancelled() or finished.exception())
        raise asyncio.TimeoutError(f"MCP request timed out after {self._timeout}s")

    async def _answer(self, request: ElicitationRequest) -> ElicitationResponse:
        """Run the handler with the call deadline paused."""
        assert self._on_elicitation is not None
        loop = asyncio.get_running_loop()
        self._answering += 1
        self._idle.clear()
        began = loop.time()
        try:
            return await self._on_elicitation(request)
        finally:
            self._answered_seconds += loop.time() - began
            self._answering -= 1
            if not self._answering:
                self._idle.set()

    async def _call_tool_payload(
        self, session: Any, name: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        if self._on_elicitation is not None:
            return await super()._call_tool_payload(session, name, arguments)
        import anyio
        from mcp import MCPError
        from mcp.types import HEADER_MISMATCH, InputRequiredResult
        from mcp_types.version import MODERN_PROTOCOL_VERSIONS
        from pydantic import ValidationError

        # Send the call by hand so an input_required answer comes back unanswered
        # instead of reaching the SDK's refusing default elicitation callback.
        async def send() -> Any:
            return await session.session.call_tool(
                name,
                arguments,
                read_timeout_seconds=float(self._timeout),
                allow_input_required=True,
            )

        try:
            result = await send()
        except MCPError as mismatch:
            # mcp.Client.call_tool's recovery: the tool's listed schema is missing or
            # stale on a 2026-07-28 connection, so re-list it and resend once.
            if mismatch.code != HEADER_MISMATCH or session.protocol_version not in MODERN_PROTOCOL_VERSIONS:
                raise
            try:
                with anyio.fail_after(self._timeout):
                    await _relist_tool(session, name)
            except (MCPError, TimeoutError, ValidationError) as relist_error:
                raise mismatch from relist_error
            result = await send()
        if isinstance(result, InputRequiredResult):
            asked = result.model_dump(by_alias=True, mode="json", exclude_none=True)
            return input_required_result(asked.get("inputRequests"))
        return result.model_dump(by_alias=True, mode="json", exclude_none=True)


_RELIST_PAGE_CAP = 100
"""Page cap for the re-list after a ``HEADER_MISMATCH``, as ``mcp.Client`` caps it."""


async def _relist_tool(client: Any, name: str) -> None:
    """Refetch the tool listing, page by page, until a page lists ``name``
    (``mcp.Client._relist_tool``)."""
    cursor: Optional[str] = None
    for _ in range(_RELIST_PAGE_CAP):
        page = await client.list_tools(cursor=cursor, cache_mode="refresh")
        cursor = page.next_cursor
        if cursor is None or any(tool.name == name for tool in page.tools):
            return


def _elicitation_callback(handler: ElicitationHandler) -> Any:
    """Adapt an :data:`ElicitationHandler` to ``mcp.Client(elicitation_callback=...)``."""

    async def callback(context: Any, params: Any) -> Any:
        from mcp.types import ElicitRequestFormParams, ElicitResult

        # The SDK declares URL elicitation along with form, but AFD's handler answers
        # forms only. Cancelling (not refusing) lets the server answer with its own
        # failure and suggestion instead of the call failing as a transport error.
        if not isinstance(params, ElicitRequestFormParams):
            return ElicitResult(action="cancel")
        answer = await handler(
            ElicitationRequest(message=params.message, requested_schema=dict(params.requested_schema))
        )
        return ElicitResult(action=answer.action, content=answer.content)

    return callback
