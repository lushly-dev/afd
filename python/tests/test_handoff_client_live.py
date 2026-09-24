"""Handoff connections against real local WebSocket and SSE servers (review finding H11).

The built-in handlers must read messages, report a server close, send the
token in a header rather than the URL, and the reconnecting wrapper must
reschedule failed attempts and leave nothing open after ``close()``.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable, List

import pytest

pytest.importorskip("websockets")
pytest.importorskip("httpx")

from websockets.asyncio.server import serve  # noqa: E402
from websockets.exceptions import InvalidStatus  # noqa: E402

from afd.handoff_client import (  # noqa: E402
    HandoffConnectionOptions,
    HandoffConnectionState,
    ReconnectionOptions,
    clear_handoff_handlers,
    connect_handoff,
    create_reconnecting_handoff,
    register_builtin_handlers,
    register_handoff_handler,
)


@pytest.fixture(autouse=True)
def _builtin_handlers():
    clear_handoff_handlers()
    register_builtin_handlers()
    yield
    clear_handoff_handlers()


async def _until(predicate: Callable[[], bool], timeout: float = 3.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not predicate():
        if loop.time() > deadline:
            raise AssertionError("condition not reached in time")
        await asyncio.sleep(0.01)


class _Recorder:
    """Collects everything a connection reports."""

    def __init__(self) -> None:
        self.messages: List[Any] = []
        self.disconnects: List[tuple] = []
        self.errors: List[Exception] = []
        self.states: List[HandoffConnectionState] = []

    def options(self, **overrides: Any) -> HandoffConnectionOptions:
        values: dict = {
            "on_message": self.messages.append,
            "on_disconnect": lambda code, reason: self.disconnects.append((code, reason)),
            "on_error": self.errors.append,
            "on_state_change": self.states.append,
        }
        values.update(overrides)
        return HandoffConnectionOptions(**values)


class _WsServer:
    """A local WebSocket server; ``behaviour(connection, number)`` runs per connection."""

    def __init__(self, behaviour, process_request=None) -> None:
        self._behaviour = behaviour
        self._process_request = process_request
        self.requests: List[Any] = []
        self.open_connections = 0
        self.connections = 0
        self.port = 0

    async def _handler(self, connection) -> None:
        self.connections += 1
        self.open_connections += 1
        self.requests.append(connection.request)
        try:
            await self._behaviour(connection, self.connections)
        finally:
            self.open_connections -= 1

    async def __aenter__(self) -> "_WsServer":
        self._server = serve(
            self._handler, "127.0.0.1", 0, process_request=self._process_request
        )
        server = await self._server.__aenter__()
        self.port = server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self._server.__aexit__(*exc)

    def handoff(self, **extra: Any) -> dict:
        return {"protocol": "websocket", "endpoint": f"ws://127.0.0.1:{self.port}/chat", **extra}


async def _hold_open(connection) -> None:
    await connection.wait_closed()


class TestWebSocketConnection:
    @pytest.mark.asyncio
    async def test_receives_messages_and_reports_the_server_close(self):
        async def send_then_close(connection, _n):
            await connection.send(json.dumps({"type": "hello"}))
            await connection.send("plain text")
            await connection.close(1000, "done")

        recorder = _Recorder()
        async with _WsServer(send_then_close) as server:
            conn = await connect_handoff(server.handoff(), recorder.options())
            await _until(lambda: recorder.disconnects)

        assert recorder.messages == [{"type": "hello"}, "plain text"]
        assert recorder.disconnects == [(1000, "done")]
        assert conn.state == HandoffConnectionState.DISCONNECTED
        assert conn.is_connected is False
        assert recorder.errors == []

    @pytest.mark.asyncio
    async def test_token_is_sent_in_a_header_not_the_url(self):
        recorder = _Recorder()
        async with _WsServer(_hold_open) as server:
            conn = await connect_handoff(
                server.handoff(
                    credentials={"token": "s3cret-token", "headers": {"X-Room": "42"}}
                ),
                recorder.options(),
            )
            await conn.close()

        request = server.requests[0]
        assert request.headers["Authorization"] == "Bearer s3cret-token"
        assert request.headers["X-Room"] == "42"
        assert "s3cret" not in request.path

    @pytest.mark.asyncio
    async def test_explicit_authorization_header_is_kept(self):
        async with _WsServer(_hold_open) as server:
            conn = await connect_handoff(
                server.handoff(
                    credentials={"token": "t", "headers": {"authorization": "Custom abc"}}
                ),
                HandoffConnectionOptions(),
            )
            await conn.close()

        assert server.requests[0].headers.get_all("Authorization") == ["Custom abc"]

    @pytest.mark.asyncio
    async def test_send_close_and_callbacks(self):
        async def echo(connection, _n):
            async for message in connection:
                await connection.send(message)

        recorder = _Recorder()
        closed: List[bool] = []
        async with _WsServer(echo) as server:
            conn = await connect_handoff(server.handoff(), recorder.options())
            conn.on_close(lambda: closed.append(True))
            extra: List[Any] = []
            conn.on_message(extra.append)
            await conn.send({"n": 1})
            await _until(lambda: recorder.messages)
            await conn.close()
            await conn.close()  # idempotent
            await _until(lambda: server.open_connections == 0)

        assert recorder.messages == [{"n": 1}]
        assert extra == [{"n": 1}]
        assert recorder.disconnects == [(1000, "Client close")]
        assert closed == [True]
        with pytest.raises(RuntimeError, match="not in connected state"):
            await conn.send({"n": 2})

    @pytest.mark.asyncio
    async def test_a_raising_callback_does_not_stop_the_reader(self):
        async def send_two(connection, _n):
            await connection.send("1")
            await connection.send("2")
            await connection.wait_closed()

        seen: List[Any] = []

        def on_message(message: Any) -> None:
            seen.append(message)
            if message == 1:
                raise ValueError("callback bug")

        async with _WsServer(send_two) as server:
            conn = await connect_handoff(server.handoff(), HandoffConnectionOptions(on_message=on_message))
            await _until(lambda: len(seen) == 2)
            await conn.close()

        assert seen == [1, 2]

    @pytest.mark.asyncio
    async def test_rejected_handshake_raises_and_is_failed(self):
        def reject(connection, request):
            return connection.respond(403, "Forbidden\n")

        recorder = _Recorder()
        async with _WsServer(_hold_open, process_request=reject) as server:
            with pytest.raises(InvalidStatus):
                await connect_handoff(server.handoff(), recorder.options())

        assert recorder.states[-1] == HandoffConnectionState.FAILED


class TestReconnectingWebSocket:
    @pytest.mark.asyncio
    async def test_reconnects_after_the_server_closes(self):
        async def first_closes(connection, number):
            await connection.send(json.dumps({"connection": number}))
            if number == 1:
                await connection.close(1011, "restarting")
            else:
                await connection.wait_closed()

        messages: List[Any] = []
        reconnects: List[int] = []
        async with _WsServer(first_closes) as server:
            conn = await create_reconnecting_handoff(
                None,
                server.handoff(),
                ReconnectionOptions(
                    backoff_ms=10,
                    max_attempts=3,
                    on_message=messages.append,
                    on_reconnect=reconnects.append,
                ),
            )
            await _until(lambda: len(messages) == 2 and conn.is_connected)
            await conn.close()
            await _until(lambda: server.open_connections == 0)

        assert messages == [{"connection": 1}, {"connection": 2}]
        assert reconnects == [1]
        assert server.connections == 2
        assert conn.state == HandoffConnectionState.DISCONNECTED
        assert conn._tasks == set()

    @pytest.mark.asyncio
    async def test_failed_reconnect_is_rescheduled(self):
        attempts = {"n": 0}

        def reject_second(connection, request):
            attempts["n"] += 1
            if attempts["n"] == 2:
                return connection.respond(503, "Busy\n")
            return None

        async def first_closes(connection, number):
            if number == 1:
                await connection.close(1011, "restarting")
            else:
                await connection.send("back")
                await connection.wait_closed()

        messages: List[Any] = []
        errors: List[Exception] = []
        async with _WsServer(first_closes, process_request=reject_second) as server:
            conn = await create_reconnecting_handoff(
                None,
                server.handoff(),
                ReconnectionOptions(
                    backoff_ms=10, max_attempts=5, on_message=messages.append, on_error=errors.append
                ),
            )
            await _until(lambda: messages == ["back"])
            assert conn.state == HandoffConnectionState.CONNECTED
            assert conn.reconnect_attempt == 0
            await conn.close()

        assert attempts["n"] == 3
        assert len(errors) == 1  # the rejected handshake

    @pytest.mark.asyncio
    async def test_close_during_a_reconnect_handshake_leaves_nothing_open(self):
        slow = asyncio.Event()

        async def slow_second(connection, request):
            if server.connections >= 1:
                slow.set()
                await asyncio.sleep(0.3)
            return None

        async def first_closes(connection, number):
            if number == 1:
                await connection.close(1011, "restarting")
            else:
                await connection.wait_closed()

        async with _WsServer(first_closes, process_request=slow_second) as server:
            conn = await create_reconnecting_handoff(
                None, server.handoff(), ReconnectionOptions(backoff_ms=10, max_attempts=3)
            )
            await asyncio.wait_for(slow.wait(), 3)
            await conn.close()
            await asyncio.sleep(0.5)  # the handshake would have finished by now

            assert server.open_connections == 0
            assert server.connections == 1

        assert conn.state == HandoffConnectionState.DISCONNECTED
        assert conn._tasks == set()


class _MockConnection:
    def __init__(self, options: HandoffConnectionOptions) -> None:
        self.options = options
        self.closed = False
        self.state = HandoffConnectionState.DISCONNECTED

    async def connect(self) -> None:
        self.state = HandoffConnectionState.CONNECTED

    async def close(self) -> None:
        self.closed = True

    async def send(self, data: Any) -> None:
        pass


class TestReconnectLogic:
    @pytest.mark.asyncio
    async def test_one_failed_attempt_does_not_stick_in_reconnecting(self):
        created: List[_MockConnection] = []
        calls = {"n": 0}

        async def handler(handoff, options):
            calls["n"] += 1
            if calls["n"] == 2:
                raise ConnectionError("still down")
            connection = _MockConnection(options)
            created.append(connection)
            return connection

        register_handoff_handler("mock", handler)
        conn = await create_reconnecting_handoff(
            None,
            {"protocol": "mock", "endpoint": "mock://x"},
            ReconnectionOptions(backoff_ms=1, max_attempts=5),
        )
        created[0].options.on_disconnect(1006, "gone")

        await _until(lambda: conn.state == HandoffConnectionState.CONNECTED and len(created) == 2)
        assert calls["n"] == 3
        await conn.close()

    @pytest.mark.asyncio
    async def test_all_attempts_failing_ends_failed(self):
        failed: List[bool] = []
        calls = {"n": 0}
        first: List[_MockConnection] = []

        async def handler(handoff, options):
            calls["n"] += 1
            if calls["n"] > 1:
                raise ConnectionError("down")
            connection = _MockConnection(options)
            first.append(connection)
            return connection

        register_handoff_handler("mock", handler)
        conn = await create_reconnecting_handoff(
            None,
            {"protocol": "mock", "endpoint": "mock://x"},
            ReconnectionOptions(
                backoff_ms=1, max_attempts=2, on_reconnect_failed=lambda: failed.append(True)
            ),
        )
        first[0].options.on_disconnect(1006, "gone")

        await _until(lambda: failed)
        assert conn.state == HandoffConnectionState.FAILED
        assert calls["n"] == 3
        await conn.close()

    @pytest.mark.asyncio
    async def test_stale_disconnect_from_an_old_connection_is_ignored(self):
        created: List[_MockConnection] = []

        async def handler(handoff, options):
            connection = _MockConnection(options)
            created.append(connection)
            return connection

        register_handoff_handler("mock", handler)
        conn = await create_reconnecting_handoff(
            None,
            {"protocol": "mock", "endpoint": "mock://x"},
            ReconnectionOptions(backoff_ms=1, max_attempts=3),
        )
        created[0].options.on_disconnect(1006, "gone")
        await _until(lambda: len(created) == 2 and conn.is_connected)

        created[0].options.on_disconnect(1006, "late duplicate")
        await asyncio.sleep(0.05)

        assert len(created) == 2
        assert conn.is_connected
        await conn.close()
        assert created[1].closed is True

    @pytest.mark.asyncio
    async def test_connection_opened_after_close_is_closed(self):
        entered = asyncio.Event()
        created: List[_MockConnection] = []

        async def handler(handoff, options):
            connection = _MockConnection(options)
            created.append(connection)
            if len(created) == 2:
                entered.set()
                try:
                    await asyncio.sleep(10)
                except asyncio.CancelledError:
                    # A handshake that finishes despite the cancellation.
                    await asyncio.sleep(0.02)
            return connection

        register_handoff_handler("mock", handler)
        conn = await create_reconnecting_handoff(
            None,
            {"protocol": "mock", "endpoint": "mock://x"},
            ReconnectionOptions(backoff_ms=1, max_attempts=3),
        )
        created[0].options.on_disconnect(1006, "gone")
        await asyncio.wait_for(entered.wait(), 2)

        await conn.close()

        assert created[1].closed is True  # re-checked after the await, then closed
        assert conn.state == HandoffConnectionState.DISCONNECTED
        assert conn._connection is None
        assert conn._tasks == set()

    @pytest.mark.asyncio
    async def test_reconnect_after_close_raises(self):
        async def handler(handoff, options):
            return _MockConnection(options)

        register_handoff_handler("mock", handler)
        conn = await create_reconnecting_handoff(None, {"protocol": "mock", "endpoint": "mock://x"})
        await conn.close()

        with pytest.raises(RuntimeError, match="closed"):
            await conn.reconnect()


async def _sse_server(respond):
    """A raw HTTP server; ``respond(headers, writer)`` writes the response."""
    requests: List[dict] = []

    async def handle(reader, writer):
        head = await reader.readuntil(b"\r\n\r\n")
        lines = head.decode().split("\r\n")
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                name, value = line.split(":", 1)
                headers[name.strip().lower()] = value.strip()
        requests.append({"line": lines[0], "headers": headers})
        try:
            await respond(headers, writer, reader)
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1], requests


_SSE_HEAD = (
    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
    b"Cache-Control: no-cache\r\nConnection: close\r\n\r\n"
)


class TestSseConnection:
    @pytest.mark.asyncio
    async def test_receives_events_and_reports_the_end_of_the_stream(self):
        async def respond(headers, writer, reader):
            writer.write(_SSE_HEAD)
            writer.write(b'data: {"n": 1}\n\n')
            writer.write(b": keep-alive comment\n")
            writer.write(b"event: tick\ndata: line one\ndata:line two\n\n")
            await writer.drain()

        server, port, requests = await _sse_server(respond)
        recorder = _Recorder()
        async with server:
            conn = await connect_handoff(
                {
                    "protocol": "sse",
                    "endpoint": f"http://127.0.0.1:{port}/events",
                    "credentials": {"token": "tok-1"},
                },
                recorder.options(),
            )
            await _until(lambda: recorder.disconnects)

        assert recorder.messages == [{"n": 1}, "line one\nline two"]
        assert recorder.disconnects == [(None, "Stream ended")]
        assert conn.state == HandoffConnectionState.DISCONNECTED
        assert requests[0]["line"].startswith("GET /events ")
        assert requests[0]["headers"]["authorization"] == "Bearer tok-1"
        assert requests[0]["headers"]["accept"] == "text/event-stream"
        assert "tok-1" not in requests[0]["line"]

    @pytest.mark.asyncio
    async def test_close_stops_an_open_stream(self):
        ended = asyncio.Event()

        async def respond(headers, writer, reader):
            writer.write(_SSE_HEAD + b"data: 1\n\n")
            await writer.drain()
            await reader.read()  # until the client goes away
            ended.set()

        server, port, _ = await _sse_server(respond)
        recorder = _Recorder()
        async with server:
            conn = await connect_handoff(
                {"protocol": "sse", "endpoint": f"http://127.0.0.1:{port}/events"},
                recorder.options(),
            )
            await _until(lambda: recorder.messages == [1])
            await conn.close()
            await asyncio.wait_for(ended.wait(), 3)

        assert recorder.disconnects == [(1000, "Client close")]
        assert recorder.errors == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "head",
        [
            b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi",
        ],
    )
    async def test_bad_response_raises_and_is_failed(self, head):
        async def respond(headers, writer, reader):
            writer.write(head)
            await writer.drain()

        server, port, _ = await _sse_server(respond)
        recorder = _Recorder()
        async with server:
            with pytest.raises(ConnectionError):
                await connect_handoff(
                    {"protocol": "sse", "endpoint": f"http://127.0.0.1:{port}/events"},
                    recorder.options(),
                )

        assert recorder.states[-1] == HandoffConnectionState.FAILED
