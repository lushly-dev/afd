"""Bounded AFD protocol tier, using SDK clients and a real server subprocess.

This covers the implemented Python SSE and Streamable HTTP paths. It does not
assert general MCP conformance or invent Rust/C++ hosted transport support.
"""

import asyncio
import json
import os
import socket
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from mcp import ClientSession
from mcp.client.sse import sse_client

try:
    from mcp.client.streamable_http import streamable_http_client
except ImportError:  # MCP SDK 1.19 compatibility.
    from mcp.client.streamable_http import streamablehttp_client as streamable_http_client


@asynccontextmanager
async def protocol_server(strategy, transport, *, stateless=False):
    # Holding the listener until just before spawning minimizes port reuse races.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    root = Path(__file__).resolve().parents[1]
    env = dict(os.environ, PYTHONPATH=str(root / "src"))
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        str(root / "tests/fixtures/protocol_server.py"),
        str(port),
        strategy,
        transport,
        "stateless" if stateless else "stateful",
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:

        async def ready():
            while process.returncode is None:
                try:
                    reader, writer = await asyncio.open_connection("127.0.0.1", port)
                    writer.close()
                    await writer.wait_closed()
                    return
                except OSError:
                    await asyncio.sleep(0.02)
            raise AssertionError(f"Protocol fixture exited: {process.returncode}")

        await asyncio.wait_for(ready(), 10)
        yield f"http://127.0.0.1:{port}" + ("/sse" if transport == "sse" else "/mcp")
    finally:
        if process.returncode is None:
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), 5)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()


@asynccontextmanager
async def client_session(url, transport):
    connection = sse_client(url) if transport == "sse" else streamable_http_client(url)
    async with connection as streams, ClientSession(streams[0], streams[1]) as session:
        await session.initialize()
        yield session


async def call(session, name, arguments=None):
    result = await session.call_tool(name, arguments or {})
    payload = json.loads(result.content[0].text)
    # Both success and failure must remain typed AFD data on the actual wire.
    assert result.is_error is (
        not payload["success"]
        if "success" in payload
        else any(step["status"] == "failure" for step in payload["steps"])
    )
    return payload


async def invoke(session, strategy, command, value=7):
    if strategy in ("individual", "hybrid"):  # the hybrid fixture lists every command it invokes
        return await call(session, command, {"value": value})
    if strategy == "grouped":
        group, action = command.split("-", 1)
        return await call(session, group, {"action": action, "params": {"value": value}})
    return await call(session, "afd-call", {"command": command, "input": {"value": value}})


async def discovered(session):
    result = await call(session, "afd-discover")
    return {item["name"] for item in result["data"]["commands"]}


@pytest.mark.parametrize("transport", ["sse", "streamable-http"])
@pytest.mark.parametrize("strategy", ["individual", "grouped", "lazy", "hybrid"])
async def test_protocol_discovery_exposure_errors_and_meta_tools(strategy, transport):
    async with (
        protocol_server(strategy, transport) as url,
        client_session(url, transport) as session,
    ):
        tools = (await session.list_tools()).tools
        names = {item.name for item in tools}
        assert {"afd-call", "afd-discover", "afd-detail", "afd-batch", "afd-pipe"} <= names
        assert "private-rotate" not in names
        assert "private-rotate" not in await discovered(session)
        assert {"alpha-run", "beta-run"} <= await discovered(session)
        detail = await call(session, "afd-detail", {"command": "alpha-run"})
        assert detail["success"] is True
        assert "probe-read" in json.dumps(detail)
        if strategy == "hybrid":
            # The five meta-tools, the context tools, then the first-class tools in order.
            assert [item.name for item in tools] == [
                "afd-discover", "afd-detail", "afd-call", "afd-batch", "afd-pipe",
                "afd-context-list", "afd-context-enter", "afd-context-exit",
                "alpha-run", "beta-run", "probe-read",
            ]
        if strategy in ("individual", "hybrid"):
            alpha = next(item for item in tools if item.name == "alpha-run")
            assert alpha.meta["contexts"] == ["alpha"]
            assert alpha.meta["requires"] == ["probe-read"]
            assert alpha.input_schema["properties"]["value"]["type"] == "integer"
        for unknown in ("alpha-rnu", "private-rotate"):
            result = await call(session, unknown)
            assert result["error"]["code"] == "COMMAND_NOT_FOUND"
            assert "private-rotate" not in result["error"]["suggestion"]
            remote = await call(session, "afd-call", {"command": unknown})
            assert remote["error"]["code"] == "COMMAND_NOT_FOUND"
        invalid = await invoke(session, strategy, "alpha-run", value="bad")
        assert invalid["error"]["code"] == "VALIDATION_ERROR"
        valid = await invoke(session, strategy, "alpha-run")
        assert valid["data"]["value"] == 7
        malformed = await call(
            session,
            "afd-batch",
            {
                "commands": [
                    {"command": "probe-write", "input": {}},
                    {"command": 123},
                ]
            },
        )
        assert malformed["error"]["code"] == "INVALID_BATCH_REQUEST"
        assert (await call(session, "afd-call", {"command": "probe-read"}))["data"]["writes"] == 0
        batch = await call(
            session,
            "afd-batch",
            {
                "commands": [
                    {"command": "alpha-run", "input": {"value": 3}},
                    {"command": "beta-run", "input": {"value": 4}},
                ]
            },
        )
        assert batch["success"] is True
        pipeline = await call(
            session,
            "afd-pipe",
            {
                "steps": [
                    {"command": "alpha-run", "input": {"value": 3}, "as": "first"},
                    {"command": "beta-run", "input": {"value": "$first.value"}},
                ]
            },
        )
        assert pipeline["data"]["value"] == 3


@pytest.mark.parametrize("transport", ["sse", "streamable-http"])
@pytest.mark.parametrize("strategy", ["individual", "grouped", "lazy", "hybrid"])
async def test_two_transport_sessions_isolate_contexts_and_fresh_connections(strategy, transport):
    async with protocol_server(strategy, transport) as url, client_session(url, transport) as alice:
        async with client_session(url, transport) as bob:
            assert (
                await call(alice, "afd-context-enter", {"context": "alpha", "sessionId": "shared"})
            )["success"]
            assert {"alpha-run", "beta-run"} <= await discovered(bob)
            assert (await invoke(bob, strategy, "beta-run"))["success"]
            assert (
                await call(bob, "afd-context-enter", {"context": "beta", "sessionId": "shared"})
            )["success"]
            concurrent = await asyncio.gather(
                invoke(alice, strategy, "alpha-run"), invoke(bob, strategy, "beta-run")
            )
            assert all(result["success"] for result in concurrent)
            for session, allowed, forbidden in (
                (alice, "alpha", "beta"),
                (bob, "beta", "alpha"),
            ):
                names = await discovered(session)
                assert f"{allowed}-run" in names
                assert f"{forbidden}-run" not in names
                listed = {item.name for item in (await session.list_tools()).tools}
                if strategy == "individual":
                    assert f"{allowed}-run" in listed
                    assert f"{forbidden}-run" not in listed
                elif strategy == "hybrid":
                    # The list never varies by session context; the call is refused instead.
                    assert {"alpha-run", "beta-run"} <= listed
                elif strategy == "grouped":
                    assert allowed in listed
                    assert forbidden not in listed
                assert (await invoke(session, strategy, f"{allowed}-run"))["success"]
                blocked = await invoke(session, strategy, f"{forbidden}-run")
                assert blocked["error"]["code"] == "COMMAND_NOT_IN_CONTEXT"
                batch = await call(
                    session,
                    "afd-batch",
                    {
                        "commands": [
                            {"command": f"{allowed}-run", "input": {"value": 1}},
                            {"command": f"{forbidden}-run", "input": {"value": 1}},
                        ]
                    },
                )
                assert batch["results"][0]["result"]["success"]
                assert batch["results"][1]["result"]["error"]["code"] == "COMMAND_NOT_IN_CONTEXT"
                pipe = await call(
                    session,
                    "afd-pipe",
                    {
                        "steps": [
                            {"command": f"{forbidden}-run", "input": {"value": 1}},
                        ]
                    },
                )
                assert pipe["steps"][0]["status"] == "failure"
            # Depth is per session; re-entering the active context is a no-op.
            for _ in range(20):
                assert (await call(alice, "afd-context-enter", {"context": "alpha"}))["success"]
            for index in range(15):
                assert (
                    await call(
                        alice,
                        "afd-context-enter",
                        {"context": "beta" if index % 2 == 0 else "alpha"},
                    )
                )["success"]
            overflow = await call(alice, "afd-context-enter", {"context": "alpha"})
            assert overflow["error"]["code"] == "CONTEXT_DEPTH_EXCEEDED"
            assert (await call(bob, "afd-context-list"))["data"]["activeContext"] == "beta"
        async with client_session(url, transport) as fresh:
            assert {"alpha-run", "beta-run"} <= await discovered(fresh)
            assert (await call(fresh, "afd-context-list"))["data"].get("activeContext") is None


async def test_stateless_http_context_mutation_requires_a_persistent_session():
    async with (
        protocol_server("individual", "streamable-http", stateless=True) as url,
        client_session(url, "streamable-http") as session,
    ):
        for name, args in (
            ("afd-context-enter", {"context": "alpha"}),
            ("afd-context-exit", {}),
        ):
            result = await call(session, name, args)
            assert result["error"]["code"] == "SESSION_REQUIRED"
        assert {"alpha-run", "beta-run"} <= await discovered(session)


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_hybrid_strategy_over_stdio(mode):
    from mcp import Client, StdioServerParameters

    root = Path(__file__).resolve().parents[1]
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(root / "tests/fixtures/protocol_server.py"), "0", "hybrid", "stdio"],
        env=dict(os.environ, PYTHONPATH=str(root / "src")),
    )
    async with Client(params, mode=mode) as client:
        names = [item.name for item in (await client.list_tools()).tools]
        assert names[:5] == ["afd-discover", "afd-detail", "afd-call", "afd-batch", "afd-pipe"]
        assert names[8:] == ["alpha-run", "beta-run", "probe-read"]
        entered = json.loads(
            (await client.call_tool("afd-context-enter", {"context": "beta"})).content[0].text
        )
        if mode == "legacy":
            # A 2025 stdio connection is one session: its context stack scopes the calls.
            assert entered["success"] is True
            denied = json.loads(
                (await client.call_tool("alpha-run", {"value": 1})).content[0].text
            )
            assert denied["error"]["code"] == "COMMAND_NOT_IN_CONTEXT"
            assert [item.name for item in (await client.list_tools()).tools] == names
