"""Host-verified confirmation (``confirmation_mode="host-verified"``), :class:`HumanRelay`,
and private relay evidence (``spec/command-metadata.md``, #2264).
"""

from __future__ import annotations

import base64
import dataclasses
import hashlib
import json
from typing import Annotated, Any

import httpx
import pytest
from pydantic import BaseModel, Field

pytest.importorskip("mcp")

import mcp_types as types  # noqa: E402
from mcp import Client  # noqa: E402

from afd import (  # noqa: E402
    Actor,
    CommandConfirmationMode,
    CommandError,
    DirectClient,
    ExposeOptions,
    create_direct_registry,
    fixed_clock,
    success,
)
from afd.core.commands import CommandContext, CommandDefinition, create_command_registry  # noqa: E402
from afd.server import (  # noqa: E402
    RELAY_INPUT_KEY,
    ContextField,
    HumanRelay,
    JwtIssuer,
    JwtVerifier,
    McpAuthOptions,
    PendingListOutcome,
    PrincipalCredentials,
    RelayApproved,
    RelayCall,
    RelayDeclined,
    RelayInvalid,
    RelayPending,
    RelayPendingDecision,
    RelayPrompt,
    ScopeMissing,
    allows_url_elicitation,
    create_approval_middleware,
    create_server,
    create_token_rules,
    credentials_binding,
    define_command,
    input_digest,
    is_decision_id,
    is_relay_url,
    jwks_key_source,
    principal_binding,
)
from afd.server.approval import _actor_json  # noqa: E402
from afd.server.relay_evidence import (  # noqa: E402
    RelayEvidence,
    attach_relay_evidence,
    relay_evidence_of,
)
from tests.test_auth_verifier import ISSUER, JWKS, NOW, RESOURCE, _sign_jws  # noqa: E402

MCP = ExposeOptions(mcp=True)
SECRET = b"s" * 32
MODERN = "2026-07-28"
URL_CAPS = {"elicitation": {"url": {}}}
FORM_CAPS = {"elicitation": {"form": {}}}


def _body(result: Any) -> dict[str, Any]:
    return json.loads(result.content[0].text)


def _expected_elicitation_id(url: str) -> str:
    return (
        base64.urlsafe_b64encode(hashlib.sha256(url.encode("utf-8")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )


async def _http_call(
    server: Any,
    tool_name: str,
    arguments: dict[str, Any],
    *,
    caps: dict[str, Any] | None = URL_CAPS,
    request_state: str | None = None,
    input_responses: dict[str, Any] | None = None,
    extra_meta: dict[str, Any] | None = None,
    token: str | None = None,
    expected_status: int = 200,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientInfo": {"name": "relay-test", "version": "0"},
    }
    if caps is not None:
        meta["io.modelcontextprotocol/clientCapabilities"] = caps
    if extra_meta:
        meta.update(extra_meta)
    params: dict[str, Any] = {"name": tool_name, "arguments": arguments, "_meta": meta}
    if request_state is not None:
        params["requestState"] = request_state
    if input_responses is not None:
        params["inputResponses"] = input_responses
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": "tools/call",
        "Mcp-Name": tool_name,
    }
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    app = server.streamable_http_app(stateless_http=True, json_response=True)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8000"
        ) as http,
    ):
        response = await http.post(
            "/mcp",
            headers=headers,
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params},
        )
        assert response.status_code == expected_status, response.text
        return response.json()


class _ScriptedRelay:
    """In-memory HumanRelay that binds (command, input_digest, principal_binding) to state."""

    def __init__(
        self,
        *,
        outcome: str = "approved",
        url: str = "https://host.example/confirm/req-1",
        message: str = "Confirm transfer req-1",
        decision_id: str = "dec-1",
        approved_extra: dict[str, Any] | None = None,
        begin_error: CommandError | None = None,
        pending_rounds: int = 0,
    ) -> None:
        self.outcome = outcome
        self.url = url
        self.message = message
        self.decision_id = decision_id
        self.approved_extra = approved_extra
        self.begin_error = begin_error
        self.pending_rounds = pending_rounds
        self.begins: list[RelayCall] = []
        self.resumes: list[tuple[str, RelayCall]] = []
        self.sessions: dict[str, tuple[str, str, str]] = {}
        self.spent: set[str] = set()
        self._counter = 0

    def begin(self, call: RelayCall) -> RelayPrompt | CommandError:
        self.begins.append(call)
        if self.begin_error is not None:
            return self.begin_error
        self._counter += 1
        state = f"relay-state-{self._counter}"
        self.sessions[state] = (call.command, call.input_digest, call.principal_binding())
        return RelayPrompt(url=self.url, message=self.message, state=state)

    def resume(self, state: str, call: RelayCall) -> Any:
        self.resumes.append((state, call))
        expected = self.sessions.get(state)
        if expected is None or expected != (
            call.command,
            call.input_digest,
            call.principal_binding(),
        ):
            return RelayInvalid()
        if self.outcome == "declined":
            return RelayDeclined()
        if self.outcome == "invalid":
            return RelayInvalid()
        if self.pending_rounds > 0:
            self.pending_rounds -= 1
            return RelayPending(RelayPrompt(url=self.url, message=self.message, state=state))
        if state in self.spent:
            return RelayInvalid()
        self.spent.add(state)
        return RelayApproved(decision_id=self.decision_id)

    def approved_context(self, decision_id: str, call: RelayCall) -> dict[str, Any]:
        if self.approved_extra is None:
            return {}
        return dict(self.approved_extra)


# ── 1. URL validation & capability detection ────────────────────────────────────────────


def test_is_decision_id_rules() -> None:
    assert is_decision_id("d-1")
    assert is_decision_id("A_b-9")
    assert is_decision_id("a" * 128)
    for bad in (
        None,
        123,
        "",
        "a b",
        "d.1",
        "d/1",
        "https://x",
        "<b>",
        "é",
        "d-1\n",
        "a" * 129,
    ):
        assert not is_decision_id(bad), f"expected False for {bad!r}"


def test_is_relay_url_rules() -> None:
    assert is_relay_url("https://host.example/confirm/123?a=1")
    assert is_relay_url("HTTPS://host.example:8443/confirm")
    assert is_relay_url("https://[2001:db8::1]:8443/confirm")
    assert is_relay_url("https://[::1]/d/")
    assert is_relay_url("https://127.0.0.1/confirm")
    assert is_relay_url("https://localhost")
    assert is_relay_url("https://xn--mnchen-3ya.example/confirm")
    assert is_relay_url("https://a.example:1/")
    assert is_relay_url("https://a.example:65535/")
    for bad in (
        None,
        123,
        "",
        "https://",
        "http://host.example/confirm",
        "https://user:pass@host.example/confirm",
        "https://user@host.example/confirm",
        "https://host.example/has space",
        "https://host.example/has\nnewline",
        "https://host.example/has\x7fctrl",
        "https://host.example:99999/badport",
        "https://host.example:65536/badport",
        "https://host.example:0/badport",
        "https://host.example:/badport",
        "https://host.example:8a/badport",
        "https://host.example:000080/badport",
        "https://host..example/confirm",
        "https://host.example./confirm",
        "https://-host.example/confirm",
        "https://host-.example/confirm",
        "https://host_example.com/confirm",
        "https://host.example\\evil/confirm",
        "https://host.example/path\\back",
        "https://host.example/d?q=\\1",
        "https://host.example/d#\\frag",
        "https://host%2eexample/confirm",
        "https://münchen.example/confirm",
        "https://[]/confirm",
        "https://[::1/confirm",
        "https://[::1]x/confirm",
        "https://[::1]:0/confirm",
        "https://[::1]:/confirm",
        "https://[::1]:99999/confirm",
        "https://[not-ipv6]/confirm",
        "https://[::1%lo]/confirm",
        "https://host.example/\ud800surrogate",
        "javascript:alert(1)",
        f"https://{'a' * 64}.example/",
        f"https://{'a' * 62}.{'b' * 62}.{'c' * 62}.{'d' * 62}.example/",
    ):
        assert not is_relay_url(bad), f"expected False for {bad!r}"


def test_allows_url_elicitation_rules() -> None:
    assert allows_url_elicitation({"elicitation": {"url": {}}})
    assert allows_url_elicitation({"elicitation": {"form": {}, "url": {}}})
    assert allows_url_elicitation(
        types.ClientCapabilities(
            elicitation=types.ElicitationCapability(url=types.UrlElicitationCapability())
        )
    )
    for bad in (
        None,
        {},
        {"elicitation": {}},
        {"elicitation": {"form": {}}},
        {"elicitation": {"url": True}},
        types.ClientCapabilities(
            elicitation=types.ElicitationCapability(form=types.FormElicitationCapability())
        ),
    ):
        assert not allows_url_elicitation(bad), f"expected False for {bad!r}"


# ── 2. Metadata, registration, task conflict, tool surface & afd-detail ─────────────────


def test_metadata_validation_and_surface() -> None:
    # CommandConfirmationMode is exported from root and server packages.
    mode: CommandConfirmationMode = "host-verified"
    assert mode == "host-verified"
    assert isinstance(_ScriptedRelay(), HumanRelay)

    # Positional compatibility: confirmation_mode is at the end before _stacklevel.
    @define_command(
        "wire-pos",
        "Positional test",
        None,
        None,
        None,
        None,
        True,
        None,
        None,
        None,
        False,
        None,
        MCP,
        True,
        "Confirm?",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        "host-verified",
    )
    async def wire_pos(input: Any) -> Any:
        return success({"ok": True})

    # Invalid confirmation_mode is refused.
    with pytest.raises(ValueError, match="confirmation_mode"):

        @define_command("bad-mode", "Bad", confirmation_mode="form")  # type: ignore[arg-type]
        async def bad_mode(input: Any) -> Any:
            return success({})

    reg = create_command_registry()
    with pytest.raises(ValueError, match="confirmation_mode"):
        reg.register(
            CommandDefinition(
                name="bad-raw",
                description="Bad",
                handler=wire_pos,
                confirmation_mode="ack",  # type: ignore[arg-type]
            )
        )

    # Refused alongside task="optional" | "required", allowed with task="never".
    for bad_task in ("optional", "required"):
        with pytest.raises(ValueError, match="confirmation_mode"):

            @define_command(
                "task-conflict",
                "Conflict",
                task=bad_task,  # type: ignore[arg-type]
                confirmation_mode="host-verified",
            )
            async def conflict(input: Any) -> Any:
                return success({})

    @define_command("task-never", "Allowed", task="never", confirmation_mode="host-verified")
    async def task_never(input: Any) -> Any:
        return success({})

    assert task_never.__afd_command__.confirmation_mode == "host-verified"

    # Invalid human_relay rejected at create_server.
    with pytest.raises(TypeError, match="human_relay"):
        create_server("bad-relay", human_relay=object())  # type: ignore[arg-type]

    # Tool surface: _meta.confirmationMode, grouped _meta.actions, afd-detail, and NO confirm arg.
    for strategy in ("individual", "grouped"):
        server = create_server("hv-surface", tool_strategy=strategy, confirmations="enforce")
        server.register(wire_pos)
        tools = {tool["name"]: tool for tool in server.get_tool_definitions()}
        if strategy == "individual":
            tool = tools["wire-pos"]
            assert tool["_meta"]["confirmationMode"] == "host-verified"
            assert "confirm" not in (tool["inputSchema"].get("properties") or {})
        else:
            group = tools["wire"]
            assert "confirm" not in group["inputSchema"]["properties"]
            action = group["_meta"]["actions"][0]
            assert action["confirmationMode"] == "host-verified"


async def test_afd_detail_reports_confirmation_mode() -> None:
    server = create_server("hv-detail")

    @server.command(
        name="wire-send",
        description="Send a wire",
        mutation=True,
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send(input: Any) -> Any:
        return success({"sent": True})

    detail = await server.call_tool("afd-detail", {"command": "wire-send"})
    assert detail.success is True
    assert detail.data[0]["confirmationMode"] == "host-verified"


# ── 3. Full HumanRelay lifecycle on 2026-07-28 ──────────────────────────────────────────


async def test_human_relay_begin_resume_approved_and_context() -> None:
    relay = _ScriptedRelay(
        decision_id="private-dec-secret-99",
        approved_extra={
            "human_present": True,
            "decision_ref": "public-ref-1",
            # Reserved keys must be silently dropped, never clobbering AFD context fields.
            "interface": "spoofed",
            "actor": "spoofed",
            "credentials": "spoofed",
            "remote": False,
        },
    )
    mw_snapshots: list[dict[str, Any]] = []
    seen: list[dict[str, Any]] = []

    class SendInput(BaseModel):
        amount: int
        currency: str = "USD"

    async def observe_mw(name: str, input: Any, context: CommandContext, next_fn: Any) -> Any:
        mw_snapshots.append(
            {
                "has_evidence": relay_evidence_of(context) is not None,
                "repr": repr(context),
                "str": str(context),
                "vars": repr(vars(context)),
                "asdict": repr(dataclasses.asdict(context)),
            }
        )
        return await next_fn()

    server = create_server(
        "hv-app",
        tool_strategy="individual",
        human_relay=relay,
        middleware=[observe_mw],
    )

    @server.command(
        name="wire-send",
        description="Send wire",
        input_schema=SendInput,
        mutation=True,
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send(input: SendInput, context: CommandContext) -> Any:
        seen.append(
            {
                "amount": input.amount,
                "currency": input.currency,
                "extra": dict(context.extra),
                "evidence_in_handler": relay_evidence_of(context),
                "repr": repr(context),
                "str": str(context),
                "asdict": repr(dataclasses.asdict(context)),
            }
        )
        return success({"sent": input.amount, "currency": input.currency})

    # Step 1: invalid input fails VALIDATION_ERROR before relay.begin is called.
    bad = await _http_call(server, "wire-send", {"amount": "not-an-int"})
    assert bad["result"]["isError"] is True
    assert json.loads(bad["result"]["content"][0]["text"])["error"]["code"] == "VALIDATION_ERROR"
    assert len(relay.begins) == 0

    # Step 2: valid input -> relay.begin sees defaults applied -> input_required with elicitationId.
    first = await _http_call(server, "wire-send", {"amount": 500})
    result = first["result"]
    assert result["resultType"] == "input_required"
    assert result["requestState"] == "relay-state-1"
    req = result["inputRequests"][RELAY_INPUT_KEY]
    assert req["method"] == "elicitation/create"
    assert req["params"]["mode"] == "url"
    assert req["params"]["url"] == relay.url
    assert req["params"]["message"] == relay.message
    assert req["params"]["elicitationId"] == _expected_elicitation_id(relay.url)
    assert len(relay.begins) == 1
    assert relay.begins[0].input_digest == input_digest({"amount": 500, "currency": "USD"})
    assert relay.begins[0].supports_url_elicitation() is True

    # Step 3: accept retry -> relay.resume -> Approved -> handler runs with approved_context.
    second = await _http_call(
        server,
        "wire-send",
        {"amount": 500},
        request_state="relay-state-1",
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert second["result"]["isError"] is False
    wire = json.loads(second["result"]["content"][0]["text"])
    assert wire["success"] is True
    assert wire["data"] == {"sent": 500, "currency": "USD"}
    assert len(mw_snapshots) == 1
    assert mw_snapshots[0]["has_evidence"] is True
    for text in (
        mw_snapshots[0]["repr"],
        mw_snapshots[0]["str"],
        mw_snapshots[0]["vars"],
        mw_snapshots[0]["asdict"],
    ):
        assert "private-dec-secret-99" not in text
    assert len(seen) == 1
    assert seen[0]["extra"]["human_present"] is True
    assert seen[0]["extra"]["decision_ref"] == "public-ref-1"
    assert seen[0]["extra"]["interface"] == "mcp"
    assert seen[0]["extra"]["remote"] is True
    assert seen[0]["evidence_in_handler"] is None
    for text in (seen[0]["repr"], seen[0]["str"], seen[0]["asdict"]):
        assert "private-dec-secret-99" not in text


async def test_dynamic_default_factory_stays_bound_across_begin_and_resume() -> None:
    counter = 0

    def next_nonce() -> str:
        nonlocal counter
        counter += 1
        return f"nonce-{counter}"

    class DynInput(BaseModel):
        amount: int
        idempotency_key: str = Field(default_factory=next_nonce)

    relay = _ScriptedRelay()
    received: list[str] = []
    server = create_server("hv-dyn", tool_strategy="individual", human_relay=relay)

    @server.command(
        name="wire-dyn",
        description="Dynamic default",
        input_schema=DynInput,
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def dyn(input: DynInput) -> Any:
        received.append(input.idempotency_key)
        return success({"key": input.idempotency_key})

    first = await _http_call(server, "wire-dyn", {"amount": 42})
    state = first["result"]["requestState"]
    assert relay.begins[0].input.idempotency_key == "nonce-1"

    # A mismatched retry (different input) must NOT evict the legitimate pending entry.
    mismatch = await _http_call(
        server,
        "wire-dyn",
        {"amount": 99},
        request_state=state,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert mismatch["result"]["resultType"] == "input_required"

    # The legitimate caller's retry still gets nonce-1 and matches the relay digest.
    ok = await _http_call(
        server,
        "wire-dyn",
        {"amount": 42},
        request_state=state,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert ok["result"]["isError"] is False
    assert received == ["nonce-1"]


@pytest.mark.parametrize("action", ["decline", "cancel"])
async def test_client_decline_or_cancel_never_calls_resume(action: str) -> None:
    relay = _ScriptedRelay()
    server = create_server("hv-decline", tool_strategy="individual", human_relay=relay)

    @server.command(
        name="wire-send",
        description="Send",
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send(input: Any) -> Any:
        return success({})

    first = await _http_call(server, "wire-send", {})
    state = first["result"]["requestState"]
    res = await _http_call(
        server,
        "wire-send",
        {},
        request_state=state,
        input_responses={RELAY_INPUT_KEY: {"action": action}},
    )
    assert res["result"]["isError"] is True
    err = json.loads(res["result"]["content"][0]["text"])["error"]
    assert err["code"] == "CONFIRMATION_DECLINED"
    assert err["retryable"] is False
    assert err["details"] == {"commands": ["wire-send"]}
    # spec/recovery.md, "Engine errors": a decline is a stop.
    assert err["recovery"] == {"kind": "stop"}
    assert len(relay.resumes) == 0


async def test_resume_declined_pending_invalid_and_missing_url_capability() -> None:
    # Declined by relay
    declined_relay = _ScriptedRelay(outcome="declined")
    s1 = create_server("hv-d", tool_strategy="individual", human_relay=declined_relay)

    @s1.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def send1(input: Any) -> Any:
        return success({})

    st = (await _http_call(s1, "wire-send", {}))["result"]["requestState"]
    r1 = await _http_call(
        s1,
        "wire-send",
        {},
        request_state=st,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert (
        json.loads(r1["result"]["content"][0]["text"])["error"]["code"] == "CONFIRMATION_DECLINED"
    )

    # Pending -> keeps same elicitationId -> then Approved
    pending_relay = _ScriptedRelay(pending_rounds=1)
    s2 = create_server("hv-p", tool_strategy="individual", human_relay=pending_relay)

    @s2.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def send2(input: Any) -> Any:
        return success({"done": True})

    r_beg = await _http_call(s2, "wire-send", {})
    st2 = r_beg["result"]["requestState"]
    eid1 = r_beg["result"]["inputRequests"][RELAY_INPUT_KEY]["params"]["elicitationId"]
    r_pend = await _http_call(
        s2,
        "wire-send",
        {},
        request_state=st2,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert r_pend["result"]["resultType"] == "input_required"
    assert r_pend["result"]["inputRequests"][RELAY_INPUT_KEY]["params"]["elicitationId"] == eid1
    r_done = await _http_call(
        s2,
        "wire-send",
        {},
        request_state=st2,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert json.loads(r_done["result"]["content"][0]["text"])["data"] == {"done": True}

    # Invalid / forged state -> begins again
    r_inv = await _http_call(
        s2,
        "wire-send",
        {},
        request_state="forged-state",
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert r_inv["result"]["resultType"] == "input_required"
    assert r_inv["result"]["requestState"] == "relay-state-2"

    # Client without URL-mode elicitation (empty or form-only) -> CONFIRMATION_REQUIRED
    for caps in ({}, FORM_CAPS):
        r_nocap = await _http_call(s2, "wire-send", {}, caps=caps)
        err = json.loads(r_nocap["result"]["content"][0]["text"])["error"]
        assert err["code"] == "CONFIRMATION_REQUIRED"
        assert "URL-mode elicitation" in err["suggestion"]
        # A person confirms through the host.
        assert err["recovery"] == {"kind": "external"}

    # Relay.begin returning CommandError propagates cleanly
    refuse_relay = _ScriptedRelay(
        begin_error=CommandError(
            code="HOST_POLICY_DENIED",
            message="Policy blocked call",
            suggestion="Ask an admin.",
            retryable=False,
        )
    )
    s3 = create_server("hv-err", tool_strategy="individual", human_relay=refuse_relay)

    @s3.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def send3(input: Any) -> Any:
        return success({})

    r_err = await _http_call(s3, "wire-send", {})
    assert (
        json.loads(r_err["result"]["content"][0]["text"])["error"]["code"] == "HOST_POLICY_DENIED"
    )


async def test_relay_contract_violations_return_internal_error() -> None:
    class BadUrlRelay:
        def begin(self, call: RelayCall) -> RelayPrompt:
            return RelayPrompt(url="http://insecure.example/x", message="bad", state="s1")

        def resume(self, state: str, call: RelayCall) -> RelayInvalid:
            return RelayInvalid()

    class EmptyStateRelay:
        def begin(self, call: RelayCall) -> RelayPrompt:
            return RelayPrompt(url="https://ok.example/x", message="bad", state="")

        def resume(self, state: str, call: RelayCall) -> RelayInvalid:
            return RelayInvalid()

    class EmptyDecisionRelay:
        def begin(self, call: RelayCall) -> RelayPrompt:
            return RelayPrompt(url="https://ok.example/x", message="ok", state="s1")

        def resume(self, state: str, call: RelayCall) -> RelayApproved:
            return RelayApproved(decision_id="")

    class RaisingRelay:
        def begin(self, call: RelayCall) -> RelayPrompt:
            raise RuntimeError("boom secret detail")

        def resume(self, state: str, call: RelayCall) -> RelayInvalid:
            return RelayInvalid()

    for bad_relay, do_resume in (
        (BadUrlRelay(), False),
        (EmptyStateRelay(), False),
        (EmptyDecisionRelay(), True),
        (RaisingRelay(), False),
    ):
        server = create_server("hv-bad", tool_strategy="individual", human_relay=bad_relay)

        @server.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
        async def send(input: Any) -> Any:
            return success({})

        if do_resume:
            r = await _http_call(
                server,
                "wire-send",
                {},
                request_state="s1",
                input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
            )
        else:
            r = await _http_call(server, "wire-send", {})
        assert "error" in r
        assert r["error"]["code"] == -32603
        assert "secret" not in r["error"]["message"]


# ── 4. Routes, confirmations="off", batch/pipe, 2025, no-relay & direct ─────────────────


@pytest.mark.parametrize("strategy", ["individual", "grouped", "lazy", "hybrid"])
async def test_all_single_command_routes_work_even_with_confirmations_off(strategy: str) -> None:
    relay = _ScriptedRelay()
    kwargs: dict[str, Any] = {
        "tool_strategy": strategy,
        "confirmations": "off",
        "human_relay": relay,
    }
    if strategy == "hybrid":
        kwargs["first_class_tools"] = ["wire-send"]
    server = create_server("hv-routes", **kwargs)

    @server.command(
        "wire-send",
        "Send wire",
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send(input: Any) -> Any:
        return success({"ok": True})

    if strategy == "grouped":
        tool, args = "wire", {"action": "send", "params": {"n": 1}}
    elif strategy == "lazy":
        tool, args = "afd-call", {"command": "wire-send", "input": {"n": 1}}
    else:
        tool, args = "wire-send", {"n": 1}

    first = await _http_call(server, tool, args)
    assert first["result"]["resultType"] == "input_required"
    state = first["result"]["requestState"]
    second = await _http_call(
        server,
        tool,
        args,
        request_state=state,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert json.loads(second["result"]["content"][0]["text"])["data"] == {"ok": True}


async def test_batch_pipe_legacy_no_relay_ack_and_direct_boundaries() -> None:
    ran: list[str] = []
    relay = _ScriptedRelay()
    server = create_server(
        "hv-bounds",
        tool_strategy="individual",
        confirmations="enforce",
        human_relay=relay,
    )

    @server.command("wire-prep", "Prep", expose=MCP)
    async def prep(input: Any) -> Any:
        ran.append("prep")
        return success({"prepped": True})

    @server.command(
        "wire-send",
        "Send",
        confirm_prompt="Confirm?",
        confirmation_mode="host-verified",
        input_schema={
            "type": "object",
            "properties": {"n": {"type": "integer"}},
            "additionalProperties": False,
        },
        expose=MCP,
    )
    async def send(input: Any) -> Any:
        ran.append("send")
        return success({"n": input.get("n", 0)})

    # 1. Batch and pipe fail with CONFIRMATION_REQUIRED BEFORE step 0 runs.
    batch_res = await _http_call(
        server,
        "afd-batch",
        {
            "commands": [{"command": "wire-prep"}, {"command": "wire-send", "input": {"n": 1}}],
            "confirm": ["wire-send"],
        },
    )
    batch_err = json.loads(batch_res["result"]["content"][0]["text"])["error"]
    assert batch_err["code"] == "CONFIRMATION_REQUIRED"
    # Pinned as the table gives it today ("Engine errors", CONFIRMATION_REQUIRED: external); the
    # verified-recovery follow-ups ask whether a "call it on its own" step should carry none.
    assert batch_err["recovery"] == {"kind": "external"}
    pipe_res = await _http_call(
        server,
        "afd-pipe",
        {
            "steps": [{"command": "wire-prep"}, {"command": "wire-send", "input": {"n": 1}}],
            "confirm": ["wire-send"],
        },
    )
    assert (
        json.loads(pipe_res["result"]["content"][0]["text"])["steps"][0]["error"]["code"]
        == "CONFIRMATION_REQUIRED"
    )
    assert ran == []

    # 2. confirm: True and _meta["dev.afd/confirm"] are never accepted (confirm is not stripped).
    ack_arg = await _http_call(server, "wire-send", {"n": 1, "confirm": True})
    assert json.loads(ack_arg["result"]["content"][0]["text"])["error"]["code"] == (
        "VALIDATION_ERROR"
    )
    ack_meta = await _http_call(server, "wire-send", {"n": 1}, extra_meta={"dev.afd/confirm": True})
    assert ack_meta["result"]["resultType"] == "input_required"
    assert ran == []

    # 3. 2025-era legacy session fails with CONFIRMATION_REQUIRED.
    mcp = server._create_mcp_server()
    async with Client(mcp, mode="legacy") as legacy_client:
        leg = await legacy_client.call_tool("wire-send", {"n": 1})
        assert _body(leg)["error"]["code"] == "CONFIRMATION_REQUIRED"
    assert ran == []

    # 4. In-process call_tool / route_tool_call (no modern MCP channel) fails CONFIRMATION_REQUIRED.
    routed = await server.call_tool("wire-send", {"n": 1})
    assert routed.error.code == "CONFIRMATION_REQUIRED"
    assert ran == []

    # 5. Server with NO human_relay fails CONFIRMATION_REQUIRED even on 2026-07-28.
    no_relay = create_server("hv-none", tool_strategy="individual", confirmations="off")

    @no_relay.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def send_no_relay(input: Any) -> Any:
        return success({})

    nr = await _http_call(no_relay, "wire-send", {})
    err_nr = json.loads(nr["result"]["content"][0]["text"])["error"]
    assert err_nr["code"] == "CONFIRMATION_REQUIRED"
    assert "cannot confirm" in err_nr["suggestion"]
    # No relay is installed: only the operator can change that.
    assert err_nr["recovery"] == {"kind": "external"}

    # 6. Direct server.execute and DirectClient are ungated by HumanRelay.
    direct_res = await server.execute("wire-send", {"n": 7})
    assert direct_res.success is True
    assert direct_res.data == {"n": 7}

    @define_command("wire-local", "Local", confirmation_mode="host-verified")
    async def local_cmd(input: Any) -> Any:
        return success({"local": True})

    dc = DirectClient(create_direct_registry([local_cmd]))
    assert (await dc.call("wire-local", {})).data == {"local": True}


# ── 5. Private relay evidence, approval middleware & middleware/nested guards ───────────


class _SharedNonceStore:
    def __init__(self) -> None:
        self.seen: dict[str, float] = {}

    def consume(self, nonce: str, expires_at: float) -> bool:
        if nonce in self.seen:
            return False
        self.seen[nonce] = expires_at
        return True


async def test_relay_evidence_covers_approval_middleware_and_spends_once_for_24h() -> None:
    clock = fixed_clock(1_700_000_000_000)
    store = _SharedNonceStore()
    relay = _ScriptedRelay(decision_id="dec-shared-1")

    server = create_server(
        "hv-approval",
        tool_strategy="individual",
        human_relay=relay,
        middleware=[
            create_approval_middleware(
                secret=SECRET,
                # Even with replay="within-ttl" and relay="mcp-elicitation", relay evidence is
                # spent once with 24h TTL and form elicitation never runs.
                replay="within-ttl",
                relay="mcp-elicitation",
                nonce_store=store,
                clock=clock,
            )
        ],
    )

    @server.command(
        "wire-send",
        "Send wire",
        approval="required",
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send(input: Any, context: CommandContext) -> Any:
        assert relay_evidence_of(context) is None
        return success({"approved": True})

    first = await _http_call(server, "wire-send", {"amount": 100})
    state = first["result"]["requestState"]
    ok = await _http_call(
        server,
        "wire-send",
        {"amount": 100},
        request_state=state,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert ok["result"]["isError"] is False
    assert json.loads(ok["result"]["content"][0]["text"])["data"] == {"approved": True}
    assert "relay:dec-shared-1" in store.seen
    assert store.seen["relay:dec-shared-1"] == 1_700_000_000_000 + 24 * 60 * 60_000

    # A second server sharing the same nonce store rejects the same decision_id as already-used.
    relay2 = _ScriptedRelay(decision_id="dec-shared-1")
    server2 = create_server(
        "hv-approval-2",
        tool_strategy="individual",
        human_relay=relay2,
        middleware=[
            create_approval_middleware(
                secret=SECRET,
                replay="within-ttl",
                relay="mcp-elicitation",
                nonce_store=store,
                clock=clock,
            )
        ],
    )

    @server2.command(
        "wire-send",
        "Send wire",
        approval="required",
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send2(input: Any) -> Any:
        return success({"approved": True})

    st2 = (await _http_call(server2, "wire-send", {"amount": 100}))["result"]["requestState"]
    reused = await _http_call(
        server2,
        "wire-send",
        {"amount": 100},
        request_state=st2,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    err = json.loads(reused["result"]["content"][0]["text"])["error"]
    assert err["code"] == "APPROVAL_REQUIRED"
    assert err["details"]["reason"] == "already-used"
    assert "approvalToken" not in err["details"]


async def test_relay_evidence_strict_mismatch_order_and_rule_2() -> None:
    clock = fixed_clock(1_700_000_000_000)
    actor = Actor(kind="agent", id="bot-1")
    creds = PrincipalCredentials(issuer=ISSUER, subject="sub-1", client_id="cli-1")
    good_input = {"amount": 50}

    @define_command("wire-send", "Send", approval="required", confirmation_mode="host-verified")
    async def send(input: Any) -> Any:
        return success({"ok": True})

    mw = create_approval_middleware(secret=SECRET, commands=[send], clock=clock)

    # Mint a valid approval token to prove rule 2 ignores it when relay evidence is present.
    held = await mw(
        "wire-send",
        good_input,
        CommandContext(actor=actor, credentials=creds),
        lambda: send(good_input),
    )
    valid_token = held.error.details["approvalToken"]

    async def call_with(ev: RelayEvidence) -> Any:
        ctx = CommandContext(
            actor=actor,
            credentials=creds,
            approval=valid_token,
            extra={"interface": "mcp"},
        )
        attach_relay_evidence(ctx, ev)
        return await mw("wire-send", good_input, ctx, lambda: send(good_input))

    good_digest = input_digest(good_input)
    good_actor = _actor_json(actor)
    good_creds = credentials_binding(creds)

    # 1. command-mismatch beats input/actor/credentials mismatch
    r1 = await call_with(RelayEvidence("other-cmd", "wrong", "wrong", "wrong", "d1"))
    assert r1.error.details["reason"] == "command-mismatch"
    assert "approvalToken" not in r1.error.details

    # 2. input-mismatch beats actor/credentials mismatch
    r2 = await call_with(RelayEvidence("wire-send", "wrong", "wrong", "wrong", "d2"))
    assert r2.error.details["reason"] == "input-mismatch"

    # 3. actor-mismatch beats credentials mismatch
    r3 = await call_with(RelayEvidence("wire-send", good_digest, "wrong", "wrong", "d3"))
    assert r3.error.details["reason"] == "actor-mismatch"

    # 4. credentials-mismatch
    r4 = await call_with(RelayEvidence("wire-send", good_digest, good_actor, "wrong", "d4"))
    assert r4.error.details["reason"] == "credentials-mismatch"

    # 5. Exact match succeeds once, second call gets already-used
    ok = await call_with(RelayEvidence("wire-send", good_digest, good_actor, good_creds, "d5"))
    assert ok.success is True
    again = await call_with(RelayEvidence("wire-send", good_digest, good_actor, good_creds, "d5"))
    assert again.error.details["reason"] == "already-used"


async def test_no_approval_middleware_still_fails_closed_after_relay_approved() -> None:
    relay = _ScriptedRelay()
    server = create_server("hv-no-mw", tool_strategy="individual", human_relay=relay)

    @server.command(
        "wire-send",
        "Send",
        approval="required",
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send(input: Any) -> Any:
        return success({})

    st = (await _http_call(server, "wire-send", {}))["result"]["requestState"]
    res = await _http_call(
        server,
        "wire-send",
        {},
        request_state=st,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    err = json.loads(res["result"]["content"][0]["text"])["error"]
    assert err["code"] == "APPROVAL_UNAVAILABLE"
    assert err["details"]["reason"] == "no-approval-step"


async def test_non_approval_host_verified_guards_retry_mutation_and_nested_calls() -> None:
    # 1. Retry middleware calling next_fn twice under one human confirmation is refused.
    calls = 0

    async def retry_twice(name: str, input: Any, ctx: CommandContext, next_fn: Any) -> Any:
        first = await next_fn()
        second = await next_fn()
        return second if first.success else first

    s_retry = create_server(
        "hv-retry",
        tool_strategy="individual",
        human_relay=_ScriptedRelay(),
        middleware=[retry_twice],
    )

    @s_retry.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def send_retry(input: Any) -> Any:
        nonlocal calls
        calls += 1
        return success({"n": calls})

    st = (await _http_call(s_retry, "wire-send", {}))["result"]["requestState"]
    res = await _http_call(
        s_retry,
        "wire-send",
        {},
        request_state=st,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    err = json.loads(res["result"]["content"][0]["text"])["error"]
    assert err["code"] == "APPROVAL_UNAVAILABLE"
    assert err["details"]["reason"] == "admission-mismatch"
    assert calls == 1

    # 2. Middleware mutating input before handler is refused.
    async def mutate_input(name: str, input: Any, ctx: CommandContext, next_fn: Any) -> Any:
        input["amount"] = 999999
        return await next_fn()

    s_mut = create_server(
        "hv-mut",
        tool_strategy="individual",
        human_relay=_ScriptedRelay(),
        middleware=[mutate_input],
    )

    @s_mut.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def send_mut(input: Any) -> Any:
        return success(input)

    st_m = (await _http_call(s_mut, "wire-send", {"amount": 10}))["result"]["requestState"]
    res_m = await _http_call(
        s_mut,
        "wire-send",
        {"amount": 10},
        request_state=st_m,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    err_m = json.loads(res_m["result"]["content"][0]["text"])["error"]
    assert err_m["code"] == "APPROVAL_UNAVAILABLE"
    assert err_m["details"]["reason"] == "admission-mismatch"

    # 3. Nested execute(..., context) inside handler: ungated runs cleanly, gated does NOT inherit evidence.
    s_nest = create_server(
        "hv-nest",
        tool_strategy="individual",
        human_relay=_ScriptedRelay(),
        middleware=[create_approval_middleware(secret=SECRET)],
    )

    @s_nest.command("audit-log", "Audit", expose=MCP)
    async def audit_log(input: Any) -> Any:
        return success({"logged": True})

    @s_nest.command("secret-delete", "Delete", approval="required", expose=MCP)
    async def secret_delete(input: Any) -> Any:
        return success({"deleted": True})

    @s_nest.command(
        "wire-send",
        "Send",
        approval="required",
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send_nest(input: Any, context: CommandContext) -> Any:
        ungated = await s_nest.execute("audit-log", {}, context)
        gated = await s_nest.execute("secret-delete", {}, context)
        return success(
            {
                "ungated": ungated.success,
                "gated_code": gated.error.code if gated.error else None,
            }
        )

    st_n = (await _http_call(s_nest, "wire-send", {}))["result"]["requestState"]
    res_n = await _http_call(
        s_nest,
        "wire-send",
        {},
        request_state=st_n,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert json.loads(res_n["result"]["content"][0]["text"])["data"] == {
        "ungated": True,
        "gated_code": "APPROVAL_REQUIRED",
    }


# ── 6. Auth (M6 scopes, hidden commands, M8 principal binding) & context_fields ─────────


def _make_verifier() -> JwtVerifier:
    return JwtVerifier(
        create_token_rules(RESOURCE),
        [
            JwtIssuer(
                issuer=ISSUER,
                alias="test-as",
                algorithms=("RS256", "ES256", "EdDSA"),
                keys=jwks_key_source(JWKS),
            )
        ],
        clock=fixed_clock(NOW * 1000),
    )


def _token(sub: str, client_id: str, scope: str) -> str:
    return _sign_jws(
        claims={
            "iss": ISSUER,
            "sub": sub,
            "aud": RESOURCE,
            "client_id": client_id,
            "scope": scope,
            "iat": NOW - 10,
            "exp": NOW + 300,
        }
    )


async def test_auth_principal_binding_scope_resolver_hidden_commands_and_context_fields() -> None:
    relay = _ScriptedRelay()

    class WireInput(BaseModel):
        amount: int
        tier: str = "high"

    class Resolver:
        def resolve(self, command: str, input: Any, credentials: Any) -> Any:
            if (
                command == "wire-send"
                and isinstance(input, dict)
                and input.get("tier") == "high"
                and "wire:high" not in credentials.scopes
            ):
                return ScopeMissing(("wire:high",))
            return "allowed"

        def visible(self, command: str, credentials: Any) -> bool:
            return command != "wire-hidden" or "wire:admin" in credentials.scopes

        def known(self, command: str, credentials: Any) -> bool:
            return self.visible(command, credentials)

    server = create_server(
        "hv-auth",
        tool_strategy="individual",
        human_relay=relay,
        clock=fixed_clock(NOW * 1000),
        auth=McpAuthOptions(
            resource=RESOURCE,
            authorization_servers=[ISSUER],
            verifier=_make_verifier(),
            resolver=Resolver(),
            filter_tools_by_scope=True,
        ),
        context_fields=[
            ContextField(name="tenant", meta="dev.example/tenant", schema=str, required=True)
        ],
        middleware=[create_approval_middleware(secret=SECRET)],
    )

    @server.command(
        "wire-send",
        "Send wire",
        input_schema=WireInput,
        approval="required",
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def send(input: WireInput, context: CommandContext) -> Any:
        return success({"amount": input.amount, "tenant": context.extra["tenant"]})

    @server.command(
        "wire-hidden",
        "Hidden admin wire",
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def hidden(input: Any) -> Any:
        return success({})

    tok_low = _token("alice", "cli-a", "wire:send")
    tok_high = _token("alice", "cli-a", "wire:send wire:high")
    tok_bob = _token("bob", "cli-a", "wire:send wire:high")

    # 1. M6 ScopeResolver runs on validated input (default tier="high") BEFORE relay.begin.
    low_res = await _http_call(
        server,
        "wire-send",
        {"amount": 10},
        extra_meta={"dev.example/tenant": "acme"},
        token=tok_low,
    )
    assert json.loads(low_res["result"]["content"][0]["text"])["error"]["code"] == (
        "INSUFFICIENT_SCOPE"
    )
    assert len(relay.begins) == 0

    # 2. Hidden host-verified command answers COMMAND_NOT_FOUND, and forged requestState -> -32602.
    hid = await _http_call(
        server,
        "wire-hidden",
        {},
        extra_meta={"dev.example/tenant": "acme"},
        token=tok_high,
    )
    assert json.loads(hid["result"]["content"][0]["text"])["error"]["code"] == "COMMAND_NOT_FOUND"
    hid_forged = await _http_call(
        server,
        "wire-hidden",
        {},
        request_state="forged",
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
        extra_meta={"dev.example/tenant": "acme"},
        token=tok_high,
        expected_status=400,
    )
    assert hid_forged["error"]["code"] == -32602

    # 3. Missing required context_field fails fast with VALIDATION_ERROR before relay.begin.
    no_cf = await _http_call(server, "wire-send", {"amount": 10}, token=tok_high)
    assert json.loads(no_cf["result"]["content"][0]["text"])["error"]["code"] == "VALIDATION_ERROR"
    assert len(relay.begins) == 0

    # 4. Authorized Alice with tenant -> begin sees credentials & context_fields.
    beg = await _http_call(
        server,
        "wire-send",
        {"amount": 10},
        extra_meta={"dev.example/tenant": "acme"},
        token=tok_high,
    )
    state = beg["result"]["requestState"]
    assert relay.begins[0].credentials is not None
    assert relay.begins[0].credentials.subject == "alice"
    assert relay.begins[0].context.extra["tenant"] == "acme"
    assert relay.begins[0].principal_binding() == principal_binding(
        Actor(kind="agent", id="cli-a", on_behalf_of="alice"),
        relay.begins[0].credentials,
    )

    # 5. Bob replaying Alice's state -> relay.resume sees different principal_binding -> Invalid -> begins again.
    bob_replay = await _http_call(
        server,
        "wire-send",
        {"amount": 10},
        request_state=state,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
        extra_meta={"dev.example/tenant": "acme"},
        token=tok_bob,
    )
    assert bob_replay["result"]["resultType"] == "input_required"
    assert bob_replay["result"]["requestState"] != state

    # 6. Alice resumes -> Approved + relay evidence satisfies approval middleware.
    ok = await _http_call(
        server,
        "wire-send",
        {"amount": 10},
        request_state=state,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
        extra_meta={"dev.example/tenant": "acme"},
        token=tok_high,
    )
    assert json.loads(ok["result"]["content"][0]["text"])["data"] == {
        "amount": 10,
        "tenant": "acme",
    }


async def test_incomplete_credentials_fail_closed_before_relay() -> None:
    from mcp.server.auth.middleware.auth_context import auth_context_var
    from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
    from mcp.server.auth.provider import AccessToken

    relay = _ScriptedRelay()
    server = create_server(
        "hv-incomp",
        tool_strategy="individual",
        human_relay=relay,
    )

    @server.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def send(input: Any) -> Any:
        return success({})

    bad_token = AccessToken(
        token="opaque",
        client_id="cli-1",
        scopes=["wire:send"],
        subject="",
        claims={"iss": ISSUER},
    )
    reset = auth_context_var.set(AuthenticatedUser(bad_token))
    try:
        res = await _http_call(server, "wire-send", {})
        retry = await _http_call(
            server,
            "wire-send",
            {},
            request_state="relay-state-1",
            input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
        )
    finally:
        auth_context_var.reset(reset)
    assert res["error"]["code"] == -32603
    assert retry["error"]["code"] == -32603
    assert len(relay.begins) == 0
    assert len(relay.resumes) == 0


async def test_mcp_client_drives_url_elicitation_end_to_end() -> None:
    relay = _ScriptedRelay()
    seen_urls: list[tuple[str, str | None]] = []

    async def elicit_cb(context: Any, params: Any) -> types.ElicitResult:
        seen_urls.append((params.url, params.elicitation_id))
        return types.ElicitResult(action="accept")

    server = create_server("hv-client", tool_strategy="individual", human_relay=relay)

    @server.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def send(input: Any) -> Any:
        return success({"via_client": True})

    async with Client(
        server._create_mcp_server(), mode=MODERN, elicitation_callback=elicit_cb
    ) as client:
        res = await client.call_tool("wire-send", {"x": 1})
    assert _body(res)["data"] == {"via_client": True}
    assert seen_urls == [(relay.url, _expected_elicitation_id(relay.url))]


# ── 7. Security regressions from two-model independent review ───────────────────────────


async def test_mixed_context_grouped_tool_preserves_form_confirmation_and_rejects_bad_state() -> (
    None
):
    """Grouped tool sharing an action across contexts must NOT strip SDK-sealed requestState
    for the non-host-verified command, and non-string requestState must fail -32602."""
    from afd.server import ContextConfig

    relay = _ScriptedRelay()
    ran: list[str] = []
    server = create_server(
        "hv-grouped-ctx",
        tool_strategy="grouped",
        confirmations="require-human",
        confirmation_key=b"k" * 32,
        human_relay=relay,
        contexts=[ContextConfig(name="payments"), ContextConfig(name="drafts")],
    )

    @server.command(
        "pay-send",
        "Send payment",
        category="wire",
        contexts=["payments"],
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def pay_send(input: Any) -> Any:
        ran.append("pay-send")
        return success({"which": "pay"})

    @server.command(
        "draft-send",
        "Send draft",
        category="wire",
        contexts=["drafts"],
        confirm_prompt="Send draft?",
        expose=MCP,
    )
    async def draft_send(input: Any) -> Any:
        ran.append("draft-send")
        return success({"which": "draft"})

    # 1. Calling wire(action="send") in context="drafts" runs draft-send's form confirmation,
    #    keeping its SDK-sealed requestState intact on retry.
    ask_draft = await _http_call(
        server,
        "wire",
        {"action": "send", "params": {}},
        caps={"elicitation": {"form": {}, "url": {}}},
        extra_meta={"dev.afd/context": "drafts"},
    )
    assert ask_draft["result"]["resultType"] == "input_required"
    assert "confirm" in ask_draft["result"]["inputRequests"]
    sealed = ask_draft["result"]["requestState"]
    done_draft = await _http_call(
        server,
        "wire",
        {"action": "send", "params": {}},
        caps={"elicitation": {"form": {}, "url": {}}},
        request_state=sealed,
        input_responses={"confirm": {"action": "accept", "content": {"confirm": True}}},
        extra_meta={"dev.afd/context": "drafts"},
    )
    assert json.loads(done_draft["result"]["content"][0]["text"])["data"] == {"which": "draft"}

    # 2. Forged requestState on draft-send MUST still be rejected by RequestStateBoundary (-32602).
    forged_draft = await _http_call(
        server,
        "wire",
        {"action": "send", "params": {}},
        caps={"elicitation": {"form": {}, "url": {}}},
        request_state="forged",
        extra_meta={"dev.afd/context": "drafts"},
        expected_status=400,
    )
    assert forged_draft["error"]["code"] == -32602

    # 3. Non-string requestState on host-verified command MUST fail -32602 (never fall through to begin).
    bad_type = await _http_call(
        server,
        "wire",
        {"action": "send", "params": {}},
        request_state=123,  # type: ignore[arg-type]
        extra_meta={"dev.afd/context": "payments"},
        expected_status=400,
    )
    assert bad_type["error"]["code"] == -32602
    assert len(relay.begins) == 0


async def test_nested_call_tool_and_afd_call_inside_handler_cannot_inherit_relay_channel() -> None:
    relay = _ScriptedRelay()
    nested_results: list[str] = []
    server = create_server("hv-nested-mcp", tool_strategy="individual", human_relay=relay)

    @server.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def wire_send(input: Any) -> Any:
        return success({"sent": True})

    @server.command("outer-run", "Outer", expose=MCP)
    async def outer_run(input: Any, context: CommandContext) -> Any:
        r1 = await server.call_tool("wire-send", {})
        r2 = await server.execute("afd-call", {"command": "wire-send", "input": {}}, context)
        nested_results.append(r1.error.code if r1.error else "OK")
        nested_results.append(r2.error.code if r2.error else "OK")
        return success({"nested": list(nested_results)})

    res = await _http_call(server, "outer-run", {})
    assert json.loads(res["result"]["content"][0]["text"])["data"] == {
        "nested": ["CONFIRMATION_REQUIRED", "CONFIRMATION_REQUIRED"]
    }
    assert len(relay.begins) == 0
    assert len(relay.resumes) == 0


async def test_deferred_retained_next_fn_still_refused_after_dispatch_cleanup() -> None:
    retained: list[Any] = []
    calls = 0

    async def capture_next(name: str, input: Any, ctx: CommandContext, next_fn: Any) -> Any:
        retained.append(next_fn)
        return await next_fn()

    server = create_server(
        "hv-deferred",
        tool_strategy="individual",
        human_relay=_ScriptedRelay(),
        middleware=[capture_next],
    )

    @server.command("wire-send", "Send", confirmation_mode="host-verified", expose=MCP)
    async def send(input: Any) -> Any:
        nonlocal calls
        calls += 1
        return success({"n": calls})

    st = (await _http_call(server, "wire-send", {}))["result"]["requestState"]
    first = await _http_call(
        server,
        "wire-send",
        {},
        request_state=st,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert first["result"]["isError"] is False
    assert calls == 1
    assert len(retained) == 1

    # Calling retained next_fn AFTER _execute_command cleanup must STILL be refused.
    deferred = await retained[0]()
    assert deferred.success is False
    assert deferred.error.code == "APPROVAL_UNAVAILABLE"
    assert deferred.error.details["reason"] == "admission-mismatch"
    assert calls == 1


async def test_pending_restore_preserves_exclude_unset_and_dynamic_context_fields() -> None:
    n_input = 0
    n_ctx = 0

    def next_req_id() -> str:
        nonlocal n_input
        n_input += 1
        return f"req-{n_input}"

    def next_ctx_id() -> str:
        nonlocal n_ctx
        n_ctx += 1
        return f"ctx-{n_ctx}"

    class PatchInput(BaseModel):
        title: str | None = None
        note: str = "default-note"
        req_id: str = Field(default_factory=next_req_id)

    class ScopeCtx(BaseModel):
        tenant: str
        nonce: str = Field(default_factory=next_ctx_id)

    relay = _ScriptedRelay()
    observed: list[dict[str, Any]] = []
    server = create_server(
        "hv-presence",
        tool_strategy="individual",
        human_relay=relay,
        context_fields=[ContextField(name="scope", meta="dev.example/scope", schema=ScopeCtx)],
    )

    @server.command(
        "doc-patch",
        "Patch doc",
        input_schema=PatchInput,
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def patch(input: PatchInput, context: CommandContext) -> Any:
        observed.append(
            {
                "unset_dump": input.model_dump(exclude_unset=True),
                "req_id": input.req_id,
                "ctx_nonce": context.extra["scope"].nonce,
            }
        )
        return success({"ok": True})

    st = (
        await _http_call(
            server,
            "doc-patch",
            {"title": "New"},
            extra_meta={"dev.example/scope": {"tenant": "acme"}},
        )
    )["result"]["requestState"]
    res = await _http_call(
        server,
        "doc-patch",
        {"title": "New"},
        request_state=st,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
        extra_meta={"dev.example/scope": {"tenant": "acme"}},
    )
    assert res["result"]["isError"] is False
    assert len(observed) == 1
    # Caller only sent "title", so exclude_unset must NOT falsely mark "note" as set.
    assert observed[0]["unset_dump"] == {"title": "New"}
    assert observed[0]["req_id"] == "req-1"
    # Handler must see the exact same dynamic context_field value that relay.resume verified.
    assert observed[0]["ctx_nonce"] == relay.resumes[0][1].context.extra["scope"].nonce


async def test_a_raising_context_field_validator_is_redacted_before_begin() -> None:
    # #2141: on the relay path too, the validator's text reaches the caller only in dev mode.
    from pydantic import PlainValidator

    def explode(value: Any) -> Any:
        raise RuntimeError("tenant-sentinel")

    tenant_schema = Annotated[Any, PlainValidator(explode)]

    for dev_mode, expected in (
        (False, "The value could not be validated"),
        (True, "tenant-sentinel"),
    ):
        relay = _ScriptedRelay()
        server = create_server(
            "hv-raising-field",
            tool_strategy="individual",
            human_relay=relay,
            dev_mode=dev_mode,
            context_fields=[
                ContextField(name="tenant", meta="dev.example/tenant", schema=tenant_schema)
            ],
        )

        @server.command("doc-erase", "Erase doc", confirmation_mode="host-verified", expose=MCP)
        async def erase(input: Any, context: CommandContext) -> Any:
            return success({"ok": True})

        res = await _http_call(server, "doc-erase", {}, extra_meta={"dev.example/tenant": "acme"})
        body = json.loads(res["result"]["content"][0]["text"])
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["details"]["errors"] == [{"path": "", "message": expected}]
        if not dev_mode:
            assert "tenant-sentinel" not in json.dumps(res)
        assert relay.begins == []


async def test_unbindable_pydantic_models_rejected_before_begin() -> None:
    class CollidingAliasInput(BaseModel):
        a: str = Field(serialization_alias="same")
        b: str = Field(serialization_alias="same")

    relay = _ScriptedRelay()
    server = create_server("hv-lossy", tool_strategy="individual", human_relay=relay)

    @server.command(
        "wire-lossy",
        "Lossy",
        input_schema=CollidingAliasInput,
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def lossy(input: CollidingAliasInput) -> Any:
        return success({})

    res = await _http_call(server, "wire-lossy", {"a": "1", "b": "2"})
    assert json.loads(res["result"]["content"][0]["text"])["error"]["code"] == "VALIDATION_ERROR"
    assert len(relay.begins) == 0


async def test_core_export_and_server_config_positional_and_mutated_batch() -> None:
    from afd.core import CommandConfirmationMode as CoreMode
    from afd.server.config import ServerConfig

    assert CoreMode == CommandConfirmationMode
    # Positional ServerConfig up to first_class_tools stays backward-compatible.
    cfg = ServerConfig(
        "pos",
        "1.0.0",
        None,
        "fastmcp",
        [],
        "hybrid",
        [],
        None,
        False,
        30_000,
        500,
        16,
        100,
        None,
        None,
        None,
        None,
        None,
        None,
        "off",
        None,
        ["wire-send"],
    )
    assert cfg.first_class_tools == ["wire-send"]
    assert cfg.human_relay is None

    # Mutating confirmation_mode on a registered command immediately blocks afd-batch.
    server = create_server("hv-mut-def", tool_strategy="individual")

    @server.command("wire-later", "Later", expose=MCP)
    async def later(input: Any) -> Any:
        return success({"ran": True})

    # Warm router cache before mutation.
    assert (await server.call_tool("afd-batch", {"commands": [{"command": "wire-later"}]})).success
    cmd_def = server.registry.get("wire-later")
    assert cmd_def is not None
    cmd_def.confirmation_mode = "host-verified"
    blocked = await server.call_tool("afd-batch", {"commands": [{"command": "wire-later"}]})
    assert blocked.success is False
    assert blocked.error.code == "CONFIRMATION_REQUIRED"


async def test_journal_middleware_records_journaled_context_fields_for_host_verified() -> None:
    from afd import MemoryJournalSink
    from afd.server.context_fields import ContextField
    from afd.server.journal import create_journal_middleware

    sink = MemoryJournalSink()
    relay = _ScriptedRelay()
    server = create_server(
        "hv-journal-ctx",
        tool_strategy="individual",
        human_relay=relay,
        middleware=[create_journal_middleware(sink)],
        context_fields=[
            ContextField(
                name="tenant",
                meta="dev.example/tenant",
                schema=str,
                required=True,
                journal=True,
            ),
            ContextField(
                name="locale",
                meta="dev.example/locale",
                schema=str,
                journal=False,
            ),
        ],
    )

    @server.command("wire-journal", "Journal", confirmation_mode="host-verified", expose=MCP)
    async def run_cmd(input: Any) -> Any:
        return success({"ok": True})

    meta = {"dev.example/tenant": "acme", "dev.example/locale": "en-US"}
    st = (await _http_call(server, "wire-journal", {}, extra_meta=meta))["result"]["requestState"]
    res = await _http_call(
        server,
        "wire-journal",
        {},
        request_state=st,
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
        extra_meta=meta,
    )
    assert res["result"]["isError"] is False
    entries = await sink.read()
    assert len(entries) == 1
    assert entries[0].context == {"tenant": "acme"}


async def test_meta_tool_names_short_circuit_in_targets_host_verified() -> None:
    relay = _ScriptedRelay()
    server = create_server(
        "hv-meta-group",
        tool_strategy="grouped",
        group_by=lambda _cmd: "afd-discover",
        human_relay=relay,
    )

    @server.command("wire-grouped", "Grouped", confirmation_mode="host-verified", expose=MCP)
    async def run_cmd(input: Any) -> Any:
        return success({"ok": True})

    assert server._targets_host_verified("afd-discover", {"action": "grouped"}, None, None) is False
    assert (
        server._targets_host_verified("afd-call", {"command": "wire-grouped"}, None, None) is True
    )


# ── Pending-list fallback (#2723) ───────────────────────────────────────────────────────


class _PendingListRelay(_ScriptedRelay):
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.pending_calls: list[RelayCall] = []
        self.pending_queue: list[PendingListOutcome | None] = []
        self.annotated: list[str] = []

    def enqueue_pending(self, outcome: PendingListOutcome | None) -> None:
        self.pending_queue.append(outcome)

    def pending_list(self, call: RelayCall) -> PendingListOutcome | None:
        self.pending_calls.append(call)
        return self.pending_queue.pop(0) if self.pending_queue else None

    def approved_context(self, decision_id: str, call: RelayCall) -> dict[str, Any]:
        self.annotated.append(decision_id)
        return super().approved_context(decision_id, call)


def _pending_list_server(
    relay: Any, *, replay: str = "single-use"
) -> tuple[Any, dict[str, int], list[dict[str, Any]]]:
    runs = {"erase": 0}
    seen: list[dict[str, Any]] = []

    class EraseInput(BaseModel):
        id: str
        mode: str = "soft"

    server = create_server(
        "hv-pending-list",
        tool_strategy="individual",
        human_relay=relay,
        middleware=[create_approval_middleware(secret=SECRET, replay=replay)],  # type: ignore[arg-type]
    )

    @server.command(
        name="memory-erase",
        description="Erase a memory",
        input_schema=EraseInput,
        mutation=True,
        approval="required",
        confirmation_mode="host-verified",
        expose=MCP,
    )
    async def erase(input: EraseInput, context: CommandContext) -> Any:
        runs["erase"] += 1
        seen.append(
            {
                "input": input.model_dump(),
                "person": context.extra.get("host.example/person"),
                "has_evidence": relay_evidence_of(context) is not None,
            }
        )
        return success({"id": input.id, "person": context.extra.get("host.example/person")})

    return server, runs, seen


async def test_pending_list_default_keeps_todays_refusal() -> None:
    # Omitting pending_list keeps the existing refusal.
    base_relay = _ScriptedRelay()
    server1, runs1, _ = _pending_list_server(base_relay)
    res1 = await _http_call(server1, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    body1 = json.loads(res1["result"]["content"][0]["text"])
    assert body1["error"]["code"] == "CONFIRMATION_REQUIRED"
    assert body1["error"]["retryable"] is False
    assert len(base_relay.begins) == 1
    assert runs1["erase"] == 0

    # Returning None from pending_list also keeps the existing refusal.
    opt_out_relay = _PendingListRelay()
    opt_out_relay.enqueue_pending(None)
    server2, runs2, _ = _pending_list_server(opt_out_relay)
    res2 = await _http_call(server2, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    body2 = json.loads(res2["result"]["content"][0]["text"])
    assert body2["error"]["code"] == "CONFIRMATION_REQUIRED"
    assert body2["error"]["retryable"] is False
    assert len(opt_out_relay.pending_calls) == 1
    assert len(opt_out_relay.begins) == 1
    assert runs2["erase"] == 0


async def test_pending_list_refusal_and_approval_lifecycle() -> None:
    list_url = "https://person.example.com/d/"
    decision_url = "https://person.example.com/d/d-1"
    relay = _PendingListRelay(approved_extra={"host.example/person": "alice"})
    relay.enqueue_pending(RelayPendingDecision(decision="d-1", url=decision_url, list=list_url))
    relay.enqueue_pending(RelayApproved(decision_id="d-1"))
    relay.enqueue_pending(RelayApproved(decision_id="d-1"))
    server, runs, seen = _pending_list_server(relay, replay="within-ttl")

    # 1. Pending refusal names the list first and skips begin.
    res = await _http_call(server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    assert res["result"].get("resultType") != "input_required"
    refused = json.loads(res["result"]["content"][0]["text"])
    err = refused["error"]
    assert err["code"] == "CONFIRMATION_REQUIRED"
    assert err["retryable"] is True
    assert err["recovery"] == {"kind": "external"}
    assert err["details"] == {
        "commands": ["memory-erase"],
        "reason": "pending-list",
        "decision": "d-1",
        "url": decision_url,
        "list": list_url,
    }
    assert err["suggestion"].index(list_url) < err["suggestion"].index(decision_url)
    assert "d-1" in err["suggestion"] and "same call again" in err["suggestion"]
    assert len(relay.pending_calls) == 1
    assert len(relay.begins) == 0
    assert relay.pending_calls[0].supports_url_elicitation() is False
    assert relay.pending_calls[0].input_digest == input_digest({"id": "42", "mode": "soft"})
    assert runs["erase"] == 0

    # 2. Same call after approval runs once with approved_context and relay evidence.
    ran_res = await _http_call(server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    ran = json.loads(ran_res["result"]["content"][0]["text"])
    assert ran["success"] is True
    assert ran["data"] == {"id": "42", "person": "alice"}
    assert relay.annotated == ["d-1"]
    assert runs["erase"] == 1
    assert seen == [
        {"input": {"id": "42", "mode": "soft"}, "person": "alice", "has_evidence": False}
    ]

    # 3. Reusing the same decision_id is spent even under within-ttl.
    spent_res = await _http_call(server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    spent = json.loads(spent_res["result"]["content"][0]["text"])
    assert spent["success"] is False
    assert spent["error"]["code"] == "APPROVAL_REQUIRED"
    assert spent["error"]["details"]["reason"] == "already-used"
    assert runs["erase"] == 1
    assert len(relay.begins) == 0
    assert len(relay.resumes) == 0


async def test_pending_list_decline_error_stop_answer_and_url_mode_bypass() -> None:
    list_url = "https://person.example.com/d/"
    decision_url = "https://person.example.com/d/d-1"
    relay = _PendingListRelay()
    server, runs, _ = _pending_list_server(relay)

    # Declined
    relay.enqueue_pending(RelayDeclined())
    declined_res = await _http_call(server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    declined = json.loads(declined_res["result"]["content"][0]["text"])
    assert declined["error"]["code"] == "CONFIRMATION_DECLINED"
    assert declined["error"]["retryable"] is False
    assert declined["error"]["recovery"] == {"kind": "stop"}

    # CommandError refusal
    relay.enqueue_pending(CommandError(code="RATE_LIMITED", message="Too many decisions"))
    rl_res = await _http_call(server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    rl = json.loads(rl_res["result"]["content"][0]["text"])
    assert rl["error"]["code"] == "RATE_LIMITED"

    # Stop answers (decline/cancel) end the call BEFORE pending_list is asked — even with an
    # explicitly supplied empty requestState.
    asked_before_stop = len(relay.pending_calls)
    for state in ("state-1", ""):
        for action in ("decline", "cancel"):
            relay.enqueue_pending(RelayApproved(decision_id="d-stop"))
            stopped_res = await _http_call(
                server,
                "memory-erase",
                {"id": "42"},
                caps=FORM_CAPS,
                request_state=state,
                input_responses={RELAY_INPUT_KEY: {"action": action}},
            )
            stopped = json.loads(stopped_res["result"]["content"][0]["text"])
            assert stopped["error"]["code"] == "CONFIRMATION_DECLINED", f"{action}:{state!r}"
            relay.pending_queue.clear()
    assert len(relay.pending_calls) == asked_before_stop
    assert len(relay.begins) == 0
    assert len(relay.resumes) == 0

    # A client WITH URL-mode elicitation never falls back to pending_list; an accept retry
    # carrying an empty requestState skips resume and falls through to begin.
    relay.enqueue_pending(RelayPendingDecision(decision="d-url", url=decision_url, list=list_url))
    url_res = await _http_call(
        server,
        "memory-erase",
        {"id": "42"},
        caps=URL_CAPS,
        request_state="",
        input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
    )
    assert url_res["result"]["resultType"] == "input_required"
    assert len(relay.pending_calls) == asked_before_stop
    assert len(relay.resumes) == 0
    assert len(relay.begins) == 1
    assert runs["erase"] == 0


async def test_pending_list_preserves_dynamic_default_factory_across_retries() -> None:
    counter = 0

    def next_nonce() -> str:
        nonlocal counter
        counter += 1
        return f"nonce-{counter}"

    class DynInput(BaseModel):
        amount: int
        idempotency_key: str = Field(default_factory=next_nonce)

    pending_by_binding: dict[tuple[str, str, str], dict[str, Any]] = {}
    seen_digests: list[str] = []
    next_decision = 0

    class _DigestBindingPendingListRelay(_ScriptedRelay):
        def pending_list(self, call: RelayCall) -> PendingListOutcome:
            nonlocal next_decision
            seen_digests.append(call.input_digest)
            key = (call.principal_binding(), call.command, call.input_digest)
            existing = pending_by_binding.get(key)
            if existing is not None and existing["approved"]:
                del pending_by_binding[key]
                return RelayApproved(decision_id=existing["decision"])
            if existing is None:
                next_decision += 1
                decision = f"dyn-{next_decision}"
                pending_by_binding[key] = {"decision": decision, "approved": False}
            else:
                decision = existing["decision"]
            return RelayPendingDecision(
                decision=decision,
                url=f"https://person.example.com/d/{decision}",
                list="https://person.example.com/d/",
            )

    seen_inputs: list[dict[str, Any]] = []
    seen_fields_set: list[set[str]] = []
    relay = _DigestBindingPendingListRelay()
    server = create_server(
        "relay-pending-dynamic",
        middleware=[create_approval_middleware(secret=SECRET)],
        human_relay=relay,
        tool_strategy="individual",
    )

    @server.command(
        name="payment-send",
        description="Send payment with dynamic default",
        mutation=True,
        approval="required",
        confirmation_mode="host-verified",
        input_schema=DynInput,
        expose=MCP,
    )
    async def payment_send(input: DynInput) -> Any:
        seen_inputs.append(input.model_dump())
        seen_fields_set.append(set(input.model_fields_set))
        return success(input.model_dump())

    # 1. First call generates nonce-1 and creates pending decision dyn-1.
    first_res = await _http_call(server, "payment-send", {"amount": 50}, caps=FORM_CAPS)
    first = json.loads(first_res["result"]["content"][0]["text"])
    assert first["error"]["details"]["decision"] == "dyn-1"
    assert seen_inputs == []

    # 2. Retry while still pending reuses nonce-1 and matches dyn-1.
    second_res = await _http_call(server, "payment-send", {"amount": 50}, caps=FORM_CAPS)
    second = json.loads(second_res["result"]["content"][0]["text"])
    assert second["error"]["details"]["decision"] == "dyn-1"
    assert seen_digests[1] == seen_digests[0]

    # 3. Approve dyn-1; retry runs with the exact approved nonce-1 and original fields_set.
    for entry in pending_by_binding.values():
        entry["approved"] = True
    approved_res = await _http_call(server, "payment-send", {"amount": 50}, caps=FORM_CAPS)
    approved = json.loads(approved_res["result"]["content"][0]["text"])
    assert approved["success"] is True
    assert approved["data"] == {"amount": 50, "idempotency_key": "nonce-1"}
    assert seen_digests[2] == seen_digests[0]
    assert seen_inputs == [{"amount": 50, "idempotency_key": "nonce-1"}]
    assert seen_fields_set == [{"amount"}]

    # 4. Subsequent fresh call generates nonce-2 and creates dyn-2.
    next_res = await _http_call(server, "payment-send", {"amount": 50}, caps=FORM_CAPS)
    next_body = json.loads(next_res["result"]["content"][0]["text"])
    assert next_body["error"]["details"]["decision"] == "dyn-2"
    assert seen_digests[3] != seen_digests[0]
    assert len(seen_inputs) == 1


async def test_pending_list_and_url_mode_reject_bad_ids_urls_and_returns() -> None:
    list_url = "https://person.example.com/d/"
    decision_url = "https://person.example.com/d/d-1"
    relay = _PendingListRelay()
    server, runs, _ = _pending_list_server(relay)

    # Bad decision_id in pending_list Approved
    for bad_id in ("", "d 1", "see https://evil.example", "a" * 129):
        relay.enqueue_pending(RelayApproved(decision_id=bad_id))
        res = await _http_call(server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
        assert res["error"]["code"] == -32603, bad_id
    assert relay.annotated == []

    # Bad decision_id in URL-mode resume Approved
    st = (await _http_call(server, "memory-erase", {"id": "42"}, caps=URL_CAPS))["result"][
        "requestState"
    ]
    for bad_id in ("", "d 1", "see https://evil.example", "a" * 129):
        relay.decision_id = bad_id
        relay.spent.clear()
        res = await _http_call(
            server,
            "memory-erase",
            {"id": "42"},
            caps=URL_CAPS,
            request_state=st,
            input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
        )
        assert res["error"]["code"] == -32603, bad_id
    assert relay.annotated == []

    # Bad prompt URL in URL-mode begin, URL-mode resume RelayPending, and pending_list URLs
    relay.decision_id = "dec-1"
    relay.spent.clear()
    bad_urls = (
        "https://person.example.com:0/d/1",
        "https://person.example.com:99999/d/1",
        "https://person.example.com:/d/1",
        "https://bad_host.example/d/1",
        "https://-bad.example/d/1",
        "https://münchen.example/d/1",
        "https://[::1]:0/d/1",
        "https://person.example.com/d\\1",
        "https://person.example.com/d?a=\\1",
    )
    for bad_url in bad_urls:
        relay.url = bad_url
        res = await _http_call(server, "memory-erase", {"id": "42"}, caps=URL_CAPS)
        assert res["error"]["code"] == -32603, f"begin:{bad_url}"

        begins_before = len(relay.begins)
        resumes_before = len(relay.resumes)
        relay.pending_rounds = 1
        resume_res = await _http_call(
            server,
            "memory-erase",
            {"id": "42"},
            caps=URL_CAPS,
            request_state=st,
            input_responses={RELAY_INPUT_KEY: {"action": "accept"}},
        )
        assert resume_res["error"]["code"] == -32603, f"resume:{bad_url}"
        assert len(relay.resumes) == resumes_before + 1
        assert len(relay.begins) == begins_before

        relay.enqueue_pending(RelayPendingDecision(decision="d-1", url=bad_url, list=list_url))
        p_url_res = await _http_call(server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
        assert p_url_res["error"]["code"] == -32603, f"pending-url:{bad_url}"

        relay.enqueue_pending(RelayPendingDecision(decision="d-1", url=decision_url, list=bad_url))
        p_list_res = await _http_call(server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
        assert p_list_res["error"]["code"] == -32603, f"pending-list:{bad_url}"

    # Bad return / raising / non-callable pending_list
    relay.enqueue_pending("not-an-outcome")  # type: ignore[arg-type]
    bad_ret = await _http_call(server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    assert bad_ret["error"]["code"] == -32603

    class _RaisingRelay(_ScriptedRelay):
        async def pending_list(self, call: RelayCall) -> PendingListOutcome | None:
            raise RuntimeError("boom")

    raising_server, _, _ = _pending_list_server(_RaisingRelay())
    raised = await _http_call(raising_server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    assert raised["error"]["code"] == -32603

    # Construction fails fast for a non-callable pending_list; runtime guard also rejects mutation.
    class _NonCallableRelay(_ScriptedRelay):
        pending_list = "not-callable"  # type: ignore[assignment]

    with pytest.raises(TypeError, match="pending_list"):
        _pending_list_server(_NonCallableRelay())

    mutated_relay = _ScriptedRelay()
    mutated_server, _, _ = _pending_list_server(mutated_relay)
    mutated_relay.pending_list = "not-callable"  # type: ignore[attr-defined]
    mutated_res = await _http_call(mutated_server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    assert mutated_res["error"]["code"] == -32603

    class _AsyncApprovedRelay(_ScriptedRelay):
        async def pending_list(self, call: RelayCall) -> PendingListOutcome | None:
            return RelayApproved(decision_id="async-d-1")

    async_server, async_runs, _ = _pending_list_server(_AsyncApprovedRelay())
    async_res = await _http_call(async_server, "memory-erase", {"id": "42"}, caps=FORM_CAPS)
    assert json.loads(async_res["result"]["content"][0]["text"])["success"] is True
    assert async_runs["erase"] == 1
    assert runs["erase"] == 0
