"""There is exactly one CommandError class, and every error path can use it.

``afd.core.errors`` and ``afd.core.result`` used to define separate classes.
``CommandResult.error`` only accepted one of them, so wrapping any factory
error in ``failure()`` raised a pydantic ValidationError, as did the
DirectClient error paths and the server's batch timeout/stopOnError handling.
"""

import asyncio

import pytest
from pydantic import BaseModel

import afd
from afd import ExposeOptions, success
from afd.core import errors as errors_module
from afd.core import result as result_module
from afd.core.errors import (
    create_error,
    internal_error,
    not_found_error,
    rate_limit_error,
    timeout_error,
    validation_error,
    wrap_error,
)
from afd.core.result import CommandResult, error, failure
from afd.direct import CommandParameter, DirectClient, SimpleRegistry
from afd.server import create_server

FACTORY_ERRORS = {
    "create_error": lambda: create_error("CUSTOM", "Custom failure", suggestion="Retry"),
    "validation_error": lambda: validation_error("Title is required"),
    "not_found_error": lambda: not_found_error("Todo", "42"),
    "rate_limit_error": lambda: rate_limit_error(60),
    "timeout_error": lambda: timeout_error("fetch", 5000),
    "internal_error": lambda: internal_error("Boom", cause=ValueError("inner")),
    "wrap_error": lambda: wrap_error(RuntimeError("wrapped")),
}


class TestSingleCommandErrorClass:
    def test_both_import_paths_are_the_same_class(self):
        assert result_module.CommandError is errors_module.CommandError
        assert afd.CommandError is errors_module.CommandError

    @pytest.mark.parametrize("factory", sorted(FACTORY_ERRORS))
    def test_failure_accepts_every_factory_error(self, factory):
        err = FACTORY_ERRORS[factory]()

        result = failure(err)

        assert result.success is False
        assert result.error is err

    def test_failure_with_not_found_error_docstring_example(self):
        result = failure(not_found_error("Todo", "42"))

        assert result.error.code == "NOT_FOUND"
        assert result.error.details == {"resourceType": "Todo", "resourceId": "42"}

    def test_cause_is_available_on_result_errors(self):
        result = failure(internal_error("Query failed", cause=ValueError("db down")))

        assert result.error.cause == "db down"
        assert result.model_dump()["error"]["cause"] == "db down"


class TestSerializationUnchanged:
    def test_result_error_json_has_no_unset_cause(self):
        dumped = error("NOT_FOUND", "Missing", suggestion="Check the id").model_dump(mode="json")

        assert dumped["error"] == {
            "code": "NOT_FOUND",
            "message": "Missing",
            "suggestion": "Check the id",
            "retryable": None,
            "details": None,
        }

    def test_factory_error_inside_result_has_no_unset_cause(self):
        dumped = failure(not_found_error("Todo", "42")).model_dump_json()

        assert '"cause"' not in dumped

    def test_standalone_error_serialization_is_unchanged(self):
        dumped = create_error("CUSTOM", "Custom failure").model_dump()

        assert dumped == {
            "code": "CUSTOM",
            "message": "Custom failure",
            "suggestion": None,
            "retryable": None,
            "details": None,
            "cause": None,
        }


class TestDirectClientErrorPaths:
    @pytest.mark.asyncio
    async def test_handler_exception_returns_failure(self):
        registry = SimpleRegistry()

        @registry.command(name="todo-explode", description="Always raises")
        async def todo_explode():
            raise RuntimeError("kaboom")

        result = await DirectClient(registry).call("todo-explode", {})

        assert isinstance(result, CommandResult)
        assert result.success is False
        assert isinstance(result.error, errors_module.CommandError)

    @pytest.mark.asyncio
    async def test_input_validation_returns_failure(self):
        registry = SimpleRegistry()

        @registry.command(
            name="todo-create",
            parameters=[CommandParameter(name="title", type="string")],
        )
        async def todo_create(title: str):
            return success({"title": title})

        result = await DirectClient(registry).call("todo-create", {})

        assert result.success is False
        assert result.error.code == "VALIDATION_ERROR"
        assert "title" in result.error.message

    @pytest.mark.asyncio
    async def test_registry_unknown_command_returns_failure(self):
        result = await SimpleRegistry().execute("todo-missing", {})

        assert result.success is False
        assert result.error.code == "NOT_FOUND"


class SleepInput(BaseModel):
    seconds: float = 0


class ValueInput(BaseModel):
    value: int = 0


def _batch_server():
    server = create_server("batch-errors", tool_strategy="lazy")

    @server.command(
        name="work-sleep",
        description="Sleep for a while",
        input_schema=SleepInput,
        expose=ExposeOptions(mcp=True),
    )
    async def work_sleep(input: SleepInput):
        await asyncio.sleep(input.seconds)
        return success({"slept": input.seconds})

    @server.command(
        name="work-fail",
        description="Always fails",
        expose=ExposeOptions(mcp=True),
    )
    async def work_fail(input):
        return error("WORK_FAILED", "Work failed", suggestion="Try again")

    @server.command(
        name="work-echo",
        description="Echo a value",
        input_schema=ValueInput,
        expose=ExposeOptions(mcp=True),
    )
    async def work_echo(input: ValueInput):
        return success({"value": input.value})

    return server


class TestServerBatchErrorPaths:
    @pytest.mark.asyncio
    async def test_batch_timeout_returns_batch_timeout_results(self):
        server = _batch_server()

        result = await server.call_tool(
            "afd-batch",
            {
                "commands": [
                    {"id": "slow", "command": "work-sleep", "input": {"seconds": 1}},
                    {"id": "next", "command": "work-echo", "input": {"value": 1}},
                ],
                "options": {"timeout": 20},
            },
        )

        assert [item.id for item in result.results] == ["slow", "next"]
        for item in result.results:
            assert item.result.success is False
            assert item.result.error.code == "BATCH_TIMEOUT"
            assert item.result.error.retryable is True

    @pytest.mark.asyncio
    async def test_stop_on_error_skips_remaining_commands(self):
        server = _batch_server()

        result = await server.call_tool(
            "afd-batch",
            {
                "commands": [
                    {"id": "first", "command": "work-echo", "input": {"value": 1}},
                    {"id": "broken", "command": "work-fail", "input": {}},
                    {"id": "later", "command": "work-echo", "input": {"value": 2}},
                    {"id": "last", "command": "work-echo", "input": {"value": 3}},
                ],
                "options": {"stopOnError": True},
            },
        )

        codes = [item.result.error.code if item.result.error else None for item in result.results]
        assert codes == [None, "WORK_FAILED", "COMMAND_SKIPPED", "COMMAND_SKIPPED"]
        assert result.results[0].result.data == {"value": 1}
