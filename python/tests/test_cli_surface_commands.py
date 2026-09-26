"""Tests for the commands ``afd validate --surface`` evaluates, per tool strategy."""

from typing import Any

import pytest
from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.cli.main import _load_surface_commands
from afd.cli.surface_commands import collect_surface_commands, is_opaque_grouped_tool
from afd.core.builtin_names import BUILTIN_TOOL_NAMES, META_TOOL_NAMES
from afd.server import create_server
from afd.server.factory import META_TOOL_NAMES as SERVER_META_TOOL_NAMES
from afd.testing.surface.validate import validate_command_surface
from afd.transports.base import ToolInfo


class TitleInput(BaseModel):
    title: str


class IdInput(BaseModel):
    id: str


class ServerTransport:
    """A transport over an in-process Python AFD server."""

    def __init__(self, server: Any) -> None:
        self.server = server
        self.calls: list[str] = []

    async def list_tools(self) -> list[ToolInfo]:
        return [
            ToolInfo(
                name=tool["name"],
                description=tool.get("description", ""),
                input_schema=tool.get("inputSchema"),
                meta=tool.get("_meta"),
            )
            for tool in self.server.get_mcp_tools()
        ]

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        self.calls.append(name)
        result = await self.server.call_tool(name, arguments or {})
        return result.model_dump(mode="json")


class FakeTransport:
    """A transport serving a fixed tool listing plus afd-discover and afd-detail."""

    def __init__(self, tools: list[ToolInfo], commands: list[str] | None = None, page_size: int = 200):
        self.tools = tools
        self.commands = commands or []
        self.page_size = page_size
        self.calls: list[str] = []

    async def list_tools(self) -> list[ToolInfo]:
        return self.tools

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        self.calls.append(name)
        arguments = arguments or {}
        if name == "afd-discover":
            offset = arguments.get("offset", 0)
            page = self.commands[offset : offset + self.page_size]
            return {
                "success": True,
                "data": {
                    "commands": [{"name": command} for command in page],
                    "hasMore": offset + self.page_size < len(self.commands),
                },
            }
        if name == "afd-detail":
            assert len(arguments["command"]) <= 10
            return {
                "success": True,
                "data": [
                    {
                        "name": command,
                        "found": True,
                        "description": f"Run the {command} operation on stored items",
                        "category": command.split("-")[0],
                        "inputSchema": {"type": "object", "properties": {}},
                    }
                    for command in arguments["command"]
                ],
            }
        return {"success": False, "error": {"code": "COMMAND_NOT_FOUND", "message": "Unknown tool"}}


def _quickstart_server(strategy: str):
    server = create_server("todo", tool_strategy=strategy)

    @server.command(
        name="todo-create",
        description="Create a todo item from a title",
        category="todo",
        input_schema=TitleInput,
        expose=ExposeOptions(mcp=True, cli=True),
    )
    async def todo_create(input: TitleInput):
        return success({"id": "1", "title": input.title})

    @server.command(
        name="todo-get",
        description="Get a todo item by its id",
        category="todo",
        input_schema=IdInput,
        expose=ExposeOptions(mcp=True, cli=True),
    )
    async def todo_get(input: IdInput):
        return success({"id": input.id, "title": "Buy milk"})

    return server


def _builtin(name: str) -> ToolInfo:
    return ToolInfo(name=name, description=f"{name} built-in", input_schema={"type": "object"})


def _names(commands: list[dict[str, Any]]) -> list[str]:
    return [command["name"] for command in commands]


def _misattributed(commands: list[dict[str, Any]]) -> list[Any]:
    result = validate_command_surface(commands)
    return [
        finding
        for finding in result.findings
        if any(name == "todo" or name.startswith("afd-") for name in finding.commands)
    ]


# A grouped tool as a TypeScript server lists it, with each command in _meta.actions.
TS_GROUPED_TOOL = ToolInfo(
    name="todo",
    description="todo operations: create, get",
    input_schema={
        "type": "object",
        "properties": {"action": {"type": "string", "enum": ["create", "get"]}, "params": {"type": "object"}},
        "required": ["action"],
    },
    meta={
        "actions": [
            {
                "action": "create",
                "command": "todo-create",
                "description": "Create a todo item from a title",
                "category": "todo",
                "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}},
            },
            {
                "action": "get",
                "command": "todo-get",
                "description": "Get a todo item by its id",
                "category": "todo",
                "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}},
            },
        ]
    },
)

# The same tool as a server that does not list its actions advertises it.
OPAQUE_GROUPED_TOOL = ToolInfo(
    name=TS_GROUPED_TOOL.name,
    description=TS_GROUPED_TOOL.description,
    input_schema=TS_GROUPED_TOOL.input_schema,
)


def test_builtin_names_match_the_server():
    assert META_TOOL_NAMES == SERVER_META_TOOL_NAMES
    assert {"afd-help", "afd-docs", "afd-schema", "afd-context-list"} <= BUILTIN_TOOL_NAMES


@pytest.mark.asyncio
@pytest.mark.parametrize("strategy", ["individual", "grouped", "lazy"])
async def test_python_server_surface_is_its_commands(strategy):
    transport = ServerTransport(_quickstart_server(strategy))

    commands, _contexts, warnings = await _load_surface_commands(transport)

    assert _names(commands) == ["todo-create", "todo-get"]
    assert commands[0]["category"] == "todo"
    assert warnings == []
    assert _misattributed(commands) == []


@pytest.mark.asyncio
async def test_typescript_grouped_server_expands_meta_actions():
    transport = FakeTransport([_builtin("afd-batch"), _builtin("afd-detail"), TS_GROUPED_TOOL])

    commands, warnings = await collect_surface_commands(transport, await transport.list_tools())

    assert _names(commands) == ["todo-create", "todo-get"]
    assert commands[1]["jsonSchema"] == {"type": "object", "properties": {"id": {"type": "string"}}}
    assert transport.calls == []
    assert warnings == []
    assert _misattributed(commands) == []


@pytest.mark.asyncio
async def test_typescript_individual_server_skips_builtin_tools():
    tools = [
        _builtin("afd-call"),
        ToolInfo(
            name="todo-create",
            description="Create a todo item from a title",
            input_schema={"type": "object"},
            meta={"category": "todo"},
        ),
    ]
    commands, _warnings = await collect_surface_commands(FakeTransport(tools), tools)

    assert _names(commands) == ["todo-create"]
    assert commands[0]["category"] == "todo"


@pytest.mark.asyncio
async def test_lazy_server_is_enumerated_with_discover_and_detail():
    names = [f"item-op{index}" for index in range(25)]
    transport = FakeTransport([_builtin("afd-discover"), _builtin("afd-detail")], ["afd-help", *names], 10)

    commands, warnings = await collect_surface_commands(transport, await transport.list_tools())

    assert _names(commands) == names
    assert transport.calls.count("afd-discover") == 3
    assert transport.calls.count("afd-detail") == 3
    assert warnings == []


@pytest.mark.asyncio
async def test_grouped_tools_without_actions_are_enumerated():
    transport = FakeTransport([_builtin("afd-pipe"), OPAQUE_GROUPED_TOOL], ["todo-create", "todo-get"])

    assert is_opaque_grouped_tool(OPAQUE_GROUPED_TOOL)
    assert not is_opaque_grouped_tool(TS_GROUPED_TOOL)
    commands, _warnings = await collect_surface_commands(transport, await transport.list_tools())

    assert _names(commands) == ["todo-create", "todo-get"]


@pytest.mark.asyncio
async def test_discovery_failure_falls_back_to_the_tool_with_a_warning():
    transport = FakeTransport([OPAQUE_GROUPED_TOOL])

    async def failing_call(name: str, arguments: dict[str, Any] | None = None) -> Any:
        return {"success": False, "error": {"message": "Unknown tool"}}

    transport.call_tool = failing_call  # type: ignore[method-assign]
    commands, warnings = await collect_surface_commands(transport, await transport.list_tools())

    assert _names(commands) == ["todo"]
    assert len(warnings) == 1
    assert "afd-discover failed: Unknown tool" in warnings[0]


@pytest.mark.asyncio
async def test_bootstrap_help_path_skips_builtin_commands():
    tools = [_builtin("afd-help"), _builtin("afd-schema")]
    transport = FakeTransport(tools)

    async def call_tool(name: str, arguments: dict[str, Any] | None = None) -> Any:
        if name == "afd-help":
            return {
                "data": {
                    "commands": [
                        {"name": "afd-help", "description": "List commands", "category": "bootstrap"},
                        {"name": "todo-create", "description": "Create a todo item", "category": "todo"},
                    ]
                }
            }
        return {"data": {"schemas": []}}

    transport.call_tool = call_tool  # type: ignore[method-assign]
    commands, _contexts, _warnings = await _load_surface_commands(transport)

    assert _names(commands) == ["todo-create"]
