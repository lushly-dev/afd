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
import contextlib
import inspect
import logging
from collections.abc import AsyncGenerator, Callable, Sequence
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import (
    Any,
    Literal,
)

from afd._client_errors import (
    _classify_call_exception,
    _is_tool_info_read_only,
    _outcome_unknown_result,
    _parse_command_result,
)
from afd.core.errors import CommandError
from afd.core.idempotency import AFD_IDEMPOTENCY_KEY_META_KEY
from afd.core.result import CommandResult, failure, success
from afd.transports._mcp_protocol import _HttpBasedTransport
from afd.transports.base import (
    JsonRpcError,
    ToolExecutionError,
    ToolInfo,
    ToolNotFoundError,
    TransportError,
    TransportState,
    _TaskSeed,
)
from afd.transports.streamable_http import (  # noqa: F401 - re-exported
    _ON_TOOL_RELISTED,
    ElicitationHandler,
    ElicitationRequest,
    ElicitationResponse,
)

# Lazy imports for optional transports
_Transport = Any  # Actual Transport protocol from base

logger = logging.getLogger("afd.client")

_TASK_POLL_FAILED: ContextVar[list[bool] | None] = ContextVar(
    "afd_client_task_poll_failed", default=None
)


def _mark_task_poll_failed() -> None:
    """Record that an active ``McpClient.call()`` lost a started MCP task while polling."""
    slot = _TASK_POLL_FAILED.get()
    if slot is not None:
        slot[0] = True


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG / STATUS
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class TaskInfo:
    """Summary of an MCP task returned by ``tools/call`` or progress updates (SEP-2663)."""

    task_id: str
    status: Literal["working", "completed", "failed", "cancelled"]
    created_at: str
    last_updated_at: str
    ttl_ms: int
    status_message: str | None = None
    poll_interval_ms: int | None = None


@dataclass
class DetailedTask(TaskInfo):
    """Detailed MCP task state returned by ``tasks/get`` (SEP-2663)."""

    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


TaskProgressCallback = Callable[[TaskInfo], None]
"""Called when a polled MCP task changes ``status`` or ``status_message``."""


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
        on_elicitation: Answers servers' form elicitations, such as an AFD server's
            confirmation of a command with ``confirm_prompt``. With it the client
            declares elicitation and the MCP SDK retries the call with the answer.
            Without one, a server's ``input_required`` result becomes an
            ``INPUT_REQUIRED`` failure whose ``data.inputRequests`` holds what the server
            asked. ``streamable-http`` only. On MCP 2026-07-28, time spent in the
            handler does not count against ``timeout``; on a 2025 connection it
            does, so give a person enough ``timeout`` to answer.
        max_stream_event_bytes: The largest ``stream()`` event accepted; a larger one
            ends the stream with ``STREAM_EVENT_TOO_LARGE``. Default 1 MiB.
        tasks: Declare ``io.modelcontextprotocol/tasks`` on Streamable HTTP and
            automatically poll returned tasks to completion. Default ``False``.
    """

    url: str = ""
    endpoint: str | None = None
    transport: Literal["streamable-http", "sse", "http"] | None = None
    protocol_mode: Literal["auto", "legacy", "modern"] = "auto"
    auto_reconnect: bool = True
    max_reconnect_attempts: int = 5
    reconnect_delay: float = 1.0
    headers: dict[str, str] = field(default_factory=dict)
    timeout: float = 30.0
    client_name: str = "afd-python-client"
    client_version: str = "0.2.0"
    debug: bool = False
    on_elicitation: ElicitationHandler | None = None
    max_stream_event_bytes: int = 1024 * 1024
    tasks: bool = False

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
    url: str | None = None
    server_info: dict[str, Any] | None = None
    capabilities: dict[str, Any] | None = None
    connected_at: datetime | None = None
    reconnect_attempts: int = 0
    tools_count: int = 0
    pending_requests: int = 0


# ═══════════════════════════════════════════════════════════════════════════════
# MCP CLIENT
# ═══════════════════════════════════════════════════════════════════════════════


def _idempotency_meta(key: str | None) -> dict[str, Any] | None:
    """The request ``_meta`` that carries ``key`` (``spec/idempotency.md``, K1), or ``None``."""
    return None if key is None else {AFD_IDEMPOTENCY_KEY_META_KEY: key}


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
        config: McpClientConfig | None = None,
        *,
        transport: Any | None = None,
    ) -> None:
        """Initialize the client.

        Args:
            config: Client configuration.
            transport: Optional pre-built transport for testing/DI.
        """
        self._config = config or McpClientConfig()
        self._transport = transport
        self._owns_transport = transport is None
        self._tools: list[ToolInfo] = []
        self._connected_at: datetime | None = None
        self._reconnect_attempts = 0
        self._event_handlers: dict[str, list[Callable[..., None]]] = {}
        self._generation = 0
        self._discovery_generation = 0
        self._active = False
        self._reconnect_task: asyncio.Task | None = None
        self._active_task_polls: set[asyncio.Event] = set()
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
        self._discovery_generation += 1
        generation = self._generation
        self._active = False
        if self._transport is not None:
            await self._transport.disconnect()
        self._active = True
        self._reconnect_attempts = 0
        if self._transport is None:
            self._transport = _create_transport(self._config)
        self._bind_transport_events()
        self._tools = []
        self._set_state(TransportState.CONNECTING)
        try:
            await self._transport.connect()
            tools = await self._transport.list_tools()
            if generation != self._generation or not self._active:
                return
            self._tools = tools
            self._connected_at = datetime.now(UTC)
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
        self._discovery_generation += 1
        self._abort_task_polls()
        await self._stop_reconnect()
        if self._transport:
            await self._transport.disconnect()
        self._clear_connection()
        self._set_state(TransportState.DISCONNECTED)
        self._emit("disconnected", "Manual disconnect")

    def _abort_task_polls(self) -> None:
        for abort_event in list(self._active_task_polls):
            abort_event.set()
        self._active_task_polls.clear()

    def is_connected(self) -> bool:
        """Check if the client and transport are connected."""
        return (
            self._state == TransportState.CONNECTED
            and self._transport is not None
            and self._transport.state == TransportState.CONNECTED
        )

    # ── Tool queries ──────────────────────────────────────────────────────

    async def list_tools(self) -> list[ToolInfo]:
        """Refresh and return the list of available tools."""
        self._require_connected()
        discovery_generation = self._discovery_generation
        transport = self._transport
        tools: list[ToolInfo] = await self._request("list_tools")
        if (
            discovery_generation == self._discovery_generation
            and transport is self._transport
            and self.is_connected()
        ):
            self._tools = tools
        return tools

    def get_tools(self) -> list[ToolInfo]:
        """Return the cached tools list (no network call)."""
        return list(self._tools)

    # ── Call operations ───────────────────────────────────────────────────

    async def get_task(
        self,
        task_id: str,
        *,
        timeout: float | None = None,
    ) -> DetailedTask:
        """Fetch the current state of an MCP task via ``tasks/get``."""
        self._require_connected()
        raw = await self._request_with_timeout("get_task", task_id, timeout=timeout)
        return _parse_detailed_task(raw)

    async def cancel_task(
        self,
        task_id: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Request cooperative cancellation of an MCP task via ``tasks/cancel``."""
        self._require_connected()
        await self._request_with_timeout("cancel_task", task_id, timeout=timeout)

    async def call(
        self,
        name: str,
        args: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
        cancel: asyncio.Event | None = None,
        on_task_progress: TaskProgressCallback | None = None,
        idempotency_key: str | None = None,
    ) -> CommandResult:
        """Call a command and return a ``CommandResult``.

        This is the primary method for AFD usage.  The raw MCP result is
        unwrapped: if the data is already a ``CommandResult`` dict (camelCase
        from TypeScript/Rust servers, or snake_case) it is parsed with all its
        fields, including a failure sent with ``isError: true``; otherwise it
        is wrapped in ``success()``.

        When ``McpClientConfig.tasks`` is ``True`` and the server responds with
        an MCP task (``resultType: "task"``), polls ``tasks/get`` to completion
        within ``timeout`` (defaulting to ``config.timeout``) and returns the
        final ``CommandResult``.

        When a timeout, connection or transport loss, HTTP 5xx, JSON-RPC
        ``-32603``, or a failed task poll leaves the outcome unknown, tools not
        positively declared ``_meta.mutation is False`` (without contradicting
        ``destructive``, ``destructiveHint``, or ``readOnlyHint: False``) before
        dispatch return ``OUTCOME_UNKNOWN`` with ``retryable=False`` and the
        underlying cause code in ``details["cause"]``. Tools positively marked
        read-only return the underlying error (``TIMEOUT``, ``INTERNAL_ERROR``,
        ``HTTP_5xx``, ``TRANSPORT_ERROR``, ...).

        Args:
            name: Tool/command name.
            args: Command arguments.
            timeout: Optional total timeout in seconds (covering task polling).
            cancel: Optional ``asyncio.Event`` to cancel a running task.
            on_task_progress: Optional callback invoked when a task's status or
                ``status_message`` changes.
            idempotency_key: The call's idempotency key (``spec/idempotency.md``, K1), sent
                in ``_meta["dev.afd/idempotencyKey"]``. A server with the idempotency step
                answers a repeat of a ``keyed`` command with the same key and input from its
                store. Send the same key when you repeat a call whose outcome you do not know.

        Returns:
            CommandResult (success or failure).
        """
        self._require_connected()
        if idempotency_key is not None:
            try:
                self._meta_kwargs(idempotency_key)
            except TypeError as exc:
                # Refused before dispatch, so this is no lost answer (OUTCOME_UNKNOWN).
                return failure(
                    CommandError(
                        code="UNSUPPORTED_OPTION",
                        message=str(exc),
                        suggestion=(
                            "Nothing was sent. Use a transport whose call_tool takes meta (every "
                            "built-in one does), or call without an idempotency key."
                        ),
                        retryable=False,
                    )
                )
        # Capture read-only metadata before dispatch so a concurrent tools/list
        # refresh or reconnect cannot flip an in-flight call's classification.
        # If Streamable HTTP recovers from HEADER_MISMATCH by re-listing and
        # resending, _on_tool_relisted updates read_only_state before the resend
        # while call_tool() updates the connection's cached tool metadata.
        read_only_state = [self._is_read_only_tool(name)]
        poll_failed = [False]

        def _on_tool_relisted(tool_name: str, tool_info: ToolInfo | None) -> None:
            if tool_name == name:
                read_only_state[0] = (
                    _is_tool_info_read_only(tool_info) if tool_info is not None else False
                )

        poll_token = _TASK_POLL_FAILED.set(poll_failed)
        relist_token = _ON_TOOL_RELISTED.set(_on_tool_relisted)

        try:
            data = await self.call_tool(
                name,
                args or {},
                timeout=timeout,
                cancel=cancel,
                on_task_progress=on_task_progress,
                idempotency_key=idempotency_key,
            )

            # A CommandResult-shaped dict keeps every field it carries
            if isinstance(data, dict) and isinstance(data.get("success"), bool):
                return _parse_command_result(data)

            return success(data)

        except Exception as exc:
            cause, outcome_unknown = _classify_call_exception(exc)
            if (poll_failed[0] or outcome_unknown) and not read_only_state[0]:
                return _outcome_unknown_result(cause)
            return cause
        finally:
            _ON_TOOL_RELISTED.reset(relist_token)
            _TASK_POLL_FAILED.reset(poll_token)

    def _update_cached_tool(
        self,
        tool_name: str,
        tool_info: ToolInfo | None,
        *,
        discovery_generation: int,
        transport: _Transport | None,
    ) -> None:
        """Atomically refresh one entry in ``_tools`` if the connection generation still matches."""
        if (
            discovery_generation != self._discovery_generation
            or transport is not self._transport
            or not self.is_connected()
        ):
            return
        updated = [tool for tool in self._tools if tool.name != tool_name]
        if tool_info is not None:
            updated.append(tool_info)
        self._tools = updated

    async def call_tool(
        self,
        name: str,
        args: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
        cancel: asyncio.Event | None = None,
        on_task_progress: TaskProgressCallback | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        """Call a tool and return the raw result (no CommandResult wrapping).

        If the server responds with an MCP task (``resultType: "task"``), polls
        ``tasks/get`` until the task finishes and returns the extracted tool result.

        Args:
            name: Tool name.
            args: Tool arguments.
            timeout: Optional total timeout in seconds.
            cancel: Optional cancellation event for polled tasks.
            on_task_progress: Optional progress callback for polled tasks.
            idempotency_key: The call's idempotency key, sent in
                ``_meta["dev.afd/idempotencyKey"]`` (as for :meth:`call`).

        Returns:
            Raw tool result.
        """
        self._require_connected()
        total_timeout = self._config.timeout if timeout is None else timeout
        loop = asyncio.get_running_loop()
        deadline = loop.time() + total_timeout
        outer_relisted = _ON_TOOL_RELISTED.get()
        discovery_generation = self._discovery_generation
        transport = self._transport

        def _on_tool_relisted(tool_name: str, tool_info: ToolInfo | None) -> None:
            self._update_cached_tool(
                tool_name,
                tool_info,
                discovery_generation=discovery_generation,
                transport=transport,
            )
            if outer_relisted is not None:
                outer_relisted(tool_name, tool_info)

        relist_token = _ON_TOOL_RELISTED.set(_on_tool_relisted)
        try:
            raw = await self._request_with_timeout(
                "call_tool",
                name,
                args or {},
                timeout=timeout,
                meta=_idempotency_meta(idempotency_key),
            )
        finally:
            _ON_TOOL_RELISTED.reset(relist_token)
        if isinstance(raw, _TaskSeed) and self._config.tasks:
            return await self._poll_task(
                raw.payload,
                tool_name=name,
                deadline=deadline,
                total_timeout=total_timeout,
                cancel=cancel,
                on_task_progress=on_task_progress,
            )
        return raw

    async def _poll_task(
        self,
        initial: dict[str, Any],
        *,
        tool_name: str,
        deadline: float,
        total_timeout: float,
        cancel: asyncio.Event | None,
        on_task_progress: TaskProgressCallback | None,
    ) -> Any:
        import math

        loop = asyncio.get_running_loop()
        disconnect_abort = asyncio.Event()
        self._active_task_polls.add(disconnect_abort)

        info = _parse_task_info(initial)
        task_id = info.task_id
        poll_interval_s = _normalize_poll_interval(info.poll_interval_ms)
        last_status = info.status
        last_message = info.status_message

        def cancelled_payload() -> dict[str, Any]:
            return {
                "success": False,
                "error": {
                    "code": "COMMAND_CANCELLED",
                    "message": "Task was cancelled",
                    "suggestion": "Start the command again if the work is still needed",
                    "retryable": False,
                },
            }

        def cancel_best_effort() -> None:
            if not self.is_connected():
                return

            async def _send_cancel() -> None:
                with contextlib.suppress(Exception):
                    await self.cancel_task(task_id, timeout=5.0)

            task = asyncio.create_task(_send_cancel())
            task.add_done_callback(lambda done: done.cancelled() or done.exception())

        def _cleanup_tasks(tasks: Sequence[asyncio.Task[Any]]) -> None:
            for item in tasks:
                if not item.done():
                    item.cancel()
                    item.add_done_callback(lambda done: done.cancelled() or done.exception())
                elif not item.cancelled():
                    with contextlib.suppress(Exception):
                        item.exception()

        try:
            if on_task_progress is not None:
                on_task_progress(info)

            while True:
                if disconnect_abort.is_set():
                    _mark_task_poll_failed()
                    raise TransportError("Client disconnected")
                if cancel is not None and cancel.is_set():
                    cancel_best_effort()
                    return cancelled_payload()

                remaining_before_wait = deadline - loop.time()
                if remaining_before_wait <= 0:
                    cancel_best_effort()
                    _mark_task_poll_failed()
                    raise TimeoutError(f"MCP task '{task_id}' timed out after {total_timeout}s")

                wait_s = min(poll_interval_s, remaining_before_wait)
                waiters = [asyncio.create_task(disconnect_abort.wait())]
                if cancel is not None:
                    waiters.append(asyncio.create_task(cancel.wait()))
                try:
                    await asyncio.wait(waiters, timeout=wait_s, return_when=asyncio.FIRST_COMPLETED)
                finally:
                    _cleanup_tasks(waiters)

                if disconnect_abort.is_set():
                    _mark_task_poll_failed()
                    raise TransportError("Client disconnected")
                if cancel is not None and cancel.is_set():
                    cancel_best_effort()
                    return cancelled_payload()

                remaining = deadline - loop.time()
                if remaining <= 0:
                    cancel_best_effort()
                    _mark_task_poll_failed()
                    raise TimeoutError(f"MCP task '{task_id}' timed out after {total_timeout}s")

                poll_task: asyncio.Task[DetailedTask] = asyncio.create_task(
                    self.get_task(task_id, timeout=remaining)
                )
                abort_waiter = asyncio.create_task(disconnect_abort.wait())
                cancel_waiter = asyncio.create_task(cancel.wait()) if cancel is not None else None
                race: list[asyncio.Task[Any]] = [poll_task, abort_waiter]
                if cancel_waiter is not None:
                    race.append(cancel_waiter)
                done: set[asyncio.Task[Any]] = set()
                try:
                    done, _ = await asyncio.wait(
                        race, timeout=remaining, return_when=asyncio.FIRST_COMPLETED
                    )
                finally:
                    to_clean: list[asyncio.Task[Any]] = [
                        w for w in (abort_waiter, cancel_waiter) if w is not None
                    ]
                    if poll_task not in done:
                        to_clean.append(poll_task)
                    _cleanup_tasks(to_clean)

                if poll_task not in done:
                    if cancel is not None and cancel.is_set():
                        cancel_best_effort()
                        return cancelled_payload()
                    if disconnect_abort.is_set():
                        _mark_task_poll_failed()
                        raise TransportError("Client disconnected")
                    cancel_best_effort()
                    _mark_task_poll_failed()
                    raise TimeoutError(f"MCP task '{task_id}' timed out after {total_timeout}s")

                try:
                    detailed = poll_task.result()
                except TimeoutError:
                    cancel_best_effort()
                    _mark_task_poll_failed()
                    raise TimeoutError(
                        f"MCP task '{task_id}' timed out after {total_timeout}s"
                    ) from None
                except TransportError as exc:
                    if isinstance(exc.cause, asyncio.TimeoutError):
                        cancel_best_effort()
                        _mark_task_poll_failed()
                        raise TimeoutError(
                            f"MCP task '{task_id}' timed out after {total_timeout}s"
                        ) from exc
                    if cancel is not None and cancel.is_set():
                        cancel_best_effort()
                        return cancelled_payload()
                    if disconnect_abort.is_set():
                        _mark_task_poll_failed()
                        raise TransportError("Client disconnected") from exc
                    _mark_task_poll_failed()
                    raise
                except Exception:
                    if cancel is not None and cancel.is_set():
                        cancel_best_effort()
                        return cancelled_payload()
                    _mark_task_poll_failed()
                    raise

                if detailed.status != last_status or detailed.status_message != last_message:
                    last_status = detailed.status
                    last_message = detailed.status_message
                    if on_task_progress is not None:
                        on_task_progress(
                            TaskInfo(
                                task_id=detailed.task_id,
                                status=detailed.status,
                                status_message=detailed.status_message,
                                created_at=detailed.created_at,
                                last_updated_at=detailed.last_updated_at,
                                ttl_ms=detailed.ttl_ms,
                                poll_interval_ms=detailed.poll_interval_ms,
                            )
                        )

                if detailed.status == "completed":
                    if not isinstance(detailed.result, dict):
                        _mark_task_poll_failed()
                        raise TransportError(
                            f"MCP task '{task_id}' completed without a valid tool result"
                        )
                    validator = getattr(self._transport, "validate_tool_result", None)
                    if callable(validator):
                        try:
                            await validator(tool_name, detailed.result)
                        except Exception:
                            _mark_task_poll_failed()
                            raise
                    return _HttpBasedTransport._extract_content(detailed.result)
                if detailed.status == "failed":
                    err = detailed.error or {}
                    code = err.get("code", -32603)
                    message = err.get("message", "Task failed")
                    raise JsonRpcError(
                        code if isinstance(code, int) and not isinstance(code, bool) else -32603,
                        str(message),
                        err.get("data"),
                    )
                if detailed.status == "cancelled":
                    return cancelled_payload()

                if (
                    isinstance(detailed.poll_interval_ms, (int, float))
                    and not isinstance(detailed.poll_interval_ms, bool)
                    and math.isfinite(detailed.poll_interval_ms)
                    and detailed.poll_interval_ms > 0
                ):
                    poll_interval_s = max(0.01, detailed.poll_interval_ms / 1000.0)
        finally:
            self._active_task_polls.discard(disconnect_abort)

    # ── Batch / Pipeline ──────────────────────────────────────────────────

    async def batch(
        self,
        commands: Sequence[dict[str, Any]],
        options: dict[str, Any] | None = None,
        *,
        idempotency_key: str | None = None,
    ) -> Any:
        """Execute a batch of commands via the ``afd-batch`` tool.

        Args:
            commands: List of ``{"name": ..., "input": ...}`` dicts.
            options: Batch options (e.g., ``{"stopOnError": True}``).
            idempotency_key: The request's idempotency key: the item at index ``i`` runs
                under ``<key>:<i>`` (``spec/idempotency.md``, K4).

        Returns:
            Batch result from the server.
        """
        self._require_connected()
        normalized_commands: list[dict[str, Any]] = []
        for command in commands:
            payload = dict(command)
            if "command" not in payload and "name" in payload:
                payload["command"] = payload.pop("name")
            normalized_commands.append(payload)
        return await self._request_kw(
            "call_tool",
            "afd-batch",
            {
                "commands": normalized_commands,
                "options": options or {},
            },
            **self._meta_kwargs(idempotency_key),
        )

    async def pipe(
        self,
        steps: Sequence[dict[str, Any]],
        options: dict[str, Any] | None = None,
        *,
        idempotency_key: str | None = None,
    ) -> Any:
        """Execute a pipeline via the ``afd-pipe`` tool.

        Args:
            steps: Pipeline steps with variable references.
            options: Pipeline options.
            idempotency_key: The request's idempotency key: the step at index ``i`` runs
                under ``<key>:step:<i>`` (``spec/idempotency.md``, K4).

        Returns:
            Pipeline result from the server.
        """
        self._require_connected()
        return await self._request_kw(
            "call_tool",
            "afd-pipe",
            {
                "steps": list(steps),
                "options": options or {},
            },
            **self._meta_kwargs(idempotency_key),
        )

    # ── Streaming ─────────────────────────────────────────────────────────

    async def stream(
        self,
        name: str,
        args: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
        cancel: asyncio.Event | None = None,
        idle_timeout: Any = ...,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Stream a command's results from the server's ``POST /stream/<command>``.

        The URL is the client's without a trailing ``/sse``, ``/message``,
        ``/messages`` or (for ``streamable-http``) ``/mcp``, plus
        ``/stream/<name>`` (URL-encoded). On a 2025 Streamable HTTP connection the
        request carries the session's ``Mcp-Session-Id``, so the stream sees the
        session's active context. As TypeScript's ``stream()``, the last chunk is
        always ``complete`` or ``error``: the client makes ``STREAM_TRUNCATED``,
        ``STREAM_TIMEOUT``, ``STREAM_CANCELLED``, ``STREAM_EVENT_TOO_LARGE``, an HTTP
        refusal (the server's ``error``, or ``STREAM_ERROR``), ``CONNECTION_ERROR`` or,
        when the client is not connected, ``NOT_CONNECTED`` itself, and skips events
        that are not chunks.

        Args:
            name: Command name.
            args: Command arguments.
            timeout: Seconds the whole stream may take; ``None`` for no deadline.
            cancel: Set it to stop the stream with ``STREAM_CANCELLED``.
            idle_timeout: Seconds the server may stay silent before the stream fails
                with ``CONNECTION_ERROR``; ``None`` for no limit. By default
                ``config.timeout``, unless ``timeout`` bounds the stream instead.

        Yields:
            Chunks in wire format (camelCase). Use
            :func:`afd.core.streaming.parse_stream_chunk` for models.
        """
        from afd.client_stream import stream_error_chunk, stream_over_http

        if not self.is_connected():
            yield stream_error_chunk(
                {
                    "code": "NOT_CONNECTED",
                    "message": "The client is not connected",
                    "suggestion": "Call connect() before stream()",
                    "retryable": False,
                },
                0,
            )
            return
        from afd.transports._mcp_protocol import derive_stream_url

        base_url = self._config.resolved_url
        if self._config.resolved_transport == "streamable-http":
            # An AFD server serves /mcp and /stream side by side.
            from urllib.parse import urlsplit, urlunsplit

            parts = urlsplit(base_url)
            path = parts.path.rstrip("/")
            if path.endswith("/mcp"):
                base_url = urlunsplit(parts._replace(path=path[: -len("/mcp")]))
        stream = stream_over_http(
            derive_stream_url(base_url, name),
            args,
            headers=self._config.headers,
            session_id=getattr(self._transport, "session_id", None),
            timeout=timeout,
            cancel=cancel,
            connect_timeout=self._config.timeout,
            read_timeout=(
                (None if timeout is not None else self._config.timeout)
                if idle_timeout is ...
                else idle_timeout
            ),
            max_event_bytes=self._config.max_stream_event_bytes,
        )
        try:
            async for chunk in stream:
                yield chunk
        finally:
            await stream.aclose()

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
        transport = self._transport
        if transport is not None and hasattr(transport, "set_callbacks"):
            transport.set_callbacks(
                on_close=lambda: self._connection_lost(transport),
                on_error=lambda exc: self._connection_lost(transport, exc),
            )

    def _connection_lost(self, transport: Any, exc: Exception | None = None) -> None:
        if (
            not self._active
            or transport is not self._transport
            or self._state != TransportState.CONNECTED
        ):
            return
        self._discovery_generation += 1
        self._abort_task_polls()
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
        return await self._request_kw(method, *args)

    def _meta_kwargs(self, idempotency_key: str | None) -> dict[str, Any]:
        """``{"meta": ...}`` for a call that carries an idempotency key, else ``{}``.

        Raises:
            TypeError: When the transport's ``call_tool`` takes no ``meta``, so it could not send
                the key. Nothing was sent.
        """
        meta = _idempotency_meta(idempotency_key)
        if meta is None:
            return {}
        fn = getattr(self._transport, "call_tool", None)
        if fn is None or not _accepts_keyword(fn, "meta"):
            raise TypeError(
                "This transport does not send request _meta, so it cannot carry an idempotency key"
            )
        return {"meta": meta}

    async def _request_with_timeout(
        self,
        method: str,
        *args: Any,
        timeout: float | None = None,
        meta: dict[str, Any] | None = None,
    ) -> Any:
        """Invoke a transport method, enforcing ``timeout`` even on transports that omit it,
        with the request ``_meta`` when given."""
        transport = self._transport
        fn = getattr(transport, method, None)
        if fn is None:
            raise TransportError(f"Transport does not support '{method}'")
        extra = self._meta_kwargs(meta[AFD_IDEMPOTENCY_KEY_META_KEY]) if meta else {}
        if timeout is None:
            return await self._request_kw(method, *args, **extra)
        if _accepts_keyword(fn, "timeout"):
            return await self._request_kw(method, *args, timeout=timeout, **extra)
        return await asyncio.wait_for(self._request_kw(method, *args, **extra), timeout=timeout)

    async def _request_kw(self, method: str, *args: Any, **kwargs: Any) -> Any:
        """Invoke a transport method with optional keyword arguments."""
        transport = self._transport
        fn = getattr(transport, method, None)
        if fn is None:
            raise TransportError(f"Transport does not support '{method}'")
        try:
            return await fn(*args, **kwargs)
        except TransportError as exc:
            if (
                not isinstance(exc, (ToolExecutionError, ToolNotFoundError, JsonRpcError))
                and transport is not None
                and transport.state != TransportState.CONNECTED
            ):
                self._connection_lost(transport, exc)
            raise

    async def _stop_reconnect(self) -> None:
        task = self._reconnect_task
        self._reconnect_task = None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _attempt_reconnect(self) -> bool:
        """Restore discovery after loss; never replay an in-flight command."""
        generation = self._generation
        last_error: Exception | None = None
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
                    if self._transport is not None:
                        await self._transport.disconnect()
                    # Reuse injected transports, which may not have a URL config.
                    if self._owns_transport:
                        self._transport = _create_transport(self._config)
                    transport = self._transport
                    if transport is None:
                        return False
                    self._bind_transport_events()
                    await transport.connect()
                    self._discovery_generation += 1
                    self._tools = []
                    tools = await transport.list_tools()
                    if not self._active or generation != self._generation:
                        await transport.disconnect()
                        return False
                    self._tools = tools
                    self._connected_at = datetime.now(UTC)
                    self._reconnect_attempts = 0
                    self._set_state(TransportState.CONNECTED)
                    self._emit("connected")
                    return True
                except Exception as exc:
                    last_error = exc
                    self._discovery_generation += 1
                    self._tools = []
                    if self._transport is not None:
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
            server_info=getattr(self._transport, "_server_info", None) if self._transport else None,
            capabilities=getattr(self._transport, "_capabilities", None)
            if self._transport
            else None,
            connected_at=self._connected_at,
            reconnect_attempts=self._reconnect_attempts,
            tools_count=len(self._tools),
        )

    # ── Internal ──────────────────────────────────────────────────────────

    def _is_read_only_tool(self, name: str) -> bool:
        """Whether cached tool metadata positively declares ``_meta.mutation is False``.

        Unknown tools, tools without ``_meta.mutation: False``, and tools with
        contradicting ``destructive``, ``destructiveHint``, or ``readOnlyHint: False``
        markers return ``False`` so ambiguous transport failures fail closed as
        ``OUTCOME_UNKNOWN``.
        """
        tool = next((entry for entry in self._tools if entry.name == name), None)
        return tool is not None and _is_tool_info_read_only(tool)

    def _require_connected(self) -> None:
        """Raise if not connected."""
        if not self.is_connected():
            raise RuntimeError("Client not connected. Call connect() first.")

    def _debug(self, message: str) -> None:
        """Debug logging."""
        if self._config.debug:
            print(f"[McpClient] {message}")


# ═══════════════════════════════════════════════════════════════════════════════
# FACTORY
# ═══════════════════════════════════════════════════════════════════════════════


def _accepts_keyword(fn: Any, keyword: str) -> bool:
    """Whether callable ``fn`` accepts ``keyword`` (explicitly or via ``**kwargs``)."""
    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return False
    for param in params:
        if param.kind == inspect.Parameter.VAR_KEYWORD:
            return True
        if param.name == keyword and param.kind in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        ):
            return True
    return False


def _normalize_poll_interval(poll_interval_ms: int | None) -> float:
    import math

    if (
        isinstance(poll_interval_ms, (int, float))
        and not isinstance(poll_interval_ms, bool)
        and math.isfinite(poll_interval_ms)
        and poll_interval_ms > 0
    ):
        return max(0.01, poll_interval_ms / 1000.0)
    return 0.25


def _parse_task_info(raw: dict[str, Any]) -> TaskInfo:
    raw_ttl = raw.get("ttlMs") if raw.get("ttlMs") is not None else raw.get("ttl_ms", 0)
    return TaskInfo(
        task_id=str(raw.get("taskId") or raw.get("task_id") or ""),
        status=raw.get("status", "working"),
        status_message=raw.get("statusMessage", raw.get("status_message")),
        created_at=str(raw.get("createdAt") or raw.get("created_at") or ""),
        last_updated_at=str(raw.get("lastUpdatedAt") or raw.get("last_updated_at") or ""),
        ttl_ms=int(raw_ttl if raw_ttl is not None else 0),
        poll_interval_ms=raw.get("pollIntervalMs", raw.get("poll_interval_ms")),
    )


def _parse_detailed_task(raw: dict[str, Any]) -> DetailedTask:
    base = _parse_task_info(raw)
    return DetailedTask(
        task_id=base.task_id,
        status=base.status,
        status_message=base.status_message,
        created_at=base.created_at,
        last_updated_at=base.last_updated_at,
        ttl_ms=base.ttl_ms,
        poll_interval_ms=base.poll_interval_ms,
        result=raw.get("result"),
        error=raw.get("error"),
    )


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
            on_elicitation=config.on_elicitation,
            tasks=config.tasks,
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
    transport: Literal["streamable-http", "sse", "http"] | None = None,
    protocol_mode: Literal["auto", "legacy", "modern"] = "auto",
    auto_reconnect: bool = True,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
    debug: bool = False,
    on_elicitation: ElicitationHandler | None = None,
    tasks: bool = False,
) -> McpClient:
    """Create an McpClient with sensible defaults.

    Args:
        url: Server URL.
        transport: Transport type; inferred from the URL when omitted.
        protocol_mode: Protocol negotiation mode (``"auto"``, ``"legacy"`` or ``"modern"``).
        auto_reconnect: Enable auto-reconnect.
        headers: Custom HTTP headers.
        timeout: Request timeout in seconds.
        debug: Enable debug logging.
        on_elicitation: Optional form elicitation callback.
        tasks: Declare ``io.modelcontextprotocol/tasks`` and poll returned tasks to completion.

    Returns:
        Configured McpClient instance.

    Example:
        >>> client = create_client("http://localhost:3100/mcp")
        >>> await client.connect()
        >>> result = await client.call("ping")
    """
    return McpClient(
        McpClientConfig(
            url=url,
            transport=transport,
            protocol_mode=protocol_mode,
            auto_reconnect=auto_reconnect,
            headers=headers or {},
            timeout=timeout,
            debug=debug,
            on_elicitation=on_elicitation,
            tasks=tasks,
        )
    )
