"""End-to-end MCP authorization tests on HTTP (``spec/authorization.md``, M1–M5, M7, M8):
protected-resource metadata, 401 challenges and bodies, bearer stripping, verified
``CommandContext.credentials`` branding, ``context_hook`` integration, journal redaction,
fail-closed transport enforcement, principal binding on confirmations, and MCP Tasks.
"""

from __future__ import annotations

import asyncio
import base64
import contextvars
import hashlib
import json
from contextlib import asynccontextmanager
from typing import Any

import pytest

pytest.importorskip("mcp")
pytest.importorskip("cryptography")

import httpx  # noqa: E402
from mcp import Client, MCPError  # noqa: E402
from mcp.types import ElicitResult  # noqa: E402

from afd import Actor, ExposeOptions, MemoryJournalSink, success  # noqa: E402
from afd.core.clock import fixed_clock  # noqa: E402
from afd.core.commands import CommandContext  # noqa: E402
from afd.server import (  # noqa: E402
    AuthRefusal,
    ContextHookRequest,
    Credentials,
    JwtIssuer,
    JwtVerifier,
    McpAuthOptions,
    create_journal_middleware,
    create_server,
    create_token_rules,
    is_verified_credentials,
    jwks_key_source,
)
from tests.test_auth_verifier import ISSUER, JWKS, NOW, RESOURCE, _sign_jws  # noqa: E402

MCP = ExposeOptions(mcp=True)
METADATA_URL = "https://mcp.test.example/.well-known/oauth-protected-resource/mcp"
CHALLENGE = f'Bearer resource_metadata="{METADATA_URL}", scope="todo:read"'
BODY_401 = {
    "error": "UNAUTHORIZED",
    "suggestion": (
        f"Obtain a token for {RESOURCE} from an authorization server named in {METADATA_URL}."
    ),
}
MODERN = "2026-07-28"
MODERN_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": MODERN,
}
MODERN_META = {
    "io.modelcontextprotocol/protocolVersion": MODERN,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": {"name": "auth-test", "version": "0"},
}


def _tool_headers(tool_name: str, token: str | None = None) -> dict[str, str]:
    headers = {
        **MODERN_HEADERS,
        "Mcp-Method": "tools/call",
        "Mcp-Name": tool_name,
    }
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _rpc(method: str, params: dict[str, Any] | None = None, req_id: int = 1) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}


def _make_verifier(*, require_bound_tokens: bool = False) -> JwtVerifier:
    return JwtVerifier(
        create_token_rules(RESOURCE, require_bound_tokens=require_bound_tokens),
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


def _make_server(
    *,
    seen_contexts: list[CommandContext] | None = None,
    hook_records: list[dict[str, Any]] | None = None,
    refusals: list[AuthRefusal] | None = None,
    sink: MemoryJournalSink | None = None,
    context_hook: Any = None,
    confirmations: str = "off",
    confirmation_key: bytes | None = None,
    require_bound_tokens: bool = False,
    with_task: bool = False,
):
    seen = seen_contexts if seen_contexts is not None else []
    hooks = hook_records if hook_records is not None else []
    refusal_list = refusals if refusals is not None else []
    journal_sink = sink if sink is not None else MemoryJournalSink()

    def _default_hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        http_req = req.http_request
        raw_headers = dict(http_req.headers) if http_req is not None else {}
        hooks.append(
            {
                "authorization": req.header("authorization"),
                "headers": raw_headers,
                "credentials": ctx.credentials,
                "verified_in_hook": is_verified_credentials(ctx.credentials, NOW * 1000),
                "actor": ctx.actor,
            }
        )
        return ctx

    server = create_server(
        "auth-test",
        tool_strategy="individual",
        clock=fixed_clock(NOW * 1000),
        middleware=[create_journal_middleware(journal_sink)],
        context_hook=context_hook if context_hook is not None else _default_hook,
        confirmations=confirmations,
        confirmation_key=confirmation_key,
        auth=McpAuthOptions(
            resource=RESOURCE,
            authorization_servers=[ISSUER],
            scopes_supported=["todo:read"],
            verifier=_make_verifier(require_bound_tokens=require_bound_tokens),
            require_bound_tokens=require_bound_tokens,
            on_refusal=refusal_list.append,
        ),
    )

    @server.command(name="caller-get", description="Who is calling", expose=MCP)
    async def caller_get(_input: Any, context: CommandContext):
        seen.append(context)
        creds = context.credentials
        return success(
            {
                "actor": (
                    {
                        "kind": context.actor.kind,
                        "id": context.actor.id,
                        "onBehalfOf": context.actor.on_behalf_of,
                    }
                    if context.actor is not None
                    else None
                ),
                "verified": is_verified_credentials(creds, NOW * 1000),
                "subject": creds.subject if isinstance(creds, Credentials) else None,
                "clientId": creds.client_id if isinstance(creds, Credentials) else None,
            }
        )

    @server.command(
        name="todo-clear",
        description="Clear todos",
        mutation=True,
        destructive=True,
        confirm_prompt="Delete every todo?",
        expose=MCP,
    )
    async def todo_clear(_input: Any, context: CommandContext):
        seen.append(context)
        return success({"cleared": True})

    if with_task:

        @server.command(
            name="report-build",
            description="Long-running report",
            task="required",
            expose=MCP,
        )
        async def report_build(_input: Any, context: CommandContext):
            await asyncio.sleep(0.02)
            seen.append(context)
            return success(
                {
                    "verifiedDuringTask": is_verified_credentials(context.credentials, NOW * 1000),
                    "subject": (
                        context.credentials.subject
                        if isinstance(context.credentials, Credentials)
                        else None
                    ),
                }
            )

    return server, seen, hooks, refusal_list, journal_sink


@asynccontextmanager
async def _http_client(server: Any, *, stateless_http: bool = True):
    app = server.streamable_http_app(stateless_http=stateless_http, json_response=True)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:8000"
        ) as client:
            yield client


async def _raw_asgi_call(
    app: Any,
    *,
    method: str = "GET",
    path: str = "/mcp",
    query: bytes = b"",
    headers: list[tuple[bytes, bytes]] | None = None,
    body: bytes = b"",
    extensions: dict[str, Any] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    sent: list[dict[str, Any]] = []
    body_sent = False

    async def receive() -> dict[str, Any]:
        nonlocal body_sent
        if body_sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        body_sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    raw_headers = list(headers or [])
    if not any(k.lower() == b"host" for k, _ in raw_headers):
        raw_headers.append((b"host", b"127.0.0.1:8000"))

    scope: dict[str, Any] = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": query,
        "headers": raw_headers,
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8000),
        "extensions": extensions or {},
    }
    await app(scope, receive, send)
    start = next(msg for msg in sent if msg["type"] == "http.response.start")
    resp_headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in start["headers"]}
    resp_body = b"".join(
        msg.get("body", b"") for msg in sent if msg["type"] == "http.response.body"
    )
    return start["status"], resp_headers, resp_body


# ── M7: protected-resource metadata ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_metadata_served_publicly_at_both_paths_get_only() -> None:
    server, _, _, _, _ = _make_server()
    expected = {
        "resource": RESOURCE,
        "authorization_servers": [ISSUER],
        "scopes_supported": ["todo:read"],
        "bearer_methods_supported": ["header"],
        "tls_client_certificate_bound_access_tokens": False,
    }
    async with _http_client(server) as client:
        for path in (
            "/.well-known/oauth-protected-resource/mcp",
            "/.well-known/oauth-protected-resource",
        ):
            res = await client.get(path)
            assert res.status_code == 200
            assert res.json() == expected
            post_res = await client.post(path)
            assert post_res.status_code == 405
            assert post_res.headers.get("allow") == "GET"


# ── M2 & M5: 401 challenges, token location & form body ────────────────────────


@pytest.mark.asyncio
async def test_missing_and_invalid_tokens_answer_m5_401() -> None:
    server, seen, _, refusals, _ = _make_server()
    call_body = _rpc("tools/call", {"name": "caller-get", "arguments": {}, "_meta": MODERN_META})
    async with _http_client(server) as client:
        no_tok = await client.post("/mcp", json=call_body, headers=MODERN_HEADERS)
        assert no_tok.status_code == 401
        assert no_tok.headers["www-authenticate"] == CHALLENGE
        assert no_tok.json() == BODY_401
        assert refusals[-1] == AuthRefusal(rule="no-token")

        bad_tok = await client.post(
            "/mcp",
            json=call_body,
            headers={**MODERN_HEADERS, "Authorization": "Bearer not-a-jwt"},
        )
        assert bad_tok.status_code == 401
        assert bad_tok.headers["www-authenticate"] == f'{CHALLENGE}, error="invalid_token"'
        assert bad_tok.json() == BODY_401
        assert refusals[-1] == AuthRefusal(rule="unknown-issuer")

        expired = _sign_jws(claims={"exp": NOW - 120})
        exp_res = await client.post(
            "/mcp",
            json=call_body,
            headers={**MODERN_HEADERS, "Authorization": f"Bearer {expired}"},
        )
        assert exp_res.status_code == 401
        assert refusals[-1] == AuthRefusal(rule="expired", issuer="test-as")
    assert seen == []


@pytest.mark.asyncio
async def test_m2_token_location_refusals_and_form_body() -> None:
    server, _, _, refusals, _ = _make_server()
    app = server.streamable_http_app(stateless_http=True, json_response=True)
    valid = _sign_jws()

    # Query access_token refused even beside valid header.
    status, headers, raw = await _raw_asgi_call(
        app,
        method="POST",
        path="/mcp",
        query=b"access_token=abc",
        headers=[(b"authorization", f"Bearer {valid}".encode("ascii"))],
    )
    assert status == 401
    assert headers["www-authenticate"] == f'{CHALLENGE}, error="invalid_token"'
    assert json.loads(raw) == BODY_401
    assert refusals[-1] == AuthRefusal(rule="token-location")

    # Duplicate Authorization header refused.
    status, _, _ = await _raw_asgi_call(
        app,
        method="POST",
        path="/mcp",
        headers=[
            (b"authorization", f"Bearer {valid}".encode("ascii")),
            (b"authorization", f"Bearer {valid}".encode("ascii")),
        ],
    )
    assert status == 401
    assert refusals[-1] == AuthRefusal(rule="token-location")

    # Form body with access_token refused with 401 token-location.
    status, _, _ = await _raw_asgi_call(
        app,
        method="POST",
        path="/mcp",
        headers=[
            (b"content-type", b"application/x-www-form-urlencoded"),
            (b"authorization", f"Bearer {valid}".encode("ascii")),
        ],
        body=b"foo=1&access_token=secret",
    )
    assert status == 401
    assert refusals[-1] == AuthRefusal(rule="token-location")

    # Form body without access_token and with valid header -> 415.
    status, _, _ = await _raw_asgi_call(
        app,
        method="POST",
        path="/mcp",
        headers=[
            (b"content-type", b"application/x-www-form-urlencoded"),
            (b"authorization", f"Bearer {valid}".encode("ascii")),
        ],
        body=b"foo=1",
    )
    assert status == 415


# ── M2 & M4: stripping, verified brand, context_hook & journal ─────────────────


@pytest.mark.asyncio
async def test_valid_token_reaches_command_strips_header_unbrands_after_and_keeps_journal_clean() -> (
    None
):
    server, seen, hooks, _, sink = _make_server()
    token = _sign_jws("EdDSA")
    signature = token.split(".")[2]
    call_body = _rpc("tools/call", {"name": "caller-get", "arguments": {}, "_meta": MODERN_META})

    async with _http_client(server) as client:
        res = await client.post(
            "/mcp",
            json=call_body,
            headers=_tool_headers("caller-get", token),
        )
        assert res.status_code == 200
        rpc_data = res.json()
        tool_text = rpc_data["result"]["content"][0]["text"]
        payload = json.loads(tool_text)
        assert payload["success"] is True
        assert payload["data"] == {
            "actor": {"kind": "agent", "id": "agent-1", "onBehalfOf": "user-1"},
            "verified": True,
            "subject": "user-1",
            "clientId": "agent-1",
        }

    # Authorization header stripped before context_hook.
    assert len(hooks) == 1
    assert hooks[0]["authorization"] is None
    assert "authorization" not in {k.lower() for k in hooks[0]["headers"]}
    assert hooks[0]["verified_in_hook"] is True
    assert hooks[0]["actor"] == Actor(kind="agent", id="agent-1", on_behalf_of="user-1")

    # Brand removed once the HTTP request ended.
    assert len(seen) == 1
    creds = seen[0].credentials
    assert isinstance(creds, Credentials)
    assert is_verified_credentials(creds, NOW * 1000) is False

    # Journal never holds the token, signature, credentials or issuer.
    entries = await sink.read()
    assert len(entries) == 1
    journal_text = json.dumps([e.to_dict() for e in entries])
    assert token not in journal_text
    assert signature not in journal_text
    assert "credentials" not in journal_text
    assert ISSUER not in journal_text


@pytest.mark.asyncio
async def test_context_hook_can_map_actor_but_cannot_alter_credentials() -> None:
    forged = Credentials(
        issuer="https://evil.example",
        subject="admin",
        client_id="evil-client",
        scopes=("admin",),
        resource=RESOURCE,
        expires_at=NOW + 600,
        issued_at=NOW,
    )

    def hook(_req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        return CommandContext(
            actor=Actor(kind="human", id=f"mapped:{ctx.credentials.subject}"),
            credentials=forged,
        )

    server, seen, _, _, _ = _make_server(context_hook=hook)
    token = _sign_jws()
    call_body = _rpc("tools/call", {"name": "caller-get", "arguments": {}, "_meta": MODERN_META})
    async with _http_client(server) as client:
        res = await client.post(
            "/mcp",
            json=call_body,
            headers=_tool_headers("caller-get", token),
        )
        assert res.status_code == 200
        data = json.loads(res.json()["result"]["content"][0]["text"])["data"]
        assert data["actor"] == {"kind": "human", "id": "mapped:user-1", "onBehalfOf": None}
        assert data["subject"] == "user-1"
        assert data["verified"] is True
    assert seen[0].credentials.issuer == ISSUER


# ── M3 rule 10: TLS client certificate binding over ASGI ───────────────────────


@pytest.mark.asyncio
async def test_mtls_certificate_binding_over_asgi_tls_extension() -> None:
    cert_der = b"fake-der-certificate-bytes-for-test"
    thumbprint = (
        base64.urlsafe_b64encode(hashlib.sha256(cert_der).digest()).rstrip(b"=").decode("ascii")
    )
    server, _, _, refusals, _ = _make_server(require_bound_tokens=True)
    app = server.streamable_http_app(stateless_http=True, json_response=True)
    bound_token = _sign_jws(claims={"cnf": {"x5t#S256": thumbprint}})
    body = json.dumps(
        _rpc("tools/call", {"name": "caller-get", "arguments": {}, "_meta": MODERN_META})
    ).encode("utf-8")
    headers = [
        (k.lower().encode("ascii"), v.encode("ascii"))
        for k, v in _tool_headers("caller-get", bound_token).items()
    ]

    # Without client cert -> 401 binding.
    status, _, _ = await _raw_asgi_call(app, method="POST", path="/mcp", headers=headers, body=body)
    assert status == 401
    assert refusals[-1] == AuthRefusal(rule="binding", issuer="test-as")

    # With matching client cert -> 200.
    async with app.router.lifespan_context(app):
        status, _, raw = await _raw_asgi_call(
            app,
            method="POST",
            path="/mcp",
            headers=headers,
            body=body,
            extensions={"tls": {"client_cert_chain": [cert_der]}},
        )
    assert status == 200
    payload = json.loads(json.loads(raw)["result"]["content"][0]["text"])
    assert payload["success"] is True


# ── M1: fail closed on unauthenticated transports, stdio & trusted unaffected ──


def _find_mcp_error(exc: BaseException) -> MCPError | None:
    if isinstance(exc, MCPError):
        return exc
    for child in getattr(exc, "exceptions", ()):
        found = _find_mcp_error(child)
        if found is not None:
            return found
    return None


@pytest.mark.asyncio
async def test_m1_fail_closed_untrusted_transport_and_trusted_escape_hatch() -> None:
    server, seen, _, _, _ = _make_server()
    mcp = server._create_mcp_server()

    # Untrusted in-process Client(mcp) fails closed right at discovery/initialize.
    with pytest.raises(BaseException) as client_err:
        async with Client(mcp):
            pass
    inner = _find_mcp_error(client_err.value)
    assert inner is not None
    assert inner.error.data["code"] == "UNAUTHORIZED"

    # Direct MCP calls without bearer admission also fail closed.
    with pytest.raises(MCPError) as list_err:
        await mcp.list_tools()
    assert list_err.value.error.data["code"] == "UNAUTHORIZED"

    call_res = await mcp.call_tool("caller-get", {})
    payload = json.loads(call_res.content[0].text)
    assert payload["success"] is False
    assert payload["error"]["code"] == "UNAUTHORIZED"
    assert seen == []

    # Cross-server isolation: credentials admitted by Server A's layer do NOT admit Server B.
    server_a, _, _, _, _ = _make_server()
    unwrapped_b = super(type(mcp), mcp).streamable_http_app(stateless_http=True, json_response=True)
    miswired = server_a._auth_layer.wrap_asgi_app(unwrapped_b)
    token = _sign_jws()
    async with miswired.router.lifespan_context(miswired):
        transport = httpx.ASGITransport(app=miswired)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:8000"
        ) as client:
            res = await client.post(
                "/mcp",
                json=_rpc(
                    "tools/call", {"name": "caller-get", "arguments": {}, "_meta": MODERN_META}
                ),
                headers=_tool_headers("caller-get", token),
            )
            assert res.status_code == 200
            cross_payload = json.loads(res.json()["result"]["content"][0]["text"])
            assert cross_payload["success"] is False
            assert cross_payload["error"]["code"] == "UNAUTHORIZED"
    assert seen == []

    # In-process server.execute() is unaffected (M1).
    direct = await server.execute("caller-get", {})
    assert direct.success is True
    assert direct.data["verified"] is False

    # Explicitly trusted transport is allowed without credentials, scoped to that server only (M1).
    other_server, _, _, _, _ = _make_server()
    other_mcp = other_server._create_mcp_server()
    with server.trusted_transport():
        with pytest.raises(MCPError) as other_err:
            await other_mcp.list_tools()
        assert other_err.value.error.data["code"] == "UNAUTHORIZED"
        async with Client(mcp) as client:
            listed = await client.list_tools()
            assert any(t.name == "caller-get" for t in listed.tools)
            call_res = await client.call_tool("caller-get", {})
            payload = json.loads(call_res.content[0].text)
            assert payload["success"] is True


@pytest.mark.asyncio
async def test_m1_sse_app_requires_bearer_token() -> None:
    server, _, _, refusals, _ = _make_server()
    app = server.sse_app()
    status, headers, raw = await _raw_asgi_call(app, method="GET", path="/sse")
    assert status == 401
    assert headers["www-authenticate"] == CHALLENGE
    assert json.loads(raw) == BODY_401
    assert refusals[-1] == AuthRefusal(rule="no-token")

    meta_status, _, meta_raw = await _raw_asgi_call(
        app, method="GET", path="/.well-known/oauth-protected-resource/mcp"
    )
    assert meta_status == 200
    assert json.loads(meta_raw)["resource"] == RESOURCE


# ── M8: principal binding with AFD verified credentials ────────────────────────


@pytest.mark.asyncio
async def test_confirmation_request_state_binds_afd_verified_credentials() -> None:
    server, _, _, _, _ = _make_server(
        confirmations="require-human",
        confirmation_key=b"k" * 32,
        context_hook=lambda _r, ctx: ctx,
    )
    meta = {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {"elicitation": {"form": {}}},
        "io.modelcontextprotocol/clientInfo": {"name": "auth-test", "version": "0"},
    }
    alice = _sign_jws(claims={"sub": "alice", "client_id": "client-1"})
    bob = _sign_jws(claims={"sub": "bob", "client_id": "client-1"})
    alice_other_client = _sign_jws(claims={"sub": "alice", "client_id": "client-2"})

    async with _http_client(server) as client:
        first = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "todo-clear", "arguments": {}, "_meta": meta}),
            headers=_tool_headers("todo-clear", alice),
        )
        assert first.status_code == 200
        result = first.json()["result"]
        assert result["resultType"] == "input_required"
        state = result["requestState"]
        answers = {
            "confirm": ElicitResult(action="accept", content={"confirm": True}).model_dump(
                by_alias=True
            )
        }
        retry_body = _rpc(
            "tools/call",
            {
                "name": "todo-clear",
                "arguments": {},
                "requestState": state,
                "inputResponses": answers,
                "_meta": meta,
            },
        )

        # Bob cannot replay Alice's confirmation state (-32602).
        bob_res = await client.post(
            "/mcp",
            json=retry_body,
            headers=_tool_headers("todo-clear", bob),
        )
        assert bob_res.json()["error"]["code"] == -32602

        # Another client of Alice cannot replay it either (-32602).
        other_res = await client.post(
            "/mcp",
            json=retry_body,
            headers=_tool_headers("todo-clear", alice_other_client),
        )
        assert other_res.json()["error"]["code"] == -32602

        # Alice on the same client succeeds.
        ok_res = await client.post(
            "/mcp",
            json=retry_body,
            headers=_tool_headers("todo-clear", alice),
        )
        ok_payload = json.loads(ok_res.json()["result"]["content"][0]["text"])
        assert ok_payload["success"] is True
        assert ok_payload["data"] == {"cleared": True}


# ── MCP Tasks integration with AFD auth ────────────────────────────────────────


@pytest.mark.asyncio
async def test_mcp_tasks_bind_afd_credentials_and_preserve_brand_until_completion() -> None:
    server, seen, _, _, _ = _make_server(with_task=True, context_hook=lambda _r, ctx: ctx)
    task_meta = {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {
            "extensions": {"io.modelcontextprotocol/tasks": {}}
        },
        "io.modelcontextprotocol/clientInfo": {"name": "task-client", "version": "0"},
    }
    alice = _sign_jws(claims={"sub": "alice", "client_id": "client-1"})
    bob = _sign_jws(claims={"sub": "bob", "client_id": "client-1"})

    async with _http_client(server) as client:
        start = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "report-build", "arguments": {}, "_meta": task_meta}),
            headers=_tool_headers("report-build", alice),
        )
        assert start.status_code == 200
        created = start.json()["result"]
        assert created["resultType"] == "task"
        task_id = created["taskId"]

        # Wait for the background task to run (after the creating HTTP response already closed).
        await asyncio.sleep(0.08)

        # Bob gets "Task not found" on tasks/get.
        bob_get = await client.post(
            "/mcp",
            json=_rpc("tasks/get", {"taskId": task_id, "_meta": task_meta}),
            headers={
                **MODERN_HEADERS,
                "Mcp-Method": "tasks/get",
                "Mcp-Name": task_id,
                "Authorization": f"Bearer {bob}",
            },
        )
        assert bob_get.json()["error"]["code"] == -32602
        assert bob_get.json()["error"]["message"] == "Task not found"

        # Alice reads the completed result; credentials stayed verified during background run.
        alice_get = await client.post(
            "/mcp",
            json=_rpc("tasks/get", {"taskId": task_id, "_meta": task_meta}),
            headers={
                **MODERN_HEADERS,
                "Mcp-Method": "tasks/get",
                "Mcp-Name": task_id,
                "Authorization": f"Bearer {alice}",
            },
        )
        detailed = alice_get.json()["result"]
        assert detailed["status"] == "completed"
        task_payload = json.loads(detailed["result"]["content"][0]["text"])
        assert task_payload["data"] == {"verifiedDuringTask": True, "subject": "alice"}

    # Once the task finished, its cloned credentials were unbranded.
    assert len(seen) == 1
    assert is_verified_credentials(seen[0].credentials, NOW * 1000) is False


# ── Configuration validation ───────────────────────────────────────────────────


def test_auth_configuration_validation() -> None:
    v = _make_verifier()
    with pytest.raises(ValueError, match="audience"):
        create_server(
            "bad-resource",
            auth=McpAuthOptions(
                resource="https://other.example/mcp",
                authorization_servers=[ISSUER],
                verifier=v,
            ),
        )
    with pytest.raises(ValueError, match="disagree"):
        create_server(
            "bad-binding",
            auth=McpAuthOptions(
                resource=RESOURCE,
                authorization_servers=[ISSUER],
                verifier=v,
                require_bound_tokens=True,
            ),
        )
    with pytest.raises(ValueError, match="authorization_servers"):
        create_server(
            "bad-issuer",
            auth=McpAuthOptions(
                resource=RESOURCE,
                authorization_servers=["https://another.example"],
                verifier=v,
            ),
        )


# ── Regression tests from independent review ───────────────────────────────────


@pytest.mark.asyncio
async def test_batch_and_pipe_forward_verified_credentials_and_unbrand_after() -> None:
    server, seen, _, _, _ = _make_server()
    token = _sign_jws("EdDSA", claims={"sub": "alice", "client_id": "cli-1"})

    async with _http_client(server) as client:
        batch_res = await client.post(
            "/mcp",
            json=_rpc(
                "tools/call",
                {
                    "name": "afd-batch",
                    "arguments": {
                        "commands": [
                            {"id": "one", "command": "caller-get", "input": {}},
                            {"id": "two", "command": "caller-get", "input": {}},
                        ]
                    },
                    "_meta": MODERN_META,
                },
            ),
            headers=_tool_headers("afd-batch", token),
        )
        assert batch_res.status_code == 200
        batch_payload = json.loads(batch_res.json()["result"]["content"][0]["text"])
        assert batch_payload["success"] is True
        for item in batch_payload["results"]:
            assert item["result"]["success"] is True
            assert item["result"]["data"]["verified"] is True
            assert item["result"]["data"]["subject"] == "alice"

        pipe_res = await client.post(
            "/mcp",
            json=_rpc(
                "tools/call",
                {
                    "name": "afd-pipe",
                    "arguments": {"steps": [{"command": "caller-get", "input": {}, "as": "who"}]},
                    "_meta": MODERN_META,
                },
            ),
            headers=_tool_headers("afd-pipe", token),
        )
        assert pipe_res.status_code == 200
        pipe_payload = json.loads(pipe_res.json()["result"]["content"][0]["text"])
        assert pipe_payload["steps"][0]["status"] == "success"
        assert pipe_payload["data"]["verified"] is True
        assert pipe_payload["data"]["subject"] == "alice"

    assert len(seen) == 3
    for ctx in seen:
        assert is_verified_credentials(ctx.credentials, NOW * 1000) is False


@pytest.mark.asyncio
async def test_context_hook_in_place_credentials_mutation_cannot_tamper_authoritative_claims() -> (
    None
):
    def mutating_hook(_req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        assert is_verified_credentials(ctx.credentials, NOW * 1000) is True
        object.__setattr__(ctx.credentials, "subject", "admin-spoofed")
        object.__setattr__(ctx.credentials, "scopes", ("admin:all",))
        return ctx

    server, seen, _, _, _ = _make_server(context_hook=mutating_hook)
    token = _sign_jws(claims={"sub": "alice", "client_id": "client-1", "scope": "todo:read"})
    async with _http_client(server) as client:
        res = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "caller-get", "arguments": {}, "_meta": MODERN_META}),
            headers=_tool_headers("caller-get", token),
        )
        assert res.status_code == 200
        data = json.loads(res.json()["result"]["content"][0]["text"])["data"]
        assert data["verified"] is True
        assert data["subject"] == "alice"
    assert seen[0].credentials.subject == "alice"
    assert seen[0].credentials.scopes == ("todo:read",)


@pytest.mark.asyncio
async def test_leaked_contextvar_snapshot_fails_closed_after_request_ends() -> None:
    captured_ctx: list[contextvars.Context] = []

    def capture_hook(_req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        captured_ctx.append(contextvars.copy_context())
        return ctx

    server, _, _, _, _ = _make_server(context_hook=capture_hook)
    token = _sign_jws()
    async with _http_client(server) as client:
        res = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "caller-get", "arguments": {}, "_meta": MODERN_META}),
            headers=_tool_headers("caller-get", token),
        )
        assert res.status_code == 200
    assert len(captured_ctx) == 1
    mcp = server._mcp_server
    assert mcp is not None

    async def _replay_leaked() -> Any:
        return await mcp.call_tool("caller-get", {})

    replayed = await captured_ctx[0].run(_replay_leaked)
    payload = json.loads(replayed.content[0].text)
    assert payload["success"] is False
    assert payload["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_percent_encoded_resource_metadata_path_and_form_body_cap_clamp() -> None:
    encoded_resource = "https://mcp.test.example/my%20mcp"
    verifier = JwtVerifier(
        create_token_rules(encoded_resource),
        [
            JwtIssuer(
                issuer=ISSUER,
                alias="test-as",
                algorithms=("RS256",),
                keys=jwks_key_source(JWKS),
            )
        ],
        clock=fixed_clock(NOW * 1000),
    )
    server = create_server(
        "encoded-test",
        clock=fixed_clock(NOW * 1000),
        auth=McpAuthOptions(
            resource=encoded_resource,
            authorization_servers=[ISSUER],
            verifier=verifier,
            max_form_body_bytes=16,
        ),
    )
    # Passing a larger max_request_body_size must NOT widen max_form_body_bytes.
    app = server.streamable_http_app(
        stateless_http=True, json_response=True, max_request_body_size=1024
    )
    # ASGI sends decoded `path` alongside encoded `raw_path`.
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(msg: dict[str, Any]) -> None:
        sent.append(msg)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/.well-known/oauth-protected-resource/my mcp",
            "raw_path": b"/.well-known/oauth-protected-resource/my%20mcp",
            "query_string": b"",
            "headers": [(b"host", b"127.0.0.1:8000")],
            "client": ("127.0.0.1", 12345),
            "server": ("127.0.0.1", 8000),
            "extensions": {},
        },
        receive,
        send,
    )
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    assert start["status"] == 200
    assert json.loads(body)["resource"] == encoded_resource

    # Form body exceeding configured max_form_body_bytes (16) answers 413 even though SDK limit is 1024.
    status, _, _ = await _raw_asgi_call(
        app,
        method="POST",
        path="/mcp",
        headers=[(b"content-type", b"application/x-www-form-urlencoded")],
        body=b"a=" + b"x" * 32,
    )
    assert status == 413


@pytest.mark.asyncio
async def test_stateful_streamable_http_binds_session_to_verified_principal() -> None:
    server, _, _, _, _ = _make_server()
    alice = _sign_jws(claims={"sub": "alice", "client_id": "client-1"})
    bob = _sign_jws(claims={"sub": "bob", "client_id": "client-1"})
    legacy_headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }

    async with _http_client(server, stateless_http=False) as client:
        init = await client.post(
            "/mcp",
            json=_rpc(
                "initialize",
                {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "stateful-test", "version": "0"},
                },
            ),
            headers={**legacy_headers, "Authorization": f"Bearer {alice}"},
        )
        assert init.status_code == 200
        session_id = init.headers.get("mcp-session-id")
        assert session_id

        # Bob with his own valid token gets 404 on Alice's session (POST and DELETE).
        bob_post = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "caller-get", "arguments": {}}, req_id=2),
            headers={
                **legacy_headers,
                "Authorization": f"Bearer {bob}",
                "Mcp-Session-Id": session_id,
            },
        )
        assert bob_post.status_code == 404

        bob_delete = await client.delete(
            "/mcp",
            headers={
                "Authorization": f"Bearer {bob}",
                "Mcp-Session-Id": session_id,
            },
        )
        assert bob_delete.status_code == 404

        # Alice sends notifications/initialized (HTTP 202 queued dispatch) without error.
        notif = await client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
            headers={
                **legacy_headers,
                "Authorization": f"Bearer {alice}",
                "Mcp-Session-Id": session_id,
            },
        )
        assert notif.status_code == 202

        # Alice can still use her session and sees her own verified credentials.
        alice_call = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "caller-get", "arguments": {}}, req_id=3),
            headers={
                **legacy_headers,
                "Authorization": f"Bearer {alice}",
                "Mcp-Session-Id": session_id,
            },
        )
        assert alice_call.status_code == 200
        data = json.loads(alice_call.json()["result"]["content"][0]["text"])["data"]
        assert data["verified"] is True
        assert data["subject"] == "alice"


@pytest.mark.asyncio
async def test_sse_app_authenticated_call_preserves_brand_and_enforces_session_owner() -> None:
    server, seen, _, _, _ = _make_server()
    app = server.sse_app()
    alice = _sign_jws(claims={"sub": "alice", "client_id": "client-1"})
    bob = _sign_jws(claims={"sub": "bob", "client_id": "client-1"})

    disconnect = asyncio.Event()
    sse_events: asyncio.Queue[bytes] = asyncio.Queue()

    async def sse_receive() -> dict[str, Any]:
        await disconnect.wait()
        return {"type": "http.disconnect"}

    async def sse_send(message: dict[str, Any]) -> None:
        if message.get("type") == "http.response.body":
            chunk = message.get("body", b"")
            if chunk:
                await sse_events.put(chunk)

    sse_scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/sse",
        "raw_path": b"/sse",
        "query_string": b"",
        "headers": [
            (b"host", b"127.0.0.1:8000"),
            (b"authorization", f"Bearer {alice}".encode("ascii")),
        ],
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8000),
        "extensions": {},
    }

    async def next_sse_data(expected_event: str) -> str:
        buf = ""
        while True:
            chunk = await asyncio.wait_for(sse_events.get(), timeout=5.0)
            buf += chunk.decode("utf-8")
            for block in buf.split("\r\n\r\n"):
                lines = [ln for ln in block.replace("\r\n", "\n").split("\n") if ln]
                event = next((ln[6:].strip() for ln in lines if ln.startswith("event:")), None)
                data_lines = [ln[5:].strip() for ln in lines if ln.startswith("data:")]
                if event == expected_event and data_lines:
                    return "\n".join(data_lines)

    sse_task = asyncio.create_task(app(sse_scope, sse_receive, sse_send))
    try:
        endpoint = await next_sse_data("endpoint")
        assert endpoint.startswith("/messages/?session_id=")
        msg_path, msg_query = endpoint.split("?", 1)

        # Initialize over SSE POST.
        init_status, _, _ = await _raw_asgi_call(
            app,
            method="POST",
            path=msg_path,
            query=msg_query.encode("ascii"),
            headers=[
                (b"content-type", b"application/json"),
                (b"authorization", f"Bearer {alice}".encode("ascii")),
            ],
            body=json.dumps(
                _rpc(
                    "initialize",
                    {
                        "protocolVersion": "2025-11-25",
                        "capabilities": {},
                        "clientInfo": {"name": "sse-test", "version": "0"},
                    },
                    req_id=1,
                )
            ).encode("utf-8"),
        )
        assert init_status == 202
        init_msg = json.loads(await next_sse_data("message"))
        assert init_msg["id"] == 1

        # Bob cannot post to Alice's SSE session -> 404.
        bob_status, _, _ = await _raw_asgi_call(
            app,
            method="POST",
            path=msg_path,
            query=msg_query.encode("ascii"),
            headers=[
                (b"content-type", b"application/json"),
                (b"authorization", f"Bearer {bob}".encode("ascii")),
            ],
            body=json.dumps(
                _rpc("tools/call", {"name": "caller-get", "arguments": {}}, req_id=2)
            ).encode("utf-8"),
        )
        assert bob_status == 404

        # Alice calls caller-get over SSE POST -> command sees verified=True during execution.
        call_status, _, _ = await _raw_asgi_call(
            app,
            method="POST",
            path=msg_path,
            query=msg_query.encode("ascii"),
            headers=[
                (b"content-type", b"application/json"),
                (b"authorization", f"Bearer {alice}".encode("ascii")),
            ],
            body=json.dumps(
                _rpc("tools/call", {"name": "caller-get", "arguments": {}}, req_id=3)
            ).encode("utf-8"),
        )
        assert call_status == 202
        call_msg = json.loads(await next_sse_data("message"))
        assert call_msg["id"] == 3
        data = json.loads(call_msg["result"]["content"][0]["text"])["data"]
        assert data["verified"] is True
        assert data["subject"] == "alice"

        # After the dispatched SSE call completed, its credentials were unbranded.
        await asyncio.sleep(0.01)
        assert len(seen) == 1
        assert is_verified_credentials(seen[0].credentials, NOW * 1000) is False
    finally:
        disconnect.set()
        await asyncio.wait_for(sse_task, timeout=5.0)


@pytest.mark.asyncio
async def test_uvicorn_access_log_disabled_when_auth_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import uvicorn

    captured: list[Any] = []

    class _FakeServer:
        def __init__(self, config: Any) -> None:
            captured.append(config)

        async def serve(self) -> None:
            return None

    monkeypatch.setattr(uvicorn, "Server", _FakeServer)
    server, _, _, _, _ = _make_server()
    await server.run_async("streamable-http", host="127.0.0.1", port=0)
    await server.run_async("sse", host="127.0.0.1", port=0)
    assert len(captured) == 2
    assert all(cfg.access_log is False for cfg in captured)


@pytest.mark.asyncio
async def test_claim_admitted_dispatch_fails_closed_on_eager_replay_and_expiry() -> None:
    from afd.server.auth import (
        _ADMITTED_AUTH,
        _AdmittedAuth,
        _QueuedDispatch,
        admitted_credentials_for,
        claim_admitted_dispatch,
    )
    from afd.server.auth_rules import (
        _brand_verified_credentials,
        _unbrand_verified_credentials,
    )

    clock = fixed_clock(NOW * 1000)
    server = create_server(
        "handoff-test",
        clock=clock,
        auth=McpAuthOptions(
            resource=RESOURCE,
            authorization_servers=[ISSUER],
            verifier=_make_verifier(),
        ),
    )
    layer = server._auth_layer
    assert layer is not None

    creds = Credentials(
        issuer=ISSUER,
        subject="alice",
        client_id="client-1",
        scopes=("todo:read",),
        resource=RESOURCE,
        expires_at=NOW + 60,
        issued_at=NOW,
    )

    # Eager interleaving: original `creds` is STILL branded (POST `finally:` has not run yet).
    _brand_verified_credentials(creds, skew_s=60)
    try:
        # 1. Single-use handoff succeeds once, then a replay BEFORE POST `finally:` fails closed.
        handoff = _QueuedDispatch(queued=True)
        tok = _ADMITTED_AUTH.set(
            _AdmittedAuth(layer=layer, credentials=creds, skew_s=60, handoff=handoff)
        )
        try:
            with claim_admitted_dispatch(layer):
                admitted = admitted_credentials_for(layer)
                assert admitted is not None and admitted is not creds
                assert is_verified_credentials(admitted, NOW * 1000) is True
            # Fresh dispatch copy was unbranded on exit.
            assert is_verified_credentials(admitted, NOW * 1000) is False

            # Replay while `creds` is STILL branded in `_VERIFIED_BRANDS` MUST fail closed!
            with claim_admitted_dispatch(layer):
                assert admitted_credentials_for(layer) is None
                assert server._is_auth_admitted() is False
        finally:
            _ADMITTED_AUTH.reset(tok)

        # 2. Expired between HTTP 202 and pre_boundary (still in eager interleaving) MUST fail closed.
        clock.advance(120_000)  # NOW + 120 == expires_at + skew_s
        expired_handoff = _QueuedDispatch(queued=True)
        tok2 = _ADMITTED_AUTH.set(
            _AdmittedAuth(layer=layer, credentials=creds, skew_s=60, handoff=expired_handoff)
        )
        try:
            with claim_admitted_dispatch(layer):
                assert admitted_credentials_for(layer) is None
                assert server._is_auth_admitted() is False
        finally:
            _ADMITTED_AUTH.reset(tok2)

        # 3. Unqueued finished POST fails closed even if brand somehow remained.
        finished_handoff = _QueuedDispatch(queued=False, finished=True)
        tok3 = _ADMITTED_AUTH.set(
            _AdmittedAuth(layer=layer, credentials=creds, skew_s=60, handoff=finished_handoff)
        )
        try:
            with claim_admitted_dispatch(layer):
                assert admitted_credentials_for(layer) is None
                assert server._is_auth_admitted() is False
        finally:
            _ADMITTED_AUTH.reset(tok3)
    finally:
        _unbrand_verified_credentials(creds)


@pytest.mark.asyncio
async def test_run_stdio_async_scopes_trusted_transport_to_stdio_server(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server, _, _, _, _ = _make_server()
    other_server, _, _, _, _ = _make_server()
    mcp = server._create_mcp_server()
    seen_inside: dict[str, bool] = {}

    async def fake_super_run_stdio(self: Any) -> None:
        seen_inside["self_admitted"] = server._is_auth_admitted()
        seen_inside["other_admitted"] = other_server._is_auth_admitted()

    monkeypatch.setattr(type(mcp).__mro__[1], "run_stdio_async", fake_super_run_stdio)
    assert server._is_auth_admitted() is False
    await mcp.run_stdio_async()
    assert seen_inside == {"self_admitted": True, "other_admitted": False}
    assert server._is_auth_admitted() is False
