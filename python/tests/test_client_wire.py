"""McpClient interop with the TypeScript wire format.

TypeScript servers send failures as ``isError: true`` with a CommandResult JSON
body, use camelCase keys, serve JSON-RPC on ``/message`` and stream from
``/stream/<command>``. See spec/wire/.
"""

import json
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from afd import CommandResult
from afd.client import McpClient, McpClientConfig
from afd.core.wire import to_wire
from afd.transports._mcp_protocol import _HttpBasedTransport, derive_stream_url
from afd.transports.base import ToolExecutionError, TransportState
from afd.transports.mock import MockTransport

WIRE_DIR = Path(__file__).resolve().parents[2] / "spec" / "wire"


def _fixture(name: str) -> Any:
    return json.loads((WIRE_DIR / name).read_text(encoding="utf-8"))


def _tool_result(body: Any, *, is_error: bool) -> Dict[str, Any]:
    """An MCP tools/call result as a TypeScript server sends it."""
    return {"content": [{"type": "text", "text": json.dumps(body, indent=2)}], "isError": is_error}


class _RawTransport:
    """Returns canned MCP results through the real content extraction."""

    def __init__(self, raw: Dict[str, Any]):
        self.raw = raw
        self.state = TransportState.DISCONNECTED

    async def connect(self) -> None:
        self.state = TransportState.CONNECTED

    async def disconnect(self) -> None:
        self.state = TransportState.DISCONNECTED

    async def list_tools(self):
        return []

    async def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None):
        return _HttpBasedTransport._extract_content(self.raw)


async def _client_for(raw: Dict[str, Any]) -> McpClient:
    client = McpClient(transport=_RawTransport(raw))
    await client.connect()
    return client


class TestExtractContent:
    def test_is_error_with_command_result_body_returns_the_body(self):
        body = _fixture("result-failure.json")

        assert _HttpBasedTransport._extract_content(_tool_result(body, is_error=True)) == body

    def test_is_error_with_pipeline_body_returns_the_body(self):
        body = _fixture("pipeline-result.json")

        assert _HttpBasedTransport._extract_content(_tool_result(body, is_error=True)) == body

    def test_is_error_with_plain_text_raises(self):
        raw = {"content": [{"type": "text", "text": "Error executing tool x: boom"}], "isError": True}

        with pytest.raises(ToolExecutionError, match="boom"):
            _HttpBasedTransport._extract_content(raw)

    def test_is_error_with_non_result_json_raises(self):
        with pytest.raises(ToolExecutionError):
            _HttpBasedTransport._extract_content(_tool_result({"message": "nope"}, is_error=True))


class TestCallParsesTypeScriptResults:
    @pytest.mark.asyncio
    async def test_typescript_failure_keeps_code_and_suggestion(self):
        client = await _client_for(_tool_result(_fixture("result-failure.json"), is_error=True))

        result = await client.call("todo-get", {"id": "todo-42"})

        assert result.success is False
        assert result.error.code == "NOT_FOUND"
        assert result.error.suggestion == "Use todo-list to see available todos"
        assert result.error.retryable is False
        assert result.error.details == {"id": "todo-42"}
        assert result.metadata.trace_id == "trace-fixture"

    @pytest.mark.asyncio
    async def test_success_keeps_every_field(self):
        body = _fixture("result-success-full.json")
        client = await _client_for(_tool_result(body, is_error=False))

        result = await client.call("todo-create", {"title": "Buy milk"})

        assert to_wire(result) == body
        assert result.sources[0].accessed_at == "2026-01-01T00:00:00.000Z"
        assert result.plan[1].depends_on == ["validate"]
        assert result.alternatives[0].label == "Completed"
        assert result.suggestions == ["Use todo-list to review existing todos"]
        assert result.metadata.command_version == "2.1.0"
        assert result.metadata.model_extra == {"region": "test"}
        assert result.undo_command == "todo-delete"

    @pytest.mark.asyncio
    async def test_snake_case_result_from_older_python_servers(self):
        body = {
            "success": True,
            "data": {"id": "1"},
            "undo_command": "todo-delete",
            "metadata": {"execution_time_ms": 4},
        }
        client = await _client_for(_tool_result(body, is_error=False))

        result = await client.call("todo-create", {})

        assert result.undo_command == "todo-delete"
        assert result.metadata.execution_time_ms == 4

    @pytest.mark.asyncio
    async def test_plain_text_tool_error_is_tool_error(self):
        raw = {"content": [{"type": "text", "text": "boom"}], "isError": True}
        client = await _client_for(raw)

        result = await client.call("x", {})

        assert result.error.code == "TOOL_ERROR"
        assert result.error.message == "boom"

    @pytest.mark.asyncio
    async def test_malformed_result_is_reported(self):
        client = await _client_for(
            _tool_result({"success": False, "error": "just a string"}, is_error=True)
        )

        result = await client.call("x", {})

        assert result.success is False
        assert result.error.code == "INVALID_RESULT"
        assert result.error.suggestion


class TestStreamUrl:
    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("http://localhost:3100/sse", "http://localhost:3100/stream/todo-list"),
            ("http://localhost:3100/sse/", "http://localhost:3100/stream/todo-list"),
            ("http://localhost:3100/message", "http://localhost:3100/stream/todo-list"),
            ("http://localhost:3100", "http://localhost:3100/stream/todo-list"),
            ("http://localhost:3100/api/sse", "http://localhost:3100/api/stream/todo-list"),
        ],
    )
    def test_stream_url_sits_next_to_sse(self, url, expected):
        assert derive_stream_url(url, "todo-list") == expected

    def test_command_name_is_url_encoded(self):
        assert (
            derive_stream_url("http://localhost:3100/sse", "a/b c?d")
            == "http://localhost:3100/stream/a%2Fb%20c%3Fd"
        )


class TestStream:
    def _patch_http(self, monkeypatch, handler):
        real_client = httpx.AsyncClient

        def client_factory(*args, **kwargs):
            return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

        monkeypatch.setattr(httpx, "AsyncClient", client_factory)

    async def _client(self, url: str = "", endpoint: Optional[str] = None) -> McpClient:
        client = McpClient(McpClientConfig(url=url, endpoint=endpoint), transport=MockTransport())
        await client.connect()
        return client

    @pytest.mark.asyncio
    async def test_stream_uses_resolved_url_and_yields_chunks(self, monkeypatch):
        seen = []
        chunks = _fixture("stream-chunks.json")

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(str(request.url))
            text = "".join(f"event: chunk\ndata: {json.dumps(chunk)}\n\n" for chunk in chunks)
            return httpx.Response(200, text=text, headers={"content-type": "text/event-stream"})

        self._patch_http(monkeypatch, handler)
        client = await self._client(endpoint="http://localhost:3100/sse")

        received = [chunk async for chunk in client.stream("todo list", {"limit": 1})]

        assert seen == ["http://localhost:3100/stream/todo%20list"]
        assert received == chunks

    @pytest.mark.asyncio
    async def test_http_error_yields_a_stream_error_chunk(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                404,
                json={"success": False, "error": {"code": "HTTP_404", "message": "Not found"}},
            )

        self._patch_http(monkeypatch, handler)
        client = await self._client(url="http://localhost:3100/sse")

        received = [chunk async for chunk in client.stream("missing")]

        assert len(received) == 1
        assert received[0]["type"] == "error"
        assert received[0]["error"]["code"] == "STREAM_ERROR"
        assert received[0]["error"]["message"] == "HTTP 404: Not found"
        assert received[0]["error"]["suggestion"]
        assert received[0]["chunksBeforeError"] == 0
        assert received[0]["recoverable"] is False


def _python_server():
    from pydantic import BaseModel, Field

    from afd import ExposeOptions, ResultMetadata, Source, error, success
    from afd.server import create_server

    class CreateInput(BaseModel):
        title: str = Field(..., min_length=1)

    server = create_server("client-wire-test")

    @server.command(
        name="todo-create",
        description="Create",
        input_schema=CreateInput,
        expose=ExposeOptions(mcp=True),
    )
    async def todo_create(input: CreateInput):
        return success(
            {"id": "todo-1", "title": input.title},
            sources=[Source(type="document", accessed_at="2026-01-01T00:00:00Z")],
            metadata=ResultMetadata(timestamp="2026-01-01T00:00:00Z", region="eu"),
            undo_command="todo-delete",
        )

    @server.command(name="todo-get", description="Get", expose=ExposeOptions(mcp=True))
    async def todo_get(input):
        return error("NOT_FOUND", "Todo not found", suggestion="Use todo-list")

    return server


class _SessionTransport:
    """An AFD transport over an in-memory MCP session (for client tests)."""

    def __init__(self, session):
        self._session = session
        self.state = TransportState.DISCONNECTED

    async def connect(self) -> None:
        self.state = TransportState.CONNECTED

    async def disconnect(self) -> None:
        self.state = TransportState.DISCONNECTED

    async def list_tools(self):
        return []

    async def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None):
        result = await self._session.call_tool(name, arguments or {})
        payload = result.model_dump(by_alias=True, mode="json", exclude_none=True)
        return _HttpBasedTransport._extract_content(payload)


class TestPythonClientAgainstPythonServer:
    @pytest.mark.asyncio
    async def test_round_trip_keeps_every_field(self):
        mcp = _python_server()._create_mcp_server()
        async with create_connected_server_and_client_session(mcp._mcp_server) as session:
            client = McpClient(transport=_SessionTransport(session))
            await client.connect()

            created = await client.call("todo-create", {"title": "Buy milk"})
            missing = await client.call("todo-get", {"id": "x"})
            invalid = await client.call("todo-create", {"title": 123})

        assert isinstance(created, CommandResult)
        assert created.undo_command == "todo-delete"
        assert created.sources[0].accessed_at == "2026-01-01T00:00:00Z"
        # The handler's metadata survives; the server adds executionTimeMs and traceId.
        assert created.metadata.timestamp == "2026-01-01T00:00:00Z"
        assert created.metadata.model_extra == {"region": "eu"}
        assert created.metadata.execution_time_ms >= 0
        assert created.metadata.trace_id

        assert missing.success is False
        assert missing.error.code == "NOT_FOUND"
        assert missing.error.suggestion == "Use todo-list"

        assert invalid.error.code == "VALIDATION_ERROR"
        assert invalid.error.details["errors"][0]["path"] == "title"
        assert invalid.error.suggestion
