"""``McpClient.stream``'s reader, as ``streamOverHttp`` in packages/client/src/mcp-stream.ts:
event framing, skipped events, and the error chunks the client makes itself."""

import asyncio
import json

import httpx
import pytest

from afd.client import McpClient, McpClientConfig
from afd.client_stream import stream_over_http
from afd.transports import MockTransport

URL = "http://localhost:3100/stream/export-run"


def event(chunk):
    return f"event: chunk\ndata: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode()


DATA = {"type": "data", "data": "row", "index": 0, "isLast": False}
DONE = {"type": "complete", "totalChunks": 1, "totalDurationMs": 3}


class Body(httpx.AsyncByteStream):
    """A response body sent in the given pieces; an exception is raised, a float sleeps."""

    def __init__(self, *pieces):
        self.pieces = pieces
        self.closed = False

    async def __aiter__(self):
        for piece in self.pieces:
            if isinstance(piece, Exception):
                raise piece
            if isinstance(piece, float):
                await asyncio.sleep(piece)
                continue
            yield piece

    async def aclose(self):
        self.closed = True


@pytest.fixture
def serve(monkeypatch):
    """Answer the reader's requests with ``handler``; the requests are recorded."""
    seen = []
    real_client = httpx.AsyncClient

    def install(handler):
        def record(request):
            seen.append(request)
            return handler(request)

        def client_factory(*args, **kwargs):
            return real_client(*args, transport=httpx.MockTransport(record), **kwargs)

        monkeypatch.setattr(httpx, "AsyncClient", client_factory)
        return seen

    return install


def body(*pieces, status=200):
    stream = Body(*pieces)
    return lambda request: httpx.Response(
        status, stream=stream, headers={"content-type": "text/event-stream"}
    )


async def read(**options):
    return [chunk async for chunk in stream_over_http(URL, {"format": "csv"}, **options)]


async def test_lines_end_only_at_cr_or_lf_so_a_line_separator_stays_in_its_string(serve):
    text = {"type": "data", "data": "one two\u0085three", "index": 0, "isLast": True}
    serve(body(event(text), event(DONE)))
    assert await read() == [text, DONE]


async def test_cr_lf_and_crlf_split_across_pieces_end_lines(serve):
    raw = event(DATA).replace(b"\n", b"\r\n")
    serve(body(raw[:-1], raw[-1:], event(DONE).replace(b"\n", b"\r")))
    assert await read() == [DATA, DONE]


async def test_events_that_are_not_chunks_are_skipped_and_not_counted(serve):
    serve(body(b"data: not json\n\n", b'data: {"type":"heartbeat"}\n\n', b": comment\n\n", event(DATA)))
    chunks = await read()
    assert chunks[0] == DATA
    assert chunks[1]["error"]["code"] == "STREAM_TRUNCATED"
    assert chunks[1]["chunksBeforeError"] == 1


async def test_the_stream_ends_at_its_first_terminal_chunk(serve):
    serve(body(event(DONE), event(DATA)))
    assert await read() == [DONE]


async def test_done_without_a_terminal_chunk_is_truncated(serve):
    serve(body(event(DATA), b"data: [DONE]\n\n", event(DONE)))
    chunks = await read()
    assert [chunk["type"] for chunk in chunks] == ["data", "error"]
    assert chunks[1]["error"]["code"] == "STREAM_TRUNCATED"


async def test_an_oversized_event_ends_the_stream_with_its_count(serve):
    serve(body(event(DATA), b"data: " + b"x" * 200 + b"\n\n"))
    chunks = await read(max_event_bytes=100)
    assert chunks[0] == DATA
    assert chunks[1]["error"]["code"] == "STREAM_EVENT_TOO_LARGE"
    assert chunks[1]["chunksBeforeError"] == 1
    assert chunks[1]["recoverable"] is False


async def test_an_oversized_line_without_its_end_is_refused_too(serve):
    serve(body(b"data: " + b"x" * 200))
    chunks = await read(max_event_bytes=100)
    assert chunks[0]["error"]["code"] == "STREAM_EVENT_TOO_LARGE"


async def test_a_refusal_keeps_the_servers_error_and_suggestion(serve):
    error = {"code": "INSUFFICIENT_SCOPE", "message": "Needs export:write", "suggestion": "Ask for the scope"}
    serve(lambda request: httpx.Response(403, json={"success": False, "error": error}))
    assert await read() == [
        {"type": "error", "error": error, "chunksBeforeError": 0, "recoverable": False}
    ]


async def test_a_dropped_connection_keeps_its_count_and_may_be_recovered(serve):
    serve(body(event(DATA), httpx.ReadError("connection reset")))
    chunks = await read()
    assert chunks[1]["error"]["code"] == "CONNECTION_ERROR"
    assert chunks[1]["error"]["message"] == "connection reset"
    assert chunks[1]["chunksBeforeError"] == 1
    assert chunks[1]["recoverable"] is True


async def test_a_stream_past_its_deadline_times_out(serve):
    serve(body(event(DATA), 10.0))
    chunks = await read(timeout=0.05)
    assert chunks[1]["error"] == {
        "code": "STREAM_TIMEOUT",
        "message": "Stream did not finish within 50ms",
        "suggestion": (
            "Retry with a larger timeout. The command may still have run, so check its "
            "effect before retrying a mutation."
        ),
        "retryable": True,
    }
    assert chunks[1]["chunksBeforeError"] == 1


async def test_cancelling_ends_the_stream_with_stream_cancelled(serve):
    serve(body(event(DATA), 10.0))
    cancel = asyncio.Event()
    received = []
    async for chunk in stream_over_http(URL, {}, cancel=cancel):
        received.append(chunk)
        cancel.set()
    assert received[1]["error"]["code"] == "STREAM_CANCELLED"
    assert received[1]["error"]["message"] == "Stream was cancelled by the caller"
    assert received[1]["chunksBeforeError"] == 1


async def test_the_request_carries_the_session_and_the_headers(serve):
    seen = serve(body(event(DONE)))
    await read(session_id="abc", headers={"Authorization": "Bearer t"})
    request = seen[0]
    assert request.headers["mcp-session-id"] == "abc"
    assert request.headers["authorization"] == "Bearer t"
    assert request.headers["accept"] == "text/event-stream"
    assert json.loads(request.content) == {"format": "csv"}


async def test_no_session_header_without_a_session(serve):
    seen = serve(body(event(DONE)))
    await read()
    assert "mcp-session-id" not in seen[0].headers


async def test_mcp_client_streams_in_its_transports_session(serve):
    seen = serve(body(event(DONE)))
    transport = MockTransport()
    transport.session_id = "session-1"
    client = McpClient(McpClientConfig(url="http://localhost:3100/mcp"), transport=transport)
    await client.connect()
    assert [chunk async for chunk in client.stream("export-run", {})] == [DONE]
    assert str(seen[0].url) == "http://localhost:3100/stream/export-run"
    assert seen[0].headers["mcp-session-id"] == "session-1"
