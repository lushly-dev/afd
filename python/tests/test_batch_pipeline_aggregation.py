"""Batch and pipeline aggregation never raises after side effects (review finding H8).

Every item is coerced to a CommandResult, built-in tools cannot run inside a
batch or pipeline, malformed ``when`` conditions are rejected before any step
runs, and a batch that stops cancels (and waits for) its in-flight commands.
"""

import asyncio
import logging

import pytest
from pydantic import BaseModel

from afd import ExposeOptions, success
from afd.core.pipeline import (
    PipelineRequest,
    PipelineStep,
    StepStatus,
    execute_pipeline,
)
from afd.core.result import CommandResult, coerce_command_result, error
from afd.server import create_server
from afd.server.factory import DEFAULT_MAX_BATCH_PARALLELISM, DEFAULT_MAX_BATCH_SIZE

MCP = ExposeOptions(mcp=True)


class SleepInput(BaseModel):
    seconds: float = 0
    fail: bool = False


def _server(writes: list, **kwargs):
    """A server whose commands record their side effects in ``writes``."""
    server = create_server("aggregation", **kwargs)

    @server.command(name="todo-create", description="Create", expose=MCP)
    async def todo_create(input):
        writes.append(("create", input))
        return success({"ok": True})

    @server.command(name="todo-slow", description="Slow write", input_schema=SleepInput, expose=MCP)
    async def todo_slow(input: SleepInput):
        await asyncio.sleep(input.seconds)
        writes.append(("slow", input.seconds))
        if input.fail:
            return error("WRITE_FAILED", "The write failed", suggestion="Retry later")
        return success({"slept": input.seconds})

    @server.command(name="todo-raw", description="Returns a plain dict", expose=MCP)
    async def todo_raw(input):
        writes.append(("raw", input))
        return {"id": "raw-1"}

    @server.command(name="todo-rawresult", description="Returns a result dict", expose=MCP)
    async def todo_rawresult(input):
        return {"success": True, "data": {"id": "dict-1"}, "reasoning": "Created"}

    return server


class TestCoerceCommandResult:
    def test_command_result_is_returned_unchanged(self):
        result = success({"a": 1})
        assert coerce_command_result(result, "x") is result

    def test_result_shaped_dict_is_parsed_in_either_case(self):
        camel = coerce_command_result({"success": True, "data": 1, "undoCommand": "u"}, "x")
        snake = coerce_command_result({"success": True, "data": 1, "undo_command": "u"}, "x")
        assert camel.undo_command == snake.undo_command == "u"

    @pytest.mark.parametrize("value", [{"id": 1}, None, [1, 2], "text", {"success": "yes"}])
    def test_anything_else_is_a_non_retryable_failure(self, value):
        result = coerce_command_result(value, "todo-raw")
        assert result.success is False
        assert result.error.code == "INVALID_COMMAND_RESULT"
        assert result.error.retryable is False
        assert "todo-raw" in result.error.message
        assert result.error.suggestion


class TestBatchItemsAreCoerced:
    @pytest.mark.asyncio
    async def test_plain_dict_handler_is_a_failed_item_not_an_exception(self, caplog):
        writes: list = []
        server = _server(writes)

        with caplog.at_level(logging.WARNING, logger="afd.server"):
            result = await server.call_tool(
                "afd-batch",
                {
                    "commands": [
                        {"command": "todo-raw", "input": {}},
                        {"command": "todo-create", "input": {"title": "after"}},
                        {"command": "todo-rawresult", "input": {}},
                    ]
                },
            )

        assert result.success is True
        raw, created, parsed = result.results
        assert raw.result.error.code == "INVALID_COMMAND_RESULT"
        assert created.result.success is True
        assert parsed.result.success is True
        assert parsed.result.data == {"id": "dict-1"}
        assert result.summary.failure_count == 1
        assert [kind for kind, _ in writes] == ["raw", "create"]
        assert any("todo-raw" in record.getMessage() for record in caplog.records)

    @pytest.mark.asyncio
    async def test_plain_dict_step_in_pipeline_is_a_failed_step(self):
        writes: list = []
        server = _server(writes)

        result = await server.call_tool(
            "afd-pipe",
            {"steps": [{"command": "todo-create"}, {"command": "todo-raw"}, {"command": "todo-create"}]},
        )

        assert [step.status for step in result.steps] == [
            StepStatus.SUCCESS,
            StepStatus.FAILURE,
            StepStatus.SKIPPED,
        ]
        assert result.steps[1].error.code == "INVALID_COMMAND_RESULT"

    @pytest.mark.asyncio
    async def test_core_pipeline_coerces_whatever_the_executor_returns(self):
        async def executor(command, payload):
            if command == "dict":
                return {"success": True, "data": {"n": 1}, "confidence": 0.5}
            return {"n": 2}

        result = await execute_pipeline(
            PipelineRequest(steps=[PipelineStep(command="dict"), PipelineStep(command="raw")]),
            executor,
        )

        assert result.steps[0].status == StepStatus.SUCCESS
        assert result.steps[0].data == {"n": 1}
        assert result.metadata.confidence == 0.5
        assert result.steps[1].status == StepStatus.FAILURE
        assert result.steps[1].error.code == "INVALID_COMMAND_RESULT"

    @pytest.mark.asyncio
    async def test_direct_client_pipe_coerces_plain_dict_handlers(self):
        from afd.direct import DirectClient, SimpleRegistry

        registry = SimpleRegistry()

        @registry.command(name="raw-get")
        async def raw_get():
            return {"id": 1}

        result = await DirectClient(registry).pipe([{"command": "raw-get"}])

        assert result.success is False
        assert result.steps[0].result.error.code == "INVALID_COMMAND_RESULT"

    @pytest.mark.asyncio
    async def test_timeout_error_raised_by_a_step_is_not_the_pipeline_deadline(self):
        async def executor(command, payload):
            raise TimeoutError("upstream timed out")

        result = await execute_pipeline(
            PipelineRequest(
                steps=[PipelineStep(command="a"), PipelineStep(command="b")],
                options={"timeout_ms": 60_000, "continue_on_failure": True},
            ),
            executor,
        )

        assert [step.error.code for step in result.steps] == [
            "COMMAND_EXECUTION_ERROR",
            "COMMAND_EXECUTION_ERROR",
        ]


class TestBuiltInToolsCannotBeNested:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "tool", ["afd-batch", "afd-pipe", "afd-call", "afd-discover", "afd-detail"]
    )
    async def test_batch_rejects_built_in_tools_before_running_anything(self, tool):
        writes: list = []
        server = _server(writes)

        result = await server.call_tool(
            "afd-batch",
            {
                "commands": [
                    {"command": "todo-create", "input": {"title": "first"}},
                    {"command": tool, "input": {"commands": [{"command": "todo-create"}]}},
                ]
            },
        )

        assert result.success is False
        assert result.error.code == "INVALID_BATCH_REQUEST"
        assert result.error.details["errors"] == [
            {
                "path": "commands.1.command",
                "message": f"'{tool}' is a built-in tool, not a command, and cannot run inside a batch",
                "code": "reserved_tool",
            }
        ]
        assert tool in result.error.suggestion
        assert writes == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", ["afd-batch", "afd-pipe", "afd-call"])
    async def test_pipeline_rejects_built_in_tools_before_running_anything(self, tool):
        writes: list = []
        server = _server(writes)

        result = await server.call_tool(
            "afd-pipe",
            {
                "steps": [
                    {"command": "todo-create"},
                    {"command": tool, "input": {"commands": [{"command": "todo-create"}]}},
                ]
            },
        )

        assert result.steps[0].index == -1
        assert result.steps[0].error.code == "INVALID_PIPELINE_REQUEST"
        assert result.steps[0].error.details["errors"][0]["path"] == "steps.1.command"
        assert writes == []

    @pytest.mark.asyncio
    async def test_bootstrap_commands_still_run_inside_a_batch(self):
        server = _server([])

        result = await server.call_tool("afd-batch", {"commands": [{"command": "afd-help"}]})

        assert result.results[0].result.success is True

    def test_commands_cannot_use_a_built_in_tool_name(self):
        server = create_server("reserved")

        with pytest.raises(ValueError, match="reserved"):

            @server.command(name="afd-batch", description="Shadow the batch tool")
            async def shadow(input):
                return success({})


class TestPipelineConditionsAreValidatedUpFront:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("when", "problem"),
        [
            ({"$exist": "$prev.id"}, "unknown operator '$exist'"),
            ({"$eq": "$prev.id"}, "$eq takes [reference, value]"),
            ({"$eq": ["$prev.id", 1, 2]}, "$eq takes [reference, value]"),
            ({"$and": {"$exists": "$prev"}}, "$and takes a list of conditions"),
            ({"$and": [{"$exists": "$prev"}, {"$exist": "$prev"}]}, "unknown operator '$exist'"),
            ({"$not": {"$gt": ["$prev.n", "5"]}}, "$gt takes [reference, finite number]"),
            ({"$gt": ["$prev.n", True]}, "$gt takes [reference, finite number]"),
            ({"$exists": "$prev", "$eq": ["$prev", 1]}, "exactly one operator"),
        ],
    )
    async def test_malformed_condition_rejects_the_pipeline_before_any_step(self, when, problem):
        writes: list = []
        server = _server(writes)

        result = await server.call_tool(
            "afd-pipe",
            {"steps": [{"command": "todo-create"}, {"command": "todo-create", "when": when}]},
        )

        assert writes == []
        failure = result.steps[0]
        assert failure.index == -1
        assert failure.error.code == "INVALID_PIPELINE_REQUEST"
        error_detail = failure.error.details["errors"][0]
        assert error_detail["path"] == "steps.1.when"
        assert problem in error_detail["message"]

    def test_condition_union_has_no_catch_all_branch(self):
        with pytest.raises(ValueError, match="unknown operator"):
            PipelineStep(command="x", when={"$exist": "$prev.id"})

    @pytest.mark.asyncio
    async def test_valid_conditions_still_run(self):
        writes: list = []
        server = _server(writes)

        result = await server.call_tool(
            "afd-pipe",
            {
                "steps": [
                    {"command": "todo-create", "as": "a"},
                    {
                        "command": "todo-create",
                        "when": {"$and": [{"$exists": "$steps.a.ok"}, {"$eq": ["$prev.ok", True]}]},
                    },
                    {"command": "todo-create", "when": {"$not": {"$exists": "$prev.ok"}}},
                ]
            },
        )

        assert [step.status for step in result.steps] == [
            StepStatus.SUCCESS,
            StepStatus.SUCCESS,
            StepStatus.SKIPPED,
        ]


class TestBatchStopsCancelSiblings:
    @pytest.mark.asyncio
    async def test_stop_on_error_cancels_in_flight_siblings(self):
        writes: list = []
        server = _server(writes)

        result = await server.call_tool(
            "afd-batch",
            {
                "commands": [
                    {"command": "todo-slow", "input": {"seconds": 0, "fail": True}},
                    {"command": "todo-slow", "input": {"seconds": 0.3}},
                    {"command": "todo-create", "input": {}},
                ],
                "options": {"parallelism": 2, "stopOnError": True},
            },
        )
        await asyncio.sleep(0.4)  # a leaked sibling would write now

        failed, cancelled, skipped = result.results
        assert failed.result.error.code == "WRITE_FAILED"
        assert cancelled.result.error.code == "COMMAND_CANCELLED"
        assert cancelled.result.error.suggestion
        assert skipped.result.error.code == "COMMAND_SKIPPED"
        assert writes == [("slow", 0)]

    @pytest.mark.asyncio
    async def test_deadline_cancels_in_flight_commands(self):
        writes: list = []
        server = _server(writes)

        result = await server.call_tool(
            "afd-batch",
            {
                "commands": [
                    {"command": "todo-slow", "input": {"seconds": 0.3}},
                    {"command": "todo-slow", "input": {"seconds": 0.3}},
                    {"command": "todo-create", "input": {}},
                ],
                "options": {"parallelism": 2, "timeout": 50},
            },
        )
        await asyncio.sleep(0.4)

        assert [item.result.error.code for item in result.results] == ["BATCH_TIMEOUT"] * 3
        assert result.timing.total_ms < 250
        assert writes == []

    @pytest.mark.asyncio
    async def test_cancelling_the_batch_cancels_its_commands(self):
        writes: list = []
        server = _server(writes)

        task = asyncio.ensure_future(
            server.call_tool(
                "afd-batch",
                {
                    "commands": [{"command": "todo-slow", "input": {"seconds": 0.2}}] * 3,
                    "options": {"parallelism": 3},
                },
            )
        )
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await asyncio.sleep(0.3)

        assert writes == []

    @pytest.mark.asyncio
    async def test_parallel_items_all_finish_before_the_batch_returns(self):
        writes: list = []
        server = _server(writes)

        result = await server.call_tool(
            "afd-batch",
            {
                "commands": [
                    {"command": "todo-raw", "input": {}},
                    {"command": "todo-slow", "input": {"seconds": 0.1}},
                ],
                "options": {"parallelism": 2},
            },
        )
        writes_at_return = list(writes)
        await asyncio.sleep(0.2)

        assert result.results[1].result.success is True
        assert writes == writes_at_return


class TestBatchCaps:
    @pytest.mark.asyncio
    async def test_defaults(self):
        assert DEFAULT_MAX_BATCH_SIZE == 500
        assert DEFAULT_MAX_BATCH_PARALLELISM == 16

    @pytest.mark.asyncio
    async def test_too_many_commands_is_rejected_before_running_anything(self):
        writes: list = []
        server = _server(writes, max_batch_size=3)

        result = await server.call_tool(
            "afd-batch", {"commands": [{"command": "todo-create"}] * 4}
        )

        assert result.error.code == "INVALID_BATCH_REQUEST"
        assert result.error.details["errors"][0]["path"] == "commands"
        assert "at most 3" in result.error.details["errors"][0]["message"]
        assert writes == []

    @pytest.mark.asyncio
    async def test_default_size_cap(self):
        writes: list = []
        server = _server(writes)

        result = await server.call_tool(
            "afd-batch", {"commands": [{"command": "todo-create"}] * (DEFAULT_MAX_BATCH_SIZE + 1)}
        )

        assert result.error.code == "INVALID_BATCH_REQUEST"
        assert writes == []

    @pytest.mark.asyncio
    async def test_parallelism_above_the_cap_is_rejected(self):
        writes: list = []
        server = _server(writes, max_batch_parallelism=4)

        result = await server.call_tool(
            "afd-batch",
            {"commands": [{"command": "todo-create"}], "options": {"parallelism": 5}},
        )

        assert result.error.code == "INVALID_BATCH_REQUEST"
        assert result.error.details["errors"][0]["path"] == "options.parallelism"
        assert writes == []

    @pytest.mark.asyncio
    async def test_empty_batch_is_rejected(self):
        result = await _server([]).call_tool("afd-batch", {"commands": []})

        assert result.error.code == "INVALID_BATCH_REQUEST"

    def test_caps_must_be_positive(self):
        with pytest.raises(ValueError):
            create_server("bad", max_batch_size=0)


class TestServerMetadata:
    @pytest.mark.asyncio
    async def test_direct_call_gets_execution_time_and_trace_id(self):
        server = _server([])

        first = await server.call_tool("todo-create", {})
        second = await server.call_tool("todo-create", {})

        assert first.metadata.execution_time_ms >= 0
        assert first.metadata.trace_id
        assert first.metadata.trace_id != second.metadata.trace_id

    @pytest.mark.asyncio
    async def test_handler_result_object_is_not_mutated(self):
        shared = success({"shared": True})
        server = create_server("shared")

        @server.command(name="shared-get", description="Shared result", expose=MCP)
        async def shared_get(input):
            return shared

        result = await server.call_tool("shared-get", {})

        assert result.metadata.trace_id
        assert shared.metadata is None

    @pytest.mark.asyncio
    async def test_batch_items_carry_the_batch_trace_id(self):
        server = _server([])

        result = await server.call_tool(
            "afd-batch", {"commands": [{"command": "todo-create"}, {"command": "todo-create"}]}
        )

        batch_trace = result.metadata.trace_id
        assert batch_trace.startswith("batch-")
        assert [item.result.metadata.trace_id for item in result.results] == [
            f"{batch_trace}-0",
            f"{batch_trace}-1",
        ]

    @pytest.mark.asyncio
    async def test_failures_from_the_handler_get_metadata_too(self):
        server = _server([])

        result = await server.call_tool("todo-slow", {"fail": True})

        assert isinstance(result, CommandResult)
        assert result.metadata.execution_time_ms >= 0
