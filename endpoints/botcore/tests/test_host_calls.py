"""A host call: kebab-case names, the per-call context, typed inputs and profiles."""

from __future__ import annotations

import contextlib

import pytest
from afd import Actor, success
from afd.core.commands import CommandContext
from afd.core.journal import MemoryJournalSink
from afd.server.journal import create_journal_middleware
from pydantic import BaseModel

from botcore.context import ExecutionContext, current_call
from botcore.host import CommandHost, CommandPolicy, build_host


class Holder(BaseModel):
    branch: str
    machine: str


async def issue_claim(numbers: list[int], holder: Holder, lease_hours: int = 24):
    """Claim issues for a holder.

    Args:
        numbers: The issues, all claimed or none.
        holder: Who holds them.
        lease_hours: How long the lease lasts.
    """
    return success(
        {
            "numbers": numbers,
            "branch": holder.branch,
            "holderType": type(holder).__name__,
            "actor": getattr(current_call().actor, "id", None),
        }
    )


def make_host(tmp_path, profile="trusted-local", **options) -> CommandHost:
    host = CommandHost("gateway", ExecutionContext(tmp_path, profile=profile), **options)
    host.register("issue-claim", issue_claim, CommandPolicy(("service",)))
    return host


HOLDER = {"branch": "fix/parser", "machine": "workstation"}


# ── Names ───────────────────────────────────────────────────────────────


async def test_a_command_is_served_as_registered_and_called_in_either_spelling(tmp_path):
    host = make_host(tmp_path)
    assert host.list_command_names() == ["issue-claim"]
    assert [row["name"] for row in host.catalog()] == ["issue-claim"]
    for name in ("issue-claim", "issue_claim"):
        assert (await host.execute(name, {"numbers": [1], "holder": HOLDER})).success


async def test_build_host_serves_kebab_case_names_when_asked(tmp_path):
    plain = build_host("alfred", ExecutionContext(tmp_path))
    kebab = build_host("alfred", ExecutionContext(tmp_path), kebab_names=True)
    assert "info_workspace" in plain.list_command_names()
    assert "info-workspace" in kebab.list_command_names()
    assert "info_workspace" not in kebab.list_command_names()
    for host in (plain, kebab):
        for name in ("info_workspace", "info-workspace"):
            assert (await host.execute(name, {})).success


@pytest.mark.parametrize("wrong", ["issue-cliam", "IssueClaim", "issue.claim"])
async def test_an_unknown_name_suggests_the_closest_served_one(tmp_path, wrong):
    result = await make_host(tmp_path).execute(wrong, {})
    assert result.error.code == "COMMAND_NOT_FOUND"
    assert "did you mean issue-claim?" in result.error.message
    assert result.error.suggestion.startswith("Call issue-claim, or inspect the host catalog")
    assert result.error.details == {"suggestedCommand": "issue-claim"}


async def test_a_name_nothing_resembles_points_at_the_catalog(tmp_path):
    result = await make_host(tmp_path).execute("zzz", {})
    assert result.error.code == "COMMAND_NOT_FOUND"
    assert result.error.suggestion == (
        "Inspect the host catalog (gateway catalog) for the commands it serves"
    )
    assert result.error.details is None


def test_both_spellings_of_one_name_cannot_be_registered(tmp_path):
    host = make_host(tmp_path)
    with pytest.raises(ValueError, match="Duplicate command: issue-claim"):
        host.register("issue-claim", issue_claim, CommandPolicy())


# ── The per-call context ────────────────────────────────────────────────


async def test_a_call_without_a_context_gets_one_with_a_trace_id_and_the_host_actor(tmp_path):
    seen = []

    async def record(command, args, context, next_fn):
        seen.append((command, context))
        return await next_fn()

    host = make_host(tmp_path, actor=Actor(kind="agent", id="foreman"))
    host.middleware.append(record)
    result = await host.execute("issue_claim", {"numbers": [1], "holder": HOLDER})
    assert result.data["actor"] == "foreman"
    command, context = seen[0]
    assert command == "issue-claim"
    assert isinstance(context, CommandContext) and len(context.trace_id) == 32
    assert current_call() is None  # Only inside the call.


async def test_a_surface_s_context_and_its_verified_actor_reach_the_journal(tmp_path):
    sink = MemoryJournalSink()
    host = make_host(tmp_path)
    host.middleware.append(create_journal_middleware(sink))
    caller = Actor(kind="service", id="lane@workstation", on_behalf_of="cell-3")
    context = CommandContext(trace_id="trace-1", actor=caller)
    result = await host.execute("issue-claim", {"numbers": [1], "holder": HOLDER}, context)
    assert result.data["actor"] == "lane@workstation"
    [entry] = await sink.read()
    assert entry.command == "issue-claim"
    assert entry.trace_id == "trace-1"
    assert (entry.actor.kind, entry.actor.id, entry.actor.on_behalf_of) == (
        "service",
        "lane@workstation",
        "cell-3",
    )
    assert entry.input["holder"] == HOLDER


# ── Typed inputs ────────────────────────────────────────────────────────


async def test_a_model_input_arrives_validated_and_a_numeric_string_as_a_number(tmp_path):
    result = await make_host(tmp_path).execute(
        "issue-claim", {"numbers": ["101"], "holder": HOLDER}
    )
    assert result.data["numbers"] == [101]
    assert result.data["holderType"] == "Holder"


async def test_an_invalid_nested_input_is_refused_with_each_field_s_path(tmp_path):
    result = await make_host(tmp_path).execute(
        "issue-claim", {"numbers": [1, "x"], "holder": {"branch": "fix/parser"}}
    )
    assert result.error.code == "VALIDATION_ERROR"
    assert result.error.message.startswith("issue-claim got invalid input: ")
    assert {entry["field"] for entry in result.error.details["invalidFields"]} == {
        "numbers[1]",
        "holder.machine",
    }
    assert "input_schema" in result.error.suggestion


def test_the_catalog_describes_the_model_it_validates(tmp_path):
    [row] = make_host(tmp_path).catalog()
    schema = row["input_schema"]
    assert schema["required"] == ["numbers", "holder"]
    assert schema["properties"]["holder"]["required"] == ["branch", "machine"]


# ── Profiles ────────────────────────────────────────────────────────────


async def test_the_remote_caller_profile_admits_service_and_history_writes_only(tmp_path):
    host = make_host(tmp_path, profile="remote-caller")

    async def run_tool():
        return success({})

    host.register("tool_run", run_tool, CommandPolicy(("subprocess",)))
    assert (await host.execute("issue-claim", {"numbers": [1], "holder": HOLDER})).success
    denied = await host.execute("tool-run", {})
    assert denied.error.code == "EFFECT_DENIED"
    assert "remote-caller profile admits: history-write, inspect, service" in (denied.error.message)


async def test_the_inspection_profile_still_admits_reads_only(tmp_path):
    denied = await make_host(tmp_path, profile="inspection").execute(
        "issue-claim", {"numbers": [1], "holder": HOLDER}
    )
    assert denied.error.code == "EFFECT_DENIED"


def test_an_unknown_profile_names_the_known_ones(tmp_path):
    with pytest.raises(ValueError, match="inspection, remote-caller, trusted-local"):
        ExecutionContext(tmp_path, profile="remote")


async def test_a_hint_pydantic_cannot_validate_leaves_the_input_unchecked(tmp_path):
    async def lane_get(names: list[Unresolvable]):  # noqa: F821 - deliberately unresolved
        """Read lanes."""
        return success({"names": names})

    host = CommandHost("factory", ExecutionContext(tmp_path))
    host.register("lane-get", lane_get, CommandPolicy())
    result = await host.execute("lane-get", {"names": ["a"]})
    assert result.success and result.data == {"names": ["a"]}


async def test_the_call_reaches_a_handler_running_in_a_thread(tmp_path):
    import asyncio

    async def who():
        """Name the caller from a worker thread."""
        return success(await asyncio.to_thread(lambda: current_call().actor.id))

    host = CommandHost(
        "factory", ExecutionContext(tmp_path), actor=Actor(kind="agent", id="cell-3")
    )
    host.register("who", who, CommandPolicy())
    assert (await host.execute("who", {})).data == "cell-3"


async def test_a_call_context_carries_a_clock_and_a_random_source(tmp_path):
    async def tick():
        """Read the time."""
        call = current_call()
        return success({"now": call.clock.now() > 0, "random": 0 <= call.random.next() < 1})

    host = CommandHost("factory", ExecutionContext(tmp_path))
    host.register("tick", tick, CommandPolicy())
    assert (await host.execute("tick", {})).data == {"now": True, "random": True}


async def test_an_mcp_call_is_made_as_an_agent(tmp_path):
    import json

    from botcore.host_surfaces import create_host_mcp_server

    async def who():
        """Name the caller's kind."""
        return success(current_call().actor.kind)

    host = CommandHost("factory", ExecutionContext(tmp_path))
    host.register("who", who, CommandPolicy())
    server = create_host_mcp_server(host)
    reply = await server.call_tool("factory-call", {"command": "who"})
    blocks = getattr(reply, "content", None) or (reply[0] if isinstance(reply, tuple) else reply)
    assert json.loads(blocks[0].text)["data"] == "agent"


# ── Per-command MCP tools ───────────────────────────────────────────────


def _reply(reply) -> dict:
    import json

    blocks = getattr(reply, "content", None) or (reply[0] if isinstance(reply, tuple) else reply)
    return json.loads(blocks[0].text)


async def test_command_tools_carry_the_catalog_schema_and_effect_annotations(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    async def issue_get(number: int):
        """Read an issue."""
        return success({"number": number, "actor": current_call().actor.kind})

    host = make_host(tmp_path)
    host.register("issue-get", issue_get, CommandPolicy(("inspect",)))
    server = create_host_mcp_server(host, command_tools=True)
    tools = {tool.name: tool for tool in await server.list_tools()}
    assert {"gateway-start", "gateway-call", "gateway-docs", "issue-claim", "issue-get"} == set(
        tools
    )
    catalog = {row["name"]: row for row in host.catalog()}
    claim = tools["issue-claim"].model_dump(by_alias=True, exclude_none=True)
    assert claim["annotations"] == {"readOnlyHint": False, "destructiveHint": True}
    assert claim["inputSchema"] == catalog["issue-claim"]["input_schema"]
    read = tools["issue-get"].model_dump(by_alias=True, exclude_none=True)
    assert read["annotations"] == {"readOnlyHint": True, "destructiveHint": False}
    assert read["description"] == "Read an issue."

    data = _reply(await server.call_tool("issue-claim", {"numbers": ["7"], "holder": HOLDER}))
    assert data["success"] and data["data"]["numbers"] == [7]
    assert data["data"]["holderType"] == "Holder"
    assert _reply(await server.call_tool("issue-get", {"number": 3}))["data"]["actor"] == "agent"


async def test_without_the_option_only_the_meta_tools_are_served(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    server = create_host_mcp_server(make_host(tmp_path))
    assert {tool.name for tool in await server.list_tools()} == {
        "gateway-start",
        "gateway-call",
        "gateway-docs",
    }


async def test_a_command_tool_refuses_as_the_host_does(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    server = create_host_mcp_server(make_host(tmp_path, profile="inspection"), command_tools=True)
    data = _reply(await server.call_tool("issue-claim", {"numbers": [1], "holder": HOLDER}))
    assert data["error"]["code"] == "EFFECT_DENIED"


async def test_bad_input_is_refused_by_the_host_in_afd_s_shape(tmp_path):
    """The SDK does not check a command tool's arguments first: an unknown key reaches the
    host, which refuses it with a suggestion, instead of being dropped or refused by the SDK."""
    from botcore.host_surfaces import create_host_mcp_server

    server = create_host_mcp_server(make_host(tmp_path), command_tools=True)
    data = _reply(
        await server.call_tool("issue-claim", {"number": [1], "holder": HOLDER, "extra": 1})
    )
    assert data["success"] is False
    assert data["error"]["code"] == "VALIDATION_ERROR"
    assert data["error"]["details"]["unexpectedFields"] == ["number", "extra"]
    assert data["error"]["details"]["suggestedFields"] == {"number": "numbers"}
    assert data["error"]["suggestion"]
    wrong = _reply(await server.call_tool("issue-claim", {"numbers": "x", "holder": HOLDER}))
    assert wrong["error"]["code"] == "VALIDATION_ERROR"


async def test_a_kwargs_handler_is_served_and_receives_every_key(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    async def record(**fields):
        """Record whatever is sent."""
        return success(fields)

    host = make_host(tmp_path)
    host.register("record-any", record, CommandPolicy(("service",)))
    server = create_host_mcp_server(host, command_tools=True)
    assert "record-any" in {tool.name for tool in await server.list_tools()}
    data = _reply(await server.call_tool("record-any", {"a": 1, "nested": {"b": [2]}}))
    assert data["data"] == {"a": 1, "nested": {"b": [2]}}


def test_a_command_named_like_a_meta_tool_is_refused(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    host = make_host(tmp_path)

    async def start():
        """Collide."""
        return success({})

    host.register("gateway-start", start, CommandPolicy())
    with pytest.raises(ValueError, match="collides with a gateway meta-tool"):
        create_host_mcp_server(host, command_tools=True)


async def test_the_meta_tools_still_work_beside_the_command_tools(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    server = create_host_mcp_server(make_host(tmp_path), command_tools=True)
    data = _reply(
        await server.call_tool(
            "gateway-call",
            {"command": "issue-claim", "arguments": {"numbers": [2], "holder": HOLDER}},
        )
    )
    assert data["success"] and data["data"]["numbers"] == [2]


async def test_a_hint_nothing_resolves_still_serves_its_command_tool(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    async def odd(value: NotDefinedAnywhere):  # noqa: F821 - unresolvable on purpose
        """Take a hint nothing can resolve."""
        return success({"value": value})

    host = make_host(tmp_path)
    host.register("odd-thing", odd, CommandPolicy())
    server = create_host_mcp_server(host, command_tools=True)
    assert "odd-thing" in {tool.name for tool in await server.list_tools()}
    assert _reply(await server.call_tool("odd-thing", {"value": 3}))["data"] == {"value": 3}


@contextlib.asynccontextmanager
async def _client(server):
    """An MCP client session over each SDK's in-memory transport, so a test passes through
    tools/list and tools/call as a real client does, not through the server's methods."""
    try:
        from mcp import Client  # SDK 2
    except ImportError:
        from mcp.shared.memory import create_connected_server_and_client_session

        async with create_connected_server_and_client_session(server._mcp_server) as session:
            yield session
        return
    async with Client(server) as client:
        yield client


async def test_command_tools_route_over_a_real_transport(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    host = make_host(tmp_path)
    server = create_host_mcp_server(host, command_tools=True)
    async with _client(server) as client:
        listed = {tool.name: tool for tool in (await client.list_tools()).tools}
        dumped = listed["issue-claim"].model_dump(by_alias=True, exclude_none=True)
        assert dumped["annotations"] == {"readOnlyHint": False, "destructiveHint": True}
        direct = await client.call_tool("issue-claim", {"numbers": ["7"], "holder": HOLDER})
        meta = await client.call_tool(
            "gateway-call",
            {"command": "issue-claim", "arguments": {"numbers": ["7"], "holder": HOLDER}},
        )
        assert _reply(direct) == _reply(meta)
        assert _reply(direct)["data"]["numbers"] == [7]
        bad = _reply(await client.call_tool("issue-claim", {"numbers": [1], "nope": 1}))
        assert bad["error"]["code"] == "VALIDATION_ERROR"


async def test_a_command_registered_later_is_listed_and_routed(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    host = make_host(tmp_path)
    server = create_host_mcp_server(host, command_tools=True)

    async def late(x: int):
        """Arrive after the server."""
        return success({"x": x})

    host.register("late-cmd", late, CommandPolicy())
    host.register("gateway-docs", late, CommandPolicy())  # Never served as a command.
    names = [tool.name for tool in await server.list_tools()]
    assert "late-cmd" in names and names.count("gateway-docs") == 1
    assert _reply(await server.call_tool("late-cmd", {"x": 2}))["data"] == {"x": 2}
    reply = await server.call_tool("gateway-docs", {})  # Still the meta-tool.
    blocks = getattr(reply, "content", None) or (reply[0] if isinstance(reply, tuple) else reply)
    assert blocks[0].text.startswith("# gateway")


def test_run_is_reserved_even_without_raw_python(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    host = make_host(tmp_path)

    async def run():
        """Collide."""
        return success({})

    host.register("gateway-run", run, CommandPolicy())
    with pytest.raises(ValueError, match="gateway-run collides"):
        create_host_mcp_server(host, command_tools=True)


async def test_raw_python_and_command_tools_serve_together(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    server = create_host_mcp_server(make_host(tmp_path), raw_python=True, command_tools=True)
    names = {tool.name for tool in await server.list_tools()}
    assert {"gateway-run", "issue-claim"} <= names
    data = _reply(await server.call_tool("issue-claim", {"numbers": [4], "holder": HOLDER}))
    assert data["data"]["numbers"] == [4]


async def test_effects_that_depend_on_arguments_are_annotated_by_every_possible_one(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    async def lint(fix: bool = False):
        """Lint, and fix when asked."""
        return success({"fix": fix})

    host = make_host(tmp_path)
    mixed = CommandPolicy(
        effects=lambda a: ("source-write",) if a.get("fix") else ("inspect",),
        possible_effects=("inspect", "source-write"),
    )
    reading = CommandPolicy(effects=lambda a: ("inspect",), possible_effects=("inspect",))
    host.register("lint-mixed", lint, mixed)
    host.register("lint-read", lint, reading)
    server = create_host_mcp_server(host, command_tools=True)
    tools = {tool.name: tool for tool in await server.list_tools()}
    hints = {
        name: tools[name].model_dump(by_alias=True, exclude_none=True)["annotations"]
        for name in ("lint-mixed", "lint-read")
    }
    assert hints["lint-mixed"] == {"readOnlyHint": False, "destructiveHint": True}
    assert hints["lint-read"] == {"readOnlyHint": True, "destructiveHint": False}


async def test_a_command_tool_calls_as_the_actor_the_host_names(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    host = make_host(tmp_path, actor=Actor(kind="agent", id="cell-9"))
    server = create_host_mcp_server(host, command_tools=True)
    data = _reply(await server.call_tool("issue-claim", {"numbers": [1], "holder": HOLDER}))
    assert data["data"]["actor"] == "cell-9"


async def test_a_command_tool_declares_the_call_meta_tool_s_output(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    server = create_host_mcp_server(make_host(tmp_path), command_tools=True)
    tools = {
        tool.name: tool.model_dump(by_alias=True, exclude_none=True)
        for tool in await server.list_tools()
    }
    assert tools["issue-claim"].get("outputSchema") == tools["gateway-call"].get("outputSchema")


async def test_only_the_served_spelling_is_a_command_tool(tmp_path):
    """A client rule keyed on ``issue-claim`` must not be passed by calling ``issue_claim``."""
    from botcore.host_surfaces import create_host_mcp_server

    server = create_host_mcp_server(make_host(tmp_path), command_tools=True)
    with pytest.raises(Exception, match="Unknown tool"):
        await server.call_tool("issue_claim", {"numbers": [1], "holder": HOLDER})


def test_sdk_2_checks_a_command_tool_s_headers_against_the_catalog_schema(tmp_path):
    from botcore.host_surfaces import create_host_mcp_server

    host = make_host(tmp_path)
    server = create_host_mcp_server(host, command_tools=True)
    if not hasattr(super(type(server), server), "_tool_input_schema"):
        pytest.skip("SDK 1 has no Mcp-Param header check")
    catalog = {row["name"]: row["input_schema"] for row in host.catalog()}
    assert server._tool_input_schema("issue-claim") == catalog["issue-claim"]
    assert server._tool_input_schema("issue_claim") is None
    assert server._tool_input_schema("gateway-call") is not None
