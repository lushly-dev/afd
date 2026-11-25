"""Tests for McpClient."""

import pytest

from afd import success
from afd.client import ClientStatus, McpClient, McpClientConfig, create_client
from afd.transports.base import TransportState
from afd.transports.mock import MockTransport

# ============================================================================
# Helpers
# ============================================================================


def _connected_transport() -> MockTransport:
    """Create a MockTransport pre-loaded with common tools."""
    t = MockTransport()
    t.add_mock_response("ping", {"status": "pong"})
    return t


async def _connected_client(transport: MockTransport | None = None) -> McpClient:
    """Create and connect a client with a mock transport."""
    t = transport or _connected_transport()
    client = McpClient(transport=t)
    await client.connect()
    return client


# ============================================================================
# Config defaults
# ============================================================================


class TestMcpClientConfig:
    """Tests for McpClientConfig defaults."""

    def test_defaults(self):
        config = McpClientConfig()
        assert config.url == ""
        assert config.transport is None
        assert config.protocol_mode == "auto"
        assert config.auto_reconnect is True
        assert config.max_reconnect_attempts == 5
        assert config.reconnect_delay == 1.0
        assert config.headers == {}
        assert config.timeout == 30.0
        assert config.debug is False

    def test_transport_is_inferred_from_the_url(self):
        from afd.client import infer_transport

        assert infer_transport("http://h:1/mcp") == "streamable-http"
        assert infer_transport("http://h:1") == "streamable-http"
        assert infer_transport("http://h:1/sse") == "sse"
        assert infer_transport("http://h:1/api/sse/") == "sse"
        assert infer_transport("http://h:1/message") == "http"
        assert infer_transport("http://h:1/messages/") == "http"
        assert McpClientConfig(url="http://h/mcp").resolved_transport == "streamable-http"
        assert McpClientConfig(url="http://h/mcp", transport="sse").resolved_transport == "sse"

    def test_custom_config(self):
        config = McpClientConfig(
            url="http://localhost:3100/sse",
            transport="http",
            auto_reconnect=False,
            timeout=10.0,
        )
        assert config.url == "http://localhost:3100/sse"
        assert config.transport == "http"
        assert config.auto_reconnect is False
        assert config.timeout == 10.0


# ============================================================================
# ClientStatus
# ============================================================================


class TestClientStatus:
    """Tests for ClientStatus."""

    def test_defaults(self):
        status = ClientStatus()
        assert status.state == TransportState.DISCONNECTED
        assert status.url is None
        assert status.connected_at is None
        assert status.reconnect_attempts == 0
        assert status.tools_count == 0


# ============================================================================
# Initial state
# ============================================================================


class TestMcpClientInitialState:
    """Tests for initial client state."""

    def test_not_connected(self):
        client = McpClient()
        assert not client.is_connected()

    def test_get_status_disconnected(self):
        client = McpClient()
        status = client.get_status()
        assert status.state == TransportState.DISCONNECTED

    def test_empty_tools(self):
        client = McpClient()
        assert client.get_tools() == []


# ============================================================================
# Connect / disconnect
# ============================================================================


class TestMcpClientLifecycle:
    """Tests for connect and disconnect."""

    @pytest.mark.asyncio
    async def test_connect_with_transport(self):
        transport = _connected_transport()
        client = McpClient(transport=transport)

        await client.connect()
        assert client.is_connected()

    @pytest.mark.asyncio
    async def test_disconnect(self):
        client = await _connected_client()
        await client.disconnect()
        assert not client.is_connected()

    @pytest.mark.asyncio
    async def test_status_after_connect(self):
        client = await _connected_client()
        status = client.get_status()
        assert status.state == TransportState.CONNECTED
        assert status.connected_at is not None
        assert status.reconnect_attempts == 0

    @pytest.mark.asyncio
    async def test_tools_fetched_on_connect(self):
        transport = MockTransport()

        async def handler(args):
            return success({"ok": True})

        transport.register_tool("my-tool", handler, description="Test tool")
        client = McpClient(transport=transport)
        await client.connect()

        tools = client.get_tools()
        assert len(tools) == 1
        assert tools[0].name == "my-tool"


# ============================================================================
# Events
# ============================================================================


class TestMcpClientEvents:
    """Tests for event subscribe/unsubscribe."""

    @pytest.mark.asyncio
    async def test_connected_event(self):
        events = []
        transport = _connected_transport()
        client = McpClient(transport=transport)
        client.on("connected", lambda: events.append("connected"))

        await client.connect()
        assert "connected" in events

    @pytest.mark.asyncio
    async def test_disconnected_event(self):
        events = []
        client = await _connected_client()
        client.on("disconnected", lambda reason: events.append(reason))

        await client.disconnect()
        assert "Manual disconnect" in events

    @pytest.mark.asyncio
    async def test_state_change_events(self):
        states = []
        transport = _connected_transport()
        client = McpClient(transport=transport)
        client.on("state_change", lambda s: states.append(s))

        await client.connect()
        assert TransportState.CONNECTING in states
        assert TransportState.CONNECTED in states

    def test_unsubscribe(self):
        events = []
        client = McpClient()
        unsub = client.on("connected", lambda: events.append("yes"))

        client._emit("connected")
        assert len(events) == 1

        unsub()
        client._emit("connected")
        assert len(events) == 1  # no new event


# ============================================================================
# call()
# ============================================================================


class TestMcpClientCall:
    """Tests for call() returning CommandResult."""

    @pytest.mark.asyncio
    async def test_call_wraps_in_success(self):
        transport = MockTransport()
        transport.add_mock_response("ping", {"status": "pong"})

        client = await _connected_client(transport)
        result = await client.call("ping", {})

        assert result.success is True
        assert result.data == {"status": "pong"}

    @pytest.mark.asyncio
    async def test_call_returns_command_result_as_is(self):
        transport = MockTransport()
        transport.add_mock_response(
            "cmd",
            {
                "success": True,
                "data": {"id": "42"},
                "reasoning": "Found it",
            },
        )

        client = await _connected_client(transport)
        result = await client.call("cmd", {})

        assert result.success is True
        assert result.data == {"id": "42"}
        assert result.reasoning == "Found it"

    @pytest.mark.asyncio
    async def test_call_unknown_tool_returns_failure(self):
        transport = MockTransport()
        client = await _connected_client(transport)

        # MockTransport raises ToolNotFoundError which is a TransportError subclass
        result = await client.call("nonexistent", {})
        assert result.success is False

    @pytest.mark.asyncio
    async def test_call_without_connect_raises(self):
        client = McpClient()

        with pytest.raises(RuntimeError, match="not connected"):
            await client.call("test", {})


# ============================================================================
# call_tool()
# ============================================================================


class TestMcpClientCallTool:
    """Tests for call_tool() raw pass-through."""

    @pytest.mark.asyncio
    async def test_call_tool_returns_raw(self):
        transport = MockTransport()
        transport.add_mock_response("raw-tool", {"raw": True})

        client = await _connected_client(transport)
        result = await client.call_tool("raw-tool", {})
        assert result == {"raw": True}


# ============================================================================
# batch()
# ============================================================================


class TestMcpClientBatch:
    """Tests for batch()."""

    @pytest.mark.asyncio
    async def test_batch_calls_afd_batch_tool(self):
        transport = MockTransport()
        transport.add_mock_response(
            "afd-batch",
            {
                "success": True,
                "results": [{"success": True}],
            },
        )

        client = await _connected_client(transport)
        result = await client.batch(
            [
                {"name": "todo-create", "input": {"title": "Test"}},
            ]
        )

        assert result["success"] is True

        # Verify it called afd-batch and normalized name -> command
        last = transport.last_call("afd-batch")
        assert last is not None
        assert len(last.arguments["commands"]) == 1
        assert last.arguments["commands"][0]["command"] == "todo-create"
        assert "name" not in last.arguments["commands"][0]


# ============================================================================
# pipe()
# ============================================================================


class TestMcpClientPipe:
    """Tests for pipe()."""

    @pytest.mark.asyncio
    async def test_pipe_calls_afd_pipe_tool(self):
        transport = MockTransport()
        transport.add_mock_response(
            "afd-pipe",
            {
                "success": True,
                "steps": [],
            },
        )

        client = await _connected_client(transport)
        result = await client.pipe(
            [
                {"command": "user-get", "input": {"id": 1}, "as": "user"},
            ]
        )

        assert result["success"] is True

        last = transport.last_call("afd-pipe")
        assert last is not None
        assert len(last.arguments["steps"]) == 1


# ============================================================================
# create_client factory
# ============================================================================


class TestCreateClient:
    """Tests for create_client factory function."""

    def test_creates_client(self):
        client = create_client("http://localhost:3100/sse")
        assert isinstance(client, McpClient)
        assert client._config.url == "http://localhost:3100/sse"
        assert client._config.resolved_transport == "sse"

    def test_custom_params(self):
        client = create_client(
            "http://localhost:3100/message",
            transport="http",
            auto_reconnect=False,
            timeout=5.0,
        )
        assert client._config.transport == "http"
        assert client._config.auto_reconnect is False
        assert client._config.timeout == 5.0


# ============================================================================
# list_tools / get_tools
# ============================================================================


class TestMcpClientTools:
    """Tests for tool listing."""

    @pytest.mark.asyncio
    async def test_list_tools_refreshes(self):
        transport = MockTransport()

        async def handler(args):
            return success({})

        transport.register_tool("a", handler, description="Tool A")
        client = await _connected_client(transport)

        # Add another tool and refresh
        transport.register_tool("b", handler, description="Tool B")
        tools = await client.list_tools()
        assert len(tools) == 2

    @pytest.mark.asyncio
    async def test_get_tools_returns_cached(self):
        transport = MockTransport()

        async def handler(args):
            return success({})

        transport.register_tool("a", handler, description="Tool A")
        client = await _connected_client(transport)

        tools = client.get_tools()
        assert len(tools) == 1
        assert tools[0].name == "a"


# ============================================================================
# OUTCOME_UNKNOWN fail-closed safety (#2319)
# ============================================================================


class _StubMcpError(Exception):
    """Stands in for ``mcp.MCPError`` without requiring live MCP sessions."""

    def __init__(self, code: int, message: str, data: object = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


_StubMcpError.__name__ = "MCPError"


class _StubHttpxStatusError(Exception):
    """Stands in for ``httpx.HTTPStatusError`` / ``httpx2.HTTPStatusError``."""

    def __init__(self, status_code: int):
        super().__init__(f"HTTP {status_code}")

        class _Resp:
            pass

        resp = _Resp()
        resp.status_code = status_code  # type: ignore[attr-defined]
        self.response = resp


class _OutcomeTransport:
    """Configurable transport for testing ``McpClient.call()`` outcome safety."""

    def __init__(
        self,
        tools: list,
        *,
        on_call=None,
        on_list=None,
    ) -> None:
        self._tools = list(tools)
        self._on_call = on_call
        self._on_list = on_list
        self.state = TransportState.DISCONNECTED

    async def connect(self) -> None:
        self.state = TransportState.CONNECTED

    async def disconnect(self) -> None:
        self.state = TransportState.DISCONNECTED

    async def list_tools(self):
        if self._on_list is not None:
            return await self._on_list()
        return list(self._tools)

    async def call_tool(self, name: str, arguments=None, *, timeout=None):
        if self._on_call is not None:
            return await self._on_call(name, arguments or {}, timeout=timeout)
        return {"success": True, "data": {"ok": True}}


class TestMcpClientOutcomeUnknown:
    """Tests for fail-closed OUTCOME_UNKNOWN on non-read-only calls (#2319)."""

    @staticmethod
    def _sample_tools():
        from afd.transports.base import ToolInfo

        return [
            ToolInfo(
                name="item-create",
                description="Mutating tool",
                meta={"mutation": True},
            ),
            ToolInfo(
                name="item-unmarked",
                description="Unmarked tool",
            ),
            ToolInfo(
                name="item-get",
                description="Read-only tool",
                meta={"mutation": False},
                annotations={"readOnlyHint": True},
            ),
            ToolInfo(
                name="item-read-plain",
                description="Read-only tool with _meta.mutation=False only",
                meta={"mutation": False},
            ),
            ToolInfo(
                name="item-destructive-meta",
                description="Contradicting _meta.destructive=True",
                meta={"mutation": False, "destructive": True},
            ),
            ToolInfo(
                name="item-destructive-hint",
                description="Contradicting annotations.destructiveHint=True",
                meta={"mutation": False},
                annotations={"destructiveHint": True},
            ),
            ToolInfo(
                name="item-non-readonly-hint",
                description="Contradicting annotations.readOnlyHint=False",
                meta={"mutation": False},
                annotations={"readOnlyHint": False},
            ),
            ToolInfo(
                name="item-hint-only",
                description="Only annotations.readOnlyHint=True without _meta.mutation=False",
                annotations={"readOnlyHint": True},
            ),
            ToolInfo(
                name="item-zero-mutation",
                description="Non-boolean falsy _meta.mutation=0",
                meta={"mutation": 0},
            ),
        ]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("exc_factory", "expected_cause", "expected_details"),
        [
            (lambda: TimeoutError("timed out"), "TIMEOUT", {"cause": "TIMEOUT"}),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["TransportError"]
                ).TransportError("wrapped timeout", cause=TimeoutError("read timed out")),
                "TIMEOUT",
                {"cause": "TIMEOUT"},
            ),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["TransportError"]
                ).TransportError("sdk timeout", cause=_StubMcpError(408, "Timed out")),
                "TIMEOUT",
                {"cause": "TIMEOUT"},
            ),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["TransportError"]
                ).TransportError("socket closed"),
                "TRANSPORT_ERROR",
                {"cause": "TRANSPORT_ERROR"},
            ),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["TransportError"]
                ).TransportError("closed", cause=_StubMcpError(-32000, "Connection closed")),
                "TRANSPORT_ERROR",
                {"cause": "TRANSPORT_ERROR"},
            ),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["TransportError"]
                ).TransportError("undecodable", cause=_StubMcpError(-32700, "Could not decode")),
                "TRANSPORT_ERROR",
                {"cause": "TRANSPORT_ERROR", "jsonRpcCode": -32700},
            ),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["HttpStatusError"]
                ).HttpStatusError(503, "HTTP 503: Service Unavailable"),
                "HTTP_503",
                {"cause": "HTTP_503"},
            ),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["TransportError"]
                ).TransportError("gateway error", cause=_StubHttpxStatusError(502)),
                "HTTP_502",
                {"cause": "HTTP_502"},
            ),
            (
                lambda: __import__("afd.transports.base", fromlist=["JsonRpcError"]).JsonRpcError(
                    -32603, "Internal server error"
                ),
                "INTERNAL_ERROR",
                {"cause": "INTERNAL_ERROR", "jsonRpcCode": -32603},
            ),
        ],
    )
    @pytest.mark.parametrize(
        "tool_name",
        [
            "item-create",
            "item-unmarked",
            "item-not-listed",
            "item-destructive-meta",
            "item-destructive-hint",
            "item-non-readonly-hint",
            "item-hint-only",
            "item-zero-mutation",
        ],
    )
    async def test_non_read_only_ambiguous_failures_return_outcome_unknown(
        self, exc_factory, expected_cause, expected_details, tool_name
    ):
        async def fail_call(_name, _args, *, timeout=None):
            raise exc_factory()

        client = McpClient(transport=_OutcomeTransport(self._sample_tools(), on_call=fail_call))
        await client.connect()
        try:
            result = await client.call(tool_name, {})
            assert result.success is False
            assert result.error is not None
            assert result.error.code == "OUTCOME_UNKNOWN"
            assert result.error.retryable is False
            assert result.error.details == expected_details
            assert result.error.details["cause"] == expected_cause
            assert result.error.suggestion
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("exc_factory", "expected_code", "expected_retryable"),
        [
            (lambda: TimeoutError("timed out"), "TIMEOUT", True),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["TransportError"]
                ).TransportError("wrapped timeout", cause=TimeoutError("read timed out")),
                "TIMEOUT",
                True,
            ),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["TransportError"]
                ).TransportError("socket closed"),
                "TRANSPORT_ERROR",
                True,
            ),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["HttpStatusError"]
                ).HttpStatusError(503, "HTTP 503: Service Unavailable"),
                "HTTP_503",
                True,
            ),
            (
                lambda: __import__(
                    "afd.transports.base", fromlist=["TransportError"]
                ).TransportError("gateway error", cause=_StubHttpxStatusError(502)),
                "HTTP_502",
                True,
            ),
            (
                lambda: __import__("afd.transports.base", fromlist=["JsonRpcError"]).JsonRpcError(
                    -32603, "Internal server error"
                ),
                "INTERNAL_ERROR",
                True,
            ),
        ],
    )
    @pytest.mark.parametrize("tool_name", ["item-get", "item-read-plain"])
    async def test_read_only_tools_keep_underlying_retryable_error(
        self, exc_factory, expected_code, expected_retryable, tool_name
    ):
        async def fail_call(_name, _args, *, timeout=None):
            raise exc_factory()

        client = McpClient(transport=_OutcomeTransport(self._sample_tools(), on_call=fail_call))
        await client.connect()
        try:
            result = await client.call(tool_name, {})
            assert result.success is False
            assert result.error is not None
            assert result.error.code == expected_code
            assert result.error.retryable is expected_retryable
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_definite_refusals_do_not_become_outcome_unknown_on_mutations(self):
        from afd.transports.base import HttpStatusError, JsonRpcError, ToolNotFoundError

        for exc, expected_code, expected_retryable in [
            (HttpStatusError(400, "HTTP 400: Bad Request"), "HTTP_400", False),
            (HttpStatusError(403, "HTTP 403: Forbidden"), "HTTP_403", False),
            (HttpStatusError(429, "HTTP 429: Too Many Requests"), "HTTP_429", True),
            (JsonRpcError(-32602, "Invalid params"), "TRANSPORT_ERROR", False),
            (JsonRpcError(-32021, "Tasks capability required"), "MISSING_CLIENT_CAPABILITY", False),
            (ToolNotFoundError("item-create"), "TRANSPORT_ERROR", False),
        ]:

            async def fail_call(_name, _args, *, timeout=None, err=exc):
                raise err

            client = McpClient(transport=_OutcomeTransport(self._sample_tools(), on_call=fail_call))
            await client.connect()
            try:
                result = await client.call("item-create", {})
                assert result.success is False
                assert result.error is not None
                assert result.error.code == expected_code
                assert result.error.retryable is expected_retryable
            finally:
                await client.disconnect()

    @pytest.mark.asyncio
    async def test_read_only_metadata_is_captured_before_dispatch(self):
        import asyncio

        from afd.transports.base import ToolInfo

        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_fail(_name, _args, *, timeout=None):
            started.set()
            await release.wait()
            raise TimeoutError("timed out")

        tools = [
            ToolInfo(name="item-toggle", description="Starts mutating", meta={"mutation": True})
        ]
        transport = _OutcomeTransport(tools, on_call=slow_fail)
        client = McpClient(transport=transport)
        await client.connect()
        try:
            task = asyncio.create_task(client.call("item-toggle", {}))
            await asyncio.wait_for(started.wait(), timeout=2.0)

            # Refresh tools mid-flight so the cache now claims the tool is read-only.
            transport._tools = [
                ToolInfo(name="item-toggle", description="Now read-only", meta={"mutation": False})
            ]
            await client.list_tools()

            release.set()
            result = await task
            assert result.success is False
            assert result.error is not None
            assert result.error.code == "OUTCOME_UNKNOWN"
            assert result.error.retryable is False
            assert result.error.details == {"cause": "TIMEOUT"}
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_reconnect_discovery_failure_clears_cached_read_only_metadata(self):
        import asyncio

        from afd.transports.base import ToolInfo, TransportError

        fail_list = False
        fail_call = False
        reconnected = asyncio.Event()

        class _ReconnectTransport:
            def __init__(self) -> None:
                self.state = TransportState.DISCONNECTED
                self._on_close = None

            def set_callbacks(self, *, on_close, on_error) -> None:
                self._on_close = on_close

            async def connect(self) -> None:
                self.state = TransportState.CONNECTED

            async def disconnect(self) -> None:
                self.state = TransportState.DISCONNECTED

            async def list_tools(self):
                if fail_list:
                    raise TransportError("discovery failed")
                return [
                    ToolInfo(name="item-get", description="Read", meta={"mutation": False}),
                ]

            async def call_tool(self, name: str, arguments=None, *, timeout=None):
                if fail_call:
                    raise TimeoutError("timed out")
                return {"success": True, "data": {"ok": True}}

            def drop(self) -> None:
                self.state = TransportState.DISCONNECTED
                if self._on_close is not None:
                    self._on_close()

        transport = _ReconnectTransport()
        client = McpClient(
            McpClientConfig(auto_reconnect=True, max_reconnect_attempts=1, reconnect_delay=0.01),
            transport=transport,
        )
        errors = []
        client.on("error", lambda exc: (errors.append(exc), reconnected.set()))
        await client.connect()
        try:
            assert len(client.get_tools()) == 1
            assert client._is_read_only_tool("item-get") is True

            # Drop connection while tools/list fails on reconnect.
            fail_list = True
            transport.drop()
            await asyncio.wait_for(reconnected.wait(), timeout=2.0)
            assert client.get_tools() == []
            assert client._is_read_only_tool("item-get") is False

            # Even if the transport reconnects later with empty discovery, stale
            # metadata is gone and failures fail closed to OUTCOME_UNKNOWN.
            fail_list = False
            transport.list_tools = lambda: asyncio.sleep(0, result=[])  # type: ignore[method-assign]
            await client.connect()
            assert client.get_tools() == []

            fail_call = True
            result = await client.call("item-get", {})
            assert result.success is False
            assert result.error is not None
            assert result.error.code == "OUTCOME_UNKNOWN"
            assert result.error.retryable is False
            assert result.error.details == {"cause": "TIMEOUT"}
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_http_transport_list_tools_preserves_annotations(self, monkeypatch):
        import httpx

        from afd.transports.http import HttpTransport

        async def post(self_client, url, *, json=None, headers=None, timeout=None):
            if json["method"] == "initialize":
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": json["id"], "result": {}})
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": json["id"],
                    "result": {
                        "tools": [
                            {
                                "name": "item-danger",
                                "description": "Contradicting annotations",
                                "inputSchema": {"type": "object"},
                                "_meta": {"mutation": False},
                                "annotations": {"destructiveHint": True, "readOnlyHint": False},
                            }
                        ]
                    },
                },
            )

        monkeypatch.setattr(httpx.AsyncClient, "post", post)
        transport = HttpTransport("http://localhost:3100/message")
        client = McpClient(McpClientConfig(auto_reconnect=False), transport=transport)
        await client.connect()
        try:
            tools = client.get_tools()
            assert len(tools) == 1
            assert tools[0].annotations == {"destructiveHint": True, "readOnlyHint": False}
            assert client._is_read_only_tool("item-danger") is False
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_stale_list_tools_from_previous_connection_does_not_overwrite_reconnect(self):
        import asyncio

        from afd.transports.base import ToolInfo

        stale_started = asyncio.Event()
        release_stale = asyncio.Event()
        reconnected = asyncio.Event()

        class _RaceTransport:
            def __init__(self) -> None:
                self.state = TransportState.DISCONNECTED
                self._on_close = None
                self.connect_count = 0
                self.list_count = 0

            def set_callbacks(self, *, on_close, on_error) -> None:
                self._on_close = on_close

            async def connect(self) -> None:
                self.connect_count += 1
                self.state = TransportState.CONNECTED

            async def disconnect(self) -> None:
                self.state = TransportState.DISCONNECTED

            async def list_tools(self):
                self.list_count += 1
                if self.list_count == 1:
                    return [
                        ToolInfo(name="item-op", description="Initial", meta={"mutation": False})
                    ]
                if self.list_count == 2:
                    # Slow list_tools() started before reconnect that returns stale read-only metadata.
                    stale_started.set()
                    await release_stale.wait()
                    return [ToolInfo(name="item-op", description="Stale", meta={"mutation": False})]
                # Reconnect discovery reports the tool is now a mutation.
                return [ToolInfo(name="item-op", description="Mutating", meta={"mutation": True})]

            async def call_tool(self, name: str, arguments=None, *, timeout=None):
                raise TimeoutError("timed out")

            def drop(self) -> None:
                self.state = TransportState.DISCONNECTED
                if self._on_close is not None:
                    self._on_close()

        transport = _RaceTransport()
        client = McpClient(
            McpClientConfig(auto_reconnect=True, max_reconnect_attempts=2, reconnect_delay=0.01),
            transport=transport,
        )
        connects = 0

        def on_connected():
            nonlocal connects
            connects += 1
            if connects == 2:
                reconnected.set()

        client.on("connected", on_connected)
        await client.connect()
        try:
            stale_task = asyncio.create_task(client.list_tools())
            await asyncio.wait_for(stale_started.wait(), timeout=2.0)

            transport.drop()
            await asyncio.wait_for(reconnected.wait(), timeout=2.0)
            assert client.get_tools()[0].meta == {"mutation": True}

            # Now let the stale list_tools() from connection 1 finish.
            release_stale.set()
            await stale_task
            assert client.get_tools()[0].meta == {"mutation": True}

            result = await client.call("item-op", {})
            assert result.success is False
            assert result.error is not None
            assert result.error.code == "OUTCOME_UNKNOWN"
            assert result.error.retryable is False
            assert result.error.details == {"cause": "TIMEOUT"}
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_header_mismatch_relist_reclassifies_resent_call(self):
        from mcp import MCPError
        from mcp.types import HEADER_MISMATCH, ListToolsResult, Tool

        from afd.transports.streamable_http import (
            MODERN_PROTOCOL_VERSION,
            StreamableHttpTransport,
        )

        calls = 0

        class _FakeInnerSession:
            async def call_tool(self, name, arguments, **_kwargs):
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise MCPError(code=HEADER_MISMATCH, message="Stale tool header")
                raise TimeoutError("timed out on resend")

        class _FakeClientSession:
            protocol_version = MODERN_PROTOCOL_VERSION

            def __init__(self) -> None:
                self.session = _FakeInnerSession()
                self._listed = 0

            async def list_tools(self, *, cursor=None, cache_mode=None):
                self._listed += 1
                if self._listed == 1:
                    tool = Tool(
                        name="item-op",
                        description="Initially read-only",
                        inputSchema={"type": "object"},
                        _meta={"mutation": False},
                    )
                else:
                    tool = Tool(
                        name="item-op",
                        description="Upgraded to mutation",
                        inputSchema={"type": "object"},
                        _meta={"mutation": True},
                    )
                return ListToolsResult(tools=[tool], nextCursor=None)

        transport = StreamableHttpTransport("http://localhost:3100/mcp", timeout=5.0)
        fake_session = _FakeClientSession()

        async def fake_connect() -> None:
            transport._session = fake_session
            transport._state = TransportState.CONNECTED

        async def fake_disconnect() -> None:
            transport._session = None
            transport._state = TransportState.DISCONNECTED

        transport.connect = fake_connect  # type: ignore[method-assign]
        transport.disconnect = fake_disconnect  # type: ignore[method-assign]

        client = McpClient(McpClientConfig(auto_reconnect=False), transport=transport)
        await client.connect()
        try:
            assert client._is_read_only_tool("item-op") is True
            result = await client.call("item-op", {})
            assert calls == 2
            assert result.success is False
            assert result.error is not None
            assert result.error.code == "OUTCOME_UNKNOWN"
            assert result.error.retryable is False
            assert result.error.details == {"cause": "TIMEOUT"}
            assert client._is_read_only_tool("item-op") is False
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_header_mismatch_recovery_updates_cached_tools_for_subsequent_calls(self):
        from mcp import MCPError
        from mcp.types import HEADER_MISMATCH, CallToolResult, ListToolsResult, TextContent, Tool

        from afd.transports.streamable_http import (
            MODERN_PROTOCOL_VERSION,
            StreamableHttpTransport,
        )

        calls = 0

        class _FakeInnerSession:
            async def call_tool(self, name, arguments, **_kwargs):
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise MCPError(code=HEADER_MISMATCH, message="Stale tool header")
                if calls == 2:
                    return CallToolResult(
                        content=[TextContent(type="text", text='{"success":true,"data":{"ok":1}}')]
                    )
                if calls == 3:
                    raise MCPError(code=-32603, message="call 2 crashed without header mismatch")
                if calls == 4:
                    raise MCPError(code=HEADER_MISMATCH, message="Tool removed")
                if calls == 5:
                    raise MCPError(code=-32603, message="call 3 failed after tool disappeared")
                raise TimeoutError("call 4 timed out without header mismatch")

        class _FakeClientSession:
            protocol_version = MODERN_PROTOCOL_VERSION

            def __init__(self) -> None:
                self.session = _FakeInnerSession()
                self._listed = 0

            async def list_tools(self, *, cursor=None, cache_mode=None):
                self._listed += 1
                if self._listed == 1:
                    tools = [
                        Tool(
                            name="item-op",
                            description="Initially read-only",
                            inputSchema={"type": "object"},
                            _meta={"mutation": False},
                        ),
                        Tool(
                            name="vanish-op",
                            description="Initially read-only",
                            inputSchema={"type": "object"},
                            _meta={"mutation": False},
                        ),
                    ]
                elif self._listed == 2:
                    tools = [
                        Tool(
                            name="item-op",
                            description="Upgraded to mutation",
                            inputSchema={"type": "object"},
                            _meta={"mutation": True},
                        ),
                        Tool(
                            name="vanish-op",
                            description="Still read-only",
                            inputSchema={"type": "object"},
                            _meta={"mutation": False},
                        ),
                    ]
                else:
                    tools = []
                return ListToolsResult(tools=tools, nextCursor=None)

        transport = StreamableHttpTransport("http://localhost:3100/mcp", timeout=5.0)
        fake_session = _FakeClientSession()

        async def fake_connect() -> None:
            transport._session = fake_session
            transport._state = TransportState.CONNECTED

        async def fake_disconnect() -> None:
            transport._session = None
            transport._state = TransportState.DISCONNECTED

        transport.connect = fake_connect  # type: ignore[method-assign]
        transport.disconnect = fake_disconnect  # type: ignore[method-assign]

        client = McpClient(McpClientConfig(auto_reconnect=False), transport=transport)
        await client.connect()
        try:
            assert client._is_read_only_tool("item-op") is True
            # Call 1 recovers from HEADER_MISMATCH and succeeds; _tools must reflect the upgrade.
            first = await client.call("item-op", {})
            assert first.success is True
            assert first.data == {"ok": 1}
            assert client._is_read_only_tool("item-op") is False

            # Call 2 triggers no HEADER_MISMATCH (SDK header cache already updated on call 1),
            # yet hits JSON-RPC -32603 and must still fail closed to OUTCOME_UNKNOWN.
            second = await client.call("item-op", {})
            assert second.success is False
            assert second.error is not None
            assert second.error.code == "OUTCOME_UNKNOWN"
            assert second.error.retryable is False
            assert second.error.details == {"cause": "INTERNAL_ERROR", "jsonRpcCode": -32603}

            # If a relisted tool disappears from tools/list, it is removed from _tools while
            # other cached tools remain intact on the live connection.
            assert client._is_read_only_tool("vanish-op") is True
            third = await client.call("vanish-op", {})
            assert third.success is False
            assert third.error is not None
            assert third.error.code == "OUTCOME_UNKNOWN"
            assert third.error.retryable is False
            assert third.error.details == {"cause": "INTERNAL_ERROR", "jsonRpcCode": -32603}
            assert client._is_read_only_tool("vanish-op") is False
            assert [t.name for t in client._tools] == ["item-op"]

            # Call 4 hits a timeout without HEADER_MISMATCH and also fails closed.
            fourth = await client.call("item-op", {})
            assert fourth.success is False
            assert fourth.error is not None
            assert fourth.error.code == "OUTCOME_UNKNOWN"
            assert fourth.error.retryable is False
            assert fourth.error.details == {"cause": "TIMEOUT"}
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_header_mismatch_relist_with_elicitation_client_subclass(self):
        from mcp.types import ListToolsResult, Tool

        from afd.transports.streamable_http import (
            ElicitationResponse,
            StreamableHttpTransport,
            _make_afd_mcp_client_cls,
        )

        class _FakeBaseMcpClient:
            def __init__(self) -> None:
                self._listed = 0
                self.calls = 0

            async def list_tools(self, *, cursor=None, cache_mode=None):
                self._listed += 1
                mutation = self._listed > 1
                return ListToolsResult(
                    tools=[
                        Tool(
                            name="item-op",
                            description="Tool",
                            inputSchema={"type": "object"},
                            _meta={"mutation": mutation},
                        )
                    ],
                    nextCursor=None,
                )

            async def _relist_tool(self, name: str) -> None:
                await self.list_tools(cache_mode="refresh")

            async def call_tool(self, name: str, arguments, **_kwargs):
                self.calls += 1
                if self.calls == 1:
                    await self._relist_tool(name)
                    raise TimeoutError("timed out after SDK relist")
                raise AssertionError("unexpected extra call")

        async def _accept_elicitation(_req):
            return ElicitationResponse(action="accept", content={})

        afd_client_cls = _make_afd_mcp_client_cls(_FakeBaseMcpClient)
        fake_session = afd_client_cls()
        transport = StreamableHttpTransport(
            "http://localhost:3100/mcp",
            timeout=5.0,
            on_elicitation=_accept_elicitation,
        )

        async def fake_connect() -> None:
            transport._session = fake_session
            transport._state = TransportState.CONNECTED

        async def fake_disconnect() -> None:
            transport._session = None
            transport._state = TransportState.DISCONNECTED

        transport.connect = fake_connect  # type: ignore[method-assign]
        transport.disconnect = fake_disconnect  # type: ignore[method-assign]

        client = McpClient(McpClientConfig(auto_reconnect=False), transport=transport)
        await client.connect()
        try:
            assert client._is_read_only_tool("item-op") is True
            result = await client.call("item-op", {})
            assert fake_session.calls == 1
            assert result.success is False
            assert result.error is not None
            assert result.error.code == "OUTCOME_UNKNOWN"
            assert result.error.retryable is False
            assert result.error.details == {"cause": "TIMEOUT"}
            assert client._is_read_only_tool("item-op") is False
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_sse_raise_operation_error_keeps_sdk_parse_error_ambiguous(self):
        from mcp import MCPError

        from afd.transports.base import TransportError
        from afd.transports.sse import SseTransport

        transport = SseTransport("http://localhost:3100/sse")
        session = object()
        transport._session = session
        transport._state = TransportState.CONNECTED

        with pytest.raises(TransportError) as raised:
            transport._raise_operation_error(
                MCPError(code=-32700, message="Failed to parse JSON response: EOF"),
                session,
            )
        assert isinstance(raised.value.cause, MCPError)
        assert raised.value.cause.code == -32700

        async def fail_call(_name, _args, *, timeout=None):
            raise raised.value

        client = McpClient(transport=_OutcomeTransport(self._sample_tools(), on_call=fail_call))
        await client.connect()
        try:
            mut = await client.call("item-create", {})
            assert mut.success is False
            assert mut.error is not None
            assert mut.error.code == "OUTCOME_UNKNOWN"
            assert mut.error.retryable is False
            assert mut.error.details == {"cause": "TRANSPORT_ERROR", "jsonRpcCode": -32700}
        finally:
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_direct_http_status_error_and_mcp_error_subclass_classification(self):
        class _SubMcpError(_StubMcpError):
            pass

        async def fail_403(_name, _args, *, timeout=None):
            raise _StubHttpxStatusError(403)

        client = McpClient(transport=_OutcomeTransport(self._sample_tools(), on_call=fail_403))
        await client.connect()
        try:
            refused = await client.call("item-create", {})
            assert refused.success is False
            assert refused.error is not None
            assert refused.error.code == "HTTP_403"
            assert refused.error.retryable is False
        finally:
            await client.disconnect()

        async def fail_sub_timeout(_name, _args, *, timeout=None):
            raise _SubMcpError(408, "Subclass timeout")

        client2 = McpClient(
            transport=_OutcomeTransport(self._sample_tools(), on_call=fail_sub_timeout)
        )
        await client2.connect()
        try:
            mut = await client2.call("item-create", {})
            assert mut.error is not None
            assert mut.error.code == "OUTCOME_UNKNOWN"
            assert mut.error.retryable is False
            assert mut.error.details == {"cause": "TIMEOUT"}

            ro = await client2.call("item-get", {})
            assert ro.error is not None
            assert ro.error.code == "TIMEOUT"
            assert ro.error.retryable is True
        finally:
            await client2.disconnect()

    @pytest.mark.asyncio
    async def test_http_transport_end_to_end_http_5xx_4xx_and_jsonrpc_32603(self, monkeypatch):
        import httpx

        from afd.transports.http import HttpTransport

        mode = "503"

        async def post(self_client, url, *, json=None, headers=None, timeout=None):
            if json["method"] == "initialize":
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": json["id"], "result": {}})
            if json["method"] == "tools/list":
                return httpx.Response(
                    200,
                    json={
                        "jsonrpc": "2.0",
                        "id": json["id"],
                        "result": {
                            "tools": [
                                {
                                    "name": "item-create",
                                    "description": "Mutating",
                                    "inputSchema": {"type": "object"},
                                    "_meta": {"mutation": True},
                                },
                                {
                                    "name": "item-get",
                                    "description": "Read-only",
                                    "inputSchema": {"type": "object"},
                                    "_meta": {"mutation": False},
                                },
                            ]
                        },
                    },
                )
            if mode == "503":
                return httpx.Response(503, text="Service Unavailable")
            if mode == "403":
                return httpx.Response(403, text="Forbidden")
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": json["id"],
                    "error": {"code": -32603, "message": "Internal error"},
                },
            )

        monkeypatch.setattr(httpx.AsyncClient, "post", post)
        transport = HttpTransport("http://localhost:3100/message")
        client = McpClient(McpClientConfig(auto_reconnect=False), transport=transport)
        await client.connect()
        try:
            mode = "503"
            mut_503 = await client.call("item-create", {})
            assert mut_503.error is not None
            assert mut_503.error.code == "OUTCOME_UNKNOWN"
            assert mut_503.error.retryable is False
            assert mut_503.error.details == {"cause": "HTTP_503"}

            ro_503 = await client.call("item-get", {})
            assert ro_503.error is not None
            assert ro_503.error.code == "HTTP_503"
            assert ro_503.error.retryable is True

            mode = "403"
            mut_403 = await client.call("item-create", {})
            assert mut_403.error is not None
            assert mut_403.error.code == "HTTP_403"
            assert mut_403.error.retryable is False

            mode = "rpc"
            mut_rpc = await client.call("item-create", {})
            assert mut_rpc.error is not None
            assert mut_rpc.error.code == "OUTCOME_UNKNOWN"
            assert mut_rpc.error.retryable is False
            assert mut_rpc.error.details == {"cause": "INTERNAL_ERROR", "jsonRpcCode": -32603}

            ro_rpc = await client.call("item-get", {})
            assert ro_rpc.error is not None
            assert ro_rpc.error.code == "INTERNAL_ERROR"
            assert ro_rpc.error.retryable is True
        finally:
            await client.disconnect()
