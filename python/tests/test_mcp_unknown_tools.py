"""FastMCP must return AFD errors and serve the discovery its suggestions name."""

import json

import pytest

from afd import ExposeOptions, success
from afd.server import create_server


@pytest.mark.parametrize("strategy", ["individual", "grouped", "lazy"])
async def test_fastmcp_unknown_and_unexposed_tools_share_structured_error(strategy):
    server = create_server("unknown-tools", tool_strategy=strategy)

    @server.command(
        name="todo-create", description="Create an item", expose=ExposeOptions(mcp=True)
    )
    async def create(value):
        return success(value)

    @server.command(name="private-rotate", description="Private rotation")
    async def private(value):
        return success(value)

    mcp = server._create_mcp_server()
    for name in ("todo-creat", "private-rotate"):
        result = await mcp.call_tool(name, {})
        assert result.isError is True
        payload = json.loads(result.content[0].text)
        assert payload["error"]["code"] == "COMMAND_NOT_FOUND"
        assert payload["error"]["suggestion"]
        assert "private-rotate" not in payload["error"]["suggestion"]
    typo = await mcp.call_tool("todo-creat", {})
    assert "todo-create" in json.loads(typo.content[0].text)["error"]["suggestion"]

    names = {tool.name for tool in await mcp.list_tools()}
    assert {"afd-discover", "afd-detail"} <= names
    discovered = await mcp.call_tool("afd-discover", {})
    assert discovered.isError is False
    assert "private-rotate" not in json.dumps(json.loads(discovered.content[0].text))
    detailed = await mcp.call_tool("afd-detail", {"command": "todo-create"})
    assert detailed.isError is False
