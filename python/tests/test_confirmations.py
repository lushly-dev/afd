"""Confirmation enforcement (spec/command-metadata.md, "Confirmations") over real MCP sessions."""

import json

import pytest

pytest.importorskip("mcp")

import mcp_types as types  # noqa: E402
from mcp import Client  # noqa: E402

from afd import ExposeOptions, success  # noqa: E402
from afd.server import create_server  # noqa: E402
from afd.server.confirmations import (  # noqa: E402
    ConfirmationGate,
    ConfirmationStep,
    confirmation_binding,
)

MCP = ExposeOptions(mcp=True)


def _server(calls, **options):
    server = create_server(
        "confirm-test", tool_strategy=options.pop("tool_strategy", "individual"),
        confirmations=options.pop("confirmations", "enforce"), **options,
    )

    @server.command(
        name="todo-clear",
        description="Delete every todo",
        mutation=True,
        destructive=True,
        confirm_prompt="Delete every todo?",
        input_schema={
            "type": "object",
            "properties": {"scope": {"type": "string"}},
            "additionalProperties": False,
        },
        expose=MCP,
    )
    async def clear(input):
        scope = (input or {}).get("scope", "all")
        calls.append(f"clear:{scope}")
        return success({"cleared": scope})

    @server.command(name="todo-list", description="List todos", expose=MCP)
    async def listing(input):
        calls.append("list")
        return success([])

    return server


def _answer(action, prompts):
    async def callback(context, params):
        prompts.append(params.message)
        if action == "accept":
            return types.ElicitResult(action="accept", content={"confirm": True})
        if action == "unchecked":
            return types.ElicitResult(action="accept", content={"confirm": False})
        return types.ElicitResult(action=action)

    return callback


def body(result):
    return json.loads(result.content[0].text)


def test_binding_ignores_key_order_but_not_values():
    a = confirmation_binding([ConfirmationStep("x", {"a": 1, "b": {"c": 2, "d": 3}})])
    b = confirmation_binding([ConfirmationStep("x", {"b": {"d": 3, "c": 2}, "a": 1})])
    c = confirmation_binding([ConfirmationStep("x", {"a": 2, "b": {"c": 2, "d": 3}})])
    assert a == b and a != c


def test_unknown_mode_is_rejected():
    with pytest.raises(ValueError, match="confirmations"):
        ConfirmationGate("always", [])
    with pytest.raises(ValueError, match="confirmations"):
        create_server("bad", confirmations="always")


def test_gated_tools_advertise_confirm_only_under_enforce():
    tools = {tool["name"]: tool for tool in _server([]).get_tool_definitions()}
    assert "confirm" in tools["todo-clear"]["inputSchema"]["properties"]
    assert "confirm" not in tools["todo-list"]["inputSchema"].get("properties", {})
    off = {tool["name"]: tool for tool in _server([], confirmations="off").get_tool_definitions()}
    assert "confirm" not in off["todo-clear"]["inputSchema"]["properties"]


@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_accepted_elicitation_runs_the_command(mode):
    calls, prompts = [], []
    mcp = _server(calls)._create_mcp_server()
    async with Client(mcp, mode=mode, elicitation_callback=_answer("accept", prompts)) as client:
        result = await client.call_tool("todo-clear", {"scope": "done"})
    assert body(result)["success"] is True
    assert body(result)["data"] == {"cleared": "done"}
    assert prompts == ["Delete every todo?"]
    assert calls == ["clear:done"]


@pytest.mark.parametrize("mode", ["auto", "legacy"])
@pytest.mark.parametrize("action", ["decline", "cancel", "unchecked"])
async def test_declined_elicitation_refuses(mode, action):
    calls = []
    mcp = _server(calls)._create_mcp_server()
    async with Client(mcp, mode=mode, elicitation_callback=_answer(action, [])) as client:
        result = await client.call_tool("todo-clear", {})
    assert result.is_error
    error = body(result)["error"]
    assert error["code"] == "CONFIRMATION_DECLINED"
    assert error["retryable"] is False
    assert error["details"] == {"commands": ["todo-clear"]}
    assert calls == []


async def test_client_without_elicitation_must_acknowledge_and_confirm_is_stripped():
    calls = []
    mcp = _server(calls)._create_mcp_server()
    async with Client(mcp) as client:
        refused = await client.call_tool("todo-clear", {})
        error = body(refused)["error"]
        assert error["code"] == "CONFIRMATION_REQUIRED"
        assert error["message"] == "'todo-clear' needs confirmation: Delete every todo?"
        assert "confirm: true" in error["suggestion"]
        assert calls == []
        # additionalProperties is false, so a leaked `confirm` would fail validation.
        ran = await client.call_tool("todo-clear", {"confirm": True})
        assert body(ran)["success"] is True
        via_meta = await client.call_tool("todo-clear", {}, meta={"dev.afd/confirm": True})
        assert body(via_meta)["success"] is True
    assert calls == ["clear:all", "clear:all"]


async def test_require_human_refuses_the_acknowledgement():
    calls = []
    mcp = _server(calls, confirmations="require-human")._create_mcp_server()
    async with Client(mcp) as client:
        result = await client.call_tool("todo-clear", {"confirm": True})
    error = body(result)["error"]
    assert error["code"] == "CONFIRMATION_REQUIRED"
    assert "elicitation" in error["suggestion"]
    assert calls == []


async def test_off_gates_nothing():
    calls = []
    mcp = _server(calls, confirmations="off")._create_mcp_server()
    async with Client(mcp) as client:
        result = await client.call_tool("todo-clear", {})
    assert body(result)["success"] is True


async def test_meta_tools_are_gated_before_any_step_runs():
    calls = []
    mcp = _server(calls)._create_mcp_server()
    async with Client(mcp) as client:
        call = await client.call_tool("afd-call", {"command": "todo-clear", "input": {}})
        assert body(call)["error"]["code"] == "CONFIRMATION_REQUIRED"
        ok = await client.call_tool(
            "afd-call", {"command": "todo-clear", "input": {}, "confirm": True}
        )
        assert body(ok)["success"] is True

        batch_args = {"commands": [{"command": "todo-list"}, {"command": "todo-clear"}]}
        batch = await client.call_tool("afd-batch", batch_args)
        assert batch.is_error
        assert body(batch)["error"]["code"] == "CONFIRMATION_REQUIRED"
        assert calls == ["clear:all"]
        batch_ok = await client.call_tool("afd-batch", {**batch_args, "confirm": ["todo-clear"]})
        assert body(batch_ok)["success"] is True

        pipe_args = {"steps": [{"command": "todo-list"}, {"command": "todo-clear"}]}
        pipe = await client.call_tool("afd-pipe", pipe_args)
        assert body(pipe)["steps"][0]["error"]["code"] == "CONFIRMATION_REQUIRED"
        pipe_ok = await client.call_tool("afd-pipe", {**pipe_args, "confirm": ["todo-clear"]})
        assert not pipe_ok.is_error
    assert calls == ["clear:all", "list", "clear:all", "list", "clear:all"]


async def test_grouped_tools_are_gated():
    calls = []
    server = _server(calls, tool_strategy="grouped")
    tool = next(item for item in server.get_tool_definitions() if item["name"] == "todo")
    assert "confirm" in tool["inputSchema"]["properties"]
    async with Client(server._create_mcp_server()) as client:
        refused = await client.call_tool("todo", {"action": "clear", "params": {}})
        assert body(refused)["error"]["code"] == "CONFIRMATION_REQUIRED"
        ran = await client.call_tool("todo", {"action": "clear", "params": {}, "confirm": True})
        assert body(ran)["success"] is True
    assert calls == ["clear:all"]


async def test_in_process_execute_is_not_gated_but_call_tool_routes_like_mcp():
    calls = []
    server = _server(calls)
    assert (await server.execute("todo-clear", {})).success is True
    routed = await server.call_tool("todo-clear", {})
    assert routed.error.code == "CONFIRMATION_REQUIRED"
    assert calls == ["clear:all"]


# ── #532: the state is bound to the principal ─────────────────────────────────────────────

KEY = b"k" * 32
ACCEPT = {"confirm": types.ElicitResult(action="accept", content={"confirm": True})}


async def _ask(server, arguments):
    """The ``requestState`` the server mints for ``todo-clear``, for the caller of the block."""
    async with Client(server._create_mcp_server(), elicitation_callback=_answer("accept", [])) as client:
        asked = await client.session.call_tool("todo-clear", arguments, allow_input_required=True)
    assert type(asked).__name__ == "InputRequiredResult"
    return asked.request_state


async def _retry(server, arguments, state, responses=ACCEPT):
    """The retry's result, or the ``MCPError`` the SDK refused it with."""
    from mcp import MCPError

    async with Client(server._create_mcp_server(), elicitation_callback=_answer("accept", [])) as client:
        try:
            return await client.session.call_tool(
                "todo-clear",
                arguments,
                input_responses=responses,
                request_state=state,
                allow_input_required=True,
            )
        except MCPError as refused:
            return refused


def _refusal(refused):
    """What a client sees of a refused state: the code, the message and the data."""
    from mcp import MCPError

    assert isinstance(refused, MCPError), refused
    return (refused.code, str(refused), refused.error.data)


async def test_a_state_is_bound_to_the_actor_it_was_issued_to():
    from afd.core.actor import Actor

    calls = []
    issued_to = Actor(kind="agent", id="agent-a", label="Agent A", on_behalf_of="user-1")
    state = await _ask(_server(calls, confirmation_key=KEY, actor=issued_to), {"scope": "a"})

    # A tampered state is the reference: a caller the state was not issued to gets exactly
    # the same refusal, before any handler runs.
    tampered = _refusal(
        await _retry(_server(calls, confirmation_key=KEY, actor=issued_to), {"scope": "a"}, state[:-2] + "xx")
    )
    assert tampered[0] == -32602
    others = [
        Actor(kind="agent", id="agent-b", on_behalf_of="user-1"),
        Actor(kind="agent", id="agent-a", on_behalf_of="user-2"),
        Actor(kind="human", id="agent-a", on_behalf_of="user-1"),
        None,  # the server's default actor
    ]
    for other in others:
        refused = await _retry(_server(calls, confirmation_key=KEY, actor=other), {"scope": "a"}, state)
        assert _refusal(refused) == tampered, other
    # A decline in another caller's state is refused too, not taken as an answer.
    declined = {"confirm": types.ElicitResult(action="decline")}
    refused = await _retry(_server(calls, confirmation_key=KEY, actor=others[0]), {"scope": "a"}, state, declined)
    assert _refusal(refused) == tampered
    assert calls == []

    # The label is not bound: the same principal confirms with it.
    same = Actor(kind="agent", id="agent-a", label="Renamed", on_behalf_of="user-1")
    result = await _retry(_server(calls, confirmation_key=KEY, actor=same), {"scope": "a"}, state)
    assert body(result)["success"] is True
    assert calls == ["clear:a"]


async def test_a_state_is_bound_to_the_verified_token_issuer_subject_and_client():
    from mcp.server.auth.middleware.auth_context import auth_context_var
    from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
    from mcp.server.auth.provider import AccessToken

    def as_token(issuer, subject, client_id, scopes=("todo:write",)):
        token = AccessToken(
            token="opaque",
            client_id=client_id,
            scopes=list(scopes),
            subject=subject,
            claims={"iss": issuer},
        )
        return auth_context_var.set(AuthenticatedUser(token))

    calls = []
    server = _server(calls, confirmation_key=KEY)
    issued = ("https://auth.example.com", "user-1", "todo-agent")
    reset = as_token(*issued)
    try:
        state = await _ask(server, {"scope": "a"})
        tampered = _refusal(await _retry(server, {"scope": "a"}, state[:-2] + "xx"))
    finally:
        auth_context_var.reset(reset)
    for other in [
        ("https://other.example.com", "user-1", "todo-agent"),
        ("https://auth.example.com", "user-2", "todo-agent"),
        # The same person through another client is another principal.
        ("https://auth.example.com", "user-1", "other-agent"),
    ]:
        reset = as_token(*other)
        try:
            assert _refusal(await _retry(server, {"scope": "a"}, state)) == tampered, other
        finally:
            auth_context_var.reset(reset)
    # Without the token at all.
    assert _refusal(await _retry(server, {"scope": "a"}, state)) == tampered
    assert calls == []

    # Scopes are not bound: the same principal confirms with another token of theirs.
    reset = as_token(*issued, scopes=("todo:read",))
    try:
        result = await _retry(server, {"scope": "a"}, state)
    finally:
        auth_context_var.reset(reset)
    assert body(result)["success"] is True
    assert calls == ["clear:a"]


async def test_a_state_from_before_the_principal_binding_does_not_verify():
    """A state sealed with no principal (the SDK's default on a transport without a token,
    before #532) is refused as tampered."""
    calls = []
    old = _server([], confirmation_key=KEY)
    old._request_principal = lambda: None  # what bind_principal gave before #532
    state = await _ask(old, {"scope": "a"})
    server = _server(calls, confirmation_key=KEY)
    tampered = _refusal(await _retry(server, {"scope": "a"}, state[:-2] + "xx"))
    assert _refusal(await _retry(server, {"scope": "a"}, state)) == tampered
    assert calls == []


@pytest.mark.parametrize(
    "missing",
    [
        {"issuer": None},
        {"issuer": ""},
        {"subject": None},
        {"subject": ""},
        {"client_id": ""},
    ],
    ids=["no-issuer", "empty-issuer", "no-subject", "empty-subject", "empty-client"],
)
async def test_an_incomplete_token_identity_never_mints_or_takes_a_state(missing):
    """A verified token without an issuer, subject or client id is never bound: the call is
    refused with an internal error that names no one, whether it would mint a state or carries
    one, even one issued to a complete caller."""
    from mcp.server.auth.middleware.auth_context import auth_context_var
    from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
    from mcp.server.auth.provider import AccessToken
    from mcp_types import INTERNAL_ERROR

    def as_token(issuer, subject, client_id):
        token = AccessToken(
            token="opaque",
            client_id=client_id,
            scopes=["todo:write"],
            subject=subject,
            claims={} if issuer is None else {"iss": issuer},
        )
        return auth_context_var.set(AuthenticatedUser(token))

    calls = []
    server = _server(calls, confirmation_key=KEY)
    complete = {"issuer": "https://auth.example.com", "subject": "user-1", "client_id": "todo-agent"}
    reset = as_token(**complete)
    try:
        state = await _ask(server, {"scope": "a"})
    finally:
        auth_context_var.reset(reset)

    reset = as_token(**{**complete, **missing})
    try:
        async with Client(server._create_mcp_server(), elicitation_callback=_answer("accept", [])) as client:
            from mcp import MCPError

            with pytest.raises(MCPError) as minted:
                await client.session.call_tool("todo-clear", {"scope": "a"}, allow_input_required=True)
        retried = await _retry(server, {"scope": "a"}, state)
    finally:
        auth_context_var.reset(reset)
    for refused in (minted.value, retried):
        code, message, data = _refusal(refused)
        assert (code, message) == (INTERNAL_ERROR, "Internal error"), refused
        assert "user-1" not in repr((message, data)) and "todo-agent" not in repr((message, data))
    assert calls == []
