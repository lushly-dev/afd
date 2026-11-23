"""End-to-end MCP authorization M6 scope enforcement tests (``spec/authorization.md``, M6):
command ``scopes`` metadata, pre-dispatch 403 & JSON-RPC batch 400 refusal, post-routing
``INSUFFICIENT_SCOPE`` before confirmations, ``ScopeResolver`` two-phase checks (defaults,
pipeline references, nested calls), filtered listings with ``cacheScope: "private"``,
byte-identical hidden commands across every strategy/route, host ``admit`` +
``pre_dispatch_check``, and ``tasks/*`` scope checks.
"""

from __future__ import annotations

import asyncio
import json
import re
from contextlib import asynccontextmanager
from typing import Any

import pytest

pytest.importorskip("mcp")
pytest.importorskip("cryptography")

import httpx  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import afd  # noqa: E402
import afd.server as afd_server  # noqa: E402
from afd import ExposeOptions, success  # noqa: E402
from afd.core.clock import fixed_clock  # noqa: E402
from afd.core.commands import CommandContext, CommandDefinition  # noqa: E402
from afd.server import (  # noqa: E402
    Credentials,
    JwtIssuer,
    JwtVerifier,
    McpAuthOptions,
    ScopeChallenge,
    ScopeDecision,
    ScopeMissing,
    create_server,
    create_token_rules,
    define_command,
    is_verified_credentials,
    jwks_key_source,
)
from tests.test_auth_verifier import ISSUER, JWKS, NOW, RESOURCE, _sign_jws  # noqa: E402
from tests.test_mcp_auth import MODERN, MODERN_HEADERS, MODERN_META, _raw_asgi_call  # noqa: E402

MCP = ExposeOptions(mcp=True)
METADATA_URL = "https://mcp.test.example/.well-known/oauth-protected-resource/mcp"
TASK_META = {
    "io.modelcontextprotocol/protocolVersion": MODERN,
    "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {"io.modelcontextprotocol/tasks": {}}
    },
    "io.modelcontextprotocol/clientInfo": {"name": "scope-test", "version": "0"},
}


class TodoInput(BaseModel):
    list: str = Field(default="inbox")
    title: str | None = None


class ArchiveInput(BaseModel):
    list: str = Field(default="archive")


class EmptyInput(BaseModel):
    pass


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


def _auth_options(
    *,
    required_scopes: list[str] | None = None,
    resolver: Any = None,
    filter_tools_by_scope: bool = False,
) -> McpAuthOptions:
    return McpAuthOptions(
        resource=RESOURCE,
        authorization_servers=[ISSUER],
        verifier=_make_verifier(),
        on_refusal=lambda _r: None,
        required_scopes=required_scopes or (),
        resolver=resolver,
        filter_tools_by_scope=filter_tools_by_scope,
    )


def _token(scope: str, *, sub: str = "user-1", client_id: str = "agent-1") -> str:
    return _sign_jws("RS256", claims={"scope": scope, "sub": sub, "client_id": client_id})


def _rpc(method: str, params: dict[str, Any] | None = None, req_id: int = 1) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}


def _headers(method: str, name: str | None, token: str | None = None) -> dict[str, str]:
    headers = {**MODERN_HEADERS, "Mcp-Method": method}
    if name is not None:
        headers["Mcp-Name"] = name
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _expect_forbidden(res: httpx.Response, missing: str) -> None:
    assert res.status_code == 403
    expected_header = (
        f'Bearer error="insufficient_scope", scope="{missing}", resource_metadata="{METADATA_URL}"'
        if missing
        else f'Bearer error="insufficient_scope", resource_metadata="{METADATA_URL}"'
    )
    assert res.headers["www-authenticate"] == expected_header
    assert res.headers["content-type"].startswith("application/json")
    expected_suggestion = (
        f"Obtain a token for {RESOURCE} that also grants {missing}, then retry."
        if missing
        else f"Obtain a token for {RESOURCE} that grants the scopes this call needs, then retry."
    )
    assert res.json() == {"error": "INSUFFICIENT_SCOPE", "suggestion": expected_suggestion}


def _tool_payload(res: httpx.Response) -> dict[str, Any]:
    body = res.json()
    return json.loads(body["result"]["content"][0]["text"])


class _TableResolver:
    def __init__(
        self,
        *,
        hide: set[str] | None = None,
        known_override: set[str] | None = None,
        defer: set[str] | None = None,
        asked: list[str] | None = None,
        visible_calls: list[str] | None = None,
        known_calls: list[str] | None = None,
        seen_credentials: list[Credentials] | None = None,
    ) -> None:
        self._hide = hide or set()
        self._known_override = known_override
        self._defer = defer or set()
        self._asked = asked
        self._visible_calls = visible_calls
        self._known_calls = known_calls
        self._seen_credentials = seen_credentials
        self._needs = {
            "todo-list": "todo:read",
            "todo-create": "todo:write",
            "todo-export": "todo:export",
            "todo-purge": "todo:admin",
            "secret-run": "secret:run",
            "report-build": "report:run",
        }

    def resolve(self, command: str, input: Any, credentials: Credentials) -> ScopeDecision:
        if self._asked is not None:
            self._asked.append(command)
        if self._seen_credentials is not None:
            self._seen_credentials.append(credentials)
        if command in self._defer:
            return "defer"
        list_name = input.get("list") if isinstance(input, dict) else None
        need = "todo:archive" if list_name == "archive" else self._needs.get(command)
        if need and need not in credentials.scopes:
            return ScopeMissing((need,))
        return "allowed"

    def visible(self, command: str, _credentials: Credentials) -> bool:
        if self._visible_calls is not None:
            self._visible_calls.append(command)
        return command not in self._hide

    def known(self, command: str, _credentials: Credentials) -> bool:
        if self._known_calls is not None:
            self._known_calls.append(command)
        if self._known_override is not None:
            return command in self._known_override
        return command not in self._hide


def _build_todo_server(
    *,
    tool_strategy: str = "individual",
    bootstrap: bool = False,
    first_class_tools: list[str] | None = None,
    confirmations: str = "off",
    required_scopes: list[str] | None = None,
    resolver: Any = None,
    filter_tools_by_scope: bool = False,
    include_hidden: bool = True,
    with_task: bool = False,
    ran: list[str] | None = None,
):
    executed = ran if ran is not None else []
    server = create_server(
        "scopes-test",
        tool_strategy=tool_strategy,  # type: ignore[arg-type]
        bootstrap=bootstrap,
        first_class_tools=first_class_tools,
        confirmations=confirmations,
        clock=fixed_clock(NOW * 1000),
        auth=McpAuthOptions(
            resource=RESOURCE,
            authorization_servers=[ISSUER],
            scopes_supported=["todo:read"],
            verifier=_make_verifier(),
            on_refusal=lambda _r: None,
            required_scopes=required_scopes or (),
            resolver=resolver,
            filter_tools_by_scope=filter_tools_by_scope,
        ),
    )

    @server.command(
        name="todo-list",
        description="List todos",
        input_schema=TodoInput,
        scopes=["todo:read"],
        expose=MCP,
    )
    async def todo_list(inp: TodoInput, _ctx: CommandContext):
        executed.append("todo-list")
        return success({"name": "todo-list", "list": inp.list})

    @server.command(
        name="todo-create",
        description="Create a todo",
        input_schema=TodoInput,
        mutation=True,
        scopes=["todo:write"],
        expose=MCP,
    )
    async def todo_create(inp: TodoInput, _ctx: CommandContext):
        executed.append("todo-create")
        return success({"name": "todo-create", "list": inp.list})

    @server.command(
        name="todo-export",
        description="Export todos",
        input_schema=TodoInput,
        scopes=["todo:export"],
        requires=["todo-list", "todo-purge"] if include_hidden else ["todo-list"],
        expose=MCP,
    )
    async def todo_export(inp: TodoInput, _ctx: CommandContext):
        executed.append("todo-export")
        return success({"name": "todo-export", "list": inp.list})

    if include_hidden:

        @server.command(
            name="todo-purge",
            description="Purge every todo",
            input_schema=TodoInput,
            mutation=True,
            confirm_prompt="Purge every todo?",
            scopes=["todo:admin"],
            expose=MCP,
        )
        async def todo_purge(inp: TodoInput, _ctx: CommandContext):
            executed.append("todo-purge")
            return success({"name": "todo-purge", "list": inp.list})

        @server.command(
            name="secret-run",
            description="Run secret op",
            category="secret",
            input_schema=EmptyInput,
            scopes=["secret:run"],
            expose=MCP,
        )
        async def secret_run(_inp: EmptyInput, _ctx: CommandContext):
            executed.append("secret-run")
            return success({"secret": True})

    @server.command(
        name="todo-archive",
        description="Read archived todos",
        input_schema=ArchiveInput,
        scopes=["todo:read"],
        expose=MCP,
    )
    async def todo_archive(inp: ArchiveInput, _ctx: CommandContext):
        executed.append("todo-archive")
        return success({"list": inp.list})

    @server.command(
        name="list-pick",
        description="Pick a list",
        input_schema=EmptyInput,
        expose=MCP,
    )
    async def list_pick(_inp: EmptyInput, _ctx: CommandContext):
        executed.append("list-pick")
        return success({"list": "archive"})

    @server.command(
        name="nested-caller",
        description="Calls another command in-process with its context",
        expose=MCP,
    )
    async def nested_caller(inp: dict[str, Any], ctx: CommandContext):
        target = inp.get("target", "todo-archive")
        target_input = inp.get("input", {})
        return await server.execute(target, target_input, ctx)

    if with_task:

        @server.command(
            name="report-build",
            description="Build report task",
            input_schema=TodoInput,
            task="required",
            scopes=["report:run"],
            expose=MCP,
        )
        async def report_build(inp: TodoInput, _ctx: CommandContext):
            await asyncio.sleep(0.02)
            executed.append("report-build")
            return success({"report": inp.list})

    return server, executed


@asynccontextmanager
async def _http_client(server: Any, *, max_request_body_size: int | None = None):
    opts: dict[str, Any] = {"stateless_http": True, "json_response": True}
    if max_request_body_size is not None:
        opts["max_request_body_size"] = max_request_body_size
    app = server.streamable_http_app(**opts)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
            yield client


async def _call(
    client: httpx.AsyncClient, token: str, name: str, arguments: dict[str, Any] | None = None
) -> httpx.Response:
    return await client.post(
        "/mcp",
        json=_rpc(
            "tools/call",
            {"name": name, "arguments": arguments or {}, "_meta": MODERN_META},
        ),
        headers=_headers("tools/call", name, token),
    )


# ── 1. Command scopes metadata & configuration validation ──────────────────────


@pytest.mark.asyncio
async def test_command_scopes_metadata_on_all_surfaces_and_validation() -> None:
    @define_command(
        name="item-write",
        description="Write item",
        scopes=["item:write", "item:read", "item:write"],
        expose=MCP,
    )
    async def item_write(_inp: Any):
        return success({"ok": True})

    server = create_server("meta-test", tool_strategy="individual", bootstrap=True)
    server.register(item_write)

    @server.command(
        name="item-read",
        description="Read item",
        scopes=["item:read"],
        expose=MCP,
    )
    async def item_read(_inp: Any):
        return success({"ok": True})

    # _meta.scopes on individual tools (deduplicated, preserving order).
    tools = {t["name"]: t for t in server.get_tool_definitions()}
    assert tools["item-write"]["_meta"]["scopes"] == ["item:write", "item:read"]
    assert tools["item-read"]["_meta"]["scopes"] == ["item:read"]

    # afd-detail reports scopes; unset scopes omitted.
    detail = await server.call_tool("afd-detail", {"command": ["item-write", "afd-help"]})
    entries = {e["name"]: e for e in detail.data}
    assert entries["item-write"]["scopes"] == ["item:write", "item:read"]
    assert "scopes" not in entries["afd-help"]

    # afd-help reports scopes in both brief and full formats, omitted when empty.
    for fmt in ("brief", "full"):
        help_res = await server.call_tool("afd-help", {"format": fmt})
        by_name = {c.name: c for c in help_res.data.commands}
        assert by_name["item-write"].scopes == ["item:write", "item:read"]
        assert by_name["afd-help"].scopes is None

    # Grouped tool action entries also carry _meta.actions[].scopes.
    grouped = create_server("grouped-meta", tool_strategy="grouped")
    grouped.register(item_write)
    grouped_tools = {t["name"]: t for t in grouped.get_tool_definitions()}
    assert grouped_tools["item"]["_meta"]["actions"][0]["scopes"] == ["item:write", "item:read"]

    # Invalid scopes rejected eagerly on define_command, CommandDefinition registration, and auth options.
    with pytest.raises(ValueError, match="OAuth scope token"):
        define_command(name="bad-scope", description="Bad", scopes=["bad scope"])
    with pytest.raises(ValueError, match="OAuth scope token"):
        server.registry.register(
            CommandDefinition(
                name="raw-bad",
                description="Raw",
                handler=item_read,
                scopes=['bad"scope'],
            )
        )
    with pytest.raises(ValueError, match="required_scopes"):
        create_server(
            "bad-req",
            auth=McpAuthOptions(
                resource=RESOURCE,
                authorization_servers=[ISSUER],
                verifier=_make_verifier(),
                required_scopes=["not valid"],
            ),
        )
    with pytest.raises(ValueError, match="resolver"):
        create_server(
            "bad-res",
            auth=McpAuthOptions(
                resource=RESOURCE,
                authorization_servers=[ISSUER],
                verifier=_make_verifier(),
                resolver=object(),  # type: ignore[arg-type]
            ),
        )


# ── 2. Pre-dispatch 403, JSON-RPC batch 400 & body cap 413 ────────────────────


@pytest.mark.asyncio
async def test_pre_dispatch_403_across_tools_groups_batches_pipelines_and_other_methods() -> None:
    server, ran = _build_todo_server(
        tool_strategy="individual", required_scopes=["todo:read"]
    )
    reader = _token("todo:read")
    empty = _token("")

    async with _http_client(server) as client:
        _expect_forbidden(await _call(client, reader, "todo-create"), "todo:write")
        _expect_forbidden(
            await _call(client, reader, "afd-call", {"command": "todo-create", "input": {}}),
            "todo:write",
        )
        _expect_forbidden(
            await _call(
                client,
                reader,
                "afd-batch",
                {
                    "commands": [
                        {"command": "todo-list"},
                        {"command": "todo-create"},
                        {"command": "todo-export"},
                        {"command": "todo-create"},
                    ]
                },
            ),
            "todo:write todo:export",
        )
        _expect_forbidden(
            await _call(
                client,
                reader,
                "afd-pipe",
                {"steps": [{"command": "todo-export"}, {"command": "todo-create"}]},
            ),
            "todo:export todo:write",
        )
        # Required scope first, then command's scope.
        _expect_forbidden(await _call(client, empty, "todo-create"), "todo:read todo:write")
        # Non-tool methods need required_scopes.
        _expect_forbidden(
            await client.post(
                "/mcp",
                json=_rpc("tools/list", {"_meta": MODERN_META}),
                headers=_headers("tools/list", None, empty),
            ),
            "todo:read",
        )
        # JSON-RPC batch refused with 400 -32600 before deciding anything.
        batch_res = await client.post(
            "/mcp",
            json=[_rpc("tools/list", {"_meta": MODERN_META})],
            headers=_headers("tools/list", None, empty),
        )
        assert batch_res.status_code == 400
        assert batch_res.json() == {
            "jsonrpc": "2.0",
            "id": None,
            "error": {
                "code": -32600,
                "message": "JSON-RPC batches are not supported: send one message per request",
            },
        }
        # Unparseable JSON passes on to route.
        bad_json = await client.post(
            "/mcp",
            content=b"{not json",
            headers=_headers("tools/call", "todo-list", reader),
        )
        assert bad_json.status_code == 400
        assert ran == []

        # Allowed call runs normally.
        ok = await _call(client, reader, "todo-list")
        assert ok.status_code == 200
        assert _tool_payload(ok)["success"] is True
        assert ran == ["todo-list"]


@pytest.mark.asyncio
async def test_pre_dispatch_grouped_resolution_and_body_cap_413() -> None:
    server, ran = _build_todo_server(tool_strategy="grouped", required_scopes=["todo:read"])
    reader = _token("todo:read")
    async with _http_client(server, max_request_body_size=512) as client:
        _expect_forbidden(
            await _call(client, reader, "todo", {"action": "create", "params": {}}),
            "todo:write",
        )
        # Unknown action and missing action are unresolved -> required_scopes alone -> router answers.
        unknown = await _call(client, reader, "todo", {"action": "nothing"})
        assert unknown.status_code == 200
        assert _tool_payload(unknown)["error"]["code"] == "COMMAND_NOT_FOUND"

        missing_action = await _call(client, reader, "todo", {})
        assert missing_action.status_code == 200
        assert _tool_payload(missing_action)["error"]["code"] == "INVALID_GROUPED_CALL"

        # Oversized body -> 413 before parsing or dispatch.
        huge = await client.post(
            "/mcp",
            content=json.dumps({"pad": "x" * 600}).encode("utf-8"),
            headers=_headers("tools/call", "todo-list", reader),
        )
        assert huge.status_code == 413
    assert ran == []


@pytest.mark.asyncio
async def test_sse_get_enforces_required_scopes() -> None:
    server, _ = _build_todo_server(required_scopes=["todo:read"])
    app = server.sse_app()
    empty = _token("")
    status, headers, raw = await _raw_asgi_call(
        app,
        method="GET",
        path="/sse",
        headers=[(b"authorization", f"Bearer {empty}".encode("ascii"))],
    )
    assert status == 403
    assert (
        headers["www-authenticate"]
        == f'Bearer error="insufficient_scope", scope="todo:read", resource_metadata="{METADATA_URL}"'
    )
    assert json.loads(raw)["error"] == "INSUFFICIENT_SCOPE"


# ── 3. Resolver two-phase checks, defer, execution re-check & nested calls ────


@pytest.mark.asyncio
async def test_resolver_two_phase_defer_defaults_pipeline_and_nested_calls() -> None:
    seen_creds: list[Credentials] = []
    asked: list[str] = []
    visible_calls: list[str] = []
    resolver = _TableResolver(
        defer={"todo-export"},
        asked=asked,
        visible_calls=visible_calls,
        seen_credentials=seen_creds,
    )
    server, ran = _build_todo_server(
        tool_strategy="individual",
        required_scopes=["todo:read"],
        resolver=resolver,
    )
    reader = _token("todo:read")
    empty = _token("")
    archivist = _token("todo:read todo:archive")

    async with _http_client(server) as client:
        # Defer still enforces required_scopes!
        _expect_forbidden(await _call(client, empty, "todo-export"), "todo:read")
        # Defer with required_scopes lets registry answer.
        deferred = await _call(client, reader, "todo-export")
        assert deferred.status_code == 200
        assert _tool_payload(deferred)["success"] is True
        assert ran == ["todo-export"]
        # Resolver received verified Credentials (not the raw token string).
        assert seen_creds and seen_creds[0].subject == "user-1"
        assert reader not in repr(seen_creds[0])

        # Sent archive list -> refused before dispatch (403).
        _expect_forbidden(
            await _call(client, reader, "todo-list", {"list": "archive"}),
            "todo:archive",
        )
        # Archive list supplied by Pydantic default -> passes pre-dispatch, refused at execution!
        ran.clear()
        defaulted = await _call(client, reader, "todo-archive", {})
        assert defaulted.status_code == 200
        payload = _tool_payload(defaulted)
        assert payload["success"] is False
        assert payload["error"]["code"] == "INSUFFICIENT_SCOPE"
        assert payload["error"]["retryable"] is False
        assert payload["error"]["details"] == {"scopes": ["todo:archive"]}
        assert ran == []

        # Archive list drawn from an earlier pipeline step -> refused at execution!
        piped = await _call(
            client,
            reader,
            "afd-pipe",
            {
                "steps": [
                    {"command": "list-pick"},
                    {"command": "todo-list", "input": {"list": "$prev.list"}},
                ]
            },
        )
        assert piped.status_code == 200
        pipe_payload = _tool_payload(piped)
        assert pipe_payload["steps"][1]["error"]["code"] == "INSUFFICIENT_SCOPE"
        assert pipe_payload["steps"][1]["error"]["details"] == {"scopes": ["todo:archive"]}
        assert "todo-list" not in ran

        # Nested in-process call forwarding context -> re-checked at execution!
        nested = await _call(
            client,
            reader,
            "nested-caller",
            {"target": "todo-archive", "input": {}},
        )
        assert nested.status_code == 200
        assert _tool_payload(nested)["error"]["code"] == "INSUFFICIENT_SCOPE"
        assert "todo-archive" not in ran

        # With todo:archive, both succeed.
        ok = await _call(client, archivist, "todo-archive", {})
        assert _tool_payload(ok)["success"] is True
        assert "todo-archive" in ran


@pytest.mark.asyncio
async def test_resolver_empty_missing_and_exception_fail_closed() -> None:
    class _EmptyResolver:
        def resolve(self, _c: str, _i: Any, _creds: Credentials) -> ScopeDecision:
            return ScopeMissing(())

        def visible(self, _c: str, _creds: Credentials) -> bool:
            return True

    class _ThrowingResolver:
        def resolve(self, _c: str, _i: Any, _creds: Credentials) -> ScopeDecision:
            raise RuntimeError("boom")

        def visible(self, _c: str, _creds: Credentials) -> bool:
            return True

    reader = _token("todo:read")
    for res_impl in (_EmptyResolver(), _ThrowingResolver()):
        server, ran = _build_todo_server(resolver=res_impl)
        async with _http_client(server) as client:
            _expect_forbidden(await _call(client, reader, "todo-list"), "")
        assert ran == []


# ── 4. Filtered listings & cacheScope: "private" ──────────────────────────────


@pytest.mark.asyncio
async def test_filtered_listings_and_cache_scope_across_strategies() -> None:
    for strategy, extra in (
        ("individual", {}),
        ("grouped", {}),
        ("lazy", {}),
        ("hybrid", {"first_class_tools": ["todo-list", "todo-create"]}),
    ):
        filtered_srv, _ = _build_todo_server(
            tool_strategy=strategy, filter_tools_by_scope=True, bootstrap=True, **extra
        )
        unfiltered_srv, _ = _build_todo_server(
            tool_strategy=strategy, filter_tools_by_scope=False, bootstrap=True, **extra
        )
        tok = _token("todo:read todo:export")
        async with _http_client(filtered_srv) as client:
            res = await client.post(
                "/mcp",
                json=_rpc("tools/list", {"_meta": MODERN_META}),
                headers=_headers("tools/list", None, tok),
            )
            assert res.status_code == 200
            result = res.json()["result"]
            assert result["cacheScope"] == "private"
            names = [t["name"] for t in result["tools"]]
            if strategy == "individual":
                assert "todo-list" in names
                assert "todo-export" in names
                assert "todo-create" not in names
                assert "todo-purge" not in names
            elif strategy == "grouped":
                assert "secret" not in names  # Group with no visible action omitted!
                todo_tool = next(t for t in result["tools"] if t["name"] == "todo")
                actions = [a["action"] for a in todo_tool["_meta"]["actions"]]
                assert "list" in actions and "export" in actions
                assert "create" not in actions and "purge" not in actions
            elif strategy == "hybrid":
                assert "todo-list" in names
                assert "todo-create" not in names
                # afd-help firstClassTools only lists shown first-class tools!
                help_res = await _call(client, tok, "afd-help", {})
                assert _tool_payload(help_res)["data"]["firstClassTools"] == ["todo-list"]

            # No "Did you mean" suggestion names an unshown command.
            typo = _tool_payload(await _call(client, tok, "afd-call", {"command": "todo-creat"}))
            assert "todo-create" not in json.dumps(typo)

        async with _http_client(unfiltered_srv) as client:
            res = await client.post(
                "/mcp",
                json=_rpc("tools/list", {"_meta": MODERN_META}),
                headers=_headers("tools/list", None, tok),
            )
            assert res.json()["result"]["cacheScope"] == "public"


# ── 5. Hidden commands: byte-identical twin comparison on every route ─────────


def _normalize_response(res: httpx.Response) -> dict[str, Any]:
    text = res.text
    text = re.sub(
        r'(executionTimeMs|durationMs|totalMs|averageMs)\\?"\s*:\s*[0-9.eE+-]+',
        r'\1":0',
        text,
    )
    text = re.sub(r"\d{4}-\d\d-\d\dT[\d:.]+(?:Z|\+00:00)", "T", text)
    text = re.sub(r"(batch|pipeline|afd-call|trace)-\d+-[a-z0-9]+", r"\1-id", text)
    return {
        "status": res.status_code,
        "content_type": res.headers.get("content-type"),
        "www_authenticate": res.headers.get("www-authenticate"),
        "body": text,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("strategy", "extra"),
    [
        ("individual", {}),
        ("grouped", {}),
        ("lazy", {"bootstrap": True}),
        ("hybrid", {"bootstrap": True, "first_class_tools": ["todo-list", "todo-export"]}),
    ],
)
async def test_hidden_commands_are_byte_identical_to_twin_server_on_every_route(
    strategy: str, extra: dict[str, Any]
) -> None:
    asked: list[str] = []
    hiding_resolver = _TableResolver(hide={"todo-purge", "secret-run"}, asked=asked)
    twin_resolver = _TableResolver(hide=set())

    hiding_srv, ran_hiding = _build_todo_server(
        tool_strategy=strategy,
        confirmations="enforce",
        resolver=hiding_resolver,
        filter_tools_by_scope=True,
        include_hidden=True,
        **extra,
    )
    twin_srv, ran_twin = _build_todo_server(
        tool_strategy=strategy,
        confirmations="enforce",
        resolver=twin_resolver,
        filter_tools_by_scope=True,
        include_hidden=False,
        **extra,
    )
    tok = _token("todo:read todo:write todo:export todo:admin secret:run")

    async with _http_client(hiding_srv) as h_client, _http_client(twin_srv) as t_client:
        async def assert_same(fn):
            h_res = _normalize_response(await fn(h_client))
            t_res = _normalize_response(await fn(t_client))
            assert h_res == t_res
            return h_res

        # Direct call (valid & invalid args) + confirmation never fires!
        own = await assert_same(lambda c: _call(c, tok, "todo-purge", {}))
        assert "COMMAND_NOT_FOUND" in own["body"]
        await assert_same(lambda c: _call(c, tok, "todo-purge", {"list": 123}))
        # afd-call
        await assert_same(lambda c: _call(c, tok, "afd-call", {"command": "todo-purge"}))
        # afd-batch & afd-pipe (hidden command never triggers confirmation)
        await assert_same(
            lambda c: _call(
                c,
                tok,
                "afd-batch",
                {"commands": [{"command": "todo-list", "input": {}}, {"command": "todo-purge"}]},
            )
        )
        await assert_same(
            lambda c: _call(c, tok, "afd-pipe", {"steps": [{"command": "todo-purge"}]})
        )
        # Nested in-process call forwarding context -> COMMAND_NOT_FOUND
        await assert_same(
            lambda c: _call(c, tok, "nested-caller", {"target": "todo-purge", "input": {}})
        )
        # afd-discover & afd-detail (including requires stripped on todo-export!)
        await assert_same(lambda c: _call(c, tok, "afd-discover", {}))
        await assert_same(lambda c: _call(c, tok, "afd-discover", {"search": "purge"}))
        detail_purge = await assert_same(
            lambda c: _call(c, tok, "afd-detail", {"command": "todo-purge"})
        )
        detail_purge_payload = json.loads(
            json.loads(detail_purge["body"])["result"]["content"][0]["text"]
        )
        assert detail_purge_payload["data"][0]["name"] == "todo-purge"
        assert detail_purge_payload["data"][0]["found"] is False
        detail_export = await assert_same(
            lambda c: _call(c, tok, "afd-detail", {"command": "todo-export"})
        )
        assert "todo-purge" not in detail_export["body"]
        assert "todo-list" in detail_export["body"]

        # tools/list
        listed = await assert_same(
            lambda c: c.post(
                "/mcp",
                json=_rpc("tools/list", {"_meta": MODERN_META}),
                headers=_headers("tools/list", None, tok),
            )
        )
        assert "todo-purge" not in listed["body"]
        assert "secret-run" not in listed["body"]

        if strategy == "grouped":
            await assert_same(lambda c: _call(c, tok, "todo", {"action": "purge"}))
            await assert_same(lambda c: _call(c, tok, "todo", {}))
            # Group whose EVERY action is hidden answers as a tool that does not exist!
            await assert_same(lambda c: _call(c, tok, "secret", {"action": "run"}))
            await assert_same(lambda c: _call(c, tok, "secret", {}))

        if extra.get("bootstrap"):
            await assert_same(lambda c: _call(c, tok, "afd-help", {"format": "full"}))
            await assert_same(lambda c: _call(c, tok, "afd-docs", {}))
            await assert_same(lambda c: _call(c, tok, "afd-docs", {"command": "todo-purge"}))
            await assert_same(lambda c: _call(c, tok, "afd-schema", {}))

    # resolve was NEVER asked about hidden commands, and neither ever ran.
    assert "todo-purge" not in asked
    assert "secret-run" not in asked
    assert "todo-purge" not in ran_hiding
    assert "secret-run" not in ran_hiding
    assert ran_hiding == ran_twin


@pytest.mark.asyncio
async def test_resolver_known_true_visible_false_allows_step_up_and_decides_once_per_request() -> None:
    visible_calls: list[str] = []
    known_calls: list[str] = []
    resolver = _TableResolver(
        hide={"todo-create"},
        known_override={"todo-list", "todo-create", "todo-export", "todo-archive", "list-pick", "nested-caller"},
        visible_calls=visible_calls,
        known_calls=known_calls,
    )
    server, _ = _build_todo_server(
        tool_strategy="individual",
        resolver=resolver,
        filter_tools_by_scope=True,
        include_hidden=False,
    )
    reader = _token("todo:read")
    async with _http_client(server) as client:
        # Listed without todo-create (visible=False).
        listed = await client.post(
            "/mcp",
            json=_rpc("tools/list", {"_meta": MODERN_META}),
            headers=_headers("tools/list", None, reader),
        )
        names = [t["name"] for t in listed.json()["result"]["tools"]]
        assert "todo-create" not in names
        # Decided once per command for that single request.
        assert visible_calls.count("todo-create") == 1
        assert known_calls.count("todo-create") == 1

        # Calling todo-create still reaches resolve (known=True) -> 403 step-up challenge!
        _expect_forbidden(await _call(client, reader, "todo-create"), "todo:write")


# ── 6. Host admission & pre_dispatch_check ────────────────────────────────────


def _host_creds(scopes: tuple[str, ...] = ("todo:read",), **overrides: Any) -> Credentials:
    fields: dict[str, Any] = {
        "issuer": ISSUER,
        "subject": "user-1",
        "client_id": "gateway-client",
        "scopes": scopes,
        "resource": RESOURCE,
        "expires_at": NOW + 600,
        "issued_at": NOW - 10,
    }
    fields.update(overrides)
    return Credentials(**fields)


def test_admit_is_method_only_never_exported_and_validates_inputs() -> None:
    for module in (afd, afd_server):
        exported = getattr(module, "__all__", [])
        assert not [name for name in exported if "admit" in name.lower() or "brand" in name.lower()]

    plain = create_server("plain")
    with pytest.raises(ValueError, match="auth option"):
        plain.admit({"type": "http", "method": "POST", "path": "/mcp", "headers": []}, _host_creds())
    with pytest.raises(ValueError, match="auth option"):
        plain.pre_dispatch_check()

    server, _ = _build_todo_server()
    scope_with_auth = {
        "type": "http",
        "method": "POST",
        "path": "/mcp",
        "headers": [(b"authorization", b"Bearer abc")],
        "query_string": b"",
    }
    with pytest.raises(ValueError, match="carries a bearer token"):
        with server.admit(scope_with_auth, _host_creds()):
            pass

    scope_with_encoded_query = {
        "type": "http",
        "method": "POST",
        "path": "/mcp",
        "headers": [],
        "query_string": b"x=1&%61ccess%5Ftoken=abc",
    }
    with pytest.raises(ValueError, match="carries a bearer token"):
        with server.admit(scope_with_encoded_query, _host_creds()):
            pass

    clean_scope = {
        "type": "http",
        "method": "POST",
        "path": "/mcp",
        "headers": [(b"content-type", b"application/json")],
        "query_string": b"",
    }
    # Bad credentials rejected with exact rule name.
    for bad_creds, pattern in (
        (_host_creds(subject=""), "rule claims"),
        (_host_creds(resource="https://other.example/mcp"), "rule claims"),
        (_host_creds(expires_at=NOW), "rule expired"),
        (_host_creds(scopes=("bad scope",)), "rule claims"),
        (_host_creds(cnf={"x5t#S256": "thumb"}), "rule binding"),
    ):
        with pytest.raises(ValueError, match=pattern):
            with server.admit(clean_scope, bad_creds):
                pass

    # Double admit refused.
    with server.admit(clean_scope, _host_creds()):
        with pytest.raises(ValueError, match="admitted before"):
            with server.admit(clean_scope, _host_creds()):
                pass


@pytest.mark.asyncio
async def test_host_admit_and_pre_dispatch_check_match_bearer_layer_and_custom_scheme() -> None:
    server, ran = _build_todo_server(
        tool_strategy="individual",
        confirmations="enforce",
        required_scopes=["todo:read"],
    )
    app = server.streamable_http_app(stateless_http=True, json_response=True)
    default_check = server.pre_dispatch_check()
    custom_check = server.pre_dispatch_check(
        challenge=ScopeChallenge("Gateway", {"realm": "todo"}),
        scope_source="a new assertion from the gateway",
        max_body_bytes=64,
    )

    # 1. Host gateway with default Bearer style matches bearer layer byte-for-byte.
    call_purge = json.dumps(
        _rpc("tools/call", {"name": "todo-purge", "arguments": {}, "_meta": MODERN_META})
    ).encode("utf-8")
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/mcp",
        "headers": [(b"content-type", b"application/json")],
        "query_string": b"",
    }
    with server.admit(scope, _host_creds(scopes=("todo:read",))):
        host_dec = default_check.decide(scope, call_purge)
    assert host_dec.proceed is False
    assert host_dec.status == 403

    async with _http_client(server) as client:
        bearer_res = await _call(client, _token("todo:read"), "todo-purge")
    assert host_dec.status == bearer_res.status_code
    assert host_dec.headers["WWW-Authenticate"] == bearer_res.headers["www-authenticate"]
    assert json.loads(host_dec.body) == bearer_res.json()

    # 2. Custom scheme challenge & scope_source + 413 cap (even unadmitted).
    assert custom_check.max_body_bytes == 64
    oversized = custom_check.decide(scope, b"x" * 65)
    assert oversized.proceed is False and oversized.status == 413
    # Unadmitted request under cap -> proceed=True.
    assert default_check.decide(scope, call_purge).proceed is True
    # Non-POST -> proceed=True (except GET /sse with missing required_scopes -> 403).
    get_scope = {**scope, "method": "GET"}
    with server.admit(get_scope, _host_creds(scopes=())):
        assert default_check.decide(get_scope, b"").proceed is True
    sse_scope = {**scope, "method": "GET", "path": "/sse"}
    with server.admit(sse_scope, _host_creds(scopes=())):
        sse_dec = custom_check.decide(sse_scope, b"")
    assert sse_dec.proceed is False and sse_dec.status == 403
    assert (
        sse_dec.headers["WWW-Authenticate"]
        == 'Gateway realm="todo", error="insufficient_scope", scope="todo:read"'
    )
    assert json.loads(sse_dec.body) == {
        "error": "INSUFFICIENT_SCOPE",
        "suggestion": "Obtain a new assertion from the gateway that also grants todo:read, then retry.",
    }

    # 3. Host skipping pre_dispatch_check -> post-routing INSUFFICIENT_SCOPE BEFORE confirmation!
    #    (todo-purge has confirm_prompt, so this proves scope check runs before confirmation gate!)
    async with app.router.lifespan_context(app):
        post_scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/mcp",
            "raw_path": b"/mcp",
            "query_string": b"",
            "headers": [
                (b"host", b"127.0.0.1:8000"),
                (b"accept", b"application/json, text/event-stream"),
                (b"content-type", b"application/json"),
                (b"mcp-protocol-version", MODERN.encode("ascii")),
                (b"mcp-method", b"tools/call"),
                (b"mcp-name", b"todo-purge"),
            ],
            "client": ("127.0.0.1", 12345),
            "server": ("127.0.0.1", 8000),
            "extensions": {},
        }
        with server.admit(post_scope, _host_creds(scopes=("todo:read",))) as admitted:
            assert is_verified_credentials(admitted, NOW * 1000) is True
            sent: list[dict[str, Any]] = []
            delivered = False

            async def receive() -> dict[str, Any]:
                nonlocal delivered
                if delivered:
                    return {"type": "http.request", "body": b"", "more_body": False}
                delivered = True
                return {"type": "http.request", "body": call_purge, "more_body": False}

            async def send(msg: dict[str, Any]) -> None:
                sent.append(msg)

            await app(post_scope, receive, send)
        # Unbranded immediately after context exits.
        assert is_verified_credentials(admitted, NOW * 1000) is False

        raw_body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
        rpc_res = json.loads(raw_body)
        tool_res = json.loads(rpc_res["result"]["content"][0]["text"])
        assert tool_res["success"] is False
        assert tool_res["error"]["code"] == "INSUFFICIENT_SCOPE"
        assert tool_res["error"]["details"] == {"scopes": ["todo:admin"]}
        assert ran == []


# ── 7. tasks/* scope enforcement & hidden task commands ───────────────────────


@pytest.mark.asyncio
async def test_tasks_static_scope_enforcement_get_update_vs_cancel() -> None:
    server, _ = _build_todo_server(
        tool_strategy="individual",
        required_scopes=["todo:read"],
        with_task=True,
    )
    runner_tok = _token("todo:read report:run", sub="alice", client_id="cli-1")
    reader_only_tok = _token("todo:read", sub="alice", client_id="cli-1")
    no_req_tok = _token("", sub="alice", client_id="cli-1")

    async with _http_client(server) as client:
        # Start task with required_scopes + report:run.
        start = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "report-build", "arguments": {}, "_meta": TASK_META}),
            headers=_headers("tools/call", "report-build", runner_tok),
        )
        assert start.status_code == 200
        task_id = start.json()["result"]["taskId"]

        # Missing required_scopes -> 403 pre-dispatch on tasks/get.
        _expect_forbidden(
            await client.post(
                "/mcp",
                json=_rpc("tasks/get", {"taskId": task_id, "_meta": TASK_META}),
                headers=_headers("tasks/get", task_id, no_req_tok),
            ),
            "todo:read",
        )

        # Same owner lacking report:run -> INSUFFICIENT_SCOPE on tasks/get & tasks/update.
        for method in ("tasks/get", "tasks/update"):
            res = await client.post(
                "/mcp",
                json=_rpc(method, {"taskId": task_id, "_meta": TASK_META}),
                headers=_headers(method, task_id, reader_only_tok),
            )
            err = res.json()["error"]
            assert err["code"] == -32600
            assert err["data"]["code"] == "INSUFFICIENT_SCOPE"
            assert err["data"]["scopes"] == ["report:run"]

        # tasks/cancel only takes authority away -> succeeds without report:run!
        cancel_res = await client.post(
            "/mcp",
            json=_rpc("tasks/cancel", {"taskId": task_id, "_meta": TASK_META}),
            headers=_headers("tasks/cancel", task_id, reader_only_tok),
        )
        assert cancel_res.status_code == 200
        assert "result" in cancel_res.json()


@pytest.mark.asyncio
async def test_tasks_hidden_command_answers_task_not_found_on_all_three() -> None:
    hide_report = False

    class _ToggleResolver:
        def resolve(self, _cmd: str, _inp: Any, _creds: Credentials) -> ScopeDecision:
            return "allowed"

        def visible(self, cmd: str, _creds: Credentials) -> bool:
            return not (hide_report and cmd == "report-build")

    server, _ = _build_todo_server(
        tool_strategy="individual",
        resolver=_ToggleResolver(),
        filter_tools_by_scope=True,
        with_task=True,
    )
    tok = _token("report:run", sub="alice", client_id="cli-1")

    async with _http_client(server) as client:
        start = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "report-build", "arguments": {}, "_meta": TASK_META}),
            headers=_headers("tools/call", "report-build", tok),
        )
        assert start.status_code == 200
        task_id = start.json()["result"]["taskId"]
        await asyncio.sleep(0.05)

        # Now hide report-build from the caller: tasks/get, tasks/update AND tasks/cancel
        # all answer -32602 "Task not found", identical to a nonexistent task id.
        hide_report = True
        missing_id = "a" * 26
        for method in ("tasks/get", "tasks/update", "tasks/cancel"):
            hidden_res = await client.post(
                "/mcp",
                json=_rpc(method, {"taskId": task_id, "_meta": TASK_META}),
                headers=_headers(method, task_id, tok),
            )
            missing_res = await client.post(
                "/mcp",
                json=_rpc(method, {"taskId": missing_id, "_meta": TASK_META}),
                headers=_headers(method, missing_id, tok),
            )
            assert hidden_res.status_code == missing_res.status_code
            assert hidden_res.json() == missing_res.json()
            assert hidden_res.json()["error"] == {"code": -32602, "message": "Task not found"}


# ── 8. Review regressions & additional M6 edge cases ──────────────────────────


@pytest.mark.asyncio
async def test_grouped_context_narrowing_and_direct_fallthrough_enforce_scopes() -> None:
    from afd.server.types import ContextConfig

    ran: list[str] = []
    server = create_server(
        "grouped-ctx",
        tool_strategy="grouped",
        contexts=[ContextConfig(name="alpha"), ContextConfig(name="beta")],
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(required_scopes=["base:read"]),
    )

    @server.command(
        "ops-run",
        "Run in alpha",
        category="ops",
        contexts=["alpha"],
        expose=MCP,
        scopes=["ops:alpha"],
    )
    async def ops_alpha(_inp: dict[str, Any], _ctx: CommandContext | None = None):
        ran.append("ops-run")
        return success({"ok": True})

    @server.command(
        "extra-run",
        "Run in beta (same action 'run' in group 'ops')",
        category="ops",
        contexts=["beta"],
        expose=MCP,
        scopes=["ops:beta"],
    )
    async def ops_beta(_inp: dict[str, Any], _ctx: CommandContext | None = None):
        ran.append("extra-run")
        return success({"ok": True})

    @server.command(
        "solo-direct",
        "Direct command with an 'action' input",
        category="other",
        expose=MCP,
        scopes=["solo:admin"],
    )
    async def solo_direct(_inp: dict[str, Any], _ctx: CommandContext | None = None):
        ran.append("solo-direct")
        return success({"ok": True})

    base_only = _token("base:read")
    async with _http_client(server) as client:
        # Pre-dispatch sees 2 candidates for ops/run across contexts (unresolved), but
        # post-routing narrows to active_context='alpha' (ops-run) and MUST refuse scopes!
        meta_alpha = {**MODERN_META, "dev.afd/context": "alpha"}
        res = await client.post(
            "/mcp",
            json=_rpc(
                "tools/call",
                {"name": "ops", "arguments": {"action": "run", "params": {}}, "_meta": meta_alpha},
            ),
            headers=_headers("tools/call", "ops", base_only),
        )
        assert res.status_code == 200
        payload = json.loads(res.json()["result"]["content"][0]["text"])
        assert payload["success"] is False
        assert payload["error"]["code"] == "INSUFFICIENT_SCOPE"
        assert payload["error"]["details"] == {"scopes": ["ops:alpha"]}

        # Calling a non-group direct command with {"action": "anything"} under grouped strategy
        # must NOT be classified as unresolved; it must get a 403 naming solo:admin!
        _expect_forbidden(
            await _call(client, base_only, "solo-direct", {"action": "anything"}),
            "solo:admin",
        )
    assert ran == []


@pytest.mark.asyncio
async def test_nested_static_scope_check_and_background_task_meta_tool_scope_view() -> None:
    ran: list[str] = []
    server = create_server(
        "nested-static",
        tool_strategy="individual",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(filter_tools_by_scope=True),
    )

    @server.command("outer-run", "Outer", expose=MCP, scopes=["todo:read"])
    async def outer_run(_inp: dict[str, Any], context: CommandContext | None = None):
        return await server.execute("inner-secret", {}, context)

    @server.command("inner-secret", "Inner", expose=MCP, scopes=["todo:admin"])
    async def inner_secret(_inp: dict[str, Any], _ctx: CommandContext | None = None):
        ran.append("inner-secret")
        return success({"ok": True})

    @server.command("bg-probe", "Task probing meta-tools", expose=MCP, scopes=["todo:read"], task="optional")
    async def bg_probe(_inp: dict[str, Any], context: CommandContext | None = None):
        await asyncio.sleep(0.03)
        disc = await server.execute("afd-discover", {}, context)
        call_res = await server.execute("afd-call", {"command": "inner-secret", "input": {}}, context)
        disc_names = [c["name"] for c in (disc.data["commands"] if disc.success else [])]
        return success(
            {
                "discover": disc_names,
                "callError": call_res.error.code if not call_res.success and call_res.error else None,
                "callScopes": (
                    call_res.error.details.get("scopes")
                    if not call_res.success and call_res.error and call_res.error.details
                    else None
                ),
            }
        )

    tok = _token("todo:read", sub="alice", client_id="cli-1")
    async with _http_client(server) as client:
        # Nested in-process call under the static rule MUST enforce inner-secret's scopes.
        nested = await _call(client, tok, "outer-run", {})
        assert nested.status_code == 200
        nested_payload = json.loads(nested.json()["result"]["content"][0]["text"])
        assert nested_payload["success"] is False
        assert nested_payload["error"]["code"] == "INSUFFICIENT_SCOPE"
        assert nested_payload["error"]["details"] == {"scopes": ["todo:admin"]}

        # Background task calling meta-tools after HTTP POST closed keeps task's ScopeView.
        start = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "bg-probe", "arguments": {}, "_meta": TASK_META}),
            headers=_headers("tools/call", "bg-probe", tok),
        )
        assert start.status_code == 200
        task_id = start.json()["result"]["taskId"]
        for _ in range(40):
            await asyncio.sleep(0.02)
            got = await client.post(
                "/mcp",
                json=_rpc("tasks/get", {"taskId": task_id, "_meta": TASK_META}),
                headers=_headers("tasks/get", task_id, tok),
            )
            if got.json()["result"]["status"] == "completed":
                break
        detailed = got.json()["result"]
        assert detailed["status"] == "completed"
        probe = json.loads(detailed["result"]["content"][0]["text"])["data"]
        assert "inner-secret" not in probe["discover"]
        assert "outer-run" in probe["discover"]
        assert probe["callError"] == "INSUFFICIENT_SCOPE"
        assert probe["callScopes"] == ["todo:admin"]
    assert ran == []


@pytest.mark.asyncio
async def test_execution_resolver_ignores_output_exclude_serialization_alias_and_serializer() -> None:
    from pydantic import field_serializer

    class _TrickyInput(BaseModel):
        env: str = Field(default="prod", exclude=True)
        tier: str = Field(default="restricted", serialization_alias="out_tier")
        flag: str = Field(default="secret")

        @field_serializer("flag")
        def _mask_flag(self, _v: str) -> str:
            return "public"

    seen_inputs: list[Any] = []

    class _StrictResolver:
        def resolve(self, command: str, input: Any, credentials: Credentials) -> ScopeDecision:
            seen_inputs.append(input)
            if command == "tricky-run" and isinstance(input, dict):
                if input.get("env") == "prod" or input.get("tier") == "restricted" or input.get("flag") == "secret":
                    if "prod:admin" not in credentials.scopes:
                        return ScopeMissing(("prod:admin",))
            return "allowed"

        def visible(self, _command: str, _credentials: Credentials) -> bool:
            return True

    ran = False
    server = create_server(
        "tricky-srv",
        tool_strategy="individual",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(resolver=_StrictResolver()),
    )

    @server.command("tricky-run", "Tricky", input_schema=_TrickyInput, expose=MCP)
    async def tricky_run(inp: _TrickyInput, _ctx: CommandContext | None = None):
        nonlocal ran
        ran = True
        return success({"env": inp.env, "tier": inp.tier, "flag": inp.flag})

    tok = _token("todo:read")
    async with _http_client(server) as client:
        res = await _call(client, tok, "tricky-run", {})
        assert res.status_code == 200
        payload = json.loads(res.json()["result"]["content"][0]["text"])
        assert payload["success"] is False
        assert payload["error"]["code"] == "INSUFFICIENT_SCOPE"
        assert payload["error"]["details"] == {"scopes": ["prod:admin"]}
    assert ran is False
    # Execution phase saw the real validated fields (env='prod', tier='restricted', flag='secret').
    assert seen_inputs[-1] == {"env": "prod", "tier": "restricted", "flag": "secret"}


@pytest.mark.asyncio
async def test_resolver_callbacks_receive_branded_credentials_and_unbrand_on_early_403() -> None:
    observed: list[tuple[str, bool]] = []
    captured_creds: list[Credentials] = []

    class _BrandCheckingResolver:
        def resolve(self, command: str, _input: Any, credentials: Credentials) -> ScopeDecision:
            observed.append(("resolve", is_verified_credentials(credentials, NOW * 1000)))
            captured_creds.append(credentials)
            return ScopeMissing(("todo:admin",))

        def visible(self, _command: str, credentials: Credentials) -> bool:
            observed.append(("visible", is_verified_credentials(credentials, NOW * 1000)))
            captured_creds.append(credentials)
            return True

        def known(self, _command: str, credentials: Credentials) -> bool:
            observed.append(("known", is_verified_credentials(credentials, NOW * 1000)))
            return True

    server = create_server(
        "brand-srv",
        tool_strategy="individual",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(resolver=_BrandCheckingResolver(), filter_tools_by_scope=True),
    )

    @server.command("todo-list", "List", expose=MCP)
    async def todo_list(_inp: dict[str, Any], _ctx: CommandContext | None = None):
        return success({})

    tok = _token("todo:read")
    async with _http_client(server) as client:
        _expect_forbidden(await _call(client, tok, "todo-list", {}), "todo:admin")

    assert observed
    assert all(branded is True for _hook, branded in observed)
    assert all(is_verified_credentials(c, NOW * 1000) is False for c in captured_creds)

    # Host admit path also brands before visible/known/resolve and unbrands on exit.
    observed.clear()
    captured_creds.clear()
    scope = {"type": "http", "method": "POST", "path": "/mcp", "headers": [(b"content-type", b"application/json")], "query_string": b""}
    check = server.pre_dispatch_check()
    with server.admit(scope, _host_creds(["todo:read"])):
        dec = check.decide(scope, json.dumps(_rpc("tools/call", {"name": "todo-list", "arguments": {}})))
        assert dec.proceed is False and dec.status == 403
    assert observed
    assert all(branded is True for _hook, branded in observed)
    assert all(is_verified_credentials(c, NOW * 1000) is False for c in captured_creds)


@pytest.mark.asyncio
async def test_host_admit_request_identity_non_post_required_scopes_and_default_body_limit() -> None:
    from afd.server.auth import create_auth_layer

    # 1. Default JSON body cap matches MCP SDK's 4 MiB on both bearer and host pre_dispatch_check.
    server, _ = _build_todo_server(
        tool_strategy="individual",
        required_scopes=["todo:read"],
    )
    check = server.pre_dispatch_check()
    assert check.max_body_bytes == 4 * 1024 * 1024

    # 2. Request identity binding: distinct nested scope allowed, same scope or bearer scope refused,
    #    and check.decide(other_scope, ...) returns PROCEED.
    s1 = {"type": "http", "method": "POST", "path": "/mcp", "headers": [(b"content-type", b"application/json")], "query_string": b""}
    s2 = {"type": "http", "method": "POST", "path": "/mcp", "headers": [(b"content-type", b"application/json")], "query_string": b""}
    body = json.dumps(_rpc("tools/call", {"name": "todo-purge", "arguments": {}}))
    with server.admit(s1, _host_creds(["todo:read"])):
        # Other request object does not inherit s1's view in check.decide.
        assert check.decide(s2, body).proceed is True
        # Distinct nested request can be admitted.
        with server.admit(s2, _host_creds(["todo:read", "todo:write", "todo:admin"])):
            assert check.decide(s2, body).proceed is True
            # Same scope cannot be re-admitted.
            with pytest.raises(ValueError, match="admitted before"):
                with server.admit(s2, _host_creds(["todo:read"])):
                    pass

    # Re-admitting a bearer-admitted downstream scope raises ValueError.
    re_admit_error: list[Exception] = []
    app = server.streamable_http_app(stateless_http=True, json_response=True)
    orig_inner = app._app

    async def _probing_inner(scope: dict[str, Any], receive: Any, send: Any) -> None:
        try:
            with server.admit(scope, _host_creds(["todo:read"])):
                pass
        except Exception as exc:
            re_admit_error.append(exc)
        await orig_inner(scope, receive, send)

    app._app = _probing_inner
    async with orig_inner.router.lifespan_context(orig_inner):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
            res = await client.post(
                "/mcp",
                json=_rpc("tools/call", {"name": "todo-list", "arguments": {}, "_meta": MODERN_META}),
                headers=_headers("tools/call", "todo-list", _token("todo:read")),
            )
            assert res.status_code == 200
    assert len(re_admit_error) == 1 and "admitted before" in str(re_admit_error[0])

    # 3. Host-admitted GET /mcp and DELETE /mcp enforce required_scopes even without pre_dispatch_check.
    raw_app = server.streamable_http_app(stateless_http=True, json_response=True)

    async def _host_wrapper(scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await raw_app(scope, receive, send)
            return
        with server.admit(scope, _host_creds([])):
            await raw_app(scope, receive, send)

    async with raw_app.router.lifespan_context(raw_app):
        transport = httpx.ASGITransport(app=_host_wrapper)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
            _expect_forbidden(await client.get("/mcp", headers={"Accept": "text/event-stream"}), "todo:read")
            _expect_forbidden(await client.delete("/mcp"), "todo:read")

    # 4. Standalone create_auth_layer enforces required_scopes + batch refusal, and rejects
    #    resolver/filter_tools_by_scope without get_scope_authority.
    with pytest.raises(ValueError, match="get_scope_authority"):
        create_auth_layer(_auth_options(filter_tools_by_scope=True))
    with pytest.raises(ValueError, match="get_scope_authority"):
        create_auth_layer(_auth_options(resolver=_TableResolver()))

    standalone = create_auth_layer(
        _auth_options(required_scopes=["todo:read"]), clock=fixed_clock(NOW * 1000)
    )

    async def _ok_app(_scope: dict[str, Any], _receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": b'{"ok":true}'})

    wrapped = standalone.wrap_asgi_app(_ok_app, decide_post_body=True)
    transport = httpx.ASGITransport(app=wrapped)
    async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
        _expect_forbidden(
            await client.post(
                "/mcp",
                json=_rpc("tools/list", {}),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {_token('')}"},
            ),
            "todo:read",
        )
        batch_res = await client.post(
            "/mcp",
            json=[_rpc("tools/list", {})],
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {_token('todo:read')}"},
        )
        assert batch_res.status_code == 400
        assert batch_res.json()["error"]["code"] == -32600


@pytest.mark.asyncio
async def test_requires_never_discloses_unexposed_commands_and_positional_args_preserved() -> None:
    # Positional arguments on CommandDefinition, define_command, and @server.command keep order.
    async def _noop(_inp: Any, _ctx: Any = None):
        return success({})

    cd = CommandDefinition("pos-one", "desc", _noop, None, [], None, None, None, None, None, None, False, None, [], [], [], True)
    assert cd.handoff is True and cd.scopes == []

    @define_command("pos-two", "desc", None, None, None, None, False, None, None, None, True)
    async def _pos_two(_inp: Any, _ctx: Any = None):
        return success({})

    assert getattr(_pos_two, "__afd_command__").handoff is True

    # Dict and set scopes are rejected by validate_command_scopes.
    with pytest.raises(ValueError, match="sequence"):
        define_command("bad-set", "desc", scopes={"todo:read"})(_noop)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="sequence"):
        define_command("bad-dict", "desc", scopes={"todo:read": True})(_noop)  # type: ignore[arg-type]

    # Unexposed command named in requires must NOT be disclosed on any MCP listing surface.
    server = create_server(
        "unexposed-req",
        tool_strategy="grouped",
        bootstrap=True,
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(filter_tools_by_scope=True),
    )

    # Positional expose argument on @server.command still binds to expose.
    @server.command("cli-only", "CLI only", None, None, None, None, False, None, None, None, ExposeOptions(mcp=False, cli=True))
    async def cli_only(_inp: Any, _ctx: Any = None):
        return success({})

    @server.command("todo-list", "List", expose=MCP, scopes=["todo:read"])
    async def todo_list(_inp: Any, _ctx: Any = None):
        return success({})

    @server.command("todo-export", "Export", expose=MCP, scopes=["todo:read"], requires=["todo-list", "cli-only"])
    async def todo_export(_inp: Any, _ctx: Any = None):
        return success({})

    tok = _token("todo:read")
    async with _http_client(server) as client:
        listed = await client.post(
            "/mcp",
            json=_rpc("tools/list", {"_meta": MODERN_META}),
            headers=_headers("tools/list", None, tok),
        )
        assert "cli-only" not in listed.text
        detail = await _call(client, tok, "afd-detail", {"command": "todo-export"})
        assert "cli-only" not in detail.text and "todo-list" in detail.text
        help_res = await _call(client, tok, "afd-help", {"format": "full"})
        assert "cli-only" not in help_res.text
        docs_res = await _call(client, tok, "afd-docs", {})
        assert "cli-only" not in docs_res.text


@pytest.mark.asyncio
async def test_tasks_resolver_visible_false_exec_refusal_and_hidden_required_task() -> None:
    hide_visible = False

    class _TaskResolver:
        def resolve(self, command: str, input: Any, credentials: Credentials) -> ScopeDecision:
            if command == "default-task" and isinstance(input, dict) and input.get("mode") == "privileged":
                if "task:admin" not in credentials.scopes:
                    return ScopeMissing(("task:admin",))
            return "allowed"

        def visible(self, command: str, _credentials: Credentials) -> bool:
            if command == "hidden-req-task":
                return False
            if hide_visible and command == "report-build":
                return False
            return True

        def known(self, command: str, _credentials: Credentials) -> bool:
            return command != "hidden-req-task"

    class _DefaultTaskInput(BaseModel):
        mode: str = Field(default="privileged")

    server = create_server(
        "task-edge",
        tool_strategy="individual",
        clock=fixed_clock(NOW * 1000),
        auth=_auth_options(resolver=_TaskResolver(), filter_tools_by_scope=True),
    )

    @server.command("report-build", "Build", expose=MCP, task="optional")
    async def report_build(_inp: dict[str, Any], _ctx: CommandContext | None = None):
        await asyncio.sleep(0.05)
        return success({"done": True})

    @server.command("default-task", "Defaulted task", input_schema=_DefaultTaskInput, expose=MCP, task="optional")
    async def default_task(inp: _DefaultTaskInput, _ctx: CommandContext | None = None):
        return success({"mode": inp.mode})

    @server.command("hidden-req-task", "Hidden required task", expose=MCP, task="required")
    async def hidden_req_task(_inp: dict[str, Any], _ctx: CommandContext | None = None):
        return success({"secret": True})

    tok = _token("todo:read", sub="alice", client_id="cli-1")
    async with _http_client(server) as client:
        # 1. Resolver known=True, visible=False -> tasks/get & tasks/update return INSUFFICIENT_SCOPE
        #    with empty scopes, while tasks/cancel succeeds.
        start = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "report-build", "arguments": {}, "_meta": TASK_META}),
            headers=_headers("tools/call", "report-build", tok),
        )
        assert start.status_code == 200
        task_id = start.json()["result"]["taskId"]
        hide_visible = True
        for method in ("tasks/get", "tasks/update"):
            res = await client.post(
                "/mcp",
                json=_rpc(method, {"taskId": task_id, "_meta": TASK_META}),
                headers=_headers(method, task_id, tok),
            )
            err = res.json()["error"]
            assert err["code"] == -32600
            assert err["data"]["code"] == "INSUFFICIENT_SCOPE"
            assert err["data"]["scopes"] == []
        cancel = await client.post(
            "/mcp",
            json=_rpc("tasks/cancel", {"taskId": task_id, "_meta": TASK_META}),
            headers=_headers("tasks/cancel", task_id, tok),
        )
        assert cancel.status_code == 200 and "result" in cancel.json()

        # 2. Background task passes pre-dispatch on {} and is refused at execution time on default.
        start2 = await client.post(
            "/mcp",
            json=_rpc("tools/call", {"name": "default-task", "arguments": {}, "_meta": TASK_META}),
            headers=_headers("tools/call", "default-task", tok),
        )
        assert start2.status_code == 200
        task2_id = start2.json()["result"]["taskId"]
        for _ in range(40):
            await asyncio.sleep(0.02)
            got2 = await client.post(
                "/mcp",
                json=_rpc("tasks/get", {"taskId": task2_id, "_meta": TASK_META}),
                headers=_headers("tasks/get", task2_id, tok),
            )
            if got2.json()["result"]["status"] in ("completed", "failed"):
                break
        detailed2 = got2.json()["result"]
        inner2 = json.loads(detailed2["result"]["content"][0]["text"])
        assert inner2["success"] is False
        assert inner2["error"]["code"] == "INSUFFICIENT_SCOPE"
        assert inner2["error"]["details"] == {"scopes": ["task:admin"]}

        # 3. Hidden task='required' command answers COMMAND_NOT_FOUND on direct call (without
        #    tasks capability) and per-step COMMAND_NOT_FOUND in afd-batch/afd-pipe (never
        #    INVALID_BATCH_REQUEST or -32021).
        direct = await _call(client, tok, "hidden-req-task", {})
        assert direct.status_code == 200
        direct_body = json.loads(direct.json()["result"]["content"][0]["text"])
        assert direct_body["error"]["code"] == "COMMAND_NOT_FOUND"

        batch = await _call(
            client,
            tok,
            "afd-batch",
            {"commands": [{"command": "hidden-req-task", "input": {}}]},
        )
        batch_body = json.loads(batch.json()["result"]["content"][0]["text"])
        assert batch_body["results"][0]["result"]["error"]["code"] == "COMMAND_NOT_FOUND"

        pipe = await _call(
            client,
            tok,
            "afd-pipe",
            {"steps": [{"command": "hidden-req-task", "input": {}}]},
        )
        pipe_body = json.loads(pipe.json()["result"]["content"][0]["text"])
        assert pipe_body["steps"][0]["error"]["code"] == "COMMAND_NOT_FOUND"
