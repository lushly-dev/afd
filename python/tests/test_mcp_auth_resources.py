"""End-to-end tests for per-caller ``ResourceProvider`` under MCP authorization
(``spec/authorization.md``, M6 "Other methods"; ``spec/mcp-resources.md``, R3/R4).

Covers:
- Streamable HTTP (modern 2026-07-28 and legacy 2025-11-25), SSE (``sse_app``), host-admitted
  (``server.admit`` + ``server.pre_dispatch_check``), and stdio (``trusted_transport``).
- Per-caller filtering on ``resources/list`` and ``resources/read`` (inline ``content``,
  ``read()``-backed, and unlisted URIs), with ``-32602`` (``Resource not found``) parity
  between unreadable and absent URIs.
- ``cacheScope: "private"`` vs ``"public"`` across provider, static entries, combined
  provider + ``SkillCatalog``, skills-only, unauthenticated, and modern stdio with ``auth``.
- Backwards compatibility for legacy 0-arg ``list()`` / 1-arg ``read(uri)`` providers and
  caller-aware signature variants (optional, required, keyword-only, inline-only, ``*args``).
- Credential branding during provider invocation, unbranding on exit, immutability of
  ``ResourceCaller``, M1 fail-closed, ``required_scopes``, and ``-32603`` error redaction.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
from collections.abc import AsyncIterator, MutableMapping, Sequence
from contextlib import asynccontextmanager
from typing import Any

import pytest

pytest.importorskip("mcp")
pytest.importorskip("cryptography")

import anyio  # noqa: E402
import httpx  # noqa: E402
from mcp.shared.message import SessionMessage  # noqa: E402
from mcp_types import JSONRPCNotification, JSONRPCRequest  # noqa: E402

import afd.server as afd_server  # noqa: E402
from afd.core.clock import fixed_clock  # noqa: E402
from afd.server import (  # noqa: E402
    Credentials,
    JwtIssuer,
    JwtVerifier,
    McpAuthOptions,
    ResourceCaller,
    ResourceContents,
    ResourceEntry,
    ResourceProvider,
    Skill,
    SkillCatalog,
    create_server,
    create_token_rules,
    is_verified_credentials,
    jwks_key_source,
)
from tests.test_auth_verifier import ISSUER, JWKS, NOW, RESOURCE, _sign_jws  # noqa: E402
from tests.test_mcp_auth import MODERN, MODERN_HEADERS, MODERN_META, _raw_asgi_call  # noqa: E402

LEGACY = "2025-11-25"
METADATA_URL = "https://mcp.test.example/.well-known/oauth-protected-resource/mcp"


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


def _auth_options(*, required_scopes: Sequence[str] = ()) -> McpAuthOptions:
    return McpAuthOptions(
        resource=RESOURCE,
        authorization_servers=[ISSUER],
        verifier=_make_verifier(),
        on_refusal=lambda _r: None,
        required_scopes=required_scopes,
    )


def _token(sub: str, *, scope: str = "res:read", client_id: str = "client-1") -> str:
    return _sign_jws("RS256", claims={"sub": sub, "scope": scope, "client_id": client_id})


def _host_creds(sub: str, scopes: Sequence[str] = ("res:read",)) -> Credentials:
    return Credentials(
        issuer=ISSUER,
        subject=sub,
        client_id="host-client",
        scopes=tuple(scopes),
        resource=RESOURCE,
        expires_at=NOW + 600,
        issued_at=NOW,
    )


def _rpc(method: str, params: dict[str, Any] | None = None, req_id: int = 1) -> dict[str, Any]:
    body: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        body["params"] = params
    return body


def _modern_headers(
    method: str, *, uri: str | None = None, token: str | None = None
) -> dict[str, str]:
    headers = {**MODERN_HEADERS, "Mcp-Method": method}
    if uri is not None:
        headers["Mcp-Name"] = uri
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _sample_skills(*, directory_read: bool = False) -> SkillCatalog:
    return SkillCatalog(
        [
            Skill(
                path="hello",
                files={
                    "SKILL.md": "---\nname: hello\ndescription: Greets callers.\n---\nHello.\n",
                    "refs/note.md": "Reference note.\n",
                },
            )
        ],
        directory_read=directory_read,
    )


@asynccontextmanager
async def _http_client(server: Any, *, stateless: bool = True) -> AsyncIterator[httpx.AsyncClient]:
    app = server.streamable_http_app(stateless_http=stateless, json_response=True)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
        ) as client,
    ):
        yield client


@asynccontextmanager
async def _stream_session(server: Any) -> AsyncIterator[tuple[Any, Any]]:
    mcp_server = server._create_mcp_server()
    lowlevel = mcp_server._lowlevel_server
    c2s_send, c2s_recv = anyio.create_memory_object_stream[SessionMessage | Exception](32)
    s2c_send, s2c_recv = anyio.create_memory_object_stream[SessionMessage](32)

    async def send(
        method: str, params: dict[str, Any] | None = None, *, req_id: int = 1
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            payload["params"] = params
        await c2s_send.send(SessionMessage(JSONRPCRequest.model_validate(payload)))
        reply = await s2c_recv.receive()
        return reply.message.model_dump(by_alias=True, exclude_none=True)

    async def notify(method: str, params: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        await c2s_send.send(SessionMessage(JSONRPCNotification.model_validate(payload)))

    async with anyio.create_task_group() as tg:
        tg.start_soon(
            lowlevel.run,
            c2s_recv,
            s2c_send,
            lowlevel.create_initialization_options(),
        )
        try:
            yield send, notify
        finally:
            await c2s_send.aclose()
            await s2c_recv.aclose()
            tg.cancel_scope.cancel()


class _TenantProvider:
    """Caller-aware provider with shared, per-tenant inline, per-tenant read(), and unlisted URIs."""

    def __init__(self) -> None:
        self.list_callers: list[ResourceCaller] = []
        self.read_calls: list[tuple[str, ResourceCaller]] = []
        self.verified_during_call: list[bool] = []
        self.frozen_checked = False
        self.fail_for_subject: str | None = None
        self.fail_read_for_subject: str | None = None
        self.invalid_for_subject: str | None = None

    def _record(self, caller: ResourceCaller) -> None:
        if not self.frozen_checked:
            with pytest.raises(dataclasses.FrozenInstanceError):
                caller.credentials = None  # type: ignore[misc]
            self.frozen_checked = True
        if caller.credentials is not None:
            self.verified_during_call.append(
                is_verified_credentials(caller.credentials, NOW * 1000)
            )

    def list(self, caller: ResourceCaller) -> Sequence[ResourceEntry]:
        self.list_callers.append(caller)
        self._record(caller)
        sub = caller.credentials.subject if caller.credentials is not None else None
        if sub is not None and sub == self.fail_for_subject:
            raise RuntimeError("secret-provider-db-crash")
        if sub is not None and sub == self.invalid_for_subject:
            return [ResourceEntry(uri="not-a-uri", name="bad")]
        entries: list[ResourceEntry] = [
            ResourceEntry(
                uri="app://shared/readme",
                name="shared-readme",
                mime_type="text/plain",
                content="Shared info",
            )
        ]
        if sub == "alice":
            entries.extend(
                [
                    ResourceEntry(
                        uri="app://alice/inline",
                        name="alice-inline",
                        mime_type="text/plain",
                        content="Alice inline secret",
                    ),
                    ResourceEntry(
                        uri="app://alice/secret",
                        name="alice-secret",
                        mime_type="text/plain",
                    ),
                ]
            )
        elif sub == "bob":
            entries.extend(
                [
                    ResourceEntry(
                        uri="app://bob/inline",
                        name="bob-inline",
                        mime_type="text/plain",
                        content="Bob inline secret",
                    ),
                    ResourceEntry(
                        uri="app://bob/secret",
                        name="bob-secret",
                        mime_type="text/plain",
                    ),
                ]
            )
        return entries

    async def read(self, uri: str, caller: ResourceCaller) -> ResourceContents | None:
        self.read_calls.append((uri, caller))
        self._record(caller)
        sub = caller.credentials.subject if caller.credentials is not None else None
        if sub is not None and sub == self.fail_read_for_subject:
            raise RuntimeError("secret-read-db-crash")
        if uri == "app://alice/secret" and sub == "alice":
            return ResourceContents(content="Alice private body", mime_type="text/plain")
        if uri == "app://bob/secret" and sub == "bob":
            return ResourceContents(content="Bob private body", mime_type="text/plain")
        if uri == "app://unlisted/alice" and sub == "alice":
            return ResourceContents(content="Alice unlisted body", mime_type="text/plain")
        return None


# ── 1. Streamable HTTP modern era: per-caller filtering, -32602 parity, branding ──


@pytest.mark.asyncio
async def test_modern_http_per_caller_list_read_hidden_parity_and_branding() -> None:
    assert hasattr(afd_server, "ResourceCaller")
    assert afd_server.ResourceCaller is ResourceCaller

    provider = _TenantProvider()
    hook_calls = 0

    def hook(_req: Any, ctx: Any) -> Any:
        nonlocal hook_calls
        hook_calls += 1
        return ctx

    server = create_server(
        "res-modern",
        clock=fixed_clock(NOW * 1000),
        tools_list_ttl_ms=42_000,
        auth=_auth_options(required_scopes=["res:read"]),
        resources=provider,
        skills=_sample_skills(directory_read=True),
        context_hook=hook,
    )
    # Startup validation called provider.list with ResourceCaller(credentials=None).
    assert provider.list_callers == [ResourceCaller(credentials=None)]
    provider.list_callers.clear()

    alice = _token("alice", scope="res:read")
    bob = _token("bob", scope="res:read")
    carol = _token("carol", scope="res:read")
    no_scope = _token("alice", scope="")

    async with _http_client(server) as client:
        # Missing required_scopes -> 403 before dispatch, provider never called.
        for method, params, uri in (
            ("resources/list", {"_meta": MODERN_META}, None),
            ("resources/read", {"uri": "app://alice/secret", "_meta": MODERN_META}, "app://alice/secret"),
        ):
            res_403 = await client.post(
                "/mcp",
                json=_rpc(method, params),
                headers=_modern_headers(method, uri=uri, token=no_scope),
            )
            assert res_403.status_code == 403
            assert f'scope="res:read", resource_metadata="{METADATA_URL}"' in res_403.headers["www-authenticate"]
        assert provider.list_callers == []
        assert provider.read_calls == []

        # Alice sees shared + Alice entries + static skills; cacheScope is "private".
        alice_list = await client.post(
            "/mcp",
            json=_rpc("resources/list", {"_meta": MODERN_META}),
            headers=_modern_headers("resources/list", token=alice),
        )
        assert alice_list.status_code == 200
        alice_result = alice_list.json()["result"]
        assert alice_result["cacheScope"] == "private"
        assert alice_result["ttlMs"] == 42_000
        assert [r["uri"] for r in alice_result["resources"]] == [
            "app://shared/readme",
            "app://alice/inline",
            "app://alice/secret",
            "skill://hello/SKILL.md",
            "skill://hello/refs/note.md",
        ]

        # Bob sees shared + Bob entries + static skills; never Alice's.
        bob_list = await client.post(
            "/mcp",
            json=_rpc("resources/list", {"_meta": MODERN_META}),
            headers=_modern_headers("resources/list", token=bob),
        )
        assert bob_list.status_code == 200
        bob_result = bob_list.json()["result"]
        assert bob_result["cacheScope"] == "private"
        assert [r["uri"] for r in bob_result["resources"]] == [
            "app://shared/readme",
            "app://bob/inline",
            "app://bob/secret",
            "skill://hello/SKILL.md",
            "skill://hello/refs/note.md",
        ]

        # Carol sees only shared + skills.
        carol_list = await client.post(
            "/mcp",
            json=_rpc("resources/list", {"_meta": MODERN_META}),
            headers=_modern_headers("resources/list", token=carol),
        )
        assert [r["uri"] for r in carol_list.json()["result"]["resources"]] == [
            "app://shared/readme",
            "skill://hello/SKILL.md",
            "skill://hello/refs/note.md",
        ]
        assert carol_list.json()["result"]["cacheScope"] == "private"

        # Alice reads inline, read()-backed, and unlisted provider URIs -> cacheScope "private".
        for uri, expected_text in (
            ("app://alice/inline", "Alice inline secret"),
            ("app://alice/secret", "Alice private body"),
            ("app://unlisted/alice", "Alice unlisted body"),
            ("app://shared/readme", "Shared info"),
        ):
            r = await client.post(
                "/mcp",
                json=_rpc("resources/read", {"uri": uri, "_meta": MODERN_META}),
                headers=_modern_headers("resources/read", uri=uri, token=alice),
            )
            assert r.status_code == 200
            body = r.json()["result"]
            assert body["cacheScope"] == "private"
            assert body["ttlMs"] == 42_000
            assert body["contents"] == [{"uri": uri, "mimeType": "text/plain", "text": expected_text}]

        # Bob reading Alice's inline, read()-backed, or unlisted URI gets -32602 identical to absent URI.
        absent = await client.post(
            "/mcp",
            json=_rpc("resources/read", {"uri": "app://does-not-exist", "_meta": MODERN_META}),
            headers=_modern_headers("resources/read", uri="app://does-not-exist", token=bob),
        )
        absent_err = absent.json()["error"]
        assert absent_err == {
            "code": -32602,
            "message": "Resource not found",
            "data": {"uri": "app://does-not-exist"},
        }
        for hidden_uri in ("app://alice/inline", "app://alice/secret", "app://unlisted/alice"):
            hidden = await client.post(
                "/mcp",
                json=_rpc("resources/read", {"uri": hidden_uri, "_meta": MODERN_META}),
                headers=_modern_headers("resources/read", uri=hidden_uri, token=bob),
            )
            assert hidden.status_code == absent.status_code
            assert hidden.json()["error"] == {
                **absent_err,
                "data": {"uri": hidden_uri},
            }

        # Static SkillCatalog read stays cacheScope "public" and never invokes the provider.
        prev_list_count = len(provider.list_callers)
        prev_read_count = len(provider.read_calls)
        skill_read = await client.post(
            "/mcp",
            json=_rpc("resources/read", {"uri": "skill://hello/SKILL.md", "_meta": MODERN_META}),
            headers=_modern_headers("resources/read", uri="skill://hello/SKILL.md", token=alice),
        )
        assert skill_read.status_code == 200
        assert skill_read.json()["result"]["cacheScope"] == "public"
        assert skill_read.json()["result"]["ttlMs"] == 42_000
        assert "name: hello" in skill_read.json()["result"]["contents"][0]["text"]

        # Missing skill:// URI answers -32602 without calling provider.
        missing_skill = await client.post(
            "/mcp",
            json=_rpc("resources/read", {"uri": "skill://nope/SKILL.md", "_meta": MODERN_META}),
            headers=_modern_headers("resources/read", uri="skill://nope/SKILL.md", token=alice),
        )
        assert missing_skill.json()["error"] == {
            "code": -32602,
            "message": "Resource not found",
            "data": {"uri": "skill://nope/SKILL.md"},
        }
        assert len(provider.list_callers) == prev_list_count
        assert len(provider.read_calls) == prev_read_count

        # Templates list, skills/list, skills/get, and resources/directory/read stay "public".
        for method, params in (
            ("resources/templates/list", {"_meta": MODERN_META}),
            ("skills/list", {"_meta": MODERN_META}),
            ("skills/get", {"uri": "skill://hello/SKILL.md", "_meta": MODERN_META}),
            ("resources/directory/read", {"uri": "skill://hello", "_meta": MODERN_META}),
        ):
            resp = await client.post(
                "/mcp",
                json=_rpc(method, params),
                headers=_modern_headers(method, token=alice),
            )
            assert resp.status_code == 200
            assert resp.json()["result"]["cacheScope"] == "public"
            assert resp.json()["result"]["ttlMs"] == 42_000

    # Credentials were branded during every provider call and unbranded once requests ended.
    assert provider.verified_during_call
    assert all(provider.verified_during_call)
    captured = [
        c.credentials
        for c in (*provider.list_callers, *(caller for _, caller in provider.read_calls))
        if c.credentials is not None
    ]
    assert captured
    assert all(is_verified_credentials(creds, NOW * 1000) is False for creds in captured)
    # context_hook never runs for resources/* or skills/*.
    assert hook_calls == 0


# ── 2. Streamable HTTP legacy 2025-11-25 era ──────────────────────────────────


@pytest.mark.asyncio
async def test_legacy_http_per_caller_filtering_omits_cache_hints() -> None:
    provider = _TenantProvider()
    server = create_server(
        "res-legacy",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(),
        resources=provider,
    )
    alice = _token("alice")
    bob = _token("bob")

    async def open_legacy_session(client: httpx.AsyncClient, token: str) -> str:
        base_headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        }
        init = await client.post(
            "/mcp",
            headers=base_headers,
            json=_rpc(
                "initialize",
                {
                    "protocolVersion": LEGACY,
                    "capabilities": {},
                    "clientInfo": {"name": "legacy-res", "version": "0"},
                },
            ),
        )
        assert init.status_code == 200
        sid = init.headers["mcp-session-id"]
        notif = await client.post(
            "/mcp",
            headers={**base_headers, "Mcp-Session-Id": sid, "MCP-Protocol-Version": LEGACY},
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        )
        assert notif.status_code in (200, 202)
        return sid

    async def legacy_req(
        client: httpx.AsyncClient, token: str, sid: str, method: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        resp = await client.post(
            "/mcp",
            headers={
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                "Mcp-Session-Id": sid,
                "MCP-Protocol-Version": LEGACY,
            },
            json=_rpc(method, params, req_id=2),
        )
        assert resp.status_code == 200
        data: dict[str, Any] = resp.json()
        return data

    async with _http_client(server, stateless=False) as client:
        alice_sid = await open_legacy_session(client, alice)
        bob_sid = await open_legacy_session(client, bob)

        alice_list = await legacy_req(client, alice, alice_sid, "resources/list")
        assert [r["uri"] for r in alice_list["result"]["resources"]] == [
            "app://shared/readme",
            "app://alice/inline",
            "app://alice/secret",
        ]
        assert "cacheScope" not in alice_list["result"]
        assert "ttlMs" not in alice_list["result"]

        bob_list = await legacy_req(client, bob, bob_sid, "resources/list")
        assert [r["uri"] for r in bob_list["result"]["resources"]] == [
            "app://shared/readme",
            "app://bob/inline",
            "app://bob/secret",
        ]
        assert "cacheScope" not in bob_list["result"]

        alice_read = await legacy_req(
            client, alice, alice_sid, "resources/read", {"uri": "app://alice/secret"}
        )
        assert alice_read["result"]["contents"][0]["text"] == "Alice private body"
        assert "cacheScope" not in alice_read["result"]
        assert "ttlMs" not in alice_read["result"]

        bob_hidden = await legacy_req(
            client, bob, bob_sid, "resources/read", {"uri": "app://alice/secret"}
        )
        bob_absent = await legacy_req(
            client, bob, bob_sid, "resources/read", {"uri": "app://missing"}
        )
        assert bob_hidden["error"] == {
            "code": -32602,
            "message": "Resource not found",
            "data": {"uri": "app://alice/secret"},
        }
        assert bob_absent["error"] == {
            "code": -32602,
            "message": "Resource not found",
            "data": {"uri": "app://missing"},
        }


# ── 3. SSE transport (sse_app + queued POST /messages/ handoff) ───────────────


@pytest.mark.asyncio
async def test_sse_transport_forwards_verified_credentials_to_resource_provider() -> None:
    provider = _TenantProvider()
    server = create_server(
        "res-sse",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(required_scopes=["res:read"]),
        resources=provider,
    )
    provider.list_callers.clear()
    app = server.sse_app()
    alice = _token("alice", scope="res:read")

    sse_events: asyncio.Queue[bytes] = asyncio.Queue()
    disconnect = asyncio.Event()

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

    async def post_sse(msg_path: str, msg_query: str, token: str, payload: dict[str, Any]) -> int:
        status, _, _ = await _raw_asgi_call(
            app,
            method="POST",
            path=msg_path,
            query=msg_query.encode("ascii"),
            headers=[
                (b"content-type", b"application/json"),
                (b"authorization", f"Bearer {token}".encode("ascii")),
            ],
            body=json.dumps(payload).encode("utf-8"),
        )
        return status

    sse_task = asyncio.create_task(app(sse_scope, sse_receive, sse_send))
    try:
        endpoint = await next_sse_data("endpoint")
        msg_path, msg_query = endpoint.split("?", 1)

        assert (
            await post_sse(
                msg_path,
                msg_query,
                alice,
                _rpc(
                    "initialize",
                    {
                        "protocolVersion": LEGACY,
                        "capabilities": {},
                        "clientInfo": {"name": "sse-res", "version": "0"},
                    },
                    req_id=1,
                ),
            )
            == 202
        )
        assert json.loads(await next_sse_data("message"))["id"] == 1

        # resources/list over SSE returns Alice's entries with verified credentials.
        assert await post_sse(msg_path, msg_query, alice, _rpc("resources/list", req_id=2)) == 202
        list_msg = json.loads(await next_sse_data("message"))
        assert list_msg["id"] == 2
        assert [r["uri"] for r in list_msg["result"]["resources"]] == [
            "app://shared/readme",
            "app://alice/inline",
            "app://alice/secret",
        ]

        # resources/read for Alice's secret succeeds; Bob's secret answers -32602.
        assert (
            await post_sse(
                msg_path,
                msg_query,
                alice,
                _rpc("resources/read", {"uri": "app://alice/secret"}, req_id=3),
            )
            == 202
        )
        read_ok = json.loads(await next_sse_data("message"))
        assert read_ok["result"]["contents"][0]["text"] == "Alice private body"

        assert (
            await post_sse(
                msg_path,
                msg_query,
                alice,
                _rpc("resources/read", {"uri": "app://bob/secret"}, req_id=4),
            )
            == 202
        )
        read_hidden = json.loads(await next_sse_data("message"))
        assert read_hidden["error"] == {
            "code": -32602,
            "message": "Resource not found",
            "data": {"uri": "app://bob/secret"},
        }

        # POST /messages/ with missing required_scopes fails closed with INSUFFICIENT_SCOPE.
        alice_no_scope = _token("alice", scope="")
        prev_lists = len(provider.list_callers)
        assert (
            await post_sse(msg_path, msg_query, alice_no_scope, _rpc("resources/list", req_id=5))
            == 202
        )
        err_msg = json.loads(await next_sse_data("message"))
        assert err_msg["error"]["code"] == -32600
        assert err_msg["error"]["data"]["code"] == "INSUFFICIENT_SCOPE"
        assert len(provider.list_callers) == prev_lists

        # Wait a tick for finally blocks; all captured credentials must now be unbranded.
        await asyncio.sleep(0.01)
        assert provider.verified_during_call and all(provider.verified_during_call)
        captured = [
            c.credentials
            for c in (*provider.list_callers, *(caller for _, caller in provider.read_calls))
            if c.credentials is not None
        ]
        assert captured
        assert all(is_verified_credentials(creds, NOW * 1000) is False for creds in captured)
    finally:
        disconnect.set()
        await asyncio.wait_for(sse_task, timeout=5.0)


# ── 4. Host-admitted requests (server.admit + server.pre_dispatch_check) ──────


@pytest.mark.asyncio
async def test_host_admit_and_pre_dispatch_check_forward_credentials_to_provider() -> None:
    provider = _TenantProvider()
    server = create_server(
        "res-host",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(required_scopes=["res:read"]),
        resources=provider,
        skills=_sample_skills(),
    )
    provider.list_callers.clear()
    raw_app = server.streamable_http_app(stateless_http=True, json_response=True)
    check = server.pre_dispatch_check()
    run_pre_dispatch = True
    current_creds: dict[str, Credentials] = {"creds": _host_creds("alice")}

    async def host_app(scope: MutableMapping[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await raw_app(scope, receive, send)
            return
        chunks: list[bytes] = []
        while True:
            msg = await receive()
            chunks.append(msg.get("body", b""))
            if not msg.get("more_body", False):
                break
        raw_body = b"".join(chunks)

        replayed = False

        async def replay_receive() -> dict[str, Any]:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": raw_body, "more_body": False}
            return {"type": "http.disconnect"}

        with server.admit(scope, current_creds["creds"]):
            if run_pre_dispatch:
                dec = check.decide(scope, raw_body.decode("utf-8"))
                if not dec.proceed:
                    await send(
                        {
                            "type": "http.response.start",
                            "status": dec.status,
                            "headers": [
                                (k.lower().encode("latin-1"), v.encode("latin-1"))
                                for k, v in dec.headers.items()
                            ],
                        }
                    )
                    await send({"type": "http.response.body", "body": dec.body.encode("utf-8")})
                    return
            await raw_app(scope, replay_receive, send)

    async with raw_app.router.lifespan_context(raw_app):
        transport = httpx.ASGITransport(app=host_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
            # Alice admitted by host -> sees Alice's entries, cacheScope "private".
            current_creds["creds"] = _host_creds("alice")
            r_list = await client.post(
                "/mcp",
                json=_rpc("resources/list", {"_meta": MODERN_META}),
                headers=_modern_headers("resources/list"),
            )
            assert r_list.status_code == 200
            assert r_list.json()["result"]["cacheScope"] == "private"
            assert [r["uri"] for r in r_list.json()["result"]["resources"]] == [
                "app://shared/readme",
                "app://alice/inline",
                "app://alice/secret",
                "skill://hello/SKILL.md",
                "skill://hello/refs/note.md",
            ]

            # Bob cannot read Alice's secret; gets -32602 identical to absent.
            current_creds["creds"] = _host_creds("bob")
            r_hidden = await client.post(
                "/mcp",
                json=_rpc("resources/read", {"uri": "app://alice/secret", "_meta": MODERN_META}),
                headers=_modern_headers("resources/read", uri="app://alice/secret"),
            )
            assert r_hidden.json()["error"] == {
                "code": -32602,
                "message": "Resource not found",
                "data": {"uri": "app://alice/secret"},
            }

            # Skill read stays "public".
            r_skill = await client.post(
                "/mcp",
                json=_rpc("resources/read", {"uri": "skill://hello/SKILL.md", "_meta": MODERN_META}),
                headers=_modern_headers("resources/read", uri="skill://hello/SKILL.md"),
            )
            assert r_skill.json()["result"]["cacheScope"] == "public"

            # Missing required_scopes -> 403 via pre_dispatch_check; provider not called.
            prev_lists = len(provider.list_callers)
            current_creds["creds"] = _host_creds("alice", scopes=())
            r_403 = await client.post(
                "/mcp",
                json=_rpc("resources/list", {"_meta": MODERN_META}),
                headers=_modern_headers("resources/list"),
            )
            assert r_403.status_code == 403

            # Even if host omits pre_dispatch_check, post-routing pre_boundary refuses INSUFFICIENT_SCOPE.
            run_pre_dispatch = False
            r_rpc_err = await client.post(
                "/mcp",
                json=_rpc("resources/list", {"_meta": MODERN_META}),
                headers=_modern_headers("resources/list"),
            )
            assert r_rpc_err.status_code == 400
            assert r_rpc_err.json()["error"]["code"] == -32600
            assert r_rpc_err.json()["error"]["data"]["code"] == "INSUFFICIENT_SCOPE"
            assert len(provider.list_callers) == prev_lists

    assert provider.verified_during_call and all(provider.verified_during_call)
    captured = [
        c.credentials
        for c in (*provider.list_callers, *(caller for _, caller in provider.read_calls))
        if c.credentials is not None
    ]
    assert all(is_verified_credentials(creds, NOW * 1000) is False for creds in captured)


# ── 5. cacheScope matrix: static entries, skills-only, unauthenticated, stdio ──


@pytest.mark.asyncio
async def test_cache_scope_matrix_static_skills_only_unauthenticated_and_stdio() -> None:
    alice = _token("alice")

    # (a) Authorized + static Sequence[ResourceEntry] fails safe to cacheScope: "private".
    static_srv = create_server(
        "res-static-auth",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(),
        resources=[ResourceEntry(uri="app://static/doc", name="doc", content="static body")],
    )
    async with _http_client(static_srv) as client:
        sl = await client.post(
            "/mcp",
            json=_rpc("resources/list", {"_meta": MODERN_META}),
            headers=_modern_headers("resources/list", token=alice),
        )
        assert sl.json()["result"]["cacheScope"] == "private"
        sr = await client.post(
            "/mcp",
            json=_rpc("resources/read", {"uri": "app://static/doc", "_meta": MODERN_META}),
            headers=_modern_headers("resources/read", uri="app://static/doc", token=alice),
        )
        assert sr.json()["result"]["cacheScope"] == "private"
        st = await client.post(
            "/mcp",
            json=_rpc("resources/templates/list", {"_meta": MODERN_META}),
            headers=_modern_headers("resources/templates/list", token=alice),
        )
        assert st.json()["result"]["cacheScope"] == "public"

    # (b) Authorized + skills-only server keeps cacheScope: "public" everywhere.
    skills_only_srv = create_server(
        "res-skills-only",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(),
        skills=_sample_skills(directory_read=True),
    )
    async with _http_client(skills_only_srv) as client:
        for method, params, uri in (
            ("resources/list", {"_meta": MODERN_META}, None),
            ("resources/read", {"uri": "skill://hello/SKILL.md", "_meta": MODERN_META}, "skill://hello/SKILL.md"),
            ("resources/templates/list", {"_meta": MODERN_META}, None),
            ("skills/list", {"_meta": MODERN_META}, None),
            ("skills/get", {"uri": "skill://hello/SKILL.md", "_meta": MODERN_META}, None),
            ("resources/directory/read", {"uri": "skill://hello", "_meta": MODERN_META}, None),
        ):
            r = await client.post(
                "/mcp",
                json=_rpc(method, params),
                headers=_modern_headers(method, uri=uri, token=alice),
            )
            assert r.status_code == 200
            assert r.json()["result"]["cacheScope"] == "public"

    # (c) Unauthenticated + provider keeps cacheScope: "public" and passes credentials=None.
    unauth_provider = _TenantProvider()
    unauth_srv = create_server("res-unauth", resources=unauth_provider)
    unauth_provider.list_callers.clear()
    async with _http_client(unauth_srv) as client:
        ul = await client.post(
            "/mcp",
            json=_rpc("resources/list", {"_meta": MODERN_META}),
            headers=_modern_headers("resources/list"),
        )
        assert ul.json()["result"]["cacheScope"] == "public"
        assert unauth_provider.list_callers == [ResourceCaller(credentials=None)]
        ur = await client.post(
            "/mcp",
            json=_rpc("resources/read", {"uri": "app://shared/readme", "_meta": MODERN_META}),
            headers=_modern_headers("resources/read", uri="app://shared/readme"),
        )
        assert ur.json()["result"]["cacheScope"] == "public"

    # (d) Authorized + provider + skills on stdio (trusted_transport) vs unadmitted stream.
    stdio_provider = _TenantProvider()
    stdio_srv = create_server(
        "res-stdio-auth",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(required_scopes=["res:read"]),
        resources=stdio_provider,
        skills=_sample_skills(),
    )
    stdio_provider.list_callers.clear()

    # Unadmitted stream fails closed with UNAUTHORIZED before provider runs.
    async with _stream_session(stdio_srv) as (send, _):
        unauth_resp = await send("resources/list", {"_meta": MODERN_META}, req_id=1)
        assert unauth_resp["error"]["code"] == -32600
        assert unauth_resp["error"]["data"]["code"] == "UNAUTHORIZED"
    assert stdio_provider.list_callers == []

    # Modern stdio (trusted_transport): succeeds with credentials=None, provider responses "private", skill read "public".
    with stdio_srv.trusted_transport():
        async with _stream_session(stdio_srv) as (send, _):
            ml = await send("resources/list", {"_meta": MODERN_META}, req_id=1)
            assert ml["result"]["cacheScope"] == "private"
            assert stdio_provider.list_callers == [ResourceCaller(credentials=None)]
            mr_prov = await send(
                "resources/read", {"uri": "app://shared/readme", "_meta": MODERN_META}, req_id=2
            )
            assert mr_prov["result"]["cacheScope"] == "private"
            mr_skill = await send(
                "resources/read", {"uri": "skill://hello/SKILL.md", "_meta": MODERN_META}, req_id=3
            )
            assert mr_skill["result"]["cacheScope"] == "public"
            mt = await send("resources/templates/list", {"_meta": MODERN_META}, req_id=4)
            assert mt["result"]["cacheScope"] == "public"

        # Legacy stdio (trusted_transport): succeeds with credentials=None and omits cache hints.
        async with _stream_session(stdio_srv) as (send, notify):
            await send(
                "initialize",
                {
                    "protocolVersion": LEGACY,
                    "capabilities": {},
                    "clientInfo": {"name": "stdio-legacy", "version": "0"},
                },
                req_id=1,
            )
            await notify("notifications/initialized")
            ll = await send("resources/list", req_id=2)
            assert "cacheScope" not in ll["result"]
            assert "ttlMs" not in ll["result"]
            lr = await send("resources/read", {"uri": "app://shared/readme"}, req_id=3)
            assert "cacheScope" not in lr["result"]
            assert lr["result"]["contents"][0]["text"] == "Shared info"


# ── 6. Backwards compatibility & provider signature variants ──────────────────


@pytest.mark.asyncio
async def test_legacy_and_variant_provider_signatures() -> None:
    alice = _token("alice")

    # (a) Legacy 0-arg list() + 1-arg sync read(uri) still works with zero changes.
    class _LegacyProvider:
        def list(self) -> Sequence[ResourceEntry]:
            return [ResourceEntry(uri="app://legacy/item", name="legacy", mime_type="text/plain")]

        def read(self, uri: str) -> ResourceContents | None:
            if uri == "app://legacy/item":
                return ResourceContents(content="legacy-ok", mime_type="text/plain")
            return None

    # (b) Optional caller parameter with default.
    class _OptionalCallerProvider:
        def list(self, caller: ResourceCaller | None = None) -> Sequence[ResourceEntry]:
            sub = caller.credentials.subject if caller and caller.credentials else "anon"
            return [ResourceEntry(uri=f"app://opt/{sub}", name="opt", mime_type="text/plain")]

        def read(self, uri: str, caller: ResourceCaller | None = None) -> ResourceContents | None:
            sub = caller.credentials.subject if caller and caller.credentials else "anon"
            if uri == f"app://opt/{sub}":
                return ResourceContents(content=f"opt:{sub}", mime_type="text/plain")
            return None

    # (c) Required keyword-only caller parameter (also verified against ResourceProvider type).
    class _RequiredKwOnlyProvider:
        def list(self, *, caller: ResourceCaller) -> Sequence[ResourceEntry]:
            sub = caller.credentials.subject if caller.credentials else "anon"
            return [ResourceEntry(uri=f"app://rkw/{sub}", name="rkw", mime_type="text/plain")]

        async def read(self, uri: str, *, caller: ResourceCaller) -> ResourceContents | None:
            sub = caller.credentials.subject if caller.credentials else "anon"
            if uri == f"app://rkw/{sub}":
                return ResourceContents(content=f"rkw:{sub}", mime_type="text/plain")
            return None

    # (d) Optional keyword-only caller parameter combined with *args and unrelated defaults.
    class _VarArgsWithNamedCallerProvider:
        def list(self, *args: Any, caller: ResourceCaller) -> Sequence[ResourceEntry]:
            assert args == ()
            sub = caller.credentials.subject if caller.credentials else "anon"
            return [ResourceEntry(uri=f"app://vakw/{sub}", name="vakw", mime_type="text/plain")]

        def read(
            self, uri: str, *args: Any, caller: ResourceCaller | None = None
        ) -> ResourceContents | None:
            assert args == ()
            sub = caller.credentials.subject if caller and caller.credentials else "anon"
            if uri == f"app://vakw/{sub}":
                return ResourceContents(content=f"vakw:{sub}", mime_type="text/plain")
            return None

    # (e) Legacy provider with unrelated defaulted positional args: defaults MUST be preserved!
    class _LegacyDefaultedArgsProvider:
        def list(self, limit: int = 1) -> Sequence[ResourceEntry]:
            entries = [
                ResourceEntry(uri="app://def/first", name="first", mime_type="text/plain"),
                ResourceEntry(uri="app://def/second", name="second", mime_type="text/plain"),
            ]
            return entries[:limit]

        def read(self, uri: str, encoding: str = "utf-8") -> ResourceContents | None:
            if uri == "app://def/first":
                return ResourceContents(content=f"def:{encoding}", mime_type="text/plain")
            return None

    # (f) Defaulted unrelated positional arg alongside keyword-only caller.
    class _DefaultedPlusKwCallerProvider:
        def list(
            self, limit: int = 1, *, caller: ResourceCaller | None = None
        ) -> Sequence[ResourceEntry]:
            sub = caller.credentials.subject if caller and caller.credentials else "anon"
            entries = [
                ResourceEntry(uri=f"app://dkw/{sub}", name="dkw", mime_type="text/plain"),
                ResourceEntry(uri="app://dkw/extra", name="extra", mime_type="text/plain"),
            ]
            return entries[:limit]

        def read(
            self, uri: str, encoding: str = "utf-8", *, caller: ResourceCaller | None = None
        ) -> ResourceContents | None:
            sub = caller.credentials.subject if caller and caller.credentials else "anon"
            if uri == f"app://dkw/{sub}":
                return ResourceContents(content=f"dkw:{encoding}:{sub}", mime_type="text/plain")
            return None

    # (g) Renamed positional parameter typed with ResourceCaller (both required and optional).
    class _RenamedCallerProvider:
        def list(self, ctx: ResourceCaller | None = None) -> Sequence[ResourceEntry]:
            sub = ctx.credentials.subject if ctx and ctx.credentials else "anon"
            return [ResourceEntry(uri=f"app://ren/{sub}", name="ren", mime_type="text/plain")]

        def read(self, uri: str, _ctx: ResourceCaller) -> ResourceContents | None:
            sub = _ctx.credentials.subject if _ctx.credentials else "anon"
            if uri == f"app://ren/{sub}":
                return ResourceContents(content=f"ren:{sub}", mime_type="text/plain")
            return None

    # (h) Inline-only caller-aware provider (no read() method).
    class _InlineOnlyProvider:
        def list(self, caller: ResourceCaller) -> Sequence[ResourceEntry]:
            if caller.credentials is None:
                return []
            return [
                ResourceEntry(
                    uri=f"app://inline/{caller.credentials.subject}",
                    name="inline",
                    mime_type="text/plain",
                    content=f"inline:{caller.credentials.subject}",
                )
            ]

    # (i) Variadic *args and **kwargs providers.
    class _VarArgsProvider:
        def list(self, *args: Any) -> Sequence[ResourceEntry]:
            caller = args[0] if args else None
            sub = caller.credentials.subject if caller and caller.credentials else "anon"
            return [ResourceEntry(uri=f"app://var/{sub}", name="var", content=f"var:{sub}")]

    class _KwArgsProvider:
        def list(self, **kwargs: Any) -> Sequence[ResourceEntry]:
            caller = kwargs.get("caller")
            sub = caller.credentials.subject if caller and caller.credentials else "anon"
            return [ResourceEntry(uri=f"app://kwarg/{sub}", name="kwarg", content=f"kwarg:{sub}")]

    # Static + runtime check: every supported provider variant satisfies ResourceProvider.
    variants: list[tuple[ResourceProvider, str, str]] = [
        (_LegacyProvider(), "app://legacy/item", "legacy-ok"),
        (_OptionalCallerProvider(), "app://opt/alice", "opt:alice"),
        (_RequiredKwOnlyProvider(), "app://rkw/alice", "rkw:alice"),
        (_VarArgsWithNamedCallerProvider(), "app://vakw/alice", "vakw:alice"),
        (_LegacyDefaultedArgsProvider(), "app://def/first", "def:utf-8"),
        (_DefaultedPlusKwCallerProvider(), "app://dkw/alice", "dkw:utf-8:alice"),
        (_RenamedCallerProvider(), "app://ren/alice", "ren:alice"),
        (_InlineOnlyProvider(), "app://inline/alice", "inline:alice"),
        (_VarArgsProvider(), "app://var/alice", "var:alice"),
        (_KwArgsProvider(), "app://kwarg/alice", "kwarg:alice"),
    ]
    for prov, expected_uri, expected_text in variants:
        assert isinstance(prov, ResourceProvider)
        srv = create_server(
            "variant-test",
            clock=fixed_clock(NOW * 1000),
            auth=_auth_options(),
            resources=prov,
        )
        async with _http_client(srv) as client:
            listed = await client.post(
                "/mcp",
                json=_rpc("resources/list", {"_meta": MODERN_META}),
                headers=_modern_headers("resources/list", token=alice),
            )
            assert [r["uri"] for r in listed.json()["result"]["resources"]] == [expected_uri]
            assert listed.json()["result"]["cacheScope"] == "private"

            read = await client.post(
                "/mcp",
                json=_rpc("resources/read", {"uri": expected_uri, "_meta": MODERN_META}),
                headers=_modern_headers("resources/read", uri=expected_uri, token=alice),
            )
            assert read.json()["result"]["contents"][0]["text"] == expected_text
            assert read.json()["result"]["cacheScope"] == "private"


# ── 7. Dynamic invalid entries and exceptions -> -32603 redaction ─────────────


@pytest.mark.asyncio
async def test_per_caller_provider_errors_and_invalid_entries_redacted_unless_dev_mode() -> None:
    alice = _token("alice")
    bob = _token("bob")

    for dev_mode in (False, True):
        provider = _TenantProvider()
        srv = create_server(
            f"err-dev-{dev_mode}",
            clock=fixed_clock(NOW * 1000),
            auth=_auth_options(),
            resources=provider,
            dev_mode=dev_mode,
        )
        async with _http_client(srv) as client:
            # Invalid entry returned only for Alice -> -32603 for Alice, Bob unaffected.
            provider.invalid_for_subject = "alice"
            bad_list = await client.post(
                "/mcp",
                json=_rpc("resources/list", {"_meta": MODERN_META}),
                headers=_modern_headers("resources/list", token=alice),
            )
            assert bad_list.json()["error"]["code"] == -32603
            if dev_mode:
                assert "not-a-uri" in bad_list.json()["error"]["message"]
            else:
                assert bad_list.json()["error"]["message"] == "Internal error"

            bob_ok = await client.post(
                "/mcp",
                json=_rpc("resources/list", {"_meta": MODERN_META}),
                headers=_modern_headers("resources/list", token=bob),
            )
            assert "result" in bob_ok.json()
            provider.invalid_for_subject = None

            # Exception thrown in provider.list -> -32603 redacted when dev_mode=False.
            provider.fail_for_subject = "alice"
            crash_list = await client.post(
                "/mcp",
                json=_rpc("resources/list", {"_meta": MODERN_META}),
                headers=_modern_headers("resources/list", token=alice),
            )
            assert crash_list.json()["error"]["code"] == -32603
            if dev_mode:
                assert "secret-provider-db-crash" in crash_list.json()["error"]["message"]
            else:
                assert crash_list.json()["error"]["message"] == "Internal error"
                assert "secret-provider-db-crash" not in crash_list.text
            provider.fail_for_subject = None

            # Exception thrown in provider.read (non-inline URI) -> -32603 redacted when dev_mode=False.
            provider.fail_read_for_subject = "alice"
            crash_read = await client.post(
                "/mcp",
                json=_rpc("resources/read", {"uri": "app://alice/secret", "_meta": MODERN_META}),
                headers=_modern_headers("resources/read", uri="app://alice/secret", token=alice),
            )
            assert crash_read.json()["error"]["code"] == -32603
            if dev_mode:
                assert "secret-read-db-crash" in crash_read.json()["error"]["message"]
            else:
                assert crash_read.json()["error"]["message"] == "Internal error"
                assert "secret-read-db-crash" not in crash_read.text
            provider.fail_read_for_subject = None
