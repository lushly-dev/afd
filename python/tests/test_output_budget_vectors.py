"""Output budgets (``spec/output-budgets.md``, B1–B8) — in-process suite.

Loads and verifies every case of ``spec/vectors/output-budgets.json`` in process
(``MCPServer``, core ``CommandRegistry``, ``DirectCommandRegistry``,
``DirectClient``, batches, pipelines, journal and replay). MCP SDK and live
transport coverage lives in ``tests/test_output_budget_mcp.py``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from afd import (
    AFD_OUTPUT_BUDGET_META_KEY,
    MAX_OUTPUT_BUDGET_BYTES,
    Actor,
    CommandResult,
    DirectCallContext,
    DirectClient,
    ErrorCodes,
    ExposeOptions,
    JournalContextDigest,
    JournalEntry,
    MemoryJournalSink,
    OutputBudget,
    WarningSeverity,
    create_command_registry,
    create_direct_registry,
    create_registry,
    fixed_clock,
    is_journal_entry,
    parse_journal,
    serialize_journal,
    success,
)
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.output_budget import measure_result_bytes
from afd.core.wire import to_wire
from afd.server import (
    ContextConfig,
    ContextField,
    check_context_fields,
    create_journal_middleware,
    create_server,
    define_command,
    replay_journal,
)

SPEC_PATH = Path(__file__).resolve().parents[2] / "spec" / "vectors" / "output-budgets.json"
SPEC_CASES = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
MCP = ExposeOptions(mcp=True)


def _assert_same_check(actual: dict[str, Any], expected: dict[str, Any], label: str) -> None:
    """Compare a result dict with ``expected`` per spec/output-budgets.md Conformance.

    Compares the full result as JSON, with ``metadata`` compared only on the
    ``dev.afd/outputBudget`` member (which must equal expected's or be absent).
    """
    left = dict(actual)
    right = dict(expected)
    left_meta = left.pop("metadata", None)
    right_meta = right.pop("metadata", None)
    left_report = left_meta.get(AFD_OUTPUT_BUDGET_META_KEY) if isinstance(left_meta, dict) else None
    right_report = (
        right_meta.get(AFD_OUTPUT_BUDGET_META_KEY) if isinstance(right_meta, dict) else None
    )
    assert left == right, f"{label}: got {actual!r}, expected {expected!r}"
    assert left_report == right_report, f"{label}: metadata report mismatch {actual!r}"
    # If expected carried handler-set metadata keys (e.g. "note"), verify they survived too.
    if isinstance(right_meta, dict):
        for key, value in right_meta.items():
            if key != AFD_OUTPUT_BUDGET_META_KEY:
                assert isinstance(left_meta, dict) and left_meta.get(key) == value, label


def _make_fixed_server(
    declaration: dict[str, Any] | None,
    result_dict: dict[str, Any],
    *,
    mutation: bool = False,
    middleware: list[Any] | None = None,
    context_hook: Any = None,
    clock: Any = None,
):
    seen: list[int | None] = []
    budget = OutputBudget.from_value(declaration) if declaration is not None else None
    server = create_server(
        "budget-test",
        tool_strategy="individual",
        middleware=middleware,
        context_hook=context_hook,
        clock=clock,
    )

    @server.command(
        name="doc-search",
        description="Search documents",
        mutation=mutation,
        output_budget=budget,
        expose=MCP,
    )
    async def doc_search(input: Any, context: CommandContext) -> CommandResult[Any]:
        seen.append(context.output_budget)
        return CommandResult.model_validate(result_dict)

    return server, seen


def _make_batch_server_from_spec(strategy: str = "individual"):
    case = SPEC_CASES["batch"]
    table = {item["id"]: CommandResult.model_validate(item["result"]) for item in case["items"]}
    server = create_server(
        "batch-budget-test",
        tool_strategy=strategy,  # type: ignore[arg-type]
        bootstrap=True,
    )
    for name, cmd in case["commands"].items():
        decl = cmd["declaration"]
        budget = OutputBudget.from_value(decl) if decl is not None else None

        def _make_handler():
            async def _handler(input: Any, context: CommandContext) -> CommandResult[Any]:
                return table[input["id"]].model_copy(deep=True)

            return _handler

        server.command(
            name=name,
            description=f"Test {name}",
            category="doc",
            mutation=bool(cmd["mutation"]),
            output_budget=budget,
            expose=MCP,
        )(_make_handler())
    return server


# ═══════════════════════════════════════════════════════════════════════════════
# B1: DECLARATIONS
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("case", SPEC_CASES["declarations"], ids=lambda c: c["description"])
def test_declarations_match_spec(case: dict[str, Any]) -> None:
    value = case["value"]
    valid = case["valid"]

    if valid:
        parsed = OutputBudget.from_value(value)
        assert parsed.default_bytes == value["defaultBytes"]
        assert parsed.max_bytes == value["maxBytes"]
        assert parsed.to_wire_dict() == value
    else:
        with pytest.raises(ValueError, match="outputBudget"):
            OutputBudget.from_value(value)

    # Every definition/registration path must reach the same verdict, naming command and field.
    async def noop(input: Any, context: CommandContext | None = None) -> CommandResult[Any]:
        return success({})

    if valid:
        decorated = define_command(name="doc-search", description="Search", output_budget=value)(
            noop
        )
        server = create_server("decl-test")
        server.register(decorated)
        registry = create_command_registry()
        registry.register(
            CommandDefinition(
                name="doc-search",
                description="Search",
                handler=noop,
                output_budget=OutputBudget(value["defaultBytes"], value["maxBytes"]),
            )
        )
    else:
        with pytest.raises(ValueError) as exc_info:
            define_command(name="doc-search", description="Search", output_budget=value)(noop)
        msg = str(exc_info.value)
        assert "doc-search" in msg and "outputBudget" in msg

        server = create_server("decl-test")
        with pytest.raises(ValueError) as exc_info:
            server.command(name="doc-search", description="Search", output_budget=value)(noop)
        msg = str(exc_info.value)
        assert "doc-search" in msg and "outputBudget" in msg

        registry = create_command_registry()
        with pytest.raises(ValueError) as exc_info:
            registry.register(
                CommandDefinition(
                    name="doc-search",
                    description="Search",
                    handler=noop,
                    output_budget=value,  # type: ignore[arg-type]
                )
            )
        msg = str(exc_info.value)
        assert "doc-search" in msg and "outputBudget" in msg


@pytest.mark.parametrize(
    ("default_bytes", "max_bytes", "expected_field"),
    [
        (True, 64, "defaultBytes"),
        (False, 64, "defaultBytes"),
        (1, True, "maxBytes"),
        (1, False, "maxBytes"),
        (1.0, 64, "defaultBytes"),
        (1, 64.5, "maxBytes"),
        (float("inf"), 64, "defaultBytes"),
        (1, float("nan"), "maxBytes"),
        (0, 64, "defaultBytes"),
        (1, MAX_OUTPUT_BUDGET_BYTES + 1, "maxBytes"),
        (65, 64, "defaultBytes"),
    ],
)
def test_output_budget_dataclass_rejects_booleans_floats_and_out_of_range(
    default_bytes: Any, max_bytes: Any, expected_field: str
) -> None:
    budget = OutputBudget(default_bytes=default_bytes, max_bytes=max_bytes)
    with pytest.raises(ValueError, match=f"outputBudget\\.{expected_field}"):
        budget.check()

    async def noop(input: Any, context: CommandContext | None = None) -> CommandResult[Any]:
        return success({})

    with pytest.raises(ValueError) as exc_info:
        define_command(name="doc-search", description="Search", output_budget=budget)(noop)
    msg = str(exc_info.value)
    assert "doc-search" in msg and expected_field in msg

    registry = create_command_registry()
    with pytest.raises(ValueError) as exc_info:
        registry.register(
            CommandDefinition(
                name="doc-search",
                description="Search",
                handler=noop,
                output_budget=budget,
            )
        )
    msg = str(exc_info.value)
    assert "doc-search" in msg and expected_field in msg


def test_from_value_rejects_booleans_and_floats() -> None:
    with pytest.raises(ValueError, match="defaultBytes"):
        OutputBudget.from_value({"defaultBytes": True, "maxBytes": 64})
    with pytest.raises(ValueError, match="maxBytes"):
        OutputBudget.from_value({"defaultBytes": 1, "maxBytes": True})
    with pytest.raises(ValueError, match="defaultBytes"):
        OutputBudget.from_value({"defaultBytes": 16.0, "maxBytes": 64})
    with pytest.raises(ValueError, match="maxBytes"):
        OutputBudget.from_value({"defaultBytes": 16, "maxBytes": 64.0})
    with pytest.raises(ValueError, match="doc-search"):
        server = create_server("float-decl-test")
        server.command(
            name="doc-search",
            description="Search",
            output_budget={"defaultBytes": 16.0, "maxBytes": 64.0},
        )(lambda _i, _c: success({}))


# ═══════════════════════════════════════════════════════════════════════════════
# B1: SURFACES (TOOLS, GROUPED, HYBRID, AFD-DETAIL, AFD-HELP, AFD-DOCS, DISCOVER)
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_declaration_surfaces_across_all_strategies() -> None:
    def make(strategy: str):
        server = create_server(
            "surface-test",
            tool_strategy=strategy,  # type: ignore[arg-type]
            bootstrap=True,
            contexts=[ContextConfig(name="reading")],
            **({"first_class_tools": ["doc-search"]} if strategy == "hybrid" else {}),
        )

        @server.command(
            name="doc-search",
            description="Search documents",
            category="doc",
            output_budget=OutputBudget(default_bytes=64, max_bytes=128),
            expose=MCP,
        )
        async def doc_search(input: Any, context: CommandContext) -> CommandResult[Any]:
            return success({})

        @server.command(
            name="doc-open",
            description="Open a document",
            category="doc",
            expose=MCP,
        )
        async def doc_open(input: Any, context: CommandContext) -> CommandResult[Any]:
            return success({})

        return server

    # Individual
    ind_tools = {t["name"]: t for t in make("individual").get_tool_definitions()}
    assert ind_tools["doc-search"]["_meta"][AFD_OUTPUT_BUDGET_META_KEY] == {
        "defaultBytes": 64,
        "maxBytes": 128,
    }
    assert AFD_OUTPUT_BUDGET_META_KEY not in (ind_tools["doc-open"].get("_meta") or {})
    for builtin in (
        "afd-discover",
        "afd-detail",
        "afd-call",
        "afd-batch",
        "afd-pipe",
        "afd-context-list",
        "afd-context-enter",
        "afd-context-exit",
    ):
        assert AFD_OUTPUT_BUDGET_META_KEY not in (ind_tools[builtin].get("_meta") or {})

    # Hybrid: first-class tool equals individual tool byte-for-byte
    hyb_tools = {t["name"]: t for t in make("hybrid").get_tool_definitions()}
    assert hyb_tools["doc-search"] == ind_tools["doc-search"]
    for builtin in ("afd-discover", "afd-detail", "afd-call", "afd-batch", "afd-pipe"):
        assert AFD_OUTPUT_BUDGET_META_KEY not in (hyb_tools[builtin].get("_meta") or {})

    # Grouped: in _meta.actions entry only, NEVER on grouped tool itself
    grp_tools = {t["name"]: t for t in make("grouped").get_tool_definitions()}
    doc_group = grp_tools["doc"]
    assert AFD_OUTPUT_BUDGET_META_KEY not in doc_group["_meta"]
    actions = {entry["command"]: entry for entry in doc_group["_meta"]["actions"]}
    assert actions["doc-search"][AFD_OUTPUT_BUDGET_META_KEY] == {
        "defaultBytes": 64,
        "maxBytes": 128,
    }
    assert AFD_OUTPUT_BUDGET_META_KEY not in actions["doc-open"]

    # afd-detail (every strategy), afd-help (full vs brief), afd-docs, afd-discover
    for strategy in ("individual", "grouped", "lazy", "hybrid"):
        srv = make(strategy)
        detail = await srv.route_tool_call("afd-detail", {"command": ["doc-search", "doc-open"]})
        assert detail.success is True
        assert detail.data[0]["outputBudget"] == {"defaultBytes": 64, "maxBytes": 128}
        assert "outputBudget" not in detail.data[1]

        discover = await srv.route_tool_call("afd-discover", {})
        assert discover.success is True
        for entry in discover.data["commands"]:
            assert "outputBudget" not in entry
            assert AFD_OUTPUT_BUDGET_META_KEY not in entry

    srv = make("individual")
    help_full = to_wire(await srv.execute("afd-help", {"format": "full"}))
    by_name_full = {c["name"]: c for c in help_full["data"]["commands"]}
    assert by_name_full["doc-search"]["outputBudget"] == {"defaultBytes": 64, "maxBytes": 128}
    assert "outputBudget" not in by_name_full["doc-open"]

    help_brief = to_wire(await srv.execute("afd-help", {"format": "brief"}))
    by_name_brief = {c["name"]: c for c in help_brief["data"]["commands"]}
    assert "outputBudget" not in by_name_brief["doc-search"]

    docs = await srv.execute("afd-docs", {"command": "doc-search"})
    assert "64" in docs.data.markdown and "128" in docs.data.markdown
    docs_open = await srv.execute("afd-docs", {"command": "doc-open"})
    assert "Output budget" not in docs_open.data.markdown


# ═══════════════════════════════════════════════════════════════════════════════
# B2–B4: RESERVED CONTEXT NAMES, ASKS, VALIDATION, EFFECTIVE BUDGET (IN PROCESS)
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("reserved", ["outputBudget", "output_budget", "output_budget_ask"])
def test_output_budget_names_are_reserved_context_fields(reserved: str) -> None:
    with pytest.raises(ValueError, match=reserved):
        check_context_fields([ContextField(name=reserved, meta="dev.example/budget", schema=int)])
    with pytest.raises(ValueError, match=reserved):
        create_server(
            "reserved-test",
            context_fields=[ContextField(name=reserved, meta="dev.example/budget", schema=int)],
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("case", SPEC_CASES["asks"], ids=lambda c: c["description"])
async def test_asks_in_process_server_and_core_registry(case: dict[str, Any]) -> None:
    label = case["description"]
    server, seen = _make_fixed_server(case["declaration"], {"success": True})

    # Pass raw ask via context._output_budget_ask so every JSON shape in the spec runs in process.
    ctx = CommandContext(_output_budget_ask=case["ask"]) if "ask" in case else None
    result = await server.execute("doc-search", {}, ctx)

    if case["effective"] == "VALIDATION_ERROR":
        assert result.success is False, label
        assert result.error is not None
        assert result.error.code == ErrorCodes.VALIDATION_ERROR
        assert result.error.details == {
            "field": "outputBudget",
            "meta": AFD_OUTPUT_BUDGET_META_KEY,
        }
        assert result.error.suggestion is not None
        assert '{ "maxBytes": <positive integer> }' in result.error.suggestion
        assert seen == [], f"{label}: handler must not run on invalid ask"
    else:
        assert seen == [case["effective"]], f"{label}: got {seen}, result={result}"

    # Also test core CommandRegistry directly with the same cases.
    core_seen: list[int | None] = []
    registry = create_command_registry()
    budget = (
        OutputBudget.from_value(case["declaration"]) if case["declaration"] is not None else None
    )

    async def core_handler(input: Any, context: CommandContext | None = None) -> CommandResult[Any]:
        core_seen.append(context.output_budget if context is not None else None)
        return success({})

    registry.register(
        CommandDefinition(
            name="doc-search",
            description="Search",
            handler=core_handler,
            output_budget=budget,
        )
    )
    core_ctx = CommandContext(_output_budget_ask=case["ask"]) if "ask" in case else None
    core_result = await registry.execute("doc-search", {}, core_ctx)
    if case["effective"] == "VALIDATION_ERROR":
        assert core_result.success is False and core_result.error is not None
        assert core_result.error.code == ErrorCodes.VALIDATION_ERROR
        assert core_seen == []
    else:
        assert core_seen == [case["effective"]]


@pytest.mark.asyncio
async def test_in_process_output_budget_kwarg_and_bool_rejection() -> None:
    seen: list[int | None] = []

    @define_command(
        name="doc-search",
        description="Search",
        output_budget=OutputBudget(default_bytes=64, max_bytes=128),
        expose=ExposeOptions(agent=True, mcp=True),
    )
    async def doc_search(input: Any, context: CommandContext) -> CommandResult[Any]:
        seen.append(context.output_budget)
        return success({"ok": True})

    server = create_server("kwarg-test")
    server.register(doc_search)
    assert (await server.execute("doc-search", {}, output_budget=100)).success is True
    assert seen[-1] == 100
    assert (await server.execute("doc-search", {}, output_budget=500)).success is True
    assert seen[-1] == 128

    for bad in (True, False, 0, -5, 10.5, "100", MAX_OUTPUT_BUDGET_BYTES + 1):
        res = await server.execute("doc-search", {}, output_budget=bad)
        assert res.success is False and res.error is not None, f"expected error for {bad!r}"
        assert res.error.code == ErrorCodes.VALIDATION_ERROR
        assert res.error.details == {"field": "outputBudget", "meta": AFD_OUTPUT_BUDGET_META_KEY}

    # DirectCommandRegistry and DirectClient
    direct_registry = create_direct_registry([doc_search])
    client = DirectClient(direct_registry)

    res = await client.call("doc-search", {}, output_budget=90)
    assert res.success is True and seen[-1] == 90

    res = await client.call("doc-search", {}, DirectCallContext(output_budget=80))
    assert res.success is True and seen[-1] == 80

    # Explicit output_budget kwarg wins over DirectCallContext.output_budget
    res = await client.call("doc-search", {}, DirectCallContext(output_budget=80), output_budget=70)
    assert res.success is True and seen[-1] == 70

    # Invalid ask on DirectClient fails with VALIDATION_ERROR
    bad_direct = await client.call("doc-search", {}, output_budget=True)
    assert bad_direct.success is False and bad_direct.error is not None
    assert bad_direct.error.code == ErrorCodes.VALIDATION_ERROR
    assert bad_direct.error.details == {
        "field": "outputBudget",
        "meta": AFD_OUTPUT_BUDGET_META_KEY,
    }

    # DirectCommandRegistry.execute(..., output_budget=...)
    res = await direct_registry.execute("doc-search", {}, output_budget=75)
    assert res.success is True and seen[-1] == 75


@pytest.mark.asyncio
async def test_invalid_ask_fails_before_middleware_and_handler() -> None:
    middleware_ran = False

    async def spy_middleware(name: str, input: Any, context: CommandContext, next_fn: Any):
        nonlocal middleware_ran
        middleware_ran = True
        return await next_fn()

    # Unbudgeted command still validates and rejects an invalid ask before middleware!
    server, seen = _make_fixed_server(None, {"success": True}, middleware=[spy_middleware])
    result = await server.execute("doc-search", {}, output_budget=0)
    assert result.success is False and result.error is not None
    assert result.error.code == ErrorCodes.VALIDATION_ERROR
    assert middleware_ran is False
    assert seen == []


# ═══════════════════════════════════════════════════════════════════════════════
# B5 & B6: MEASURE, CHECKS, REPORT, MIDDLEWARE & JOURNAL OBSERVABILITY
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize("case", SPEC_CASES["measure"], ids=lambda c: c["description"])
async def test_measure_matches_every_spec_case(case: dict[str, Any]) -> None:
    label = case["description"]
    expected_bytes = case["bytes"]
    parsed = json.loads(case["json"])
    assert measure_result_bytes(parsed) == expected_bytes, label

    # For cases whose CommandResult round-trips identically through to_wire, also verify via the engine.
    result_obj = CommandResult.model_validate(parsed)
    stripped_parsed = {k: v for k, v in parsed.items() if k != "metadata"}
    stripped_wire = {k: v for k, v in to_wire(result_obj).items() if k != "metadata"}
    if stripped_wire == stripped_parsed:
        server, _ = _make_fixed_server(
            {"defaultBytes": expected_bytes, "maxBytes": expected_bytes}, parsed
        )
        fits = await server.execute("doc-search", {})
        assert fits.success is True, label
        assert to_wire(fits)["metadata"][AFD_OUTPUT_BUDGET_META_KEY] == {
            "limitBytes": expected_bytes,
            "usedBytes": expected_bytes,
        }
        if expected_bytes > 1:
            tight, _ = _make_fixed_server(
                {"defaultBytes": expected_bytes - 1, "maxBytes": expected_bytes - 1}, parsed
            )
            over = await tight.execute("doc-search", {})
            assert over.success is False and over.error is not None, label
            assert over.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED
            assert over.error.details is not None
            assert over.error.details["actualBytes"] == expected_bytes


@pytest.mark.asyncio
@pytest.mark.parametrize("case", SPEC_CASES["checks"], ids=lambda c: c["description"])
async def test_checks_match_spec_in_process(case: dict[str, Any]) -> None:
    label = case["description"]
    server, _ = _make_fixed_server(
        case["declaration"], case["result"], mutation=bool(case["mutation"])
    )
    ctx = CommandContext(_output_budget_ask=case["ask"]) if "ask" in case else None
    result = await server.execute("doc-search", {}, ctx)
    _assert_same_check(to_wire(result), case["expected"], label)


@pytest.mark.asyncio
async def test_middleware_and_journal_observe_checked_result_and_metadata_is_stamped() -> None:
    middleware_seen: list[CommandResult[Any]] = []
    sink = MemoryJournalSink()

    async def observer(name: str, input: Any, context: CommandContext, next_fn: Any):
        result = await next_fn()
        middleware_seen.append(result)
        return result

    server, _ = _make_fixed_server(
        {"defaultBytes": 64, "maxBytes": 128},
        {"success": True, "data": {"text": "x" * 200}},
        middleware=[observer, create_journal_middleware(sink, record_failures=True)],
        clock=fixed_clock("2026-01-01T00:00:00Z"),
    )
    result = await server.execute(
        "doc-search",
        {},
        CommandContext(trace_id="t-1", actor=Actor(kind="agent")),
    )
    assert result.success is False and result.error is not None
    assert result.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED
    assert result.metadata is not None
    assert result.metadata.actor_kind == "agent"
    assert result.metadata.trace_id == "t-1"
    assert AFD_OUTPUT_BUDGET_META_KEY not in to_wire(result)["metadata"]

    assert len(middleware_seen) == 1
    assert middleware_seen[0].error is not None
    assert middleware_seen[0].error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED

    entries = await sink.read()
    assert len(entries) == 1
    assert entries[0].output_budget == 64
    assert entries[0].result["error"]["code"] == ErrorCodes.OUTPUT_BUDGET_EXCEEDED


@pytest.mark.asyncio
async def test_handler_mutating_context_output_budget_cannot_bypass_check() -> None:
    server = create_server("tamper-test")

    @server.command(
        name="doc-search",
        description="Tries to raise its own budget",
        output_budget=OutputBudget(default_bytes=32, max_bytes=64),
        expose=MCP,
    )
    async def doc_search(input: Any, context: CommandContext) -> CommandResult[Any]:
        context.output_budget = 999_999
        return success({"text": "x" * 100})

    result = await server.execute("doc-search", {})
    assert result.success is False and result.error is not None
    assert result.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED
    assert result.error.details is not None
    assert result.error.details["limitBytes"] == 32


@pytest.mark.asyncio
async def test_check_does_not_mutate_handlers_shared_result_or_warnings() -> None:
    shared_warnings = [{"code": "EXISTING", "message": "already here", "severity": "info"}]
    shared = CommandResult.model_validate(
        {
            "success": True,
            "data": {"text": "x" * 100},
            "warnings": shared_warnings,
            "metadata": {"note": "original"},
        }
    )
    server = create_server("immutability-test")

    @server.command(
        name="doc-mutate",
        description="Returns a shared result object",
        mutation=True,
        output_budget=OutputBudget(default_bytes=32, max_bytes=64),
        expose=MCP,
    )
    async def doc_mutate(input: Any, context: CommandContext) -> CommandResult[Any]:
        return shared

    result = await server.execute("doc-mutate", {})
    assert result.success is True
    assert len(result.warnings or []) == 2
    assert len(shared.warnings or []) == 1
    assert AFD_OUTPUT_BUDGET_META_KEY not in to_wire(shared)["metadata"]
    assert AFD_OUTPUT_BUDGET_META_KEY in to_wire(result)["metadata"]


# ═══════════════════════════════════════════════════════════════════════════════
# B7: BATCHES AND PIPELINES (IN PROCESS)
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_batch_and_pipeline_in_process_per_item_and_stop_on_error() -> None:
    case = SPEC_CASES["batch"]
    server = _make_batch_server_from_spec()
    ask = case["ask"]["maxBytes"]

    batch = await server.execute(
        "afd-batch",
        {
            "commands": [
                {"id": item["id"], "command": item["command"], "input": {"id": item["id"]}}
                for item in case["items"]
            ]
        },
        output_budget=ask,
    )
    assert len(batch.results) == len(case["items"])
    for item, got in zip(case["items"], batch.results, strict=True):
        _assert_same_check(to_wire(got.result), item["expected"], item["id"])
    assert batch.summary.failure_count == 1

    # stopOnError stops after replaced over-budget read item "d"
    stopped = await server.execute(
        "afd-batch",
        {
            "commands": [
                {"id": "d", "command": "doc-open", "input": {"id": "d"}},
                {"id": "b", "command": "doc-open", "input": {"id": "b"}},
            ],
            "options": {"stopOnError": True},
        },
        output_budget=ask,
    )
    assert stopped.results[0].result.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED
    assert stopped.results[1].result.error.code == ErrorCodes.COMMAND_SKIPPED

    # afd-pipe stops on replaced over-budget step "d"
    piped = await server.execute(
        "afd-pipe",
        {
            "steps": [
                {"command": "doc-search", "input": {"id": "a"}},
                {"command": "doc-open", "input": {"id": "d"}},
                {"command": "doc-open", "input": {"id": "b"}},
            ]
        },
        output_budget=ask,
    )
    assert piped.steps[0].status.value == "success"
    assert piped.steps[1].status.value == "failure"
    assert piped.steps[1].error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED
    assert piped.steps[2].status.value != "success"

    # DirectClient.pipe(..., output_budget=ask) checks every step too
    table = {item["id"]: CommandResult.model_validate(item["result"]) for item in case["items"]}

    @define_command(
        name="doc-search",
        description="Search",
        output_budget=OutputBudget(64, 128),
        expose=ExposeOptions(agent=True, mcp=True),
    )
    async def dc_search(input: Any) -> CommandResult[Any]:
        return table[input["id"]].model_copy(deep=True)

    @define_command(
        name="doc-open",
        description="Open",
        output_budget=OutputBudget(100, 200),
        expose=ExposeOptions(agent=True, mcp=True),
    )
    async def dc_open(input: Any) -> CommandResult[Any]:
        return table[input["id"]].model_copy(deep=True)

    client = DirectClient(create_direct_registry([dc_search, dc_open]))
    dc_pipe = await client.pipe(
        [
            {"command": "doc-search", "input": {"id": "a"}},
            {"command": "doc-open", "input": {"id": "d"}},
            {"command": "doc-open", "input": {"id": "b"}},
        ],
        output_budget=ask,
    )
    assert dc_pipe.success is False
    assert len(dc_pipe.steps) == 2
    assert dc_pipe.steps[0].result.success is True
    assert dc_pipe.steps[1].result.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED


# ═══════════════════════════════════════════════════════════════════════════════
# B8: JOURNAL & REPLAY
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize("case", SPEC_CASES["journal"], ids=lambda c: c["description"])
async def test_journal_records_and_replays_spec_cases(case: dict[str, Any]) -> None:
    label = case["description"]
    sink = MemoryJournalSink()
    clock = fixed_clock("2026-01-01T00:00:00Z")
    server, _ = _make_fixed_server(
        case["declaration"],
        {"success": True},
        middleware=[create_journal_middleware(sink)],
        clock=clock,
    )
    ctx = CommandContext(_output_budget_ask=case["ask"]) if "ask" in case else None
    result = await server.execute("doc-search", {}, ctx)
    assert result.success is True, label

    entries = await sink.read()
    assert len(entries) == 1
    assert entries[0].output_budget == case["expected"], label

    # Check wire JSON key order: outputBudget sits after contextOmitted (or contextDigest) and before result.
    line = serialize_journal(entries)
    raw = json.loads(line.strip())
    assert raw.get("outputBudget") == case["expected"], label
    if case["expected"] is not None:
        keys = list(raw.keys())
        assert keys.index("contextDigest") < keys.index("outputBudget") < keys.index("result")
    else:
        assert "outputBudget" not in raw
    assert parse_journal(line) == entries

    # Replay restores outputBudget as the ask so the replayed call gets the same effective budget.
    fresh, replayed_seen = _make_fixed_server(case["declaration"], {"success": True}, clock=clock)
    report = await replay_journal(fresh, entries)
    assert report.entries[0].status == "same", label
    assert replayed_seen == [case["expected"]], label


@pytest.mark.asyncio
async def test_lowered_max_changes_replayed_result_and_report_shows_why() -> None:
    body = {"success": True, "data": {"text": "x" * 40}}
    clock = fixed_clock("2026-01-01T00:00:00Z")
    sink = MemoryJournalSink()

    server, _ = _make_fixed_server(
        {"defaultBytes": 32, "maxBytes": 128},
        body,
        middleware=[create_journal_middleware(sink, record_failures=True)],
        clock=clock,
    )
    res = await server.execute("doc-search", {}, output_budget=128)
    assert res.success is True
    entries = await sink.read()
    assert entries[0].output_budget == 128

    lowered, _ = _make_fixed_server({"defaultBytes": 32, "maxBytes": 48}, body, clock=clock)
    report = await replay_journal(lowered, entries)
    assert report.entries[0].status == "different"
    assert report.entries[0].replayed.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED
    assert report.entries[0].replayed.error.details["limitBytes"] == 48


@pytest.mark.asyncio
async def test_context_digest_changes_only_when_effective_budget_is_present() -> None:
    sink = MemoryJournalSink()
    clock = fixed_clock("2026-01-01T00:00:00Z")
    server = create_server(
        "digest-test",
        clock=clock,
        middleware=[create_journal_middleware(sink)],
    )

    @server.command(
        name="doc-search",
        description="Budgeted",
        output_budget=OutputBudget(64, 128),
        expose=MCP,
    )
    async def doc_search(input: Any, context: CommandContext) -> CommandResult[Any]:
        return success({})

    @server.command(name="doc-open", description="Unbudgeted", expose=MCP)
    async def doc_open(input: Any, context: CommandContext) -> CommandResult[Any]:
        return success({})

    await server.execute("doc-search", {}, CommandContext(trace_id="t-1"))
    await server.execute("doc-open", {}, CommandContext(trace_id="t-1"))
    await server.execute("doc-open", {}, CommandContext(trace_id="t-1"), output_budget=50)
    await server.execute("doc-search", {}, CommandContext(trace_id="t-1"), output_budget=128)

    entries = await sink.read()
    # Unbudgeted without ask and unbudgeted with ask keep the exact same digest hash.
    assert entries[1].context_digest.hash == entries[2].context_digest.hash
    # Budgeted default (64) differs from unbudgeted and from budgeted with ask (128).
    assert entries[0].context_digest.hash != entries[1].context_digest.hash
    assert entries[0].context_digest.hash != entries[3].context_digest.hash


@pytest.mark.parametrize("bad", [0, -1, True, False, 1.5, "64", MAX_OUTPUT_BUDGET_BYTES + 1, None])
def test_is_journal_entry_rejects_invalid_output_budget(bad: Any) -> None:
    base = {
        "seq": 1,
        "timestamp": "2026-01-01T00:00:00.000Z",
        "command": "doc-search",
        "input": {},
        "contextDigest": {"hash": "sha256:0"},
        "outputBudget": bad,
        "result": {"success": True},
        "durationMs": 1,
    }
    assert is_journal_entry(base) is False


# ═══════════════════════════════════════════════════════════════════════════════
# EDGE CASES & REVIEW REGRESSIONS
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_dict_envelope_results_are_checked_by_b5() -> None:
    server = create_server("dict-envelope-test", tool_strategy="individual", bootstrap=True)

    @server.command(
        name="doc-raw",
        description="Returns dict envelope",
        output_budget=OutputBudget(default_bytes=48, max_bytes=64),
        expose=MCP,
    )
    async def doc_raw(input: Any, context: CommandContext) -> Any:
        return {"success": True, "data": {"text": "x" * int(input.get("size", 80))}}

    # Over-budget dict envelope via server.execute
    over = await server.execute("doc-raw", {"size": 80})
    assert isinstance(over, CommandResult)
    assert over.success is False
    assert over.error is not None and over.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED

    # Over-budget dict envelope via afd-batch
    batch = await server.execute(
        "afd-batch", {"commands": [{"id": "a", "command": "doc-raw", "input": {"size": 80}}]}
    )
    assert batch.results[0].result.success is False
    assert batch.results[0].result.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED

    # Within-budget dict envelope carries report
    fits = await server.execute("doc-raw", {"size": 2})
    assert isinstance(fits, CommandResult) and fits.success is True
    assert to_wire(fits)["metadata"][AFD_OUTPUT_BUDGET_META_KEY]["limitBytes"] == 48

    # Core CommandRegistry also checks dict envelopes
    registry = create_command_registry()

    async def raw_handler(input: Any, context: CommandContext) -> Any:
        return {"success": True, "data": {"text": "x" * 80}}

    registry.register(
        CommandDefinition(
            name="doc-raw",
            description="Returns dict envelope",
            handler=raw_handler,
            output_budget=OutputBudget(default_bytes=32, max_bytes=64),
        )
    )
    reg_over = await registry.execute("doc-raw", {})
    assert isinstance(reg_over, CommandResult) and reg_over.success is False
    assert reg_over.error is not None and reg_over.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED


@pytest.mark.asyncio
async def test_direct_client_with_simple_registry_rejects_invalid_ask_before_middleware_and_handler() -> (
    None
):
    registry = create_registry()
    ran: list[str] = []

    @registry.command(name="doc-tag", description="Unbudgeted command")
    async def doc_tag() -> CommandResult[Any]:
        ran.append("handler")
        return success({"ok": True})

    async def mw(name: str, args: Any, ctx: Any, nxt: Any) -> CommandResult[Any]:
        ran.append("middleware")
        return await nxt()

    from afd.direct import DirectClientOptions

    client = DirectClient(registry, DirectClientOptions(middleware=[mw]))

    # Invalid ask on unbudgeted command via call() fails before middleware and handler
    bad_call = await client.call("doc-tag", {}, output_budget=True)
    assert bad_call.success is False
    assert bad_call.error is not None
    assert bad_call.error.code == ErrorCodes.VALIDATION_ERROR
    assert bad_call.error.details == {"field": "outputBudget", "meta": AFD_OUTPUT_BUDGET_META_KEY}
    assert ran == []

    # Invalid ask via DirectCallContext also fails before middleware and handler
    bad_ctx = await client.call("doc-tag", {}, DirectCallContext(output_budget=0))
    assert bad_ctx.success is False and bad_ctx.error.code == ErrorCodes.VALIDATION_ERROR
    assert ran == []

    # Invalid ask via pipe() fails up front (even with empty steps or valid steps)
    bad_pipe = await client.pipe([{"command": "doc-tag"}], output_budget=True)
    assert bad_pipe.success is False
    assert bad_pipe.final is not None and bad_pipe.final.error is not None
    assert bad_pipe.final.error.code == ErrorCodes.VALIDATION_ERROR
    assert ran == []

    empty_bad_pipe = await client.pipe([], output_budget=False)
    assert empty_bad_pipe.success is False
    assert empty_bad_pipe.final is not None and empty_bad_pipe.final.error is not None
    assert empty_bad_pipe.final.error.code == ErrorCodes.VALIDATION_ERROR


@pytest.mark.asyncio
async def test_in_process_meta_tools_lift_meta_argument_and_respect_option_precedence() -> None:
    seen: list[int | None] = []
    server = create_server("inproc-meta-test", tool_strategy="individual", bootstrap=True)

    @server.command(
        name="doc-search",
        description="Search",
        output_budget=OutputBudget(default_bytes=64, max_bytes=128),
        expose=MCP,
    )
    async def doc_search(input: Any, context: CommandContext) -> CommandResult[Any]:
        seen.append(context.output_budget)
        return success({"effective": context.output_budget})

    # afd-call lifts meta["dev.afd/outputBudget"]
    via_call = await server.execute(
        "afd-call",
        {
            "command": "doc-search",
            "input": {},
            "meta": {AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 100}},
        },
    )
    assert via_call.success is True
    assert to_wire(via_call)["metadata"][AFD_OUTPUT_BUDGET_META_KEY]["limitBytes"] == 100
    assert seen[-1] == 100

    # Trusted in-process output_budget kwarg wins over meta argument
    override = await server.execute(
        "afd-call",
        {
            "command": "doc-search",
            "input": {},
            "meta": {AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 100}},
        },
        output_budget=40,
    )
    assert override.success is True
    assert to_wire(override)["metadata"][AFD_OUTPUT_BUDGET_META_KEY]["limitBytes"] == 40
    assert seen[-1] == 40

    # afd-batch and afd-pipe also lift meta["dev.afd/outputBudget"]
    via_batch = await server.execute(
        "afd-batch",
        {
            "commands": [{"id": "a", "command": "doc-search", "input": {}}],
            "meta": {AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 90}},
        },
    )
    assert (
        to_wire(via_batch.results[0].result)["metadata"][AFD_OUTPUT_BUDGET_META_KEY]["limitBytes"]
        == 90
    )

    via_pipe = await server.execute(
        "afd-pipe",
        {
            "steps": [{"command": "doc-search", "input": {}}],
            "meta": {AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 80}},
        },
    )
    assert via_pipe.steps[0].data == {"effective": 80}
    assert seen[-1] == 80

    via_pipe_over = await server.execute(
        "afd-pipe",
        {
            "steps": [{"command": "doc-search", "input": {}}],
            "meta": {AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 10}},
        },
    )
    assert via_pipe_over.steps[0].status == "failure"
    assert via_pipe_over.steps[0].error is not None
    assert via_pipe_over.steps[0].error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED


@pytest.mark.asyncio
async def test_journal_digest_uses_captured_effective_budget_when_handler_mutates_context() -> None:
    sink = MemoryJournalSink()
    server = create_server(
        "journal-tamper-test",
        middleware=[create_journal_middleware(sink, record_failures=True)],
        clock=fixed_clock("2026-01-01T00:00:00Z"),
    )

    @server.command(
        name="doc-tamper",
        description="Mutates context.output_budget",
        output_budget=OutputBudget(default_bytes=64, max_bytes=128),
    )
    async def doc_tamper(input: Any, context: CommandContext) -> CommandResult[Any]:
        context.output_budget = input["mutated"]
        return success({"ok": True})

    await server.execute("doc-tamper", {"mutated": 70}, CommandContext(trace_id="t-same"))
    await server.execute("doc-tamper", {"mutated": 71}, CommandContext(trace_id="t-same"))

    entries = await sink.read()
    assert entries[0].output_budget == 64
    assert entries[1].output_budget == 64
    assert entries[0].context_digest.hash == entries[1].context_digest.hash


def test_journal_entry_positional_signature_unchanged() -> None:
    digest = JournalContextDigest(hash="sha256:abc", interface="mcp")
    entry = JournalEntry(
        "2026-01-01T00:00:00.000Z",
        "doc-search",
        {},
        digest,
        {"success": True},
        1.0,
        "trace-1",
        Actor(kind="agent"),
        None,
        None,
        None,
        17,
    )
    assert entry.seq == 17
    assert entry.output_budget is None


@pytest.mark.asyncio
async def test_frozen_context_still_enforces_output_budget_check() -> None:
    @dataclass(frozen=True)
    class FrozenContext:
        trace_id: str = "t-frozen"
        extra: dict[str, Any] = field(default_factory=dict)

    registry = create_command_registry()

    async def big_handler(input: Any, context: Any) -> CommandResult[Any]:
        return success({"text": "x" * 100})

    registry.register(
        CommandDefinition(
            name="doc-big",
            description="Big read",
            handler=big_handler,
            output_budget=OutputBudget(default_bytes=32, max_bytes=64),
        )
    )
    res = await registry.execute("doc-big", {}, FrozenContext())  # type: ignore[arg-type]
    assert res.success is False
    assert res.error is not None and res.error.code == ErrorCodes.OUTPUT_BUDGET_EXCEEDED


def test_measure_result_bytes_serializes_models_and_enums_inside_mappings() -> None:
    raw = {
        "success": True,
        "data": {"severity": WarningSeverity.CAUTION, "nested": None},
        "metadata": {"ignored": "x" * 200},
    }
    expected = {"success": True, "data": {"severity": "caution", "nested": None}}
    assert measure_result_bytes(raw) == measure_result_bytes(expected)
