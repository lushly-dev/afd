"""SSE (Server-Sent Events) transport for MCP communication.

Connects to a live MCP SSE endpoint using the upstream MCP client session
implementation, then exposes the result through the lighter AFD transport API.

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
from contextlib import AsyncExitStack
from datetime import timedelta
from typing import Any, Callable, Dict, List, Optional

from afd.transports.base import (
    ToolInfo,
    TransportError,
    TransportState,
)
from afd.transports._mcp_protocol import _HttpBasedTransport


class SseTransport(_HttpBasedTransport):
    """SSE transport backed by the upstream MCP client session."""

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
        self._on_close = on_close
        self._on_error = on_error
        self._client_on_close: Optional[Callable[[], None]] = None
        self._client_on_error: Optional[Callable[[Exception], None]] = None
        self._exit_stack: Optional[AsyncExitStack] = None
        self._session: Any = None
        self._owner: Optional[asyncio.Task] = None
        self._stop: Optional[asyncio.Event] = None
        self._ready: Optional[asyncio.Future] = None
        self._closing = False

    def set_callbacks(
        self,
        *,
        on_close: Callable[[], None],
        on_error: Callable[[Exception], None],
    ) -> None:
        """Install lifecycle callbacks for a high-level client."""
        self._client_on_close = on_close
        self._client_on_error = on_error

    async def connect(self) -> None:
        """Connect, keeping the upstream task-group contexts in one owner task."""
        if self._state == TransportState.CONNECTED:
            return
        if self._owner is not None:
            await self.disconnect()
        self._state = TransportState.CONNECTING
        self._closing = False
        stop = self._stop = asyncio.Event()
        ready = self._ready = asyncio.get_running_loop().create_future()
        self._owner = asyncio.create_task(self._run_session(ready, stop))
        try:
            await asyncio.wait_for(asyncio.shield(ready), self._timeout)
        except BaseException as exc:
            # A prior connect waiter must never clean up the next generation.
            await self._cleanup(ready)
            if self._ready is ready and not isinstance(exc, asyncio.CancelledError):
                self._state = TransportState.ERROR
            if ready.done() and not ready.cancelled():
                ready.exception()
            if isinstance(exc, asyncio.TimeoutError):
                error = TransportError("MCP SSE connection timed out", cause=exc)
                if self._ready is ready:
                    self._report_error(error)
                raise error from exc
            raise

    async def _run_session(self, ready: asyncio.Future, stop: asyncio.Event) -> None:
        """Enter and exit AnyIO contexts in the same task, including reconnects."""
        connected = False
        try:
            try:
                from mcp.client.session import ClientSession
                from mcp.client.sse import sse_client
            except ImportError as exc:  # pragma: no cover - optional dependency
                raise ImportError("MCP client dependencies not installed. Install with: pip install afd[client]") from exc
            async with AsyncExitStack() as stack:
                if self._ready is ready:
                    self._exit_stack = stack
                read, write = await stack.enter_async_context(sse_client(
                    self._url, headers=self._headers, timeout=self._timeout,
                ))

                class OwnedSession(ClientSession):
                    async def _receive_loop(session) -> None:
                        # Signal EOF only after upstream has notified all pending
                        # requests; closing earlier cancels that notification.
                        try:
                            await super()._receive_loop()
                        finally:
                            stop.set()

                session = await stack.enter_async_context(OwnedSession(
                    read, write, read_timeout_seconds=timedelta(seconds=self._timeout),
                ))
                if self._ready is ready:
                    self._session = session
                init_result = await session.initialize()
                if self._ready is not ready or ready.cancelled() or self._closing:
                    return
                self._server_info = (
                    init_result.serverInfo.model_dump(mode="json")
                    if getattr(init_result, "serverInfo", None) is not None else None
                )
                self._capabilities = (
                    init_result.capabilities.model_dump(mode="json", exclude_none=True)
                    if getattr(init_result, "capabilities", None) is not None else None
                )
                self._state = TransportState.CONNECTED
                connected = True
                ready.set_result(None)
                await stop.wait()
        except Exception as exc:
            error = exc if isinstance(exc, TransportError) else TransportError(str(exc), cause=exc)
            if self._ready is ready:
                self._state = TransportState.ERROR
                if not self._closing:
                    self._report_error(error)
            if not ready.done():
                ready.set_exception(error)
        finally:
            # Cancellation before initialization must also release connect().
            if not ready.done():
                ready.cancel()
            if self._ready is ready:
                self._session = None
                self._exit_stack = None
                if self._state != TransportState.ERROR:
                    self._state = TransportState.DISCONNECTED
                if connected and not self._closing:
                    self._report_close()

    async def disconnect(self) -> None:
        """Close the upstream owner task and its session resources."""
        ready = self._ready
        await self._cleanup(ready)
        if self._ready is ready:
            self._state = TransportState.DISCONNECTED
            self._report_close()

    async def call_tool(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Call a tool through the live MCP session."""
        if self._session is None:
            raise RuntimeError("Transport not connected. Call connect() first.")

        session = self._session
        try:
            result = await session.call_tool(name, arguments or {})
            payload = result.model_dump(by_alias=True, mode="json", exclude_none=True)
            return self._extract_content(payload)
        except Exception as exc:
            self._raise_operation_error(exc, session)

    async def list_tools(self) -> List[ToolInfo]:
        """List tools through the live MCP session."""
        if self._session is None:
            raise RuntimeError("Transport not connected. Call connect() first.")

        session = self._session
        try:
            result = await session.list_tools()
            tools: List[ToolInfo] = []
            for tool in result.tools:
                payload = tool.model_dump(by_alias=True, mode="json", exclude_none=True)
                tools.append(ToolInfo(
                    name=payload["name"],
                    description=payload.get("description", ""),
                    input_schema=payload.get("inputSchema"),
                    meta=payload.get("_meta"),
                ))
            return tools
        except Exception as exc:
            self._raise_operation_error(exc, session)

    def _raise_operation_error(self, exc: Exception, session: Any) -> None:
        """Reconnect only for explicit IO/timeout failures, not SDK validation."""
        import anyio
        import httpx
        from mcp.shared.exceptions import McpError
        from mcp.types import CONNECTION_CLOSED
        from afd.transports.base import ToolExecutionError

        if isinstance(exc, ToolExecutionError):
            raise exc
        lost = (
            isinstance(exc, McpError) and exc.error.code in (CONNECTION_CLOSED, 408)
        ) or isinstance(exc, (
            anyio.BrokenResourceError, anyio.ClosedResourceError, anyio.EndOfStream,
            httpx.TransportError, ConnectionError, EOFError, asyncio.TimeoutError,
        ))
        if lost and self._session is session and self._state == TransportState.CONNECTED:
            self._state = TransportState.ERROR
            self._report_error(exc)
        if isinstance(exc, TransportError):
            raise exc
        raise TransportError(str(exc), cause=exc) from exc

    async def _cleanup(self, ready: Optional[asyncio.Future]) -> None:
        """Stop only this handshake's owner and promptly settle its waiter."""
        if ready is not self._ready:
            return
        self._closing = True
        self._state = TransportState.DISCONNECTED
        owner = self._owner
        self._owner = None
        initializing = ready is not None and not ready.done()
        if initializing:
            ready.cancel()
        if owner is not None:
            self._stop.set()
            if initializing:
                owner.cancel()
            if owner is not asyncio.current_task():
                try:
                    await owner
                except asyncio.CancelledError:
                    pass

    def _report_error(self, exc: Exception) -> None:
        """Notify the optional error callback."""
        if self._on_error:
            self._on_error(exc)
        if self._client_on_error:
            self._client_on_error(exc)

    def _report_close(self) -> None:
        if self._on_close:
            self._on_close()
        if self._client_on_close:
            self._client_on_close()
