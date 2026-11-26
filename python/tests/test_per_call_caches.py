"""Per-call schema work is done once (#1760).

A command's input JSON Schema is generated once per Pydantic model, not on every call, and the
MCP tool list is built once per strategy, active context and listed commands, not on every
``tools/list``. ``python/benchmarks/per_call_overhead.py`` times both.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from pydantic import BaseModel, Field

import afd.server.factory as factory_module
from afd import ExposeOptions, success
from afd.server import ContextConfig, create_server
from afd.server.decorators import _advertised_schema, _validation_schema, validate_command_input

MCP = ExposeOptions(mcp=True)


class Item(BaseModel):
    name: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    size: int = 1


def _server(**kwargs: Any) -> Any:
    server = create_server("caches", tool_strategy="individual", **kwargs)

    @server.command(name="item-add", description="Add", input_schema=Item, expose=MCP)
    async def item_add(input: Item) -> Any:
        return success({"name": input.name})

    @server.command(name="plan-make", description="Plan", contexts=["planning"], expose=MCP)
    async def plan_make(input: Any) -> Any:
        return success({})

    return server


class CountingSchema:
    def __init__(self, model: type[BaseModel]) -> None:
        self.calls = 0
        self._original = model.model_json_schema

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.calls += 1
        return self._original(*args, **kwargs)


class TestInputSchemaCache:
    async def test_calls_do_not_regenerate_the_model_schema(self):
        server = _server()
        await server.execute("item-add", {"name": "a"})
        counter = CountingSchema(Item)
        with patch.object(Item, "model_json_schema", counter):
            for _ in range(5):
                result = await server.execute("item-add", {"name": "a", "size": 2})
                assert result.success is True
            invalid = await server.execute("item-add", {"name": ""})
        assert invalid.error.code == "VALIDATION_ERROR"
        assert counter.calls == 0

    def test_one_schema_per_model_shared_by_validation(self):
        assert _validation_schema(Item) is _validation_schema(Item)

    def test_definitions_get_their_own_copy(self):
        advertised = _advertised_schema(Item)
        assert advertised == _validation_schema(Item)
        assert advertised is not _validation_schema(Item)
        advertised["properties"]["name"]["minLength"] = 99
        assert _validation_schema(Item)["properties"]["name"]["minLength"] == 1

    def test_validation_never_changes_the_cached_schema(self):
        before = repr(_validation_schema(Item))
        first = validate_command_input(Item, {"name": "a"})
        first.tags.append("changed")
        second = validate_command_input(Item, {"name": "b"})
        assert second.tags == []
        assert repr(_validation_schema(Item)) == before

    def test_a_rebuilt_model_gets_a_fresh_schema(self):
        class Later(BaseModel):
            value: int

        first = _validation_schema(Later)
        Later.model_rebuild(force=True)
        assert _validation_schema(Later) is not first
        assert _validation_schema(Later) == first

    def test_a_dict_schema_is_used_as_given(self):
        schema = {"type": "object", "properties": {}}
        assert _validation_schema(schema) is schema
        assert _advertised_schema(schema) is schema


class CountingToolsList:
    def __init__(self) -> None:
        self.calls = 0
        self._original = factory_module.get_tools_list

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.calls += 1
        return self._original(*args, **kwargs)


class TestToolListCache:
    def test_repeated_lists_build_once(self):
        server = _server()
        counter = CountingToolsList()
        with patch.object(factory_module, "get_tools_list", counter):
            first = server.get_tool_definitions()
            for _ in range(5):
                assert server.get_tool_definitions() == first
        assert counter.calls == 1

    def test_callers_get_their_own_copy(self):
        server = _server()
        listed = server.get_tool_definitions()
        listed[0]["name"] = "changed"
        listed[0]["inputSchema"]["properties"]["injected"] = {}
        again = server.get_tool_definitions()
        assert again[0]["name"] != "changed"
        assert "injected" not in again[0]["inputSchema"].get("properties", {})

    async def test_each_context_has_its_own_list(self):
        server = _server(contexts=[ContextConfig(name="planning"), ContextConfig(name="review")])

        @server.command(name="review-do", description="Review", contexts=["review"], expose=MCP)
        async def review_do(input: Any) -> Any:
            return success({})

        outside = {tool["name"] for tool in server.get_tool_definitions()}
        entered = await server.execute("afd-context-enter", {"context": "planning"})
        assert entered.success is True
        inside = {tool["name"] for tool in server.get_tool_definitions()}
        assert {"plan-make", "review-do"} <= outside
        assert "plan-make" in inside
        assert "review-do" not in inside
        await server.execute("afd-context-exit", {})
        assert {tool["name"] for tool in server.get_tool_definitions()} == outside

    def test_each_strategy_has_its_own_list(self):
        server = _server()
        individual = {tool["name"] for tool in server.get_tool_definitions()}
        server.config.tool_strategy = "grouped"
        grouped = {tool["name"] for tool in server.get_tool_definitions()}
        assert "item-add" in individual
        assert "item-add" not in grouped and "item" in grouped

    def test_registering_a_command_rebuilds_the_list(self):
        server = _server()
        server.get_tool_definitions()

        @server.command(name="item-drop", description="Drop", expose=MCP)
        async def item_drop(input: Any) -> Any:
            return success({})

        assert "item-drop" in {tool["name"] for tool in server.get_tool_definitions()}

    def test_the_cache_is_bounded(self):
        server = _server()
        server.get_tool_definitions()
        for index in range(factory_module._MAX_TOOL_LISTS + 5):
            server._tool_lists[("filler", index)] = server._tool_lists[
                next(iter(server._tool_lists))
            ]
            if len(server._tool_lists) >= factory_module._MAX_TOOL_LISTS:
                break
        server.config.tool_strategy = "lazy"
        server.get_tool_definitions()
        assert len(server._tool_lists) == 1

    async def test_sdk_tools_list_reuses_the_models(self):
        pytest.importorskip("mcp")
        server = _server()
        sdk = server._create_mcp_server()
        counter = CountingToolsList()
        with patch.object(factory_module, "get_tools_list", counter):
            first = await sdk.list_tools()
            second = await sdk.list_tools()
        assert [tool.name for tool in first] == [tool.name for tool in second]
        assert first[0] is second[0]
        assert counter.calls <= 1


class TestSdkToolSchemas:
    """The schemas the SDK validates Mcp-Param headers against (#1756)."""

    def test_a_command_added_through_the_registry_gets_its_schema(self):
        from afd.core.commands import CommandDefinition

        server = _server()
        server._create_mcp_server()

        async def handler(input: Any, context: Any = None) -> Any:
            return success({})

        schema = {"type": "object", "properties": {"q": {"type": "string"}}}
        server.registry.register(
            CommandDefinition(
                name="item-find",
                description="Find",
                handler=handler,
                input_schema=schema,
                expose=MCP,
            )
        )
        server.get_tool_definitions()
        assert server._sdk_tool_schemas["item-find"] == schema

    def test_extra_schemas_survive_registration(self):
        server = _server()
        server._create_mcp_server()
        alias = {"name": "host-call", "inputSchema": {"type": "object", "required": ["x"]}}
        server._add_tool_input_schemas([alias])
        assert server._sdk_tool_schemas["host-call"] == alias["inputSchema"]

        @server.command(name="item-drop", description="Drop", expose=MCP)
        async def item_drop(input: Any) -> Any:
            return success({})

        assert server._sdk_tool_schemas["host-call"] == alias["inputSchema"]
        assert "item-drop" in server._sdk_tool_schemas

    def test_an_unhashable_group_by_still_caches(self):
        class Grouper:
            __hash__ = None  # type: ignore[assignment]

            def __call__(self, command: Any) -> str:
                return "all"

        server = _server()
        server.config.tool_strategy = "grouped"
        server.config.group_by = Grouper()
        first = server.get_tool_definitions()
        assert server.get_tool_definitions() == first


def test_a_replaced_group_by_is_never_served_a_stale_list():
    server = _server()
    server.config.tool_strategy = "grouped"
    server.config.group_by = lambda command: "first"
    assert "first" in {tool["name"] for tool in server.get_tool_definitions()}
    server.config.group_by = lambda command: "second"
    names = {tool["name"] for tool in server.get_tool_definitions()}
    assert "second" in names and "first" not in names
