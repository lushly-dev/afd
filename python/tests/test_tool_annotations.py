"""MCP tool annotations derived from command metadata (spec/command-metadata.md)."""

import pytest

from afd import ExposeOptions, success
from afd.server import create_server

MCP = ExposeOptions(mcp=True)


def _server():
    server = create_server("annotations")

    @server.command(name="todo-purge", description="Delete all", mutation=True, expose=MCP)
    async def purge(input):
        return success({})

    @server.command(name="todo-list", description="List", expose=MCP)
    async def listing(input):
        return success([])

    return server


def test_tool_definitions_carry_annotations_only_for_declared_mutations():
    tools = {tool["name"]: tool for tool in _server().get_tool_definitions()}
    assert tools["todo-purge"]["annotations"] == {"readOnlyHint": False, "destructiveHint": False}
    # `mutation` defaults to False and has no unset state, so nothing is claimed.
    assert "annotations" not in tools["todo-list"]


@pytest.mark.asyncio
async def test_annotations_reach_the_wire():
    mcp = _server()._create_mcp_server()
    tools = {tool.name: tool for tool in await mcp.list_tools()}
    dumped = tools["todo-purge"].model_dump(by_alias=True, exclude_none=True)
    assert dumped["annotations"] == {"readOnlyHint": False, "destructiveHint": False}



def _trust_server(tool_strategy="individual"):
    server = create_server("trust", tool_strategy=tool_strategy)

    @server.command(
        name="todo-clear",
        description="Delete every todo",
        mutation=True,
        destructive=True,
        confirm_prompt="Delete every todo?",
        undoable=False,
        expose=MCP,
    )
    async def clear(input):
        return success({"deleted": 0})

    @server.command(name="todo-list", description="List", expose=MCP)
    async def listing(input):
        return success([])

    return server


def test_destructive_sets_destructive_hint_and_meta():
    tools = {tool["name"]: tool for tool in _trust_server().get_tool_definitions()}
    clear = tools["todo-clear"]
    assert clear["annotations"] == {"readOnlyHint": False, "destructiveHint": True}
    # destructive and undoable are planning signals in _meta; confirmPrompt is display text.
    assert clear["_meta"]["destructive"] is True
    assert clear["_meta"]["undoable"] is False
    assert "confirmPrompt" not in clear["_meta"]
    # Unset fields are omitted, never reported as null.
    assert not {"destructive", "undoable"} & tools["todo-list"]["_meta"].keys()


@pytest.mark.asyncio
async def test_afd_detail_reports_all_three_trust_fields():
    server = _trust_server(tool_strategy="lazy")
    detail = await server.call_tool("afd-detail", {"command": ["todo-clear", "todo-list"]})
    assert detail.success is True
    clear, listing = detail.data
    assert clear["destructive"] is True
    assert clear["confirmPrompt"] == "Delete every todo?"
    assert clear["undoable"] is False
    assert not {"destructive", "confirmPrompt", "undoable"} & listing.keys()
