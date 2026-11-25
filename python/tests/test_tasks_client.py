"""Live end-to-end tests for Python ``McpClient`` MCP Tasks support over Streamable HTTP."""

from __future__ import annotations

import asyncio
import socket
import threading
import time
from contextlib import asynccontextmanager
from typing import Any

import pytest

pytest.importorskip("mcp")
pytest.importorskip("uvicorn")

import uvicorn  # noqa: E402

from afd import Actor, CommandResult, ExposeOptions, McpClient, McpClientConfig, TaskInfo, success  # noqa: E402
from afd.core.commands import CommandContext  # noqa: E402
from afd.server import (  # noqa: E402
    ContextHookRequest,
    InMemoryTaskStore,
    TaskFailedChange,
    TaskOptions,
    TaskRpcError,
    create_server,
)
from afd.transports.streamable_http import ElicitationRequest, ElicitationResponse  # noqa: E402

MCP = ExposeOptions(mcp=True)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@asynccontextmanager
async def _serve_http(server: Any):
    port = _free_port()
    app = server.streamable_http_app(stateless_http=True, json_response=True)
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    uvi = uvicorn.Server(config)
    thread = threading.Thread(target=uvi.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10.0
    while not uvi.started:
        if time.monotonic() >= deadline:
            uvi.should_exit = True
            raise RuntimeError("uvicorn server did not start in time")
        await asyncio.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        uvi.should_exit = True
        server.stop_tasks()
        thread.join(timeout=5.0)


def _make_live_server() -> tuple[Any, asyncio.Event]:
    cancelled_on_server = asyncio.Event()

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = Actor(kind="human", id=req.header("x-test-user") or "default-user")
        return ctx

    server = create_server(
        "live-tasks",
        tool_strategy="individual",
        context_hook=hook,
        confirmations="enforce",
        task_options=TaskOptions(
            poll_interval_ms=20,
            check_interval_ms=15,
            callers_identified_by_hook=True,
        ),
    )

    @server.command(
        name="job-progress",
        description="Reports progress then finishes",
        expose=MCP,
        task="required",
    )
    async def job_progress(input: Any, context: CommandContext) -> CommandResult[Any]:
        if context.report_progress is not None:
            context.report_progress("step-1")
        await asyncio.sleep(0.04)
        if context.report_progress is not None:
            context.report_progress("step-2")
        await asyncio.sleep(0.04)
        return success({"done": True, "echo": (input or {}).get("value")})

    @server.command(name="job-optional", description="Optional task", expose=MCP, task="optional")
    async def job_optional(input: Any) -> CommandResult[Any]:
        return success({"mode": "optional"})

    @server.command(
        name="job-hang", description="Waits until cancelled", expose=MCP, task="required"
    )
    async def job_hang(input: Any) -> CommandResult[Any]:
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled_on_server.set()
            raise
        return success({})

    @server.command(
        name="job-confirm",
        description="Needs confirmation (non-task)",
        confirm_prompt="Proceed with job-confirm?",
        expose=MCP,
    )
    async def job_confirm(input: Any) -> CommandResult[Any]:
        return success({"confirmed": True})

    return server, cancelled_on_server


async def test_client_polls_reports_progress_cancels_and_handles_missing_capability():
    server, cancelled_on_server = _make_live_server()

    async with _serve_http(server) as url:
        # 1. tasks=True: polls to completion, fires on_task_progress, supports cancel and timeout
        client = McpClient(
            McpClientConfig(
                url=url,
                protocol_mode="modern",
                tasks=True,
                auto_reconnect=False,
                headers={"x-test-user": "alice"},
                timeout=10.0,
            )
        )
        await client.connect()
        try:
            updates: list[TaskInfo] = []
            res = await client.call(
                "job-progress",
                {"value": "hello"},
                on_task_progress=updates.append,
            )
            assert res.success is True
            assert res.data == {"done": True, "echo": "hello"}
            assert updates[0].status == "working"
            assert updates[-1].status == "completed"
            assert any(u.status_message in ("step-1", "step-2") for u in updates)

            # get_task on completed task returns DetailedTask
            detailed = await client.get_task(updates[0].task_id)
            assert detailed.status == "completed"
            assert detailed.task_id == updates[0].task_id

            # Cancel via asyncio.Event
            cancel_event = asyncio.Event()
            cancel_res = await client.call(
                "job-hang",
                {},
                cancel=cancel_event,
                on_task_progress=lambda _t: cancel_event.set(),
            )
            assert cancel_res.success is False
            assert cancel_res.error is not None
            assert cancel_res.error.code == "COMMAND_CANCELLED"
            assert cancel_res.error.retryable is False
            await asyncio.wait_for(cancelled_on_server.wait(), timeout=2.0)

            # Timeout on hanging task -> TIMEOUT
            timed_out = await client.call("job-hang", {}, timeout=0.12)
            assert timed_out.success is False
            assert timed_out.error is not None
            assert timed_out.error.code == "TIMEOUT"
            assert timed_out.error.retryable is True
        finally:
            await client.disconnect()

        # 2. tasks=False on required command -> MISSING_CLIENT_CAPABILITY
        no_tasks = McpClient(
            McpClientConfig(
                url=url,
                protocol_mode="modern",
                tasks=False,
                auto_reconnect=False,
                headers={"x-test-user": "alice"},
            )
        )
        await no_tasks.connect()
        try:
            denied = await no_tasks.call("job-progress", {"value": "x"})
            assert denied.success is False
            assert denied.error is not None
            assert denied.error.code == "MISSING_CLIENT_CAPABILITY"
            assert denied.error.retryable is False

            # Optional still runs inline when tasks=False
            opt = await no_tasks.call("job-optional", {})
            assert opt.success is True
            assert opt.data == {"mode": "optional"}
        finally:
            await no_tasks.disconnect()

        # 3. tasks=True AND on_elicitation coexist on the same client
        async def accept_all(_req: ElicitationRequest) -> ElicitationResponse:
            return ElicitationResponse(action="accept", content={"confirm": True})

        both = McpClient(
            McpClientConfig(
                url=url,
                protocol_mode="modern",
                tasks=True,
                on_elicitation=accept_all,
                auto_reconnect=False,
                headers={"x-test-user": "alice"},
            )
        )
        await both.connect()
        try:
            t_res = await both.call("job-progress", {"value": "with-elicit"})
            assert t_res.success is True
            assert t_res.data == {"done": True, "echo": "with-elicit"}

            c_res = await both.call("job-confirm", {})
            assert c_res.success is True
            assert c_res.data == {"confirmed": True}
        finally:
            await both.disconnect()


async def test_client_handles_failed_task_status_and_disconnect_during_poll():
    class FailingStore(InMemoryTaskStore):
        async def create(self, record: Any, call: Any = None) -> None:
            await super().create(record, call)
            if record.command == "job-rpc-fail":
                await super().update(
                    record.id,
                    record.owner,
                    TaskFailedChange(
                        error=TaskRpcError(code=-32603, message="Worker crashed"),
                        at=record.created_at + 1,
                    ),
                )

    failing_store = FailingStore()

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = Actor(kind="human", id="alice")
        return ctx

    server = create_server(
        "fail-tasks",
        tool_strategy="individual",
        context_hook=hook,
        task_store=failing_store,
        task_options=TaskOptions(
            poll_interval_ms=15,
            check_interval_ms=15,
            callers_identified_by_hook=True,
        ),
    )

    @server.command(
        name="job-rpc-fail", description="Marked failed in store", expose=MCP, task="required"
    )
    async def job_rpc_fail(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(10)
        return success({})

    @server.command(name="job-long", description="Long running", expose=MCP, task="required")
    async def job_long(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(10)
        return success({})

    async with _serve_http(server) as url:
        client = McpClient(
            McpClientConfig(
                url=url,
                protocol_mode="modern",
                tasks=True,
                auto_reconnect=False,
            )
        )
        await client.connect()
        try:
            failed = await client.call("job-rpc-fail", {})
            assert failed.success is False
            assert failed.error is not None
            assert failed.error.code == "INTERNAL_ERROR"

            # Disconnect while a poll is in flight unblocks promptly instead of hanging
            started = asyncio.Event()

            async def call_long():
                return await client.call("job-long", {}, on_task_progress=lambda _t: started.set())

            poll_task = asyncio.create_task(call_long())
            await asyncio.wait_for(started.wait(), timeout=2.0)
            await client.disconnect()
            disconnected_res = await asyncio.wait_for(poll_task, timeout=2.0)
            assert disconnected_res.success is False
            assert disconnected_res.error is not None
            assert disconnected_res.error.code == "TRANSPORT_ERROR"
        finally:
            if client.is_connected():
                await client.disconnect()
    assert failing_store.size >= 2


async def test_client_inline_result_type_task_output_schema_and_inflight_poll_timeout_cancel():
    from pydantic import BaseModel

    from afd.transports.base import TransportState
    from afd.transports.mock import MockTransport

    class StrictOutput(BaseModel):
        count: int

    get_entered = asyncio.Event()
    release_get = asyncio.Event()
    stall_gets = False

    class StallGetStore(InMemoryTaskStore):
        async def get(self, task_id: str, owner: str) -> Any:
            if stall_gets:
                get_entered.set()
                await release_get.wait()
            return await super().get(task_id, owner)

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = Actor(kind="human", id="alice")
        return ctx

    server = create_server(
        "edge-tasks",
        tool_strategy="individual",
        context_hook=hook,
        task_store=StallGetStore(),
        task_options=TaskOptions(
            poll_interval_ms=10,
            check_interval_ms=10,
            callers_identified_by_hook=True,
        ),
    )

    @server.command(
        name="inline-fake-task", description="Returns JSON with resultType=task", expose=MCP
    )
    async def inline_fake_task(input: Any) -> CommandResult[Any]:
        return success({"resultType": "task", "taskId": "not-a-real-task"})

    @server.command(
        name="bad-schema-task",
        description="Declares output schema but returns wrong type",
        expose=MCP,
        task="optional",
        output_schema=StrictOutput,
    )
    async def bad_schema_task(input: Any) -> CommandResult[Any]:
        return success({"count": "not-an-int"})

    @server.command(name="job-stall", description="Stalls during poll", expose=MCP, task="required")
    async def job_stall(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(5)
        return success({"ok": True})

    @server.command(name="job-ping", description="Fast inline ping", expose=MCP)
    async def job_ping(input: Any) -> CommandResult[Any]:
        return success({"pong": True})

    async with _serve_http(server) as url:
        # 1. Inline JSON containing {"resultType": "task"} is never hijacked into polling
        for tasks_flag in (False, True):
            c = McpClient(McpClientConfig(url=url, protocol_mode="modern", tasks=tasks_flag))
            await c.connect()
            try:
                res = await c.call("inline-fake-task", {})
                assert res.success is True
                assert res.data == {"resultType": "task", "taskId": "not-a-real-task"}
            finally:
                await c.disconnect()

        # 2. Completed task validates output_schema just like inline calls
        client = McpClient(
            McpClientConfig(url=url, protocol_mode="modern", tasks=True, auto_reconnect=False)
        )
        await client.connect()
        try:
            bad = await client.call("bad-schema-task", {})
            assert bad.success is False
            assert bad.error is not None
            assert bad.error.code == "TRANSPORT_ERROR"

            # 3. Timeout expiring during an in-flight tasks/get returns TIMEOUT, does not wait 5s,
            # and leaves the client connected and usable!
            stall_gets = True
            get_entered.clear()
            release_get.clear()
            t0 = time.monotonic()
            timed_out = await client.call("job-stall", {}, timeout=0.2)
            elapsed = time.monotonic() - t0
            assert timed_out.success is False
            assert timed_out.error is not None
            assert timed_out.error.code == "TIMEOUT"
            assert elapsed < 2.0
            assert client.is_connected() is True

            # Direct client.get_task(..., timeout=...) timeout raises TimeoutError and keeps connection alive
            captured_ids: list[str] = []
            cancel_for_id = asyncio.Event()

            def grab_id(info: TaskInfo) -> None:
                captured_ids.append(info.task_id)
                cancel_for_id.set()

            await client.call("job-stall", {}, cancel=cancel_for_id, on_task_progress=grab_id)
            assert len(captured_ids) == 1
            with pytest.raises(asyncio.TimeoutError):
                await client.get_task(captured_ids[0], timeout=0.05)
            assert client.is_connected() is True

            # Follow-up inline call succeeds on the same connection
            ping = await client.call("job-ping", {})
            assert ping.success is True
            assert ping.data == {"pong": True}

            # 4. Cancellation arriving while tasks/get is blocked unblocks promptly
            get_entered.clear()
            cancel_ev = asyncio.Event()
            call_fut = asyncio.create_task(
                client.call("job-stall", {}, cancel=cancel_ev, timeout=10.0)
            )
            await asyncio.wait_for(get_entered.wait(), timeout=2.0)
            cancel_ev.set()
            cancelled = await asyncio.wait_for(call_fut, timeout=2.0)
            assert cancelled.success is False
            assert cancelled.error is not None
            assert cancelled.error.code == "COMMAND_CANCELLED"
        finally:
            release_get.set()
            if client.is_connected():
                await client.disconnect()

    # 5. McpClientConfig positional order preserves max_stream_event_bytes
    cfg = McpClientConfig(
        "http://example.test/mcp",
        None,
        "streamable-http",
        "auto",
        False,
        1,
        1.0,
        {},
        10.0,
        "n",
        "1",
        False,
        None,
        4096,
    )
    assert cfg.max_stream_event_bytes == 4096
    assert cfg.tasks is False

    # 6. call(..., timeout=...) works on MockTransport (including slow handlers) and minimal custom transports
    mock = MockTransport()
    mock.add_mock_response("ping", {"success": True, "data": {"ok": 1}})

    async def slow_mock_handler(args: dict[str, Any]) -> Any:
        await asyncio.sleep(5)
        return {"success": True, "data": {}}

    mock.register_tool("slow-mock", slow_mock_handler)
    mc = McpClient(transport=mock)
    await mc.connect()
    res_mock = await mc.call("ping", {}, timeout=1.0)
    assert res_mock.success is True
    assert res_mock.data == {"ok": 1}
    slow_mock_res = await mc.call("slow-mock", {}, timeout=0.05)
    assert slow_mock_res.success is False
    assert slow_mock_res.error is not None
    assert slow_mock_res.error.code == "OUTCOME_UNKNOWN"
    assert slow_mock_res.error.retryable is False
    assert slow_mock_res.error.details == {"cause": "TIMEOUT"}
    await mc.disconnect()

    class MinimalTransport:
        def __init__(self) -> None:
            self.state = TransportState.DISCONNECTED

        async def connect(self) -> None:
            self.state = TransportState.CONNECTED

        async def disconnect(self) -> None:
            self.state = TransportState.DISCONNECTED

        async def list_tools(self) -> list[Any]:
            return []

        async def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
            if name == "slow":
                await asyncio.sleep(5)
            return {"success": True, "data": {"minimal": True}}

    min_client = McpClient(transport=MinimalTransport())
    await min_client.connect()
    ok_min = await min_client.call("fast", {}, timeout=1.0)
    assert ok_min.success is True
    assert ok_min.data == {"minimal": True}
    to_min = await min_client.call("slow", {}, timeout=0.05)
    assert to_min.success is False
    assert to_min.error is not None
    assert to_min.error.code == "OUTCOME_UNKNOWN"
    assert to_min.error.retryable is False
    assert to_min.error.details == {"cause": "TIMEOUT"}
    await min_client.disconnect()


async def test_read_only_vs_non_read_only_task_poll_outcomes():
    class ExpiringAndFailingStore(InMemoryTaskStore):
        async def create(self, record: Any, call: Any = None) -> None:
            await super().create(record, call)
            if record.command in ("job-mut-rpc-fail", "job-read-rpc-fail"):
                await super().update(
                    record.id,
                    record.owner,
                    TaskFailedChange(
                        error=TaskRpcError(code=-32603, message="Worker crashed"),
                        at=record.created_at + 1,
                    ),
                )

        async def get(self, task_id: str, owner: str) -> Any:
            record = await super().get(task_id, owner)
            if record is not None and record.command in ("job-mut-expired", "job-read-expired"):
                self._records.pop(task_id, None)
                return None
            return record

    def hook(req: ContextHookRequest, ctx: CommandContext) -> CommandContext:
        ctx.actor = Actor(kind="human", id="alice")
        return ctx

    server = create_server(
        "ro-tasks",
        tool_strategy="individual",
        context_hook=hook,
        task_store=ExpiringAndFailingStore(),
        task_options=TaskOptions(
            poll_interval_ms=15,
            check_interval_ms=15,
            callers_identified_by_hook=True,
        ),
    )

    @server.command(
        name="job-mut-rpc-fail",
        description="Mutating task that fails with JSON-RPC -32603",
        expose=MCP,
        mutation=True,
        task="required",
    )
    async def job_mut_rpc_fail(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(10)
        return success({})

    @server.command(
        name="job-read-rpc-fail",
        description="Read-only task that fails with JSON-RPC -32603",
        expose=MCP,
        mutation=False,
        task="required",
    )
    async def job_read_rpc_fail(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(10)
        return success({})

    @server.command(
        name="job-mut-timeout",
        description="Mutating task that times out",
        expose=MCP,
        mutation=True,
        task="required",
    )
    async def job_mut_timeout(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(10)
        return success({})

    @server.command(
        name="job-read-timeout",
        description="Read-only task that times out",
        expose=MCP,
        mutation=False,
        task="required",
    )
    async def job_read_timeout(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(10)
        return success({})

    @server.command(
        name="job-mut-expired",
        description="Mutating task whose record disappears during poll",
        expose=MCP,
        mutation=True,
        task="required",
    )
    async def job_mut_expired(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(10)
        return success({})

    @server.command(
        name="job-read-expired",
        description="Read-only task whose record disappears during poll",
        expose=MCP,
        mutation=False,
        task="required",
    )
    async def job_read_expired(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(10)
        return success({})

    @server.command(
        name="job-mut-disconnect",
        description="Mutating task disconnected while polling",
        expose=MCP,
        mutation=True,
        task="required",
    )
    async def job_mut_disconnect(input: Any) -> CommandResult[Any]:
        await asyncio.sleep(10)
        return success({})

    async with _serve_http(server) as url:
        client = McpClient(
            McpClientConfig(
                url=url,
                protocol_mode="modern",
                tasks=True,
                auto_reconnect=False,
            )
        )
        await client.connect()
        try:
            mut_rpc = await client.call("job-mut-rpc-fail", {})
            assert mut_rpc.success is False
            assert mut_rpc.error is not None
            assert mut_rpc.error.code == "OUTCOME_UNKNOWN"
            assert mut_rpc.error.retryable is False
            assert mut_rpc.error.details == {"cause": "INTERNAL_ERROR", "jsonRpcCode": -32603}

            read_rpc = await client.call("job-read-rpc-fail", {})
            assert read_rpc.success is False
            assert read_rpc.error is not None
            assert read_rpc.error.code == "INTERNAL_ERROR"
            assert read_rpc.error.retryable is True

            expired = await client.call("job-mut-expired", {})
            assert expired.success is False
            assert expired.error is not None
            assert expired.error.code == "OUTCOME_UNKNOWN"
            assert expired.error.retryable is False
            assert expired.error.details == {"cause": "TRANSPORT_ERROR", "jsonRpcCode": -32602}

            read_expired = await client.call("job-read-expired", {})
            assert read_expired.success is False
            assert read_expired.error is not None
            assert read_expired.error.code == "TRANSPORT_ERROR"
            assert read_expired.error.retryable is False
            assert read_expired.error.details == {"jsonRpcCode": -32602}

            mut_to = await client.call("job-mut-timeout", {}, timeout=0.12)
            assert mut_to.success is False
            assert mut_to.error is not None
            assert mut_to.error.code == "OUTCOME_UNKNOWN"
            assert mut_to.error.retryable is False
            assert mut_to.error.details == {"cause": "TIMEOUT"}

            if not client.is_connected():
                await client.connect()
            read_to = await client.call("job-read-timeout", {}, timeout=0.12)
            assert read_to.success is False
            assert read_to.error is not None
            assert read_to.error.code == "TIMEOUT"
            assert read_to.error.retryable is True

            if not client.is_connected():
                await client.connect()
            started = asyncio.Event()
            poll_task = asyncio.create_task(
                client.call("job-mut-disconnect", {}, on_task_progress=lambda _t: started.set())
            )
            await asyncio.wait_for(started.wait(), timeout=2.0)
            await client.disconnect()
            disc = await asyncio.wait_for(poll_task, timeout=2.0)
            assert disc.success is False
            assert disc.error is not None
            assert disc.error.code == "OUTCOME_UNKNOWN"
            assert disc.error.retryable is False
            assert disc.error.details == {"cause": "TRANSPORT_ERROR"}
        finally:
            if client.is_connected():
                await client.disconnect()
