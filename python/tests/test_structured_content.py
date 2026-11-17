"""MCP tool results carry the CommandResult as ``structuredContent``, and command tools
advertise the CommandResult envelope as a top-level ``outputSchema``
(``spec/command-metadata.md``, "Structured results"), checked with the MCP Python SDK
client, which validates ``structuredContent`` against ``outputSchema``."""

import json

import pytest
from pydantic import BaseModel, ConfigDict, Field, computed_field

pytest.importorskip("mcp")

from mcp import Client  # noqa: E402

from afd import ExposeOptions, command_result_output_schema, failure, success  # noqa: E402
from afd.core.errors import CommandError  # noqa: E402
from afd.server import create_server  # noqa: E402

MCP = ExposeOptions(mcp=True)


class TodoInput(BaseModel):
    id: str


class Todo(BaseModel):
    id: str
    title: str


class Tag(BaseModel):
    name: str


class TaggedTodo(BaseModel):
    id: str
    tags: list[Tag]


class Note(BaseModel):
    """Output whose wire form differs from its input form."""

    model_config = ConfigDict(extra="forbid")

    id: str
    text: str | None  # required, but omitted from the wire when None
    created_at: int = Field(serialization_alias="createdAt")

    @computed_field
    @property
    def label(self) -> str:
        return f"note {self.id}"


def _server(**options):
    server = create_server("surface", **options)

    @server.command(
        name="todo-get",
        description="Get a todo",
        input_schema=TodoInput,
        output_schema=Todo,
        expose=MCP,
    )
    async def get(input: TodoInput):
        if input.id == "missing":
            return failure(
                CommandError(code="NOT_FOUND", message="No such todo", suggestion="List todos first")
            )
        return success(Todo(id=input.id, title="Milk"))

    @server.command(
        name="todo-tagged",
        description="Get a todo with its tags",
        output_schema=TaggedTodo,
        expose=MCP,
    )
    async def tagged(input):
        return success(TaggedTodo(id="t1", tags=[Tag(name="home")]))

    @server.command(name="note-get", description="Get a note", output_schema=Note, expose=MCP)
    async def note(input):
        return success(Note(id="n1", text=None, created_at=1))

    @server.command(name="todo-purge", description="Delete every todo", mutation=True, expose=MCP)
    async def purge(input):
        return success({"deleted": 3})

    return server


async def _tools(client):
    return {tool.name: tool for tool in (await client.list_tools()).tools}


async def test_advertises_the_command_result_envelope_and_satisfies_it():
    async with Client(_server()._create_mcp_server()) as client:
        tools = await _tools(client)
        schema = tools["todo-get"].output_schema
        assert schema["required"] == ["success"]
        assert schema["properties"]["data"]["required"] == ["id", "title"]
        assert tools["todo-purge"].output_schema is None
        assert tools["afd-call"].output_schema is None

        # The SDK client validates a successful result against outputSchema itself.
        found = await client.call_tool("todo-get", {"id": "t1"})
        assert found.is_error is False
        assert found.structured_content["success"] is True
        assert found.structured_content["data"] == {"id": "t1", "title": "Milk"}
        assert json.loads(found.content[0].text) == found.structured_content

        # The client skips isError results, so the failure is validated explicitly.
        missing = await client.call_tool("todo-get", {"id": "missing"})
        assert missing.is_error is True
        assert missing.structured_content["success"] is False
        assert missing.structured_content["error"]["code"] == "NOT_FOUND"
        await client.session.validate_tool_result("todo-get", missing)


async def test_nested_models_resolve_against_the_envelope():
    async with Client(_server()._create_mcp_server()) as client:
        schema = (await _tools(client))["todo-tagged"].output_schema
        assert "Tag" in schema["$defs"] and "$defs" not in schema["properties"]["data"]
        result = await client.call_tool("todo-tagged", {})
        assert result.structured_content["data"] == {"id": "t1", "tags": [{"name": "home"}]}


async def test_the_schema_describes_the_data_as_sent():
    # Serialization aliases, computed fields and omitted None fields all validate.
    async with Client(_server()._create_mcp_server()) as client:
        data = (await _tools(client))["note-get"].output_schema["properties"]["data"]
        assert set(data["required"]) == {"id", "createdAt", "label"}
        result = await client.call_tool("note-get", {})
        assert result.is_error is False
        assert result.structured_content["data"] == {"id": "n1", "createdAt": 1, "label": "note n1"}


@pytest.mark.parametrize("strategy", ["grouped", "lazy"])
async def test_grouped_and_lazy_tools_carry_no_output_schema(strategy):
    async with Client(_server(tool_strategy=strategy)._create_mcp_server()) as client:
        assert all(tool.output_schema is None for tool in (await _tools(client)).values())
        called = await client.call_tool("afd-call", {"command": "todo-get", "input": {"id": "t3"}})
        assert called.structured_content["data"]["id"] == "t3"


async def test_sends_structured_content_from_every_tool():
    async with Client(_server()._create_mcp_server()) as client:
        purged = await client.call_tool("todo-purge", {})
        assert purged.structured_content["data"] == {"deleted": 3}
        called = await client.call_tool("afd-call", {"command": "todo-get", "input": {"id": "t2"}})
        assert called.structured_content["data"]["id"] == "t2"
        batch = await client.call_tool(
            "afd-batch", {"commands": [{"command": "todo-purge", "input": {}}]}
        )
        assert batch.structured_content["summary"]["successCount"] == 1
        unknown = await client.call_tool("afd-call", {"command": "todo-nope", "input": {}})
        assert unknown.is_error is True
        assert unknown.structured_content["error"]["code"] == "COMMAND_NOT_FOUND"


async def test_lists_output_schema_on_hybrid_first_class_tools():
    server = _server(tool_strategy="hybrid", first_class_tools=["todo-get"])
    async with Client(server._create_mcp_server()) as client:
        tools = await _tools(client)
        assert tools["todo-get"].output_schema["properties"]["data"]["required"] == ["id", "title"]
        found = await client.call_tool("todo-get", {"id": "t1"})
        assert found.structured_content["data"]["title"] == "Milk"


async def test_can_switch_the_top_level_output_schema_off():
    async with Client(_server(advertise_output_schema=False)._create_mcp_server()) as client:
        tool = (await _tools(client))["todo-get"]
        assert tool.output_schema is None
        assert tool.meta["outputSchema"]["required"] == ["id", "title"]
        found = await client.call_tool("todo-get", {"id": "t1"})
        assert found.structured_content["success"] is True


def test_envelope_keeps_a_schema_without_defs_unchanged():
    schema = command_result_output_schema(
        {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object"}
    )
    assert schema["properties"]["data"] == {"type": "object"}
    assert "$defs" not in schema


def test_envelope_moves_definitions_and_relaxes_nullable_requirements():
    schema = command_result_output_schema(
        {
            "type": "object",
            "properties": {"a": {"$ref": "#/definitions/A"}, "b": {"type": ["string", "null"]}},
            "required": ["a", "b"],
            "definitions": {
                "A": {
                    "type": "object",
                    "properties": {"n": {"anyOf": [{"type": "integer"}, {"type": "null"}]}},
                    "required": ["n"],
                }
            },
        }
    )
    assert schema["properties"]["data"]["required"] == ["a"]
    assert "required" not in schema["definitions"]["A"]
    assert "definitions" not in schema["properties"]["data"]
