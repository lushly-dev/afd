"""The language-neutral vectors in spec/vectors/idempotency.json: idempotency keys
(spec/idempotency.md), every section, against the Python server.

- ``declaration``: the command's tool ``_meta.idempotency`` and its ``idempotentHint`` annotation.
- ``key.form`` and ``key.derived``: K2's form and K4's derived keys.
- ``key.delivery``: a key sent each way K1 names (over MCP in ``_meta`` and in ``afd-call``'s
  ``meta`` argument; on the context in process) reaching the handler.
- ``step``: the engine's step on one server with one store and the harness's clock. Calls are in
  process (the tool router, as an MCP lane runs it) unless the case names an HTTP or stdio
  surface. Python's engine cancels the handler at the call's deadline, so the ``cancels`` case
  runs and the ``continues``, ``waits`` and ``drops`` cases are another engine's.
- ``step.options``, ``retry``, ``timeoutRecovery`` and ``journal``.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("mcp")

import httpx  # noqa: E402
from mcp import Client  # noqa: E402
from mcp.client._memory import InMemoryTransport  # noqa: E402

from afd import (  # noqa: E402
    Actor,
    CommandResult,
    ExposeOptions,
    MemoryJournalSink,
    error,
    success,
)
from afd.core.commands import CommandContext, CommandDefinition  # noqa: E402
from afd.core.idempotency import derive_idempotency_key, is_idempotency_key  # noqa: E402
from afd.core.journal import canonical_json  # noqa: E402
from afd.core.result import ResultMetadata  # noqa: E402
from afd.core.wire import to_wire  # noqa: E402
from afd.server import (  # noqa: E402
    ContextField,
    IdempotencyOptions,
    InMemoryIdempotencyStore,
    TaskOptions,
    create_idempotency_step,
    create_journal_middleware,
    create_retry_middleware,
    create_server,
    replay_journal,
)
from afd.server.approval import _canonical_or_none  # noqa: E402
from afd.server.approval_admission import admit_approval  # noqa: E402
from afd.server.idempotency_store import (  # noqa: E402
    IdempotencyReservationRequest,
    IdempotencySettlement,
)
from afd.server.principal import principal_binding  # noqa: E402
from tests.test_tasks import _poll_until_done, _tasks_extension  # noqa: E402

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "idempotency.json").read_text(
        encoding="utf-8"
    )
)
META_KEY: str = VECTORS["metaKey"]
MCP = ExposeOptions(mcp=True)
MODERN = "2026-07-28"
ENGINE = "cancels"
"""The engine Python's is (S7): it cancels the handler at the call's deadline."""


def named(cases: list[dict[str, Any]]) -> list[Any]:
    return [pytest.param(case, id=case["description"]) for case in cases]


def wire(value: Any) -> Any:
    """A result as its wire JSON."""
    return to_wire(value) if hasattr(value, "model_dump") else value


def tool_value(result: Any) -> dict[str, Any]:
    return json.loads(result.content[0].text)


def test_python_is_no_longer_a_documented_gap():
    assert "python" not in VECTORS["gaps"]
    assert META_KEY == "dev.afd/idempotencyKey"


# ═══════════════════════════════════════════════════════════════════════════════
# DECLARATION (D1, D2)
# ═══════════════════════════════════════════════════════════════════════════════


async def _ok(input: Any, context: Any = None) -> CommandResult[Any]:
    return success({})


@pytest.mark.parametrize("case", named(VECTORS["declaration"]["cases"]))
def test_declaration(case):
    server = create_server("declaration", tool_strategy="individual")
    server.register(
        CommandDefinition(
            name="thing-do", description="Does a thing", handler=_ok, expose=MCP, **case["command"]
        )
    )
    tool = next(t for t in server.get_tool_definitions() if t["name"] == "thing-do")
    expect = case["expect"]
    assert (tool.get("_meta") or {}).get("idempotency") == expect["metaIdempotency"]
    assert (tool.get("annotations") or {}).get("idempotentHint") == expect["idempotentHint"]


# ═══════════════════════════════════════════════════════════════════════════════
# THE KEY (K1 to K6)
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("case", named(VECTORS["key"]["form"]))
def test_key_form(case):
    key = case["repeat"] * case["times"] if "repeat" in case else case["key"]
    assert is_idempotency_key(key) is case["valid"]


@pytest.mark.parametrize(
    "case",
    [
        pytest.param(c, id=f"{c['base']} {c['kind']} {c['index']}")
        for c in VECTORS["key"]["derived"]
    ],
)
def test_key_derived(case):
    assert derive_idempotency_key(case["base"], case["kind"], case["index"]) == case["expected"]


def _delivery_server() -> tuple[Any, list[str | None], list[str | None]]:
    """A server whose ``note-read`` notes the key its handler reads, and can nest once."""
    seen: list[str | None] = []
    nested_seen: list[str | None] = []
    server = create_server("delivery", tool_strategy="individual")

    async def note_read(input: Any, context: CommandContext) -> CommandResult[Any]:
        key = context.idempotency_key
        if input.get("nest") is False:
            nested_seen.append(key)
            return success({"nested": True})
        seen.append(key)
        if input.get("nest") is True:
            # K6: the same command once more through the registry, on this very context.
            await server.route_tool_call(
                "afd-call",
                {"command": "note-read", "input": {"nest": False}},
                caller_context=context,
            )
        return success({"key": key})

    server.register(
        CommandDefinition(
            name="note-read",
            description="Reads a note",
            handler=note_read,
            expose=MCP,
            input_schema={
                "type": "object",
                "properties": {
                    "nest": {"type": "boolean"},
                    "idempotencyKey": {"type": "string"},
                },
            },
        )
    )
    return server, seen, nested_seen


@pytest.mark.parametrize("case", named(VECTORS["key"]["delivery"]))
async def test_key_delivery(case):
    server, seen, nested_seen = _delivery_server()
    has_key = "key" in case or case.get("keyIsNull") is True
    meta = {META_KEY: case.get("key")} if has_key else {}
    command_input = {"nest": True} if case.get("nested") else {}
    kind = case.get("kind")
    via = case["via"]
    if kind in ("batch", "pipeline"):
        steps = [{"command": "note-read", "input": {}} for _ in range(case["items"])]
        async with Client(server._create_mcp_server()) as client:
            if kind == "batch":
                result = await client.call_tool("afd-batch", {"commands": steps}, meta=meta)
            else:
                result = await client.call_tool("afd-pipe", {"steps": steps}, meta=meta)
        value = tool_value(result)
    elif via == "meta":
        async with Client(server._create_mcp_server()) as client:
            value = tool_value(await client.call_tool("note-read", command_input, meta=meta))
    elif via == "meta-argument":
        async with Client(server._create_mcp_server()) as client:
            value = tool_value(
                await client.call_tool(
                    "afd-call", {"command": "note-read", "input": command_input, "meta": meta}
                )
            )
    elif via == "context":
        value = wire(
            await server.route_tool_call(
                "afd-call",
                {"command": "note-read", "input": command_input},
                caller_context=CommandContext(idempotency_key=case["key"]),
            )
        )
    else:
        # `input`: a member named like the key is input, never the key.
        value = wire(
            await server.route_tool_call(
                "afd-call",
                {"command": "note-read", "input": {"idempotencyKey": case["key"]}},
                caller_context=CommandContext(),
            )
        )
    expect = case["expect"]
    if "success" in expect:
        assert value["success"] is expect["success"], value
    if "code" in expect:
        assert value["error"]["code"] == expect["code"]
    if "handlerRuns" in expect:
        assert len(seen) == expect["handlerRuns"]
    if "detailsMeta" in expect:
        assert value["error"]["details"]["meta"] == expect["detailsMeta"]
    if "handlerSeesKey" in expect:
        assert seen == [expect["handlerSeesKey"]]
    if "handlerSeesKeys" in expect:
        assert seen == expect["handlerSeesKeys"]
    if "nestedHandlerSeesKey" in expect:
        assert nested_seen == [expect["nestedHandlerSeesKey"]]


# ═══════════════════════════════════════════════════════════════════════════════
# THE ENGINE'S STEP (S1 to S13)
# ═══════════════════════════════════════════════════════════════════════════════

SETUP = VECTORS["step"]["setup"]
ACTORS = {name: Actor(**actor) for name, actor in SETUP["actors"].items()}
ORDER_SCHEMA = {
    "type": "object",
    "properties": {"sku": {"type": "string"}, "count": {"type": "integer"}},
    "required": ["sku"],
    # Keeps members it does not name, as TypeScript's loose object does, so an input with no
    # canonical form reaches the step (S4).
    "additionalProperties": True,
}


class HarnessStore:
    """The default store, with hooks to hold a reservation and to see settles."""

    def __init__(self) -> None:
        self.inner = InMemoryIdempotencyStore()
        self.hold_reserve: tuple[asyncio.Event, asyncio.Event] | None = None
        self._watch: asyncio.Event | None = None
        self._watched: dict[str, asyncio.Event] = {}

    async def _held_reserve(
        self, hold: tuple[asyncio.Event, asyncio.Event], scope: str, request: Any, now: float
    ) -> Any:
        entered, release = hold
        entered.set()
        await release.wait()
        return self._reserve(scope, request, now)

    def reserve(self, scope: str, request: IdempotencyReservationRequest, now: float) -> Any:
        hold = self.hold_reserve
        if hold is not None:
            self.hold_reserve = None
            return self._held_reserve(hold, scope, request, now)
        return self._reserve(scope, request, now)

    def _reserve(self, scope: str, request: Any, now: float) -> Any:
        outcome = self.inner.reserve(scope, request, now)
        if outcome.reserved and self._watch is not None:
            self._watched[outcome.reservation] = self._watch
            self._watch = None
        return outcome

    def complete(self, scope: str, reservation: str, settlement: IdempotencySettlement) -> None:
        self.inner.complete(scope, reservation, settlement)
        self._settled(reservation)

    def release(self, scope: str, reservation: str) -> None:
        self.inner.release(scope, reservation)
        self._settled(reservation)

    def get(self, scope: str, now: float) -> Any:
        return self.inner.get(scope, now)

    def next_settle(self) -> asyncio.Event:
        """Set when the next reservation made, and no other, is completed or released."""
        self._watch = asyncio.Event()
        return self._watch

    def _settled(self, reservation: str) -> None:
        watched = self._watched.pop(reservation, None)
        if watched is not None:
            watched.set()


class Harness:
    def __init__(self) -> None:
        self.now = 0.0
        self.starts = 0
        self.store = HarnessStore()
        self.approved = False
        self.hold: tuple[asyncio.Event, asyncio.Event] | None = None
        self.outlive: asyncio.Event | None = None
        self.flaky_failed = False

    def clock(self) -> Any:
        harness = self

        class _Clock:
            def now(self) -> float:
                return harness.now

        return _Clock()


def _failure(code: str, retryable: bool) -> CommandResult[Any]:
    return error(code, f"{code} from the handler", suggestion="Retry", retryable=retryable)


def _commands(h: Harness) -> list[CommandDefinition]:
    async def place(input: Any = None, context: Any = None) -> CommandResult[Any]:
        """order-place: ``{ placed: n }``, n counted when the handler starts."""
        h.starts += 1
        placed = h.starts
        hold = h.hold
        if hold is not None:
            h.hold = None
            started, release = hold
            started.set()
            await release.wait()
        if h.outlive is not None:
            # Outlives the call's deadline: the engine cancels it there (S7).
            await h.outlive.wait()
        return success({"placed": placed})

    async def refuse(input: Any, context: Any) -> CommandResult[Any]:
        h.starts += 1
        return _failure("CONFLICT", False)

    async def flaky(input: Any, context: Any) -> CommandResult[Any]:
        if not h.flaky_failed:
            h.flaky_failed = True
            h.starts += 1
            return _failure("TRANSIENT_ERROR", True)
        return await place()

    async def timeout(input: Any, context: Any) -> CommandResult[Any]:
        h.starts += 1
        return _failure("TIMEOUT", True)

    async def throw(input: Any, context: Any) -> CommandResult[Any]:
        h.starts += 1
        raise RuntimeError("boom")

    async def claims_replay(input: Any, context: Any) -> CommandResult[Any]:
        result = await place()
        return result.model_copy(
            update={"metadata": ResultMetadata(idempotentReplay=True, note="kept")}
        )

    handlers = {
        "order-place": place,
        "order-refuse": refuse,
        "order-flaky": flaky,
        "order-timeout": timeout,
        "order-throw": throw,
        "order-approve": place,
        "order-set": place,
        "order-note": place,
        "order-claims-replay": claims_replay,
        "order-task": place,
    }
    return [
        CommandDefinition(
            name=spec["name"],
            description=spec["handler"],
            handler=handlers[spec["name"]],
            expose=MCP,
            mutation=spec["mutation"],
            idempotency=spec.get("idempotency"),
            approval=spec.get("approval"),
            task=spec.get("task"),
            input_schema=ORDER_SCHEMA,
        )
        for spec in SETUP["commands"]
    ]


def _approval_step(h: Harness) -> Any:
    """The harness's approval step: admits ``order-approve`` when the case says it is approved."""

    async def step(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        if name != "order-approve":
            return await next_fn()
        if not h.approved:
            return error(
                "APPROVAL_REQUIRED", "Needs approval", suggestion="Ask a person", retryable=False
            )
        admit_approval(
            step,
            context,
            name,
            _canonical_or_none(input),
            input,
            _canonical_or_none,
            required=True,
        )
        return await next_fn()

    return step


def _server(h: Harness, **extra: Any) -> Any:
    options = {
        "ttl_ms": SETUP["options"]["ttlMs"],
        "lease_ms": SETUP["options"]["leaseMs"],
        "store": h.store,
        **extra.pop("idempotency_extra", {}),
    }
    server = create_server(
        "orders",
        tool_strategy="individual",
        clock=h.clock(),
        # A call without `timeoutMs` has no deadline (spec/vectors/README.md).
        default_timeout_ms=None,
        context_fields=[ContextField(name="project", meta="dev.example/project", schema=str)],
        middleware=[_approval_step(h)],
        idempotency=IdempotencyOptions(**options),
        **extra,
    )
    for command in _commands(h):
        server.register(command)
    return server


def _seed(h: Harness, reservation: dict[str, Any]) -> None:
    """Put the case's seeded reservation in the store, as the step would have made it."""
    step = create_idempotency_step(IdempotencyOptions())
    principal = principal_binding(ACTORS[reservation["actor"]])
    scope = step.scope(principal, reservation["command"], reservation["key"])
    digest = step.digest({}, reservation["input"])
    made_at = reservation["madeAt"]
    h.store.reserve(
        scope,
        IdempotencyReservationRequest(
            digest=digest,
            reserved_at=made_at,
            expires_at=made_at + SETUP["options"]["ttlMs"],
            lease_ends_at=made_at + SETUP["options"]["leaseMs"],
        ),
        made_at,
    )


def _check(value: dict[str, Any], expect: dict[str, Any], where: str) -> None:
    said = f"{where}: {json.dumps(value, default=str)}"
    if expect.get("internalError"):
        assert value["error"]["code"] == -32603, said
        assert value["error"]["message"] == "Internal error", said
        return
    if "items" in expect:
        assert [item["result"]["success"] for item in value["results"]] == [
            item["success"] for item in expect["items"]
        ], said
        assert [
            (item["result"].get("metadata") or {}).get("idempotentReplay") is True
            for item in value["results"]
        ] == [item["replay"] for item in expect["items"]], said
        return
    if "success" in expect:
        assert value["success"] is expect["success"], said
    if "data" in expect:
        assert value.get("data") == expect["data"], said
    if "code" in expect:
        assert value["error"]["code"] == expect["code"], said
    if "retryable" in expect:
        assert value["error"].get("retryable") == expect["retryable"], said
    if "recovery" in expect:
        assert value["error"].get("recovery") == expect["recovery"], said
    if "replay" in expect:
        metadata = value.get("metadata") or {}
        assert (metadata.get("idempotentReplay") is True) is expect["replay"], said
        if not expect["replay"]:
            assert "idempotentReplay" not in metadata, said
    if "metadata" in expect:
        metadata = value.get("metadata") or {}
        assert {key: metadata.get(key) for key in expect["metadata"]} == expect["metadata"], said
    if "detailsMeta" in expect:
        assert value["error"]["details"]["meta"] == expect["detailsMeta"], said
    if "detailsReason" in expect:
        assert value["error"]["details"]["reason"] == expect["detailsReason"], said


@asynccontextmanager
async def _http(server: Any, asgi_middleware: Any = None):
    app = server.streamable_http_app(stateless_http=True, json_response=True)
    if asgi_middleware is not None:
        app.add_middleware(asgi_middleware)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8000"
        ) as http,
    ):
        yield http


async def _rpc(http: Any, name: str, arguments: Any, meta: dict[str, Any]) -> dict[str, Any]:
    params = {
        "name": name,
        "arguments": arguments,
        "_meta": {
            "io.modelcontextprotocol/protocolVersion": MODERN,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {"name": "vectors", "version": "0"},
            **meta,
        },
    }
    response = await http.post(
        "/mcp",
        headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": MODERN,
            "Mcp-Method": "tools/call",
            "Mcp-Name": name,
        },
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params},
    )
    body = response.json()
    if "error" in body:
        return body
    return json.loads(body["result"]["content"][0]["text"])


class UnbindableToken:
    """ASGI middleware: every request carries a verified token without an issuer, which no
    principal binding can be made of (spec/authorization.md, M8)."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        from mcp.server.auth.middleware.auth_context import auth_context_var
        from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
        from mcp.server.auth.provider import AccessToken

        token = AccessToken(token="t", client_id="c1", scopes=[], subject="u1", claims={})
        reset = auth_context_var.set(AuthenticatedUser(token))
        try:
            await self.app(scope, receive, send)
        finally:
            auth_context_var.reset(reset)


def _ours(case: dict[str, Any]) -> bool:
    return case.get("engine") in (None, ENGINE)


STEP_CASES = [
    pytest.param(
        case,
        id=case["description"],
        marks=()
        if _ours(case)
        else pytest.mark.skip(reason=f"the {case['engine']} engine's; Python's cancels (S7)"),
    )
    for case in VECTORS["step"]["cases"]
]


async def _run_step_case(case: dict[str, Any], call: Any, h: Harness) -> None:
    held: tuple[Any, asyncio.Event, asyncio.Event] | None = None
    for index, spec in enumerate(case["calls"]):
        where = f"call {index + 1}"
        if "at" in spec:
            h.now = spec["at"]
        h.approved = spec.get("approved") is True
        if held is not None and not spec.get("whileFirstIsHeld"):
            # Every call made while the first was held has returned: let it go and settle.
            task, release, settled = held
            release.set()
            await asyncio.wait_for(settled.wait(), 5)
            await task
            held = None
        if spec.get("heldInHandler"):
            started, release = asyncio.Event(), asyncio.Event()
            h.hold = (started, release)
            settled = h.store.next_settle()
            task = asyncio.ensure_future(call(spec))
            await asyncio.wait_for(started.wait(), 5)

            async def checked(task: Any = task, spec: Any = spec, where: str = where) -> None:
                _check(await task, spec["expect"], where)

            held = (asyncio.ensure_future(checked()), release, settled)
            continue
        if spec.get("cancelledDuringReserve"):
            entered, release = asyncio.Event(), asyncio.Event()
            h.store.hold_reserve = (entered, release)
            cancel = asyncio.Event()
            task = asyncio.ensure_future(call(spec, cancel))
            await asyncio.wait_for(entered.wait(), 5)
            cancel.set()
            release.set()
            _check(await task, spec["expect"], where)
            continue
        if spec.get("outlivesDeadline"):
            h.outlive = asyncio.Event()
            try:
                _check(await call(spec), spec["expect"], where)
            finally:
                outlive, h.outlive = h.outlive, None
                outlive.set()
            continue
        _check(await call(spec), spec["expect"], where)
    if held is not None:
        task, release, settled = held
        release.set()
        await asyncio.wait_for(settled.wait(), 5)
        await task
    assert h.starts == case["handlerRuns"]


@pytest.mark.parametrize("case", STEP_CASES)
async def test_step(case):
    h = Harness()
    if "seed" in case:
        _seed(h, case["seed"]["reservation"])
    surface = case.get("surface")

    if surface in ("http-without-credentials", "http-with-unbindable-credentials"):
        unbindable = surface == "http-with-unbindable-credentials"
        server = _server(h)
        async with _http(server, UnbindableToken if unbindable else None) as http:

            async def call(spec: dict[str, Any], cancel: Any = None) -> dict[str, Any]:
                meta = {META_KEY: spec["key"]} if "key" in spec else {}
                return await _rpc(http, spec["command"], spec["input"], meta)

            await _run_step_case(case, call, h)
        return

    if surface == "two-stdio-connections":
        server = _server(h)
        sdk = server._create_mcp_server()
        # Streams, as a stdio connection is: each its own connection to the server.
        async with (
            Client(InMemoryTransport(sdk)) as first,
            Client(InMemoryTransport(sdk)) as second,
        ):
            connections = [first, second]

            async def call(spec: dict[str, Any], cancel: Any = None) -> dict[str, Any]:
                meta = {META_KEY: spec["key"]} if "key" in spec else {}
                client = connections[spec["connection"] - 1]
                return tool_value(await client.call_tool(spec["command"], spec["input"], meta=meta))

            await _run_step_case(case, call, h)
        return

    if any(spec.get("asTask") for spec in case["calls"]):
        server = _server(h, task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10))
        # Over a stream, as stdio is, so the anonymous caller has a connection of its own (S3).
        async with Client(
            InMemoryTransport(server._create_mcp_server()), extensions=[_tasks_extension()]
        ) as client:

            async def call(spec: dict[str, Any], cancel: Any = None) -> dict[str, Any]:
                created = await client.session.call_tool(
                    spec["command"],
                    spec["input"],
                    meta={META_KEY: spec["key"]},
                    allow_claimed=True,
                )
                assert created.result_type == "task"
                done = await _poll_until_done(client, created.task_id)
                assert done.result is not None
                return json.loads(done.result["content"][0]["text"])

            await _run_step_case(case, call, h)
        return

    server = _server(h)

    async def call(spec: dict[str, Any], cancel: Any = None) -> dict[str, Any]:
        actor = None if spec.get("actor", "agent") is None else ACTORS[spec.get("actor", "agent")]
        context = CommandContext(
            actor=actor,
            idempotency_key=spec.get("key"),
            extra=dict(spec.get("context", {})),
            timeout=spec.get("timeoutMs"),
            cancel=cancel,
        )
        if spec.get("kind") == "batch":
            return wire(
                await server.route_tool_call(
                    "afd-batch", {"commands": spec["commands"]}, caller_context=context
                )
            )
        command_input = (
            {"sku": "a", "count": 1, "extra": float("inf")}
            if spec.get("inputNotCanonical")
            else spec["input"]
        )
        return wire(
            await server.route_tool_call(
                "afd-call",
                {"command": spec["command"], "input": command_input},
                caller_context=context,
            )
        )

    await _run_step_case(case, call, h)


@pytest.mark.parametrize("case", named(VECTORS["step"]["options"]))
def test_step_options(case):
    def build() -> Any:
        return create_server(
            "options",
            default_timeout_ms=case["defaultTimeoutMs"],
            idempotency=IdempotencyOptions(ttl_ms=case["ttlMs"], lease_ms=case["leaseMs"]),
        )

    if case["valid"]:
        build()
    else:
        with pytest.raises(ValueError, match="ttl_ms"):
            build()


# ═══════════════════════════════════════════════════════════════════════════════
# RETRYING (R1, R2, S6, S11)
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("case", named(VECTORS["retry"]["cases"]))
async def test_retry(case):
    runs = 0

    async def handler(input: Any = None, context: Any = None) -> CommandResult[Any]:
        nonlocal runs
        runs += 1
        if runs == 1:
            return _failure(case.get("handlerFailsWith", "TRANSIENT_ERROR"), True)
        return success({"runs": runs})

    # The middleware's defaults decide; only its waits are shortened.
    retry = create_retry_middleware(
        retry_delay=0, retry_mutations=case.get("retryMutations") is True
    )
    key = "k1" if case["key"] else None
    if case.get("declarationUnreadable"):
        # Outside the engine, the middleware cannot read the declaration.
        result = await retry("thing-do", {}, CommandContext(idempotency_key=key), handler)
    else:
        server = create_server(
            "retry",
            default_timeout_ms=None,
            middleware=[retry],
            idempotency=IdempotencyOptions() if case.get("withStep") else None,
        )
        server.register(
            CommandDefinition(
                name="thing-do",
                description="Does a thing",
                handler=handler,
                expose=MCP,
                **case["command"],
            )
        )
        context = CommandContext(
            actor=Actor(kind="agent", id="advisor"),
            idempotency_key=key,
            # A task run, as the task runtime marks one (S11).
            _task_run=case.get("asTask") is True,
        )
        result = await server.execute("thing-do", {}, context)
    assert result.success is case["expect"]["success"]
    if "code" in case["expect"]:
        assert result.error.code == case["expect"]["code"]
    assert runs == case["expect"]["handlerRuns"]


# ═══════════════════════════════════════════════════════════════════════════════
# THE TIMEOUT RECOVERY (R3)
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("case", named(VECTORS["timeoutRecovery"]["cases"]))
async def test_timeout_recovery(case):
    release = asyncio.Event()

    async def handler(input: Any = None, context: Any = None) -> CommandResult[Any]:
        # Outlives the deadline: returns only once the harness lets it go.
        await release.wait()
        return success({})

    server = create_server(
        "timeouts",
        default_timeout_ms=None,
        idempotency=None if case.get("withStep") is False else IdempotencyOptions(),
    )
    server.register(
        CommandDefinition(
            name="thing-do",
            description="Does a thing",
            handler=handler,
            expose=MCP,
            **case["command"],
        )
    )
    result = await server.execute(
        "thing-do",
        {},
        CommandContext(
            actor=Actor(kind="agent", id="advisor"),
            timeout=20,
            idempotency_key="k1" if case["key"] else None,
        ),
    )
    release.set()
    value = wire(result)
    assert value["error"]["code"] == case["expect"]["code"]
    assert value["error"]["retryable"] is case["expect"]["retryable"]
    assert value["error"].get("recovery") == case["expect"]["recovery"]


# ═══════════════════════════════════════════════════════════════════════════════
# THE JOURNAL
# ═══════════════════════════════════════════════════════════════════════════════


def _journaled() -> tuple[Any, MemoryJournalSink, list[str | None]]:
    seen: list[str | None] = []
    sink = MemoryJournalSink()
    server = create_server(
        "journal", default_timeout_ms=None, middleware=[create_journal_middleware(sink)]
    )

    async def note_add(input: Any, context: CommandContext) -> CommandResult[Any]:
        seen.append(context.idempotency_key)
        return success({"added": True})

    server.register(
        CommandDefinition(name="note-add", description="Adds a note", handler=note_add, expose=MCP)
    )
    return server, sink, seen


@pytest.mark.parametrize("case", named(VECTORS["journal"]["cases"]))
async def test_journal(case):
    server, sink, _seen = _journaled()
    context = CommandContext(idempotency_key=case.get("key"))
    if case.get("kind") == "batch":
        commands = [{"command": "note-add", "input": {}} for _ in range(case["items"])]
        await server.route_tool_call("afd-batch", {"commands": commands}, caller_context=context)
    else:
        await server.route_tool_call(
            "afd-call", {"command": "note-add", "input": {}}, caller_context=context
        )
    entries = await sink.read()
    expect = case["expect"]
    if "entryIdempotencyKey" in expect:
        assert len(entries) == 1
        assert entries[0].idempotency_key == expect["entryIdempotencyKey"]
        assert ("idempotencyKey" in entries[0].to_dict()) is (
            expect["entryIdempotencyKey"] is not None
        )
    if "entryIdempotencyKeys" in expect:
        assert sorted(entry.idempotency_key for entry in entries) == expect["entryIdempotencyKeys"]
    if expect.get("digestHashHasMember"):
        # spec/journal.md's formula, on a context whose other keys are known: the journal
        # called directly with `redact`, so it records outside an engine.
        alone = MemoryJournalSink()
        middleware = create_journal_middleware(alone, redact=lambda record: record)
        actor = Actor(kind="agent", id="advisor")
        await middleware(
            "note-add",
            {},
            CommandContext(
                actor=actor,
                trace_id="t1",
                extra={"interface": "mcp"},
                idempotency_key=case["key"],
            ),
            lambda: _ok({}),
        )
        [entry] = await alone.read()
        hashed = canonical_json(
            {
                "actor": {"kind": "agent", "id": "advisor"},
                "idempotencyKey": case["key"],
                "interface": "mcp",
                # The journal sets its recording clock and random source on the context.
                "keys": ["clock", "random"],
                "traceId": "t1",
            }
        )
        assert entry.idempotency_key == case["key"]
        digest = hashlib.sha256(hashed.encode("utf-8")).hexdigest()
        assert entry.context_digest.hash == f"sha256:{digest}"
    if case.get("replay"):
        target, _target_sink, target_seen = _journaled()
        report = await replay_journal(target, entries)
        if "handlerSeesKey" in expect:
            assert target_seen == [expect["handlerSeesKey"]]
        if "handlerSeesKeys" in expect:
            assert (
                sorted(key for key in target_seen if key is not None) == expect["handlerSeesKeys"]
            )
        if "status" in expect:
            assert [item.status for item in report.entries] == [expect["status"]]
