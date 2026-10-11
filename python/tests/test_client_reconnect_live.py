"""Ordinary McpClient lifecycle contracts against real loopback HTTP/SSE sockets."""

import asyncio
import json
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlsplit

import pytest

from afd.client import McpClient, McpClientConfig
from afd.transports.base import TransportState


async def until(predicate):
    async def wait():
        while not predicate():
            await asyncio.sleep(0.005)
    await asyncio.wait_for(wait(), 3)


class LoopbackMcp:
    """Small protocol server with explicit connection loss after one write."""

    def __init__(self):
        self.sessions = {}
        self.writers = set()
        self.tasks = set()
        self.initializations = 0
        self.writes = 0
        self.fail_init = False
        self.hold_init = None
        self.init_started = asyncio.Event()
        self.advertise_output = False

    async def handle(self, reader, writer):
        self.writers.add(writer)
        self.tasks.add(asyncio.current_task())
        try:
            header = await reader.readuntil(b"\r\n\r\n")
            request_line, *headers = header.decode().split("\r\n")
            method, path, _ = request_line.split()
            headers = dict(line.lower().split(": ", 1) for line in headers if ": " in line)
            if method == "GET" and path == "/sse":
                session = str(len(self.sessions) + 1)
                self.sessions[session] = writer
                writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n")
                writer.write(f"event: endpoint\ndata: /message?session={session}\n\n".encode())
                await writer.drain()
                await reader.read()
                return
            if method == "GET":
                await self.respond(writer, 200, {})
                return
            body = await reader.readexactly(int(headers.get("content-length", "0")))
            request = json.loads(body)
            rpc_method = request["method"]
            session = parse_qs(urlsplit(path).query).get("session", [None])[0]
            if "id" not in request:
                await self.respond(writer, 202, {})
                return
            if rpc_method == "initialize":
                self.initializations += 1
                self.init_started.set()
                if self.hold_init is not None:
                    await self.hold_init.wait()
                if self.fail_init:
                    await self.respond(writer, 503, {})
                    return
                result = {"protocolVersion": "2024-11-05", "capabilities": {}, "serverInfo": {"name": "loopback", "version": "1"}}
            elif rpc_method == "tools/list":
                tool = {"name": f"tool-{self.initializations}", "description": "Live discovery", "inputSchema": {"type": "object"}}
                if self.advertise_output:
                    tool["name"] = "output-read"
                    tool["outputSchema"] = {"type": "object", "properties": {"value": {"type": "integer"}}, "required": ["value"]}
                result = {"tools": [tool]}
            elif rpc_method == "tools/call":
                self.writes += 1
                if request["params"]["name"] == "write-hold":
                    await asyncio.Event().wait()
                if request["params"]["name"] == "write-drop":
                    if session is not None:
                        self.sessions[session].close()
                    return  # Mutation happened, but no response reached the client.
                if request["params"]["name"] == "output-read":
                    arguments = request["params"].get("arguments", {})
                    result = {"content": [{"type": "text", "text": '{"success":true,"data":null}'}]}
                    if arguments.get("mode") != "missing":
                        result["structuredContent"] = {"value": "bad" if arguments.get("mode") == "invalid" else 7}
                elif request["params"]["name"] == "fail-tool":
                    result = {"content": [{"type": "text", "text": "Invalid input"}], "isError": True}
                else:
                    result = {"content": [{"type": "text", "text": '{"success":true,"data":null}'}]}
            else:
                raise AssertionError(rpc_method)
            payload = {"jsonrpc": "2.0", "id": request["id"], "result": result}
            if session is None:
                await self.respond(writer, 200, payload)
            else:
                stream = self.sessions[session]
                stream.write(f"event: message\ndata: {json.dumps(payload)}\n\n".encode())
                await stream.drain()
                await self.respond(writer, 202, {})
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            writer.close()
            await writer.wait_closed()
            self.writers.discard(writer)
            self.tasks.discard(asyncio.current_task())

    async def respond(self, writer, status, body):
        payload = json.dumps(body).encode()
        writer.write(f"HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\nConnection: close\r\n\r\n".encode() + payload)
        await writer.drain()

    def drop_sse(self):
        for writer in self.sessions.values():
            writer.close()


@asynccontextmanager
async def running_server():
    protocol = LoopbackMcp()
    server = await asyncio.start_server(protocol.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    protocol.url = f"http://127.0.0.1:{port}"
    try:
        yield protocol
    finally:
        server.close()
        for writer in list(protocol.writers):
            writer.close()
        tasks = list(protocol.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await server.wait_closed()


def make_client(server, transport, **config):
    return McpClient(McpClientConfig(
        url=server.url + ("/sse" if transport == "sse" else "/message"),
        transport=transport, timeout=2, reconnect_delay=0.01, **config,
    ))


@pytest.mark.parametrize("transport", ["http", "sse"])
async def test_loss_after_mutation_reconnects_discovery_without_replaying(transport):
    async with running_server() as server:
        client = make_client(server, transport)
        states = []
        connected = []
        client.on("state_change", states.append)
        client.on("connected", lambda: connected.append(True))
        try:
            await client.connect()
            result = await client.call("write-drop")
            assert result.error.code == "TRANSPORT_ERROR"
            await until(lambda: len(connected) == 2)
            assert client.is_connected()
            assert client.get_tools()[0].name == "tool-2"
            assert client.get_status().reconnect_attempts == 0
            assert server.writes == 1
            assert TransportState.RECONNECTING in states
            assert (await client.call("write-ok")).success
            assert not (await client.call("write-drop")).success
            await until(lambda: len(connected) == 3)
            assert server.initializations == 3
            assert server.writes == 3
            assert client.get_status().reconnect_attempts == 0
        finally:
            await client.disconnect()
        assert client.get_status().state == TransportState.DISCONNECTED
        assert client.get_tools() == []
        await until(lambda: not server.writers)


async def test_sse_idle_eof_reconnects_and_disconnect_stops_future_reconnects():
    async with running_server() as server:
        client = make_client(server, "sse")
        connected = []
        client.on("connected", lambda: connected.append(True))
        try:
            await client.connect()
            server.drop_sse()
            await until(lambda: len(connected) == 2)
            assert server.initializations == 2
        finally:
            await client.disconnect()
        server.drop_sse()
        await asyncio.sleep(0.04)
        assert server.initializations == 2
        assert client._reconnect_task is None
        assert client._transport._owner is None
        await until(lambda: not server.writers)


async def test_manual_disconnect_cancels_backoff():
    async with running_server() as server:
        client = make_client(server, "sse")
        client._config.reconnect_delay = 1
        await client.connect()
        server.drop_sse()
        await until(lambda: client.get_status().state == TransportState.RECONNECTING)
        await asyncio.wait_for(client.disconnect(), 0.5)
        assert client._reconnect_task is None
        assert server.initializations == 1
        assert client.get_status().state == TransportState.DISCONNECTED


async def test_manual_disconnect_cancels_reconnect_handshake():
    async with running_server() as server:
        client = make_client(server, "sse")
        await client.connect()
        server.init_started.clear()
        server.hold_init = asyncio.Event()
        server.drop_sse()
        await asyncio.wait_for(server.init_started.wait(), 2)
        await asyncio.wait_for(client.disconnect(), 0.5)
        assert client.get_status().state == TransportState.DISCONNECTED
        assert client._transport._owner is None
        server.hold_init.set()
        await asyncio.sleep(0.04)
        assert not client.is_connected()
        assert client.get_tools() == []


@pytest.mark.parametrize("transport", ["http", "sse"])
async def test_auto_reconnect_disabled(transport):
    async with running_server() as server:
        client = make_client(server, transport, auto_reconnect=False)
        try:
            await client.connect()
            assert not (await client.call("write-drop")).success
            await asyncio.sleep(0.04)
            assert server.initializations == 1
            assert not client.is_connected()
            assert client.get_tools() == []
        finally:
            await client.disconnect()


async def test_reconnect_exhaustion_cleans_resources():
    async with running_server() as server:
        client = make_client(server, "http", max_reconnect_attempts=2)
        errors = []
        attempts = []
        client.on("error", errors.append)
        client.on("reconnecting", lambda n, maximum: attempts.append((n, maximum)))
        await client.connect()
        server.fail_init = True
        try:
            assert not (await client.call("write-drop")).success
            await until(lambda: client.get_status().state == TransportState.ERROR)
            assert attempts == [(1, 2), (2, 2)]
            assert len(errors) == 2  # Original loss, then terminal reconnect failure.
            assert server.initializations == 3
            assert client._transport._client is None
            assert client.get_tools() == []
        finally:
            await client.disconnect()


@pytest.mark.parametrize("transport", ["http", "sse"])
async def test_application_error_keeps_connection(transport):
    async with running_server() as server:
        client = make_client(server, transport)
        try:
            await client.connect()
            result = await client.call("fail-tool")
            assert result.error.code == "TOOL_ERROR"
            assert client.is_connected()
            assert server.initializations == 1
            assert client._reconnect_task is None
            assert (await client.call("write-ok")).success
        finally:
            await client.disconnect()


async def test_manual_connect_supersedes_pending_reconnect():
    async with running_server() as server:
        client = make_client(server, "sse")
        client._config.reconnect_delay = 1
        try:
            await client.connect()
            server.drop_sse()
            await until(lambda: client.get_status().state == TransportState.RECONNECTING)
            await client.connect()
            assert client.is_connected()
            assert server.initializations == 2
            assert client._reconnect_task is None
            assert client.get_status().reconnect_attempts == 0
        finally:
            await client.disconnect()


async def test_sse_request_timeout_is_bounded_and_does_not_replay():
    # Load the optional SDK before timing the actual network handshake.
    pytest.importorskip("mcp.client.session")
    async with running_server() as server:
        client = make_client(server, "sse", auto_reconnect=False)
        client._config.timeout = 0.2
        try:
            await client.connect()
            result = await asyncio.wait_for(client.call("write-hold"), 1)
            assert result.error.code == "TRANSPORT_ERROR"
            assert server.writes == 1
            assert not client.is_connected()
        finally:
            await client.disconnect()


async def test_abandoned_initial_handshake_cannot_close_later_connection():
    pytest.importorskip("mcp.client.session")
    async with running_server() as server:
        server.hold_init = asyncio.Event()
        client = make_client(server, "sse")
        client._config.timeout = 0.3
        first = asyncio.create_task(client.connect())
        try:
            await asyncio.wait_for(server.init_started.wait(), 2)
            await client.disconnect()
            # Do not cancel the old caller: disconnect must settle its handshake.
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(first), 0.1)
            server.hold_init.set()
            await client.connect()
            owner = client._transport._owner
            await asyncio.sleep(0.4)  # Past the abandoned handshake's deadline.
            assert client.is_connected()
            assert client._transport._owner is owner
            assert not owner.done()
            assert (await client.call("write-ok")).success
            assert server.initializations == 2
        finally:
            await client.disconnect()
            first.cancel()
            await asyncio.gather(first, return_exceptions=True)


@pytest.mark.parametrize("auto_reconnect", [True, False])
@pytest.mark.parametrize("mode", ["missing", "invalid"])
async def test_sdk_output_schema_failure_keeps_same_session(auto_reconnect, mode):
    async with running_server() as server:
        server.advertise_output = True
        client = make_client(server, "sse", auto_reconnect=auto_reconnect)
        try:
            await client.connect()
            session = client._transport._session
            result = await client.call("output-read", {"mode": mode})
            assert not result.success
            assert client.is_connected()
            assert client._reconnect_task is None
            assert client._transport._session is session
            assert (await client.call("output-read", {"mode": "valid"})).success
            assert server.initializations == 1
        finally:
            await client.disconnect()
