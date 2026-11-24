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
        server = create_server("test-app", tool_strategy="individual", bootstrap=True)

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
        assert {
            "afd-call",
            "afd-batch",
            "afd-pipe",
            "afd-help",
            "afd-docs",
            "afd-schema",
        } <= tool_names
        assert "todo-create" in tool_names

    def test_grouped_strategy_lists_the_meta_tools_then_the_groups(self):
        server = create_server("test-app", tool_strategy="grouped", bootstrap=True)

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

        # The five meta-tools in the hybrid order, then each group in the order of its first
        # command, the bootstrap commands among them (spec/tool-strategies.md, #533).
        tools = server.get_tool_definitions()
        assert [tool["name"] for tool in tools] == [
            "afd-discover",
            "afd-detail",
            "afd-call",
            "afd-batch",
            "afd-pipe",
            "todo",
            "bootstrap",
        ]
        todo = tools[5]
        assert todo["inputSchema"]["properties"]["action"]["enum"] == ["create", "list"]
        assert [entry["command"] for entry in todo["_meta"]["actions"]] == [
            "todo-create",
            "todo-list",
        ]
        branches = todo["inputSchema"]["properties"]["params"]["anyOf"]
        assert [branch["title"] for branch in branches] == ["create", "list"]
        assert tools[6]["inputSchema"]["properties"]["action"]["enum"] == ["help", "docs", "schema"]

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

    def test_lazy_strategy_lists_the_meta_tools_only_without_contexts(self):
        server = create_server("test-app", tool_strategy="lazy")

        @server.command(
            name="todo-create",
            description="Create a todo item",
            input_schema=MathInput,
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input: MathInput):
            return success({"total": input.value})

        # The hybrid list with no first-class tools: no bootstrap tools, and no context tools
        # without contexts (#533).
        assert [tool["name"] for tool in server.get_tool_definitions()] == [
            "afd-discover",
            "afd-detail",
            "afd-call",
            "afd-batch",
            "afd-pipe",
        ]

    def test_lazy_strategy_adds_the_context_tools_with_contexts(self):
        server = create_server(
            "test-app",
            tool_strategy="lazy",
            contexts=[ContextConfig(name="reading"), ContextConfig(name="editing")],
        )
        assert [tool["name"] for tool in server.get_tool_definitions()] == [
            "afd-discover",
            "afd-detail",
            "afd-call",
            "afd-batch",
            "afd-pipe",
            "afd-context-list",
            "afd-context-enter",
            "afd-context-exit",
        ]

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

        server = create_server(
            "test-app", tool_strategy="grouped", middleware=[recording_middleware]
        )

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
        assert detail.data[0]["examples"] == [{"title": "Basic", "input": {"value": 1}}]
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
        # Unset, the lists are omitted, as in the other languages (#1420).
        assert not {"requires", "contexts", "examples", "tags", "errors"} & detail.data[1].keys()

    @pytest.mark.asyncio
    async def test_lazy_detail_reports_declared_tags(self):
        server = create_server("test-app", tool_strategy="lazy")

        @server.command(
            name="todo-list",
            description="List todo items",
            tags=["read"],
            expose=ExposeOptions(mcp=True),
        )
        async def todo_list(input):
            return success({"items": []})

        detail = await server.call_tool("afd-detail", {"command": "todo-list"})
        assert detail.data[0]["tags"] == ["read"]

    def test_lazy_detail_reports_declared_errors(self):
        from afd.core.commands import CommandDefinition
        from afd.server.lazy_tools import execute_detail

        async def handler(input, context=None):
            return success(None)

        declared = CommandDefinition(
            name="todo-get", description="Get a todo", handler=handler, errors=["NOT_FOUND"]
        )
        empty = CommandDefinition(
            name="todo-list", description="List todos", handler=handler, errors=[], tags=[]
        )
        detail = execute_detail(
            [declared, empty], {"todo-get", "todo-list"}, {"command": ["todo-get", "todo-list"]}
        )
        assert detail.data[0]["errors"] == ["NOT_FOUND"]
        assert not {"tags", "errors"} & detail.data[1].keys()


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


def test_the_meta_tools_are_spec_meta_tools_json_field_for_field():
    """Every language advertises the same meta-tools (spec/tool-strategies.md, #533)."""
    import json
    from pathlib import Path

    from afd.server.tools import META_TOOLS

    spec = json.loads(
        (Path(__file__).resolve().parents[2] / "spec" / "meta-tools.json").read_text(
            encoding="utf-8"
        )
    )
    by_name = {tool["name"]: tool for tool in spec}
    assert [tool["name"] for tool in META_TOOLS] == [
        "afd-discover",
        "afd-detail",
        "afd-call",
        "afd-batch",
        "afd-pipe",
    ]
    for tool in META_TOOLS:
        assert tool == by_name[tool["name"]], tool["name"]


def test_grouped_confirm_is_beside_action_never_in_params():
    """TypeScript's shape: a confirm-gated group takes `confirm` at its top level, and neither
    `_meta.actions` nor the `params.anyOf` branches carry it (#533)."""
    server = create_server("test-app", confirmations="enforce")

    @server.command(
        name="todo-clear",
        description="Clear todos",
        confirm_prompt="Clear every todo?",
        expose=ExposeOptions(mcp=True),
    )
    async def todo_clear(input):
        return success({"cleared": 0})

    todo = next(tool for tool in server.get_tool_definitions() if tool["name"] == "todo")
    properties = todo["inputSchema"]["properties"]
    assert "confirm" in properties
    entry = todo["_meta"]["actions"][0]
    assert "confirm" not in (entry["inputSchema"].get("properties") or {})
    for branch in properties["params"]["anyOf"]:
        assert "confirm" not in (branch.get("properties") or {})


def test_the_bootstrap_group_lists_the_context_tools_first():
    server = create_server(
        "test-app",
        contexts=[ContextConfig(name="reading"), ContextConfig(name="editing")],
        bootstrap=True,
    )
    bootstrap = next(tool for tool in server.get_tool_definitions() if tool["name"] == "bootstrap")
    assert bootstrap["inputSchema"]["properties"]["action"]["enum"] == [
        "context-list",
        "context-enter",
        "context-exit",
        "help",
        "docs",
        "schema",
    ]


BOOTSTRAP_TOOLS = {"afd-help", "afd-docs", "afd-schema"}


@pytest.mark.parametrize("strategy", ["individual", "grouped", "lazy"])
def test_bootstrap_tools_are_opt_in(strategy):
    """Parity decision D5: as TypeScript's ``bootstrap`` option, off by default."""
    default = create_server("test-app", tool_strategy=strategy)
    assert not BOOTSTRAP_TOOLS & set(default._get_command_index())
    assert not BOOTSTRAP_TOOLS & _tool_names(default)

    opted_in = create_server("test-app", tool_strategy=strategy, bootstrap=True)
    assert set(opted_in._get_command_index()) >= BOOTSTRAP_TOOLS


def test_a_first_class_bootstrap_tool_needs_bootstrap():
    server = create_server("test-app", tool_strategy="hybrid", first_class_tools=["afd-help"])

    with pytest.raises(ValueError, match="Set bootstrap=True to register it"):
        server.get_mcp_tools()

    opted_in = create_server(
        "test-app", tool_strategy="hybrid", first_class_tools=["afd-help"], bootstrap=True
    )
    assert "afd-help" in _tool_names(opted_in)


def test_get_bootstrap_commands_can_leave_out_the_discovery_commands():
    from afd.server.bootstrap import get_bootstrap_commands

    names = [command.name for command in get_bootstrap_commands(list)]
    assert names == ["afd-help", "afd-docs", "afd-schema"]
    assert get_bootstrap_commands(list, {"include_discovery": False}) == []


@pytest.mark.asyncio
async def test_afd_help_is_not_found_without_bootstrap():
    server = create_server("test-app", tool_strategy="individual")

    result = await server.call_tool("afd-help", {})

    assert result.success is False
    assert result.error.code == "COMMAND_NOT_FOUND"


def test_context_tools_do_not_need_bootstrap():
    server = create_server(
        "test-app", contexts=[ContextConfig(name="reading")], tool_strategy="individual"
    )

    names = _tool_names(server)
    assert {"afd-context-list", "afd-context-enter", "afd-context-exit"} <= names
    assert not BOOTSTRAP_TOOLS & names


def test_default_instructions_name_the_bootstrap_tools_only_when_registered():
    from afd.server.factory import default_instructions

    sentence = "afd-help, afd-docs and afd-schema describe this server."
    assert sentence not in default_instructions("srv", "grouped", [])
    with_bootstrap = default_instructions("srv", "grouped", [ContextConfig(name="a")], True)
    # spec/tool-strategies.md: the bootstrap sentence comes before the contexts sentence.
    assert sentence in with_bootstrap
    assert with_bootstrap.index(sentence) < with_bootstrap.index("Commands are scoped by context")


def test_command_tools_carry_the_category_in_meta():
    server = create_server("test-app", tool_strategy="individual")

    @server.command(
        name="todo-create",
        description="Create a todo item",
        category="todo",
        input_schema=MathInput,
        expose=ExposeOptions(mcp=True),
    )
    async def todo_create(input: MathInput):
        return success({"total": input.value})

    tool = next(tool for tool in server.get_mcp_tools() if tool["name"] == "todo-create")
    assert tool["_meta"]["category"] == "todo"
    assert next(iter(tool["_meta"])) == "category"


def test_advertised_instructions_follow_bootstrap_and_keep_a_hosts_empty_string():
    sentence = "afd-help, afd-docs and afd-schema describe this server."
    assert sentence not in create_server("srv")._create_mcp_server().instructions
    assert sentence in create_server("srv", bootstrap=True)._create_mcp_server().instructions
    # TypeScript keeps a host's instructions, even "", with `??`.
    empty = create_server("srv", bootstrap=True, instructions="")
    assert empty._create_mcp_server().instructions == ""


@pytest.mark.parametrize(("category", "expected"), [("", {"category": ""}), (None, {})])
def test_an_empty_category_is_kept_and_a_missing_one_left_out(category, expected):
    from afd.core.commands import CommandDefinition, command_to_mcp_tool

    async def handler(input, context=None):
        return success({})

    meta = command_to_mcp_tool(
        CommandDefinition(
            name="todo-create", description="Create", handler=handler, category=category
        )
    )["_meta"]
    assert {key: meta[key] for key in meta if key == "category"} == expected


def _register(server, name):
    @server.command(name=name, description="A command with a built-in's name")
    async def handler(input):
        return success({"mine": True})


@pytest.mark.parametrize("name", sorted(BOOTSTRAP_TOOLS))
def test_bootstrap_names_are_reserved_only_with_bootstrap(name):
    """#1731, as TypeScript's assertValidCommandNames: with bootstrap=True a command of the
    same name would shadow the built-in, so registering it raises."""
    with pytest.raises(ValueError, match=f"Command name '{name}' is reserved: bootstrap=True"):
        _register(create_server("test-app", bootstrap=True), name)

    plain = create_server("test-app")
    _register(plain, name)
    assert plain._get_command_index()[name].description == "A command with a built-in's name"


async def test_without_bootstrap_a_command_named_afd_help_runs_as_itself():
    server = create_server("test-app")
    _register(server, "afd-help")
    result = await server.execute("afd-help", {})
    assert result.success is True
    assert result.data == {"mine": True}


@pytest.mark.parametrize("name", ["afd-context-list", "afd-context-enter", "afd-context-exit"])
def test_context_names_are_reserved_only_with_contexts(name):
    with pytest.raises(ValueError, match=f"Command name '{name}' is reserved: contexts"):
        _register(create_server("test-app", contexts=[ContextConfig(name="alpha")]), name)

    plain = create_server("test-app")
    _register(plain, name)
    assert name in {command.name for command in plain.list_commands()}


def test_a_refused_name_leaves_nothing_registered():
    server = create_server("test-app", bootstrap=True)
    with pytest.raises(ValueError):
        _register(server, "afd-help")
    assert "afd-help" not in {command.name for command in server.list_commands()}
    assert server._get_command_index()["afd-help"].description != "A command with a built-in's name"


def _raw_definition(name):
    from afd.core.commands import CommandDefinition

    async def handler(input, context=None):
        return success({"mine": True})

    return CommandDefinition(name=name, description="Raw", handler=handler)


async def test_a_reserved_name_added_through_the_registry_is_refused_before_a_request():
    server = create_server("test-app", bootstrap=True)
    server.registry.register(_raw_definition("afd-help"))
    with pytest.raises(ValueError, match="'afd-help' is reserved: bootstrap=True"):
        await server.execute("afd-help", {})
    with pytest.raises(ValueError, match="is reserved"):
        server.get_mcp_tools()


async def test_turning_a_built_in_on_after_registration_is_refused_before_a_request():
    server = create_server("test-app")
    _register(server, "afd-help")
    assert (await server.execute("afd-help", {})).data == {"mine": True}
    server.config.bootstrap = True
    with pytest.raises(ValueError, match="'afd-help' is reserved"):
        await server.execute("afd-help", {})

    contexts = create_server("test-app")
    _register(contexts, "afd-context-list")
    contexts.config.contexts = [ContextConfig(name="alpha")]
    with pytest.raises(ValueError, match="'afd-context-list' is reserved: contexts"):
        await contexts.execute("afd-context-list", {})


async def test_a_definition_renamed_after_registration_is_refused_before_a_request():
    server = create_server("test-app", bootstrap=True)
    _register(server, "app-help")
    server.registry.get("app-help").name = "afd-help"
    with pytest.raises(ValueError, match="'afd-help' is reserved"):
        await server.execute("afd-help", {})


@pytest.mark.parametrize("strategy", ["individual", "grouped", "lazy"])
async def test_renaming_after_a_refusal_leaves_no_stale_dispatch_key(strategy):
    """Following the error's advice (rename) must not leave the old name reaching the
    application: the built-ins, index and router are rebuilt when names change."""
    server = create_server("test-app", tool_strategy=strategy)
    _register(server, "afd-help")
    assert (await server.execute("afd-help", {})).data == {"mine": True}  # caches built

    server.config.bootstrap = True
    with pytest.raises(ValueError, match="'afd-help' is reserved"):
        await server.execute("afd-help", {})
    server.registry.get("afd-help").name = "app-help"

    builtin = await server.execute("afd-help", {})
    assert builtin.success is True
    assert builtin.data != {"mine": True}
    routed = await server.call_tool("afd-call", {"command": "afd-help", "input": {}})
    assert getattr(routed, "data", None) != {"mine": True}
