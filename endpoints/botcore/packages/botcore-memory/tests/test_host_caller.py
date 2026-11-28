"""Memory commands served through a host keep each verified caller's memory apart.

This file imports only the public commands, so it runs unchanged against the code before
callers had principals, where every host caller shared the local ``default`` memory.
"""

from __future__ import annotations

import json

import pytest
from afd import Actor
from afd.core.commands import CommandContext
from afd.testing import assert_error, assert_success
from botcore.host_surfaces import create_host_mcp_server

from botcore_memory.commands import MEMORY_COMMANDS, memory_set

pytestmark = pytest.mark.usefixtures("no_direct_caller")


def as_actor(kind: str, ident: str | None = None) -> CommandContext:
    return CommandContext(actor=Actor(kind=kind, id=ident))


async def test_one_caller_cannot_read_or_write_anothers_agent_memory(memory_host):
    host = memory_host()
    alice, bob = as_actor("human", "alice"), as_actor("agent", "bob")

    stored = await host.execute("memory_set", {"key": "plan", "value": "a"}, alice)
    assert_success(stored)
    assert stored.data["scope_id"] == "human_alice"

    for command, args in (
        ("memory_get", {"key": "plan", "scope_id": "human_alice"}),
        ("memory_list", {"scope_id": "human_alice"}),
        ("memory_search", {"query": "a", "scope_id": "human_alice"}),
        ("memory_set", {"key": "plan", "value": "b", "scope_id": "human_alice"}),
        ("memory_delete", {"key": "plan", "scope_id": "human_alice"}),
    ):
        assert_error(await host.execute(command, args, bob), "MEMORY_ACCESS_DENIED")

    # Bob's own agent memory is his, and empty; Alice's entry is unchanged.
    assert_error(await host.execute("memory_get", {"key": "plan"}, bob), "MEMORY_NOT_FOUND")
    assert (await host.execute("memory_list", {}, bob)).data["entries"] == []
    mine = await host.execute("memory_get", {"key": "plan"}, alice)
    assert mine.data["value"] == "a"
    assert mine.data["created_by"] == "human_alice"


async def test_local_default_memory_is_not_reachable_through_a_host(memory_host):
    assert_success(await memory_set(key="local", value="owner's"))  # a direct, local call
    host = memory_host()

    refused = await host.execute(
        "memory_get", {"key": "local", "scope_id": "default"}, as_actor("agent", "x")
    )
    assert_error(refused, "MEMORY_ACCESS_DENIED")


@pytest.mark.parametrize("command", [c.__name__ for c in MEMORY_COMMANDS])
async def test_a_host_call_naming_no_one_is_refused(memory_host, command):
    host = memory_host()
    args = {
        "memory_set": {"key": "k", "value": "v", "scope": "team", "scope_id": "t"},
        "memory_get": {"key": "k"},
        "memory_delete": {"key": "k"},
        "memory_search": {"query": "v", "scope": "team"},
        "memory_list": {},
    }[command]

    for context in (as_actor("agent"), None):  # an agent with no id; a host with no actor
        result = await host.execute(command, args, context)
        assert_error(result, "MEMORY_PRINCIPAL_UNKNOWN")
        assert result.error.suggestion


async def test_the_mcp_call_tool_without_a_host_actor_is_refused(memory_host, tmp_path):
    server = create_host_mcp_server(memory_host())

    reply = await server.call_tool(
        "afd-call", {"command": "memory_set", "input": {"key": "k", "value": "v"}}
    )
    blocks = getattr(reply, "content", None) or (reply[0] if isinstance(reply, tuple) else reply)
    assert json.loads(blocks[0].text)["error"]["code"] == "MEMORY_PRINCIPAL_UNKNOWN"
    assert not (tmp_path / "agent").exists()


async def test_a_host_that_names_its_actor_serves_that_actors_memory(memory_host):
    host = memory_host(actor=Actor(kind="human", id="owner"))

    stored = await host.execute("memory_set", {"key": "k", "value": "v"})
    assert stored.data["scope_id"] == "human_owner"


async def test_the_direct_call_name_does_not_override_the_host_actor(memory_host, set_agent):
    set_agent("human_alice")
    await memory_set(key="plan", value="a")  # direct, as human_alice

    refused = await memory_host().execute(
        "memory_get", {"key": "plan", "scope_id": "human_alice"}, as_actor("agent", "bob")
    )
    assert_error(refused, "MEMORY_ACCESS_DENIED")


async def test_http_tokens_for_two_actors_keep_their_memory_apart(memory_host, tmp_path):
    pytest.importorskip("starlette")
    from botcore.host_http import create_host_http_app
    from botcore.host_tokens import TokenStore
    from starlette.testclient import TestClient

    tokens = TokenStore(tmp_path / "tokens.json")
    _, cell = tokens.issue("mem", "agent", "cell-3")
    _, lane = tokens.issue("mem", "service", "lane@random")
    client = TestClient(create_host_http_app({"mem": memory_host()}, tokens))

    def call(token, command, arguments, **extra):
        reply = client.post(
            "/mem/call",
            json={"command": command, "arguments": arguments, **extra},
            headers={"Authorization": f"Bearer {token}"},
        )
        return reply.json()

    stored = call(cell, "memory_set", {"key": "k", "value": "cell's"})
    assert stored["success"], stored
    assert stored["data"]["scope_id"] == "agent_cell-3"

    read = call(lane, "memory_get", {"key": "k", "scope_id": "agent_cell-3"})
    assert read["error"]["code"] == "MEMORY_ACCESS_DENIED"
    # onBehalfOf is what the caller claims; it never changes whose memory is read.
    claimed = call(lane, "memory_get", {"key": "k"}, onBehalfOf="cell-3")
    assert claimed["error"]["code"] == "MEMORY_NOT_FOUND"
    assert call(cell, "memory_get", {"key": "k"})["data"]["value"] == "cell's"
