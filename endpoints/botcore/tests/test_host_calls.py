"""A host call: kebab-case names, the per-call context, typed inputs and profiles."""

from __future__ import annotations

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
