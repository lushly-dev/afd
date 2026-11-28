"""The language-neutral vectors in spec/vectors/journal-seams.json.

The dispatch id (spec/dispatch.md, "The dispatch id", I1 to I4) and the approval summary
(spec/command-metadata.md, "The approval summary", rules 1 to 5). Every case runs: the dispatch
id cases on the core registry and on ``create_server``, the approval summary cases in process
(tokens and DirectClient) and over MCP (the form-mode relay and a ``HumanRelay``). A language
listed in the file's ``gaps`` skips every case with its issue as the reason; Python is not listed.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from afd import Actor, DirectClient, DirectClientOptions, ExposeOptions, fixed_clock, success
from afd.core.commands import CommandContext, CommandDefinition, create_command_registry
from afd.core.errors import CommandError
from afd.core.journal import MemoryJournalSink, serialize_journal_entry
from afd.core.pipeline import PipelineRequest, execute_pipeline
from afd.core.result import failure
from afd.core.wire import to_wire
from afd.direct import create_direct_registry
from afd.server import create_approval_middleware, create_server
from afd.server.approval import ApprovalRequest, ApprovalSummary, approval_id
from afd.server.journal import create_journal_middleware

SPEC = Path(__file__).resolve().parents[2] / "spec" / "vectors"
VECTORS = json.loads((SPEC / "journal-seams.json").read_text(encoding="utf-8"))
TOKENS = json.loads((SPEC / "approval-tokens.json").read_text(encoding="utf-8"))
GAP = VECTORS["gaps"].get("python")
ID_PATTERN = re.compile(VECTORS["dispatchId"]["format"]["pattern"])
MCP = ExposeOptions(mcp=True)
ID_SCHEMA = {"type": "object", "properties": {"id": {"type": "number"}}}


def test_python_is_not_a_documented_gap():
    assert GAP is None, "Python implements journal-seams.json"


def test_the_id_pattern_is_usable():
    id_format = VECTORS["dispatchId"]["format"]
    assert id_format["length"] == 22
    assert ID_PATTERN.fullmatch("A" * 22)
    # Sixteen bytes leave two bits for the last character, so most letters cannot end an id.
    assert not ID_PATTERN.fullmatch("B" * 22)


def _holds_id(value: Any, ids: set[str]) -> bool:
    """Whether ``value`` has a member named for the dispatch id, or holds one of ``ids``."""
    if isinstance(value, str):
        return value in ids
    if isinstance(value, list):
        return any(_holds_id(item, ids) for item in value)
    if isinstance(value, dict):
        return any(
            name in ("dispatchId", "dispatch_id") or _holds_id(member, ids)
            for name, member in value.items()
        )
    return False


# ─── The dispatch id ──────────────────────────────────────────────────────────────────────────


@dataclass
class _Notes:
    ids: list[tuple[str, str | None]] = field(default_factory=list)
    handler_runs: int = 0
    flaky_runs: int = 0
    draws: list[float] = field(default_factory=list)

    def note(self, reader: str, context: Any) -> None:
        self.ids.append((reader, context.dispatch_id))


class _Sequence:
    """A random source that returns the case's values in order."""

    seed = None

    def __init__(self, values: list[float]) -> None:
        self._values = list(values)

    def next(self) -> float:
        return self._values.pop(0)


OVERWRITTEN = "overwritten-by-mw1-0000"


def _overwrite(context: Any) -> None:
    """Every way a middleware could try to set the id: the property (refused, also through
    ``object.__setattr__``), the instance dictionary under every name an implementation might
    keep it under, and ``extra`` under both its names. None of them changes what a link reads."""
    with pytest.raises(AttributeError):
        context.dispatch_id = OVERWRITTEN
    with pytest.raises(AttributeError):
        object.__setattr__(context, "dispatch_id", OVERWRITTEN)
    with pytest.raises(AttributeError):
        del context.dispatch_id
    for name in ("dispatch_id", "_dispatch_id", "_afd_dispatch_id"):
        vars(context)[name] = OVERWRITTEN
    context.extra["dispatch_id"] = OVERWRITTEN
    context.extra["dispatchId"] = OVERWRITTEN


def _observer(reader: str, notes: _Notes) -> Callable[..., Any]:
    async def middleware(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        notes.note(reader, context)
        return await next_fn()

    return middleware


def _outer_layer(kind: str | None, notes: _Notes) -> Callable[..., Any]:
    if kind == "overwrite":

        async def overwrite(name: str, input: Any, context: Any, next_fn: Any) -> Any:
            _overwrite(context)
            return await next_fn()

        return overwrite
    if kind == "retry-once":

        async def retry(name: str, input: Any, context: Any, next_fn: Any) -> Any:
            notes.note("mw1", context)
            first = await next_fn()
            return first if first.success else await next_fn()

        return retry
    return _observer("mw1", notes)


class _Engine:
    """One engine a dispatch case runs on: the core registry or the MCP server."""

    def __init__(self, kind: str, run: dict[str, Any]) -> None:
        self.notes = _Notes()
        self.sink = MemoryJournalSink() if run.get("journal") else None
        middleware = [_outer_layer(run.get("middleware"), self.notes), _observer("mw2", self.notes)]
        if self.sink is not None:
            middleware.append(create_journal_middleware(self.sink))
        if kind == "registry":
            self.target: Any = create_command_registry(middleware=middleware)
        else:
            self.target = create_server("journal-seams", middleware=middleware)
        for command in VECTORS["dispatchId"]["setup"]["commands"]:
            self.target.register(
                CommandDefinition(
                    name=command["name"],
                    description=command["description"],
                    handler=self._handler(command["name"]),
                    input_schema=ID_SCHEMA if command["name"] == "item-echo" else None,
                    expose=MCP,
                )
            )

    def _handler(self, name: str) -> Callable[..., Any]:
        notes = self.notes

        async def handler(input: Any, context: Any) -> Any:
            notes.handler_runs += 1
            notes.note("handler", context)
            if name == "item-flaky":
                notes.flaky_runs += 1
                if notes.flaky_runs == 1:
                    return failure(
                        CommandError(code="TRANSIENT_ERROR", message="Try again", retryable=True)
                    )
                return success(input)
            if name == "item-outer":
                before = context.dispatch_id
                inner = await self.target.execute("item-echo", {}, context)
                assert inner.success, inner
                # The nested call leaves this call's id as it was.
                assert context.dispatch_id == before
                return success({})
            if name == "item-draw":
                notes.draws.append(context.random.next())
                return success({})
            return success(input)

        return handler

    def context(self, run: dict[str, Any]) -> CommandContext:
        extra: dict[str, Any] = {}
        for name, value in (run.get("context") or {}).items():
            # A caller can put a value under the id's name in extra, in either spelling.
            extra[name] = value
            if name == "dispatchId":
                extra["dispatch_id"] = value
        return CommandContext(
            trace_id=run.get("traceId"),
            extra=extra,
            random=_Sequence(run["random"]) if "random" in run else None,
        )

    async def run(self, run: dict[str, Any]) -> list[Any]:
        kind = run["kind"]
        if kind == "call":
            return [await self.target.execute(run["command"], run["input"], self.context(run))]
        if kind == "calls":
            return [
                await self.target.execute(run["command"], run["input"], self.context(run))
                for _ in range(run["count"])
            ]
        if kind == "batch":
            batch = await self.target.execute_batch(
                {"commands": run["commands"]}, self.context(run)
            )
            assert batch.success, batch
            return [item.result for item in batch.results]
        assert kind == "pipeline"

        async def executor(command: str, input: Any) -> Any:
            return await self.target.execute(
                command, input, CommandContext(trace_id=run["traceId"])
            )

        result = await execute_pipeline(
            PipelineRequest.model_validate({"steps": run["steps"]}), executor
        )
        assert all(step.status == "success" for step in result.steps), result
        return [success(step.data) for step in result.steps]


def _expected_digest_hash(keys: list[str]) -> str:
    canonical = json.dumps(
        {"actor": None, "interface": None, "keys": keys, "traceId": None},
        separators=(",", ":"),
        sort_keys=True,
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@pytest.mark.parametrize("engine", ["registry", "server"])
@pytest.mark.parametrize(
    "case", VECTORS["dispatchId"]["cases"], ids=lambda case: case["description"]
)
async def test_dispatch_id(case, engine):
    if GAP is not None:
        pytest.skip(f"dispatch id: documented Python gap, {GAP}")
    run, expect = case["run"], case["expect"]
    harness = _Engine(engine, run)
    results = await harness.run(run)
    notes = harness.notes.ids

    readers = expect.get("readers")
    read = [id for reader, id in notes if readers is None or reader in readers]
    for reader in readers or []:
        assert any(noted == reader for noted, _ in notes), f"{reader} noted nothing"
    assert all(id is not None for id in read), notes
    ids = set(read)
    all_ids = {id for _, id in notes if id is not None}

    if "handlerRuns" in expect:
        assert harness.notes.handler_runs == expect["handlerRuns"]
    if "distinctIds" in expect:
        assert len(ids) == expect["distinctIds"], notes
    if expect.get("wellFormed"):
        assert all(ID_PATTERN.fullmatch(id) for id in ids), ids
    for never in expect.get("never", []):
        assert never not in ids
    if "success" in expect:
        assert all(result.success == expect["success"] for result in results), results
    if "data" in expect:
        assert results[0].data == expect["data"]
    if expect.get("resultHasId") is False:
        for result in results:
            assert not _holds_id(to_wire(result), all_ids)
    if harness.sink is not None:
        entries = await harness.sink.read()
        if "entries" in expect:
            assert len(entries) == expect["entries"]
        for entry in entries:
            line = json.loads(serialize_journal_entry(entry))
            if expect.get("entryHasId") is False:
                assert not _holds_id(line, all_ids), line
            if expect.get("digestHashOmitsId"):
                # The registry fills a clock and a random source; their names are the keys.
                assert entry.context_digest.hash == _expected_digest_hash(["clock", "random"])
    if "handlerDraws" in expect:
        assert harness.notes.draws == expect["handlerDraws"]


def test_a_declared_context_field_cannot_take_the_dispatch_ids_name():
    from afd.server import ContextField

    for name in ("dispatchId", "dispatch_id"):
        with pytest.raises(ValueError):
            create_server(
                "fields",
                context_fields=[
                    ContextField(name=name, meta="dev.example/run", schema={"type": "string"})
                ],
            )


# ─── The approval summary ─────────────────────────────────────────────────────────────────────

SECRET = TOKENS["secrets"]["current"]
NOW = TOKENS["now"]
TTL_MS = TOKENS.get("ttlMs", 300_000)


@dataclass
class _Seen:
    order: list[str] = field(default_factory=list)
    summaries: list[tuple[ApprovalSummary, str | None]] = field(default_factory=list)
    handler_ids: list[str | None] = field(default_factory=list)
    spent: list[str] = field(default_factory=list)
    requested: list[str] = field(default_factory=list)
    tokens: list[str] = field(default_factory=list)


class _NotingStore:
    """A nonce store that keeps every key, and notes each it is asked to consume."""

    def __init__(self, seen: _Seen) -> None:
        self._seen = seen
        self._keys: set[str] = set()

    def consume(self, nonce: str, expires_at: float) -> bool:
        self._seen.spent.append(nonce)
        if nonce in self._keys:
            return False
        self._keys.add(nonce)
        return True


def _middleware(seen: _Seen, *, fail: bool = False, replay: str = "single-use", **options: Any):
    def required(request: ApprovalRequest) -> None:
        seen.requested.append(request.approval_id)
        seen.tokens.append(request.approval_token)

    async def accepted(summary: ApprovalSummary, dispatch_id: str | None) -> None:
        seen.order.append("hook")
        seen.summaries.append((summary, dispatch_id))
        if fail:
            raise RuntimeError("the host could not record the approval")

    return create_approval_middleware(
        secret=SECRET,
        include_token=True,
        replay=replay,  # type: ignore[arg-type]
        nonce_store=_NotingStore(seen),
        on_approval_required=required,
        on_approval_accepted=accepted,
        **options,
    )


def _run_handler(seen: _Seen) -> Callable[..., Any]:
    async def handler(input: Any, context: Any) -> Any:
        seen.order.append("handler")
        seen.handler_ids.append(context.dispatch_id)
        return success(input)

    return handler


def _commands(seen: _Seen, **gated: Any) -> list[CommandDefinition]:
    commands = [
        CommandDefinition(
            name=name,
            description=name,
            handler=_run_handler(seen),
            input_schema=ID_SCHEMA,
            approval="required",
            expose=MCP,
            **gated,
        )
        for name in TOKENS["commands"]
    ]
    commands.append(
        CommandDefinition(
            name="item-echo",
            description="Echo",
            handler=_run_handler(seen),
            input_schema=ID_SCHEMA,
            expose=MCP,
        )
    )
    return commands


def _binding(name: str) -> dict[str, Any]:
    return next(binding for binding in TOKENS["bindings"] if binding["description"] == name)


def _actor(name: str) -> Actor:
    actor = TOKENS["actors"][name]
    return Actor(
        kind=actor["kind"],
        id=actor.get("id"),
        label=actor.get("label"),
        on_behalf_of=actor.get("onBehalfOf"),
    )


def _token(binding: dict[str, Any], run: dict[str, Any]) -> str:
    token = binding["token"]
    if run.get("tamper") != "signature":
        return token
    return token[:-1] + ("B" if token[-1] == "A" else "A")


async def _run_in_process(case: dict[str, Any], seen: _Seen) -> list[dict[str, Any]]:
    run = case["run"]
    middleware = _middleware(
        seen,
        fail=run.get("hook") == "fail",
        replay=run.get("replay", "single-use"),
        clock=fixed_clock(NOW),
    )
    # server.execute is the trusted host API that carries a token in context.approval; a
    # DirectClient runs on a direct registry.
    registry: Any
    if run["via"] == "direct":
        registry = create_direct_registry(_commands(seen), middleware=[middleware])
    else:
        registry = create_server("journal-seams", middleware=[middleware])
        for command in _commands(seen):
            registry.register(command)
    if "binding" in run:
        binding = _binding(run["binding"])
        command, input = binding["command"], binding["input"]
        actor, token = _actor(binding["actor"]), _token(binding, run)
    else:
        command, input, actor, token = run["command"], run["input"], _actor("agent"), None

    def context(approval: str | None) -> CommandContext:
        return CommandContext(actor=actor, approval=approval)

    results = []
    if run["via"] == "direct":

        async def approve(request: Any) -> bool:
            seen.requested.append(request.approval_id)
            return True

        client = DirectClient(registry, DirectClientOptions(on_approval_needed=approve))
        results.append(await client.call(command, input))
    elif run.get("holdFirst"):
        held = await registry.execute(command, input, context(None))
        assert not held.success, held
        results.append(await registry.execute(command, input, context(seen.tokens[-1])))
    else:
        for _ in range(run.get("count", 1)):
            results.append(await registry.execute(command, input, context(token)))
        if run.get("thenRetry"):
            results.append(await registry.execute(command, input, context(token)))
    return [to_wire(result) for result in results]


class _ApprovingRelay:
    """A HumanRelay that approves every call with the case's decision id."""

    def __init__(self, decision_id: str) -> None:
        self.decision_id = decision_id

    def begin(self, call: Any) -> Any:
        from afd.server import RelayPrompt

        return RelayPrompt(
            url="https://person.example.com/decide/d-1",
            message="Open the link to review todo-delete",
            state="state-1",
        )

    def resume(self, state: str, call: Any) -> Any:
        from afd.server import RelayApproved

        return RelayApproved(decision_id=self.decision_id)


async def _post(server: Any, tool: str, arguments: Any, **params: Any) -> dict[str, Any]:
    """One MCP 2026-07-28 tools/call over Streamable HTTP, from a client that can be asked with
    a form (the MCP relay) or a URL (a host's relay)."""
    import httpx

    meta = {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {"name": "journal-seams", "version": "0"},
        "io.modelcontextprotocol/clientCapabilities": {"elicitation": {"form": {}, "url": {}}},
    }
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments, "_meta": meta, **params},
    }
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": tool,
    }
    app = server.streamable_http_app(stateless_http=True, json_response=True)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8000"
        ) as http,
    ):
        response = await http.post("/mcp", headers=headers, json=body)
        assert response.status_code == 200, response.text
        return response.json()


def _accept(asked: dict[str, Any]) -> dict[str, Any]:
    """The answer that accepts the question ``asked`` put."""
    result = asked["result"]
    assert result["resultType"] == "input_required", asked
    key = next(iter(result["inputRequests"]))
    requested = result["inputRequests"][key]
    schema = (requested.get("params") or {}).get("requestedSchema") or {}
    properties = schema.get("properties") or {}
    response: dict[str, Any] = {"action": "accept"}
    if properties:
        response["content"] = dict.fromkeys(properties, True)
    return {"inputResponses": {key: response}, "requestState": result["requestState"]}


def _mcp_server(case: dict[str, Any], seen: _Seen) -> Any:
    run = case["run"]
    relay = run["via"] == "relay"
    middleware = _middleware(seen, clock=fixed_clock(NOW))
    if not relay:
        middleware = _middleware(seen, clock=fixed_clock(NOW), relay="mcp-elicitation")
    server = create_server(
        "journal-seams",
        tool_strategy="individual",
        middleware=[middleware],
        human_relay=_ApprovingRelay(run["decisionId"]) if relay else None,
        # Each request is served by a fresh app, so they share the key that seals requestState.
        confirmation_key=b"k" * 32,
    )
    gated = {"confirmation_mode": "host-verified"} if relay else {}
    for command in _commands(seen, **gated):
        server.register(command)
    return server


async def _run_over_mcp(case: dict[str, Any], seen: _Seen) -> list[dict[str, Any]]:
    run = case["run"]
    server = _mcp_server(case, seen)
    if run.get("kind") == "batch":
        tool, arguments = "afd-batch", {"commands": run["commands"]}
    else:
        tool, arguments = run["command"], run["input"]
    asked = await _post(server, tool, arguments)
    ran = await _post(server, tool, arguments, **_accept(asked))
    return [json.loads(ran["result"]["content"][0]["text"])]


def _check(case: dict[str, Any], seen: _Seen, results: list[dict[str, Any]]) -> None:
    run, expect = case["run"], case["expect"]
    first = results[0]
    serialized = [summary.to_dict() for summary, _ in seen.summaries]
    bound = _binding(run["binding"]) if "binding" in run else None

    if "success" in expect:
        assert first["success"] is expect["success"], first
    if "code" in expect:
        assert first["error"]["code"] == expect["code"], first
    if "hookCalls" in expect:
        assert len(seen.summaries) == expect["hookCalls"], seen.summaries
    if "handlerRuns" in expect:
        assert len(seen.handler_ids) == expect["handlerRuns"]
    if "order" in expect:
        assert seen.order == expect["order"]
    if "retry" in expect:
        last = results[-1]
        assert last["error"]["code"] == expect["retry"]["code"], last
        assert last["error"]["details"]["reason"] == expect["retry"]["reason"], last
        assert len(seen.handler_ids) == expect["retry"]["handlerRuns"]
    for summary in serialized:
        if "members" in expect:
            assert sorted(summary) == expect["members"], summary
        if "via" in expect:
            assert summary["via"] == expect["via"]
        for member in expect.get("fromBinding", []):
            assert bound is not None
            assert summary[member] == bound[member], (member, summary)
        times = {"now": NOW, "now + ttlMs": NOW + TTL_MS}
        for member in ("issuedAt", "expiresAt"):
            if member in expect:
                assert summary[member] == times[expect[member]], summary
        for held in expect.get("summaryNeverHolds", []):
            value = bound[held] if bound is not None and isinstance(bound.get(held), str) else held
            assert value not in json.dumps(summary), (held, summary)
        if "approvalIdIs" in expect:
            entry = next(
                entry
                for entry in TOKENS["approvalIds"]
                if entry["description"] == expect["approvalIdIs"]
            )
            assert summary["approvalId"] == entry["approvalId"]
    if expect.get("dispatchIdIsHandlers"):
        given = [id for _, id in seen.summaries]
        assert given == seen.handler_ids and all(id is not None for id in given)
    if expect.get("approvalIdFromSpentKey"):
        spent = {approval_id(key) for key in seen.spent}
        assert all(summary.approval_id in spent for summary, _ in seen.summaries), seen.spent
    if "distinctApprovalIds" in expect:
        ids = {summary.approval_id for summary, _ in seen.summaries}
        assert len(ids) == expect["distinctApprovalIds"]
    if "distinctDispatchIds" in expect:
        ids = [id for _, id in seen.summaries]
        assert all(id is not None for id in ids)
        assert len(set(ids)) == expect["distinctDispatchIds"]
    if expect.get("requestApprovalIdIsSummarys"):
        assert seen.requested, "no request was noted"
        assert seen.requested[-1] == seen.summaries[-1][0].approval_id


@pytest.mark.parametrize(
    "case", VECTORS["approvalSummary"]["cases"], ids=lambda case: case["description"]
)
async def test_approval_summary(case):
    if GAP is not None:
        pytest.skip(f"approval summary: documented Python gap, {GAP}")
    seen = _Seen()
    if case["run"]["via"] in ("relay", "elicitation"):
        pytest.importorskip("mcp")
        pytest.importorskip("httpx")
        results = await _run_over_mcp(case, seen)
    else:
        results = await _run_in_process(case, seen)
    _check(case, seen, results)


# ─── Beyond the vectors ───────────────────────────────────────────────────────────────────────


def _echo_engine(kind: str, middleware: list[Any], handler: Callable[..., Any], **options: Any):
    engine: Any = (
        create_command_registry(middleware=middleware, **options)
        if kind == "registry"
        else create_server("journal-seams", middleware=middleware, **options)
    )
    engine.register(
        CommandDefinition(
            name="item-echo",
            description="Echo",
            handler=handler,
            expose=ExposeOptions(mcp=True, apps=True),
        )
    )
    return engine


@pytest.mark.parametrize("engine", ["registry", "server"])
async def test_every_part_of_a_composed_middleware_reads_the_same_id(engine):
    # One engine link made of three parts: a per-link restore would not reach the inner parts,
    # so the id must be impossible to change, not merely put back.
    from afd.server.middleware import compose_middleware

    seen: list[str | None] = []

    async def note(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        seen.append(context.dispatch_id)
        return await next_fn()

    async def overwrite(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        _overwrite(context)
        return await next_fn()

    async def handler(input: Any, context: Any) -> Any:
        seen.append(context.dispatch_id)
        return success({})

    target = _echo_engine(engine, [compose_middleware(note, overwrite, note)], handler)
    result = await target.execute("item-echo", {})
    assert result.success, result
    assert len(seen) == 3
    assert len(set(seen)) == 1
    assert seen[0] is not None and ID_PATTERN.fullmatch(seen[0])


@dataclass
class _UncopyableContext(CommandContext):
    def __copy__(self) -> Any:
        raise TypeError("this context cannot be copied")


@dataclass
class _SelfCopyingContext(CommandContext):
    def __copy__(self) -> Any:
        return self


@pytest.mark.parametrize("engine", ["registry", "server"])
@pytest.mark.parametrize("shape", [CommandContext, _UncopyableContext, _SelfCopyingContext])
async def test_a_handler_called_directly_reads_no_outer_dispatch_id(engine, shape):
    from afd.server import define_command

    seen: list[tuple[str, str | None]] = []

    @define_command(name="item-inner", description="Inner")
    async def inner(input: Any, context: Any) -> Any:
        seen.append(("inner", context.dispatch_id if context is not None else None))
        return success({})

    async def outer(input: Any, context: Any) -> Any:
        seen.append(("outer", context.dispatch_id))
        # Not a dispatch: the decorated function, called as a plain function.
        result = await inner({}, context)
        # The outer call's context keeps its id.
        seen.append(("outer", context.dispatch_id))
        return result

    target = _echo_engine(engine, [], outer)
    result = await target.execute("item-echo", {}, shape())
    assert result.success, result
    assert [reader for reader, _ in seen] == ["outer", "inner", "outer"]
    assert seen[0][1] is not None and ID_PATTERN.fullmatch(seen[0][1])
    assert seen[1][1] is None, "the direct call read the outer dispatch's id"
    assert seen[2][1] == seen[0][1]


@pytest.mark.parametrize("engine", ["registry", "server"])
async def test_an_app_calls_grant_reads_the_id_its_handler_reads(engine):
    granted: list[str | None] = []
    handled: list[str | None] = []

    def grant(name: str, context: Any) -> bool:
        granted.append(context.dispatch_id)
        return True

    async def handler(input: Any, context: Any) -> Any:
        handled.append(context.dispatch_id)
        return success({})

    target = _echo_engine(engine, [], handler, call_grant=grant)
    result = await target.execute("item-echo", {}, CommandContext(extra={"interface": "apps"}))
    assert result.success, result
    assert granted and handled
    assert set(granted) == {handled[0]}
    assert handled[0] is not None and ID_PATTERN.fullmatch(handled[0])


def test_the_id_is_in_no_copy_pickle_vars_repr_or_json():
    import copy
    import dataclasses
    import pickle

    from afd.core.dispatch_id import begin_dispatch

    context = CommandContext(trace_id="t", extra={"k": 1})
    dispatch_id = begin_dispatch(context)
    assert context.dispatch_id == dispatch_id
    for copied in (
        copy.copy(context),
        copy.deepcopy(context),
        pickle.loads(pickle.dumps(context)),
        dataclasses.replace(context),
    ):
        assert copied.dispatch_id is None
    assert not _holds_id(json.loads(json.dumps(vars(context), default=str)), {dispatch_id})
    assert dispatch_id not in repr(context)
    assert context == CommandContext(trace_id="t", extra={"k": 1})
    with pytest.raises(TypeError):
        CommandContext(dispatch_id="caller-chosen-id-000000")  # type: ignore[call-arg]


def test_a_context_subclass_cannot_declare_a_dispatch_id_field():
    @dataclass
    class Declares(CommandContext):
        dispatch_id: str | None = None  # type: ignore[assignment]

    with pytest.raises(AttributeError):
        Declares()


@dataclass(slots=True)
class _SlottedContext:
    """A slotted context of a host's own, with the fields with_context_defaults fills."""

    trace_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    actor: Any = None
    clock: Any = None
    random: Any = None
    tenant: str = "t-1"


class _BareContext:
    """A context with_context_defaults cannot fill (no clock, random or actor slots), so it
    returns it as it is."""

    __slots__ = ("extra", "tenant", "trace_id")

    def __init__(self) -> None:
        self.extra: dict[str, Any] = {}
        self.tenant = "t-2"
        self.trace_id = None


@pytest.mark.parametrize("engine", ["registry", "server"])
@pytest.mark.parametrize("shape", [_SlottedContext, _BareContext])
async def test_a_context_of_a_hosts_own_shape_reads_an_id(engine, shape):
    seen: list[tuple[str | None, str]] = []

    async def note(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        seen.append((context.dispatch_id, context.tenant))
        return await next_fn()

    async def handler(input: Any, context: Any) -> Any:
        assert isinstance(context, shape)
        seen.append((context.dispatch_id, context.tenant))
        return success({})

    caller = shape()
    target = _echo_engine(engine, [note], handler)
    result = await target.execute("item-echo", {}, caller)
    assert result.success, result
    ids = {id for id, _ in seen}
    assert len(seen) == 2 and len(ids) == 1, seen
    (only,) = ids
    assert only is not None and ID_PATTERN.fullmatch(only)
    # Its fields are kept, and the caller's own object is not changed.
    assert {tenant for _, tenant in seen} == {caller.tenant}
    assert not hasattr(caller, "dispatch_id")


def _held_call(binding: dict[str, Any]) -> CommandContext:
    return CommandContext(actor=_actor(binding["actor"]), approval=binding["token"])


@pytest.mark.parametrize("raising", ["hook", "sync-hook", "middleware"])
async def test_a_refusing_hook_is_an_error_to_the_links_outside_it(raising, caplog):
    # Rule 2: the hook's exception leaves the approval middleware as any middleware's exception
    # does. A link outside it sees the exception, not a result; the engine answers
    # COMMAND_EXECUTION_ERROR and logs it to the server's error hook (the afd.server logger).
    # The "middleware" run is the comparison: a plain raising middleware in the same place.
    seen = _Seen()
    outside: list[str] = []

    async def outer(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        try:
            return await next_fn()
        except Exception as exc:
            outside.append(type(exc).__name__)
            raise

    async def raises(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        raise RuntimeError("a middleware failed")

    def refuses(summary: ApprovalSummary, dispatch_id: str | None) -> None:
        seen.order.append("hook")
        raise RuntimeError("the host could not record the approval")

    if raising == "sync-hook":
        approval = create_approval_middleware(
            secret=SECRET, clock=fixed_clock(NOW), on_approval_accepted=refuses
        )
    else:
        approval = _middleware(seen, fail=True, clock=fixed_clock(NOW))
    server = create_server(
        "journal-seams", middleware=[outer, raises if raising == "middleware" else approval]
    )
    for command in _commands(seen):
        server.register(command)
    binding = _binding("a flat object")
    with caplog.at_level("ERROR", logger="afd.server"):
        result = await server.execute(binding["command"], binding["input"], _held_call(binding))
    assert outside == ["RuntimeError"]
    assert not result.success
    assert result.error.code == "COMMAND_EXECUTION_ERROR"
    assert result.error.message == "An internal error occurred"
    assert seen.handler_ids == []
    assert any(record.levelname == "ERROR" for record in caplog.records)
    if raising != "middleware":
        assert seen.order == ["hook"]
        # The token is spent: a retry is held as already used.
        retry = await server.execute(binding["command"], binding["input"], _held_call(binding))
        assert retry.error.code == "APPROVAL_REQUIRED"
        assert retry.error.details["reason"] == "already-used"


async def test_each_gated_step_of_an_afd_pipe_approved_up_front_gets_its_own_summary():
    pytest.importorskip("mcp")
    pytest.importorskip("httpx")
    seen = _Seen()
    server = _mcp_server({"run": {"via": "elicitation"}}, seen)
    arguments = {
        "steps": [
            {"command": "todo-delete", "input": {"id": 1}},
            {"command": "item-echo", "input": {"id": 2}},
            {"command": "todo-archive", "input": {"id": 3}},
        ]
    }
    asked = await _post(server, "afd-pipe", arguments)
    ran = await _post(server, "afd-pipe", arguments, **_accept(asked))
    body = json.loads(ran["result"]["content"][0]["text"])
    assert [step["status"] for step in body["steps"]] == ["success"] * 3, body
    assert [summary.command for summary, _ in seen.summaries] == ["todo-delete", "todo-archive"]
    assert all(summary.via == "elicitation" for summary, _ in seen.summaries)
    assert len({summary.approval_id for summary, _ in seen.summaries}) == 2
    # Each gated step's hook gets that step's own dispatch id, the one its handler reads.
    hook_ids = [id for _, id in seen.summaries]
    assert len(set(hook_ids)) == 2
    assert set(hook_ids) <= set(seen.handler_ids)
    spent = {approval_id(key) for key in seen.spent}
    assert all(summary.approval_id in spent for summary, _ in seen.summaries)
    assert seen.order == ["hook", "handler", "handler", "hook", "handler"]


@pytest.mark.parametrize("engine", ["registry", "server"])
async def test_a_decorator_around_a_command_function_runs_and_its_handler_reads_the_id(engine):
    import functools

    from afd.server import define_command
    from afd.server.decorators import command_to_definition

    calls: list[str] = []
    seen: list[str | None] = []

    def traced(fn: Any) -> Any:
        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            calls.append("traced")
            return await fn(*args, **kwargs)

        return wrapper

    @traced
    @define_command(name="item-echo", description="Echo", expose=ExposeOptions(mcp=True))
    async def echo(input: Any, context: Any) -> Any:
        seen.append(context.dispatch_id)
        return success({})

    async def note(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        seen.append(context.dispatch_id)
        return await next_fn()

    target: Any = (
        create_command_registry(middleware=[note])
        if engine == "registry"
        else create_server("journal-seams", middleware=[note])
    )
    target.register(command_to_definition(echo) if engine == "registry" else echo)
    result = await target.execute("item-echo", {})
    assert result.success, result
    assert calls == ["traced"], "the host's decorator did not run"
    assert len(seen) == 2 and seen[0] == seen[1] and seen[0] is not None, seen


@pytest.mark.parametrize("engine", ["mock", "server"])
async def test_a_mock_servers_handler_reads_the_id_its_middleware_reads(engine):
    from afd.server import define_command
    from afd.testing.fixtures import MockServer

    seen: list[str | None] = []

    async def note(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        seen.append(context.dispatch_id)
        return await next_fn()

    @define_command(name="item-echo", description="Echo", expose=ExposeOptions(mcp=True))
    async def echo(input: Any, context: Any) -> Any:
        seen.append(context.dispatch_id)
        return success({})

    if engine == "mock":
        target: Any = MockServer(middleware=[note])
        target.command("item-echo")(echo)
    else:
        target = create_server("journal-seams", middleware=[note])
        target.register(echo)
    result = await target.execute("item-echo", {})
    assert result.success, result
    assert len(seen) == 2 and seen[0] == seen[1] and seen[0] is not None, seen


def test_the_summary_and_its_id_are_exported_from_afd_server():
    import afd.server as server_module

    assert server_module.ApprovalSummary is ApprovalSummary
    assert server_module.approval_id is approval_id
    assert {"ApprovalSummary", "approval_id"} <= set(server_module.__all__)


def test_a_positional_rejection_cannot_become_an_approval_id():
    from afd.core.direct_approval import DirectApprovalRequest

    with pytest.raises(TypeError):
        ApprovalRequest("todo-delete", {}, None, "token", "expiry", "summary", "already-used")
    with pytest.raises(TypeError):
        DirectApprovalRequest("todo-delete", {}, "summary", "expiry", "already-used")
    request = ApprovalRequest(
        "todo-delete", {}, None, "token", "expiry", "summary", "already-used", approval_id="id-1"
    )
    assert (request.rejected, request.approval_id) == ("already-used", "id-1")
    direct = DirectApprovalRequest("todo-delete", {}, "summary", "expiry", "why", approval_id="id")
    assert (direct.reason, direct.approval_id) == ("why", "id")


class _HostDict(dict):
    """A dict context of a host's own (the core registry runs a mapping context)."""


class _StatefulSlots:
    """A slotted context whose own __getstate__ and __setstate__ carry its state as a dict."""

    __slots__ = ("extra", "tenant", "token", "trace_id")

    def __init__(self) -> None:
        self.extra: dict[str, Any] = {}
        self.tenant = "t-4"
        self.token = "keep-me"
        self.trace_id = None

    def __getstate__(self) -> dict[str, Any]:
        return {name: getattr(self, name) for name in self.__slots__}

    def __setstate__(self, state: dict[str, Any]) -> None:
        for name, value in state.items():
            object.__setattr__(self, name, value)


class _ReducingContext:
    """A slotted context whose own __reduce__ rebuilds it as type(self)."""

    __slots__ = ("extra", "tenant", "token", "trace_id")

    def __init__(self, token: str = "keep-me") -> None:
        self.extra: dict[str, Any] = {}
        self.tenant = "t-5"
        self.token = token
        self.trace_id = None

    def __reduce__(self) -> Any:
        return (type(self), (self.token,))


@pytest.mark.parametrize(
    ("engine", "shape"),
    [
        ("registry", _SlottedContext),
        ("server", _SlottedContext),
        ("registry", _BareContext),
        ("server", _BareContext),
        ("registry", _HostDict),
        ("registry", _StatefulSlots),
        ("server", _StatefulSlots),
        ("registry", _ReducingContext),
        ("server", _ReducingContext),
    ],
)
@pytest.mark.parametrize("how", ["pickle", "deepcopy"])
async def test_a_hosts_context_pickles_as_its_own_class_during_a_call(engine, shape, how):
    import copy as copying
    import pickle

    restored: list[Any] = []

    async def pickles(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        assert context.dispatch_id is not None
        if how == "pickle":
            restored.append(pickle.loads(pickle.dumps(context)))
        else:
            restored.append(copying.deepcopy(context))
        return await next_fn()

    async def handler(input: Any, context: Any) -> Any:
        return success({})

    caller = shape({"tenant": "t-3"}) if shape is _HostDict else shape()
    target = _echo_engine(engine, [pickles], handler)
    result = await target.execute("item-echo", {}, caller)
    assert result.success, result
    (copy,) = restored
    # The host's own class, its state kept, and no id.
    assert type(copy) is shape
    if shape is _HostDict:
        assert copy == {"tenant": "t-3"}
    else:
        assert copy.tenant == caller.tenant
    if hasattr(caller, "token"):
        assert copy.token == "keep-me"
    assert not hasattr(copy, "dispatch_id")


@pytest.mark.parametrize("how", ["pickle", "deepcopy"])
async def test_a_dict_context_a_middleware_adds_to_still_pickles_during_a_call(how):
    import copy as copying
    import pickle

    restored: list[Any] = []

    async def adds_then_pickles(name: str, input: Any, context: Any, next_fn: Any) -> Any:
        # Set on the call's copy, outside the host's own state: left out of the copy.
        context.added = 1
        if how == "pickle":
            restored.append(pickle.loads(pickle.dumps(context)))
        else:
            restored.append(copying.deepcopy(context))
        return await next_fn()

    async def handler(input: Any, context: Any) -> Any:
        return success({})

    target = _echo_engine("registry", [adds_then_pickles], handler)
    # A plain dict has no instance dictionary, so what was added to the call's copy is left out.
    result = await target.execute("item-echo", {}, {"tenant": "t-3"})
    assert result.success, result
    (copy,) = restored
    assert type(copy) is dict
    assert copy == {"tenant": "t-3"}
