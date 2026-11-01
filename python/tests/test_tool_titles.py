"""A command's optional ``title`` (spec/command-metadata.md, "Tool titles").

The MCP tool ``title`` of the command's own tool, afd-detail and afd-help (full). Nothing is
derived from the name, grouped tools carry none, and the meta-tools carry fixed titles.
"""

import json
from pathlib import Path

import pytest

from afd import ExposeOptions, success, to_wire
from afd.server import create_server
from afd.server.tools import (
    BatchToolSchema,
    CallToolSchema,
    DetailToolSchema,
    DiscoverToolSchema,
    PipeToolSchema,
)

MCP = ExposeOptions(mcp=True)
SPEC_META_TOOLS = Path(__file__).resolve().parents[2] / "spec" / "meta-tools.json"


def _server(tool_strategy="individual", **options):
    server = create_server("titles", tool_strategy=tool_strategy, **options)

    @server.command(name="todo-create", title="New todo", description="Create a todo", expose=MCP)
    async def create(input):
        return success({})

    @server.command(name="todo-list", description="List todos", expose=MCP)
    async def listing(input):
        return success([])

    return server


def _tools(server):
    return {tool["name"]: tool for tool in server.get_tool_definitions()}


def test_a_commands_own_tool_carries_its_title_and_an_untitled_one_none():
    tools = _tools(_server())
    assert tools["todo-create"]["title"] == "New todo"
    assert "title" not in tools["todo-list"]
    # Display text, never in _meta.
    assert "title" not in tools["todo-create"]["_meta"]


def test_a_first_class_tool_carries_its_title():
    tools = _tools(_server("hybrid", first_class_tools=["todo-create", "todo-list"]))
    assert tools["todo-create"]["title"] == "New todo"
    assert "title" not in tools["todo-list"]


def test_grouped_tools_carry_no_title():
    tools = _tools(_server("grouped"))
    assert "title" not in tools["todo"]
    assert "New todo" not in json.dumps(tools["todo"])


def test_the_meta_tools_match_spec_names_and_titles():
    spec = {tool["name"]: tool["title"] for tool in json.loads(SPEC_META_TOOLS.read_text())}
    python = {
        schema["name"]: schema["title"]
        for schema in (CallToolSchema, BatchToolSchema, PipeToolSchema, DiscoverToolSchema, DetailToolSchema)
    }
    assert python == spec
    # Every strategy lists them with their titles.
    for strategy in ("individual", "grouped", "lazy"):
        tools = _tools(_server(strategy))
        assert {name: tools[name].get("title") for name in spec} == spec


@pytest.mark.asyncio
async def test_afd_detail_reports_the_title_when_set():
    detail = await _server("lazy").call_tool("afd-detail", {"command": ["todo-create", "todo-list"]})
    assert detail.success is True
    titled, untitled = detail.data
    assert titled["title"] == "New todo"
    assert "title" not in untitled


@pytest.mark.asyncio
async def test_afd_help_reports_the_title_in_the_full_format_only():
    server = _server()
    full = to_wire(await server.call_tool("afd-help", {"format": "full"}))
    commands = {command["name"]: command for command in full["data"]["commands"]}
    assert commands["todo-create"]["title"] == "New todo"
    assert "title" not in commands["todo-list"]
    brief = to_wire(await server.call_tool("afd-help", {}))
    assert "title" not in {key for command in brief["data"]["commands"] for key in command}


pytest.importorskip("mcp.client.streamable_http")

from mcp import Client  # noqa: E402

from tests.test_mcp_protocol_live import protocol_server  # noqa: E402


def _titles(listed):
    return {tool.name: tool.title for tool in listed.tools}


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_titles_reach_an_mcp_client_in_process(mode):
    async with Client(_server()._create_mcp_server(), mode=mode) as client:
        titles = _titles(await client.list_tools())
    assert titles["todo-create"] == "New todo"
    assert titles["afd-call"] == "Call a command"
    assert titles["todo-list"] is None


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_titles_reach_an_mcp_client_over_streamable_http(mode):
    async with protocol_server("individual", "streamable-http") as url, Client(url, mode=mode) as client:
        titles = _titles(await client.list_tools())
    assert titles["alpha-run"] == "Run alpha"
    assert titles["afd-detail"] == "Describe commands"
    assert titles["beta-run"] is None
