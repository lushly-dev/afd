"""Tests for MCP tool strategies, routed built-ins, and context scoping."""

import asyncio

import pytest
from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.server import ContextConfig, create_server


class MathInput(BaseModel):
    value: int


class AddInput(BaseModel):
    a: int
    b: int


class ResultOutput(BaseModel):
    total: int


def _tool_names(server) -> set[str]:
    return {tool["name"] for tool in server.get_mcp_tools()}


class TestToolStrategies:
    def test_individual_strategy_exposes_builtins_bootstrap_and_commands(self):
        server = create_server("test-app", tool_strategy="individual")

        @server.command(
            name="todo-create",
            description="Create a todo item",
            input_schema=MathInput,
            output_schema=ResultOutput,
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input: MathInput):
            return success(ResultOutput(total=input.value))

        tool_names = _tool_names(server)
        assert {"afd-call", "afd-batch", "afd-pipe", "afd-help", "afd-docs", "afd-schema"} <= tool_names
        assert "todo-create" in tool_names

    def test_grouped_strategy_groups_user_commands_but_keeps_bootstrap_direct(self):
        server = create_server("test-app", tool_strategy="grouped")

        @server.command(
            name="todo-create",
            description="Create a todo item",
            input_schema=MathInput,
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input: MathInput):
            return success({"total": input.value})

        @server.command(
            name="todo-list",
            description="List todo items",
            expose=ExposeOptions(mcp=True),
        )
        async def todo_list(input):
            return success({"items": []})

        tool_names = _tool_names(server)
        assert "todo" in tool_names
        assert "todo-create" not in tool_names
        assert "afd-help" in tool_names

    def test_grouped_strategy_prefers_explicit_category(self):
        server = create_server("test-app", tool_strategy="grouped")

        @server.command(
            name="todo-create",
            description="Create a todo item",
            category="planning",
            input_schema=MathInput,
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input: MathInput):
            return success({"total": input.value})

        tool_names = _tool_names(server)
        assert "planning" in tool_names
        assert "todo" not in tool_names

    def test_lazy_strategy_exposes_discovery_tools_and_bootstrap(self):
        server = create_server("test-app", tool_strategy="lazy")

        @server.command(
            name="todo-create",
            description="Create a todo item",
            input_schema=MathInput,
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input: MathInput):
            return success({"total": input.value})

        tool_names = _tool_names(server)
        assert {"afd-discover", "afd-detail", "afd-call", "afd-help", "afd-schema"} <= tool_names
        assert "todo-create" not in tool_names

    @pytest.mark.asyncio
    async def test_grouped_tool_executes_action(self):
        server = create_server("test-app", tool_strategy="grouped")

        @server.command(
            name="todo-create",
            description="Create a todo item",
            input_schema=MathInput,
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input: MathInput):
            return success({"total": input.value})

        result = await server.call_tool("todo", {"action": "create", "params": {"value": 7}})
        assert result.success is True
        assert result.data["total"] == 7


class TestBuiltInRoutedTools:
    @pytest.mark.asyncio
    async def test_routed_tools_apply_middleware(self):
        events: list[str] = []

        async def recording_middleware(command_name, input, context, next_fn):
            events.append(command_name)
            return await next_fn()

        server = create_server("test-app", tool_strategy="grouped", middleware=[recording_middleware])

        @server.command(
            name="math-double",
            description="Double a numeric value",
            input_schema=MathInput,
            expose=ExposeOptions(mcp=True),
        )
        async def math_double(input: MathInput):
            return success({"total": input.value * 2})

        await server.call_tool("afd-call", {"command": "math-double", "input": {"value": 4}})
        await server.call_tool("math", {"action": "double", "params": {"value": 5}})
        await server.call_tool("math-double", {"value": 6})

        assert events == ["math-double", "math-double", "math-double"]

    @pytest.mark.asyncio
    async def test_afd_call_available_in_lazy_strategy(self):
        server = create_server("test-app", tool_strategy="lazy")

        @server.command(
            name="math-double",
            description="Double a numeric value",
            input_schema=MathInput,
            output_schema=ResultOutput,
            expose=ExposeOptions(mcp=True),
        )
        async def math_double(input: MathInput):
            return success(ResultOutput(total=input.value * 2))

        result = await server.call_tool(
            "afd-call",
            {"command": "math-double", "input": {"value": 4}},
        )
        assert result.success is True
        assert result.data.total == 8

    @pytest.mark.asyncio
    async def test_afd_batch_executes_multiple_commands(self):
        server = create_server("test-app", tool_strategy="lazy")

        @server.command(
            name="math-double",
            description="Double a numeric value",
            input_schema=MathInput,
            output_schema=ResultOutput,
            expose=ExposeOptions(mcp=True),
        )
        async def math_double(input: MathInput):
            return success(ResultOutput(total=input.value * 2))

        result = await server.call_tool(
            "afd-batch",
            {
                "commands": [
                    {"command": "math-double", "input": {"value": 2}},
                    {"command": "math-double", "input": {"value": 3}},
                ]
            },
        )
        assert result.success is True
        assert len(result.results) == 2
        assert result.results[0].result.data.total == 4
        assert result.results[1].result.data.total == 6

    @pytest.mark.asyncio
    async def test_afd_batch_bounds_parallelism_and_preserves_order(self):
        server = create_server("test-app", tool_strategy="lazy")
        active = 0
        peak = 0

        @server.command(
            name="work-run",
            description="Run controlled work",
            input_schema=MathInput,
            expose=ExposeOptions(mcp=True),
        )
        async def work_run(input: MathInput):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1
            return success({"value": input.value})

        result = await server.call_tool(
            "afd-batch",
            {
                "commands": [
                    {"id": f"request-{value}", "command": "work-run", "input": {"value": value}}
                    for value in range(4)
                ],
                "options": {"parallelism": 2},
            },
        )

        assert peak == 2
        assert [item.id for item in result.results] == [
            "request-0",
            "request-1",
            "request-2",
            "request-3",
        ]

    @pytest.mark.asyncio
    async def test_afd_pipe_executes_pipeline(self):
        server = create_server("test-app", tool_strategy="lazy")

        @server.command(
            name="math-add",
            description="Add two values",
            input_schema=AddInput,
            expose=ExposeOptions(mcp=True),
        )
        async def math_add(input: AddInput):
            return success({"total": input.a + input.b})

        @server.command(
            name="math-double",
            description="Double a numeric value",
            input_schema=MathInput,
            expose=ExposeOptions(mcp=True),
        )
        async def math_double(input: MathInput):
            return success({"total": input.value * 2})

        result = await server.call_tool(
            "afd-pipe",
            {
                "steps": [
                    {"command": "math-add", "input": {"a": 2, "b": 3}},
                    {"command": "math-double", "input": {"value": "$prev.total"}},
                ]
            },
        )
        assert result.data == {"total": 10}
        assert len(result.steps) == 2

    @pytest.mark.asyncio
    async def test_lazy_discover_and_detail_return_command_metadata(self):
        server = create_server("test-app", tool_strategy="lazy")

        @server.command(
            name="todo-create",
            description="Create a todo item",
            input_schema=MathInput,
            output_schema=ResultOutput,
            requires=["session-open"],
            contexts=["editing"],
            examples=[{"title": "Basic", "input": {"value": 1}}],
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input: MathInput):
            return success(ResultOutput(total=input.value))

        discover = await server.call_tool("afd-discover", {"includeMutation": True})
        assert discover.success is True
        assert any(item["name"] == "todo-create" for item in discover.data["commands"])

        detail = await server.call_tool("afd-detail", {"command": "todo-create"})
        assert detail.success is True
        assert detail.data[0]["found"] is True
        assert detail.data[0]["requires"] == ["session-open"]
        assert detail.data[0]["contexts"] == ["editing"]
        assert detail.data[0]["outputSchema"]["properties"]["total"]["type"] == "integer"

    @pytest.mark.asyncio
    async def test_lazy_detail_accepts_multiple_commands(self):
        server = create_server("test-app", tool_strategy="lazy")

        @server.command(
            name="todo-create",
            description="Create a todo item",
            input_schema=MathInput,
            output_schema=ResultOutput,
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input: MathInput):
            return success(ResultOutput(total=input.value))

        @server.command(
            name="todo-list",
            description="List todo items",
            expose=ExposeOptions(mcp=True),
        )
        async def todo_list(input):
            return success({"items": []})

        detail = await server.call_tool("afd-detail", {"command": ["todo-create", "todo-list"]})
        assert detail.success is True
        assert [item["name"] for item in detail.data] == ["todo-create", "todo-list"]


class TestContextScoping:
    @pytest.mark.asyncio
    async def test_context_commands_are_exposed_when_configured(self):
        server = create_server(
            "test-app",
            tool_strategy="lazy",
            contexts=[ContextConfig(name="editing"), ContextConfig(name="reviewing")],
        )
        tool_names = _tool_names(server)
        assert {"afd-context-list", "afd-context-enter", "afd-context-exit"} <= tool_names

    @pytest.mark.asyncio
    async def test_commands_outside_active_context_are_hidden_and_rejected(self):
        server = create_server(
            "test-app",
            tool_strategy="lazy",
            contexts=[ContextConfig(name="editing"), ContextConfig(name="reviewing")],
        )

        @server.command(
            name="doc-edit",
            description="Edit a document",
            contexts=["editing"],
            expose=ExposeOptions(mcp=True),
        )
        async def doc_edit(input):
            return success({"ok": True})

        @server.command(
            name="doc-list",
            description="List documents",
            expose=ExposeOptions(mcp=True),
        )
        async def doc_list(input):
            return success({"items": []})

        enter = await server.call_tool("afd-context-enter", {"context": "reviewing"})
        assert enter.success is True

        discover = await server.call_tool("afd-discover", {})
        names = [item["name"] for item in discover.data["commands"]]
        assert "doc-list" in names
        assert "doc-edit" not in names

        call_result = await server.call_tool("afd-call", {"command": "doc-edit", "input": {}})
        assert call_result.success is False
        assert call_result.error.code == "COMMAND_NOT_IN_CONTEXT"

    @pytest.mark.asyncio
    async def test_grouped_tools_return_context_error_when_group_is_hidden(self):
        server = create_server(
            "test-app",
            tool_strategy="grouped",
            contexts=[ContextConfig(name="editing"), ContextConfig(name="reviewing")],
        )

        @server.command(
            name="doc-edit",
            description="Edit a document",
            contexts=["editing"],
            expose=ExposeOptions(mcp=True),
        )
        async def doc_edit(input):
            return success({"ok": True})

        await server.call_tool("afd-context-enter", {"context": "reviewing"})
        result = await server.call_tool("doc", {"action": "edit", "params": {}})

        assert result.success is False
        assert result.error.code == "COMMAND_NOT_IN_CONTEXT"


class TestFastMcpRegistration:
    @pytest.mark.asyncio
    async def test_create_mcp_server_registers_flat_schema_and_meta(self):
        server = create_server("test-app", tool_strategy="individual")

        @server.command(
            name="todo-create",
            description="Create a todo item",
            input_schema=MathInput,
            output_schema=ResultOutput,
            requires=["session-open"],
            contexts=["editing"],
            examples=[{"title": "Basic", "input": {"value": 1}}],
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input: MathInput):
            return success(ResultOutput(total=input.value))

        mcp = server._create_mcp_server()
        tools = await mcp.list_tools()
        todo_create_tool = next(tool for tool in tools if tool.name == "todo-create")
        tool_payload = todo_create_tool.model_dump(by_alias=True)

        assert "value" in todo_create_tool.input_schema["properties"]
        assert "input" not in todo_create_tool.input_schema["properties"]
        assert tool_payload["_meta"]["requires"] == ["session-open"]
        assert tool_payload["_meta"]["contexts"] == ["editing"]
        assert tool_payload["_meta"]["outputSchema"]["properties"]["total"]["type"] == "integer"

    @pytest.mark.asyncio
    async def test_context_changes_refresh_live_mcp_tool_registry(self):
        server = create_server(
            "test-app",
            tool_strategy="individual",
            contexts=[ContextConfig(name="editing"), ContextConfig(name="reviewing")],
        )

        @server.command(
            name="doc-edit",
            description="Edit a document",
            contexts=["editing"],
            expose=ExposeOptions(mcp=True),
        )
        async def doc_edit(input):
            return success({"ok": True})

        mcp = server._create_mcp_server()
        before_names = {tool.name for tool in await mcp.list_tools()}
        assert "doc-edit" in before_names

        enter = await server.call_tool("afd-context-enter", {"context": "reviewing"})
        assert enter.success is True

        after_names = {tool.name for tool in await mcp.list_tools()}
        assert "doc-edit" not in after_names
