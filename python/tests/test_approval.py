"""The approval policy and middleware (spec/command-metadata.md, "Approvals"; #420).

Time comes from an injected clock, never from sleeping.
"""

from __future__ import annotations

import base64
import json
import math
from typing import Annotated, Any, Optional

import pytest
from pydantic import (
    BaseModel,
    Field,
    PlainSerializer,
    SecretStr,
    field_serializer,
    model_serializer,
)

from afd import Actor, ExposeOptions, approval_mode, fixed_clock, success
from afd.core.commands import CommandContext, CommandDefinition, command_to_mcp_tool
from afd.server import (
    ApprovalRequest,
    create_approval_middleware,
    create_server,
    define_command,
)
from afd.server.approval import _MemoryNonceStore, _b64url, _canonical_json, _hmac

SECRET = "test-approval-secret-0123456789abcdef"
OTHER_SECRET = "another-approval-secret-0123456789abcdef"
NOW = 1_761_480_000_000
MCP = ExposeOptions(mcp=True)
AGENT = Actor(kind="agent", id="claude", label="Claude", on_behalf_of="user-1")


async def _handler(input: Any, context: Any = None):
    return success("ran")


def _command(name: str = "todo-delete", approval: Any = "required", **fields: Any) -> CommandDefinition:
    return CommandDefinition(
        name=name, description="Delete a todo", handler=_handler, approval=approval, **fields
    )


class Gate:
    """One middleware with a manual clock, and a record of the calls that reached the handler."""

    def __init__(self, commands: Optional[list[Any]] = None, **options: Any) -> None:
        self.clock = options.pop("clock", None) or fixed_clock(NOW)
        self.ran: list[str] = []
        self.middleware = create_approval_middleware(
            secret=options.pop("secret", SECRET),
            commands=commands if commands is not None else [_command()],
            clock=self.clock,
            **options,
        )

    async def call(
        self,
        input: Any = None,
        *,
        token: Any = None,
        name: str = "todo-delete",
        actor: Optional[Actor] = AGENT,
        context: Optional[CommandContext] = None,
    ):
        async def next_fn():
            self.ran.append(name)
            return success("ran")

        context = context or CommandContext(actor=actor, approval=token)
        return await self.middleware(name, {"id": 42} if input is None else input, context, next_fn)

    async def token(self, input: Any = None, **kwargs: Any) -> str:
        result = await self.call(input, **kwargs)
        assert result.error is not None and result.error.code == "APPROVAL_REQUIRED"
        return result.error.details["approvalToken"]


def _reason(result) -> Optional[str]:
    assert result.success is False and result.error.code == "APPROVAL_REQUIRED"
    return result.error.details.get("reason")


def _payload(token: str) -> dict[str, Any]:
    encoded = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))


def _forge(payload_json: str, secret: str = SECRET) -> str:
    """A token over any payload, signed with ``secret``."""
    signing_input = f"afdap1.{_b64url(payload_json.encode())}"
    return f"{signing_input}.{_b64url(_hmac(secret.encode(), signing_input))}"


# ─── Reporting ──────────────────────────────────────────────────────────────


def test_approval_mode_reports_a_function_as_conditional():
    assert approval_mode("required") == "required"
    assert approval_mode("not-required") == "not-required"
    assert approval_mode(lambda input, context: "required") == "conditional"
    assert approval_mode(None) is None
    assert approval_mode("sometimes") is None  # type: ignore[arg-type]


def test_meta_approval_is_reported_only_when_declared():
    assert command_to_mcp_tool(_command())["_meta"]["approval"] == "required"
    conditional = _command(approval=lambda input, context: "not-required")
    assert command_to_mcp_tool(conditional)["_meta"]["approval"] == "conditional"
    assert "approval" not in command_to_mcp_tool(_command(approval=None))["_meta"]


def test_define_command_rejects_an_invalid_policy():
    with pytest.raises(TypeError, match="invalid approval policy"):
        define_command(name="todo-delete", description="x", approval="always")  # type: ignore[arg-type]


async def test_server_reports_approval_and_version_in_meta_detail_and_docs():
    server = create_server("approval-meta")

    @server.command(
        name="todo-delete",
        description="Delete a todo",
        mutation=True,
        approval=lambda input, context: "required",
        version="2.1.0",
        expose=MCP,
    )
    async def delete(input):
        return success("deleted")

    tool = next(tool for tool in server.get_tool_definitions() if tool["name"] == "todo-delete")
    assert tool["_meta"]["approval"] == "conditional"
    assert "version" not in tool["_meta"]  # As in TypeScript: afd-detail and results only.

    detail = await server.call_tool("afd-detail", {"command": "todo-delete"})
    entry = detail.data[0] if isinstance(detail.data, list) else detail.data["commands"][0]
    assert entry["approval"] == "conditional"
    assert entry["version"] == "2.1.0"

    docs = await server.execute("afd-docs", {"command": "todo-delete"})
    assert "**Approval:** conditional" in docs.data.markdown

    result = await server.execute("todo-delete", {})
    assert result.metadata.command_version == "2.1.0"


# ─── Construction ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("secret", [None, [], 42, object()])
def test_secret_is_required(secret):
    with pytest.raises(TypeError, match="secret is required"):
        create_approval_middleware(secret=secret, commands=[])


@pytest.mark.parametrize("secret", ["short", b"x" * 31, [SECRET, "short"]])
def test_secret_must_be_32_bytes(secret):
    with pytest.raises(ValueError, match="at least 32 bytes"):
        create_approval_middleware(secret=secret, commands=[])


def test_secret_may_be_bytes():
    create_approval_middleware(secret=b"\x00" * 32, commands=[])
    create_approval_middleware(secret=bytearray(32), commands=[])


@pytest.mark.parametrize("ttl_ms", [0, -1, 24 * 60 * 60_000 + 1, math.nan, math.inf, True, "60000"])
def test_ttl_must_be_positive_and_at_most_a_day(ttl_ms):
    with pytest.raises(ValueError, match="ttl_ms"):
        create_approval_middleware(secret=SECRET, commands=[], ttl_ms=ttl_ms)


def test_replay_mode_is_checked():
    with pytest.raises(ValueError, match="replay"):
        create_approval_middleware(secret=SECRET, commands=[], replay="forever")  # type: ignore[arg-type]


def test_an_invalid_policy_on_a_listed_command_is_rejected():
    with pytest.raises(TypeError, match="invalid approval policy"):
        create_approval_middleware(secret=SECRET, commands=[_command(approval="always")])


def test_commands_must_be_definitions_or_decorated_functions():
    with pytest.raises(TypeError, match="CommandDefinition"):
        create_approval_middleware(secret=SECRET, commands=[42])


# ─── Gating ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("approval", [None, "not-required"])
async def test_commands_without_a_requirement_run(approval):
    gate = Gate([_command(approval=approval)])
    result = await gate.call()
    assert result.success and gate.ran == ["todo-delete"]


async def test_an_unlisted_command_is_never_held():
    gate = Gate([])
    assert (await gate.call()).success


async def test_a_required_call_is_held_before_the_handler():
    gate = Gate([_command(confirm_prompt="Delete todo 42 (permanent)")])
    result = await gate.call()
    assert gate.ran == []
    assert result.success is False
    error = result.error
    assert error.code == "APPROVAL_REQUIRED"
    assert error.retryable is False
    assert error.message == "todo-delete needs approval before it runs"
    assert set(error.details) == {"approvalToken", "expiresAt", "summary"}
    assert error.details["summary"] == "Delete todo 42 (permanent)"
    assert error.details["expiresAt"] == "2025-10-26T12:05:00.000Z"
    assert error.details["approvalToken"].startswith("afdap1.")
    assert error.suggestion == (
        'Ask the user to approve "Delete todo 42 (permanent)"; once they approve, the '
        "application retries the same call with the same input and details.approvalToken as "
        "its approval evidence (tool arguments cannot carry it). The token expires at "
        "2025-10-26T12:05:00.000Z and works once."
    )


async def test_summary_defaults_and_overrides():
    plain = Gate()
    assert (await plain.call()).error.details["summary"] == "Run todo-delete"

    seen = []

    def summarize(name, input, context):
        seen.append((name, input, context.actor.id))
        return f"Delete todo {input['id']}"

    custom = Gate([_command(confirm_prompt="Delete?")], summarize=summarize)
    assert (await custom.call()).error.details["summary"] == "Delete todo 42"
    assert seen == [("todo-delete", {"id": 42}, "claude")]

    empty = Gate([_command(confirm_prompt="Delete?")], summarize=lambda *args: "")
    assert (await empty.call()).error.details["summary"] == "Delete?"


async def test_an_approved_retry_runs_once():
    gate = Gate()
    token = await gate.token()
    assert (await gate.call(token=token)).success
    assert gate.ran == ["todo-delete"]

    again = await gate.call(token=token)
    assert _reason(again) == "already-used"
    assert gate.ran == ["todo-delete"]
    fresh = again.error.details["approvalToken"]
    assert fresh != token
    assert "The approval token was not accepted (already-used). " in again.error.suggestion
    assert (await gate.call(token=fresh)).success


async def test_within_ttl_allows_reuse_until_expiry():
    gate = Gate(replay="within-ttl")
    token = await gate.token()
    assert (await gate.call(token=token)).success
    assert (await gate.call(token=token)).success
    gate.clock.advance(5 * 60_000)
    assert _reason(await gate.call(token=token)) == "expired"
    assert "works once" not in (await gate.call()).error.suggestion


async def test_a_conditional_policy_sees_the_input_and_context():
    def policy(input, context):
        return "required" if context.actor.kind == "agent" and input["id"] > 10 else "not-required"

    gate = Gate([_command(approval=policy)])
    assert (await gate.call({"id": 5})).success
    assert (await gate.call({"id": 42}, actor=Actor(kind="human"))).success
    assert _reason(await gate.call({"id": 42})) is None
    assert gate.ran == ["todo-delete", "todo-delete"]


async def test_an_async_policy_is_awaited():
    async def policy(input, context):
        return "not-required"

    assert (await Gate([_command(approval=policy)]).call()).success


@pytest.mark.parametrize("decision", ["Not-Required", None, True, "", "maybe"])
async def test_a_policy_fails_closed(decision):
    gate = Gate([_command(approval=lambda input, context: decision)])
    assert _reason(await gate.call()) is None
    assert gate.ran == []


async def test_a_policy_that_raises_fails_the_call_before_the_handler():
    def policy(input, context):
        raise RuntimeError("policy store down")

    gate = Gate([_command(approval=policy)])
    with pytest.raises(RuntimeError, match="policy store down"):
        await gate.call()
    assert gate.ran == []


# ─── Rejections ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "token",
    [
        42,
        b"afdap1.x.y",
        "",
        "afdap1",
        "afdap1.only-two",
        "afdap2.a.b",
        "afdap1.a.b.c",
        "afdap1." + "a" * 1100 + ".b",
    ],
)
async def test_malformed_evidence(token):
    gate = Gate()
    assert _reason(await gate.call(token=token)) == "malformed"
    assert gate.ran == []


@pytest.mark.parametrize(
    "payload",
    [
        "not json",
        "[1,2]",
        '{"c":"todo-delete","i":"x","a":"y","iat":1,"exp":2}',
        '{"c":"todo-delete","i":"x","a":"y","iat":1,"exp":"2","n":"z"}',
        '{"c":"todo-delete","i":"x","a":"y","iat":1,"exp":true,"n":"z"}',
        '{"c":"todo-delete","i":"x","a":"y","iat":1,"exp":Infinity,"n":"z"}',
        '{"c":7,"i":"x","a":"y","iat":1,"exp":2,"n":"z"}',
    ],
)
async def test_a_signed_but_malformed_payload_is_malformed(payload):
    gate = Gate()
    assert _reason(await gate.call(token=_forge(payload))) == "malformed"


async def test_a_token_from_another_secret_has_an_invalid_signature():
    other = Gate(secret=OTHER_SECRET)
    gate = Gate()
    assert _reason(await gate.call(token=await other.token())) == "invalid-signature"


async def test_a_tampered_token_has_an_invalid_signature():
    gate = Gate()
    token = await gate.token()
    prefix, payload, mac = token.split(".")
    flipped = mac[:-1] + ("A" if mac[-1] != "A" else "B")
    assert _reason(await gate.call(token=f"{prefix}.{payload}.{flipped}")) == "invalid-signature"
    # A payload re-encoded with padding is another spelling: the MAC covers the text.
    assert _reason(await gate.call(token=f"{prefix}.{payload}=.{mac}")) == "invalid-signature"
    forged = _payload(token) | {"exp": NOW * 2}
    forged_payload = _b64url(json.dumps(forged, separators=(",", ":")).encode())
    assert _reason(await gate.call(token=f"{prefix}.{forged_payload}.{mac}")) == "invalid-signature"


async def test_a_token_expires_on_the_server_clock():
    gate = Gate(ttl_ms=60_000)
    token = await gate.token()
    gate.clock.advance(59_999)
    assert (await gate.call(token=token)).success

    token = await gate.token()
    gate.clock.advance(60_000)
    assert _reason(await gate.call(token=token)) == "expired"


async def test_a_caller_supplied_clock_never_extends_a_token():
    gate = Gate(ttl_ms=60_000)
    token = await gate.token()
    gate.clock.advance(60_000)
    stale = CommandContext(actor=AGENT, approval=token, clock=fixed_clock(NOW))
    assert _reason(await gate.call(context=stale)) == "expired"


async def test_a_token_for_another_command_is_a_command_mismatch():
    gate = Gate([_command("todo-delete"), _command("todo-clear")])
    token = await gate.token(name="todo-clear")
    assert _reason(await gate.call(token=token)) == "command-mismatch"


async def test_a_token_for_other_input_is_an_input_mismatch():
    gate = Gate()
    token = await gate.token({"id": 42})
    assert _reason(await gate.call({"id": 43}, token=token)) == "input-mismatch"
    assert (await gate.call({"id": 42}, token=token)).success


async def test_a_token_for_another_actor_is_an_actor_mismatch():
    gate = Gate()
    for other in (
        Actor(kind="agent", id="gemini", on_behalf_of="user-1"),
        Actor(kind="human", id="claude", on_behalf_of="user-1"),
        Actor(kind="agent", id="claude", on_behalf_of="user-2"),
        Actor(kind="agent", id="claude"),
        None,
    ):
        token = await gate.token()
        assert _reason(await gate.call(token=token, actor=other)) == "actor-mismatch"


async def test_the_actor_label_is_not_bound():
    gate = Gate()
    token = await gate.token()
    relabelled = Actor(kind="agent", id="claude", label="Claude (advisor)", on_behalf_of="user-1")
    assert (await gate.call(token=token, actor=relabelled)).success


async def test_a_call_without_an_actor_binds_to_no_actor():
    gate = Gate()
    token = await gate.token(actor=None)
    assert (await gate.call(token=token, actor=None)).success


# ─── Keys, delivery and stores ──────────────────────────────────────────────


async def test_key_rotation_verifies_with_any_key_and_signs_with_the_first():
    old = Gate(secret=OTHER_SECRET)
    rotated = Gate(secret=[SECRET, OTHER_SECRET])
    assert (await rotated.call(token=await old.token())).success
    new_token = await rotated.token()
    assert _reason(await old.call(token=new_token)) == "invalid-signature"
    assert (await Gate(secret=SECRET).call(token=new_token)).success


async def test_on_approval_required_receives_the_request():
    requests: list[ApprovalRequest] = []
    gate = Gate(include_token=False, on_approval_required=requests.append)
    result = await gate.call()
    assert "approvalToken" not in result.error.details
    assert result.error.suggestion.endswith(
        "the application retries the same call once it has recorded the approval."
    )
    [request] = requests
    assert request.command == "todo-delete"
    assert request.input == {"id": 42}
    assert request.actor == AGENT and request.actor is not AGENT
    assert request.expires_at == result.error.details["expiresAt"]
    assert request.summary == "Run todo-delete"
    assert request.rejected is None
    assert (await gate.call(token=request.approval_token)).success

    await gate.call(token=request.approval_token)
    assert requests[-1].rejected == "already-used"


async def test_an_async_notifier_is_awaited():
    requests = []

    async def notify(request):
        requests.append(request.command)

    await Gate(on_approval_required=notify).call()
    assert requests == ["todo-delete"]


class _Store:
    def __init__(self, answer: Any) -> None:
        self.answer = answer
        self.calls: list[tuple[str, float]] = []

    async def consume(self, nonce: str, expires_at: float) -> Any:
        self.calls.append((nonce, expires_at))
        return self.answer


async def test_a_shared_nonce_store_decides_single_use():
    fresh = _Store(True)
    gate = Gate(nonce_store=fresh)
    token = await gate.token()
    assert (await gate.call(token=token)).success
    assert fresh.calls == [(_payload(token)["n"], NOW + 5 * 60_000)]


@pytest.mark.parametrize("answer", [False, 1, "yes", None])
async def test_only_an_explicit_true_from_the_store_is_fresh(answer):
    gate = Gate(nonce_store=_Store(answer))
    assert _reason(await gate.call(token=await gate.token())) == "already-used"


def test_the_memory_store_forgets_nonces_once_their_token_expired():
    store = _MemoryNonceStore()
    assert store.consume("n1", NOW + 1_000, NOW)
    assert not store.consume("n1", NOW + 1_000, NOW + 999)
    assert store.consume("n2", NOW + 5_000, NOW + 1_000)
    assert list(store._used) == ["n2"]


# ─── Binding ────────────────────────────────────────────────────────────────


def test_canonical_json_sorts_keys_at_every_depth_like_javascript():
    assert _canonical_json({"b": 1, "a": {"d": [1, 2.5, None], "c": True}}) == (
        '{"a":{"c":true,"d":[1,2.5,null]},"b":1}'
    )
    # JavaScript sorts by UTF-16 code unit: U+FF5E sorts after U+1F600's high surrogate.
    assert _canonical_json({"～": 1, "\U0001f600": 2}) == '{"\U0001f600":2,"～":1}'
    assert _canonical_json(1.0) == "1"
    assert _canonical_json(1e21) == "1e+21"
    assert _canonical_json("\ud800") == '"\\ud800"'


@pytest.mark.parametrize(
    "value",
    [math.nan, math.inf, 2**53 + 1, 2**1024, {1: "a"}, {"a"}, b"bytes", object()],
)
def test_canonical_json_fails_closed(value):
    with pytest.raises(TypeError, match="Cannot bind an approval"):
        _canonical_json(value)


def test_large_integers_bind_when_a_double_holds_them_exactly():
    assert _canonical_json(2**53) == "9007199254740992"
    assert _canonical_json(10**21) == _canonical_json(1e21) == "1e+21"


def test_canonical_json_rejects_cycles():
    cyclic: list[Any] = []
    cyclic.append(cyclic)
    with pytest.raises(TypeError, match="cyclic"):
        _canonical_json(cyclic)


async def test_an_unbindable_input_fails_the_call():
    gate = Gate()
    with pytest.raises(TypeError, match="Cannot bind an approval"):
        await gate.call({"id": math.inf})
    assert gate.ran == []


class DeleteInput(BaseModel):
    todo_id: int = Field(alias="todoId")
    force: bool = False
    reason: Optional[str] = None


async def test_a_model_input_binds_to_its_json_with_defaults_and_aliases():
    gate = Gate()
    token = await gate.token(DeleteInput(todoId=42))
    assert (await gate.call({"force": False, "todoId": 42, "reason": None}, token=token)).success
    token = await gate.token(DeleteInput(todoId=42))
    assert _reason(await gate.call(DeleteInput(todoId=42, force=True), token=token)) == "input-mismatch"


async def test_a_model_input_with_a_non_finite_float_fails_the_call():
    class Ratio(BaseModel):
        value: float

    with pytest.raises(TypeError, match="non-finite"):
        await Gate().call(Ratio(value=math.inf))


class _Secret(BaseModel):
    key: SecretStr


class _Excluded(BaseModel):
    target: str
    note: str = Field(default="", exclude=True)


class _FieldSerializer(BaseModel):
    target: str

    @field_serializer("target")
    def _hide(self, value: str) -> str:
        return "x"


class _ModelSerializer(BaseModel):
    target: str

    @model_serializer
    def _hide(self) -> dict[str, Any]:
        return {}


class _AnnotatedSerializer(BaseModel):
    target: Annotated[str, PlainSerializer(lambda value: "x")]


class _Tags(BaseModel):
    tags: set[str]


class _Nested(BaseModel):
    inner: _Secret


@pytest.mark.parametrize(
    "model",
    [
        _Secret(key="one"),
        _Excluded(target="a", note="b"),
        _FieldSerializer(target="a"),
        _ModelSerializer(target="a"),
        _AnnotatedSerializer(target="a"),
        _Tags(tags={"a", "b"}),
        _Nested(inner=_Secret(key="one")),
    ],
)
async def test_a_model_whose_dump_loses_information_fails_the_call(model):
    """Two such inputs could share a digest (SecretStr dumps as asterisks), so refuse."""
    gate = Gate()
    with pytest.raises(TypeError, match="Cannot bind an approval"):
        await gate.call(model)
    assert gate.ran == []


# ─── Cross-language ─────────────────────────────────────────────────────────

# Issued by TypeScript's createApprovalMiddleware (packages/server/src/approval.ts) with
# SECRET, a clock at NOW, and _TS_INPUT and AGENT.
_TS_TOKEN = (
    "afdap1.eyJjIjoidG9kby1kZWxldGUiLCJpIjoiR3NQWlBNSDlvdzdmZ1dZb3pOWDUzdU5JajN6eVVGTUZhN3p1"
    "SXp3VDdlRSIsImEiOiJjTTV4djJjTzNjWDN3bUJ5dHNwY1lqcFRDRmltRkhENUN1SmhiYW1kT3M0IiwiaWF0Ijox"
    "NzYxNDgwMDAwMDAwLCJleHAiOjE3NjE0ODAzMDAwMDAsIm4iOiJlU251YlIxV2dtYng5dlVSYjZYTWt3In0."
    "-BEoGpUaFO3f1e9kPdEGJwSH9APJuGOCtvc85d1MzGA"
)
_TS_INPUT = {
    "id": 42,
    "title": "café ✓",
    "tags": ["a", "b"],
    "ratio": 0.5,
    "big": 1e21,
    "nested": {"z": None, "a": True},
}


async def test_a_typescript_token_verifies():
    gate = Gate()
    assert (await gate.call(_TS_INPUT, token=_TS_TOKEN)).success
    assert _reason(await gate.call(_TS_INPUT, token=_TS_TOKEN)) == "already-used"


async def test_tokens_match_the_typescript_format():
    token = await Gate().token(_TS_INPUT)
    payload = _payload(token)
    assert list(payload) == ["c", "i", "a", "iat", "exp", "n"]
    ts_payload = _payload(_TS_TOKEN)
    # Same key, input and actor give the same keyed digests.
    assert {key: payload[key] for key in ("c", "i", "a", "iat", "exp")} == {
        key: ts_payload[key] for key in ("c", "i", "a", "iat", "exp")
    }
    assert isinstance(payload["iat"], int) and payload["exp"] == NOW + 300_000
    assert len(base64.urlsafe_b64decode(payload["n"] + "==")) == 16


_TS_VERIFY = """
const [dist, secret, now, token, input, actor] = process.argv.slice(1);
const { createApprovalMiddleware } = await import(dist);
const middleware = createApprovalMiddleware({
    secret,
    commands: [{ name: 'todo-delete', approval: 'required' }],
    clock: { now: () => Number(now) },
});
const result = await middleware('todo-delete', JSON.parse(input),
    { actor: JSON.parse(actor), approval: token }, async () => ({ success: true }));
console.log(JSON.stringify(result));
"""


async def test_a_python_token_verifies_in_typescript():
    import shutil
    import subprocess
    from pathlib import Path

    dist = Path(__file__).resolve().parents[2] / "packages" / "server" / "dist" / "index.js"
    node = shutil.which("node")
    if node is None or not dist.exists():
        pytest.skip("needs node and a built packages/server")
    token = await Gate().token(_TS_INPUT)
    actor = {"kind": "agent", "id": "claude", "label": "Claude", "onBehalfOf": "user-1"}
    run = subprocess.run(
        [node, "--input-type=module", "-e", _TS_VERIFY, dist.as_uri(), SECRET, str(NOW), token,
         json.dumps(_TS_INPUT), json.dumps(actor)],
        capture_output=True, text=True, check=True, timeout=60,
    )
    assert json.loads(run.stdout) == {"success": True}


async def test_issue_time_is_whole_milliseconds():
    clock = fixed_clock(NOW)
    clock.advance(0.75)
    gate = Gate(clock=clock)
    payload = _payload(await gate.token())
    assert payload["iat"] == NOW and payload["exp"] == NOW + 300_000


# ─── Server ─────────────────────────────────────────────────────────────────


class TodoDelete(BaseModel):
    id: int


@define_command(
    name="todo-delete",
    description="Delete a todo",
    input_schema=TodoDelete,
    mutation=True,
    destructive=True,
    approval="required",
    expose=MCP,
)
async def todo_delete(input: TodoDelete):
    return success({"deleted": input.id})


def _server(**options: Any):
    commands = [todo_delete]
    server = create_server(
        "approval-server",
        middleware=[create_approval_middleware(secret=SECRET, commands=commands, **options)],
    )
    for command in commands:
        server.register(command)
    return server


async def test_mcp_calls_are_held_and_tool_arguments_cannot_carry_approval():
    server = _server()
    held = await server.call_tool("todo-delete", {"id": 7})
    assert held.error.code == "APPROVAL_REQUIRED"
    token = held.error.details["approvalToken"]

    smuggled = await server.call_tool("todo-delete", {"id": 7, "approval": token})
    assert smuggled.error.code == "APPROVAL_REQUIRED"
    smuggled = await server.call_tool(
        "afd-call", {"command": "todo-delete", "input": {"id": 7, "approval": token}}
    )
    assert smuggled.error.code == "APPROVAL_REQUIRED"

    # The trusted surface sets the evidence; the actor is the one the MCP call carried.
    approved = await server.execute(
        "todo-delete", {"id": 7}, CommandContext(actor=Actor(kind="agent"), approval=token)
    )
    assert approved.success and approved.data == {"deleted": 7}


async def test_a_policy_error_becomes_an_execution_error_on_the_server():
    def broken(input, context):
        raise RuntimeError("secret detail")

    command = CommandDefinition(
        name="todo-purge", description="Purge", handler=_handler, approval=broken, expose=MCP
    )
    server = create_server(
        "approval-errors",
        middleware=[create_approval_middleware(secret=SECRET, commands=[command])],
    )
    server.registry.register(command)
    result = await server.execute("todo-purge", {})
    assert result.error.code == "COMMAND_EXECUTION_ERROR"
    assert "secret detail" not in result.error.message


async def test_batch_items_carry_the_approval_evidence():
    server = _server(replay="within-ttl")
    held = await server.execute("todo-delete", {"id": 1})
    token = held.error.details["approvalToken"]
    batch = await server.call_tool(
        "afd-batch", {"commands": [{"command": "todo-delete", "input": {"id": 1}}]}
    )
    assert batch.results[0].result.error.code == "APPROVAL_REQUIRED"
    approved = await server._execute_batch(
        {"commands": [{"command": "todo-delete", "input": {"id": 1}}] * 2},
        CommandContext(approval=token),
    )
    assert [item.result.success for item in approved.results] == [True, True]


async def test_a_single_use_token_covers_one_batch_item():
    server = _server()
    token = (await server.execute("todo-delete", {"id": 1})).error.details["approvalToken"]
    batch = await server._execute_batch(
        {
            "commands": [{"command": "todo-delete", "input": {"id": 1}}] * 2,
            "options": {"parallelism": 1},
        },
        CommandContext(approval=token),
    )
    outcomes = [item.result for item in batch.results]
    assert outcomes[0].success
    assert outcomes[1].error.details["reason"] == "already-used"


async def test_request_meta_never_becomes_approval_evidence():
    pytest.importorskip("mcp")
    from mcp import Client

    server = _server()
    token = (await server.call_tool("todo-delete", {"id": 7})).error.details["approvalToken"]
    async with Client(server._create_mcp_server()) as client:
        for meta in ({"approval": token}, {"dev.afd/approval": token}):
            result = await client.call_tool("todo-delete", {"id": 7}, meta=meta)
            assert json.loads(result.content[0].text)["error"]["code"] == "APPROVAL_REQUIRED"


async def test_direct_client_passes_the_approval_evidence():
    from afd.direct import DirectCallContext, DirectClient

    server = _server()

    class Registry:
        async def execute(self, name, args, context):
            return await server.execute(
                name, args, CommandContext(actor=context.actor, approval=context.approval)
            )

        def has_command(self, name):
            return True

        def list_commands(self):
            return []

        def list_command_names(self):
            return []

    client = DirectClient(Registry())
    held = await client.call("todo-delete", {"id": 3})
    token = held.error.details["approvalToken"]
    approved = await client.call("todo-delete", {"id": 3}, DirectCallContext(approval=token))
    assert approved.success


# ─── afd validate ───────────────────────────────────────────────────────────


def test_mutating_tools_without_a_policy_get_a_warning():
    from afd.cli.surface_commands import approval_policy_warnings
    from afd.transports.base import ToolInfo

    def warnings(meta):
        return approval_policy_warnings(ToolInfo(name="x", description="x", meta=meta))

    assert warnings(None) == []
    assert warnings({"mutation": False}) == []
    assert warnings({"mutation": True, "approval": "not-required"}) == []
    [warning] = warnings({"mutation": True})
    assert warning["code"] == "MISSING_APPROVAL_POLICY"
    assert warning["path"] == "_meta.approval"
    assert warning["message"].startswith("Mutating command declares no approval policy")
    [warning] = warnings({"destructive": True, "mutation": True})
    assert warning["message"].startswith("Destructive command")
    grouped = warnings(
        {"actions": [{"command": "a", "mutation": True}, {"command": "b", "approval": "required"}, 7]}
    )
    assert [warning["path"] for warning in grouped] == ["_meta.actions[0].approval"]


def test_afd_validate_reports_the_warning_and_fails_with_strict(monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    from click.testing import CliRunner

    import sys

    import afd.cli.main  # noqa: F401
    from afd.transports.base import ToolInfo

    cli_main = sys.modules["afd.cli.main"]

    transport = MagicMock()
    transport.connect = AsyncMock()
    transport.disconnect = AsyncMock()
    transport.list_tools = AsyncMock(
        return_value=[ToolInfo(name="todo-clear", description="Clear", meta={"mutation": True})]
    )
    monkeypatch.setattr(cli_main, "_get_transport", lambda server=None: transport)
    runner = CliRunner()
    result = runner.invoke(cli_main.cli, ["--json", "validate", "-s", "mock"])
    assert result.exit_code == 0, result.output
    assert '"code": "MISSING_APPROVAL_POLICY"' in result.output
    strict = runner.invoke(cli_main.cli, ["validate", "-s", "mock", "--strict"])
    assert strict.exit_code == 1
    assert "todo-clear _meta.approval" in strict.output
