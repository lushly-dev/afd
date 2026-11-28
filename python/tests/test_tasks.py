"""Tests for Python MCP Tasks: metadata, TaskStore, InMemoryTaskStore, and server runtime
(``spec/command-metadata.md``, "Tasks"; SEP-2663).
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any

import pytest

pytest.importorskip("mcp")

import httpx  # noqa: E402
from mcp import Client, MCPError  # noqa: E402
from mcp.client.extension import ClientExtension, ResultClaim  # noqa: E402
from mcp.types import CallToolResult  # noqa: E402
from mcp_types import Request, RequestParams, Result  # noqa: E402
from pydantic import ConfigDict, Field  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402

from afd import (  # noqa: E402
    Actor,
    CommandError,
    CommandResult,
    ExposeOptions,
    create_command_registry,
    error,
    fixed_clock,
    success,
)
from afd.core.commands import CommandContext, CommandDefinition, command_to_mcp_tool  # noqa: E402
from afd.server import (  # noqa: E402
    DEFAULT_MAX_TASKS,
    DEFAULT_MAX_TASKS_PER_OWNER,
    TASKS_EXTENSION_ID,
    ContextHookRequest,
    InMemoryTaskStore,
    TaskCall,
    TaskCancelledChange,
    TaskCancelRequestedChange,
    TaskCompletedChange,
    TaskFailedChange,
    TaskOptions,
    TaskProgressChange,
    TaskRecord,
    TaskRpcError,
    TaskStoreError,
    apply_task_change,
    create_server,
    define_command,
    is_task_expired,
    is_task_id,
    new_task_id,
    task_owner_matches,
    task_ttl_for,
)
from afd.server.principal import principal_binding  # noqa: E402
from afd.server.tasks_runtime import due_task_stop, token_expired_error  # noqa: E402

MCP = ExposeOptions(mcp=True)
MODERN = "2026-07-28"


class _TestCreateTaskResult(Result):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    result_type: Any = Field(alias="resultType")


class _TaskIdParams(RequestParams):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    task_id: str = Field(alias="taskId")


class _UpdateTaskParams(RequestParams):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
    task_id: str = Field(alias="taskId")
    input_responses: dict[str, Any] | None = Field(default=None, alias="inputResponses")


class _GetTaskRequest(Request[_TaskIdParams, Any]):
    method: str = "tasks/get"
    params: _TaskIdParams
    name_param = "taskId"


class _UpdateTaskRequest(Request[_UpdateTaskParams, Any]):
    method: str = "tasks/update"
    params: _UpdateTaskParams
    name_param = "taskId"


class _CancelTaskRequest(Request[_TaskIdParams, Any]):
    method: str = "tasks/cancel"
    params: _TaskIdParams
    name_param = "taskId"


class _DetailedTaskResult(Result):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    task_id: str = Field(alias="taskId")
    status: str
    status_message: str | None = Field(default=None, alias="statusMessage")
    created_at: str = Field(alias="createdAt")
    last_updated_at: str = Field(alias="lastUpdatedAt")
    ttl_ms: int = Field(alias="ttlMs")
    poll_interval_ms: int | None = Field(default=None, alias="pollIntervalMs")
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


def _tasks_extension() -> ClientExtension:
    from typing import Literal

    class _ClaimedTask(Result):
        model_config = ConfigDict(populate_by_name=True, extra="allow")
        result_type: Literal["task"] = Field(alias="resultType")
        task_id: str = Field(alias="taskId")
        status: str
        status_message: str | None = Field(default=None, alias="statusMessage")
        created_at: str = Field(alias="createdAt")
        last_updated_at: str = Field(alias="lastUpdatedAt")
        ttl_ms: int = Field(alias="ttlMs")
        poll_interval_ms: int | None = Field(default=None, alias="pollIntervalMs")

    async def _noop_resolve(_claimed: _ClaimedTask, _ctx: Any) -> CallToolResult:
        return CallToolResult(content=[])

    class _Ext(ClientExtension):
        identifier = TASKS_EXTENSION_ID

        def claims(self):
            return (ResultClaim(result_type="task", model=_ClaimedTask, resolve=_noop_resolve),)

    return _Ext()


def _body(result: Any) -> dict[str, Any]:
    return json.loads(result.content[0].text)


async def _poll_until_done(
    client: Client,
    task_id: str,
    *,
    timeout: float = 5.0,
) -> _DetailedTaskResult:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        got = await client.session.send_request(
            _GetTaskRequest(params=_TaskIdParams(taskId=task_id)),
            _DetailedTaskResult,
        )
        if got.status != "working":
            return got
        await asyncio.sleep(0.01)
    raise AssertionError(f"Task {task_id} did not settle within {timeout}s")


@asynccontextmanager
async def _http_client(server: Any, *, stateless: bool = True, asgi_middleware: Any = None):
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


async def _http_rpc(
    http: httpx.AsyncClient,
    method: str,
    params: dict[str, Any] | None = None,
    *,
    tasks_cap: bool = True,
    headers: dict[str, str] | None = None,
    expected_status: int | None = None,
) -> dict[str, Any]:
    caps: dict[str, Any] = {"extensions": {TASKS_EXTENSION_ID: {}}} if tasks_cap else {}
    meta: dict[str, Any] = {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": caps,
        "io.modelcontextprotocol/clientInfo": {"name": "tasks-http-test", "version": "0"},
    }
    full_params = dict(params or {})
    full_params["_meta"] = {**meta, **(full_params.get("_meta") or {})}
    req_headers: dict[str, str] = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": method,
        **(headers or {}),
    }
    if method == "tools/call" and isinstance(full_params.get("name"), str):
        req_headers["Mcp-Name"] = full_params["name"]
    elif method.startswith("tasks/") and isinstance(full_params.get("taskId"), str):
        req_headers["Mcp-Name"] = full_params["taskId"]
    resp = await http.post(
        "/mcp",
        headers=req_headers,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": full_params},
    )
    if expected_status is not None:
        assert resp.status_code == expected_status, resp.text
    return resp.json()


# ═══════════════════════════════════════════════════════════════════════════════
# METADATA & REGISTRATION VALIDATION
# ═══════════════════════════════════════════════════════════════════════════════


def test_task_metadata_surfaces_in_meta_grouped_actions_and_afd_detail():
    async def noop(input: Any, context: Any = None) -> CommandResult[Any]:
        return success({"ok": True})

    cmd_default = CommandDefinition(name="job-default", description="Default", handler=noop)
    cmd_opt = CommandDefinition(
        name="job-opt", description="Optional", handler=noop, task="optional"
    )
    cmd_req = CommandDefinition(
        name="job-req", description="Required", handler=noop, task="required"
    )
    cmd_never = CommandDefinition(name="job-never", description="Never", handler=noop, task="never")

    assert "task" not in command_to_mcp_tool(cmd_default)["_meta"]
    assert command_to_mcp_tool(cmd_opt)["_meta"]["task"] == "optional"
    assert command_to_mcp_tool(cmd_req)["_meta"]["task"] == "required"
    assert command_to_mcp_tool(cmd_never)["_meta"]["task"] == "never"

    server = create_server("meta-test", tool_strategy="grouped")

    @server.command(name="job-opt", description="Optional task", expose=MCP, task="optional")
    async def _opt(input: Any) -> CommandResult[Any]:
        return success({})

    @server.command(name="job-plain", description="Plain command", expose=MCP)
    async def _plain(input: Any) -> CommandResult[Any]:
        return success({})

    tools = {t["name"]: t for t in server.get_tool_definitions()}
    actions = {a["command"]: a for a in tools["job"]["_meta"]["actions"]}
    assert actions["job-opt"]["task"] == "optional"
    assert "task" not in actions["job-plain"]


async def test_afd_detail_reports_task_when_set_and_omits_when_unset():
    server = create_server("detail-test", tool_strategy="individual")

    @server.command(name="job-opt", description="Optional", expose=MCP, task="optional")
    async def _opt(input: Any) -> CommandResult[Any]:
        return success({})

    @server.command(name="job-req", description="Required", expose=MCP, task="required")
    async def _req(input: Any) -> CommandResult[Any]:
        return success({})

    @server.command(name="job-plain", description="Plain", expose=MCP)
    async def _plain(input: Any) -> CommandResult[Any]:
        return success({})

    detail = await server.route_tool_call(
        "afd-detail", {"command": ["job-opt", "job-req", "job-plain"]}
    )
    assert detail.success is True
    by_name = {entry["name"]: entry for entry in detail.data}
    assert by_name["job-opt"]["task"] == "optional"
    assert by_name["job-req"]["task"] == "required"
    assert "task" not in by_name["job-plain"]


def test_registration_refuses_task_beside_person_gates_and_invalid_values():
    async def noop(input: Any, context: Any = None) -> CommandResult[Any]:
        return success({})

    # Invalid value
    with pytest.raises(ValueError, match="invalid task support"):

        @define_command(name="job-bad", description="Bad", task="always")  # type: ignore[arg-type]
        async def _bad(input: Any):
            return success({})

    # Beside confirm_prompt
    for support in ("optional", "required"):
        with pytest.raises(ValueError, match="confirm_prompt"):

            @define_command(
                name="job-confirm",
                description="Confirm",
                confirm_prompt="Sure?",
                task=support,  # type: ignore[arg-type]
            )
            async def _c(input: Any):
                return success({})

    # Beside approval="required" or callable approval
    for support in ("optional", "required"):
        with pytest.raises(ValueError, match="approval"):

            @define_command(
                name="job-approve",
                description="Approve",
                approval="required",
                task=support,  # type: ignore[arg-type]
            )
            async def _a(input: Any):
                return success({})

        with pytest.raises(ValueError, match="approval"):

            @define_command(
                name="job-cond",
                description="Conditional",
                approval=lambda _inp, _ctx: "required",
                task=support,  # type: ignore[arg-type]
            )
            async def _cond(input: Any):
                return success({})

    # Core registry refuses confirmation_mode attribute as well
    reg = create_command_registry()
    cmd_cm = CommandDefinition(
        name="job-cm", description="Host verified", handler=noop, task="optional"
    )
    cmd_cm.confirmation_mode = "host-verified"  # type: ignore[attr-defined]
    with pytest.raises(ValueError, match="confirmation_mode"):
        reg.register(cmd_cm)

    # Allowed: approval="not-required" with task="optional", and task="never" with confirm_prompt/approval
    @define_command(
        name="job-allowed",
        description="Allowed",
        approval="not-required",
        task="optional",
    )
    async def _ok(input: Any):
        return success({})

    @define_command(
        name="job-never-ok",
        description="Never task with confirm",
        confirm_prompt="Sure?",
        approval="required",
        task="never",
    )
    async def _never_ok(input: Any):
        return success({})


# ═══════════════════════════════════════════════════════════════════════════════
# TASK STORE, OPTIONS & HELPERS
# ═══════════════════════════════════════════════════════════════════════════════


def _make_record(
    task_id: str | None = None,
    owner: str = "owner-a",
    command: str = "job-run",
    status: Any = "working",
    created_at: int = 1000,
    last_updated_at: int | None = None,
    ttl_ms: int = 60_000,
) -> TaskRecord:
    return TaskRecord(
        id=task_id or new_task_id(),
        owner=owner,
        command=command,
        status=status,
        created_at=created_at,
        last_updated_at=created_at if last_updated_at is None else last_updated_at,
        ttl_ms=ttl_ms,
        poll_interval_ms=100,
    )


async def test_in_memory_task_store_crud_owner_isolation_and_eviction():
    store = InMemoryTaskStore(max_per_owner=2, max_total=3)
    assert DEFAULT_MAX_TASKS_PER_OWNER == 32
    assert DEFAULT_MAX_TASKS == 256

    rec1 = _make_record(owner="alice", created_at=1000)
    assert is_task_id(rec1.id)
    assert not is_task_id("short")
    assert not is_task_id("A" * 26)
    assert task_owner_matches("alice", "alice")
    assert not task_owner_matches("alice", "bob")

    await store.create(rec1)
    with pytest.raises(TaskStoreError) as dup:
        await store.create(rec1)
    assert dup.value.kind == "duplicate-id"

    assert await store.get(rec1.id, "alice") is not None
    assert await store.get(rec1.id, "bob") is None

    # Update ignored for wrong owner
    await store.update(rec1.id, "bob", TaskProgressChange(message="spoof", at=1100))
    got = await store.get(rec1.id, "alice")
    assert got is not None and got.status_message is None

    # Progress and completion
    await store.update(rec1.id, "alice", TaskProgressChange(message="half", at=1200))
    await store.update(
        rec1.id, "alice", TaskCompletedChange(result={"content": [], "isError": False}, at=1300)
    )
    # Terminal record is immutable
    await store.update(rec1.id, "alice", TaskCancelledChange(at=1400))
    got = await store.get(rec1.id, "alice")
    assert got is not None and got.status == "completed" and got.status_message == "half"

    # Per-owner limit evicts oldest finished task
    rec2 = _make_record(owner="alice", created_at=1500)
    await store.create(rec2)
    rec3 = _make_record(owner="alice", created_at=1600)
    await store.create(rec3)  # evicts rec1 (finished)
    assert await store.get(rec1.id, "alice") is None
    assert await store.get(rec2.id, "alice") is not None
    assert await store.get(rec3.id, "alice") is not None

    # Both alice tasks are working -> owner-limit
    rec4 = _make_record(owner="alice", created_at=1700)
    with pytest.raises(TaskStoreError) as lim:
        await store.create(rec4)
    assert lim.value.kind == "owner-limit"

    # Global limit (max_total=3): bob creates 1 working -> full -> carol gets total-limit
    bob1 = _make_record(owner="bob", created_at=1800)
    await store.create(bob1)
    carol1 = _make_record(owner="carol", created_at=1900)
    with pytest.raises(TaskStoreError) as tot:
        await store.create(carol1)
    assert tot.value.kind == "total-limit"

    # Mark bob1 failed -> carol1 evicts bob1 (finished)
    await store.update(
        bob1.id, "bob", TaskFailedChange(error=TaskRpcError(-32603, "boom"), at=1850)
    )
    await store.create(carol1)
    assert await store.get(bob1.id, "bob") is None
    assert await store.get(carol1.id, "carol") is not None

    # Expire removes records past TTL
    assert await store.expire(100_000) == 3
    assert store.size == 0


def test_task_options_validation_and_helpers():
    from afd.server import (
        DEFAULT_TASK_MAX_RUN_MS,
        DEFAULT_TASK_TTL_MS,
        TaskCompletedChange,
        finished_task_ttl_for,
    )
    from afd.server.tasks_runtime import task_run_timeout_error

    with pytest.raises(ValueError, match="ttl_ms"):
        TaskOptions(ttl_ms=0)
    with pytest.raises(ValueError, match="max_run_ms"):
        TaskOptions(max_run_ms=0)
    with pytest.raises(ValueError, match="poll_interval_ms"):
        TaskOptions(poll_interval_ms=True)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="token_expiry_grace_ms"):
        TaskOptions(token_expiry_grace_ms=-1)

    # Legacy positional calls keep their meaning (max_run_ms and ttl_ms on changes are keyword-only)
    positional_opts = TaskOptions(60_000, 250)
    assert positional_opts.ttl_ms == 60_000
    assert positional_opts.poll_interval_ms == 250
    assert positional_opts.max_run_ms == DEFAULT_TASK_MAX_RUN_MS
    positional_done = TaskCompletedChange({"content": [], "isError": False}, 120)
    assert positional_done.kind == "completed"
    assert positional_done.ttl_ms is None

    defaults = TaskOptions()
    assert defaults.max_run_ms == DEFAULT_TASK_MAX_RUN_MS
    assert defaults.ttl_ms == DEFAULT_TASK_TTL_MS
    assert task_ttl_for(defaults, now_ms=10_000, expires_at_seconds=None) == (
        DEFAULT_TASK_MAX_RUN_MS + DEFAULT_TASK_TTL_MS
    )

    opts = TaskOptions(max_run_ms=20_000, ttl_ms=40_000, token_expiry_grace_ms=5_000)
    assert task_ttl_for(opts, now_ms=10_000, expires_at_seconds=20) == 15_000
    assert task_ttl_for(opts, now_ms=10_000, expires_at_seconds=1000) == 60_000
    assert task_ttl_for(opts, now_ms=50_000, expires_at_seconds=10) == 1
    assert finished_task_ttl_for(opts, created_at_ms=10_000, finished_at_ms=25_000) == 55_000
    # Finishing past max_run_ms clamps elapsed so ttl_ms never widens past max_run_ms + ttl_ms
    assert finished_task_ttl_for(opts, created_at_ms=10_000, finished_at_ms=45_000) == 60_000
    # Clock regression clamps elapsed to 0
    assert finished_task_ttl_for(opts, created_at_ms=10_000, finished_at_ms=5_000) == 40_000
    assert (
        finished_task_ttl_for(
            opts, created_at_ms=10_000, finished_at_ms=15_000, expires_at_seconds=20
        )
        == 15_000
    )
    # Safe integer ceiling matches TypeScript/Rust
    huge_opts = TaskOptions(max_run_ms=(1 << 53) - 1, ttl_ms=10)
    assert task_ttl_for(huge_opts, now_ms=0) == (1 << 53) - 1

    assert due_task_stop(1000, 2000, 1000, run_deadline_ms=1000) == "token-expired"
    assert due_task_stop(2000, 1500, 1500, run_deadline_ms=1500) == "ttl-ended"
    assert due_task_stop(2000, 3000, 1500, run_deadline_ms=1500) == "run-timeout"
    assert due_task_stop(2000, 3000, 1500, run_deadline_ms=None) is None
    assert due_task_stop(2000, 3000, 1499, run_deadline_ms=1500) is None

    assert token_expired_error("not-started", True).retryable is True
    assert token_expired_error("running", True).retryable is False
    assert token_expired_error("running", False).retryable is True
    assert token_expired_error("finished", True).retryable is False
    assert token_expired_error("finished", False).retryable is True

    assert task_run_timeout_error("not-started", True).retryable is True
    assert task_run_timeout_error("running", True).retryable is False
    assert task_run_timeout_error("running", False).retryable is True
    assert task_run_timeout_error("running", False).code == "TIMEOUT"

    r = _make_record(created_at=100, ttl_ms=100)
    assert not is_task_expired(r, 199)
    assert is_task_expired(r, 200)
    assert apply_task_change(r, TaskCancelRequestedChange()) is True
    assert r.cancel_requested is True
    assert (
        apply_task_change(
            r,
            TaskCompletedChange(result={"content": [], "isError": False}, at=120, ttl_ms=70),
        )
        is True
    )
    assert r.ttl_ms == 70

    # Widening attempt is clamped to existing ttl_ms
    r_no_widen = _make_record(created_at=100, ttl_ms=50)
    assert (
        apply_task_change(
            r_no_widen,
            TaskCompletedChange(result={"content": [], "isError": False}, at=120, ttl_ms=90),
        )
        is True
    )
    assert r_no_widen.ttl_ms == 50


# ═══════════════════════════════════════════════════════════════════════════════
# SERVER RUNTIME: CAPABILITY NEGOTIATION, ROUTES, PROGRESS, CANCEL, TTL
# ═══════════════════════════════════════════════════════════════════════════════


async def test_capability_advertisement_and_optional_vs_required_in_process():
    server = create_server(
        "tasks-server",
        tool_strategy="individual",
        task_options=TaskOptions(poll_interval_ms=15, check_interval_ms=15),
    )

    @server.command(name="job-optional", description="Optional task", expose=MCP, task="optional")
    async def job_optional(input: Any, context: CommandContext) -> CommandResult[Any]:
        if context.report_progress is not None:
            context.report_progress("working-on-it")
        await asyncio.sleep(0.02)
        return success({"mode": "optional", "value": (input or {}).get("v", 1)})

    @server.command(name="job-required", description="Required task", expose=MCP, task="required")
    async def job_required(input: Any) -> CommandResult[Any]:
        return success({"mode": "required"})

    @server.command(name="job-inline", description="Never a task", expose=MCP)
    async def job_inline(input: Any) -> CommandResult[Any]:
        return success({"mode": "inline"})

    sdk = server._create_mcp_server()

    # 1. Modern client declaring io.modelcontextprotocol/tasks
    async with Client(sdk, extensions=[_tasks_extension()]) as client:
        assert client.protocol_version == MODERN
        assert TASKS_EXTENSION_ID in (client.server_capabilities.extensions or {})

        # Optional runs as a task
        seed = await client.session.call_tool("job-optional", {"v": 42}, allow_claimed=True)
        assert seed.result_type == "task"
        assert is_task_id(seed.task_id)
        assert seed.status == "working"

        settled = await _poll_until_done(client, seed.task_id)
        assert settled.status == "completed"
        assert settled.status_message == "working-on-it"
        assert settled.result is not None
        assert settled.result["isError"] is False
        parsed = json.loads(settled.result["content"][0]["text"])
        assert parsed["success"] is True
        assert parsed["data"] == {"mode": "optional", "value": 42}
        assert settled.result["structuredContent"] == parsed

        # tasks/update and tasks/cancel acknowledge a completed task without changing it
        await client.session.send_request(
            _UpdateTaskRequest(params=_UpdateTaskParams(taskId=seed.task_id, inputResponses={})),
            Result,
        )
        await client.session.send_request(
            _CancelTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
            Result,
        )
        after = await client.session.send_request(
            _GetTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
            _DetailedTaskResult,
        )
        assert after.status == "completed"

        # Unknown task id -> -32602
        with pytest.raises(MCPError) as exc:
            await client.session.send_request(
                _GetTaskRequest(params=_TaskIdParams(taskId="a" * 26)),
                _DetailedTaskResult,
            )
        assert exc.value.code == -32602

        # Non-task command still runs inline
        inline = await client.call_tool("job-inline", {})
        assert _body(inline)["data"] == {"mode": "inline"}

        # Required runs as a task
        req_seed = await client.session.call_tool("job-required", {}, allow_claimed=True)
        assert req_seed.result_type == "task"
        req_done = await _poll_until_done(client, req_seed.task_id)
        assert req_done.status == "completed"
        assert json.loads(req_done.result["content"][0]["text"])["data"] == {"mode": "required"}

    # 2. Modern client NOT declaring tasks
    async with Client(sdk) as client:
        # Optional runs inline
        opt_inline = await client.call_tool("job-optional", {"v": 7})
        assert _body(opt_inline)["data"] == {"mode": "optional", "value": 7}

        # Required returns -32021 naming the extension
        with pytest.raises(MCPError) as missing:
            await client.call_tool("job-required", {})
        assert missing.value.code == -32021
        assert TASKS_EXTENSION_ID in json.dumps(missing.value.data)

        # tasks/get also refuses -32021
        with pytest.raises(MCPError) as missing_get:
            await client.session.send_request(
                _GetTaskRequest(params=_TaskIdParams(taskId="a" * 26)),
                _DetailedTaskResult,
            )
        assert missing_get.value.code == -32021

    # 3. 2025 legacy client never gets tasks, even with extension object passed
    async with Client(sdk, mode="legacy") as client:
        assert not (
            client.server_capabilities.extensions
            and TASKS_EXTENSION_ID in client.server_capabilities.extensions
        )
        opt_legacy = await client.call_tool("job-optional", {"v": 9})
        assert _body(opt_legacy)["data"] == {"mode": "optional", "value": 9}
        with pytest.raises(MCPError) as legacy_req:
            await client.call_tool("job-required", {})
        assert legacy_req.value.code == -32021

    # 4. server.execute() always runs inline even for task="required"
    direct = await server.execute("job-required", {})
    assert direct.success is True and direct.data == {"mode": "required"}


async def test_routes_afd_call_grouped_hybrid_and_composite_refusal():
    ran: list[str] = []
    server = create_server(
        "routes-test",
        tool_strategy="grouped",
        task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10),
    )

    @server.command(name="work-opt", description="Opt", expose=MCP, task="optional")
    async def work_opt(input: Any) -> CommandResult[Any]:
        ran.append("opt")
        return success({"ran": "opt"})

    @server.command(name="work-req", description="Req", expose=MCP, task="required")
    async def work_req(input: Any) -> CommandResult[Any]:
        ran.append("req")
        return success({"ran": "req"})

    @server.command(name="work-plain", description="Plain", expose=MCP)
    async def work_plain(input: Any) -> CommandResult[Any]:
        ran.append("plain")
        return success({"ran": "plain"})

    sdk = server._create_mcp_server()
    async with Client(sdk, extensions=[_tasks_extension()]) as client:
        # Grouped tool starts a task
        g = await client.session.call_tool(
            "work", {"action": "opt", "params": {}}, allow_claimed=True
        )
        assert g.result_type == "task"
        g_done = await _poll_until_done(client, g.task_id)
        assert g_done.status == "completed"

        # afd-call starts a task
        c = await client.session.call_tool(
            "afd-call", {"command": "work-req", "input": {}}, allow_claimed=True
        )
        assert c.result_type == "task"
        c_done = await _poll_until_done(client, c.task_id)
        assert c_done.status == "completed"

        # afd-batch runs optional inline
        b_ok = _body(await client.call_tool("afd-batch", {"commands": [{"command": "work-opt"}]}))
        assert b_ok["success"] is True

        # afd-batch refuses required before any step runs
        ran.clear()
        b_bad = _body(
            await client.call_tool(
                "afd-batch",
                {"commands": [{"command": "work-plain"}, {"command": "work-req"}]},
            )
        )
        assert b_bad["success"] is False
        assert b_bad["error"]["code"] == "INVALID_BATCH_REQUEST"
        assert ran == []

        # afd-pipe refuses required before any step runs
        p_bad = _body(
            await client.call_tool(
                "afd-pipe",
                {"steps": [{"command": "work-plain"}, {"command": "work-req"}]},
            )
        )
        assert p_bad["steps"][0]["error"]["code"] == "INVALID_PIPELINE_REQUEST"
        assert ran == []


async def test_cancellation_failed_command_result_size_cap_and_max_running():
    started = asyncio.Event()
    cancelled_seen = asyncio.Event()

    server = create_server(
        "cancel-test",
        tool_strategy="individual",
        task_options=TaskOptions(
            poll_interval_ms=10,
            check_interval_ms=10,
            max_running=1,
            max_result_bytes=600,
        ),
    )

    @server.command(name="job-slow", description="Waits for cancel", expose=MCP, task="required")
    async def job_slow(input: Any, context: CommandContext) -> CommandResult[Any]:
        started.set()
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled_seen.set()
            raise
        return success({})

    @server.command(
        name="job-fail", description="Returns failed CommandResult", expose=MCP, task="required"
    )
    async def job_fail(input: Any) -> CommandResult[Any]:
        return error("NOT_FOUND", "Missing item", suggestion="Check the ID")

    @server.command(
        name="job-huge", description="Returns oversized payload", expose=MCP, task="required"
    )
    async def job_huge(input: Any) -> CommandResult[Any]:
        return success({"blob": "x" * 1000})

    sdk = server._create_mcp_server()
    async with Client(sdk, extensions=[_tasks_extension()]) as client:
        # Start slow task -> fills max_running=1
        slow = await client.session.call_tool("job-slow", {}, allow_claimed=True)
        assert slow.result_type == "task"
        await asyncio.wait_for(started.wait(), timeout=2.0)

        # Second concurrent task fails with RATE_LIMITED (retryable)
        limited = await client.session.call_tool("job-fail", {}, allow_claimed=True)
        assert limited.is_error is True
        limited_body = _body(limited)
        assert limited_body["error"]["code"] == "RATE_LIMITED"
        assert limited_body["error"]["retryable"] is True
        # A task limit gives no wait: retry with no minimum (spec/recovery.md, "Engine errors").
        assert limited_body["error"]["recovery"] == {"kind": "retry"}

        # Cancel slow task
        await client.session.send_request(
            _CancelTaskRequest(params=_TaskIdParams(taskId=slow.task_id)),
            Result,
        )
        settled = await _poll_until_done(client, slow.task_id)
        assert settled.status == "cancelled"
        await asyncio.wait_for(cancelled_seen.wait(), timeout=2.0)

        # Failed CommandResult -> status 'completed' with isError=True
        fail_seed = await client.session.call_tool("job-fail", {}, allow_claimed=True)
        fail_done = await _poll_until_done(client, fail_seed.task_id)
        assert fail_done.status == "completed"
        assert fail_done.result["isError"] is True
        assert json.loads(fail_done.result["content"][0]["text"])["error"]["code"] == "NOT_FOUND"

        # Oversized result -> completed with INTERNAL_ERROR + limitBytes/actualBytes
        huge_seed = await client.session.call_tool("job-huge", {}, allow_claimed=True)
        huge_done = await _poll_until_done(client, huge_seed.task_id)
        assert huge_done.status == "completed"
        assert huge_done.result["isError"] is True
        huge_err = json.loads(huge_done.result["content"][0]["text"])["error"]
        assert huge_err["code"] == "INTERNAL_ERROR"
        assert huge_err["details"]["limitBytes"] == 600
        assert huge_err["details"]["actualBytes"] > 600


# ═══════════════════════════════════════════════════════════════════════════════
# HTTP CALLER IDENTIFICATION, OWNER CHECKS, TOKEN EXPIRY & TTL
# ═══════════════════════════════════════════════════════════════════════════════


async def test_http_without_caller_identification_behaves_as_no_tasks():
    server = create_server(
        "http-unid",
        tool_strategy="individual",
        task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10),
    )

    @server.command(name="job-opt", description="Opt", expose=MCP, task="optional")
    async def job_opt(input: Any) -> CommandResult[Any]:
        return success({"inline": True})

    @server.command(name="job-req", description="Req", expose=MCP, task="required")
    async def job_req(input: Any) -> CommandResult[Any]:
        return success({"never": True})

    async with _http_client(server) as http:
        # server/discover does NOT advertise io.modelcontextprotocol/tasks
        disc = await _http_rpc(http, "server/discover")
        exts = disc["result"]["capabilities"].get("extensions") or {}
        assert TASKS_EXTENSION_ID not in exts

        # optional runs inline
        opt = await _http_rpc(http, "tools/call", {"name": "job-opt", "arguments": {}})
        assert opt["result"]["resultType"] == "complete"
        assert json.loads(opt["result"]["content"][0]["text"])["data"] == {"inline": True}

        # required fails with UNAUTHORIZED (retryable=False), even without extension
        for cap in (True, False):
            req = await _http_rpc(
                http, "tools/call", {"name": "job-req", "arguments": {}}, tasks_cap=cap
            )
            assert req["result"]["isError"] is True
            err = json.loads(req["result"]["content"][0]["text"])["error"]
            assert err["code"] == "UNAUTHORIZED"
            assert err["retryable"] is False

        # tasks/* answers -32601 (METHOD_NOT_FOUND)
        for method in ("tasks/get", "tasks/update", "tasks/cancel"):
            rpc = await _http_rpc(http, method, {"taskId": "a" * 26})
            assert rpc["error"]["code"] == -32601


async def test_http_with_hook_identification_enforces_owner_and_ttl():
    clock = fixed_clock(1_700_000_000_000)

    class CallerMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            request.state.user_id = request.headers.get("x-verified-user")
            return await call_next(request)

    def hook(req: ContextHookRequest, ctx: CommandContext):
        user_id = getattr(req.http_request.state, "user_id", None)
        if not user_id:
            return CommandError(code="UNAUTHORIZED", message="Sign in required", retryable=False)
        ctx.actor = Actor(kind="human", id=user_id)
        return ctx

    server = create_server(
        "http-hook",
        tool_strategy="individual",
        clock=clock,
        context_hook=hook,
        task_options=TaskOptions(
            ttl_ms=5_000,
            poll_interval_ms=10,
            check_interval_ms=10,
            callers_identified_by_hook=True,
        ),
    )

    @server.command(name="job-echo", description="Echo", expose=MCP, task="required")
    async def job_echo(input: Any, context: CommandContext) -> CommandResult[Any]:
        return success({"who": context.actor.id if context.actor else None})

    alice = {"x-verified-user": "alice"}
    bob = {"x-verified-user": "bob"}

    async with _http_client(server, asgi_middleware=CallerMiddleware) as http:
        disc = await _http_rpc(http, "server/discover", headers=alice)
        assert TASKS_EXTENSION_ID in disc["result"]["capabilities"]["extensions"]

        created = await _http_rpc(
            http, "tools/call", {"name": "job-echo", "arguments": {}}, headers=alice
        )
        assert created["result"]["resultType"] == "task"
        task_id = created["result"]["taskId"]

        # Wait for completion
        for _ in range(100):
            got = await _http_rpc(http, "tasks/get", {"taskId": task_id}, headers=alice)
            if got["result"]["status"] == "completed":
                break
            await asyncio.sleep(0.01)
        assert got["result"]["status"] == "completed"
        assert json.loads(got["result"]["result"]["content"][0]["text"])["data"] == {"who": "alice"}

        # Bob cannot read, update, or cancel Alice's task -> -32602 identical to unknown
        unknown_err = (await _http_rpc(http, "tasks/get", {"taskId": "a" * 26}, headers=bob))[
            "error"
        ]
        assert unknown_err["code"] == -32602
        for method in ("tasks/get", "tasks/update", "tasks/cancel"):
            bob_rpc = await _http_rpc(http, method, {"taskId": task_id}, headers=bob)
            assert bob_rpc["error"] == unknown_err

        # Advance clock past TTL -> gone (-32602 even for Alice)
        clock.advance(5_000)
        expired_rpc = await _http_rpc(http, "tasks/get", {"taskId": task_id}, headers=alice)
        assert expired_rpc["error"] == unknown_err


async def test_token_expiry_and_incomplete_credentials():
    from mcp.server.auth.middleware.auth_context import auth_context_var
    from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
    from mcp.server.auth.provider import AccessToken

    clock = fixed_clock(1_700_000_000_000)
    gate = asyncio.Event()
    started = asyncio.Event()

    server = create_server(
        "token-test",
        tool_strategy="individual",
        clock=clock,
        task_options=TaskOptions(
            poll_interval_ms=10, check_interval_ms=10, token_expiry_grace_ms=5_000
        ),
    )

    @server.command(
        name="job-mut", description="Mutation", mutation=True, expose=MCP, task="required"
    )
    async def job_mut(input: Any) -> CommandResult[Any]:
        started.set()
        await gate.wait()
        return success({"done": True})

    @server.command(
        name="job-read", description="Read", mutation=False, expose=MCP, task="required"
    )
    async def job_read(input: Any) -> CommandResult[Any]:
        return success({"read": True})

    sdk = server._create_mcp_server()

    # 1. Incomplete token (no iss) -> -32603 naming no one, nothing runs
    bad_token = AccessToken(token="t", client_id="c1", scopes=[], subject="u1", claims={})
    reset = auth_context_var.set(AuthenticatedUser(bad_token))
    try:
        async with Client(sdk, extensions=[_tasks_extension()]) as client:
            with pytest.raises(MCPError) as exc:
                await client.session.call_tool("job-read", {}, allow_claimed=True)
            assert exc.value.code == -32603
            assert "u1" not in exc.value.message
            assert "c1" not in exc.value.message
    finally:
        auth_context_var.reset(reset)

    # 2. Token expires while mutation is running -> TASK_TOKEN_EXPIRED with retryable=False
    good_token = AccessToken(
        token="t",
        client_id="c1",
        scopes=[],
        subject="u1",
        expires_at=1_700_000_002,  # +2s
        claims={"iss": "https://auth.example.com"},
    )
    reset = auth_context_var.set(AuthenticatedUser(good_token))
    try:
        async with Client(sdk, extensions=[_tasks_extension()]) as client:
            seed = await client.session.call_tool("job-mut", {}, allow_claimed=True)
            assert seed.result_type == "task"
            # ttlMs capped at remaining (2s) + grace (5s) = 7s
            assert seed.ttl_ms == 7_000
            await asyncio.wait_for(started.wait(), timeout=2.0)

            clock.advance(2_000)
            settled = await _poll_until_done(client, seed.task_id)
            assert settled.status == "completed"
            assert settled.result["isError"] is True
            err = json.loads(settled.result["content"][0]["text"])["error"]
            assert err["code"] == "TASK_TOKEN_EXPIRED"
            assert err["retryable"] is False

            # Token already expired before start -> nothing runs, retryable=True even for mutation
            started.clear()
            seed2 = await client.session.call_tool("job-mut", {}, allow_claimed=True)
            settled2 = await _poll_until_done(client, seed2.task_id)
            assert settled2.status == "completed"
            err2 = json.loads(settled2.result["content"][0]["text"])["error"]
            assert err2["code"] == "TASK_TOKEN_EXPIRED"
            assert err2["retryable"] is True
            assert not started.is_set()
    finally:
        auth_context_var.reset(reset)


async def test_custom_store_cross_process_cancel_and_heartbeat():
    heartbeats: list[str] = []
    started = asyncio.Event()
    inner = InMemoryTaskStore()

    class SharedStore:
        async def create(self, record: TaskRecord, call: TaskCall) -> None:
            await inner.create(record, call)

        async def get(self, task_id: str, owner: str) -> TaskRecord | None:
            return await inner.get(task_id, owner)

        async def update(self, task_id: str, owner: str, change: Any) -> None:
            await inner.update(task_id, owner, change)

        async def expire(self, now: int) -> int:
            return await inner.expire(now)

        async def heartbeat(self, task_id: str, owner: str, now: int) -> None:
            heartbeats.append(task_id)

    store = SharedStore()
    server = create_server(
        "shared-store",
        tool_strategy="individual",
        task_store=store,
        task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10),
    )

    @server.command(name="job-wait", description="Waits", expose=MCP, task="required")
    async def job_wait(input: Any) -> CommandResult[Any]:
        started.set()
        await asyncio.sleep(10)
        return success({})

    sdk = server._create_mcp_server()
    async with Client(sdk, extensions=[_tasks_extension()]) as client:
        seed = await client.session.call_tool("job-wait", {}, allow_claimed=True)
        await asyncio.wait_for(started.wait(), timeout=2.0)

        # Simulate another process setting cancel_requested directly in the shared store
        owner = principal_binding(Actor(kind="agent"), None)
        await store.update(seed.task_id, owner, TaskCancelRequestedChange())

        settled = await _poll_until_done(client, seed.task_id)
        assert settled.status == "cancelled"
        assert seed.task_id in heartbeats


async def test_removed_command_in_shared_store_answers_unknown_task():
    store = InMemoryTaskStore()
    server_a = create_server(
        "deploy-a",
        tool_strategy="individual",
        task_store=store,
        task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10),
    )

    @server_a.command(
        name="job-old", description="Removed in next deploy", expose=MCP, task="required"
    )
    async def job_old(input: Any) -> CommandResult[Any]:
        return success({"legacy": True})

    sdk_a = server_a._create_mcp_server()
    async with Client(sdk_a, extensions=[_tasks_extension()]) as client_a:
        seed = await client_a.session.call_tool("job-old", {}, allow_claimed=True)
        done = await _poll_until_done(client_a, seed.task_id)
        assert done.status == "completed"

    # Next deployment removes job-old while keeping another task-capable command active.
    server_b = create_server(
        "deploy-b",
        tool_strategy="individual",
        task_store=store,
        task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10),
    )

    @server_b.command(name="job-new", description="Current job", expose=MCP, task="required")
    async def job_new(input: Any) -> CommandResult[Any]:
        return success({"current": True})

    sdk_b = server_b._create_mcp_server()
    async with Client(sdk_b, extensions=[_tasks_extension()]) as client_b:
        for req in (
            _GetTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
            _UpdateTaskRequest(params=_UpdateTaskParams(taskId=seed.task_id)),
            _CancelTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
        ):
            with pytest.raises(MCPError) as exc_info:
                await client_b.session.send_request(req, Result)
            assert exc_info.value.code == -32602


async def test_a_store_sees_each_tasks_caller_and_may_refuse_one_as_unknown():
    # #3011: tasks/get, tasks/update and tasks/cancel reach the store's get_for with the context
    # of the caller's request.
    callers: list[CommandContext] = []
    refuse = False
    bob = Actor(kind="human", id="bob")

    class ChecksCallers(InMemoryTaskStore):
        async def get_for(self, task_id: str, owner: str, caller: CommandContext):
            callers.append(caller)
            return None if refuse else await self.get(task_id, owner)

    server = create_server(
        "checks-callers",
        tool_strategy="individual",
        task_store=ChecksCallers(),
        task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10),
        actor=bob,
    )

    @server.command(name="job-echo", description="Echo", expose=MCP, task="required")
    async def job_echo(input: Any) -> CommandResult[Any]:
        return success({"ok": True})

    sdk = server._create_mcp_server()
    async with Client(sdk, extensions=[_tasks_extension()]) as client:
        seed = await client.session.call_tool("job-echo", {}, allow_claimed=True)
        done = await _poll_until_done(client, seed.task_id)
        assert done.status == "completed"
        assert callers
        for caller in callers:
            # The actor the binding was made from, as a copy of the server's own; and on stdio
            # no credentials, since nothing verified any.
            assert caller.actor == bob and caller.actor is not bob
            assert caller.credentials is None
        refuse = True
        for req in (
            _GetTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
            _UpdateTaskRequest(params=_UpdateTaskParams(taskId=seed.task_id)),
            _CancelTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
        ):
            with pytest.raises(MCPError) as exc_info:
                await client.session.send_request(req, Result)
            assert exc_info.value.code == -32602


async def test_http_mcp_name_mismatch_and_discover_cache_hint_and_hook_guards():
    class CallerMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            request.state.user_id = request.headers.get("x-verified-user")
            return await call_next(request)

    def hook(req: ContextHookRequest, ctx: CommandContext):
        user_id = getattr(req.http_request.state, "user_id", None)
        if user_id == "refused":
            return CommandError(
                code="FORBIDDEN",
                message="Caller denied",
                suggestion="Use an authorized caller",
                retryable=False,
            )
        if user_id == "boom":
            return CommandError(
                code="INTERNAL_ERROR",
                message="Secret internal failure",
                retryable=True,
            )
        ctx.actor = Actor(kind="human", id=user_id or "alice")
        return ctx

    server = create_server(
        "http-headers",
        tool_strategy="individual",
        context_hook=hook,
        task_options=TaskOptions(
            poll_interval_ms=10,
            check_interval_ms=10,
            callers_identified_by_hook=True,
        ),
    )

    @server.command(name="job-echo", description="Echo", expose=MCP, task="required")
    async def job_echo(input: Any) -> CommandResult[Any]:
        return success({"ok": True})

    async with _http_client(server, asgi_middleware=CallerMiddleware) as http:
        created = await _http_rpc(
            http,
            "tools/call",
            {"name": "job-echo", "arguments": {}},
            headers={"x-verified-user": "alice"},
        )
        task_id = created["result"]["taskId"]

        # Mismatched or missing Mcp-Name on tasks/* -> HTTP 400 + -32020
        for method in ("tasks/get", "tasks/update", "tasks/cancel"):
            meta = {
                "io.modelcontextprotocol/protocolVersion": MODERN,
                "io.modelcontextprotocol/clientCapabilities": {
                    "extensions": {TASKS_EXTENSION_ID: {}}
                },
                "io.modelcontextprotocol/clientInfo": {"name": "t", "version": "0"},
            }
            for bad_headers in (
                [("Mcp-Name", "wrong-id")],
                [],  # missing Mcp-Name
                [("Mcp-Name", task_id), ("Mcp-Name", task_id)],  # duplicate Mcp-Name
            ):
                resp = await http.post(
                    "/mcp",
                    headers=[
                        ("Accept", "application/json, text/event-stream"),
                        ("Content-Type", "application/json"),
                        ("MCP-Protocol-Version", MODERN),
                        ("Mcp-Method", method),
                        ("x-verified-user", "alice"),
                        *bad_headers,
                    ],
                    json={
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": method,
                        "params": {"taskId": task_id, "_meta": meta},
                    },
                )
                assert resp.status_code == 400
                assert resp.json()["error"]["code"] == -32020

        # context_hook refusal on tasks/get: non-internal -> -32600, internal -> sanitized -32603
        refused = await _http_rpc(
            http,
            "tasks/get",
            {"taskId": task_id},
            headers={"x-verified-user": "refused"},
            expected_status=400,
        )
        assert refused["error"]["code"] == -32600
        assert refused["error"]["data"]["code"] == "FORBIDDEN"

        boom = await _http_rpc(
            http,
            "tasks/get",
            {"taskId": task_id},
            headers={"x-verified-user": "boom"},
        )
        assert boom["error"]["code"] == -32603
        assert "Secret" not in boom["error"]["message"]

    # callers_identified_by_hook=True with NO context_hook still treats HTTP as unidentified,
    # and server/discover uses private cache scope because task advertisement varies by credentials.
    no_hook_server = create_server(
        "http-no-hook",
        tool_strategy="individual",
        task_options=TaskOptions(callers_identified_by_hook=True),
    )

    @no_hook_server.command(name="job-req", description="Req", expose=MCP, task="required")
    async def job_req(input: Any) -> CommandResult[Any]:
        return success({})

    async with _http_client(no_hook_server) as http:
        disc = await _http_rpc(http, "server/discover")
        assert disc["result"].get("cacheScope") == "private"
        assert TASKS_EXTENSION_ID not in (disc["result"]["capabilities"].get("extensions") or {})

        req = await _http_rpc(http, "tools/call", {"name": "job-req", "arguments": {}})
        assert req["result"]["isError"] is True
        assert json.loads(req["result"]["content"][0]["text"])["error"]["code"] == "UNAUTHORIZED"


async def test_unserializable_result_and_store_create_cancel_and_repr_redaction_and_lifespan():
    # 1. Unserializable / cyclic result transitions task to failed (-32603) instead of sticking in working
    server = create_server(
        "cyclic-task",
        tool_strategy="individual",
        task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10),
    )

    @server.command(name="job-cyclic", description="Cyclic payload", expose=MCP, task="required")
    async def job_cyclic(input: Any) -> CommandResult[Any]:
        loop_obj: dict[str, Any] = {}
        loop_obj["self"] = loop_obj
        return success(loop_obj)

    sdk = server._create_mcp_server()
    async with Client(sdk, extensions=[_tasks_extension()]) as client:
        seed = await client.session.call_tool("job-cyclic", {}, allow_claimed=True)
        settled = await _poll_until_done(client, seed.task_id)
        assert settled.status == "failed"
        assert settled.error is not None
        assert settled.error["code"] == -32603
        # Claude Code reads a failed task's error.message (#2501).
        assert settled.error["message"] == "Internal error"

    # 2. Cancelling mid-store.create() releases max_running slot
    entered_create = asyncio.Event()
    block_create = asyncio.Event()
    cancel_first = True
    inner = InMemoryTaskStore()

    class BlockingCreateStore:
        async def create(self, record: TaskRecord, call: TaskCall) -> None:
            nonlocal cancel_first
            if cancel_first:
                cancel_first = False
                entered_create.set()
                await block_create.wait()
            await inner.create(record, call)

        async def get(self, task_id: str, owner: str) -> TaskRecord | None:
            return await inner.get(task_id, owner)

        async def update(self, task_id: str, owner: str, change: Any) -> None:
            await inner.update(task_id, owner, change)

        async def expire(self, now: int) -> int:
            return await inner.expire(now)

    slot_server = create_server(
        "slot-cancel",
        tool_strategy="individual",
        task_store=BlockingCreateStore(),
        task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10, max_running=1),
    )

    @slot_server.command(name="job-ok", description="Ok", expose=MCP, task="required")
    async def job_ok(input: Any) -> CommandResult[Any]:
        return success({"ok": True})

    slot_sdk = slot_server._create_mcp_server()
    async with Client(slot_sdk, extensions=[_tasks_extension()]) as client:
        first = asyncio.create_task(client.session.call_tool("job-ok", {}, allow_claimed=True))
        await asyncio.wait_for(entered_create.wait(), timeout=2.0)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        # Slot was released despite CancelledError; next call succeeds (not RATE_LIMITED)
        second = await client.session.call_tool("job-ok", {}, allow_claimed=True)
        assert second.result_type == "task"
        settled2 = await _poll_until_done(client, second.task_id)
        assert settled2.status == "completed"

    # 3. TaskRecord & TaskCall repr redact sensitive fields
    rec = TaskRecord(
        id="a" * 26,
        owner='{"actor":{"id":"secret-owner"}}',
        command="job-ok",
        status="completed",
        created_at=100,
        last_updated_at=200,
        ttl_ms=1000,
        poll_interval_ms=10,
        result={"secret": "value"},
        error=TaskRpcError(code=-32603, message="secret-err"),
    )
    rec_repr = repr(rec)
    assert "a" * 26 not in rec_repr
    assert "secret-owner" not in rec_repr
    assert "secret" not in rec_repr
    call_obj = TaskCall(
        command=CommandDefinition(name="job-ok", description="d", handler=job_ok),
        input={"token": "top-secret"},
        context=CommandContext(actor=Actor(kind="human", id="alice")),
    )
    call_repr = repr(call_obj)
    assert "top-secret" not in call_repr
    assert "alice" not in call_repr

    # 4. ASGI lifespan shutdown disposes running task drivers cleanly
    started_bg = asyncio.Event()
    stopped_bg = asyncio.Event()
    life_server = create_server(
        "life-tasks",
        tool_strategy="individual",
        context_hook=lambda _r, ctx: ctx,
        task_options=TaskOptions(
            poll_interval_ms=10,
            check_interval_ms=10,
            callers_identified_by_hook=True,
        ),
    )

    @life_server.command(name="job-forever", description="Sleeps", expose=MCP, task="required")
    async def job_forever(input: Any, context: CommandContext) -> CommandResult[Any]:
        started_bg.set()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            stopped_bg.set()
            raise
        return success({})

    async with _http_client(life_server) as http:
        created = await _http_rpc(http, "tools/call", {"name": "job-forever", "arguments": {}})
        assert created["result"]["resultType"] == "task"
        await asyncio.wait_for(started_bg.wait(), timeout=2.0)
    # Exiting _http_client exits the Starlette lifespan, which calls server.stop_tasks()
    await asyncio.wait_for(stopped_bg.wait(), timeout=2.0)


async def test_token_expiry_at_finished_stage_on_mutation():
    clock = fixed_clock(1_700_000_000_000)
    from mcp.server.auth.middleware.auth_context import auth_context_var
    from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
    from mcp.server.auth.provider import AccessToken

    token_expires_sec = 1_700_000_005

    class TokenMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            tok = AccessToken(
                token="t",
                client_id="client-1",
                scopes=[],
                subject="user-1",
                expires_at=token_expires_sec,
                claims={"iss": "https://issuer.example"},
            )
            reset = auth_context_var.set(AuthenticatedUser(tok))
            try:
                return await call_next(request)
            finally:
                auth_context_var.reset(reset)

    server = create_server(
        "http-token-fin",
        tool_strategy="individual",
        clock=clock,
        task_options=TaskOptions(
            ttl_ms=60_000,
            poll_interval_ms=10,
            check_interval_ms=10,
            token_expiry_grace_ms=30_000,
        ),
    )

    @server.command(
        name="job-mut-finish",
        description="Advances clock past expiry before returning",
        expose=MCP,
        mutation=True,
        task="required",
    )
    async def job_mut_finish(input: Any) -> CommandResult[Any]:
        # Handler completes right as the token expires -> stage == "finished"
        clock.advance(6_000)
        return success({"wrote": True})

    async with _http_client(server, asgi_middleware=TokenMiddleware) as http:
        created = await _http_rpc(http, "tools/call", {"name": "job-mut-finish", "arguments": {}})
        task_id = created["result"]["taskId"]
        for _ in range(100):
            got = await _http_rpc(http, "tasks/get", {"taskId": task_id})
            if got["result"]["status"] != "working":
                break
            await asyncio.sleep(0.01)
        assert got["result"]["status"] == "completed"
        assert got["result"]["result"]["isError"] is True
        err = json.loads(got["result"]["result"]["content"][0]["text"])["error"]
        assert err["code"] == "TASK_TOKEN_EXPIRED"
        assert err["retryable"] is False
        assert "made its change" in err["suggestion"]


async def test_post_completion_retention_and_run_timeout():
    from afd.server.tasks import DEFAULT_TASK_MAX_RUN_MS, DEFAULT_TASK_TTL_MS

    # 1. Task finishes at 55 minutes: stays readable past 1h run budget until finished_at + 1h
    clock = fixed_clock(1_700_000_000_000)
    started = asyncio.Event()
    release = asyncio.Event()

    server = create_server(
        "retention-test",
        tool_strategy="individual",
        clock=clock,
        task_options=TaskOptions(poll_interval_ms=10, check_interval_ms=10),
    )

    @server.command(name="job-slow", description="Waits for release", expose=MCP, task="required")
    async def job_slow(input: Any) -> CommandResult[Any]:
        started.set()
        await release.wait()
        return success({"done": True})

    sdk = server._create_mcp_server()
    async with Client(sdk, extensions=[_tasks_extension()]) as client:
        seed = await client.session.call_tool("job-slow", {}, allow_claimed=True)
        assert seed.ttl_ms == DEFAULT_TASK_MAX_RUN_MS + DEFAULT_TASK_TTL_MS
        await asyncio.wait_for(started.wait(), timeout=2.0)

        clock.advance(55 * 60_000)
        release.set()
        done = await _poll_until_done(client, seed.task_id)
        assert done.status == "completed"
        assert done.ttl_ms == 55 * 60_000 + DEFAULT_TASK_TTL_MS

        # Past 1h from creation (5m after finish) and 1ms before finished_at + 1h -> readable
        clock.advance(10 * 60_000)
        mid = await client.session.send_request(
            _GetTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
            _DetailedTaskResult,
        )
        assert mid.status == "completed"

        clock.advance(50 * 60_000 - 1)
        last_ms = await client.session.send_request(
            _GetTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
            _DetailedTaskResult,
        )
        assert last_ms.status == "completed"

        # Exactly at finished_at + 1h -> gone (-32602)
        clock.advance(1)
        with pytest.raises(MCPError) as gone:
            await client.session.send_request(
                _GetTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
                _DetailedTaskResult,
            )
        assert gone.value.code == -32602

    # 2. Working task exceeding max_run_ms stops with TIMEOUT (read retryable, mutation non-retryable)
    # and keeps that TIMEOUT result for ttl_ms after it stops.
    async def _check_timeout(mutation: bool, expected_retryable: bool) -> None:
        t_clock = fixed_clock(1_700_000_000_000)
        t_started = asyncio.Event()
        t_gate = asyncio.Event()
        t_server = create_server(
            f"timeout-{mutation}",
            tool_strategy="individual",
            clock=t_clock,
            task_options=TaskOptions(
                max_run_ms=10_000,
                ttl_ms=30_000,
                poll_interval_ms=10,
                check_interval_ms=10,
            ),
        )

        @t_server.command(
            name="job-hang",
            description="Hangs",
            expose=MCP,
            mutation=mutation,
            task="required",
        )
        async def job_hang(input: Any) -> CommandResult[Any]:
            t_started.set()
            await t_gate.wait()
            return success({})

        t_sdk = t_server._create_mcp_server()
        async with Client(t_sdk, extensions=[_tasks_extension()]) as client:
            seed = await client.session.call_tool("job-hang", {}, allow_claimed=True)
            assert seed.ttl_ms == 40_000
            await asyncio.wait_for(t_started.wait(), timeout=2.0)

            t_clock.advance(10_000)
            settled = await _poll_until_done(client, seed.task_id)
            assert settled.status == "completed"
            assert settled.result["isError"] is True
            err = json.loads(settled.result["content"][0]["text"])["error"]
            assert err["code"] == "TIMEOUT"
            assert err["retryable"] is expected_retryable

            # Retained for ttl_ms (30s) after timeout, then gone
            t_clock.advance(29_999)
            kept = await client.session.send_request(
                _GetTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
                _DetailedTaskResult,
            )
            assert kept.status == "completed"

            t_clock.advance(1)
            with pytest.raises(MCPError) as gone:
                await client.session.send_request(
                    _GetTaskRequest(params=_TaskIdParams(taskId=seed.task_id)),
                    _DetailedTaskResult,
                )
            assert gone.value.code == -32602

    for mutation, expected_retryable in [(False, True), (True, False)]:
        await _check_timeout(mutation, expected_retryable)

    # 3. Handler returning slightly past max_run_ms (before ttl_ms) keeps its result and caps ttl_ms
    late_clock = fixed_clock(1_700_000_000_000)
    late_started = asyncio.Event()
    late_release = asyncio.Event()
    late_server = create_server(
        "late-return",
        tool_strategy="individual",
        clock=late_clock,
        task_options=TaskOptions(
            max_run_ms=10_000,
            ttl_ms=30_000,
            poll_interval_ms=10,
            check_interval_ms=5_000,
        ),
    )

    @late_server.command(
        name="job-late", description="Returns after max_run_ms", expose=MCP, task="required"
    )
    async def job_late(input: Any) -> CommandResult[Any]:
        late_started.set()
        await late_release.wait()
        return success({"kept": True})

    late_sdk = late_server._create_mcp_server()
    async with Client(late_sdk, extensions=[_tasks_extension()]) as client:
        seed = await client.session.call_tool("job-late", {}, allow_claimed=True)
        await asyncio.wait_for(late_started.wait(), timeout=2.0)
        late_clock.advance(12_000)
        late_release.set()
        done = await _poll_until_done(client, seed.task_id)
        assert done.status == "completed"
        assert done.result["isError"] is False
        assert json.loads(done.result["content"][0]["text"])["data"] == {"kept": True}
        assert done.ttl_ms == 40_000
