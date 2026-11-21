"""A declared approval policy holds without the approval middleware (#1886).

The engine dispatches a gated call only when an approval step admitted it, and answers
``APPROVAL_UNAVAILABLE`` otherwise (spec/command-metadata.md, "Approvals"). Mirrors
``packages/server/src/approval-fail-closed.test.ts``.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

import pytest

from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.core.commands import CommandContext
from afd.core.result import CommandError, CommandResult, failure
from afd.direct import DirectClient, DirectClientOptions, create_direct_registry
from afd.server.approval_admission import live_command
from afd.server import (
    create_approval_middleware,
    create_retry_middleware,
    create_server,
    define_command,
)

SECRET = "test-approval-secret-0123456789abcdef"
MCP = ExposeOptions(mcp=True)


class IdInput(BaseModel):
    id: int = 0


class Empty(BaseModel):
    pass


def expect_unavailable(result: Any, command: str, reason: str = "no-approval-step") -> None:
    assert result.success is False
    error = result.error
    assert error.code == "APPROVAL_UNAVAILABLE"
    assert error.message == f"{command} needs a person's approval, and this server cannot ask for it"
    assert error.retryable is False
    assert error.details == {"reason": reason}
    assert "do not retry" in error.suggestion.lower()


class Fixture:
    """Commands with each kind of policy, and a record of which handlers ran."""

    def __init__(self) -> None:
        self.ran: list[str] = []
        self.commands = [
            self.command("todo-delete", "required"),
            self.command("todo-check", lambda input, context: "not-required"),
            self.command("todo-touch", "not-required"),
            self.command("todo-list"),
        ]

    def command(self, name: str, approval: Any = None) -> Any:
        ran = self.ran

        @define_command(
            name=name,
            description=f"Command {name}",
            input_schema=IdInput,
            approval=approval,
            expose=MCP,
        )
        async def handler(input: IdInput) -> CommandResult[Any]:
            ran.append(f"{name}:{input.id}")
            return success({"id": input.id})

        return handler

    def server(self, **options: Any) -> Any:
        server = create_server("t", **options)
        for command in self.commands:
            server.register(command)
        return server


async def _approve(request: Any) -> bool:
    return True


# ─── Without the approval middleware ────────────────────────────────────────


async def test_server_refuses_a_gated_command_before_the_handler():
    fixture = Fixture()
    server = fixture.server()
    expect_unavailable(await server.execute("todo-delete", {"id": 1}), "todo-delete")
    # A policy function is not evaluated: the declaration alone needs an approval step.
    expect_unavailable(await server.execute("todo-check", {"id": 2}), "todo-check")
    assert fixture.ran == []


async def test_direct_registry_refuses_also_with_other_middleware():
    fixture = Fixture()

    async def pass_through(name, input, context, next_fn):
        return await next_fn()

    registry = create_direct_registry(fixture.commands, middleware=[pass_through])
    expect_unavailable(await registry.execute("todo-delete", {"id": 1}), "todo-delete")
    assert fixture.ran == []


async def test_direct_client_is_refused():
    fixture = Fixture()
    client = DirectClient(create_direct_registry(fixture.commands))
    expect_unavailable(await client.call("todo-delete", {"id": 1}), "todo-delete")
    assert fixture.ran == []


async def test_not_required_and_undeclared_policies_run():
    fixture = Fixture()
    server = fixture.server()
    assert (await server.execute("todo-touch", {"id": 1})).success
    assert (await server.execute("todo-list", {"id": 2})).success
    registry = create_direct_registry(fixture.commands)
    assert (await registry.execute("todo-list", {"id": 3})).success
    assert fixture.ran == ["todo-touch:1", "todo-list:2", "todo-list:3"]


async def test_every_batch_item_and_pipeline_step_is_checked_on_its_own():
    fixture = Fixture()
    server = fixture.server()
    batch = await server.route_tool_call(
        "afd-batch",
        {
            "commands": [
                {"command": "todo-list", "input": {"id": 1}},
                {"command": "todo-delete", "input": {"id": 2}},
            ]
        },
    )
    assert batch.results[0].result.success
    expect_unavailable(batch.results[1].result, "todo-delete")
    pipe = await server.route_tool_call(
        "afd-pipe",
        {
            "steps": [
                {"command": "todo-list", "input": {"id": 3}},
                {"command": "todo-delete", "input": {"id": 4}},
            ]
        },
    )
    assert pipe.steps[1].error.code == "APPROVAL_UNAVAILABLE"
    assert fixture.ran == ["todo-list:1", "todo-list:3"]


async def test_a_gated_command_run_from_inside_another_is_refused():
    fixture = Fixture()
    nested: list[Any] = []

    @define_command(name="todo-sweep", description="Runs todo-delete from its handler")
    async def sweep(input: Any, context: CommandContext) -> CommandResult[Any]:
        nested.append(await registry.execute("todo-delete", {"id": 9}, context))
        return success(None)

    registry = create_direct_registry([*fixture.commands, sweep])
    assert (await registry.execute("todo-sweep", {})).success
    expect_unavailable(nested[0], "todo-delete")
    assert fixture.ran == []


async def test_over_mcp_tools_the_command_tool_and_afd_call_are_refused():
    fixture = Fixture()
    server = fixture.server(tool_strategy="individual")
    expect_unavailable(await server.route_tool_call("todo-delete", {"id": 1}), "todo-delete")
    expect_unavailable(
        await server.route_tool_call("afd-call", {"command": "todo-delete", "input": {"id": 2}}),
        "todo-delete",
    )
    assert fixture.ran == []


async def test_a_command_registered_after_the_middleware_is_built_is_held():
    fixture = Fixture()
    server = create_server("t", middleware=[create_approval_middleware(secret=SECRET)])
    for command in fixture.commands:
        server.register(command)
    held = await server.execute("todo-delete", {"id": 1})
    assert held.error.code == "APPROVAL_REQUIRED"
    token = held.error.details["approvalToken"]
    retried = await server.execute("todo-delete", {"id": 1}, CommandContext(approval=token))
    assert retried.success and retried.data == {"id": 1}
    assert fixture.ran == ["todo-delete:1"]


# ─── The middleware decides from the command it runs ────────────────────────


async def test_middleware_holds_a_gated_command_missing_from_its_list():
    fixture = Fixture()
    server = fixture.server(middleware=[create_approval_middleware(secret=SECRET, commands=[])])
    held = await server.execute("todo-delete", {"id": 1})
    assert held.error.code == "APPROVAL_REQUIRED"
    assert (await server.execute("todo-check", {"id": 2})).success
    assert fixture.ran == ["todo-check:2"]


async def test_middleware_without_a_list_works_and_the_approved_retry_runs():
    fixture = Fixture()
    registry = create_direct_registry(
        fixture.commands, middleware=[create_approval_middleware(secret=SECRET)]
    )
    client = DirectClient(registry, DirectClientOptions(on_approval_needed=_approve))
    result = await client.call("todo-delete", {"id": 5})
    assert result.success and result.data == {"id": 5}
    assert (await client.call("todo-list", {"id": 6})).success
    assert fixture.ran == ["todo-delete:5", "todo-list:6"]


async def test_middleware_summarizes_with_the_confirm_prompt_of_the_command_it_runs():
    @define_command(
        name="todo-purge",
        description="Purge",
        approval="required",
        confirm_prompt="Purge every todo",
    )
    async def purge(input: Any) -> CommandResult[Any]:
        return success(None)

    registry = create_direct_registry([purge], middleware=[create_approval_middleware(secret=SECRET)])
    asked: list[Any] = []

    async def decide(request: Any) -> bool:
        asked.append(request)
        return False

    await DirectClient(registry, DirectClientOptions(on_approval_needed=decide)).call("todo-purge", {})
    assert [request.summary for request in asked] == ["Purge every todo"]


async def test_a_nested_call_does_not_inherit_the_outer_admission():
    ran: list[str] = []
    nested: list[Any] = []

    @define_command(name="todo-delete", description="Delete", approval="required")
    async def inner(input: Any) -> CommandResult[Any]:
        ran.append("inner")
        return success(None)

    @define_command(
        name="todo-sweep",
        description="Admitted by its policy, then runs todo-delete",
        approval=lambda input, context: "not-required",
    )
    async def outer(input: Any, context: CommandContext) -> CommandResult[Any]:
        ran.append("outer")
        nested.append(await server.execute("todo-delete", {}, context))
        return success(None)

    server = create_server("t", middleware=[create_approval_middleware(secret=SECRET)])
    server.register(inner)
    server.register(outer)
    assert (await server.execute("todo-sweep", {})).success
    assert nested[0].error.code == "APPROVAL_REQUIRED"
    assert ran == ["outer"]


async def test_a_context_from_an_admitted_call_admits_nothing_later():
    fixture = Fixture()
    seen: list[Any] = []

    async def keep(name, input, context, next_fn):
        seen.append(context)
        return await next_fn()

    approved = create_direct_registry(
        fixture.commands, middleware=[create_approval_middleware(secret=SECRET), keep]
    )
    client = DirectClient(approved, DirectClientOptions(on_approval_needed=_approve))
    assert (await client.call("todo-delete", {"id": 1})).success
    # The context the admitted gated call ran with, reused on a server with no approval step.
    expect_unavailable(await fixture.server().execute("todo-delete", {"id": 1}, seen[-1]), "todo-delete")
    assert fixture.ran == ["todo-delete:1"]


# ─── One admission runs one handler, on what was approved ───────────────────


def _approved(after: Any) -> tuple[Fixture, DirectClient]:
    fixture = Fixture()
    registry = create_direct_registry(
        fixture.commands, middleware=[create_approval_middleware(secret=SECRET), after]
    )
    return fixture, DirectClient(registry, DirectClientOptions(on_approval_needed=_approve))


async def test_a_retry_inside_the_chain_after_the_approval_is_refused():
    handled: list[int] = []

    @define_command(
        name="todo-delete",
        description="Fails once with a transient error",
        input_schema=IdInput,
        approval="required",
    )
    async def flaky(input: IdInput) -> CommandResult[Any]:
        handled.append(input.id)
        if len(handled) == 1:
            return failure(CommandError(code="TRANSIENT_ERROR", message="try again"))
        return success(None)

    registry = create_direct_registry(
        [flaky],
        middleware=[
            create_approval_middleware(secret=SECRET),
            create_retry_middleware(max_retries=2, retry_delay=0, jitter=False),
        ],
    )
    client = DirectClient(registry, DirectClientOptions(on_approval_needed=_approve))
    result = await client.call("todo-delete", {"id": 1})
    assert handled == [1]
    expect_unavailable(result, "todo-delete", "admission-mismatch")
    assert "before the approval middleware" in result.error.suggestion


async def test_an_input_changed_in_place_after_the_approval_is_refused():
    async def change(name, input, context, next_fn):
        input.id = 99
        return await next_fn()

    fixture, client = _approved(change)
    expect_unavailable(await client.call("todo-delete", {"id": 1}), "todo-delete", "admission-mismatch")
    assert fixture.ran == []


async def test_an_admission_for_another_command_is_refused():
    fixture = Fixture()
    approval = create_approval_middleware(secret=SECRET)

    # Asks the middleware about an ungated command, then lets the gated one through.
    async def swap(name, input, context, next_fn):
        return await approval("todo-touch", input, context, next_fn)

    registry = create_direct_registry(fixture.commands, middleware=[swap])
    expect_unavailable(
        await registry.execute("todo-delete", {"id": 1}), "todo-delete", "admission-mismatch"
    )
    assert fixture.ran == []


async def test_an_approved_call_runs_when_later_middleware_leaves_it_alone():
    async def leave(name, input, context, next_fn):
        return await next_fn()

    fixture, client = _approved(leave)
    assert (await client.call("todo-delete", {"id": 2})).success
    assert fixture.ran == ["todo-delete:2"]


# ─── A policy given only in the commands list ───────────────────────────────


async def test_a_policy_only_in_the_list_still_holds():
    ran: list[str] = []

    @define_command(name="todo-wipe", description="Wipe todos; its gate is only in the list")
    async def wipe(input: Any) -> CommandResult[Any]:
        ran.append("wipe")
        return success(None)

    gated = _Listed("todo-wipe", "required")
    registry = create_direct_registry(
        [wipe], middleware=[create_approval_middleware(secret=SECRET, commands=[gated])]
    )
    held = await registry.execute("todo-wipe", {})
    assert held.error.code == "APPROVAL_REQUIRED"
    assert ran == []


async def test_a_listed_function_holds_though_the_command_declares_not_required():
    fixture = Fixture()
    listed = _Listed("todo-touch", lambda input, context: "required")
    registry = create_direct_registry(
        fixture.commands, middleware=[create_approval_middleware(secret=SECRET, commands=[listed])]
    )
    assert (await registry.execute("todo-touch", {"id": 1})).error.code == "APPROVAL_REQUIRED"
    assert fixture.ran == []


class _Listed:
    def __init__(self, name: str, approval: Any, confirm_prompt: Optional[str] = None) -> None:
        self.name = name
        self.approval = approval
        self.confirm_prompt = confirm_prompt


# ─── Every dispatch has its own record ──────────────────────────────────────


class SlotContext:
    """A context the engine cannot copy (it takes no clock or random), so every call that is
    given it runs with this very object."""

    __slots__ = ("trace_id", "timeout", "extra", "actor", "approval")

    def __init__(self) -> None:
        self.trace_id = None
        self.timeout = None
        self.extra: dict[str, Any] = {}
        self.actor = None
        self.approval = None


async def test_overlapping_calls_on_one_uncopyable_context_keep_their_own_admission():
    fixture = Fixture()

    async def interleave(name, input, context, next_fn):
        await asyncio.sleep(0)
        return await next_fn()

    server = fixture.server(middleware=[create_approval_middleware(secret=SECRET), interleave])
    shared = SlotContext()
    held = await server.execute("todo-delete", {"id": 1}, shared)
    shared.approval = held.error.details["approvalToken"]
    gated, ungated = await asyncio.gather(
        server.execute("todo-delete", {"id": 1}, shared),
        server.execute("todo-list", {"id": 2}, shared),
    )
    assert gated.success, gated.error
    assert ungated.success, ungated.error
    assert sorted(fixture.ran) == ["todo-delete:1", "todo-list:2"]
    # No record outlives its call, and none answers for the shared object afterwards.
    assert live_command(shared) is None
    expect_unavailable(await fixture.server().execute("todo-delete", {"id": 1}, shared), "todo-delete")


async def test_an_ungated_call_cannot_take_an_overlapping_calls_admission():
    fixture = Fixture()
    order: list[str] = []

    async def interleave(name, input, context, next_fn):
        order.append(name)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        return await next_fn()

    server = fixture.server(middleware=[create_approval_middleware(secret=SECRET), interleave])
    shared = SlotContext()
    held = await server.execute("todo-delete", {"id": 1}, shared)
    shared.approval = held.error.details["approvalToken"]
    results = await asyncio.gather(
        server.execute("todo-list", {"id": 2}, shared),
        server.execute("todo-delete", {"id": 1}, shared),
        server.execute("todo-list", {"id": 3}, shared),
    )
    assert [result.success for result in results] == [True, True, True], [r.error for r in results]
    assert sorted(fixture.ran) == ["todo-delete:1", "todo-list:2", "todo-list:3"]


# ─── The admission is bound to what was verified ────────────────────────────


async def test_an_input_changed_while_the_token_is_spent_is_refused():
    fixture = Fixture()
    seen: list[Any] = []

    async def capture(name, input, context, next_fn):
        seen.append(input)
        return await next_fn()

    class ChangingStore:
        async def consume(self, nonce: str, expires_at: float) -> bool:
            await asyncio.sleep(0)
            seen[-1].id = 99
            return True

    server = fixture.server(
        middleware=[capture, create_approval_middleware(secret=SECRET, nonce_store=ChangingStore())]
    )
    held = await server.execute("todo-delete", {"id": 1})
    token = held.error.details["approvalToken"]
    retried = await server.execute("todo-delete", {"id": 1}, CommandContext(approval=token))
    expect_unavailable(retried, "todo-delete", "admission-mismatch")
    assert fixture.ran == []


async def test_a_gated_input_with_no_canonical_form_is_refused():
    ran: list[str] = []

    @define_command(
        name="todo-tag",
        description="Tag todos",
        approval=lambda input, context: "not-required",
    )
    async def tag(input: Any) -> CommandResult[Any]:
        ran.append("tag")
        return success(None)

    registry = create_direct_registry([tag], middleware=[create_approval_middleware(secret=SECRET)])
    # An integer past 2**53 that a JavaScript number cannot hold exactly has no canonical JSON.
    result = await registry.execute("todo-tag", {"count": 2**60 + 1})
    expect_unavailable(result, "todo-tag", "input-not-canonical")
    assert result.error.suggestion == (
        "Do not retry with this input: it has no exact JSON form, so an approval cannot be bound "
        "to it. Send the input as JSON can represent it (for example, an id above 2^53 as a "
        "string)."
    )
    assert ran == []


# ─── A policy given only in the list is one-shot too ────────────────────────


async def test_a_retry_after_approval_of_a_list_only_policy_is_refused():
    handled: list[int] = []

    @define_command(name="todo-wipe", description="Fails once", input_schema=IdInput)
    async def wipe(input: IdInput) -> CommandResult[Any]:
        handled.append(input.id)
        if len(handled) == 1:
            return failure(CommandError(code="TRANSIENT_ERROR", message="try again"))
        return success(None)

    registry = create_direct_registry(
        [wipe],
        middleware=[
            create_approval_middleware(secret=SECRET, commands=[_Listed("todo-wipe", "required")]),
            create_retry_middleware(max_retries=2, retry_delay=0, jitter=False),
        ],
    )
    client = DirectClient(registry, DirectClientOptions(on_approval_needed=_approve))
    result = await client.call("todo-wipe", {"id": 1})
    assert handled == [1]
    expect_unavailable(result, "todo-wipe", "admission-mismatch")


async def test_an_input_changed_after_approval_of_a_list_only_policy_is_refused():
    ran: list[int] = []

    @define_command(name="todo-wipe", description="Wipe", input_schema=IdInput)
    async def wipe(input: IdInput) -> CommandResult[Any]:
        ran.append(input.id)
        return success(None)

    async def change(name, input, context, next_fn):
        input.id = 99
        return await next_fn()

    registry = create_direct_registry(
        [wipe],
        middleware=[
            create_approval_middleware(secret=SECRET, commands=[_Listed("todo-wipe", "required")]),
            change,
        ],
    )
    client = DirectClient(registry, DirectClientOptions(on_approval_needed=_approve))
    expect_unavailable(await client.call("todo-wipe", {"id": 1}), "todo-wipe", "admission-mismatch")
    assert ran == []


# ─── Up-front approval of afd-batch and afd-pipe, with no commands list ─────


def _relay_server(ran: list[str]) -> Any:
    fixture = Fixture()
    fixture.ran = ran
    fixture.commands = [fixture.command("todo-delete", "required"), fixture.command("todo-list")]
    return fixture.server(
        tool_strategy="individual",
        middleware=[
            create_approval_middleware(secret=SECRET, relay="mcp-elicitation", include_token=False)
        ],
    )


async def _relay_call(server: Any, mode: str, prompts: list[str], tool: str, arguments: Any) -> Any:
    pytest.importorskip("mcp")
    import json

    import mcp_types as types
    from mcp import Client

    async def accept(context: Any, params: Any) -> Any:
        prompts.append(params.message)
        schema = params.requested_schema
        properties = schema.get("properties") if isinstance(schema, dict) else schema.properties
        return types.ElicitResult(action="accept", content={name: True for name in properties})

    async with Client(server._create_mcp_server(), mode=mode, elicitation_callback=accept) as client:
        return json.loads((await client.call_tool(tool, arguments)).content[0].text)


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_a_batch_is_approved_up_front_without_a_commands_list(mode):
    ran: list[str] = []
    prompts: list[str] = []
    request = {
        "commands": [
            {"command": "todo-list", "input": {"id": 1}},
            {"command": "todo-delete", "input": {"id": 2}},
        ]
    }
    result = await _relay_call(_relay_server(ran), mode, prompts, "afd-batch", request)
    assert result["success"] is True, result
    assert sorted(ran) == ["todo-delete:2", "todo-list:1"]
    assert len(prompts) == 1 and "Command: todo-delete" in prompts[0]


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_a_pipeline_is_approved_up_front_without_a_commands_list(mode):
    ran: list[str] = []
    prompts: list[str] = []
    request = {
        "steps": [
            {"command": "todo-list", "input": {"id": 1}},
            {"command": "todo-delete", "input": {"id": 2}},
        ]
    }
    result = await _relay_call(_relay_server(ran), mode, prompts, "afd-pipe", request)
    assert [step["status"] for step in result["steps"]] == ["success", "success"], result
    assert ran == ["todo-list:1", "todo-delete:2"]
    assert len(prompts) == 1 and "Command: todo-delete" in prompts[0]
