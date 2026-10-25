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
