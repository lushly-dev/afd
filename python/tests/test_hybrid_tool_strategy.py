"""The hybrid tool strategy (spec/tool-strategies.md, H1 to H8) over real MCP sessions.

``spec/tool-strategies.json`` pins the lists, ``ttlMs``, call outcomes and construction
failures; the rest of this file covers what the vectors leave to each language: H3's
equality with the individual and lazy strategies, H2's re-checks, and H8's reports.
"""

import json
from pathlib import Path

import pytest

pytest.importorskip("mcp")

from mcp import Client  # noqa: E402

from afd import ExposeOptions, success  # noqa: E402
from afd.server import ContextConfig, create_server  # noqa: E402

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "tool-strategies.json").read_text(encoding="utf-8")
)
CONTEXT_KEY = "dev.afd/context"
SERVERS = {item["id"]: item for item in VECTORS["servers"]}
EVERY_COMMAND = [command["name"] for command in VECTORS["commands"]]


def _register(server, commands=None):
    """Register the vector commands: object input with no required property, echo it."""
    for item in commands if commands is not None else VECTORS["commands"]:

        @server.command(
            name=item["name"],
            description=item["description"],
            mutation=item.get("mutation", False),
            destructive=item.get("destructive"),
            confirm_prompt=item.get("confirmPrompt"),
            contexts=item.get("contexts"),
            expose=ExposeOptions(mcp=item["expose"]["mcp"]),
            input_schema={"type": "object", "properties": {}},
        )
        async def handler(input):
            return success(input or {})


def _options(config):
    options = {}
    if config.get("contexts"):
        options["contexts"] = [ContextConfig(**context) for context in VECTORS["contexts"]]
    if "confirmations" in config:
        options["confirmations"] = config["confirmations"]
    if "toolsListTtlMs" in config:
        options["tools_list_ttl_ms"] = config["toolsListTtlMs"]
    return options


def _build(config, **overrides):
    """Build a server from a vector ``config``; ``overrides`` replace create_server options."""
    options = {"tool_strategy": config["toolStrategy"], **_options(config), **overrides}
    if "firstClassTools" in config:
        options.setdefault("first_class_tools", config["firstClassTools"])
    server = create_server("hybrid-vectors", **options)
    _register(server)
    return server


def _meta(context):
    return None if context is None else {CONTEXT_KEY: context}


def _body(result):
    return json.loads(result.content[0].text)


@pytest.mark.parametrize("case", VECTORS["servers"], ids=lambda case: case["id"])
async def test_lists_ttl_and_calls_follow_the_vectors(case):
    server = _build(case["config"])
    async with Client(server._create_mcp_server()) as client:
        for listing in case["lists"]:
            result = await client.list_tools(meta=_meta(listing["context"]), cache_mode="bypass")
            assert [tool.name for tool in result.tools] == listing["tools"], listing["context"]
            assert result.ttl_ms == case["ttlMs"]
        for call in case["calls"]:
            result = await client.call_tool(
                call["tool"], call.get("arguments", {}), meta=_meta(call["context"])
            )
            body = _body(result)
            expected = call["expected"]
            assert body["success"] is expected["success"], call
            assert result.is_error is (not expected["success"])
            if not expected["success"]:
                assert body["error"]["code"] == expected["code"], call


@pytest.mark.parametrize("case", VECTORS["constructionFailures"], ids=lambda case: case["id"])
async def test_misconfigurations_fail_before_the_first_request(case):
    entry = case["entry"]
    with pytest.raises(ValueError) as raised:
        server = _build(case["config"])
        # H2 allows entries to be checked once the commands are registered, before any request.
        server._create_mcp_server()
    if entry is not None:
        assert f"'{entry}'" in str(raised.value)


def test_option_combinations_fail_at_construction():
    for case in VECTORS["constructionFailures"]:
        if case["entry"] is None:
            with pytest.raises(ValueError):
                create_server(
                    "x",
                    tool_strategy=case["config"]["toolStrategy"],
                    first_class_tools=case["config"].get("firstClassTools"),
                )


def test_a_bare_string_is_not_a_list_of_names():
    with pytest.raises(ValueError, match="list of non-empty command names"):
        create_server("x", tool_strategy="hybrid", first_class_tools="note-list")


def test_the_cap_error_names_the_first_entry_beyond_it():
    names = [f"cmd-{letter}" for letter in "abcdefghij"]
    server = create_server("x", tool_strategy="hybrid", first_class_tools=names)
    _register(server, [{"name": name, "description": name, "expose": {"mcp": True}} for name in names])
    with pytest.raises(ValueError, match="'cmd-i'"):
        server.get_tool_definitions()


def test_the_set_is_checked_before_any_request_however_it_is_reached():
    def fresh():
        server = create_server("x", tool_strategy="hybrid", first_class_tools=["note-list", "missing"])
        _register(server)
        return server

    with pytest.raises(ValueError, match="'missing'"):
        fresh().get_tool_definitions()
    with pytest.raises(ValueError, match="'missing'"):
        fresh()._create_mcp_server()
    with pytest.raises(ValueError, match="'missing'"):
        fresh().streamable_http_app()


async def test_the_check_runs_before_a_call_and_again_after_a_registration():
    server = create_server("x", tool_strategy="hybrid", first_class_tools=["note-list", "late-add"])
    _register(server)
    for call in (
        lambda: server.execute("note-list", {}),
        lambda: server.route_tool_call("note-list", {}),
    ):
        with pytest.raises(ValueError, match="'late-add'"):
            await call()

    @server.command(name="late-add", description="Registered after the first check", expose=ExposeOptions(mcp=True))
    async def late(input):
        return success({})

    assert server.get_tool_definitions()[-1]["name"] == "late-add"
    assert (await server.route_tool_call("late-add", {})).success


def test_a_change_that_unexposes_a_first_class_command_is_refused():
    server = create_server("x", tool_strategy="hybrid", first_class_tools=["note-list"])
    _register(server)
    server.get_tool_definitions()

    with pytest.raises(ValueError, match="'note-list'"):

        @server.command(name="note-list", description="Now private", expose=ExposeOptions(mcp=False))
        async def private(input):
            return success({})

    # The refused change was not applied.
    assert [tool["name"] for tool in server.get_tool_definitions()][-1] == "note-list"


def test_commands_outside_the_set_change_without_changing_the_list():
    server = create_server("x", tool_strategy="hybrid", first_class_tools=["note-list"])
    _register(server)
    before = server.get_tool_definitions()
    _register(server, [{"name": "extra-one", "description": "Added later", "expose": {"mcp": True}}])
    assert server.get_tool_definitions() == before


@pytest.mark.parametrize("mode", ["auto", "legacy"])
@pytest.mark.parametrize("strategy", ["individual", "hybrid"])
async def test_a_server_never_advertises_a_changing_list(mode, strategy):
    config = SERVERS["contexts"]["config"] if strategy == "hybrid" else {"toolStrategy": strategy}
    async with Client(_build(config)._create_mcp_server(), mode=mode) as client:
        assert client.server_capabilities.tools.list_changed is False


def test_tool_definitions_list_in_configured_order_not_registration_order():
    server = _build(SERVERS["cap"]["config"])
    names = [tool["name"] for tool in server.get_tool_definitions()]
    assert names[8:] == SERVERS["cap"]["config"]["firstClassTools"]
    assert len(names) == 16


# ── H3: each tool equals the same server's tool under the strategy it mirrors ────────────────


@pytest.mark.parametrize("case", VECTORS["servers"], ids=lambda case: case["id"])
def test_first_class_and_context_tools_equal_the_individual_tools(case):
    hybrid = {tool["name"]: tool for tool in _build(case["config"]).get_tool_definitions()}
    individual_config = {k: v for k, v in case["config"].items() if k != "firstClassTools"}
    individual_config["toolStrategy"] = "individual"
    individual = {tool["name"]: tool for tool in _build(individual_config).get_tool_definitions()}
    command_tools = case["config"]["firstClassTools"] + [
        name for name in VECTORS["contextTools"] if name in hybrid
    ]
    for name in command_tools:
        assert hybrid[name] == individual[name], name


@pytest.mark.parametrize("case", VECTORS["servers"], ids=lambda case: case["id"])
def test_meta_tools_equal_the_lazy_tools(case):
    hybrid = {tool["name"]: tool for tool in _build(case["config"]).get_tool_definitions()}
    lazy_config = {k: v for k, v in case["config"].items() if k != "firstClassTools"}
    lazy_config["toolStrategy"] = "lazy"
    lazy = {tool["name"]: tool for tool in _build(lazy_config).get_tool_definitions()}
    for name in VECTORS["metaTools"]:
        assert hybrid[name] == lazy[name], name


def test_first_class_tools_take_confirm_where_confirmations_enforce():
    tools = {tool["name"]: tool for tool in _build(SERVERS["no-contexts"]["config"]).get_tool_definitions()}
    assert "confirm" in tools["note-delete"]["inputSchema"]["properties"]
    assert "confirm" not in tools["tag-list"]["inputSchema"].get("properties", {})
    assert "confirm" in tools["afd-call"]["inputSchema"]["properties"]
    assert tools["afd-batch"]["inputSchema"]["properties"]["confirm"]["type"] == "array"


async def test_a_command_outside_the_set_is_confirmed_through_afd_call():
    server = _build(SERVERS["no-contexts"]["config"])
    async with Client(server._create_mcp_server()) as client:
        refused = _body(await client.call_tool("afd-call", {"command": "note-delete"}))
        assert refused["error"]["code"] == "CONFIRMATION_REQUIRED"
        ran = _body(await client.call_tool("afd-call", {"command": "note-delete", "confirm": True}))
        assert ran["success"] is True
        batch = _body(
            await client.call_tool("afd-batch", {"commands": [{"command": "note-delete"}]})
        )
        assert batch["success"] is False
        assert batch["error"]["code"] == "CONFIRMATION_REQUIRED"


async def test_the_unknown_command_suggestion_points_at_afd_discover():
    server = _build(SERVERS["contexts"]["config"])
    async with Client(server._create_mcp_server()) as client:
        for name in ("note-archive", "admin-reset"):
            body = _body(await client.call_tool(name, {}))
            assert body["error"]["code"] == "COMMAND_NOT_FOUND"
            assert body["error"]["suggestion"].endswith("Use afd-discover to list all commands.")
            assert "admin-reset" not in body["error"]["suggestion"]


async def test_not_in_context_names_the_context_tools_the_list_carries():
    server = _build(SERVERS["contexts"]["config"])
    async with Client(server._create_mcp_server()) as client:
        listed = {tool.name for tool in (await client.list_tools(meta=_meta("review"))).tools}
        body = _body(await client.call_tool("plan-draft", {}, meta=_meta("review")))
        assert body["error"]["code"] == "COMMAND_NOT_IN_CONTEXT"
        assert body["error"]["suggestion"] == (
            "Use afd-context-list to see available contexts, or afd-context-enter to switch."
        )
        assert {"afd-context-list", "afd-context-enter"} <= listed


async def test_discover_and_detail_keep_filtering_by_context():
    server = _build(SERVERS["contexts"]["config"])
    async with Client(server._create_mcp_server()) as client:
        found = _body(await client.call_tool("afd-discover", {"limit": 200}, meta=_meta("review")))
        names = {item["name"] for item in found["data"]["commands"]}
        assert "review-approve" in names and "plan-draft" not in names


# ── H8: what afd-help and server/discover report ────────────────────────────────────────────


async def _help(server, **arguments):
    async with Client(server._create_mcp_server()) as client:
        return _body(await client.call_tool("afd-help", arguments))["data"]


@pytest.mark.parametrize("strategy", ["individual", "grouped", "lazy"])
async def test_afd_help_reports_the_strategy_and_nothing_hybrid_elsewhere(strategy):
    server = _build({"toolStrategy": strategy, "contexts": False})
    for arguments in ({}, {"format": "full"}):
        data = await _help(server, **arguments)
        assert data["toolStrategy"] == strategy
        assert "firstClassTools" not in data
        assert all("firstClass" not in command for command in data["commands"])


@pytest.mark.parametrize("format", ["brief", "full"])
async def test_afd_help_on_a_hybrid_server_marks_the_first_class_commands(format):
    config = SERVERS["no-contexts"]["config"]
    data = await _help(_build(config), format=format)
    assert data["toolStrategy"] == "hybrid"
    assert data["firstClassTools"] == config["firstClassTools"]
    flagged = [command["name"] for command in data["commands"] if command.get("firstClass") is True]
    assert sorted(flagged) == sorted(config["firstClassTools"])
    assert all(command.get("firstClass", True) is True for command in data["commands"])


async def test_afd_help_standalone_result_has_no_strategy_fields():
    from afd.core.wire import to_wire
    from afd.server.bootstrap import create_afd_help_command

    result = await create_afd_help_command(lambda: []).handler({}, None)
    data = to_wire(result)["data"]
    assert "toolStrategy" not in data and "firstClassTools" not in data


def test_default_instructions_for_hybrid_and_custom_instructions():
    from afd.server.factory import default_instructions

    text = default_instructions("srv", "hybrid", [])
    assert (
        "The command tools listed are the common ones. Call afd-discover to find others, "
        "afd-detail for a schema, and afd-call to run one." in text
    )
    assert "Each command is its own tool" not in text
    assert "Use afd-batch for several independent commands and afd-pipe to chain them." in text
    server = _build(SERVERS["contexts"]["config"], instructions="Custom words.")
    assert server._create_mcp_server().instructions == "Custom words."
