"""The recoveries Python's engines set on their own errors (spec/recovery.md, "Engine errors").

The shared vectors (dispatch.json, tool-strategies.json, app-calls.json) pin the rows they reach;
these tests pin the rest: the rate limiter, the declines, the reshaped and pending approvals,
``UNKNOWN_TOOL`` and ``COMMAND_NOT_ALLOWED``, the context commands, ``afd-help``, the core
registry and the direct registry. Where a row turns on what the caller can call, each test checks
the suggestion and the recovery together, since the engine decides both from one test.
"""

from __future__ import annotations

import json
import re
from typing import Any

import pytest

pytest.importorskip("mcp")

from mcp import Client  # noqa: E402

from afd import ExposeOptions, success  # noqa: E402
from afd.core.commands import (  # noqa: E402
    CommandContext,
    CommandDefinition,
    create_command_registry,
)
from afd.core.errors import (  # noqa: E402
    Recovery,
    internal_error,
    not_found_error,
    rate_limit_error,
    timeout_error,
    validation_error,
)
from afd.core.result import CommandResult  # noqa: E402
from afd.direct import (  # noqa: E402
    DirectClient,
    DirectClientOptions,
    create_direct_client,
    create_direct_registry,
    create_registry,
)
from afd.server import (  # noqa: E402
    ContextConfig,
    create_approval_middleware,
    create_server,
    define_command,
)
from afd.server.bootstrap.afd_context import (  # noqa: E402
    ContextState,
    create_afd_context_enter_command,
)
from afd.server.config import default_instructions  # noqa: E402
from afd.server.middleware import create_rate_limit_middleware  # noqa: E402
from tests.test_approval_relay import (  # noqa: E402
    MAX_UP_FRONT_APPROVALS,
    MODES,
    _call,
    _mcp_context,
)
from tests.test_approval_relay import _server as _relay_server  # noqa: E402
from tests.test_confirmations import _answer as _confirmation_answer  # noqa: E402
from tests.test_confirmations import _server as _confirmation_server  # noqa: E402

MCP = ExposeOptions(mcp=True)
SECRET = "engine-recoveries-test-secret-32b!"
CHECK_NAME = "Check the command name against the available commands."
SHARED_GROUPED_TEXT = (
    "Use afd-call with the full command name, or list tools to find a valid action."
)


def _body(result: Any) -> dict[str, Any]:
    return json.loads(result.content[0].text)


async def _ok(*_args: Any) -> CommandResult[Any]:
    return success(None)


# ── RATE_LIMITED ─────────────────────────────────────────────────────────────────────────────


async def test_a_full_window_retries_after_the_seconds_its_suggestion_gives():
    limiter = create_rate_limit_middleware(max_requests=0, window_ms=42_500)
    result = await limiter("item-read", {}, CommandContext(), _ok)
    error = result.error
    assert error is not None and error.code == "RATE_LIMITED" and error.retryable is True
    match = re.fullmatch(r"Try again in (\d+) seconds", error.suggestion or "")
    assert match is not None
    seconds = int(match.group(1))
    assert seconds == 43
    assert error.recovery == Recovery(kind="retry", after_ms=seconds * 1000)


async def test_a_full_client_capacity_retries_with_no_minimum_wait():
    limiter = create_rate_limit_middleware(
        max_requests=5, window_ms=60_000, key_fn=lambda ctx: ctx.trace_id, max_keys=1
    )
    first = await limiter("item-read", {}, CommandContext(trace_id="a"), _ok)
    assert first.success is True
    result = await limiter("item-read", {}, CommandContext(trace_id="b"), _ok)
    error = result.error
    assert error is not None and error.message == "Rate limit client capacity reached"
    assert error.retryable is True
    assert error.recovery == Recovery(kind="retry")


def test_rate_limit_error_retries_after_the_seconds_it_is_given():
    assert rate_limit_error(30).recovery == Recovery(kind="retry", after_ms=30_000)
    assert rate_limit_error().recovery == Recovery(kind="retry")
    assert rate_limit_error().retryable is True


@pytest.mark.parametrize(
    ("seconds", "after_ms"),
    [
        # Rounded up to whole milliseconds, so the wait is never shorter than the suggestion's.
        (0.0001, 1),
        (0.0015, 2),
        # Out of range or not a finite wait: a plain retry, never a raise.
        (-5, None),
        (10**15, None),
        (float("inf"), None),
        (float("nan"), None),
        (0, None),
    ],
)
def test_rate_limit_error_keeps_only_a_wait_the_recovery_can_carry(seconds, after_ms):
    error = rate_limit_error(seconds)
    assert error.code == "RATE_LIMITED" and error.retryable is True
    assert error.recovery == Recovery(kind="retry", after_ms=after_ms)


@pytest.mark.parametrize("window_ms", [10**19, float("inf")])
async def test_a_window_too_long_for_after_ms_retries_with_no_minimum_wait(window_ms):
    limiter = create_rate_limit_middleware(max_requests=0, window_ms=window_ms)
    result = await limiter("item-read", {}, CommandContext(), _ok)
    error = result.error
    assert error is not None and error.code == "RATE_LIMITED" and error.retryable is True
    assert error.recovery == Recovery(kind="retry")


def test_the_other_error_helpers_set_no_recovery():
    for error in (
        validation_error("Title is required"),
        not_found_error("Document", "doc-1"),
        timeout_error("fetch", 5000),
        internal_error("Processing failed"),
    ):
        assert error.recovery is None, error.code


# ── CONFIRMATION_DECLINED ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("action", ["decline", "cancel"])
async def test_a_declined_confirmation_stops(mode, action):
    mcp = _confirmation_server([])._create_mcp_server()
    async with Client(
        mcp, mode=mode, elicitation_callback=_confirmation_answer(action, [])
    ) as client:
        error = _body(await client.call_tool("todo-clear", {}))["error"]
    assert error["code"] == "CONFIRMATION_DECLINED"
    assert error["retryable"] is False
    assert error["recovery"] == {"kind": "stop"}


# ── APPROVAL_REQUIRED ────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("mode", MODES)
async def test_a_declined_approval_stops(mode):
    error = (await _call(_relay_server([]), mode, [], "decline"))["error"]
    assert error["details"]["reason"] == "declined"
    assert error["recovery"] == {"kind": "stop"}


@pytest.mark.parametrize("mode", MODES)
async def test_a_declined_batch_approval_stops(mode):
    request = {"commands": [{"command": "todo-clear", "input": {}}]}
    result = await _call(
        _relay_server([]), mode, [], "decline", tool="afd-batch", arguments=request
    )
    assert result["error"]["details"]["reason"] == "declined"
    assert result["error"]["recovery"] == {"kind": "stop"}


async def test_a_pipeline_whose_gated_step_reads_an_earlier_one_has_no_recovery():
    request = {
        "steps": [
            {"command": "todo-get", "input": {}},
            {"command": "todo-clear", "input": {"scope": "$prev.id"}},
        ]
    }
    result = await _call(
        _relay_server([]), "auto", [], "accept", tool="afd-pipe", arguments=request
    )
    error = result["steps"][0]["error"]
    assert error["details"]["reason"] == "input-not-known"
    assert "recovery" not in error


async def test_too_many_gated_steps_have_no_recovery():
    request = {
        "commands": [
            {"command": "todo-clear", "input": {"scope": str(at)}}
            for at in range(MAX_UP_FRONT_APPROVALS + 1)
        ]
    }
    server = _relay_server([], max_batch_size=50)
    result = await _call(server, "auto", [], "accept", tool="afd-batch", arguments=request)
    assert result["error"]["details"]["reason"] == "too-many-approvals"
    assert "recovery" not in result["error"]


async def test_a_gated_call_inside_another_command_has_no_recovery():
    server = _relay_server([])

    @server.command(name="todo-tidy", description="Tidy up", mutation=True, expose=MCP)
    async def tidy(input):
        return await server.execute("todo-clear", {}, _mcp_context())

    error = (await _call(server, "auto", [], "accept", tool="todo-tidy"))["error"]
    assert error["code"] == "APPROVAL_REQUIRED"
    assert "on its own" in error["suggestion"]
    assert "recovery" not in error


async def test_an_unanswered_approval_waits_for_a_person():
    async def fails(context, params):
        raise RuntimeError("client went away")

    async with Client(
        _relay_server([])._create_mcp_server(), mode="legacy", elicitation_callback=fails
    ) as client:
        error = _body(await client.call_tool("todo-clear", {}))["error"]
    assert "did not answer" in error["suggestion"]
    assert error["recovery"] == {"kind": "external"}


def _gated_registry():
    @define_command(name="todo-delete", description="Delete a todo", approval="required")
    async def delete(input: Any) -> CommandResult[Any]:
        return success(None)

    return create_direct_registry([delete], middleware=[create_approval_middleware(secret=SECRET)])


async def test_a_held_call_waits_for_a_person():
    server = create_server("held", middleware=[create_approval_middleware(secret=SECRET)])

    @server.command(name="todo-delete", description="Delete a todo", approval="required")
    async def delete(input: Any) -> CommandResult[Any]:
        return success(None)

    result = await server.execute("todo-delete", {}, CommandContext(extra={"interface": "agent"}))
    assert result.error is not None and result.error.code == "APPROVAL_REQUIRED"
    assert "approvalToken" in (result.error.details or {})
    assert result.error.recovery == Recovery(kind="external")


async def test_a_direct_client_whose_hook_declines_stops():
    client = DirectClient(
        _gated_registry(), DirectClientOptions(on_approval_needed=lambda request: False)
    )
    result = await client.call("todo-delete", {})
    error = result.error
    assert error is not None and error.code == "APPROVAL_REQUIRED"
    assert error.recovery == Recovery(kind="stop")
    assert error.suggestion == (
        "Do not run this again without asking the user first; the user chose not to approve it."
    )
    assert error.retryable is False


async def test_a_direct_client_with_no_hook_waits_for_a_person():
    result = await DirectClient(_gated_registry()).call("todo-delete", {})
    assert result.error is not None and result.error.recovery == Recovery(kind="external")


def _raise(request: Any) -> Any:
    raise RuntimeError("hook failed")


async def _reject(request: Any) -> Any:
    raise RuntimeError("hook failed")


@pytest.mark.parametrize(
    "hook",
    [_raise, _reject, lambda request: None, lambda request: "yes", lambda request: 1],
    ids=["raises", "rejects", "none", "string", "one"],
)
async def test_a_hook_that_fails_or_gives_no_boolean_leaves_the_hold(hook):
    # Only False is a decline: a hook that raises or answers anything else made no decision, so
    # the hold stands for a person, as with no hook (spec/recovery.md, "Engine errors").
    unhooked = (await DirectClient(_gated_registry()).call("todo-delete", {})).error
    client = DirectClient(_gated_registry(), DirectClientOptions(on_approval_needed=hook))
    error = (await client.call("todo-delete", {})).error
    assert error is not None and unhooked is not None and error.code == "APPROVAL_REQUIRED"
    assert error.recovery == Recovery(kind="external")
    assert error.suggestion == unhooked.suggestion


# ── UNKNOWN_TOOL and COMMAND_NOT_ALLOWED ─────────────────────────────────────────────────────


async def test_unknown_tool_has_no_recovery():
    registry = create_registry()

    @registry.command(name="item-read", description="Read an item")
    async def read():
        return success(None)

    result = await DirectClient(registry).call("item-raed", {})
    assert result.error is not None and result.error.code == "UNKNOWN_TOOL"
    assert result.error.recovery is None


async def test_a_command_the_allow_list_refuses_has_no_recovery():
    @define_command(name="item-read", description="Read an item")
    async def read(input: Any) -> CommandResult[Any]:
        return success(None)

    client = create_direct_client(create_direct_registry([read]), allow=lambda name: False)
    result = await client.call("item-read", {})
    assert result.error is not None and result.error.code == "COMMAND_NOT_ALLOWED"
    assert result.error.recovery is None


# ── Context commands ─────────────────────────────────────────────────────────────────────────


def _refusing(*names: str) -> CommandContext:
    from afd.core.direct_allow import _bind_allow

    return _bind_allow(CommandContext(), lambda name: name not in names)


async def test_entering_an_unknown_context_calls_afd_context_list():
    enter = create_afd_context_enter_command(
        lambda: [ContextConfig(name="planning"), ContextConfig(name="review")], ContextState()
    )
    result = await enter.handler({"context": "combat"}, CommandContext())
    assert result.error is not None and result.error.code == "CONTEXT_NOT_FOUND"
    assert result.error.suggestion == (
        "Available contexts: planning, review. Use afd-context-list to see all contexts."
    )
    assert result.error.recovery == Recovery(kind="call", command="afd-context-list")


async def test_entering_an_unknown_context_names_afd_context_list_only_when_callable():
    enter = create_afd_context_enter_command(
        lambda: [ContextConfig(name="planning")], ContextState()
    )
    result = await enter.handler({"context": "combat"}, _refusing("afd-context-list"))
    assert result.error is not None and result.error.code == "CONTEXT_NOT_FOUND"
    assert result.error.suggestion == "Available contexts: planning."
    assert result.error.recovery is None


async def test_entering_past_the_depth_limit_exits_first_then_retries():
    state = ContextState(max_depth=1)
    contexts = [ContextConfig(name="planning"), ContextConfig(name="combat")]
    enter = create_afd_context_enter_command(lambda: contexts, state)
    assert (await enter.handler({"context": "planning"}, CommandContext())).success is True
    result = await enter.handler({"context": "combat"}, CommandContext())
    assert result.error is not None and result.error.code == "CONTEXT_DEPTH_EXCEEDED"
    assert result.error.suggestion == (
        "Call afd-context-exit to leave a context before entering another"
    )
    assert result.error.recovery == Recovery(
        kind="call", command="afd-context-exit", then_retry=True
    )


async def test_entering_past_the_depth_limit_names_afd_context_exit_only_when_callable():
    state = ContextState(max_depth=1)
    contexts = [ContextConfig(name="planning"), ContextConfig(name="combat")]
    enter = create_afd_context_enter_command(lambda: contexts, state)
    assert (await enter.handler({"context": "planning"}, CommandContext())).success is True
    result = await enter.handler({"context": "combat"}, _refusing("afd-context-exit"))
    assert result.error is not None and result.error.code == "CONTEXT_DEPTH_EXCEEDED"
    assert result.error.suggestion == "Leave a context before entering another"
    assert result.error.recovery is None


async def test_server_execute_of_afd_context_enter_checks_the_callers_allow_list():
    server = create_server("ctx", contexts=[ContextConfig(name="planning")])
    found = await server.execute("afd-context-enter", {"context": "combat"}, CommandContext())
    assert found.error is not None and found.error.recovery == Recovery(
        kind="call", command="afd-context-list"
    )
    refused = await server.execute(
        "afd-context-enter", {"context": "combat"}, _refusing("afd-context-list")
    )
    assert refused.error is not None and refused.error.code == "CONTEXT_NOT_FOUND"
    assert refused.error.recovery is None
    assert "afd-context-list" not in (refused.error.suggestion or "")


async def test_not_in_context_drops_afd_context_enter_when_it_cannot_be_called():
    server = create_server("ctx", contexts=[ContextConfig(name="planning")])

    @server.command(name="plan-draft", description="Draft a plan", contexts=["planning"])
    async def draft(input: Any) -> CommandResult[Any]:
        return success(None)

    server._context_state.enter("other")
    both = await server.execute("plan-draft", {}, CommandContext())
    assert both.error is not None and both.error.suggestion == (
        "Use afd-context-list to see available contexts, or afd-context-enter to switch."
    )
    list_only = await server.execute("plan-draft", {}, _refusing("afd-context-enter"))
    assert list_only.error is not None and list_only.error.code == "COMMAND_NOT_IN_CONTEXT"
    assert list_only.error.suggestion == "Use afd-context-list to see available contexts."
    assert list_only.error.recovery == Recovery(kind="call", command="afd-context-list")


async def test_in_process_not_in_context_names_context_tools_only_when_callable():
    server = create_server("ctx", contexts=[ContextConfig(name="planning")])

    @server.command(
        name="plan-draft",
        description="Draft a plan",
        contexts=["planning"],
        expose=ExposeOptions(mcp=True, agent=True),
    )
    async def draft(input: Any) -> CommandResult[Any]:
        return success(None)

    server._context_state.enter("other")
    # server.execute serves the context commands it registers, so its caller can call them.
    in_process = await server.execute("plan-draft", {}, CommandContext(extra={"interface": "mcp"}))
    assert in_process.error is not None and in_process.error.code == "COMMAND_NOT_IN_CONTEXT"
    assert in_process.error.recovery == Recovery(kind="call", command="afd-context-list")
    assert "afd-context-list" in (in_process.error.suggestion or "")


async def test_a_direct_registry_names_the_commands_contexts_not_the_context_tools():
    @define_command(name="plan-draft", description="Draft a plan", contexts=["planning"])
    async def draft(input: Any) -> CommandResult[Any]:
        return success(None)

    registry = create_direct_registry([draft], contexts=[ContextConfig(name="planning")])
    registry._server._context_state.enter("other")
    # Only registered commands cross the direct boundary, never the server's context commands.
    result = await registry.execute("plan-draft", {})
    assert result.error is not None and result.error.code == "COMMAND_NOT_IN_CONTEXT"
    assert result.error.recovery is None
    assert result.error.suggestion == (
        "Switch to a context this command belongs to ('planning'), "
        "or call it with no active context."
    )


async def test_a_direct_registry_names_a_registered_afd_context_list():
    @define_command(name="plan-draft", description="Draft a plan", contexts=["planning"])
    async def draft(input: Any) -> CommandResult[Any]:
        return success(None)

    @define_command(name="afd-context-list", description="List contexts")
    async def list_contexts(input: Any) -> CommandResult[Any]:
        return success(None)

    @define_command(name="afd-context-enter", description="Enter a context")
    async def enter_context(input: Any) -> CommandResult[Any]:
        return success(None)

    # With no contexts configured the names are ordinary commands, which cross the boundary.
    listed = create_direct_registry([draft, list_contexts])
    listed._server._context_state.enter("other")
    # A registered afd-context-list is named; without afd-context-enter, only it.
    result = await listed.execute("plan-draft", {})
    assert result.error is not None and result.error.code == "COMMAND_NOT_IN_CONTEXT"
    assert result.error.recovery == Recovery(kind="call", command="afd-context-list")
    assert result.error.suggestion == "Use afd-context-list to see available contexts."

    both = create_direct_registry([draft, list_contexts, enter_context])
    both._server._context_state.enter("other")
    result = await both.execute("plan-draft", {})
    assert result.error is not None and result.error.suggestion == (
        "Use afd-context-list to see available contexts, or afd-context-enter to switch."
    )


async def test_an_allow_list_that_refuses_afd_context_list_keeps_it_unnamed():
    server = create_server("ctx", contexts=[ContextConfig(name="planning")])

    @server.command(name="plan-draft", description="Draft a plan", contexts=["planning"])
    async def draft(input: Any) -> CommandResult[Any]:
        return success(None)

    server._context_state.enter("other")
    from afd.core.direct_allow import _bind_allow

    context = _bind_allow(CommandContext(), lambda name: name == "plan-draft")
    result = await server.execute("plan-draft", {}, context)
    assert result.error is not None and result.error.code == "COMMAND_NOT_IN_CONTEXT"
    assert result.error.recovery is None
    assert "'planning'" in (result.error.suggestion or "")


# ── COMMAND_NOT_FOUND: afd-discover, afd-help or nothing ─────────────────────────────────────


def _plain_server(**options: Any):
    server = create_server("lookup", **options)

    @server.command(name="item-read", description="Read an item", expose=MCP)
    async def read(input: Any) -> CommandResult[Any]:
        return success(None)

    return server


DISCOVER = "Use afd-discover to list all commands."


async def test_server_execute_names_the_afd_discover_it_routes():
    # server.execute also runs the meta-tools outside the apps interface, so afd-discover is
    # callable there, with or without bootstrap, and its lookup ends as over MCP.
    for server in (_plain_server(), _plain_server(bootstrap=True)):
        result = await server.execute("zz-unknown", {}, CommandContext())
        assert result.error is not None and result.error.code == "COMMAND_NOT_FOUND"
        assert result.error.suggestion == DISCOVER
        assert result.error.recovery == Recovery(kind="call", command="afd-discover")
        assert (await server.execute("afd-discover", {}, CommandContext())).success is True


async def test_the_command_path_names_afd_help_when_bootstrap_serves_it():
    # The command path routes no meta-tool (the dispatch vectors' registry surface).
    result = await _plain_server(bootstrap=True)._execute_command("zz-unknown", {})
    assert result.error is not None and result.error.code == "COMMAND_NOT_FOUND"
    assert result.error.suggestion == "Use afd-help to list all commands."
    assert result.error.recovery == Recovery(kind="call", command="afd-help")
    # So does server.execute when an allow list refuses afd-discover.
    refused = await _plain_server(bootstrap=True).execute(
        "zz-unknown", {}, _refusing("afd-discover")
    )
    assert refused.error is not None and refused.error.suggestion == (
        "Use afd-help to list all commands."
    )
    assert refused.error.recovery == Recovery(kind="call", command="afd-help")


async def test_the_command_path_names_no_command_the_caller_cannot_call():
    # No bootstrap: afd-help is not registered, and this path does not route afd-discover.
    result = await _plain_server()._execute_command("zz-unknown", {}, CommandContext())
    assert result.error is not None and result.error.suggestion == CHECK_NAME
    assert result.error.recovery is None
    # A close match is still offered, ending the same way.
    near = await _plain_server()._execute_command("item-raed", {}, CommandContext())
    assert (
        near.error is not None
        and near.error.suggestion == f"Did you mean 'item-read'? {CHECK_NAME}"
    )
    assert near.error.recovery is None
    # An allow list that refuses both keeps them unnamed.
    as_agent = await _plain_server(bootstrap=True).execute(
        "zz-unknown", {}, _refusing("afd-discover", "afd-help")
    )
    assert as_agent.error is not None and as_agent.error.suggestion == CHECK_NAME
    assert as_agent.error.recovery is None


async def test_an_mcp_lookup_names_afd_discover_even_without_bootstrap():
    async with Client(_plain_server()._create_mcp_server()) as client:
        error = _body(await client.call_tool("afd-call", {"command": "zz-unknown"}))["error"]
    assert error["suggestion"] == "Use afd-discover to list all commands."
    assert error["recovery"] == {"kind": "call", "command": "afd-discover"}


async def test_a_grouped_tools_unknown_action_has_the_shared_text_and_no_recovery():
    async with Client(_plain_server()._create_mcp_server()) as client:
        error = _body(await client.call_tool("item", {"action": "wirte", "params": {}}))["error"]
    assert error["code"] == "COMMAND_NOT_FOUND"
    assert error["suggestion"] == SHARED_GROUPED_TEXT
    assert "recovery" not in error


async def test_afd_detail_per_entry_not_found_has_no_recovery():
    async with Client(_plain_server()._create_mcp_server()) as client:
        body = _body(await client.call_tool("afd-detail", {"command": ["item-read", "zz-unknown"]}))
    missing = next(entry for entry in body["data"] if entry["found"] is False)
    assert missing["error"]["code"] == "COMMAND_NOT_FOUND"
    assert "recovery" not in missing["error"]


# ── The core registry ────────────────────────────────────────────────────────────────────────


def _definition(name: str, **fields: Any) -> CommandDefinition:
    return CommandDefinition(name=name, description=f"The {name} command", handler=_ok, **fields)


async def test_the_core_registry_lookup_names_afd_help_only_when_callable():
    registry = create_command_registry()
    registry.register(_definition("item-read"))
    plain = await registry.execute("zz-unknown", {})
    assert plain.error is not None and plain.error.code == "COMMAND_NOT_FOUND"
    assert plain.error.suggestion == "List available commands to see valid options"
    assert plain.error.recovery is None

    registry.register(_definition("afd-help", expose=ExposeOptions(mcp=True, agent=False)))
    helped = await registry.execute("zz-unknown", {})
    assert helped.error is not None and helped.error.suggestion == (
        "Use afd-help to list all commands."
    )
    assert helped.error.recovery == Recovery(kind="call", command="afd-help")
    # Not exposed to the caller's interface: not named.
    hidden = await registry.execute("zz-unknown", {}, CommandContext(extra={"interface": "agent"}))
    assert hidden.error is not None and hidden.error.recovery is None
    assert hidden.error.suggestion == "List available commands to see valid options"


async def test_the_core_registry_names_afd_context_list_only_when_callable():
    registry = create_command_registry()
    registry.register(_definition("plan-draft", contexts=["planning"]))
    context = CommandContext(extra={"active_context": "combat"})
    without = await registry.execute("plan-draft", {}, context)
    assert without.error is not None and without.error.code == "COMMAND_NOT_IN_CONTEXT"
    assert without.error.recovery is None
    assert "'planning'" in (without.error.suggestion or "")

    registry.register(_definition("afd-context-list"))
    with_list = await registry.execute("plan-draft", {}, context)
    assert with_list.error is not None
    assert with_list.error.recovery == Recovery(kind="call", command="afd-context-list")
    # afd-context-enter is not registered, so the suggestion stops after afd-context-list.
    assert with_list.error.suggestion == "Use afd-context-list to see available contexts."

    registry.register(_definition("afd-context-enter"))
    with_enter = await registry.execute("plan-draft", {}, context)
    assert with_enter.error is not None
    assert with_enter.error.recovery == Recovery(kind="call", command="afd-context-list")
    assert with_enter.error.suggestion == (
        "Use afd-context-list to see available contexts, or afd-context-enter to switch."
    )


async def test_the_core_registry_refuses_an_unexposed_command_externally():
    registry = create_command_registry()
    registry.register(_definition("secret-rotate", expose=ExposeOptions(mcp=False)))
    result = await registry.execute("secret-rotate", {}, CommandContext(extra={"interface": "mcp"}))
    assert result.error is not None and result.error.code == "COMMAND_NOT_EXPOSED"
    assert result.error.recovery == Recovery(kind="external")


# ── The direct registry ──────────────────────────────────────────────────────────────────────


async def test_the_direct_registry_lookup_and_exposure():
    @define_command(name="item-read", description="Read an item")
    async def read(input: Any) -> CommandResult[Any]:
        return success(None)

    @define_command(
        name="secret-rotate", description="Rotate a secret", expose=ExposeOptions(agent=False)
    )
    async def rotate(input: Any) -> CommandResult[Any]:
        return success(None)

    registry = create_direct_registry([read, rotate])
    missing = await registry.execute("zz-unknown", {})
    assert missing.error is not None and missing.error.code == "COMMAND_NOT_FOUND"
    assert missing.error.recovery is None
    unexposed = await registry.execute("secret-rotate", {})
    assert unexposed.error is not None and unexposed.error.code == "COMMAND_NOT_EXPOSED"
    assert unexposed.error.recovery == Recovery(kind="external")

    @define_command(name="afd-help", description="List commands")
    async def help_(input: Any) -> CommandResult[Any]:
        return success(None)

    helped = await create_direct_registry([read, help_]).execute("zz-unknown", {})
    assert helped.error is not None
    assert helped.error.recovery == Recovery(kind="call", command="afd-help")
    assert helped.error.suggestion == "Use afd-help to list all commands."


# ── Instructions ─────────────────────────────────────────────────────────────────────────────


def test_the_default_instructions_say_what_error_recovery_is():
    assert default_instructions("srv", "grouped", []).startswith(
        "srv is an AFD server. Every tool returns a CommandResult as JSON text: "
        "{ success, data, error: { code, message, suggestion, recovery } }; follow "
        "error.suggestion to recover. When error.recovery is present, it is the same step in a "
        "form a program can follow. "
    )
