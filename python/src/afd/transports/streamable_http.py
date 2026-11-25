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
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AsyncExitStack, asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Literal

from afd.transports.base import ToolInfo, TransportError, _TaskSeed
from afd.transports.sse import SseTransport, _EndOfStreamSignal

ProtocolMode = Literal["auto", "legacy", "modern"]
"""How the transport negotiates the MCP revision.

- ``"auto"`` (default): probe ``server/discover``; use 2026-07-28 when offered,
  else the ``initialize`` handshake.
- ``"legacy"``: always use the 2025 ``initialize`` handshake.
- ``"modern"``: require 2026-07-28 and fail otherwise.
"""

MODERN_PROTOCOL_VERSION = "2026-07-28"
TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks"


@dataclass
class _CapturedTaskSlot:
    """Captures a claimed ``resultType='task'`` payload when ``mcp.Client.call_tool`` runs."""

    payload: dict[str, Any] | None = None


_CAPTURED_TASK: ContextVar[_CapturedTaskSlot | None] = ContextVar(
    "afd_client_captured_task", default=None
)

_ON_TOOL_RELISTED: ContextVar[Callable[[str, ToolInfo | None], None] | None] = ContextVar(
    "afd_client_on_tool_relisted", default=None
)


@dataclass
class ElicitationRequest:
    """A form elicitation a server asks the user to answer (MCP ``elicitation/create``).

    Attributes:
        message: The question to show.
        requested_schema: JSON Schema of the form: a flat object of primitive properties.
    """

    message: str
    requested_schema: dict[str, Any]


@dataclass
class ElicitationResponse:
    """The user's answer: ``accept`` with the form content, ``decline`` (an explicit no)
    or ``cancel``."""

    action: Literal["accept", "decline", "cancel"]
    content: dict[str, str | int | float | bool | list[str]] | None = None


ElicitationHandler = Callable[[ElicitationRequest], Awaitable[ElicitationResponse]]
"""Answers a server's elicitation, such as a confirmation of a destructive command."""


@dataclass
class _Answering:
    """One call's elicitations being answered now, and the seconds spent answering."""

    count: int = 0
    seconds: float = 0.0
    idle: asyncio.Event = field(default_factory=asyncio.Event)

    def __post_init__(self) -> None:
        self.idle.set()


_ANSWERING: ContextVar[_Answering | None] = ContextVar("afd_answering", default=None)


def input_required_result(input_requests: Any) -> dict[str, Any]:
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
        headers: dict[str, str] | None = None,
        timeout: float = 30.0,
        client_name: str = "afd-python-client",
        client_version: str = "0.2.0",
        mode: ProtocolMode = "auto",
        on_elicitation: ElicitationHandler | None = None,
        tasks: bool = False,
        on_close: Callable[[], None] | None = None,
        on_error: Callable[[Exception], None] | None = None,
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
        self._tasks = bool(tasks)
        self._protocol_version: str | None = None
        self._session_id: str | None = None

    @property
    def protocol_version(self) -> str | None:
        """The negotiated revision, such as ``"2026-07-28"`` or ``"2025-11-25"``."""
        return self._protocol_version

    @property
    def session_id(self) -> str | None:
        """The ``Mcp-Session-Id`` the server gave a 2025 connection; ``None`` on
        MCP 2026-07-28, which has no sessions. ``McpClient.stream`` sends it."""
        return self._session_id

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

        self._session_id = None

        async def note_session(response: Any) -> None:
            session_id = response.headers.get("mcp-session-id")
            if session_id:
                self._session_id = session_id

        @asynccontextmanager
        async def streams() -> AsyncIterator[Any]:
            http = httpx2.AsyncClient(
                headers=headers, timeout=timeout, event_hooks={"response": [note_session]}
            )
            async with http, streamable_http_client(url, http_client=http) as opened:
                rest: list[Any]
                read, write, *rest = opened
                yield (_EndOfStreamSignal(read, stop.set), write, *rest)

        # A pinned version skips server/discover (and with it the server's identity),
        # so "modern" negotiates like "auto" and then insists on 2026-07-28.
        extensions = [_tasks_client_extension()] if self._tasks else None
        client = _make_afd_mcp_client_cls(Client)(
            streams(),
            mode="legacy" if self._mode == "legacy" else "auto",
            read_timeout_seconds=float(timeout),
            client_info=Implementation(name=self._client_name, version=self._client_version),
            # With a handler the SDK declares elicitation and answers input_required
            # rounds itself; without one, `_call_tool_payload` returns them unanswered.
            elicitation_callback=(
                _elicitation_callback(self._answer) if self._on_elicitation else None
            ),
            extensions=extensions,
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

    async def _bounded(self, operation: Any, *, timeout: float | None = None) -> Any:
        """:meth:`SseTransport._bounded`, except that time a person spends answering
        this call's elicitations does not count against its deadline: a confirmation
        can take longer than a request, and a timeout here reads as a lost connection.

        The pause is per call: the record is set in a context the call's task copies,
        and on MCP 2026-07-28 the SDK runs the handler inside that task. A 2025
        server's ``elicitation/create`` arrives outside it, so nothing is paused there,
        and the SDK's own request clock keeps running too.
        """
        effective_timeout = self._timeout if timeout is None else timeout
        loop = asyncio.get_running_loop()
        record = _Answering()
        token = _ANSWERING.set(record)
        try:
            task = asyncio.ensure_future(operation)
        finally:
            _ANSWERING.reset(token)
        start = loop.time()
        idle: asyncio.Future | None = None
        try:
            while True:
                if record.count:
                    idle = asyncio.ensure_future(record.idle.wait())
                    await asyncio.wait({task, idle}, return_when=asyncio.FIRST_COMPLETED)
                    idle.cancel()
                    idle = None
                else:
                    remaining = start + effective_timeout + record.seconds - loop.time()
                    if remaining <= 0:
                        break
                    await asyncio.wait({task}, timeout=remaining)
                if task.done():
                    return task.result()
        finally:
            if idle is not None:
                idle.cancel()
            if not task.done():
                task.cancel()
                task.add_done_callback(
                    lambda finished: finished.cancelled() or finished.exception()
                )
        raise TimeoutError(f"MCP request timed out after {effective_timeout}s")

    async def _answer(self, request: ElicitationRequest) -> ElicitationResponse:
        """Run the handler, pausing the deadline of the call it answers."""
        assert self._on_elicitation is not None
        record = _ANSWERING.get()
        if record is None:
            return await self._on_elicitation(request)
        loop = asyncio.get_running_loop()
        record.count += 1
        record.idle.clear()
        began = loop.time()
        try:
            return await self._on_elicitation(request)
        finally:
            record.seconds += loop.time() - began
            record.count -= 1
            if not record.count:
                record.idle.set()

    async def _call_tool_payload(
        self,
        session: Any,
        name: str,
        arguments: dict[str, Any],
        *,
        timeout: float | None = None,
    ) -> Any:
        effective_timeout = self._timeout if timeout is None else timeout
        if self._on_elicitation is not None:
            slot = _CapturedTaskSlot()
            token = _CAPTURED_TASK.set(slot)
            try:
                payload = await super()._call_tool_payload(
                    session, name, arguments, timeout=effective_timeout
                )
            finally:
                _CAPTURED_TASK.reset(token)
            if slot.payload is not None and self._tasks:
                return _TaskSeed(slot.payload)
            return payload
        import anyio
        from mcp import MCPError
        from mcp.types import HEADER_MISMATCH, CallToolResult, InputRequiredResult
        from mcp_types.version import MODERN_PROTOCOL_VERSIONS
        from pydantic import ValidationError

        # Send the call by hand so an input_required answer comes back unanswered
        # instead of reaching the SDK's refusing default elicitation callback.
        async def send() -> Any:
            return await session.session.call_tool(
                name,
                arguments,
                read_timeout_seconds=float(effective_timeout),
                allow_input_required=True,
                allow_claimed=self._tasks,
            )

        try:
            result = await send()
        except MCPError as mismatch:
            # mcp.Client.call_tool's recovery: the tool's listed schema is missing or
            # stale on a 2026-07-28 connection, so re-list it and resend once.
            if (
                mismatch.code != HEADER_MISMATCH
                or session.protocol_version not in MODERN_PROTOCOL_VERSIONS
            ):
                raise
            try:
                with anyio.fail_after(effective_timeout):
                    refreshed = await _relist_tool(session, name)
            except (MCPError, TimeoutError, ValidationError) as relist_error:
                raise mismatch from relist_error
            _notify_tool_relisted(name, refreshed)
            result = await send()
        if isinstance(result, InputRequiredResult):
            asked = result.model_dump(by_alias=True, mode="json", exclude_none=True)
            return input_required_result(asked.get("inputRequests"))
        if self._tasks and not isinstance(result, CallToolResult):
            return _TaskSeed(result.model_dump(by_alias=True, mode="json", exclude_none=True))
        return result.model_dump(by_alias=True, mode="json", exclude_none=True)

    async def validate_tool_result(self, name: str, result_payload: dict[str, Any]) -> None:
        """Validate a completed task's ``CallToolResult`` against the tool's output schema."""
        from mcp.types import CallToolResult
        from pydantic import ValidationError

        try:
            call_result = CallToolResult.model_validate(result_payload)
        except ValidationError as exc:
            raise TransportError(
                f"Invalid CallToolResult returned by completed task for '{name}': {exc}",
                cause=exc,
            ) from exc
        if not call_result.is_error and self._session is not None:
            try:
                await self._session.session.validate_tool_result(name, call_result)
            except RuntimeError as exc:
                raise TransportError(str(exc), cause=exc) from exc

    async def get_task(self, task_id: str, *, timeout: float | None = None) -> dict[str, Any]:
        """Fetch an MCP task's current state via ``tasks/get`` (SEP-2663)."""
        if self._session is None:
            raise RuntimeError("Transport not connected. Call connect() first.")
        session = self._session
        effective_timeout = self._timeout if timeout is None else timeout
        task_id_params, get_task_request, _, detailed_task_result = _client_task_models()
        try:
            result = await self._bounded(
                session.session.send_request(
                    get_task_request(params=task_id_params(taskId=task_id)),
                    detailed_task_result,
                    request_read_timeout_seconds=float(effective_timeout),
                ),
                timeout=effective_timeout,
            )
            return result.model_dump(by_alias=True, mode="json", exclude_none=True)
        except Exception as exc:
            if _is_task_request_timeout(exc):
                # A per-call deadline expiring while polling tasks/get is not a connection loss.
                raise TimeoutError(
                    str(exc) or f"tasks/get timed out after {effective_timeout}s"
                ) from exc
            self._raise_operation_error(exc, session)
            raise  # unreachable

    async def cancel_task(self, task_id: str, *, timeout: float | None = None) -> None:
        """Request cooperative cancellation of an MCP task via ``tasks/cancel`` (SEP-2663)."""
        if self._session is None:
            raise RuntimeError("Transport not connected. Call connect() first.")
        session = self._session
        effective_timeout = self._timeout if timeout is None else timeout
        from mcp_types import EmptyResult

        task_id_params, _, cancel_task_request, _ = _client_task_models()
        try:
            await self._bounded(
                session.session.send_request(
                    cancel_task_request(params=task_id_params(taskId=task_id)),
                    EmptyResult,
                    request_read_timeout_seconds=float(effective_timeout),
                ),
                timeout=effective_timeout,
            )
        except Exception as exc:
            if _is_task_request_timeout(exc):
                raise TimeoutError(
                    str(exc) or f"tasks/cancel timed out after {effective_timeout}s"
                ) from exc
            self._raise_operation_error(exc, session)


def _is_task_request_timeout(exc: Exception) -> bool:
    """Whether ``exc`` is a per-request timeout from ``_bounded``, ``send_request`` (408) or ``httpx2``."""
    if isinstance(exc, asyncio.TimeoutError):
        return True
    try:
        from mcp import MCPError

        if isinstance(exc, MCPError) and exc.code == 408:
            return True
    except ImportError:
        pass
    try:
        import httpx2

        if isinstance(exc, httpx2.TimeoutException):
            return True
    except ImportError:
        pass
    return False


_CLIENT_TASK_MODELS: tuple[Any, ...] | None = None


def _client_task_models() -> tuple[Any, Any, Any, Any]:
    global _CLIENT_TASK_MODELS
    if _CLIENT_TASK_MODELS is None:
        from mcp_types import Request, RequestParams, Result
        from pydantic import ConfigDict, Field

        class _TaskIdParams(RequestParams):
            model_config = ConfigDict(populate_by_name=True, extra="ignore")
            task_id: str = Field(alias="taskId")

        class _GetTaskRequest(Request[_TaskIdParams, Literal["tasks/get"]]):
            method: Literal["tasks/get"] = "tasks/get"
            params: _TaskIdParams
            name_param = "taskId"

        class _CancelTaskRequest(Request[_TaskIdParams, Literal["tasks/cancel"]]):
            method: Literal["tasks/cancel"] = "tasks/cancel"
            params: _TaskIdParams
            name_param = "taskId"

        class _DetailedTaskResult(Result):
            model_config = ConfigDict(populate_by_name=True, extra="allow")
            task_id: str = Field(alias="taskId")
            status: str
            status_message: str | None = Field(default=None, alias="statusMessage")
            created_at: str = Field(alias="createdAt")
            last_updated_at: str = Field(alias="lastUpdatedAt")
            ttl_ms: int = Field(alias="ttlMs")
            poll_interval_ms: int | None = Field(default=None, alias="pollIntervalMs")
            result: dict[str, Any] | None = None
            error: dict[str, Any] | None = None

        _CLIENT_TASK_MODELS = (
            _TaskIdParams,
            _GetTaskRequest,
            _CancelTaskRequest,
            _DetailedTaskResult,
        )
    return _CLIENT_TASK_MODELS


def _tasks_client_extension() -> Any:
    """Build the ``mcp.client.extension.ClientExtension`` for ``io.modelcontextprotocol/tasks``."""
    from mcp.client.extension import ClientExtension, ResultClaim
    from mcp.types import CallToolResult
    from mcp_types import Result
    from pydantic import ConfigDict, Field

    class _WireCreateTaskResult(Result):
        model_config = ConfigDict(populate_by_name=True, extra="allow")
        result_type: Literal["task"] = Field(alias="resultType")
        task_id: str = Field(alias="taskId")
        status: str
        status_message: str | None = Field(default=None, alias="statusMessage")
        created_at: str = Field(alias="createdAt")
        last_updated_at: str = Field(alias="lastUpdatedAt")
        ttl_ms: int = Field(alias="ttlMs")
        poll_interval_ms: int | None = Field(default=None, alias="pollIntervalMs")

    async def _capture_task(claimed: _WireCreateTaskResult, _ctx: Any) -> CallToolResult:
        slot = _CAPTURED_TASK.get()
        if slot is not None:
            slot.payload = claimed.model_dump(by_alias=True, mode="json", exclude_none=True)
        # is_error=True skips mcp.Client's outputSchema check on this discarded placeholder.
        return CallToolResult(content=[], is_error=True)

    class _AfdTasksClientExtension(ClientExtension):
        identifier = TASKS_EXTENSION_ID

        def claims(self) -> tuple[ResultClaim[Any], ...]:
            return (
                ResultClaim(
                    result_type="task",
                    model=_WireCreateTaskResult,
                    resolve=_capture_task,
                ),
            )

    return _AfdTasksClientExtension()


_RELIST_PAGE_CAP = 100
"""Page cap for the re-list after a ``HEADER_MISMATCH``, as ``mcp.Client`` caps it."""


def _tool_info_from_sdk_tool(tool: Any) -> ToolInfo:
    """Convert an SDK ``mcp.types.Tool`` (or lightweight test double) to :class:`ToolInfo`."""
    if hasattr(tool, "model_dump"):
        payload = tool.model_dump(by_alias=True, mode="json", exclude_none=True)
        annotations = payload.get("annotations")
        return ToolInfo(
            name=payload["name"],
            description=payload.get("description", ""),
            input_schema=payload.get("inputSchema"),
            meta=payload.get("_meta"),
            annotations=annotations if isinstance(annotations, dict) else None,
        )
    meta = getattr(tool, "meta", None)
    if meta is None:
        meta = getattr(tool, "_meta", None)
    annotations = getattr(tool, "annotations", None)
    if annotations is not None and hasattr(annotations, "model_dump"):
        annotations = annotations.model_dump(by_alias=True, mode="json", exclude_none=True)
    return ToolInfo(
        name=tool.name,
        description=getattr(tool, "description", "") or "",
        input_schema=getattr(tool, "input_schema", None),
        meta=meta if isinstance(meta, dict) else None,
        annotations=annotations if isinstance(annotations, dict) else None,
    )


def _notify_tool_relisted(name: str, tool: ToolInfo | None) -> None:
    """Notify an active ``McpClient.call()`` when ``HEADER_MISMATCH`` refreshes tool metadata."""
    callback = _ON_TOOL_RELISTED.get()
    if callback is not None:
        callback(name, tool)


async def _relist_tool(client: Any, name: str) -> ToolInfo | None:
    """Refetch the tool listing, page by page, until a page lists ``name``
    (``mcp.Client._relist_tool``), returning its refreshed :class:`ToolInfo` or ``None``."""
    cursor: str | None = None
    for _ in range(_RELIST_PAGE_CAP):
        page = await client.list_tools(cursor=cursor, cache_mode="refresh")
        for tool in page.tools:
            if tool.name == name:
                return _tool_info_from_sdk_tool(tool)
        cursor = page.next_cursor
        if cursor is None:
            return None
    return None


def _make_afd_mcp_client_cls(base: type[Any]) -> type[Any]:
    """Build the ``mcp.Client`` subclass that reports ``HEADER_MISMATCH`` relists to AFD."""

    class _AfdMcpClient(base):  # type: ignore[misc]
        async def _relist_tool(self, name: str) -> None:
            refreshed = await _relist_tool(self, name)
            _notify_tool_relisted(name, refreshed)

    return _AfdMcpClient


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
            ElicitationRequest(
                message=params.message, requested_schema=dict(params.requested_schema)
            )
        )
        elicit_content: dict[str, str | int | float | bool | list[str] | None] | None = (
            dict(answer.content) if answer.content is not None else None
        )
        return ElicitResult(action=answer.action, content=elicit_content)

    return callback
