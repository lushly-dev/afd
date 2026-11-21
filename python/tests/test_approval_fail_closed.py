"""A declared approval policy holds without the approval middleware (#1886).

The engine dispatches a gated call only when an approval step admitted it, and answers
``APPROVAL_UNAVAILABLE`` otherwise (spec/command-metadata.md, "Approvals"). Mirrors
``packages/server/src/approval-fail-closed.test.ts``.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.core.commands import CommandContext
from afd.core.result import CommandError, CommandResult, failure
from afd.direct import DirectClient, DirectClientOptions, create_direct_registry
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


async def test_a_caller_context_cannot_carry_an_admission():
    fixture = Fixture()
    server = fixture.server(middleware=[create_approval_middleware(secret=SECRET)])
    # A context reused from an admitted call admits nothing in the next call.
    seen: list[CommandContext] = []

    async def keep(name, input, context, next_fn):
        seen.append(context)
        return await next_fn()

    reuse = fixture.server(middleware=[keep])
    await server.execute("todo-touch", {"id": 1})
    expect_unavailable(await reuse.execute("todo-delete", {"id": 1}), "todo-delete")
    expect_unavailable(await reuse.execute("todo-delete", {"id": 1}, seen[0]), "todo-delete")
    assert fixture.ran == ["todo-touch:1"]


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
