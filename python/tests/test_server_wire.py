"""End-to-end wire format of the Python MCP server.

These tests run a real MCP client session against the FastMCP server in memory
and check the JSON that reaches the client: camelCase keys, unset fields
omitted rather than null, ``isError`` on failures, and AFD validation errors
(not raw FastMCP errors) for missing or mistyped arguments.
"""

import json
from typing import Any, Dict

import pytest
from mcp.shared.memory import create_connected_server_and_client_session
from pydantic import BaseModel, ConfigDict, Field

from afd import ExposeOptions, ResultMetadata, Source, error, success
from afd.server import create_server

MCP = ExposeOptions(mcp=True)


class CreateInput(BaseModel):
    title: str = Field(..., min_length=1)
    priority: str = "medium"


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str


def _server():
    server = create_server("wire-test")

    @server.command(name="todo-create", description="Create", input_schema=CreateInput, expose=MCP)
    async def todo_create(input: CreateInput):
        return success(
            {"id": "todo-1", "title": input.title, "description": None},
            reasoning="Created",
            sources=[Source(type="document", accessed_at="2026-01-01T00:00:00Z")],
            metadata=ResultMetadata(execution_time_ms=1.5, command_version="1.0.0"),
            undo_command="todo-delete",
            undo_args={"id": "todo-1"},
        )

    @server.command(name="todo-get", description="Get", expose=MCP)
    async def todo_get(input):
        return error("NOT_FOUND", "Todo not found", suggestion="Use todo-list", details={"id": "x"})

    @server.command(name="todo-crash", description="Crash", expose=MCP)
    async def todo_crash(input):
        raise RuntimeError("db password=hunter2")

    @server.command(name="user-set", description="Strict", input_schema=StrictInput, expose=MCP)
    async def user_set(input: StrictInput):
        return success({"name": input.name})

    return server


async def _call(server, name: str, arguments: Dict[str, Any]):
    """Call a tool over a real MCP session; return (isError, parsed JSON body)."""
    mcp = server._create_mcp_server()
    async with create_connected_server_and_client_session(mcp._mcp_server) as session:
        result = await session.call_tool(name, arguments)
    assert len(result.content) == 1
    return result.isError, json.loads(result.content[0].text)


def _keys(value: Any, skip: tuple = ("data", "details", "undoArgs", "input")) -> set:
    """All object keys of the envelope (free-form payloads skipped)."""
    keys: set = set()
    if isinstance(value, dict):
        for key, item in value.items():
            keys.add(key)
            if key not in skip:
                keys |= _keys(item, skip)
    elif isinstance(value, list):
        for item in value:
            keys |= _keys(item, skip)
    return keys


def _nulls(value: Any, skip: tuple = ("data", "details", "undoArgs")) -> list:
    """Paths of null values in the envelope (free-form payloads skipped)."""
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            if item is None:
                found.append(key)
            elif key not in skip:
                found += _nulls(item, skip)
    elif isinstance(value, list):
        for item in value:
            found += _nulls(item, skip)
    return found


class TestResultWireFormat:
    @pytest.mark.asyncio
    async def test_success_is_camel_case_without_nulls(self):
        is_error, body = await _call(_server(), "todo-create", {"title": "Buy milk"})

        assert is_error is False
        # The server sets executionTimeMs and traceId (run-dependent), as in TypeScript.
        metadata = body.pop("metadata")
        assert metadata.pop("executionTimeMs") >= 0
        assert metadata.pop("traceId").startswith("trace-")
        assert metadata == {"commandVersion": "1.0.0"}
        assert body == {
            "success": True,
            "data": {"id": "todo-1", "title": "Buy milk", "description": None},
            "reasoning": "Created",
            "sources": [{"type": "document", "accessedAt": "2026-01-01T00:00:00Z"}],
            "undoCommand": "todo-delete",
            "undoArgs": {"id": "todo-1"},
        }

    @pytest.mark.asyncio
    async def test_failure_sets_is_error(self):
        is_error, body = await _call(_server(), "todo-get", {"id": "x"})

        assert is_error is True
        assert set(body.pop("metadata")) == {"executionTimeMs", "traceId"}
        assert body == {
            "success": False,
            "error": {
                "code": "NOT_FOUND",
                "message": "Todo not found",
                "suggestion": "Use todo-list",
                "details": {"id": "x"},
            },
        }

    @pytest.mark.asyncio
    async def test_handler_exception_is_a_structured_failure(self):
        is_error, body = await _call(_server(), "todo-crash", {})

        assert is_error is True
        assert body["error"]["code"] == "COMMAND_EXECUTION_ERROR"
        assert body["error"]["suggestion"]
        assert "hunter2" not in json.dumps(body)

    @pytest.mark.asyncio
    async def test_afd_call_failure_sets_is_error(self):
        is_error, body = await _call(
            _server(), "afd-call", {"command": "todo-get", "input": {"id": "x"}}
        )

        assert is_error is True
        assert body["error"]["code"] == "NOT_FOUND"

    @pytest.mark.asyncio
    async def test_batch_is_camel_case(self):
        is_error, body = await _call(
            _server(),
            "afd-batch",
            {
                "commands": [
                    {"id": "a", "command": "todo-create", "input": {"title": "One"}},
                    {"id": "b", "command": "todo-get", "input": {"id": "x"}},
                ],
                "options": {"stopOnError": False},
            },
        )

        assert is_error is False  # partial success, as in TypeScript
        assert body["summary"] == {
            "total": 2,
            "successCount": 1,
            "failureCount": 1,
            "skippedCount": 0,
        }
        assert set(body["timing"]) == {"totalMs", "averageMs", "startedAt", "completedAt"}
        assert body["results"][0]["durationMs"] >= 0
        assert body["results"][1]["result"]["error"]["suggestion"] == "Use todo-list"
        assert not {k for k in _keys(body) if "_" in k}
        assert _nulls(body) == []

    @pytest.mark.asyncio
    async def test_invalid_batch_options_are_a_structured_failure(self):
        is_error, body = await _call(
            _server(),
            "afd-batch",
            {"commands": [{"command": "todo-get", "input": {}}], "options": {"bogus": True}},
        )

        assert is_error is True
        assert body["success"] is False
        assert body["error"]["code"] == "INVALID_BATCH_REQUEST"
        assert body["error"]["suggestion"]
        assert body["error"]["details"]["errors"][0]["path"] == "options.bogus"

    @pytest.mark.asyncio
    async def test_pipeline_is_camel_case_and_failed_step_sets_is_error(self):
        is_error, body = await _call(
            _server(),
            "afd-pipe",
            {
                "steps": [
                    {"command": "todo-create", "input": {"title": "One"}, "as": "todo"},
                    {"command": "todo-get", "input": {"id": "$steps.todo.id"}},
                ]
            },
        )

        assert is_error is True
        assert body["metadata"]["completedSteps"] == 1
        assert body["metadata"]["totalSteps"] == 2
        assert body["metadata"]["confidenceBreakdown"][0]["alias"] == "todo"
        assert body["metadata"]["sources"][0]["stepIndex"] == 0
        assert body["metadata"]["reasoning"] == [
            {"stepIndex": 0, "command": "todo-create", "reasoning": "Created"}
        ]
        assert body["steps"][0]["executionTimeMs"] >= 0
        assert body["steps"][1]["error"]["code"] == "NOT_FOUND"
        assert not {k for k in _keys(body) if "_" in k}
        assert _nulls(body) == []


class TestValidationBeforeAfd:
    @pytest.mark.asyncio
    async def test_mistyped_argument_returns_validation_error(self):
        is_error, body = await _call(_server(), "todo-create", {"title": 123})

        assert is_error is True
        assert body["success"] is False
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["suggestion"]
        assert body["error"]["details"]["errors"][0]["path"] == "title"
        assert body["error"]["details"]["expectedFields"] == ["title", "priority"]
        assert "Error executing tool" not in json.dumps(body)

    @pytest.mark.asyncio
    async def test_missing_argument_returns_validation_error(self):
        is_error, body = await _call(_server(), "todo-create", {})

        assert is_error is True
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["details"]["missingFields"] == ["title"]
        assert "Missing required field(s): title" in body["error"]["suggestion"]

    @pytest.mark.asyncio
    async def test_constraint_violation_returns_validation_error(self):
        is_error, body = await _call(_server(), "todo-create", {"title": ""})

        assert is_error is True
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["details"]["errors"][0]["path"] == "title"

    @pytest.mark.asyncio
    async def test_unknown_argument_reaches_afd_validation(self):
        is_error, body = await _call(_server(), "user-set", {"name": "Ada", "role": "admin"})

        assert is_error is True
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["details"]["unexpectedFields"] == ["role"]

    @pytest.mark.asyncio
    async def test_string_argument_is_not_json_decoded(self):
        # FastMCP pre-parses JSON-looking strings for non-string fields; AFD
        # passes arguments through unchanged, so "123" stays a string.
        is_error, body = await _call(_server(), "todo-create", {"title": "123"})

        assert is_error is False
        assert body["data"]["title"] == "123"

    @pytest.mark.asyncio
    async def test_valid_arguments_still_work(self):
        is_error, body = await _call(_server(), "todo-create", {"title": "Ok", "priority": "high"})

        assert is_error is False
        assert body["data"]["title"] == "Ok"
