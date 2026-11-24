"""Per-request context hook for Python MCP calls (#800).

Mirrors ``packages/rust/tests/server_context_hook.rs`` and tests:
- sync and async hooks, over in-process stdio-shaped connections (both eras)
  and real Streamable HTTP (with ASGI middleware setting verified ``request.state``
  and headers);
- refusal redaction (``details`` and ``cause`` stripped), fail-closed on exception
  or invalid return type (including invalid ``clock``/``random``), and
  indistinguishable refusals across real, missing, unexposed and malformed calls;
- execution order: once per ``tools/call`` before ``RequestStateBoundary`` unsealing,
  ``lift_meta_argument``, ``UnknownContextError``, ``ConfirmationGate`` and lookup;
- every route (individual, grouped, hybrid, unlisted, ``afd-call``, ``afd-batch``,
  ``afd-pipe``, ``afd-discover``, ``afd-detail``); not called on ``tools/list``,
  ``server/discover``, ``initialize`` or ``server.execute()``;
- server invariants (``interface="mcp"``, ``remote=True``, ``active_context``,
  ``trace_id``, ``actor``/``clock``/``random`` defaults, DirectClient tokens cleared,
  nested ``extra`` container isolation across batch/pipeline steps);
- declared context fields: hook runs without caller ``_meta`` fields and wins over
  ``_meta`` (including explicit ``None``);
- principal binding (M8, #532, ``spec/authorization.json``): confirmation and
  single-command plus up-front batch/pipe approval-relay ``requestState`` bind the
  hook's snapshotted actor alongside SDK-verified credentials on one shared server;
- journal middleware compatibility with hook actor and trace ID.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("mcp")

import httpx  # noqa: E402
import mcp_types as types  # noqa: E402
from mcp import Client, MCPError  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402

from afd import Actor, CommandError, ExposeOptions, Recovery, error, success  # noqa: E402
from afd.core.clock import fixed_clock, seeded_random  # noqa: E402
from afd.core.commands import CommandContext  # noqa: E402
from afd.server import (  # noqa: E402
    ContextConfig,
    ContextField,
    ContextHookRequest,
    create_approval_middleware,
    create_server,
)

MCP = ExposeOptions(mcp=True)
MODERN = "2026-07-28"
KEY = b"k" * 32
SECRET = "s" * 32
ACCEPT_CONFIRM = {"confirm": types.ElicitResult(action="accept", content={"confirm": True})}
ACCEPT_APPROVE = {"approve": types.ElicitResult(action="accept", content={"approve": True})}

MODERN_META = {
    "io.modelcontextprotocol/protocolVersion": MODERN,
    "io.modelcontextprotocol/clientCapabilities": {"elicitation": {"form": {}}},
    "io.modelcontextprotocol/clientInfo": {"name": "hook-test", "version": "0"},
}


class Scope(BaseModel):
    project: str


def body(result: Any) -> dict[str, Any]:
    return json.loads(result.content[0].text)


def _answer(action: str, prompts: list[str] | None = None, *, field: str = "confirm"):
    async def callback(context: Any, params: Any):
        if prompts is not None:
            prompts.append(params.message)
        if action == "accept":
            return types.ElicitResult(action="accept", content={field: True})
        return types.ElicitResult(action=action)

    return callback


def _probe_server(runs: list[str], **options: Any):
    server = create_server(
        "hook-test",
        tool_strategy=options.pop("tool_strategy", "individual"),
        **options,
    )

    @server.command(
        name="context-probe",
        description="Return what the handler sees on its context",
        expose=MCP,
    )
    async def probe(input: Any, context: CommandContext):
        runs.append("probe")
        extra = dict(context.extra or {})
        scope = extra.get("scope")
        if isinstance(scope, BaseModel):
            extra["scope"] = scope.model_dump()
        return success(
            {
                "actor": (
                    {
                        k: v
                        for k, v in {
                            "kind": context.actor.kind,
                            "id": context.actor.id,
                            "label": context.actor.label,
                            "onBehalfOf": context.actor.on_behalf_of,
                        }.items()
                        if v is not None
                    }
                    if context.actor is not None
                    else None
                ),
                "interface": extra.get("interface"),
                "remote": extra.get("remote"),
                "activeContext": extra.get("active_context"),
                "traceId": context.trace_id,
                "extra": extra,
                "timeout": context.timeout,
                "hasDirectAllow": context._direct_allow is not None,
                "hasDirectApproval": context._direct_approval is not None,
                "now": context.clock.now() if context.clock else None,
            }
        )

    @server.command(
        name="todo-clear",
        description="Delete every todo",
        mutation=True,
        destructive=True,
        confirm_prompt="Delete every todo?",
        expose=MCP,
    )
    async def clear(input: Any, context: CommandContext):
        runs.append(f"clear:{context.actor.id if context.actor else None}")
        return success(
            {
                "cleared": True,
                "actorId": context.actor.id if context.actor else None,
            }
        )

    @server.command(
        name="secret-rotate",
        description="Private command not exposed to MCP",
    )
    async def secret(input: Any, context: CommandContext):
        runs.append("secret")
        return success({"rotated": True})

    return server


@asynccontextmanager
async def _http_client(server: Any, *, stateless: bool = True, asgi_middleware: Any = None):
    """Serve ``server`` over its real Starlette Streamable HTTP app in process."""
    app = server.streamable_http_app(stateless_http=stateless, json_response=True)
    if asgi_middleware is not None:
        app.add_middleware(asgi_middleware)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://127.0.0.1:8000",
        ) as http,
    ):
        yield http


async def _modern_http_post(
    http: httpx.AsyncClient,
    tool: str,
    arguments: dict[str, Any] | None = None,
    *,
    headers: dict[str, str] | None = None,
    meta: dict[str, Any] | None = None,
    request_state: str | None = None,
    input_responses: dict[str, Any] | None = None,
    expected_status: int = 200,
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "name": tool,
        "arguments": {} if arguments is None else arguments,
        "_meta": {**MODERN_META, **(meta or {})},
    }
    if request_state is not None:
        params["requestState"] = request_state
    if input_responses is not None:
        params["inputResponses"] = input_responses
    req_headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": "tools/call",
        "Mcp-Name": tool,
        **(headers or {}),
    }
    resp = await http.post(
        "/mcp",
        headers=req_headers,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params},
    )
    assert resp.status_code == expected_status, resp.text
    return resp.json()


def _http_command_result(rpc: dict[str, Any]) -> dict[str, Any]:
    result = rpc["result"]
    assert result.get("resultType") == "complete", rpc
    parsed = json.loads(result["content"][0]["text"])
    assert result["structuredContent"] == parsed, rpc
    return parsed


# ═══════════════════════════════════════════════════════════════════════════════
# CONSTRUCTION & BASIC BEHAVIOR
# ═══════════════════════════════════════════════════════════════════════════════


def test_non_callable_context_hook_is_rejected():
    with pytest.raises(TypeError, match="context_hook"):
        create_server("bad", context_hook="not-callable")  # type: ignore[arg-type]


async def test_without_a_hook_nothing_changes():
    runs: list[str] = []
    server = _probe_server(runs)
    async with Client(server._create_mcp_server()) as client:
        res = body(await client.call_tool("context-probe", {}))
    assert res["success"] is True
    assert res["data"]["actor"] == {"kind": "agent"}
    assert res["data"]["interface"] == "mcp"
    assert res["data"]["remote"] is True


@pytest.mark.parametrize("is_async", [False, True])
@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_sync_and_async_hooks_set_actor_and_extra_in_process(is_async, mode):
    runs: list[str] = []
    seen_requests: list[ContextHookRequest] = []

    def sync_hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        seen_requests.append(req)
        assert req.http_request is None
        assert req.header("x-test-actor") is None
        ctx.actor = Actor(kind="human", id="stdio-user", label="Local")
        ctx.extra["source"] = "in-process"
        return ctx

    async def async_hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        await asyncio.sleep(0)
        return sync_hook(req, ctx)

    server = _probe_server(runs, context_hook=async_hook if is_async else sync_hook)
    async with Client(server._create_mcp_server(), mode=mode) as client:
        res = body(await client.call_tool("context-probe", {}))
    assert res["success"] is True
    assert res["data"]["actor"] == {"kind": "human", "id": "stdio-user", "label": "Local"}
    assert res["data"]["extra"]["source"] == "in-process"
    assert res["metadata"]["actorKind"] == "human"
    assert [r.tool for r in seen_requests] == ["context-probe"]


async def test_hook_reads_verified_asgi_state_and_headers_over_streamable_http():
    """The documented HTTP pattern: ASGI auth middleware verifies a caller and attaches
    it to ``request.state``; the hook reads that state (and request metadata), never an
    unverified claim."""

    class VerifiedAuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            # Simulates an upstream verifier writing trusted identity to request.state.
            token = request.headers.get("x-verified-gateway-token")
            request.state.verified_caller = (
                {"id": token.removeprefix("ok:"), "tenant": "acme"}
                if token and token.startswith("ok:")
                else None
            )
            return await call_next(request)

    async def hook(req: ContextHookRequest, ctx: CommandContext):
        http_req = req.http_request
        if http_req is None:
            return ctx
        caller = getattr(http_req.state, "verified_caller", None)
        if caller is None:
            return CommandError(
                code="UNAUTHORIZED",
                message="Authentication is required",
                suggestion="Send valid credentials",
                retryable=False,
                recovery=Recovery(kind="external"),
                details={"reason": "missing token for alice"},
                cause="gateway check failed",
            )
        ctx.actor = Actor(kind="service", id=caller["id"])
        ctx.extra["tenant"] = caller["tenant"]
        ctx.extra["path"] = http_req.url.path
        ctx.extra["hdr"] = req.header("X-Custom-Tag")
        return ctx

    runs: list[str] = []
    server = _probe_server(runs, context_hook=hook)
    async with _http_client(server, asgi_middleware=VerifiedAuthMiddleware) as http:
        ok_rpc = await _modern_http_post(
            http,
            "context-probe",
            headers={"x-verified-gateway-token": "ok:alice", "x-custom-tag": "v1"},
        )
        ok = _http_command_result(ok_rpc)
        assert ok["success"] is True
        assert ok["data"]["actor"] == {"kind": "service", "id": "alice"}
        assert ok["data"]["extra"]["tenant"] == "acme"
        assert ok["data"]["extra"]["path"] == "/mcp"
        assert ok["data"]["extra"]["hdr"] == "v1"
        assert ok["metadata"]["actorKind"] == "service"

        # Unauthenticated request: refused with details & cause stripped and the recovery kept,
        # nothing runs.
        denied_rpc = await _modern_http_post(http, "context-probe")
        assert denied_rpc["result"]["isError"] is True
        denied = _http_command_result(denied_rpc)
        assert denied["success"] is False
        assert denied["error"] == {
            "code": "UNAUTHORIZED",
            "message": "Authentication is required",
            "suggestion": "Send valid credentials",
            "retryable": False,
            "recovery": {"kind": "external"},
        }
        assert "alice" not in json.dumps(denied_rpc)
        assert "gateway check failed" not in json.dumps(denied_rpc)
    assert runs == ["probe"]


# ═══════════════════════════════════════════════════════════════════════════════
# REFUSALS, FAIL-CLOSED & ORACLE PREVENTION
# ═══════════════════════════════════════════════════════════════════════════════


async def test_refused_caller_cannot_distinguish_real_missing_private_or_meta_tools():
    runs: list[str] = []

    def refuse(req: ContextHookRequest, ctx: CommandContext):
        return error(
            "UNAUTHORIZED",
            "Authentication is required",
            suggestion="Send valid credentials",
            retryable=False,
            details={"secret": "do-not-leak"},
        )

    server = _probe_server(
        runs,
        context_hook=refuse,
        confirmations="enforce",
        contexts=[ContextConfig(name="planning"), ContextConfig(name="review")],
    )
    async with _http_client(server) as http:
        real = _http_command_result(await _modern_http_post(http, "context-probe"))
        missing = _http_command_result(await _modern_http_post(http, "no-such-tool"))
        private = _http_command_result(await _modern_http_post(http, "secret-rotate"))
        gated = await _modern_http_post(http, "todo-clear")
        unknown_ctx = _http_command_result(
            await _modern_http_post(
                http, "context-probe", meta={"dev.afd/context": "no-such-context"}
            )
        )
        bad_meta_arg = _http_command_result(
            await _modern_http_post(http, "afd-call", {"command": "context-probe", "meta": 123})
        )
        discover = _http_command_result(await _modern_http_post(http, "afd-discover"))
        detail = _http_command_result(
            await _modern_http_post(http, "afd-detail", {"commands": ["context-probe"]})
        )
        batch = _http_command_result(
            await _modern_http_post(http, "afd-batch", {"commands": [{"command": "todo-clear"}]})
        )
        pipe = _http_command_result(
            await _modern_http_post(http, "afd-pipe", {"steps": [{"command": "todo-clear"}]})
        )
        # Even with a bogus requestState, refusal answers before RequestStateBoundary unseals.
        with_state = _http_command_result(
            await _modern_http_post(
                http,
                "todo-clear",
                request_state="bogus-state",
                input_responses={"confirm": {"action": "accept", "content": {"confirm": True}}},
            )
        )

    assert "inputRequests" not in gated["result"]
    gated_res = _http_command_result(gated)
    for res in (
        missing,
        private,
        gated_res,
        unknown_ctx,
        bad_meta_arg,
        discover,
        detail,
        batch,
        pipe,
        with_state,
    ):
        assert res == real
    assert real["error"] == {
        "code": "UNAUTHORIZED",
        "message": "Authentication is required",
        "suggestion": "Send valid credentials",
        "retryable": False,
    }
    assert runs == []


@pytest.mark.parametrize(
    "bad_hook",
    [
        lambda req, ctx: (_ for _ in ()).throw(RuntimeError("secret internal stack details")),
        lambda req, ctx: None,
        lambda req, ctx: {"actor": "alice"},
        lambda req, ctx: success({"smuggled": True}),
        lambda req, ctx: CommandContext(actor={"kind": "human"}),  # type: ignore[arg-type]
        lambda req, ctx: CommandContext(actor=Actor(kind="bogus")),  # type: ignore[arg-type]
        lambda req, ctx: CommandContext(extra=["not-a-mapping"]),  # type: ignore[arg-type]
        lambda req, ctx: CommandContext(trace_id=123),  # type: ignore[arg-type]
        lambda req, ctx: CommandContext(clock="not-a-clock"),  # type: ignore[arg-type]
        lambda req, ctx: CommandContext(random="not-a-random"),  # type: ignore[arg-type]
    ],
    ids=[
        "raises",
        "returns-none",
        "returns-dict",
        "returns-success-result",
        "non-actor",
        "invalid-actor-kind",
        "non-mapping-extra",
        "non-string-trace-id",
        "invalid-clock",
        "invalid-random",
    ],
)
async def test_raising_or_misbehaving_hook_fails_closed_even_in_dev_mode(bad_hook):
    runs: list[str] = []
    server = _probe_server(runs, context_hook=bad_hook, dev_mode=True)
    async with Client(server._create_mcp_server()) as client:
        res = await client.call_tool("context-probe", {})
    assert res.is_error is True
    parsed = body(res)
    assert parsed["success"] is False
    assert parsed["error"]["code"] == "INTERNAL_ERROR"
    assert parsed["error"]["retryable"] is True
    assert "secret internal stack details" not in json.dumps(parsed)
    assert runs == []


# ═══════════════════════════════════════════════════════════════════════════════
# EVERY ROUTE, ONCE PER CALL, NOT ON DISCOVERY / EXECUTE
# ═══════════════════════════════════════════════════════════════════════════════


async def test_every_route_runs_with_hook_actor_and_calls_hook_once():
    runs: list[str] = []
    hook_calls: list[str] = []

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        hook_calls.append(req.tool)
        ctx.actor = Actor(kind="service", id=f"caller:{req.tool}")
        ctx.extra["tag"] = "from-hook"
        return ctx

    server = _probe_server(runs, tool_strategy="grouped", context_hook=hook)
    # server.execute() is the trusted host API: the hook does not run.
    direct = await server.execute("context-probe", {})
    assert direct.success is True
    assert direct.data["actor"] is None
    assert hook_calls == []

    async with Client(server._create_mcp_server()) as client:
        # tools/list and server/discover never call the hook.
        await client.list_tools()
        assert hook_calls == []

        # 1. Direct unlisted command called by name
        r1 = body(await client.call_tool("context-probe", {}))
        assert r1["data"]["actor"] == {"kind": "service", "id": "caller:context-probe"}
        assert r1["data"]["extra"]["tag"] == "from-hook"

        # 2. Grouped tool
        r2 = body(await client.call_tool("context", {"action": "probe", "params": {}}))
        assert r2["data"]["actor"] == {"kind": "service", "id": "caller:context"}

        # 3. afd-call
        r3 = body(await client.call_tool("afd-call", {"command": "context-probe"}))
        assert r3["data"]["actor"] == {"kind": "service", "id": "caller:afd-call"}

        # 4. afd-batch (2 items, hook runs ONCE)
        r4 = body(
            await client.call_tool(
                "afd-batch",
                {"commands": [{"command": "context-probe"}, {"command": "context-probe"}]},
            )
        )
        for item in r4["results"]:
            assert item["result"]["data"]["actor"] == {"kind": "service", "id": "caller:afd-batch"}
            assert item["result"]["data"]["extra"]["tag"] == "from-hook"

        # 5. afd-pipe (2 steps, hook runs ONCE)
        r5 = body(
            await client.call_tool(
                "afd-pipe",
                {"steps": [{"command": "context-probe"}, {"command": "context-probe"}]},
            )
        )
        for step in r5["steps"]:
            assert step["data"]["actor"] == {"kind": "service", "id": "caller:afd-pipe"}
            assert step["data"]["extra"]["tag"] == "from-hook"

        # 6. afd-discover, afd-detail, unknown tool
        await client.call_tool("afd-discover", {})
        await client.call_tool("afd-detail", {"commands": ["context-probe"]})
        await client.call_tool("no-such-tool", {})

    assert hook_calls == [
        "context-probe",
        "context",
        "afd-call",
        "afd-batch",
        "afd-pipe",
        "afd-discover",
        "afd-detail",
        "no-such-tool",
    ]
    assert len(runs) == 8  # 1 direct execute + 7 MCP executions


# ═══════════════════════════════════════════════════════════════════════════════
# SERVER INVARIANTS & DECLARED CONTEXT FIELDS
# ═══════════════════════════════════════════════════════════════════════════════


async def test_hook_cannot_drop_server_invariants_or_smuggle_direct_tokens():
    runs: list[str] = []

    def blank_and_sneaky_hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        # Try to clear actor/trace_id/clock/random, override interface/remote/active_context,
        # and attach DirectClient internal tokens.
        return CommandContext(
            trace_id="",
            actor=None,
            clock=None,
            random=None,
            extra={
                "interface": "cli",
                "remote": False,
                "active_context": "review",
                "host_note": "kept",
            },
            _direct_allow=lambda _name: True,
            _direct_approval="forged",
        )

    server = _probe_server(
        runs,
        context_hook=blank_and_sneaky_hook,
        actor=Actor(kind="service", id="default-svc"),
        clock=fixed_clock(1_700_000_000_000),
        random=seeded_random("seed"),
        contexts=[ContextConfig(name="planning"), ContextConfig(name="review")],
    )

    @server.command(
        name="review-only",
        description="Only in review context",
        contexts=["review"],
        expose=MCP,
    )
    async def review_only(input: Any, context: CommandContext):
        return success({"ok": True})

    async with Client(server._create_mcp_server()) as client:
        res = body(await client.call_tool("context-probe", {}))
        assert res["data"]["actor"] == {"kind": "service", "id": "default-svc"}
        assert res["data"]["interface"] == "mcp"
        assert res["data"]["remote"] is True
        assert res["data"]["activeContext"] is None
        assert isinstance(res["data"]["traceId"], str) and res["data"]["traceId"]
        assert res["data"]["extra"]["host_note"] == "kept"
        assert res["data"]["hasDirectAllow"] is False
        assert res["data"]["hasDirectApproval"] is False
        assert res["data"]["now"] == 1_700_000_000_000

        # Private command stays COMMAND_NOT_FOUND (D4), never COMMAND_NOT_EXPOSED.
        for tool, args in (
            ("secret-rotate", {}),
            ("afd-call", {"command": "secret-rotate"}),
        ):
            hidden = body(await client.call_tool(tool, args))
            assert hidden["error"]["code"] == "COMMAND_NOT_FOUND"

        # Hook's active_context="review" is ignored; request _meta["dev.afd/context"] wins.
        denied = body(
            await client.call_tool("review-only", {}, meta={"dev.afd/context": "planning"})
        )
        assert denied["error"]["code"] == "COMMAND_NOT_IN_CONTEXT"
        allowed = body(
            await client.call_tool("review-only", {}, meta={"dev.afd/context": "review"})
        )
        assert allowed["success"] is True


async def test_declared_context_fields_hidden_from_hook_and_hook_wins():
    """spec/context-fields.md: the hook does not see caller-sent _meta fields, and
    values set by the hook (including explicit None) win over caller _meta and the
    meta-tools' ``meta`` argument."""
    runs: list[str] = []
    hook_saw_extra: list[dict[str, Any]] = []

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        hook_saw_extra.append(dict(ctx.extra))
        # Override scope with trusted host value; explicitly clear locale to None.
        ctx.extra["scope"] = {"project": "trusted-host"}
        ctx.extra["locale"] = None
        return ctx

    fields = [
        ContextField(name="scope", meta="dev.example/scope", schema=Scope),
        ContextField(name="locale", meta="dev.example/locale", schema=str),
        ContextField(name="region", meta="dev.example/region", schema=str),
    ]
    server = _probe_server(runs, context_hook=hook, context_fields=fields)

    caller_meta = {
        "dev.example/scope": {"project": "spoofed"},
        "dev.example/locale": "fr-FR",
        "dev.example/region": "us-west",
    }
    async with Client(server._create_mcp_server()) as client:
        direct = body(await client.call_tool("context-probe", {}, meta=caller_meta))
        via_meta_arg = body(
            await client.call_tool(
                "afd-call",
                {"command": "context-probe", "meta": caller_meta},
            )
        )

    assert hook_saw_extra == [{}, {}]
    for res in (direct, via_meta_arg):
        assert res["success"] is True
        assert res["data"]["extra"]["scope"] == {"project": "trusted-host"}
        assert res["data"]["extra"]["locale"] is None
        assert res["data"]["extra"]["region"] == "us-west"


# ═══════════════════════════════════════════════════════════════════════════════
# PRINCIPAL BINDING (#532, #800, spec/authorization.md M8)
# ═══════════════════════════════════════════════════════════════════════════════


async def test_confirmation_state_binds_hook_actor_on_one_shared_server():
    """On a single server instance with no SDK tokens, a hook separates callers by actor:
    Caller A's confirmation ``requestState`` is refused as tampered (-32602) when presented
    by Caller B, even before any handler runs."""
    runs: list[str] = []

    class ActorHeaderMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            # Trusted gateway verified identity placed into request.state.
            request.state.caller = {
                "kind": request.headers.get("x-caller-kind", "agent"),
                "id": request.headers.get("x-caller-id"),
                "label": request.headers.get("x-caller-label"),
                "on_behalf_of": request.headers.get("x-caller-obo"),
            }
            return await call_next(request)

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        caller = req.http_request.state.caller
        ctx.actor = Actor(
            kind=caller["kind"],
            id=caller["id"],
            label=caller["label"],
            on_behalf_of=caller["on_behalf_of"],
        )
        return ctx

    # Middleware that mutates context.actor in place must NOT affect the snapshotted
    # principal binding of confirmation state.
    async def mutating_mw(name, input, context, next_fn):
        if context.actor is not None:
            context.actor.id = "mutated-in-middleware"
        return await next_fn()

    server = _probe_server(
        runs,
        context_hook=hook,
        middleware=[mutating_mw],
        confirmations="enforce",
        confirmation_key=KEY,
    )

    alice = {
        "x-caller-kind": "agent",
        "x-caller-id": "agent-a",
        "x-caller-label": "Agent A",
        "x-caller-obo": "user-1",
    }
    accept = {"confirm": {"action": "accept", "content": {"confirm": True}}}

    async with _http_client(server, asgi_middleware=ActorHeaderMiddleware) as http:
        asked = await _modern_http_post(http, "todo-clear", headers=alice)
        assert asked["result"]["resultType"] == "input_required"
        state = asked["result"]["requestState"]

        # Reference refusal: tampered state.
        tampered = await _modern_http_post(
            http,
            "todo-clear",
            headers=alice,
            request_state=state[:-2] + "xx",
            input_responses=accept,
            expected_status=400,
        )
        assert tampered["error"]["code"] == -32602

        # Different id, different on_behalf_of, different kind -> identical refusal.
        for other in (
            {**alice, "x-caller-id": "agent-b"},
            {**alice, "x-caller-obo": "user-2"},
            {**alice, "x-caller-kind": "human"},
        ):
            refused = await _modern_http_post(
                http,
                "todo-clear",
                headers=other,
                request_state=state,
                input_responses=accept,
                expected_status=400,
            )
            assert refused["error"] == tampered["error"], other
        assert runs == []

        # Same principal with changed label only -> accepted!
        same_renamed = {**alice, "x-caller-label": "Renamed"}
        ok_rpc = await _modern_http_post(
            http,
            "todo-clear",
            headers=same_renamed,
            request_state=state,
            input_responses=accept,
        )
        ok = _http_command_result(ok_rpc)
        assert ok["success"] is True
        assert runs == ["clear:mutated-in-middleware"]


async def test_hook_actor_and_sdk_token_both_bind_principal_and_incomplete_token_fails_closed():
    """When both ``context_hook`` and an SDK-verified access token are present, both
    bind ``requestState``; an incomplete token fails closed with INTERNAL_ERROR."""
    from mcp.server.auth.middleware.auth_context import auth_context_var
    from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
    from mcp.server.auth.provider import AccessToken
    from mcp_types import INTERNAL_ERROR

    current_actor = [Actor(kind="agent", id="alice")]

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = current_actor[0]
        return ctx

    runs: list[str] = []
    server = _probe_server(runs, context_hook=hook, confirmations="enforce", confirmation_key=KEY)
    sdk = server._create_mcp_server()

    def set_token(issuer: str | None, subject: str | None, client_id: str):
        token = AccessToken(
            token="opaque",
            client_id=client_id,
            scopes=["todo:write"],
            subject=subject,
            claims={} if issuer is None else {"iss": issuer},
        )
        return auth_context_var.set(AuthenticatedUser(token))

    reset = set_token("https://auth.example.com", "user-1", "client-1")
    try:
        async with Client(sdk, elicitation_callback=_answer("accept")) as client:
            asked = await client.session.call_tool("todo-clear", {}, allow_input_required=True)
            state = asked.request_state
            # Reference tampered refusal.
            with pytest.raises(MCPError) as tampered_exc:
                await client.session.call_tool(
                    "todo-clear",
                    {},
                    input_responses=ACCEPT_CONFIRM,
                    request_state=state[:-2] + "xx",
                    allow_input_required=True,
                )
            # Same token, different hook actor -> rejected as tampered.
            current_actor[0] = Actor(kind="agent", id="bob")
            with pytest.raises(MCPError) as wrong_actor_exc:
                await client.session.call_tool(
                    "todo-clear",
                    {},
                    input_responses=ACCEPT_CONFIRM,
                    request_state=state,
                    allow_input_required=True,
                )
            assert wrong_actor_exc.value.code == tampered_exc.value.code == -32602
    finally:
        auth_context_var.reset(reset)

    # Same hook actor, incomplete SDK token -> INTERNAL_ERROR naming no one.
    current_actor[0] = Actor(kind="agent", id="alice")
    reset = set_token(None, "user-1", "client-1")
    try:
        async with Client(sdk, elicitation_callback=_answer("accept")) as client:
            with pytest.raises(MCPError) as incomplete_exc:
                await client.session.call_tool(
                    "todo-clear",
                    {},
                    input_responses=ACCEPT_CONFIRM,
                    request_state=state,
                    allow_input_required=True,
                )
            assert incomplete_exc.value.code == INTERNAL_ERROR
            assert str(incomplete_exc.value) == "Internal error"
            assert "alice" not in str(incomplete_exc.value)
            assert "user-1" not in str(incomplete_exc.value)
    finally:
        auth_context_var.reset(reset)
    assert runs == []


async def test_approval_relay_state_binds_hook_actor_and_2025_in_band_runs_hook_once():
    """Approval relay (``relay="mcp-elicitation"``):
    - On 2026-07-28, Caller A's approval ``requestState`` cannot be replayed by Caller B.
    - On 2025 legacy connections with in-band elicitation, the hook runs ONCE for the
      whole ``tools/call``, not once per internal retry round."""
    holder: dict[str, Any] = {}
    hook_calls = 0
    current_actor = [Actor(kind="agent", id="alice")]

    async def approval_mw(name, input, context, next_fn):
        if "mw" not in holder:
            holder["mw"] = create_approval_middleware(
                secret=SECRET,
                commands=server.list_commands(),
                relay="mcp-elicitation",
                include_token=False,
            )
        return await holder["mw"](name, input, context, next_fn)

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        nonlocal hook_calls
        hook_calls += 1
        ctx.actor = current_actor[0]
        return ctx

    runs: list[str] = []
    server = create_server(
        "relay-hook",
        tool_strategy="individual",
        middleware=[approval_mw],
        context_hook=hook,
        confirmation_key=KEY,
    )

    @server.command(
        name="todo-nuke",
        description="Approval-gated action",
        mutation=True,
        approval="required",
        expose=MCP,
    )
    async def nuke(input: Any, context: CommandContext):
        runs.append(context.actor.id if context.actor else "none")
        return success({"actorId": context.actor.id if context.actor else None})

    sdk = server._create_mcp_server()
    # 2026-07-28: Alice gets approval requestState; Bob cannot replay it; Alice succeeds.
    async with Client(
        sdk, mode="auto", elicitation_callback=_answer("accept", field="approve")
    ) as client:
        asked = await client.session.call_tool("todo-nuke", {}, allow_input_required=True)
        assert type(asked).__name__ == "InputRequiredResult"
        state = asked.request_state

        current_actor[0] = Actor(kind="agent", id="bob")
        with pytest.raises(MCPError) as bob_exc:
            await client.session.call_tool(
                "todo-nuke",
                {},
                input_responses={
                    "approval": types.ElicitResult(action="accept", content={"approve": True})
                },
                request_state=state,
                allow_input_required=True,
            )
        assert bob_exc.value.code == -32602
        assert runs == []

        current_actor[0] = Actor(kind="agent", id="alice")
        approved = await client.session.call_tool(
            "todo-nuke",
            {},
            input_responses={
                "approval": types.ElicitResult(action="accept", content={"approve": True})
            },
            request_state=state,
            allow_input_required=True,
        )
        assert body(approved)["success"] is True
        assert body(approved)["data"] == {"actorId": "alice"}

    # 2025 legacy in-band elicitation: hook runs ONCE despite two internal route rounds.
    hook_calls = 0
    async with Client(
        sdk, mode="legacy", elicitation_callback=_answer("accept", field="approve")
    ) as client:
        res = await client.call_tool("todo-nuke", {})
    assert body(res)["success"] is True
    assert body(res)["data"] == {"actorId": "alice"}
    assert hook_calls == 1
    assert runs == ["alice", "alice"]


async def test_concurrent_http_calls_do_not_bleed_hook_context():
    """Concurrent requests with different actors stay completely isolated via ContextVar."""
    runs: list[str] = []

    async def slow_hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        caller_id = req.header("x-caller-id") or "unknown"
        await asyncio.sleep(0.02 if caller_id == "alice" else 0.005)
        ctx.actor = Actor(kind="service", id=caller_id)
        ctx.extra["caller"] = caller_id
        return ctx

    server = _probe_server(runs, context_hook=slow_hook)
    async with _http_client(server) as http:
        alice_rpc, bob_rpc = await asyncio.gather(
            _modern_http_post(http, "context-probe", headers={"x-caller-id": "alice"}),
            _modern_http_post(http, "context-probe", headers={"x-caller-id": "bob"}),
        )
    alice = _http_command_result(alice_rpc)
    bob = _http_command_result(bob_rpc)
    assert alice["data"]["actor"] == {"kind": "service", "id": "alice"}
    assert alice["data"]["extra"]["caller"] == "alice"
    assert bob["data"]["actor"] == {"kind": "service", "id": "bob"}
    assert bob["data"]["extra"]["caller"] == "bob"


def test_authorization_principal_binding_vectors_match_hook_actors():
    """Every ``principalBindings`` vector in ``spec/authorization.json`` produces the exact
    binding when the actor comes from ``context_hook``."""
    from mcp.server.auth.middleware.auth_context import auth_context_var
    from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
    from mcp.server.auth.provider import AccessToken

    from afd.server.context_hook import HookOutcome, bind_hook_outcome

    cases = json.loads(
        (Path(__file__).resolve().parents[2] / "spec" / "authorization.json").read_text(
            encoding="utf-8"
        )
    )["principalBindings"]

    server = _probe_server([])
    for case in cases:
        raw_actor = case["actor"]
        actor = (
            Actor(
                kind=raw_actor["kind"],
                id=raw_actor.get("id"),
                label=raw_actor.get("label"),
                on_behalf_of=raw_actor.get("onBehalfOf"),
            )
            if raw_actor is not None
            else None
        )
        raw_creds = case["credentials"]
        reset = None
        if raw_creds is not None:
            token = AccessToken(
                token="opaque",
                client_id=raw_creds["clientId"],
                scopes=[],
                subject=raw_creds["subject"],
                claims={"iss": raw_creds["issuer"]},
            )
            reset = auth_context_var.set(AuthenticatedUser(token))
        try:
            # MCP calls always carry a resolved actor (with_context_defaults fills the
            # server default when the hook leaves actor=None); the actor=None vector is
            # covered directly in tests/test_principal_binding.py.
            if actor is not None:
                with bind_hook_outcome(HookOutcome(actor_at_start=actor)):
                    assert server._request_principal() == case["binding"], case["description"]
        finally:
            if reset is not None:
                auth_context_var.reset(reset)


async def test_legacy_connection_keeps_context_stack_with_a_hook():
    """On a 2025 connection with contexts, ``afd-context-enter``/``-exit`` keeps its
    session stack while every call runs with the hook's actor."""
    runs: list[str] = []

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = Actor(kind="human", id="stdio-user")
        return ctx

    server = _probe_server(
        runs,
        context_hook=hook,
        contexts=[ContextConfig(name="planning"), ContextConfig(name="review")],
    )

    @server.command(
        name="review-probe",
        description="Only in review",
        contexts=["review"],
        expose=MCP,
    )
    async def review_probe(input: Any, context: CommandContext):
        return success({"actorId": context.actor.id if context.actor else None})

    async with Client(server._create_mcp_server(), mode="legacy") as client:
        entered = body(await client.call_tool("afd-context-enter", {"context": "planning"}))
        assert entered["success"] is True
        denied = body(await client.call_tool("afd-call", {"command": "review-probe"}))
        assert denied["error"]["code"] == "COMMAND_NOT_IN_CONTEXT"
        exited = body(await client.call_tool("afd-context-exit", {}))
        assert exited["success"] is True
        allowed = body(await client.call_tool("afd-call", {"command": "review-probe"}))
        assert allowed["success"] is True
        assert allowed["data"] == {"actorId": "stdio-user"}


async def test_direct_sdk_call_tool_outside_runner_still_runs_hook():
    """Even if a caller invokes ``sdk.call_tool`` directly without going through
    ``ServerRunner`` middleware, ``context_hook`` still runs and fails closed."""
    runs: list[str] = []

    def refuse(req: ContextHookRequest, ctx: CommandContext):
        return CommandError(code="UNAUTHORIZED", message="Denied")

    server = _probe_server(runs, context_hook=refuse)
    sdk = server._create_mcp_server()
    result = await sdk.call_tool("context-probe", {})
    assert result.is_error is True
    assert body(result)["error"]["code"] == "UNAUTHORIZED"
    assert runs == []


async def test_hybrid_strategy_routes_run_with_hook_actor():
    """Under ``hybrid``, both first-class tools and unlisted commands run with the hook."""
    runs: list[str] = []

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = Actor(kind="service", id=f"hybrid:{req.tool}")
        return ctx

    server = _probe_server(
        runs,
        tool_strategy="hybrid",
        first_class_tools=["context-probe"],
        context_hook=hook,
    )
    async with Client(server._create_mcp_server()) as client:
        first_class = body(await client.call_tool("context-probe", {}))
        assert first_class["data"]["actor"] == {"kind": "service", "id": "hybrid:context-probe"}
        unlisted = body(await client.call_tool("todo-clear", {}))
        assert unlisted["data"]["actorId"] == "hybrid:todo-clear"


async def test_malformed_tools_call_with_request_state_runs_hook_before_boundary():
    """A malformed ``tools/call`` (missing ``name``) carrying a bogus ``requestState``
    still runs ``context_hook`` and strips ``requestState`` on refusal, so the boundary
    cannot act as a ``requestState`` / ``IncompleteCredentials`` oracle."""
    seen: list[str] = []

    def refuse(req: ContextHookRequest, ctx: CommandContext):
        seen.append(req.tool)
        return CommandError(code="UNAUTHORIZED", message="Authentication is required")

    server = _probe_server([], context_hook=refuse, confirmations="enforce", confirmation_key=KEY)
    async with _http_client(server) as http:
        resp = await http.post(
            "/mcp",
            headers={
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
                "MCP-Protocol-Version": MODERN,
                "Mcp-Method": "tools/call",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "arguments": {},
                    "requestState": "bogus-state",
                    "_meta": MODERN_META,
                },
            },
        )
    # Hook ran before RequestStateBoundary; SDK rejects missing `name` with INVALID_PARAMS
    # rather than `invalid_request_state`.
    assert seen == [""]
    data = resp.json()
    assert data["error"]["code"] == -32602
    assert data["error"].get("data") != {"reason": "invalid_request_state"}


async def test_nested_extra_containers_are_isolated_across_batch_and_pipeline_steps():
    """In-place mutation of nested dicts/lists in ``context.extra`` in one batch item
    (``parallelism > 1``) or pipeline step must not bleed into siblings."""

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = Actor(kind="service", id="alice")
        ctx.extra["claims"] = {"roles": ["reader"]}
        return ctx

    server = create_server("iso-test", tool_strategy="individual", context_hook=hook)

    @server.command(name="claim-mutate", description="Mutate nested extra", expose=MCP)
    async def mutate(input: Any, context: CommandContext):
        before = list(context.extra["claims"]["roles"])
        context.extra["claims"]["roles"].append("mutated")
        return success({"before": before})

    async with Client(server._create_mcp_server()) as client:
        batch = body(
            await client.call_tool(
                "afd-batch",
                {
                    "commands": [{"command": "claim-mutate"}, {"command": "claim-mutate"}],
                    "options": {"parallelism": 2},
                },
            )
        )
        assert [item["result"]["data"]["before"] for item in batch["results"]] == [
            ["reader"],
            ["reader"],
        ]

        pipe = body(
            await client.call_tool(
                "afd-pipe",
                {"steps": [{"command": "claim-mutate"}, {"command": "claim-mutate"}]},
            )
        )
        assert [step["data"]["before"] for step in pipe["steps"]] == [["reader"], ["reader"]]


async def test_up_front_batch_approval_binds_hook_actor():
    """Up-front ``afd-batch`` approval relay binds the hook's actor so another caller
    cannot replay the batch's sealed ``requestState``."""
    holder: dict[str, Any] = {}
    current_actor = [Actor(kind="agent", id="alice")]

    async def approval_mw(name, input, context, next_fn):
        if "mw" not in holder:
            holder["mw"] = create_approval_middleware(
                secret=SECRET,
                commands=server.list_commands(),
                relay="mcp-elicitation",
                include_token=False,
            )
        return await holder["mw"](name, input, context, next_fn)

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = current_actor[0]
        return ctx

    runs: list[str] = []
    server = create_server(
        "batch-relay-hook",
        tool_strategy="individual",
        middleware=[approval_mw],
        context_hook=hook,
        confirmation_key=KEY,
    )

    @server.command(
        name="todo-nuke",
        description="Approval-gated action",
        mutation=True,
        approval="required",
        expose=MCP,
    )
    async def nuke(input: Any, context: CommandContext):
        runs.append(context.actor.id if context.actor else "none")
        return success({"actorId": context.actor.id if context.actor else None})

    sdk = server._create_mcp_server()
    batch_args = {"commands": [{"command": "todo-nuke", "input": {}}]}
    async with Client(
        sdk, mode="auto", elicitation_callback=_answer("accept", field="approve")
    ) as client:
        asked = await client.session.call_tool("afd-batch", batch_args, allow_input_required=True)
        assert type(asked).__name__ == "InputRequiredResult"
        state = asked.request_state

        current_actor[0] = Actor(kind="agent", id="bob")
        with pytest.raises(MCPError) as bob_exc:
            await client.session.call_tool(
                "afd-batch",
                batch_args,
                input_responses={
                    "approval": types.ElicitResult(action="accept", content={"approve": True})
                },
                request_state=state,
                allow_input_required=True,
            )
        assert bob_exc.value.code == -32602
        assert runs == []

        current_actor[0] = Actor(kind="agent", id="alice")
        approved = await client.session.call_tool(
            "afd-batch",
            batch_args,
            input_responses={
                "approval": types.ElicitResult(action="accept", content={"approve": True})
            },
            request_state=state,
            allow_input_required=True,
        )
        assert body(approved)["success"] is True
        assert body(approved)["results"][0]["result"]["data"] == {"actorId": "alice"}
    assert runs == ["alice"]


async def test_journal_records_hook_actor_and_trace_id_and_ignores_smuggled_journal_marker():
    """``create_journal_middleware`` records the hook's actor and trace ID, and any
    smuggled ``_afd_journaled_context_fields`` in hook ``extra`` is stripped."""
    from afd import MemoryJournalSink
    from afd.server import create_journal_middleware
    from afd.server.context_fields import JOURNALED_CONTEXT_FIELDS

    sink = MemoryJournalSink()

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = Actor(kind="service", id="svc-journal", on_behalf_of="user-9")
        ctx.trace_id = "hook-trace-42"
        ctx.extra[JOURNALED_CONTEXT_FIELDS] = ("secret",)
        ctx.extra["secret"] = "never-journal"
        return ctx

    server = _probe_server(
        [],
        context_hook=hook,
        middleware=[create_journal_middleware(sink)],
    )
    async with Client(server._create_mcp_server()) as client:
        res = body(await client.call_tool("context-probe", {}))
    assert res["success"] is True
    assert JOURNALED_CONTEXT_FIELDS not in res["data"]["extra"]
    entries = await sink.read()
    assert len(entries) == 1
    entry = entries[0]
    assert entry.actor is not None
    assert entry.actor.kind == "service"
    assert entry.actor.id == "svc-journal"
    assert entry.actor.on_behalf_of == "user-9"
    assert entry.trace_id == "hook-trace-42"
    assert entry.context is None
