"""The MCP approval relay (#1312; spec/command-metadata.md, "Asking the human over MCP") over real
MCP sessions: on 2026-07-28 (``input_required``) and in band on a 2025 connection."""

import json

import pytest

pytest.importorskip("mcp")

import mcp_types as types  # noqa: E402
from mcp import Client  # noqa: E402

from afd import ExposeOptions, success  # noqa: E402
from afd.server import create_server  # noqa: E402
from afd.server.approval import create_approval_middleware  # noqa: E402
from afd.server.approval_relay import (  # noqa: E402
    APPROVAL_REQUESTED_SCHEMA,
    MAX_UP_FRONT_APPROVALS,
    reads_step_data,
    shown_input,
)

MCP = ExposeOptions(mcp=True)
SECRET = "s" * 32
MODES = ["auto", "legacy"]


def _gated_server(**options):
    """A server whose approval middleware is built on first use, from every command registered
    by then (a test may register more after ``approve``)."""
    holder = {}

    async def approval(name, input, context, next_fn):
        if "middleware" not in holder:
            holder["middleware"] = create_approval_middleware(
                secret=SECRET, commands=server.list_commands(), **holder["settings"]
            )
        return await holder["middleware"](name, input, context, next_fn)

    server = create_server("relay-test", middleware=[approval], **options)

    def approve(**settings):
        holder["settings"] = settings

    return server, approve


def _server(calls, *, relay="mcp-elicitation", tool_strategy="individual", **options):
    server, approve = _gated_server(tool_strategy=tool_strategy, **options)

    @server.command(
        name="todo-clear",
        description="Delete every todo",
        mutation=True,
        destructive=True,
        approval="required",
        confirm_prompt="Delete every todo?",
        input_schema={
            "type": "object",
            "properties": {"scope": {"type": "string", "default": "all"}},
            "additionalProperties": False,
        },
        expose=MCP,
    )
    async def clear(input):
        calls.append(f"clear:{input['scope']}")
        return success({"cleared": input["scope"]})

    @server.command(
        name="todo-get",
        description="Get a todo",
        input_schema={"type": "object", "properties": {"id": {"type": "string"}}},
        expose=MCP,
    )
    async def get(input):
        calls.append("get")
        return success({"id": input.get("id", "t1")})

    @server.command(
        name="todo-purge",
        description="Purge a todo when it is old",
        mutation=True,
        approval=lambda input, context: "required" if input.get("old") else "not-required",
        input_schema={"type": "object", "properties": {"old": {"type": "boolean"}}},
        expose=MCP,
    )
    async def purge(input):
        calls.append(f"purge:{bool(input.get('old'))}")
        return success({"purged": True})

    approve(
        relay=relay,
        include_token=False,
        summarize=lambda command, input, context: (
            f"Clear {input['scope']}" if command == "todo-clear" else None
        ),
    )
    return server


def _answer(prompts, *answers):
    """An elicitation callback answering with ``answers`` in turn (the last one after that)."""
    queue = list(answers)

    async def callback(context, params):
        prompts.append(params.message)
        action = queue.pop(0) if len(queue) > 1 else queue[0]
        if action == "accept":
            return types.ElicitResult(action="accept", content=_yes(params))
        if action == "unchecked":
            return types.ElicitResult(action="accept", content={"approve": False})
        return types.ElicitResult(action=action)

    return callback


def _yes(params):
    schema = params.requested_schema
    properties = schema.get("properties") if isinstance(schema, dict) else schema.properties
    return dict.fromkeys(properties, True)


def body(result):
    return json.loads(result.content[0].text)


async def _call(server, mode, prompts, *answers, tool="todo-clear", arguments=None):
    async with Client(
        server._create_mcp_server(), mode=mode, elicitation_callback=_answer(prompts, *answers)
    ) as client:
        return body(await client.call_tool(tool, arguments or {}))


# ── One command ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("mode", MODES)
async def test_an_approved_call_runs_and_the_question_shows_what_would_run(mode):
    calls, prompts = [], []
    result = await _call(_server(calls), mode, prompts, "accept", arguments={"scope": "done"})
    assert result["success"] is True
    assert calls == ["clear:done"]
    assert prompts == ['Clear done\n\nCommand: todo-clear\nInput: {"scope":"done"}']


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("action", ["decline", "cancel", "unchecked"])
async def test_a_declined_call_does_not_run(mode, action):
    calls, prompts = [], []
    result = await _call(_server(calls), mode, prompts, action)
    assert result["success"] is False
    error = result["error"]
    assert error["code"] == "APPROVAL_REQUIRED"
    assert error["retryable"] is False
    assert error["details"] == {"summary": "Clear all", "reason": "declined"}
    assert "Do not run this again" in error["suggestion"]
    assert calls == []


@pytest.mark.parametrize("mode", MODES)
async def test_every_single_command_route_asks(mode):
    calls, prompts = [], []
    via_call = await _call(
        _server(calls),
        mode,
        prompts,
        "accept",
        tool="afd-call",
        arguments={"command": "todo-clear"},
    )
    assert via_call["success"] is True
    grouped = _server(calls, tool_strategy="grouped")
    via_group = await _call(
        grouped, mode, prompts, "accept", tool="todo", arguments={"action": "clear", "params": {}}
    )
    assert via_group["success"] is True
    # A command the grouped list does not show, called by its own name (spec/tool-strategies.md,
    # "Routing"), is asked as its own tool is.
    by_name = await _call(_server(calls, tool_strategy="grouped"), mode, prompts, "accept")
    assert by_name["success"] is True
    assert calls == ["clear:all", "clear:all", "clear:all"]
    assert len(prompts) == 3


async def test_a_client_without_elicitation_gets_no_token():
    calls = []
    async with Client(_server(calls)._create_mcp_server()) as client:
        result = body(await client.call_tool("todo-clear", {}))
    error = result["error"]
    assert error["code"] == "APPROVAL_REQUIRED"
    assert "approvalToken" not in error["details"]
    assert "MCP client that supports form elicitation" in error["suggestion"]
    assert calls == []


async def test_without_the_relay_the_client_is_never_asked():
    calls, prompts = [], []
    result = await _call(_server(calls, relay="none"), "auto", prompts, "accept")
    assert result["error"]["code"] == "APPROVAL_REQUIRED"
    assert prompts == []
    assert calls == []


async def test_a_policy_that_lets_the_call_through_never_asks():
    calls, prompts = [], []
    result = await _call(_server(calls), "auto", prompts, "accept", tool="todo-purge")
    assert result["success"] is True
    assert prompts == []
    assert calls == ["purge:False"]


@pytest.mark.parametrize("mode", MODES)
async def test_a_confirmation_then_an_approval_are_asked_in_turn(mode):
    calls, prompts = [], []
    server = _server(calls, confirmations="require-human")
    result = await _call(server, mode, prompts, "accept")
    assert result["success"] is True
    assert calls == ["clear:all"]
    assert prompts[0] == "Delete every todo?"
    assert prompts[1].startswith("Clear all\n")
    assert len(prompts) == 2
    # The same under grouped, where todo-clear is not listed and is called by its own name.
    grouped = _server(calls, confirmations="require-human", tool_strategy="grouped")
    by_name = await _call(grouped, mode, prompts, "accept")
    assert by_name["success"] is True
    assert prompts[2] == "Delete every todo?"
    assert prompts[3].startswith("Clear all\n")


async def test_a_command_run_inside_another_cannot_ask():
    calls, prompts = [], []
    server = _server(calls)

    @server.command(name="todo-tidy", description="Tidy up", mutation=True, expose=MCP)
    async def tidy(input):
        return await server.execute("todo-clear", {}, _mcp_context())

    result = await _call(server, "auto", prompts, "accept", tool="todo-tidy")
    error = result["error"]
    assert error["code"] == "APPROVAL_REQUIRED"
    assert (
        "could not be asked from inside afd-batch, afd-pipe or another command"
        in error["suggestion"]
    )
    assert prompts == []
    assert calls == []


def _mcp_context():
    from afd.core.commands import CommandContext

    return CommandContext(extra={"interface": "mcp"})


# ── The requestState of 2026-07-28 ───────────────────────────────────────────────────────────


async def _ask(server, tool="todo-clear", arguments=None):
    async with Client(
        server._create_mcp_server(), elicitation_callback=_answer([], "accept")
    ) as client:
        asked = await client.session.call_tool(tool, arguments or {}, allow_input_required=True)
    assert type(asked).__name__ == "InputRequiredResult", asked
    return asked


async def _retry(server, state, responses, tool="todo-clear", arguments=None):
    """The retry's result, or the ``MCPError`` the SDK refused it with."""
    from mcp import MCPError

    async with Client(
        server._create_mcp_server(), elicitation_callback=_answer([], "accept")
    ) as client:
        try:
            return await client.session.call_tool(
                tool,
                arguments or {},
                input_responses=responses,
                request_state=state,
                allow_input_required=True,
            )
        except MCPError as refused:
            return refused


def _refused(result):
    """Whether the SDK refused the state: it was issued for another request."""
    from mcp import MCPError

    return isinstance(result, MCPError) and result.code == -32602


APPROVE = {"approval": types.ElicitResult(action="accept", content={"approve": True})}
KEY = b"k" * 32


async def test_the_question_is_a_form_with_one_required_boolean():
    asked = await _ask(_server([], confirmation_key=KEY))
    request = asked.input_requests["approval"]
    assert request.params.requested_schema == APPROVAL_REQUESTED_SCHEMA


async def test_an_approval_works_once():
    calls = []
    server = _server(calls, confirmation_key=KEY)
    state = (await _ask(server)).request_state
    assert body(await _retry(server, state, APPROVE))["success"] is True
    # The same retry again: the nonce is spent, so the human is asked again, saying why.
    again = await _retry(server, state, APPROVE)
    assert type(again).__name__ == "InputRequiredResult"
    assert again.input_requests["approval"].params.message.startswith(
        "The earlier approval expired or was already used"
    )
    assert calls == ["clear:all"]


async def test_an_approval_is_bound_to_the_input():
    calls = []
    server = _server(calls, confirmation_key=KEY)
    state = (await _ask(server, arguments={"scope": "done"})).request_state
    # The SDK binds the state to the request, so it is refused before any handler runs.
    assert _refused(await _retry(server, state, APPROVE, arguments={"scope": "everything"}))
    assert calls == []


async def test_an_answer_to_a_confirmation_is_never_an_approval():
    calls = []
    server = _server(calls, confirmation_key=KEY, confirmations="require-human")
    confirm = await _ask(server)
    assert list(confirm.input_requests) == ["confirm"]
    accepted = {"confirm": types.ElicitResult(action="accept", content={"confirm": True})}
    approval = await _retry(server, confirm.request_state, accepted)
    assert list(approval.input_requests) == ["approval"]
    # The confirmation's answer again, with no answer to the approval: still asked.
    again = await _retry(server, approval.request_state, accepted)
    assert list(again.input_requests) == ["approval"]
    # The confirmation's form under the approval's key: `approve` is not true, so declined.
    swapped = body(await _retry(server, approval.request_state, {"approval": accepted["confirm"]}))
    assert swapped["error"]["details"]["reason"] == "declined"
    assert calls == []
    # The approval answered: the confirmation carried forward, so it runs.
    assert body(await _retry(server, approval.request_state, APPROVE))["success"] is True
    assert calls == ["clear:all"]


async def test_an_expired_approval_is_asked_again():
    from afd import fixed_clock

    calls = []
    clock = fixed_clock(1_000_000)
    server, approve = _gated_server(tool_strategy="individual", confirmation_key=KEY)

    @server.command(
        name="todo-clear", description="Clear", mutation=True, approval="required", expose=MCP
    )
    async def clear(input):
        calls.append("clear")
        return success({})

    approve(relay="mcp-elicitation", ttl_ms=1000, clock=clock)
    state = (await _ask(server)).request_state
    clock.advance(1000)
    again = await _retry(server, state, APPROVE)
    assert type(again).__name__ == "InputRequiredResult"
    assert calls == []


# ── afd-batch and afd-pipe, approved up front ────────────────────────────────────────────────


@pytest.mark.parametrize("mode", MODES)
async def test_a_batch_is_approved_up_front_before_any_step_runs(mode):
    calls, prompts = [], []
    request = {
        "commands": [
            {"command": "todo-get", "input": {"id": "a"}},
            {"command": "todo-clear", "input": {"scope": "done"}},
            {"command": "todo-purge", "input": {"old": True}},
        ]
    }
    result = await _call(
        _server(calls), mode, prompts, "accept", tool="afd-batch", arguments=request
    )
    assert result["success"] is True
    assert sorted(calls) == ["clear:done", "get", "purge:True"]
    assert len(prompts) == 1
    assert prompts[0].startswith(
        "This batch includes 2 steps that need your approval. Approving lets each run once, "
        "exactly as shown; if you do not approve, nothing in the batch runs.\n\n"
        'Step 2: Clear done\nCommand: todo-clear\nInput: {"scope":"done"}\n\n'
        'Step 3: Run todo-purge\nCommand: todo-purge\nInput: {"old":true}'
    )


@pytest.mark.parametrize("mode", MODES)
async def test_a_declined_batch_runs_nothing(mode):
    calls, prompts = [], []
    request = {
        "commands": [
            {"command": "todo-get", "input": {}},
            {"command": "todo-clear", "input": {}},
        ]
    }
    result = await _call(
        _server(calls), mode, prompts, "decline", tool="afd-batch", arguments=request
    )
    assert result["success"] is False
    assert result["error"]["code"] == "APPROVAL_REQUIRED"
    assert result["error"]["details"]["reason"] == "declined"
    assert calls == []


async def test_a_batch_without_gated_steps_never_asks():
    calls, prompts = [], []
    request = {"commands": [{"command": "todo-purge", "input": {"old": False}}]}
    result = await _call(
        _server(calls), "auto", prompts, "accept", tool="afd-batch", arguments=request
    )
    assert result["success"] is True
    assert prompts == []


@pytest.mark.parametrize("mode", MODES)
async def test_a_pipeline_resolves_its_input_and_asks_once(mode):
    calls, prompts = [], []
    request = {
        "input": {"scope": "done"},
        "steps": [
            {"command": "todo-get", "input": {"id": "a"}},
            {
                "command": "todo-clear",
                "input": {"scope": "$input.scope"},
                "when": {"$exists": "$prev"},
            },
        ],
    }
    result = await _call(
        _server(calls), mode, prompts, "accept", tool="afd-pipe", arguments=request
    )
    assert [step["status"] for step in result["steps"]] == ["success", "success"], result
    assert calls == ["get", "clear:done"]
    assert "This pipeline includes a step that needs your approval" in prompts[0]
    assert "one step may run while another is skipped" in prompts[0]
    assert 'Input: {"scope":"done"}' in prompts[0]


async def test_a_gated_step_reading_an_earlier_step_runs_nothing():
    calls, prompts = [], []
    request = {
        "steps": [
            {"command": "todo-get", "input": {}},
            {"command": "todo-purge", "input": {"old": "$prev.old"}},
        ]
    }
    result = await _call(
        _server(calls), "auto", prompts, "accept", tool="afd-pipe", arguments=request
    )
    [refusal] = result["steps"]
    assert refusal["status"] == "failure"
    error = refusal["error"]
    assert error["code"] == "APPROVAL_REQUIRED"
    assert error["details"] == {"reason": "input-not-known", "step": 1, "command": "todo-purge"}
    assert prompts == []
    assert calls == []


async def test_too_many_gated_steps_run_nothing():
    calls, prompts = [], []
    request = {
        "commands": [
            {"command": "todo-clear", "input": {"scope": str(at)}}
            for at in range(MAX_UP_FRONT_APPROVALS + 1)
        ]
    }
    server = _server(calls, max_batch_size=50)
    result = await _call(server, "auto", prompts, "accept", tool="afd-batch", arguments=request)
    assert result["error"]["details"] == {
        "reason": "too-many-approvals",
        "limit": MAX_UP_FRONT_APPROVALS,
    }
    assert prompts == []
    assert calls == []


async def test_an_up_front_approval_covers_only_its_own_request():
    calls = []
    server = _server(calls, confirmation_key=KEY)
    request = {"commands": [{"command": "todo-clear", "input": {}}]}
    asked = await _ask(server, "afd-batch", request)
    # The same command on its own, or in a reordered batch, is not this approval.
    assert _refused(await _retry(server, asked.request_state, APPROVE))
    reordered = {"commands": [{"command": "todo-get", "input": {}}, *request["commands"]]}
    assert _refused(await _retry(server, asked.request_state, APPROVE, "afd-batch", reordered))
    assert calls == []
    ran = await _retry(server, asked.request_state, APPROVE, "afd-batch", request)
    assert body(ran)["success"] is True
    # A replay of the approved retry runs nothing.
    replay = await _retry(server, asked.request_state, APPROVE, "afd-batch", request)
    assert type(replay).__name__ == "InputRequiredResult"
    assert calls == ["clear:all"]


# ── Helpers ──────────────────────────────────────────────────────────────────────────────────


def test_reads_step_data_follows_the_reference_grammar():
    assert reads_step_data({"id": "$prev.id"})
    assert reads_step_data(["$first", 1])
    assert reads_step_data({"a": {"b": "$steps[0].x"}})
    assert reads_step_data("$steps.alias")
    assert not reads_step_data({"id": "$input.id"})
    assert not reads_step_data({"price": "$9.99", "escaped": "$$prev"})
    assert not reads_step_data({"id": 1})


def test_shown_input_is_cut_at_a_thousand_code_units():
    assert shown_input("x" * 1000) == "x" * 1000
    assert shown_input("x" * 1001) == "x" * 1000 + "…"
    assert shown_input("😀" * 501) == "😀" * 500 + "…"


def test_an_unknown_relay_mode_is_rejected():
    with pytest.raises(ValueError, match="relay"):
        create_approval_middleware(secret=SECRET, commands=[], relay="email")


# ── Regressions (review of #1312) ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("mode", MODES)
async def test_two_identical_gated_steps_need_two_approvals_and_both_run(mode):
    calls, prompts = [], []
    request = {
        "commands": [{"command": "todo-clear", "input": {}}, {"command": "todo-clear", "input": {}}]
    }
    result = await _call(
        _server(calls), mode, prompts, "accept", tool="afd-batch", arguments=request
    )
    assert result["success"] is True
    assert calls == ["clear:all", "clear:all"]
    assert "2 steps that need your approval" in prompts[0]


async def test_a_gated_command_hidden_from_mcp_is_never_named():
    calls, prompts = [], []
    server = _server(calls)

    @server.command(
        name="todo-secret",
        description="Hidden",
        mutation=True,
        approval="required",
        expose=ExposeOptions(mcp=False),
    )
    async def secret(input):
        calls.append("secret")
        return success({})

    request = {
        "commands": [{"command": "todo-secret", "input": {}}, {"command": "todo-get", "input": {}}]
    }
    result = await _call(server, "auto", prompts, "accept", tool="afd-batch", arguments=request)
    assert result["results"][0]["result"]["error"]["code"] == "COMMAND_NOT_FOUND"
    assert prompts == []
    assert "secret" not in calls


async def test_a_command_run_by_a_batch_steps_handler_cannot_take_its_approval():
    calls, prompts = [], []
    server = _server(calls)

    @server.command(
        name="todo-tidy",
        description="Tidy",
        mutation=True,
        approval="required",
        expose=MCP,
    )
    async def tidy(input):
        nested = await server.execute("todo-clear", {}, _mcp_context())
        calls.append(f"tidy:{nested.success}")
        return success({})

    request = {"commands": [{"command": "todo-tidy", "input": {}}]}
    result = await _call(server, "auto", prompts, "accept", tool="afd-batch", arguments=request)
    assert result["success"] is True
    assert calls == ["tidy:False"]


async def test_a_first_class_tool_asks():
    calls, prompts = [], []
    server = _server(calls, tool_strategy="hybrid", first_class_tools=["todo-clear"])
    assert (await _call(server, "auto", prompts, "accept"))["success"] is True
    assert calls == ["clear:all"]


@pytest.mark.parametrize("mode", MODES)
async def test_a_batch_needing_a_confirmation_and_an_approval_asks_each(mode):
    calls, prompts = [], []
    server = _server(calls, confirmations="require-human")
    request = {"commands": [{"command": "todo-clear", "input": {}}]}
    result = await _call(server, mode, prompts, "accept", tool="afd-batch", arguments=request)
    assert result["success"] is True
    assert calls == ["clear:all"]
    assert len(prompts) == 2


async def test_a_policy_that_raises_up_front_runs_nothing():
    calls, prompts = [], []
    server = _server(calls)

    def broken(input, context):
        raise RuntimeError("policy failed")

    @server.command(
        name="todo-break", description="Broken policy", mutation=True, approval=broken, expose=MCP
    )
    async def breaks(input):
        calls.append("break")
        return success({})

    request = {
        "commands": [{"command": "todo-get", "input": {}}, {"command": "todo-break", "input": {}}]
    }
    result = await _call(server, "auto", prompts, "accept", tool="afd-batch", arguments=request)
    assert all(item["result"]["success"] is False for item in result["results"]), result
    assert calls == []
    assert prompts == []


async def test_a_2025_client_that_gives_no_answer_is_not_said_to_decline():
    calls = []

    async def fails(context, params):
        raise RuntimeError("client went away")

    async with Client(
        _server(calls)._create_mcp_server(), mode="legacy", elicitation_callback=fails
    ) as client:
        result = body(await client.call_tool("todo-clear", {}))
    error = result["error"]
    assert error["code"] == "APPROVAL_REQUIRED"
    assert "did not answer" in error["suggestion"]
    assert "reason" not in (error.get("details") or {})
    assert calls == []


@pytest.mark.parametrize("reference", ["$first.id", "$steps[0].id", "$steps.first.id"])
async def test_input_not_known_for_every_step_reference(reference):
    calls, prompts = [], []
    request = {
        "steps": [
            {"command": "todo-get", "input": {}, "as": "first"},
            {"command": "todo-clear", "input": {"scope": reference}},
        ]
    }
    result = await _call(
        _server(calls), "auto", prompts, "accept", tool="afd-pipe", arguments=request
    )
    assert result["steps"][0]["error"]["details"]["reason"] == "input-not-known"
    assert calls == []


async def test_a_step_reading_an_earlier_step_without_a_policy_runs():
    calls, prompts = [], []
    request = {
        "steps": [
            {"command": "todo-get", "input": {}},
            {"command": "todo-get", "input": {"id": "$prev.id"}},
        ]
    }
    result = await _call(
        _server(calls), "auto", prompts, "accept", tool="afd-pipe", arguments=request
    )
    assert [step["status"] for step in result["steps"]] == ["success", "success"]
    assert prompts == []


async def test_a_spent_batch_approval_is_asked_again_saying_why():
    calls = []
    server = _server(calls, confirmation_key=KEY)
    request = {"commands": [{"command": "todo-clear", "input": {}}]}
    asked = await _ask(server, "afd-batch", request)
    assert (
        body(await _retry(server, asked.request_state, APPROVE, "afd-batch", request))["success"]
        is True
    )
    again = await _retry(server, asked.request_state, APPROVE, "afd-batch", request)
    assert again.input_requests["approval"].params.message.startswith(
        "The earlier approval expired, was already used or no longer matches"
    )


# ── A step runs on the input approved up front (#1414) ───────────────────────────────────────


def _notes(calls, **options):
    """A server with a gated command whose defaults differ from one validation to the next."""
    import uuid

    from pydantic import BaseModel, Field

    class NoteAdd(BaseModel):
        text: str
        id: str = Field(default_factory=lambda: uuid.uuid4().hex)

    server = _server(calls, **options)

    @server.command(
        name="note-add",
        description="Add a note",
        mutation=True,
        approval="required",
        input_schema=NoteAdd,
        expose=MCP,
    )
    async def add(input):
        calls.append(f"add:{input.id}")
        return success({"id": input.id})

    return server


def _shown(message):
    """``add:<id>`` for each ``note-add`` step a question shows."""
    return [
        f"add:{json.loads(line[len('Input: ') :])['id']}"
        for line in message.splitlines()
        if line.startswith("Input: ") and '"id"' in line
    ]


NOTES = {
    "commands": [
        {"command": "todo-get", "input": {}},
        {"command": "note-add", "input": {"text": "milk"}},
    ]
}


@pytest.mark.parametrize("mode", MODES)
async def test_a_gated_batch_step_with_a_random_default_runs_on_the_approved_input(mode):
    calls, prompts = [], []
    result = await _call(_notes(calls), mode, prompts, "accept", tool="afd-batch", arguments=NOTES)
    assert result["success"] is True, result
    # Asked once; the ungated step ran once, and the gated one on the id the human was shown.
    assert len(prompts) == 1
    assert len(_shown(prompts[0])) == 1
    assert calls == ["get", *_shown(prompts[0])]


@pytest.mark.parametrize("mode", MODES)
async def test_a_gated_pipeline_step_with_a_random_default_runs_on_the_approved_input(mode):
    calls, prompts = [], []
    request = {
        "input": {"text": "eggs"},
        "steps": [
            {"command": "todo-get"},
            {"command": "note-add", "input": {"text": "$input.text"}},
        ],
    }
    result = await _call(_notes(calls), mode, prompts, "accept", tool="afd-pipe", arguments=request)
    assert [step["status"] for step in result["steps"]] == ["success", "success"], result
    assert len(prompts) == 1
    assert calls == ["get", *_shown(prompts[0])]


def _listed_notes(calls):
    """``_notes``'s ``note-add`` with no policy of its own, gated only by the middleware's list."""
    import uuid
    from types import SimpleNamespace

    from pydantic import BaseModel, Field

    class NoteAdd(BaseModel):
        text: str
        id: str = Field(default_factory=lambda: uuid.uuid4().hex)

    listed = SimpleNamespace(name="note-add", approval="required", confirm_prompt=None)
    server = create_server(
        "relay-test",
        middleware=[
            create_approval_middleware(secret=SECRET, relay="mcp-elicitation", commands=[listed])
        ],
    )

    @server.command(name="todo-get", description="Get a todo", expose=MCP)
    async def get(input):
        calls.append("get")
        return success({})

    @server.command(
        name="note-add", description="Add a note", mutation=True, input_schema=NoteAdd, expose=MCP
    )
    async def add(input):
        calls.append(f"add:{input.id}")
        return success({"id": input.id})

    return server


@pytest.mark.parametrize("mode", MODES)
async def test_a_list_gated_batch_step_with_a_random_default_runs_on_the_approved_input(mode):
    calls, prompts = [], []
    result = await _call(
        _listed_notes(calls), mode, prompts, "accept", tool="afd-batch", arguments=NOTES
    )
    assert result["success"] is True, result
    assert len(prompts) == 1
    assert calls == ["get", *_shown(prompts[0])]


@pytest.mark.parametrize("mode", MODES)
async def test_two_steps_sent_alike_each_run_on_their_own_approved_input(mode):
    calls, prompts = [], []
    step = {"command": "note-add", "input": {"text": "milk"}}
    result = await _call(
        _notes(calls),
        mode,
        prompts,
        "accept",
        tool="afd-batch",
        arguments={"commands": [step, step]},
    )
    assert result["success"] is True, result
    shown = _shown(prompts[0])
    assert len(set(shown)) == 2
    assert sorted(calls) == sorted(shown)


async def test_an_approved_input_does_not_run_in_another_request():
    calls = []
    server = _notes(calls)
    asked = await _ask(server, "afd-batch", NOTES)
    other = {
        "commands": [NOTES["commands"][0], {"command": "note-add", "input": {"text": "bleach"}}]
    }
    retried = await _retry(server, asked.request_state, APPROVE, "afd-batch", other)
    # Refused, or asked again about the new request: either way nothing ran.
    assert _refused(retried) or type(retried).__name__ == "InputRequiredResult"
    assert calls == []


def test_an_approved_input_the_schema_does_not_read_back_is_validated_again():
    from afd.server.approval_relay import _batch_steps

    def validate(command, input):
        # Unknown keys are dropped, as a schema that strips them does.
        return True, {"text": input["text"], "id": input.get("id", "fresh")}

    request = {"commands": [{"command": "note-add", "input": {"text": "milk"}}]}
    kept = _batch_steps(request, validate, {0: '{"id":"shown","text":"milk"}'})
    assert kept[0].input == {"text": "milk", "id": "shown"}
    assert kept[0].sent == '{"text":"milk"}'
    for altered in ("{", '{"extra":1,"id":"shown","text":"milk"}', '{"id":"shown"}'):
        again = _batch_steps(request, validate, {0: altered})
        assert again[0].valid and again[0].input == {"text": "milk", "id": "fresh"}


def _items(calls, *, gated_server=True):
    """A server whose ``item-touch`` and ``item-wipe`` schemas check the store: the item must
    exist. ``gated_server=False`` installs no approval middleware."""
    from pydantic import BaseModel, field_validator

    store = {1}

    class Existing(BaseModel):
        id: int

        @field_validator("id")
        @classmethod
        def exists(cls, value):
            if value not in store:
                raise ValueError("No such item")
            return value

    server = _server(calls) if gated_server else create_server("relay-test")

    @server.command(
        name="item-remove",
        description="Remove an item",
        mutation=True,
        input_schema={"type": "object", "properties": {"id": {"type": "integer"}}},
        expose=MCP,
    )
    async def remove(input):
        store.discard(input["id"])
        calls.append(f"remove:{input['id']}")
        return success({"removed": input["id"]})

    @server.command(
        name="item-touch",
        description="Touch an item",
        mutation=True,
        input_schema=Existing,
        expose=MCP,
    )
    async def touch(input):
        calls.append(f"touch:{input.id}")
        return success({"touched": input.id})

    @server.command(
        name="item-wipe",
        description="Wipe an item",
        mutation=True,
        approval="required",
        input_schema=Existing,
        expose=MCP,
    )
    async def wipe(input):
        calls.append(f"wipe:{input.id}")
        return success({"wiped": input.id})

    return server


def _codes(result):
    return [(item["result"].get("error") or {}).get("code") for item in result["results"]]


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("gated_server", [True, False])
@pytest.mark.parametrize("second", ["item-touch", "item-wipe"])
async def test_a_step_is_still_validated_when_it_runs(mode, gated_server, second):
    """A schema that checks state an earlier step changed fails the step, approved or not."""
    calls, prompts = [], []
    request = {
        "commands": [
            {"command": "item-remove", "input": {"id": 1}},
            {"command": second, "input": {"id": 1}},
        ]
    }
    result = await _call(
        _items(calls, gated_server=gated_server),
        mode,
        prompts,
        "accept",
        tool="afd-batch",
        arguments=request,
    )
    assert _codes(result) == [None, "VALIDATION_ERROR"], result
    assert calls == ["remove:1"]
    # Asked about the gated step only where a middleware gates it: it was valid then.
    assert len(prompts) == (1 if gated_server and second == "item-wipe" else 0)


async def test_a_step_too_long_to_keep_is_refused_on_the_retry_not_asked_again():
    """A gated step whose input is not kept, with a random default, would be asked about again on
    every retry: the retry gets a final refusal instead (#1511)."""
    from afd.server.approval_relay import MAX_KEPT_INPUT

    calls = []
    # A fixed key, so the retry's server reads the request state the first one issued.
    server = _notes(calls, confirmation_key=KEY)
    long = {
        "commands": [
            {"command": "todo-get", "input": {}},
            {"command": "note-add", "input": {"text": "x" * MAX_KEPT_INPUT}},
        ]
    }
    asked = await _ask(server, "afd-batch", long)
    retried = await _retry(server, asked.request_state, APPROVE, "afd-batch", long)
    assert type(retried).__name__ != "InputRequiredResult", retried
    refused = body(retried)
    assert refused["success"] is False, refused
    error = refused["error"]
    assert error["code"] == "APPROVAL_REQUIRED"
    assert error["details"] == {"reason": "input-not-kept", "step": 1, "command": "note-add"}
    assert "Call note-add on its own" in error["suggestion"]
    assert calls == []


def _slots(calls):
    """A server whose ``slot-claim`` id defaults to the next free slot and must be free, and whose
    ``slot-take`` takes one."""
    from pydantic import BaseModel, Field, field_validator

    store = {1}

    class Claim(BaseModel):
        id: int = Field(default_factory=lambda: max(store) + 1)

        @field_validator("id")
        @classmethod
        def free(cls, value):
            if value in store:
                raise ValueError("Slot taken")
            return value

    server = _server(calls)

    @server.command(
        name="slot-take",
        description="Take a slot",
        mutation=True,
        input_schema={"type": "object", "properties": {"id": {"type": "integer"}}},
        expose=MCP,
    )
    async def take(input):
        store.add(input["id"])
        calls.append(f"take:{input['id']}")
        return success({"taken": input["id"]})

    @server.command(
        name="slot-claim",
        description="Claim the next free slot",
        mutation=True,
        approval="required",
        input_schema=Claim,
        expose=MCP,
    )
    async def claim(input):
        calls.append(f"claim:{input.id}")
        return success({"claimed": input.id})

    return server


@pytest.mark.parametrize("mode", MODES)
async def test_an_approved_input_an_earlier_step_made_invalid_fails_when_it_runs(mode):
    """The approved input itself is validated when the step runs, not only the input as sent,
    whose fresh default may pass where the approved one fails (#1511)."""
    calls, prompts = [], []
    request = {
        "commands": [
            {"command": "slot-take", "input": {"id": 2}},
            {"command": "slot-claim", "input": {}},
        ]
    }
    result = await _call(
        _slots(calls), mode, prompts, "accept", tool="afd-batch", arguments=request
    )
    # Slot 2 was approved, the next free one when asked. As sent, the step now defaults to slot 3,
    # which is free; slot 2, the one that would run, is taken.
    assert len(prompts) == 1
    assert '"id":2' in prompts[0]
    assert _codes(result) == [None, "VALIDATION_ERROR"], result
    assert calls == ["take:2"]


async def test_an_expired_approval_of_a_step_too_long_to_keep_is_asked_again():
    """The same long input validates to itself every time: an approval of its own binding that
    only expired is asked about again, not refused as ``input-not-kept`` (#1511)."""
    from pydantic import BaseModel

    from afd import fixed_clock
    from afd.server.approval_relay import MAX_KEPT_INPUT

    class Memo(BaseModel):
        text: str

    calls = []
    clock = fixed_clock(1_000_000)
    server, approve = _gated_server(tool_strategy="individual", confirmation_key=KEY)

    @server.command(
        name="memo-add",
        description="Add a memo",
        mutation=True,
        approval="required",
        input_schema=Memo,
        expose=MCP,
    )
    async def add(input):
        calls.append(len(input.text))
        return success({})

    approve(relay="mcp-elicitation", ttl_ms=1000, clock=clock)
    long = {"commands": [{"command": "memo-add", "input": {"text": "x" * MAX_KEPT_INPUT}}]}
    state = (await _ask(server, "afd-batch", long)).request_state
    clock.advance(1000)
    again = await _retry(server, state, APPROVE, "afd-batch", long)
    assert type(again).__name__ == "InputRequiredResult", again
    assert calls == []


def test_a_validator_that_raises_fails_the_approved_input_check():
    """A validator that raises while the approved input is checked fails the step with
    ``VALIDATION_ERROR`` and a suggestion, as its own validation would (#1511)."""
    from pydantic import BaseModel, field_validator

    from afd.server.up_front_check import check_approved_at_run

    class Broken(BaseModel):
        id: int

        @field_validator("id")
        @classmethod
        def boom(cls, value):
            raise RuntimeError("store unavailable")

    refused = check_approved_at_run("slot-claim", Broken, {"id": 2}, 100)
    assert refused is not None
    assert refused.error.code == "VALIDATION_ERROR"
    assert refused.error.suggestion


def test_an_approved_input_the_schema_does_not_read_back_unchanged_fails():
    """A validator that returns another value fails the approved input's check: the value that
    would run is not the one approved (#1511)."""
    from pydantic import BaseModel, field_validator

    from afd.server.up_front_check import check_approved_at_run

    class Scaled(BaseModel):
        cents: int

        @field_validator("cents")
        @classmethod
        def scale(cls, value):
            return value * 100

    refused = check_approved_at_run("price-set", Scaled, Scaled(cents=5), 100)
    assert refused is not None
    assert refused.error.code == "VALIDATION_ERROR"
    assert refused.error.suggestion
