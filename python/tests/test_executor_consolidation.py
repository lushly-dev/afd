"""Tests for consolidated Python command, batch, pipeline and stream executors (#1535)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from unittest.mock import patch

import pytest

import afd
import afd.core
import afd.server
from afd import (
    Actor,
    CommandExecutor,
    CommandRegistryOptions,
    ExecutorOptions,
    ExposeOptions,
    OutputBudget,
    StreamExecutorOptions,
    StreamOptions,
    commands_to_mcp_tools,
    create_command_registry,
    execute_batch,
    execute_stream,
    is_exposed_to,
    is_mcp_exposed,
    success,
)
from afd.core.batch import BatchCommand, BatchRequest
from afd.core.commands import CommandContext, CommandDefinition
from afd.core.errors import CommandError
from afd.core.pipeline import PipelineRequest, PipelineStep, StepStatus, execute_pipeline
from afd.core.result import CommandResult, error, failure
from afd.core.streaming import CompleteChunk, DataChunk, ErrorChunk
from afd.core.wire import to_wire
from afd.direct import DirectClient, DirectClientOptions, SimpleRegistry
from afd.server import create_approval_middleware, create_server, define_command
from afd.testing.fixtures import MockServer


def test_public_executor_exports_on_root_core_and_server():
    for name in (
        "CommandExecutor",
        "CommandRegistryOptions",
        "ExecutorOptions",
        "StreamExecutorOptions",
        "execute_batch",
        "execute_stream",
        "is_exposed_to",
        "is_mcp_exposed",
        "commands_to_mcp_tools",
    ):
        assert hasattr(afd, name), f"afd missing {name}"
        assert hasattr(afd.core, name), f"afd.core missing {name}"
        assert getattr(afd, name) is getattr(afd.core, name)

    for name in (
        "CommandExecutor",
        "ExecutorOptions",
        "StreamExecutorOptions",
        "execute_batch",
        "execute_stream",
    ):
        assert getattr(afd.server, name) is getattr(afd.core, name)

    assert CommandExecutor is not None


def test_exposure_and_mcp_tool_helpers():
    async def noop(inp: Any, ctx: Any = None) -> CommandResult[Any]:
        return success(inp)

    mcp_cmd = CommandDefinition(
        name="item-list", description="List items", handler=noop, expose=ExposeOptions(mcp=True)
    )
    agent_only = CommandDefinition(name="item-local", description="Local", handler=noop)

    assert is_exposed_to(mcp_cmd, "mcp") is True
    assert is_mcp_exposed(mcp_cmd) is True
    assert is_mcp_exposed(agent_only) is False
    assert is_exposed_to(mcp_cmd, "bogus") is False
    assert is_exposed_to(mcp_cmd, ["mcp"]) is False
    tools = commands_to_mcp_tools([mcp_cmd, agent_only])
    assert [tool["name"] for tool in tools] == ["item-list"]


# ═══════════════════════════════════════════════════════════════════════════════
# SHARED SINGLE-COMMAND EXECUTOR ACROSS REGISTRIES & MOCKSERVER
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("surface", ["core", "simple", "mock", "server"])
@pytest.mark.asyncio
async def test_all_executors_share_middleware_order_cancellation_deadlines_and_redaction(
    surface: str,
):
    events: list[str] = []

    def make_mw(label: str):
        async def mw(name: str, data: Any, ctx: Any, next_fn: Any):
            events.append(f"{label}:before")
            res = await next_fn()
            events.append(f"{label}:after")
            return res

        return mw

    middleware = [make_mw("m1"), make_mw("m2")]
    observed_signal: asyncio.Event | None = None

    if surface == "core":
        reg = create_command_registry(CommandRegistryOptions(middleware=middleware))

        async def ok_h(inp: Any, ctx: Any) -> CommandResult[Any]:
            events.append("handler")
            return success(inp)

        async def slow_h(inp: Any, ctx: Any) -> CommandResult[Any]:
            nonlocal observed_signal
            observed_signal = ctx.signal
            await asyncio.sleep(5)
            return success("late")

        async def boom_h(inp: Any, ctx: Any) -> CommandResult[Any]:
            raise RuntimeError("SECRET_PATH=/etc/passwd")

        reg.register(CommandDefinition(name="work-ok", description="Ok", handler=ok_h))
        reg.register(CommandDefinition(name="work-slow", description="Slow", handler=slow_h))
        reg.register(CommandDefinition(name="work-boom", description="Boom", handler=boom_h))
        run = reg.execute
    elif surface == "simple":
        sreg = SimpleRegistry(middleware=middleware)

        @sreg.command("work-ok")
        async def s_ok(value: int = 0) -> CommandResult[Any]:
            events.append("handler")
            return success({"value": value})

        @sreg.command("work-slow")
        async def s_slow(*, context: Any) -> CommandResult[Any]:
            nonlocal observed_signal
            observed_signal = context.signal
            await asyncio.sleep(5)
            return success("late")

        @sreg.command("work-boom")
        async def s_boom() -> CommandResult[Any]:
            raise RuntimeError("SECRET_PATH=/etc/passwd")

        run = sreg.execute
    elif surface == "mock":
        mock = MockServer(middleware=middleware)

        @mock.command("work-ok")
        async def m_ok(inp: dict[str, Any]) -> CommandResult[Any]:
            events.append("handler")
            return success(inp)

        @mock.command("work-slow")
        async def m_slow(inp: dict[str, Any], ctx: Any) -> CommandResult[Any]:
            nonlocal observed_signal
            observed_signal = ctx.signal
            await asyncio.sleep(5)
            return success("late")

        @mock.command("work-boom")
        async def m_boom(inp: dict[str, Any]) -> CommandResult[Any]:
            raise RuntimeError("SECRET_PATH=/etc/passwd")

        run = mock.execute
    else:
        srv = create_server("shared-test", middleware=middleware)

        @srv.command(name="work-ok", description="Ok")
        async def srv_ok(inp: Any, ctx: Any) -> CommandResult[Any]:
            events.append("handler")
            return success(inp)

        @srv.command(name="work-slow", description="Slow")
        async def srv_slow(inp: Any, ctx: Any) -> CommandResult[Any]:
            nonlocal observed_signal
            observed_signal = ctx.signal
            await asyncio.sleep(5)
            return success("late")

        @srv.command(name="work-boom", description="Boom")
        async def srv_boom(inp: Any, ctx: Any) -> CommandResult[Any]:
            raise RuntimeError("SECRET_PATH=/etc/passwd")

        run = srv.execute

    # 1. Middleware order
    ok_res = await run("work-ok", {"value": 42})
    assert ok_res.success is True
    assert ok_res.data == {"value": 42}
    assert events == ["m1:before", "m2:before", "handler", "m2:after", "m1:after"]

    # 2. Pre-cancellation skips middleware and handler
    events.clear()
    cancelled = asyncio.Event()
    cancelled.set()
    cancel_res = await run("work-ok", {"value": 1}, CommandContext(signal=cancelled))
    assert cancel_res.success is False
    assert cancel_res.error is not None
    assert cancel_res.error.code == "COMMAND_CANCELLED"
    assert events == []

    # 3. Positive finite deadline enforces TIMEOUT and aborts context.signal
    timeout_res = await run("work-slow", {}, CommandContext(timeout=20))
    assert timeout_res.success is False
    assert timeout_res.error is not None
    assert timeout_res.error.code == "TIMEOUT"
    assert timeout_res.error.retryable is True
    assert observed_signal is not None and observed_signal.is_set()

    # 4. Exception redaction outside dev_mode
    boom_res = await run("work-boom", {})
    assert boom_res.success is False
    assert boom_res.error is not None
    assert boom_res.error.code == "COMMAND_EXECUTION_ERROR"
    assert boom_res.error.message == "An internal error occurred"
    assert "SECRET_PATH" not in str(to_wire(boom_res))


@pytest.mark.asyncio
async def test_mock_server_preserves_legacy_signatures_dict_coercion_and_dev_mode(caplog):
    mock = MockServer(dev_mode=True)
    seen_actors: list[Actor | None] = []

    @mock.command("dict-return")
    async def dict_return(inp: dict[str, Any]):
        return {"success": True, "data": {"echo": inp.get("x")}}

    @mock.command(
        "two-arg",
        input_schema={
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "integer"}},
        },
    )
    async def two_arg(inp: dict[str, Any], ctx: CommandContext):
        seen_actors.append(ctx.actor)
        return success({"id": inp["id"], "actor": ctx.actor.kind if ctx.actor else None})

    @mock.command("boom-dev")
    async def boom_dev(inp: dict[str, Any]):
        raise ValueError("visible in dev mode")

    res_dict = await mock.execute("dict-return", {"x": 7})
    assert isinstance(res_dict, CommandResult)
    assert res_dict.success and res_dict.data == {"echo": 7}

    bad = await mock.execute("two-arg", {"id": "not-int"})
    assert bad.success is False and bad.error is not None and bad.error.code == "VALIDATION_ERROR"

    good = await mock.execute("two-arg", {"id": 9})
    assert good.success and good.data == {"id": 9, "actor": "test"}
    assert seen_actors == [Actor(kind="test")]

    with caplog.at_level(logging.ERROR, logger="afd.testing"):
        dev_err = await mock.execute("boom-dev", {})
    assert dev_err.error is not None
    assert dev_err.error.code == "COMMAND_EXECUTION_ERROR"
    assert dev_err.error.message == "visible in dev mode"
    assert any(r.name == "afd.testing" and r.exc_info for r in caplog.records)


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC EXECUTE_BATCH (STANDALONE + REGISTRIES + SERVER + MOCK)
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_standalone_execute_batch_validation_limits_redaction_and_two_arg_executor():
    with pytest.raises(ValueError, match="max_batch_size"):
        await execute_batch(
            {"commands": [{"command": "a"}]},
            lambda n, i: success(i),
            options=ExecutorOptions(max_batch_size=0),
        )
    with pytest.raises(ValueError, match="max_batch_parallelism"):
        await execute_batch(
            {"commands": [{"command": "a"}]},
            lambda n, i: success(i),
            options=ExecutorOptions(max_batch_parallelism=True),
        )

    async def two_arg(name: str, payload: Any) -> CommandResult[Any]:
        if name == "fail-boom":
            raise RuntimeError("secret-batch-detail")
        return success({"name": name, "payload": payload})

    req = BatchRequest(
        commands=[
            BatchCommand(id="c1", command="item-get", input={"id": 1}),
            BatchCommand(id="c2", command="fail-boom", input={}),
        ]
    )
    redacted = await execute_batch(req, two_arg)
    assert redacted.success is True
    assert redacted.summary.success_count == 1
    assert redacted.summary.failure_count == 1
    assert redacted.results[1].result.error is not None
    assert redacted.results[1].result.error.code == "COMMAND_EXECUTION_ERROR"
    assert redacted.results[1].result.error.message == "An internal error occurred"

    shown = await execute_batch(req, two_arg, options=ExecutorOptions(dev_mode=True))
    assert shown.results[1].result.error is not None
    assert shown.results[1].result.error.message == "secret-batch-detail"


@pytest.mark.asyncio
async def test_registry_server_simple_and_mock_execute_batch_and_exposure():
    registry = create_command_registry(
        CommandRegistryOptions(max_batch_size=2, max_batch_parallelism=2)
    )

    async def pub_h(inp: Any, ctx: Any) -> CommandResult[Any]:
        return success({"trace": ctx.trace_id, "v": inp.get("v")})

    async def priv_h(inp: Any, ctx: Any) -> CommandResult[Any]:
        return success({"secret": True})

    registry.register(
        CommandDefinition(
            name="item-read", description="Read", handler=pub_h, expose=ExposeOptions(mcp=True)
        )
    )
    registry.register(
        CommandDefinition(
            name="item-priv", description="Priv", handler=priv_h, expose=ExposeOptions(mcp=False)
        )
    )

    batch = await registry.execute_batch(
        {
            "commands": [
                {"id": "a", "command": "item-read", "input": {"v": 1}},
                {"id": "b", "command": "item-priv", "input": {}},
            ]
        },
        CommandContext(trace_id="btrace", extra={"interface": "mcp"}),
    )
    assert batch.results[0].result.success is True
    assert batch.results[0].result.data == {"trace": "btrace-0", "v": 1}
    assert batch.results[1].result.success is False
    assert batch.results[1].result.error is not None
    assert batch.results[1].result.error.code == "COMMAND_NOT_EXPOSED"

    # Limit enforced via registry options
    over = await registry.execute_batch(
        {"commands": [{"command": "item-read"}, {"command": "item-read"}, {"command": "item-read"}]}
    )
    assert over.success is False
    assert over.error is not None and over.error.code == "INVALID_BATCH_REQUEST"

    # MCPServer.execute_batch, SimpleRegistry.execute_batch, MockServer.execute_batch
    server = create_server("batch-srv")

    @server.command(name="item-echo", description="Echo", expose=ExposeOptions(mcp=True))
    async def srv_echo(inp: Any) -> CommandResult[Any]:
        return success(inp)

    srv_batch = await server.execute_batch(
        {"commands": [{"command": "item-echo", "input": {"k": 1}}]}
    )
    assert srv_batch.success is True and srv_batch.results[0].result.data == {"k": 1}

    simple = SimpleRegistry()

    @simple.command("item-echo")
    async def simp_echo(k: int = 0) -> CommandResult[Any]:
        return success({"k": k})

    simp_batch = await simple.execute_batch(
        {"commands": [{"command": "item-echo", "input": {"k": 2}}]}
    )
    assert simp_batch.success is True and simp_batch.results[0].result.data == {"k": 2}

    mock = MockServer()

    @mock.command("item-echo")
    async def mock_echo(inp: dict[str, Any]) -> CommandResult[Any]:
        return success(inp)

    mock_batch = await mock.execute_batch(
        {"commands": [{"command": "item-echo", "input": {"k": 3}}]}
    )
    assert mock_batch.success is True and mock_batch.results[0].result.data == {"k": 3}


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC EXECUTE_STREAM (STANDALONE + REGISTRIES + SERVER + MOCK)
# ═══════════════════════════════════════════════════════════════════════════════


async def _collect(gen) -> list[Any]:
    return [chunk async for chunk in gen]


@pytest.mark.asyncio
async def test_execute_stream_data_array_empty_failure_and_redaction():
    async def exec_fn(name: str, inp: Any, ctx: CommandContext) -> CommandResult[Any]:
        if name == "list-cmd":
            return success([10, 20, 30], confidence=0.9, reasoning="three items")
        if name == "empty-cmd":
            return success([])
        if name == "scalar-cmd":
            return success({"ok": True})
        if name == "fail-cmd":
            return error("BAD_STATE", "Broken", suggestion="Fix it", retryable=True)
        if name == "boom-cmd":
            raise RuntimeError("SECRET_STREAM_ERR")
        return failure(CommandError(code="UNKNOWN", message="nope"))

    list_chunks = await _collect(execute_stream("list-cmd", {}, exec_fn))
    assert [type(c) for c in list_chunks] == [DataChunk, DataChunk, DataChunk, CompleteChunk]
    assert [(c.data, c.index, c.is_last) for c in list_chunks[:3]] == [
        (10, 0, False),
        (20, 1, False),
        (30, 2, True),
    ]
    assert list_chunks[3].total_chunks == 3
    assert list_chunks[3].confidence == 0.9
    assert list_chunks[3].reasoning == "three items"

    empty_chunks = await _collect(execute_stream("empty-cmd", {}, exec_fn))
    assert len(empty_chunks) == 1 and isinstance(empty_chunks[0], CompleteChunk)
    assert empty_chunks[0].total_chunks == 0

    scalar_chunks = await _collect(execute_stream("scalar-cmd", {}, exec_fn))
    assert len(scalar_chunks) == 2
    assert isinstance(scalar_chunks[0], DataChunk) and scalar_chunks[0].is_last is True
    assert scalar_chunks[0].data == {"ok": True}

    fail_chunks = await _collect(execute_stream("fail-cmd", {}, exec_fn))
    assert len(fail_chunks) == 1 and isinstance(fail_chunks[0], ErrorChunk)
    assert fail_chunks[0].error.code == "BAD_STATE"
    assert fail_chunks[0].recoverable is True

    redacted = await _collect(execute_stream("boom-cmd", {}, exec_fn))
    assert len(redacted) == 1 and isinstance(redacted[0], ErrorChunk)
    assert redacted[0].error.code == "STREAM_ERROR"
    assert redacted[0].error.message == "Stream execution failed"
    assert "SECRET_STREAM_ERR" not in str(to_wire(redacted[0]))

    shown = await _collect(
        execute_stream("boom-cmd", {}, exec_fn, options=StreamExecutorOptions(dev_mode=True))
    )
    assert isinstance(shown[0], ErrorChunk)
    assert shown[0].error.message == "SECRET_STREAM_ERR"


@pytest.mark.asyncio
async def test_execute_stream_abort_timeout_validation_and_b7_budget_skip():
    # Invalid timeout values
    for bad_timeout in (-1, float("nan"), float("inf"), True):
        chunks = await _collect(
            execute_stream(
                "x",
                {},
                lambda n, i, c: success(1),  # type: ignore[arg-type]
                options=StreamExecutorOptions(timeout=bad_timeout),
            )
        )
        assert len(chunks) == 1 and isinstance(chunks[0], ErrorChunk)
        assert chunks[0].error.code == "VALIDATION_ERROR"
        assert chunks[0].recoverable is False

    # Pre-aborted signal never invokes executor
    called = False

    async def spy_exec(name: str, inp: Any, ctx: CommandContext) -> CommandResult[Any]:
        nonlocal called
        called = True
        return success([1, 2])

    sig = asyncio.Event()
    sig.set()
    pre = await _collect(execute_stream("x", {}, spy_exec, CommandContext(signal=sig)))
    assert called is False
    assert len(pre) == 1 and isinstance(pre[0], ErrorChunk)
    assert pre[0].error.code == "STREAM_ABORTED"
    assert pre[0].error.message == "Stream was aborted before starting"
    assert pre[0].resume_from is None

    # Aborted mid-data emission reports chunks_before_error and resume_from
    mid_sig = asyncio.Event()

    async def three_items(name: str, inp: Any, ctx: CommandContext) -> CommandResult[Any]:
        return success(["a", "b", "c"])

    collected = []
    async for chunk in execute_stream("x", {}, three_items, CommandContext(signal=mid_sig)):
        collected.append(chunk)
        if isinstance(chunk, DataChunk) and chunk.index == 0:
            mid_sig.set()
    assert len(collected) == 2
    assert isinstance(collected[0], DataChunk) and collected[0].data == "a"
    assert isinstance(collected[1], ErrorChunk)
    assert collected[1].error.code == "STREAM_ABORTED"
    assert collected[1].chunks_before_error == 1
    assert collected[1].resume_from == 1

    # Timeout aborts signal and yields STREAM_TIMEOUT
    seen_sig: asyncio.Event | None = None

    async def hang(name: str, inp: Any, ctx: CommandContext) -> CommandResult[Any]:
        nonlocal seen_sig
        seen_sig = ctx.signal
        await asyncio.sleep(5)
        return success("never")

    timed = await _collect(
        execute_stream("slow", {}, hang, options=StreamExecutorOptions(timeout=20))
    )
    assert len(timed) == 1 and isinstance(timed[0], ErrorChunk)
    assert timed[0].error.code == "STREAM_TIMEOUT"
    assert timed[0].recoverable is True
    assert seen_sig is not None and seen_sig.is_set()

    # B7: buffered execute_stream skips B5 output-budget check while single execute enforces it
    server = create_server("stream-b7")

    @server.command(
        name="doc-stream",
        description="Stream large payload",
        expose=ExposeOptions(mcp=True),
        output_budget=OutputBudget(default_bytes=20, max_bytes=40),
    )
    async def doc_stream(inp: Any) -> CommandResult[Any]:
        return success(["x" * 40, "y" * 40])

    single = await server.execute("doc-stream", {})
    assert single.success is False
    assert single.error is not None and single.error.code == "OUTPUT_BUDGET_EXCEEDED"

    streamed = await _collect(
        server.execute_stream(
            "doc-stream",
            {},
            StreamOptions(timeout=5000),
            CommandContext(extra={"interface": "mcp"}),
        )
    )
    assert len(streamed) == 3
    assert isinstance(streamed[0], DataChunk) and streamed[0].data == "x" * 40
    assert isinstance(streamed[1], DataChunk) and streamed[1].data == "y" * 40
    assert isinstance(streamed[2], CompleteChunk) and streamed[2].total_chunks == 2

    # Exposure enforced on registry.execute_stream
    reg = create_command_registry()

    async def hidden_h(inp: Any, ctx: Any) -> CommandResult[Any]:
        return success([1])

    reg.register(CommandDefinition(name="secret-run", description="Secret", handler=hidden_h))
    denied = await _collect(
        reg.execute_stream("secret-run", {}, None, CommandContext(extra={"interface": "mcp"}))
    )
    assert len(denied) == 1 and isinstance(denied[0], ErrorChunk)
    assert denied[0].error.code == "COMMAND_NOT_EXPOSED"


# ═══════════════════════════════════════════════════════════════════════════════
# DIRECTCLIENT.PIPE CONSOLIDATED WITH CORE EXECUTE_PIPELINE
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_direct_client_pipe_delegates_to_core_execute_pipeline():
    registry = SimpleRegistry()

    @registry.command("step-one")
    async def step_one():
        return success({"id": 7, "enabled": True, "zero": 0})

    @registry.command("step-two")
    async def step_two(item_id: int):
        return success({"doubled": item_id * 2})

    @registry.command("step-fail")
    async def step_fail():
        return error("BOOM", "Failed step")

    client = DirectClient(registry)
    with patch("afd.direct_pipeline.execute_pipeline", wraps=execute_pipeline) as spy:
        res = await client.pipe(
            [
                {"command": "step-one", "as": "first"},
                {
                    "command": "step-two",
                    "input": {"item_id": "$steps.first.id"},
                    "as": "second",
                    "when": "$steps.first.enabled",
                },
                {"command": "step-two", "input": {"item_id": 99}, "when": "$steps.first.zero"},
            ]
        )
        assert spy.call_count == 1

    assert res.success is True
    assert [s.skipped for s in res.steps] == [False, False, True]
    assert res.outputs == {
        "first": {"id": 7, "enabled": True, "zero": 0},
        "second": {"doubled": 14},
    }
    assert res.final is not None and res.final.data == {"doubled": 14}

    # Stop-on-failure omits trailing unexecuted steps in DirectPipelineResult.steps
    failed = await client.pipe(
        [
            {"command": "step-one", "as": "first"},
            {"command": "step-fail", "as": "bad"},
            {"command": "step-two", "input": {"item_id": 1}},
        ]
    )
    assert failed.success is False
    assert len(failed.steps) == 2
    assert (
        failed.final is not None
        and failed.final.error is not None
        and failed.final.error.code == "BOOM"
    )
    assert failed.outputs == {"first": {"id": 7, "enabled": True, "zero": 0}, "bad": None}


@pytest.mark.asyncio
async def test_core_execute_pipeline_forwards_isolated_context_without_exposing_to_input_ref():
    seen: list[tuple[str, Any, Any]] = []

    async def three_arg(name: str, payload: Any, ctx: CommandContext) -> CommandResult[Any]:
        seen.append((name, payload, ctx.extra.get("tenant")))
        ctx.extra["mutated"] = name
        return success({"payload": payload, "mutated": ctx.extra.get("mutated")})

    req = PipelineRequest(
        input={"public": "ok"},
        steps=[
            PipelineStep(command="a-run", input={"p": "$input.public", "leak": "$input.tenant"}),
            PipelineStep(command="b-run", input={"prev": "$prev.payload.p"}),
        ],
    )
    res = await execute_pipeline(req, three_arg, CommandContext(extra={"tenant": "acme"}))
    assert [s.status for s in res.steps] == [StepStatus.SUCCESS, StepStatus.SUCCESS]
    assert seen == [
        ("a-run", {"p": "ok"}, "acme"),
        ("b-run", {"prev": "ok"}, "acme"),
    ]


@pytest.mark.asyncio
async def test_direct_client_pipe_preserves_private_approval_retry():
    @define_command(name="item-delete", description="Delete item", approval="required")
    async def delete_item(args: Any, ctx: Any) -> CommandResult[Any]:
        return success({"deleted": args.get("id")})

    gate = create_approval_middleware(
        secret="test-approval-secret-0123456789abcdef", commands=[delete_item]
    )
    from afd.direct import create_direct_registry

    registry = create_direct_registry([delete_item], middleware=[gate])
    approved_commands: list[str] = []

    async def approve(request: Any) -> bool:
        approved_commands.append(request.command)
        return True

    client = DirectClient(registry, DirectClientOptions(on_approval_needed=approve))
    res = await client.pipe([{"command": "item-delete", "input": {"id": 5}, "as": "del"}])
    assert res.success is True
    assert approved_commands == ["item-delete"]
    assert res.outputs == {"del": {"deleted": 5}}
    assert res.final is not None and res.final.data == {"deleted": 5}


# ═══════════════════════════════════════════════════════════════════════════════
# REGRESSION TESTS FOR REVIEW FINDINGS
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_batch_deadline_settles_timeout_when_handler_swallows_cancel():
    async def stubborn(_inp: Any, _ctx: Any) -> CommandResult[Any]:
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            await asyncio.sleep(0.08)
            return success({"late": True})
        return success({"never": True})

    reg = create_command_registry()
    reg.register(CommandDefinition(name="slow-op", description="Slow", handler=stubborn))

    batch = await reg.execute_batch(
        {"commands": [{"command": "slow-op", "input": {}}], "options": {"timeout": 15}}
    )
    assert batch.results[0].result.success is False
    assert (
        batch.results[0].result.error is not None
        and batch.results[0].result.error.code == "BATCH_TIMEOUT"
    )


@pytest.mark.asyncio
async def test_pipeline_deadline_settles_timeout_when_handler_swallows_cancel():
    from afd.core.pipeline import PipelineOptions

    async def stubborn(_name: str, _inp: Any, _ctx: Any) -> CommandResult[Any]:
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            await asyncio.sleep(0.08)
            return success({"late": True})
        return success({"never": True})

    req = PipelineRequest(
        steps=[PipelineStep(command="slow-step"), PipelineStep(command="never-step")],
        options=PipelineOptions(timeout_ms=15),
    )
    res = await execute_pipeline(req, stubborn)
    assert res.steps[0].status == StepStatus.FAILURE
    assert res.steps[0].error is not None and res.steps[0].error.code == "PIPELINE_TIMEOUT"
    assert res.steps[1].status == StepStatus.SKIPPED
    assert res.steps[1].error is not None and res.steps[1].error.code == "PIPELINE_TIMEOUT"


@pytest.mark.asyncio
async def test_timed_single_command_blocks_handler_when_cancelled_in_middleware():
    ran = False
    caller_signal = asyncio.Event()

    async def cancelling_mw(name: str, inp: Any, ctx: CommandContext, next_fn: Any) -> Any:
        caller_signal.set()
        return await next_fn()

    async def handler(_inp: Any, _ctx: Any) -> CommandResult[Any]:
        nonlocal ran
        ran = True
        return success({"ok": True})

    reg = create_command_registry(CommandRegistryOptions(middleware=[cancelling_mw]))
    reg.register(CommandDefinition(name="work-run", description="Work", handler=handler))

    res = await reg.execute("work-run", {}, CommandContext(signal=caller_signal, timeout=5000))
    assert ran is False
    assert res.success is False
    assert res.error is not None and res.error.code == "COMMAND_CANCELLED"


@pytest.mark.asyncio
async def test_pipeline_respects_caller_cancellation_including_continue_on_failure():
    from afd.core.pipeline import PipelineOptions

    dispatched: list[str] = []

    async def exec_step(name: str, _inp: Any, ctx: CommandContext) -> CommandResult[Any]:
        dispatched.append(name)
        if name == "step-1" and ctx.signal is not None:
            ctx.signal.set()
        return success({"step": name})

    # Pre-cancelled context runs zero steps.
    pre_sig = asyncio.Event()
    pre_sig.set()
    pre_res = await execute_pipeline(
        PipelineRequest(
            steps=[PipelineStep(command="step-1"), PipelineStep(command="step-2")],
            options=PipelineOptions(continue_on_failure=True),
        ),
        exec_step,
        CommandContext(signal=pre_sig),
    )
    assert dispatched == []
    assert [s.status for s in pre_res.steps] == [StepStatus.SKIPPED, StepStatus.SKIPPED]
    assert all(s.error is not None and s.error.code == "COMMAND_CANCELLED" for s in pre_res.steps)

    # Mid-pipeline cancellation skips remaining steps even with continue_on_failure=True.
    mid_sig = asyncio.Event()
    mid_res = await execute_pipeline(
        PipelineRequest(
            steps=[PipelineStep(command="step-1"), PipelineStep(command="step-2")],
            options=PipelineOptions(continue_on_failure=True),
        ),
        exec_step,
        CommandContext(signal=mid_sig),
    )
    assert dispatched == ["step-1"]
    assert mid_res.steps[0].status == StepStatus.SUCCESS
    assert mid_res.steps[1].status == StepStatus.SKIPPED
    assert mid_res.steps[1].error is not None and mid_res.steps[1].error.code == "COMMAND_CANCELLED"


@pytest.mark.asyncio
async def test_stream_clears_skip_output_budget_before_nested_ordinary_execute():
    reg = create_command_registry()

    async def inner_handler(_inp: Any, _ctx: Any) -> CommandResult[Any]:
        return success({"payload": "x" * 2000})

    async def outer_handler(_inp: Any, ctx: CommandContext | None) -> CommandResult[Any]:
        inner = await reg.execute("inner-big", {}, ctx)
        return success(
            {"inner_ok": inner.success, "inner_code": inner.error.code if inner.error else None}
        )

    reg.register(
        CommandDefinition(
            name="inner-big",
            description="Big inner",
            handler=inner_handler,
            output_budget=OutputBudget(default_bytes=512, max_bytes=512),
        )
    )
    reg.register(
        CommandDefinition(
            name="outer-call",
            description="Outer",
            handler=outer_handler,
            output_budget=OutputBudget(default_bytes=512, max_bytes=512),
        )
    )

    chunks = [chunk async for chunk in reg.execute_stream("outer-call", {})]
    data_chunks = [c for c in chunks if c.type == "data"]
    assert len(data_chunks) == 1
    assert data_chunks[0].data == {"inner_ok": False, "inner_code": "OUTPUT_BUDGET_EXCEEDED"}


@pytest.mark.asyncio
async def test_decorated_command_on_core_registry_validates_before_middleware():
    from pydantic import BaseModel

    class Req(BaseModel):
        title: str

    mw_called = False

    async def spy_mw(name: str, inp: Any, ctx: CommandContext, next_fn: Any) -> Any:
        nonlocal mw_called
        mw_called = True
        return await next_fn()

    @define_command(name="item-new", description="New item", input_schema=Req)
    async def item_new(inp: Req) -> CommandResult[Any]:
        return success({"title": inp.title})

    reg = create_command_registry(CommandRegistryOptions(middleware=[spy_mw]))
    reg.register(
        CommandDefinition(
            name="item-new",
            description="New item",
            handler=item_new,
        )
    )

    bad = await reg.execute("item-new", {})
    assert bad.success is False
    assert bad.error is not None and bad.error.code == "VALIDATION_ERROR"
    assert mw_called is False

    good = await reg.execute("item-new", {"title": "ok"})
    assert good.success is True
    assert good.data == {"title": "ok"}
    assert mw_called is True


@pytest.mark.asyncio
async def test_mcp_server_batch_and_stream_run_before_request_preflight():
    server = create_server(
        "preflight",
        tool_strategy="hybrid",
        first_class_tools=["missing-cmd"],
    )

    @server.command(name="real-cmd", description="Real", expose=ExposeOptions(mcp=True))
    async def real_cmd(_inp: Any) -> CommandResult[Any]:
        return success({"ok": True})

    with pytest.raises(ValueError, match="first_class_tools"):
        await server.execute_batch({"commands": [{"command": "real-cmd", "input": {}}]})

    with pytest.raises(ValueError, match="first_class_tools"):
        server.execute_stream("real-cmd", {})


@pytest.mark.asyncio
async def test_mock_server_signature_compatibility_and_transport_mcp_exposure():
    mock = MockServer()

    @mock.command("one-arg-context")
    async def one_arg(context: dict[str, Any]) -> CommandResult[Any]:
        return success({"got": context})

    @mock.command("optional-label")
    async def with_label(inp: dict[str, Any], label: str = "default") -> CommandResult[Any]:
        return success({"inp": inp, "label": label})

    @mock.command("kwonly-ctx")
    async def kwonly(inp: dict[str, Any], *, context: CommandContext) -> CommandResult[Any]:
        return success({"inp": inp, "actor": context.actor.kind if context.actor else None})

    @mock.command("internal-only", expose=ExposeOptions(mcp=False, agent=True))
    async def internal_only(inp: dict[str, Any]) -> CommandResult[Any]:
        return success({"inp": inp})

    r1 = await mock.execute("one-arg-context", {"a": 1})
    assert r1.success is True and r1.data == {"got": {"a": 1}}

    r2 = await mock.execute("optional-label", {"b": 2})
    assert r2.success is True and r2.data == {"inp": {"b": 2}, "label": "default"}

    r3 = await mock.execute("kwonly-ctx", {"c": 3})
    assert r3.success is True and r3.data == {"inp": {"c": 3}, "actor": "test"}

    tools = await mock.transport.list_tools()
    tool_names = [t.name for t in tools]
    assert "one-arg-context" in tool_names
    assert "internal-only" not in tool_names


@pytest.mark.asyncio
async def test_direct_client_pipe_handles_falsy_when_and_whitespace_command():
    reg = SimpleRegistry()

    @reg.command("ping-ok")
    async def ping_ok() -> CommandResult[Any]:
        return success({"ok": True})

    client = DirectClient(reg)
    res_empty_when = await client.pipe([{"command": "ping-ok", "when": {}}])
    assert res_empty_when.success is True
    assert res_empty_when.final is not None and res_empty_when.final.data == {"ok": True}

    res_blank_cmd = await client.pipe(
        [
            {"command": "ping-ok"},
            {"command": "   ", "when": {"$exists": "$prev.ok"}},
        ]
    )
    assert res_blank_cmd.success is False
    assert len(res_blank_cmd.steps) == 2
    assert (
        res_blank_cmd.final is not None
        and res_blank_cmd.final.error is not None
        and res_blank_cmd.final.error.code == "UNKNOWN_TOOL"
    )


@pytest.mark.asyncio
async def test_batch_preserves_report_progress_and_journal_context_digest_under_deadline():
    from afd.core.journal import create_context_digest

    progress_notes: list[str] = []
    digests: list[Any] = []

    async def record_ctx(_inp: Any, ctx: CommandContext) -> CommandResult[Any]:
        if ctx.report_progress is not None:
            ctx.report_progress("tick")
        digests.append(create_context_digest(ctx))
        return success({"ok": True})

    reg = create_command_registry()
    reg.register(CommandDefinition(name="ctx-check", description="Check", handler=record_ctx))

    base = CommandContext(trace_id="batch-digest", report_progress=progress_notes.append)
    await reg.execute_batch({"commands": [{"command": "ctx-check", "input": {}}]}, base)
    await reg.execute_batch(
        {"commands": [{"command": "ctx-check", "input": {}}], "options": {"timeout": 5000}},
        base,
    )

    assert progress_notes == ["tick", "tick"]
    assert len(digests) == 2 and digests[0] == digests[1]


@pytest.mark.asyncio
async def test_stream_deadline_fires_while_consumer_pauses_between_chunks():
    reg = create_command_registry()

    async def three_items(_inp: Any, _ctx: Any) -> CommandResult[Any]:
        return success([1, 2, 3])

    reg.register(CommandDefinition(name="items-list", description="List", handler=three_items))

    stream = reg.execute_stream("items-list", {}, StreamOptions(timeout=25))
    first = await anext(stream)
    assert first.type == "data" and first.data == 1
    await asyncio.sleep(0.05)
    second = await anext(stream)
    assert second.type == "error"
    assert second.error.code == "STREAM_TIMEOUT"
    assert second.resume_from == 1


@pytest.mark.asyncio
async def test_custom_dataclass_context_works_with_stream_and_pipeline():
    from dataclasses import dataclass

    @dataclass
    class CustomCtx:
        trace_id: str | None = None
        extra: dict[str, Any] | None = None

    async def exec_fn(name: str, inp: Any, ctx: Any) -> CommandResult[Any]:
        return success({"name": name, "trace": ctx.trace_id})

    chunks = [
        chunk
        async for chunk in execute_stream(
            "demo-run",
            {},
            exec_fn,
            CustomCtx(trace_id="t1", extra={"k": "v"}),  # type: ignore[arg-type]
            StreamExecutorOptions(timeout=5000),
        )
    ]
    assert [c.type for c in chunks] == ["data", "complete"]

    pipe = await execute_pipeline(
        PipelineRequest(steps=[PipelineStep(command="demo-run")]),
        exec_fn,
        CustomCtx(trace_id="t2", extra={"k": "v"}),
    )
    assert pipe.steps[0].status == StepStatus.SUCCESS
    assert pipe.data == {"name": "demo-run", "trace": "t2"}


@pytest.mark.asyncio
async def test_direct_command_registry_preserves_cancellation_and_stream_budget_skip():
    from afd.direct import create_direct_registry

    @define_command(
        name="big-data",
        description="Big",
        output_budget=OutputBudget(default_bytes=512, max_bytes=512),
        expose=ExposeOptions(agent=True, mcp=True),
    )
    async def big_data(_inp: Any) -> CommandResult[Any]:
        return success([{"text": "x" * 1000}])

    registry = create_direct_registry([big_data])

    cancelled = asyncio.Event()
    cancelled.set()
    res_cancelled = await registry.execute("big-data", {}, CommandContext(signal=cancelled))
    assert res_cancelled.success is False
    assert res_cancelled.error is not None and res_cancelled.error.code == "COMMAND_CANCELLED"

    # Streaming through execute_stream skips B5 budget even across DirectCommandRegistry.
    chunks = [chunk async for chunk in execute_stream("big-data", {}, registry.execute)]
    assert [c.type for c in chunks] == ["data", "complete"]


@pytest.mark.asyncio
async def test_simple_registry_rejects_non_mapping_input_with_validation_error():
    reg = SimpleRegistry()

    @reg.command("greet-one")
    async def greet_one(name: str = "world") -> CommandResult[Any]:
        return success({"hi": name})

    res = await reg.execute("greet-one", "not-a-dict")  # type: ignore[arg-type]
    assert res.success is False
    assert res.error is not None and res.error.code == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_decorated_core_command_redacts_raising_validator_and_honors_raw_schema():
    from pydantic import BaseModel, field_validator

    class ExplodingReq(BaseModel):
        value: str

        @field_validator("value")
        @classmethod
        def _boom(cls, v: str) -> str:
            raise RuntimeError("secret-validator-trace")

    @define_command(name="explode-val", description="Explodes", input_schema=ExplodingReq)
    async def explode_val(inp: ExplodingReq) -> CommandResult[Any]:
        return success({"value": inp.value})

    @define_command(name="no-schema-dec", description="No schema")
    async def no_schema_dec(inp: Any) -> CommandResult[Any]:
        return success({"inp": inp})

    reg = create_command_registry()
    reg.register(CommandDefinition(name="explode-val", description="Explodes", handler=explode_val))
    reg.register(
        CommandDefinition(
            name="no-schema-dec",
            description="No schema",
            handler=no_schema_dec,
            input_schema={
                "type": "object",
                "properties": {"count": {"type": "integer"}},
                "required": ["count"],
            },
        )
    )

    boom = await reg.execute("explode-val", {"value": "x"})
    assert boom.success is False
    assert boom.error is not None and boom.error.code == "VALIDATION_ERROR"
    assert "secret-validator-trace" not in (boom.error.suggestion or "")

    bad_raw = await reg.execute("no-schema-dec", {})
    assert bad_raw.success is False
    assert bad_raw.error is not None and bad_raw.error.code == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_mcp_server_apps_calls_refuse_before_preflight_in_batch_and_stream():
    server = create_server(
        "apps-preflight",
        tool_strategy="hybrid",
        first_class_tools=["missing-cmd"],
    )

    @server.command(name="real-cmd", description="Real", expose=ExposeOptions(mcp=True))
    async def real_cmd(_inp: Any) -> CommandResult[Any]:
        return success({"ok": True})

    apps_ctx = CommandContext(extra={"interface": "apps"})
    batch = await server.execute_batch(
        {"commands": [{"command": "real-cmd", "input": {}}]}, apps_ctx
    )
    assert batch.results[0].result.success is False
    assert (
        batch.results[0].result.error is not None
        and batch.results[0].result.error.code == "CALL_NOT_GRANTED"
    )

    chunks = [chunk async for chunk in server.execute_stream("real-cmd", {}, context=apps_ctx)]
    assert len(chunks) == 1 and chunks[0].type == "error"
    assert chunks[0].error.code == "CALL_NOT_GRANTED"
