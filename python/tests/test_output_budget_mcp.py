"""Output budgets over MCP transports (``spec/output-budgets.md``, B1–B8).

Exercises ``spec/vectors/output-budgets.json`` over MCP (in-process SDK client, Streamable
HTTP stateful/stateless, SSE and stdio) in both MCP eras (2026-07-28 modern and
2025 legacy). Separated from ``tests/test_output_budget_vectors.py`` so pure in-process
tests run even when the optional ``mcp`` extra is not installed.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("mcp.client.streamable_http")

from mcp import Client, ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.sse import sse_client  # noqa: E402

from afd import (  # noqa: E402
    AFD_OUTPUT_BUDGET_META_KEY,
    CommandResult,
    ErrorCodes,
    ExposeOptions,
    MemoryJournalSink,
    OutputBudget,
    fixed_clock,
    success,
)
from afd.core.commands import CommandContext  # noqa: E402
from afd.server import (  # noqa: E402
    ContextHookRequest,
    create_journal_middleware,
    create_server,
)
from tests.test_mcp_protocol_live import protocol_server  # noqa: E402
from tests.test_output_budget_vectors import (  # noqa: E402
    SPEC_CASES,
    _assert_same_check,
    _make_batch_server_from_spec,
    _make_fixed_server,
)

MCP = ExposeOptions(mcp=True)
MODERN = "2026-07-28"
FIXTURE = "output_budget_server.py"


def _payload(tool_result: Any) -> dict[str, Any]:
    parsed = json.loads(tool_result.content[0].text)
    if tool_result.structured_content is not None:
        assert tool_result.structured_content == parsed
    return parsed


# ═══════════════════════════════════════════════════════════════════════════════
# OVER MCP: IN-PROCESS CLIENT, BOTH ERAS
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_mcp_asks_on_both_eras(mode: str) -> None:
    for case in SPEC_CASES["asks"]:
        label = f"{mode}: {case['description']}"
        server, seen = _make_fixed_server(case["declaration"], {"success": True})
        meta = {AFD_OUTPUT_BUDGET_META_KEY: case["ask"]} if "ask" in case else None
        async with Client(server._create_mcp_server(), mode=mode) as client:
            assert (client.protocol_version == MODERN) is (mode == "auto")
            res = await client.call_tool("doc-search", {}, meta=meta)
            data = _payload(res)
            if case["effective"] == "VALIDATION_ERROR":
                assert res.is_error is True, label
                assert data["success"] is False
                assert data["error"]["code"] == ErrorCodes.VALIDATION_ERROR
                assert data["error"]["details"] == {
                    "field": "outputBudget",
                    "meta": AFD_OUTPUT_BUDGET_META_KEY,
                }
                assert '{ "maxBytes": <positive integer> }' in data["error"]["suggestion"]
                assert seen == [], label
            else:
                assert seen == [case["effective"]], f"{label}: {data}"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_mcp_checks_on_both_eras(mode: str) -> None:
    for case in SPEC_CASES["checks"]:
        label = f"{mode}: {case['description']}"
        server, _ = _make_fixed_server(
            case["declaration"], case["result"], mutation=bool(case["mutation"])
        )
        meta = {AFD_OUTPUT_BUDGET_META_KEY: case["ask"]} if "ask" in case else None
        async with Client(server._create_mcp_server(), mode=mode) as client:
            res = await client.call_tool("doc-search", {}, meta=meta)
            data = _payload(res)
            assert res.is_error is (data["success"] is False), label
            _assert_same_check(data, case["expected"], label)


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_mcp_batch_pipe_call_grouped_meta_argument_and_discover_invariance(mode: str) -> None:
    case = SPEC_CASES["batch"]
    ask = case["ask"]
    items = [
        {"id": item["id"], "command": item["command"], "input": {"id": item["id"]}}
        for item in case["items"]
    ]

    async with Client(
        _make_batch_server_from_spec("grouped")._create_mcp_server(), mode=mode
    ) as client:
        # tools/list never varies by an ask
        plain = await client.list_tools()
        with_ask = await client.list_tools(
            meta={AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 10}}, cache_mode="bypass"
        )
        assert with_ask.tools == plain.tools
        assert with_ask.ttl_ms == plain.ttl_ms

        # afd-batch via _meta and via meta argument
        for by_arg in (False, True):
            if by_arg:
                res = await client.call_tool(
                    "afd-batch",
                    {"commands": items, "meta": {AFD_OUTPUT_BUDGET_META_KEY: ask}},
                )
            else:
                res = await client.call_tool(
                    "afd-batch",
                    {"commands": items},
                    meta={AFD_OUTPUT_BUDGET_META_KEY: ask},
                )
            body = _payload(res)
            assert len(body["results"]) == len(case["items"])
            for item, got in zip(case["items"], body["results"], strict=True):
                _assert_same_check(
                    got["result"], item["expected"], f"{mode} by_arg={by_arg} {item['id']}"
                )

        # afd-pipe via _meta and meta argument
        for by_arg in (False, True):
            steps = [
                {"command": "doc-search", "input": {"id": "a"}},
                {"command": "doc-open", "input": {"id": "d"}},
                {"command": "doc-open", "input": {"id": "b"}},
            ]
            if by_arg:
                res = await client.call_tool(
                    "afd-pipe", {"steps": steps, "meta": {AFD_OUTPUT_BUDGET_META_KEY: ask}}
                )
            else:
                res = await client.call_tool(
                    "afd-pipe", {"steps": steps}, meta={AFD_OUTPUT_BUDGET_META_KEY: ask}
                )
            body = _payload(res)
            assert body["steps"][0]["status"] == "success"
            assert body["steps"][1]["status"] == "failure"
            assert body["steps"][1]["error"]["code"] == ErrorCodes.OUTPUT_BUDGET_EXCEEDED
            assert body["steps"][2]["status"] != "success"

        # afd-call and grouped tool use routed command's budget
        for tool, arguments in (
            ("afd-call", {"command": "doc-open", "input": {"id": "d"}}),
            ("doc", {"action": "open", "params": {"id": "d"}}),
        ):
            res = await client.call_tool(tool, arguments, meta={AFD_OUTPUT_BUDGET_META_KEY: ask})
            assert res.is_error is True
            body = _payload(res)
            assert body["error"]["code"] == ErrorCodes.OUTPUT_BUDGET_EXCEEDED
            assert body["error"]["details"]["limitBytes"] == 96
            assert body["error"]["details"]["maxBytes"] == 200

        # meta argument disagreement -> VALIDATION_ERROR with details: {"meta": "dev.afd/outputBudget"}
        disagree = await client.call_tool(
            "afd-call",
            {
                "command": "doc-open",
                "input": {"id": "b"},
                "meta": {AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 100}},
            },
            meta={AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 90}},
        )
        assert disagree.is_error is True
        disagree_body = _payload(disagree)
        assert disagree_body["error"]["code"] == ErrorCodes.VALIDATION_ERROR
        assert disagree_body["error"]["details"] == {"meta": AFD_OUTPUT_BUDGET_META_KEY}

        # Agreeing _meta and meta argument -> accepted
        agree = await client.call_tool(
            "afd-call",
            {
                "command": "doc-open",
                "input": {"id": "b"},
                "meta": {AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 100}},
            },
            meta={AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 100}},
        )
        assert agree.is_error is False
        assert _payload(agree)["success"] is True

        # afd-discover and afd-detail ignore outputBudget ask
        disc = await client.call_tool(
            "afd-discover", {"meta": {AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 10}}}
        )
        assert _payload(disc)["success"] is True
        det = await client.call_tool(
            "afd-detail",
            {"command": ["doc-search"], "meta": {AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 10}}},
        )
        assert _payload(det)["success"] is True
        assert _payload(det)["data"][0]["outputBudget"] == {"defaultBytes": 64, "maxBytes": 128}


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["auto", "legacy"])
@pytest.mark.parametrize("hook_style", ["with_ask", "set_attr"])
async def test_mcp_context_hook_wins_over_meta_ask(mode: str, hook_style: str) -> None:
    def hook(_req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        if hook_style == "with_ask":
            return ctx.with_output_budget_ask(40)
        ctx.output_budget = 40
        return ctx

    server, seen = _make_fixed_server(
        {"defaultBytes": 64, "maxBytes": 128},
        {"success": True},
        context_hook=hook,
    )
    async with Client(server._create_mcp_server(), mode=mode) as client:
        res = await client.call_tool(
            "doc-search",
            {},
            meta={AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 128}},
        )
        assert _payload(res)["success"] is True
        assert seen == [40]


@pytest.mark.asyncio
async def test_mcp_server_journals_effective_budget() -> None:
    sink = MemoryJournalSink()
    server = create_server(
        "journal-mcp-test",
        tool_strategy="individual",
        middleware=[create_journal_middleware(sink, record_failures=True)],
        clock=fixed_clock("2026-01-01T00:00:00Z"),
    )

    @server.command(
        name="doc-search",
        description="Search",
        output_budget=OutputBudget(64, 128),
        expose=MCP,
    )
    async def doc_search(input: Any, context: CommandContext) -> CommandResult[Any]:
        return success({})

    @server.command(name="doc-open", description="Open", expose=MCP)
    async def doc_open(input: Any, context: CommandContext) -> CommandResult[Any]:
        return success({})

    async with Client(server._create_mcp_server(), mode="auto") as client:
        await client.call_tool(
            "doc-search", {}, meta={AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 1000}}
        )
        await client.call_tool(
            "doc-open", {}, meta={AFD_OUTPUT_BUDGET_META_KEY: {"maxBytes": 1000}}
        )

    entries = await sink.read()
    assert entries[0].output_budget == 128
    assert entries[1].output_budget is None


# ═══════════════════════════════════════════════════════════════════════════════
# REAL TRANSPORTS: STREAMABLE HTTP (BOTH ERAS), SSE, AND STDIO (BOTH ERAS)
# ═══════════════════════════════════════════════════════════════════════════════


async def _assert_live_transport(call_tool: Any, list_tools: Any) -> None:
    case = SPEC_CASES["batch"]
    ask = case["ask"]
    items = [
        {"id": item["id"], "command": item["command"], "input": {"id": item["id"]}}
        for item in case["items"]
    ]

    # Declaration present on budgeted tools, absent on unbudgeted tool
    listed = await list_tools()
    by_name = {t.name: t for t in listed.tools}
    assert by_name["doc-search"].meta[AFD_OUTPUT_BUDGET_META_KEY] == {
        "defaultBytes": 64,
        "maxBytes": 128,
    }
    assert by_name["doc-open"].meta[AFD_OUTPUT_BUDGET_META_KEY] == {
        "defaultBytes": 100,
        "maxBytes": 200,
    }
    assert AFD_OUTPUT_BUDGET_META_KEY not in (by_name["doc-tag"].meta or {})

    # Every ask case from spec/vectors/output-budgets.json over the live transport
    for index, ask_case in enumerate(SPEC_CASES["asks"]):
        label = f"live ask[{index}]: {ask_case['description']}"
        meta = {AFD_OUTPUT_BUDGET_META_KEY: ask_case["ask"]} if "ask" in ask_case else None
        res = await call_tool(f"ask-v{index}", {}, meta=meta)
        data = _payload(res)
        if ask_case["effective"] == "VALIDATION_ERROR":
            assert res.is_error is True, label
            assert data["success"] is False, label
            assert data["error"]["code"] == ErrorCodes.VALIDATION_ERROR, label
            assert data["error"]["details"] == {
                "field": "outputBudget",
                "meta": AFD_OUTPUT_BUDGET_META_KEY,
            }, label
            assert '{ "maxBytes": <positive integer> }' in data["error"]["suggestion"], label
        else:
            assert res.is_error is False, label
            assert data["success"] is True, label
            assert data["data"]["effective"] == ask_case["effective"], label

    # Every check case from spec/vectors/output-budgets.json over the live transport
    for index, check_case in enumerate(SPEC_CASES["checks"]):
        label = f"live check[{index}]: {check_case['description']}"
        meta = {AFD_OUTPUT_BUDGET_META_KEY: check_case["ask"]} if "ask" in check_case else None
        res = await call_tool(f"check-v{index}", {}, meta=meta)
        data = _payload(res)
        assert res.is_error is (check_case["expected"]["success"] is False), label
        _assert_same_check(data, check_case["expected"], label)

    # Over-budget mutation keeps result with caution warning and report
    mut = await call_tool("doc-mutate", {"size": 80})
    assert mut.is_error is False
    mut_body = _payload(mut)
    assert mut_body["success"] is True
    assert mut_body["warnings"][0]["code"] == ErrorCodes.OUTPUT_BUDGET_EXCEEDED
    assert mut_body["warnings"][0]["severity"] == "caution"
    assert mut_body["metadata"][AFD_OUTPUT_BUDGET_META_KEY]["limitBytes"] == 64

    # afd-batch per item via meta argument
    batch = await call_tool(
        "afd-batch",
        {"commands": items, "meta": {AFD_OUTPUT_BUDGET_META_KEY: ask}},
    )
    batch_body = _payload(batch)
    for item, got in zip(case["items"], batch_body["results"], strict=True):
        _assert_same_check(got["result"], item["expected"], f"live batch {item['id']}")

    # afd-call via meta argument
    called = await call_tool(
        "afd-call",
        {
            "command": "doc-open",
            "input": {"id": "d"},
            "meta": {AFD_OUTPUT_BUDGET_META_KEY: ask},
        },
    )
    assert called.is_error is True
    assert _payload(called)["error"]["code"] == ErrorCodes.OUTPUT_BUDGET_EXCEEDED


@pytest.mark.asyncio
@pytest.mark.parametrize("stateless", [False, True])
@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_streamable_http_output_budgets_both_eras(mode: str, stateless: bool) -> None:
    async with (
        protocol_server(
            "individual", "streamable-http", stateless=stateless, fixture=FIXTURE
        ) as url,
        Client(url, mode=mode) as client,
    ):
        assert (client.protocol_version == MODERN) is (mode == "auto")
        await _assert_live_transport(client.call_tool, client.list_tools)


@pytest.mark.asyncio
async def test_sse_output_budgets() -> None:
    async with (
        protocol_server("individual", "sse", fixture=FIXTURE) as url,
        sse_client(url) as streams,
        ClientSession(streams[0], streams[1]) as session,
    ):
        await session.initialize()
        await _assert_live_transport(session.call_tool, session.list_tools)


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["auto", "legacy"])
async def test_stdio_output_budgets_both_eras(mode: str) -> None:
    root = Path(__file__).resolve().parents[1]
    params = StdioServerParameters(
        command=sys.executable,
        args=[str(root / "tests/fixtures" / FIXTURE), "0", "individual", "stdio"],
        env=dict(os.environ, PYTHONPATH=str(root / "src")),
    )
    async with Client(params, mode=mode) as client:
        assert (client.protocol_version == MODERN) is (mode == "auto")
        await _assert_live_transport(client.call_tool, client.list_tools)
