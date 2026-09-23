"""Server hardening: MCP discovery exposure, error sanitizing, untrusted names."""

import json
import logging

import pytest
from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.core.pipeline import PipelineRequest, PipelineStep, StepStatus, execute_pipeline
from afd.direct import DirectClient, SimpleRegistry
from afd.server import create_server

PRIVATE_NAME = "secret-rotate"
PRIVATE_DESCRIPTION = "Rotate the vault signing keys"
PRIVATE_FIELD = "vault_path"
LEAKY_MESSAGE = "db password=hunter2 at /srv/app/db.py"


class RotateInput(BaseModel):
    vault_path: str


class TodoInput(BaseModel):
    title: str
    count: int = 1


def _dump(value) -> str:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    return json.dumps(value, default=str)


def _server_with_private_command(tool_strategy: str = "individual", **kwargs):
    server = create_server("hardening", tool_strategy=tool_strategy, **kwargs)

    @server.command(
        name="todo-create",
        description="Create a todo item",
        input_schema=TodoInput,
        expose=ExposeOptions(mcp=True),
    )
    async def todo_create(input: TodoInput):
        return success({"title": input.title, "count": input.count})

    @server.command(
        name=PRIVATE_NAME,
        description=PRIVATE_DESCRIPTION,
        input_schema=RotateInput,
        expose=ExposeOptions(mcp=False, cli=True),
    )
    async def secret_rotate(input: RotateInput):
        return success({"rotated": True})

    return server


def _assert_private_hidden(payload, *, name_in_request: bool = False) -> None:
    dumped = _dump(payload)
    if not name_in_request:
        assert PRIVATE_NAME not in dumped
    assert PRIVATE_DESCRIPTION not in dumped
    assert PRIVATE_FIELD not in dumped


class TestDiscoveryOnlySeesMcpExposedCommands:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("tool", "args"),
        [
            ("afd-help", {}),
            ("afd-help", {"format": "full"}),
            ("afd-help", {"filter": "secret"}),
            ("afd-docs", {}),
            ("afd-docs", {"command": PRIVATE_NAME}),
            ("afd-schema", {}),
            ("afd-schema", {"format": "typescript"}),
        ],
    )
    async def test_bootstrap_commands_omit_private_commands(self, tool, args):
        server = _server_with_private_command()

        result = await server.call_tool(tool, args)

        assert result.success is True
        _assert_private_hidden(result, name_in_request=PRIVATE_NAME in args.values())

    @pytest.mark.asyncio
    async def test_bootstrap_commands_still_list_exposed_commands(self):
        server = _server_with_private_command()

        help_result = await server.call_tool("afd-help", {})
        schema_result = await server.call_tool("afd-schema", {})

        assert "todo-create" in [info.name for info in help_result.data.commands]
        assert "todo-create" in [info.name for info in schema_result.data.schemas]

    @pytest.mark.asyncio
    async def test_afd_detail_via_batch_treats_private_command_as_not_found(self):
        server = _server_with_private_command(tool_strategy="individual")

        result = await server.call_tool(
            "afd-batch",
            {
                "commands": [
                    {"command": "afd-detail", "input": {"command": PRIVATE_NAME}},
                    {"command": "afd-detail", "input": {"command": "secret-rotat"}},
                ]
            },
        )

        for item in result.results:
            entry = item.result.data[0]
            assert entry["found"] is False
            assert entry["error"]["code"] == "COMMAND_NOT_FOUND"
            assert "inputSchema" not in entry
            assert f"'{PRIVATE_NAME}'?" not in entry["error"]["suggestion"]
        assert PRIVATE_DESCRIPTION not in _dump(result)
        assert PRIVATE_FIELD not in _dump(result)

    @pytest.mark.asyncio
    async def test_lazy_discover_and_detail_omit_private_command(self):
        server = _server_with_private_command(tool_strategy="lazy")

        discover = await server.call_tool("afd-discover", {"search": "vault"})
        detail = await server.call_tool("afd-detail", {"command": PRIVATE_NAME})

        assert discover.data["commands"] == []
        _assert_private_hidden(discover)
        assert detail.data[0]["found"] is False
        assert detail.data[0]["error"]["code"] == "COMMAND_NOT_FOUND"
        assert PRIVATE_DESCRIPTION not in _dump(detail)

    @pytest.mark.asyncio
    async def test_afd_call_does_not_confirm_private_command_exists(self):
        server = _server_with_private_command(tool_strategy="lazy")

        result = await server.call_tool(
            "afd-call", {"command": PRIVATE_NAME, "input": {PRIVATE_FIELD: "/x"}}
        )

        assert result.success is False
        assert result.error.code == "COMMAND_NOT_FOUND"


def _server_with_failing_command(**kwargs):
    server = create_server("hardening", tool_strategy="lazy", **kwargs)

    @server.command(
        name="db-query",
        description="Query the database",
        input_schema=TodoInput,
        expose=ExposeOptions(mcp=True),
    )
    async def db_query(input: TodoInput):
        raise RuntimeError(LEAKY_MESSAGE)

    return server


class TestHandlerExceptions:
    @pytest.mark.asyncio
    async def test_exception_text_is_not_returned_and_is_logged(self, caplog, capsys):
        server = _server_with_failing_command()

        with caplog.at_level(logging.ERROR, logger="afd.server"):
            result = await server.call_tool("db-query", {"title": "x"})

        assert result.success is False
        assert result.error.code == "COMMAND_EXECUTION_ERROR"
        assert result.error.message == "An internal error occurred"
        assert "hunter2" not in _dump(result)

        records = [record for record in caplog.records if record.name == "afd.server"]
        assert len(records) == 1
        assert "db-query" in records[0].getMessage()
        assert records[0].exc_info is not None
        assert isinstance(records[0].exc_info[1], RuntimeError)
        assert capsys.readouterr().out == ""

    @pytest.mark.asyncio
    async def test_dev_mode_returns_exception_text(self, caplog):
        server = _server_with_failing_command(dev_mode=True)

        with caplog.at_level(logging.ERROR, logger="afd.server"):
            result = await server.call_tool("db-query", {"title": "x"})

        assert result.error.code == "COMMAND_EXECUTION_ERROR"
        assert result.error.message == LEAKY_MESSAGE
        assert any(record.name == "afd.server" for record in caplog.records)

    @pytest.mark.asyncio
    async def test_batch_and_pipe_do_not_return_exception_text(self):
        server = _server_with_failing_command()

        batch = await server.call_tool(
            "afd-batch", {"commands": [{"command": "db-query", "input": {"title": "x"}}]}
        )
        pipe = await server.call_tool(
            "afd-pipe", {"steps": [{"command": "db-query", "input": {"title": "x"}}]}
        )

        assert batch.results[0].result.error.message == "An internal error occurred"
        assert pipe.steps[0].error.message == "An internal error occurred"
        assert "hunter2" not in _dump(batch)
        assert "hunter2" not in _dump(pipe)

    @pytest.mark.asyncio
    async def test_middleware_exception_in_batch_and_pipe_is_sanitized(self):
        async def exploding_middleware(name, input, context, next_fn):
            raise RuntimeError(LEAKY_MESSAGE)

        server = create_server("hardening", tool_strategy="lazy", middleware=[exploding_middleware])

        @server.command(
            name="todo-create",
            description="Create a todo item",
            expose=ExposeOptions(mcp=True),
        )
        async def todo_create(input):
            return success({})

        batch = await server.call_tool("afd-batch", {"commands": [{"command": "todo-create"}]})
        pipe = await server.call_tool("afd-pipe", {"steps": [{"command": "todo-create"}]})

        assert batch.results[0].result.error.code == "COMMAND_EXECUTION_ERROR"
        assert pipe.steps[0].error.code == "COMMAND_EXECUTION_ERROR"
        assert "hunter2" not in _dump(batch)
        assert "hunter2" not in _dump(pipe)


class TestInputValidationErrors:
    @pytest.mark.asyncio
    async def test_pydantic_input_error_maps_to_validation_error(self):
        server = _server_with_private_command()

        result = await server.call_tool(
            "todo-create", {"title": "Ship", "count": "not-a-number-s3cr3t"}
        )

        assert result.success is False
        assert result.error.code == "VALIDATION_ERROR"
        assert result.error.message == "Input validation failed"
        assert result.error.details["errors"][0]["path"] == "count"
        assert result.error.details["errors"][0]["code"] == "int_parsing"
        assert "count" in result.error.suggestion
        assert "s3cr3t" not in _dump(result)

    @pytest.mark.asyncio
    async def test_missing_field_is_reported_structurally(self):
        server = _server_with_private_command()

        result = await server.call_tool("todo-create", {"count": 2})

        assert result.error.code == "VALIDATION_ERROR"
        assert result.error.details["missingFields"] == ["title"]
        assert result.error.details["expectedFields"] == ["title", "count"]
        assert "missing_fields" not in result.error.details
        assert "Missing required field(s): title" in result.error.suggestion

    @pytest.mark.asyncio
    async def test_bootstrap_input_error_maps_to_validation_error(self):
        server = _server_with_private_command()

        result = await server.call_tool("afd-schema", {"format": "yaml"})

        assert result.success is False
        assert result.error.code == "VALIDATION_ERROR"
        assert result.error.details["errors"][0]["path"] == "format"


class TestPipelineExecutorException:
    @pytest.mark.asyncio
    async def test_executor_exception_becomes_failed_step(self):
        async def executor(command, payload):
            raise RuntimeError("executor exploded")

        result = await execute_pipeline(
            PipelineRequest(steps=[PipelineStep(command="a"), PipelineStep(command="b")]),
            executor,
        )

        assert result.steps[0].status == StepStatus.FAILURE
        assert result.steps[0].error.code == "COMMAND_EXECUTION_ERROR"
        assert result.steps[1].status == StepStatus.SKIPPED


class TestUntrustedCommandNames:
    @pytest.mark.asyncio
    async def test_afd_detail_truncates_long_unknown_names(self):
        server = _server_with_private_command(tool_strategy="lazy")
        name = "todo-create" + "x" * 10_000

        detail = await server.call_tool("afd-detail", {"command": name})

        entry = detail.data[0]
        assert entry["found"] is False
        assert entry["name"] == name[:128]
        assert len(entry["error"]["message"]) < 200

    @pytest.mark.asyncio
    async def test_direct_client_truncates_long_unknown_names(self):
        registry = SimpleRegistry()

        @registry.command(name="todo-create")
        async def todo_create():
            return success({})

        name = "todo-creat" + "e" * 10_000
        result = await DirectClient(registry).call(name, {})

        assert result.success is False
        assert result.error.code == "UNKNOWN_TOOL"
        assert result.data.requested_tool == name[:128]
        assert len(result.error.message) < 200
