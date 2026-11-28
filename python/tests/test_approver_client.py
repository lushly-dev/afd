"""Unit and integration tests for the approver client carrier and approval display rules
beyond ``spec/vectors/approver-client.json``: 2025-era requests, failing predicates, truthy
non-boolean predicates, unbindable credentials, single-consumption evidence on nested calls,
``on_approval_accepted`` summaries, non-approver form elicitation, grouped/hybrid routing,
and approval display edge cases.
"""

from __future__ import annotations

import base64
import hashlib
import json
from contextlib import asynccontextmanager
from typing import Any

import pytest

from afd import (
    Actor,
    ExposeOptions,
    approval_display,
    fixed_clock,
    hides_characters,
    is_hidden_code_point,
    success,
)
from afd.core.commands import CommandContext
from afd.server import (
    AFD_APPROVAL_META_KEY,
    ApprovalSummary,
    Credentials,
    JwtIssuer,
    JwtVerifier,
    McpAuthOptions,
    PrincipalCredentials,
    create_approval_middleware,
    create_server,
    create_token_rules,
    jwks_key_source,
)
from afd.server.approver import ApproverCall, approval_key_in_input, bind_approver

SECRET = "test-approver-secret-0123456789abcdef"
ISSUER = "https://auth.example.com"
RESOURCE = "https://mcp.test.example/mcp"
MODERN = "2026-07-28"
SHELL_CREDS = PrincipalCredentials(issuer=ISSUER, subject="person-1", client_id="loam-shell")
SHELL_ACTOR = Actor(kind="agent", id="loam-shell", on_behalf_of="person-1")


# ─── Approval display edge cases ──────────────────────────────────────────────


def test_approval_display_omitted_unsafe_int_and_surrogates():
    omitted = approval_display()
    assert omitted.ok is True
    assert omitted.value == {}

    null_verdict = approval_display(None)
    assert null_verdict.ok is True
    assert null_verdict.value is None

    # Integer beyond 2^53 - 1 that JavaScript cannot hold exactly
    assert approval_display({"n": 9007199254740993}).refusal == "not-json"
    # Non-finite float, set, custom object, cycle
    assert approval_display({"x": float("nan")}).refusal == "not-json"
    assert approval_display({"x": {1, 2}}).refusal == "not-json"
    assert approval_display(object()).refusal == "not-json"
    cyclic: dict[str, Any] = {}
    cyclic["self"] = cyclic
    assert approval_display(cyclic).refusal == "not-json"

    # Unpaired surrogates
    assert is_hidden_code_point(0xD800) is True
    assert is_hidden_code_point(0xDFFF) is True
    assert is_hidden_code_point(-1) is False
    assert is_hidden_code_point(True) is False  # type: ignore[arg-type]
    assert hides_characters("\ud800") is True
    assert approval_display({"text": "\ud800"}).refusal == "hidden-characters"

    # Visible strings pass and return a plain JSON copy
    original = {"b": 1, "a": ("🍅", "café", True, None)}
    shown = approval_display(original)
    assert shown.ok is True
    assert shown.value == {"a": ["🍅", "café", True, None], "b": 1}


# ─── approval_key_in_input ────────────────────────────────────────────────────


def test_approval_key_in_input_deep_and_cycles():
    assert approval_key_in_input({"a": [{"b": {AFD_APPROVAL_META_KEY: 1}}]}) is not None
    assert approval_key_in_input({"a": AFD_APPROVAL_META_KEY, "b": ["dev.afd/confirm"]}) is None
    assert approval_key_in_input({"__proto__": {AFD_APPROVAL_META_KEY: "x"}}) is not None

    # 10,000-level deep nesting must not overflow recursion stack
    deep: dict[str, Any] = {}
    cur = deep
    for _ in range(10_000):
        nxt: dict[str, Any] = {}
        cur["x"] = nxt
        cur = nxt
    cur[AFD_APPROVAL_META_KEY] = "x"
    err = approval_key_in_input(deep)
    assert err is not None and err.code == "VALIDATION_ERROR"

    # Cycles terminate cleanly
    loop: dict[str, Any] = {"ok": True}
    loop["self"] = loop
    assert approval_key_in_input(loop) is None


# ─── Approval middleware direct approver tests ────────────────────────────────


@pytest.mark.asyncio
async def test_middleware_approver_principal_binding_and_single_consumption():
    mw = create_approval_middleware(secret=SECRET, include_token=False)

    async def next_fn():
        return success("ran")

    from afd.core.commands import CommandDefinition

    delete_def = CommandDefinition(
        name="todo-delete",
        description="Delete",
        handler=lambda _i, _c: success("ran"),
        approval="required",
    )
    list_def = CommandDefinition(
        name="todo-list",
        description="List",
        handler=lambda _i, _c: success([]),
    )
    mw = create_approval_middleware(
        secret=SECRET, commands=[delete_def, list_def], include_token=False
    )

    def make_ctx(*, approval: str | None = None, as_approver: bool = False, evidence: Any = None):
        ctx = CommandContext(
            extra={"interface": "mcp"},
            actor=SHELL_ACTOR,
            credentials=SHELL_CREDS,
            approval=approval,
        )
        if as_approver:
            bind_approver(ctx, ApproverCall(evidence=evidence))
        return ctx

    # Approver gets token even with include_token=False
    held = await mw("todo-delete", {"id": 7}, make_ctx(as_approver=True), next_fn)
    assert not held.success and held.error is not None
    tok = held.error.details["approvalToken"]
    assert tok.startswith("afdap1.")
    assert '_meta["dev.afd/approval"]' in (held.error.suggestion or "")

    # Same token on a non-approver call fails with actor-mismatch (bound to principal\0, not actor\0)
    outside = await mw("todo-delete", {"id": 7}, make_ctx(approval=tok, as_approver=False), next_fn)
    assert not outside.success and outside.error is not None
    assert outside.error.details["reason"] == "actor-mismatch"

    # Host context.approval on approver's own call succeeds
    host = await mw("todo-delete", {"id": 7}, make_ctx(approval=tok, as_approver=True), next_fn)
    assert host.success

    # Carried evidence is consumed by the first command checked, even one needing no approval
    held2 = await mw("todo-delete", {"id": 7}, make_ctx(as_approver=True), next_fn)
    tok2 = held2.error.details["approvalToken"]  # type: ignore[union-attr]
    shared = make_ctx(as_approver=True, evidence=tok2)
    assert (await mw("todo-list", {}, shared, next_fn)).success
    nested = await mw("todo-delete", {"id": 7}, shared, next_fn)
    assert not nested.success and nested.error is not None
    assert nested.error.code == "APPROVAL_REQUIRED"
    assert "reason" not in nested.error.details


def test_create_server_rejects_non_callable_approver():
    with pytest.raises(TypeError, match="approver must be callable"):
        create_server("bad-approver", approver="yes")  # type: ignore[arg-type]


# ─── End-to-end HTTP carrier tests ────────────────────────────────────────────


def _make_http_server(
    *,
    approver: Any = lambda ctx: (
        isinstance(ctx.credentials, Credentials) and ctx.credentials.client_id == "loam-shell"
    ),
    on_approval_accepted: Any = None,
    relay: str = "none",
    tool_strategy: str = "individual",
    idempotency: Any = None,
):
    pytest.importorskip("mcp")
    pytest.importorskip("cryptography")
    from tests.test_auth_verifier import JWKS, NOW

    verifier = JwtVerifier(
        create_token_rules(RESOURCE),
        [
            JwtIssuer(
                issuer=ISSUER,
                alias="as-0",
                algorithms=("ES256",),
                keys=jwks_key_source(JWKS),
            )
        ],
        clock=fixed_clock(NOW * 1000),
    )
    runs: list[str] = []
    mw = create_approval_middleware(
        secret=SECRET,
        relay=relay,  # type: ignore[arg-type]
        on_approval_accepted=on_approval_accepted,
    )
    server = create_server(
        "approver-test",
        version="1.0.0",
        tool_strategy=tool_strategy,  # type: ignore[arg-type]
        instances="single",
        clock=fixed_clock(NOW * 1000),
        middleware=[mw],
        auth=McpAuthOptions(
            resource=RESOURCE,
            authorization_servers=[ISSUER],
            verifier=verifier,
        ),
        approver=approver,
        idempotency=idempotency,
    )

    @server.command(
        name="todo-delete",
        description="Delete a todo",
        input_schema={
            "type": "object",
            "properties": {"id": {"type": "number"}},
            "required": ["id"],
        },
        mutation=True,
        idempotency="keyed",
        approval="required",
        expose=ExposeOptions(mcp=True),
    )
    async def todo_delete(inp: dict[str, Any], _ctx: CommandContext):
        runs.append(f"delete:{inp['id']}")
        return success({"deleted": inp["id"]})

    @server.command(
        name="todo-nested",
        description="Call todo-delete inside",
        input_schema={
            "type": "object",
            "properties": {"id": {"type": "number"}},
            "required": ["id"],
        },
        expose=ExposeOptions(mcp=True),
    )
    async def todo_nested(inp: dict[str, Any], ctx: CommandContext):
        return await server.execute("todo-delete", {"id": inp["id"]}, ctx)

    return server, runs


def _jwt(client_id: str = "loam-shell", subject: str = "person-1") -> str:
    from tests.test_auth_verifier import NOW, _sign_jws

    return _sign_jws(
        "ES256",
        claims={
            "iss": ISSUER,
            "aud": RESOURCE,
            "sub": subject,
            "client_id": client_id,
            "jti": f"tok-{client_id}",
            "iat": NOW - 10,
            "exp": NOW + 600,
        },
    )


@asynccontextmanager
async def _http_client(server: Any, *, stateless_http: bool = True):
    import httpx

    app = server.streamable_http_app(stateless_http=stateless_http, json_response=True)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:8000"
        ) as client:
            yield client


async def _modern_call(
    client: Any,
    tool: str,
    arguments: dict[str, Any],
    *,
    client_id: str = "loam-shell",
    subject: str = "person-1",
    approval: Any = None,
    elicit: bool = False,
    key: str | None = None,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {"elicitation": {}} if elicit else {},
        "io.modelcontextprotocol/clientInfo": {"name": "test", "version": "0"},
    }
    if approval is not None:
        meta[AFD_APPROVAL_META_KEY] = approval
    if key is not None:
        meta["dev.afd/idempotencyKey"] = key
    resp = await client.post(
        "/mcp",
        headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": MODERN,
            "Mcp-Method": "tools/call",
            "Mcp-Name": tool,
            "Authorization": f"Bearer {_jwt(client_id=client_id, subject=subject)}",
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool, "arguments": arguments, "_meta": meta},
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_approver_reports_to_on_approval_accepted_as_via_token():
    accepted: list[tuple[ApprovalSummary, str | None]] = []
    server, runs = _make_http_server(
        on_approval_accepted=lambda summary, dispatch_id: accepted.append((summary, dispatch_id))
    )
    async with _http_client(server) as client:
        held_rpc = await _modern_call(client, "todo-delete", {"id": 7})
        held = json.loads(held_rpc["result"]["content"][0]["text"])
        tok = held["error"]["details"]["approvalToken"]
        assert accepted == []

        ran_rpc = await _modern_call(client, "todo-delete", {"id": 7}, approval=tok)
        ran = json.loads(ran_rpc["result"]["content"][0]["text"])
        assert ran["success"] is True
        assert runs == ["delete:7"]

    assert len(accepted) == 1
    summary, dispatch_id = accepted[0]
    encoded = tok.split(".")[1]
    nonce = json.loads(
        base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode("utf-8")
    )["n"]
    expected_id = (
        base64.urlsafe_b64encode(hashlib.sha256(f"approval\0{nonce}".encode()).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    assert summary.via == "token"
    assert summary.command == "todo-delete"
    assert summary.approval_id == expected_id
    assert dispatch_id is not None and len(dispatch_id) == 22
    assert nonce not in json.dumps(summary.to_dict())


@pytest.mark.asyncio
async def test_approver_2025_era_gets_token_and_refuses_carried_key():
    server, runs = _make_http_server()
    async with _http_client(server, stateless_http=False) as client:
        init = await client.post(
            "/mcp",
            headers={
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {_jwt()}",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "legacy", "version": "0"},
                },
            },
        )
        assert init.status_code == 200, init.text
        session_id = init.headers["mcp-session-id"]
        legacy_headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2025-11-25",
            "Mcp-Session-Id": session_id,
            "Authorization": f"Bearer {_jwt()}",
        }
        await client.post(
            "/mcp",
            headers=legacy_headers,
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        )
        held_resp = await client.post(
            "/mcp",
            headers=legacy_headers,
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "todo-delete", "arguments": {"id": 7}},
            },
        )
        held = json.loads(held_resp.json()["result"]["content"][0]["text"])
        assert held["error"]["code"] == "APPROVAL_REQUIRED"
        tok = held["error"]["details"]["approvalToken"]
        assert tok.startswith("afdap1.")
        assert held["error"]["recovery"] == {"kind": "external"}

        retry_resp = await client.post(
            "/mcp",
            headers=legacy_headers,
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "todo-delete",
                    "arguments": {"id": 7},
                    "_meta": {AFD_APPROVAL_META_KEY: tok},
                },
            },
        )
        retry = json.loads(retry_resp.json()["result"]["content"][0]["text"])
        assert retry["error"]["code"] == "APPROVAL_REQUIRED"
        assert "one command" in retry["error"]["message"]
        assert retry["error"]["retryable"] is False
        assert "recovery" not in retry["error"]
        assert runs == []


@pytest.mark.asyncio
async def test_throwing_predicate_fails_closed_with_internal_error():
    def boom(_ctx: CommandContext) -> bool:
        raise RuntimeError("directory down")

    server, runs = _make_http_server(approver=boom)
    async with _http_client(server) as client:
        rpc = await _modern_call(client, "todo-delete", {"id": 7})
        assert "error" in rpc
        assert rpc["error"]["code"] == -32603
        assert "directory down" not in rpc["error"]["message"]
        assert runs == []


@pytest.mark.asyncio
async def test_truthy_non_bool_predicate_is_not_approver():
    server, runs = _make_http_server(approver=lambda _ctx: "yes")  # type: ignore[arg-type, return-value]
    async with _http_client(server) as client:
        rpc = await _modern_call(client, "todo-delete", {"id": 7})
        res = json.loads(rpc["result"]["content"][0]["text"])
        assert res["error"]["code"] == "APPROVAL_REQUIRED"
        assert "approvalToken" not in res["error"]["details"]
        assert runs == []


@pytest.mark.asyncio
async def test_non_approver_still_gets_form_elicitation():
    server, _runs = _make_http_server(approver=lambda _ctx: False, relay="mcp-elicitation")
    async with _http_client(server) as client:
        rpc = await _modern_call(client, "todo-delete", {"id": 7}, elicit=True)
        assert rpc["result"]["resultType"] == "input_required"
        assert list(rpc["result"]["inputRequests"].keys()) == ["approval"]


@pytest.mark.asyncio
async def test_approver_grouped_and_nested_consumption():
    server, runs = _make_http_server(tool_strategy="grouped")
    async with _http_client(server) as client:
        held_rpc = await _modern_call(client, "todo", {"action": "delete", "params": {"id": 7}})
        held = json.loads(held_rpc["result"]["content"][0]["text"])
        tok = held["error"]["details"]["approvalToken"]

        # Carried token on todo-nested is taken by todo-nested's middleware pass and never reaches
        # the nested todo-delete call.
        nested_rpc = await _modern_call(client, "todo-nested", {"id": 7}, approval=tok)
        nested = json.loads(nested_rpc["result"]["content"][0]["text"])
        assert nested["error"]["code"] == "APPROVAL_REQUIRED"
        assert "reason" not in nested["error"]["details"]
        assert runs == []

        # Original grouped retry still succeeds (token was not spent by todo-nested).
        ran_rpc = await _modern_call(
            client, "todo", {"action": "delete", "params": {"id": 7}}, approval=tok
        )
        ran = json.loads(ran_rpc["result"]["content"][0]["text"])
        assert ran["success"] is True
        assert runs == ["delete:7"]


@pytest.mark.asyncio
async def test_rule5_runs_before_context_hook_and_request_state_and_in_execute():
    hook_calls: list[str] = []

    def hook(_req: Any, ctx: CommandContext) -> CommandContext:
        hook_calls.append("called")
        return ctx

    pytest.importorskip("mcp")
    pytest.importorskip("cryptography")
    from tests.test_auth_verifier import JWKS, NOW

    verifier = JwtVerifier(
        create_token_rules(RESOURCE),
        [
            JwtIssuer(
                issuer=ISSUER,
                alias="as-0",
                algorithms=("ES256",),
                keys=jwks_key_source(JWKS),
            )
        ],
        clock=fixed_clock(NOW * 1000),
    )
    mw = create_approval_middleware(secret=SECRET, relay="mcp-elicitation")
    server = create_server(
        "rule5-order-test",
        version="1.0.0",
        tool_strategy="individual",
        instances="single",
        clock=fixed_clock(NOW * 1000),
        middleware=[mw],
        context_hook=hook,
        auth=McpAuthOptions(
            resource=RESOURCE,
            authorization_servers=[ISSUER],
            verifier=verifier,
        ),
        approver=lambda ctx: (
            isinstance(ctx.credentials, Credentials) and ctx.credentials.client_id == "loam-shell"
        ),
    )

    @server.command(
        name="todo-delete",
        description="Delete a todo",
        input_schema={"type": "object", "properties": {"id": {"type": "number"}}},
        mutation=True,
        approval="required",
        expose=ExposeOptions(mcp=True),
    )
    async def todo_delete(inp: dict[str, Any], _ctx: CommandContext):
        return success(inp)

    # 1. Over MCP with invalid requestState: VALIDATION_ERROR without invoking context_hook.
    async with _http_client(server) as client:
        resp = await client.post(
            "/mcp",
            headers={
                "Authorization": f"Bearer {_jwt()}",
                "Accept": "application/json, text/event-stream",
                "MCP-Protocol-Version": "2026-07-28",
                "MCP-Method": "tools/call",
                "MCP-Name": "todo-delete",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "todo-delete",
                    "arguments": {"id": 7, AFD_APPROVAL_META_KEY: "afdap1.x.y"},
                    "requestState": "bogus-tampered-state",
                    "inputResponses": {"approval": {"action": "accept"}},
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientCapabilities": {},
                    },
                },
            },
        )
        assert resp.status_code == 200, resp.text
        rpc = resp.json()
        assert "result" in rpc, rpc
        res = json.loads(rpc["result"]["content"][0]["text"])
        assert res["success"] is False
        assert res["error"]["code"] == "VALIDATION_ERROR"
        assert hook_calls == []

    # 2. In-process execute("afd-call", ...) with key in meta argument is also refused.
    exec_res = await server.execute(
        "afd-call",
        {
            "command": "todo-delete",
            "input": {"id": 7},
            "meta": {AFD_APPROVAL_META_KEY: "afdap1.x.y"},
        },
    )
    assert exec_res.success is False
    assert exec_res.error is not None
    assert exec_res.error.code == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_approver_retry_of_a_keyed_call_is_scoped_and_answered_from_the_store():
    from afd.server import IdempotencyOptions

    server, runs = _make_http_server(idempotency=IdempotencyOptions())

    async def approved(subject: str, key: str) -> dict[str, Any]:
        held_rpc = await _modern_call(client, "todo-delete", {"id": 7}, subject=subject, key=key)
        held = json.loads(held_rpc["result"]["content"][0]["text"])
        token = held["error"]["details"]["approvalToken"]
        rpc = await _modern_call(
            client, "todo-delete", {"id": 7}, subject=subject, key=key, approval=token
        )
        return json.loads(rpc["result"]["content"][0]["text"])

    async with _http_client(server) as client:
        first = await approved("person-1", "k1")
        assert first["success"] is True
        assert runs == ["delete:7"]
        # A repeat is approved again (I2), then answered from the store.
        again = await approved("person-1", "k1")
        assert again["success"] is True
        assert again["metadata"]["idempotentReplay"] is True
        assert runs == ["delete:7"]
        # Other credentials under the same approver are another principal (S3, M8).
        theirs = await approved("person-2", "k1")
        assert theirs["success"] is True
        assert "idempotentReplay" not in (theirs.get("metadata") or {})
        assert runs == ["delete:7", "delete:7"]
        # A malformed key fails before any approval evidence is read (K2).
        bad_rpc = await _modern_call(
            client, "todo-delete", {"id": 7}, key="not a key", approval="forged"
        )
        bad = json.loads(bad_rpc["result"]["content"][0]["text"])
        assert bad["error"]["code"] == "VALIDATION_ERROR"
        assert runs == ["delete:7", "delete:7"]
