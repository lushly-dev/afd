"""Exception text never reaches the caller outside dev mode.

The core registry, the core pipeline executor and ``SimpleRegistry`` redact a
raised exception to COMMAND_EXECUTION_ERROR "An internal error occurred", as
the MCP server and TypeScript's ``executionFailure`` do, and log it instead.
"""

import json
import logging

import pytest

from afd.core.commands import CommandDefinition, create_command_registry
from afd.core.pipeline import PipelineRequest, PipelineStep, StepStatus, execute_pipeline
from afd.core.result import execution_failure
from afd.core.wire import to_wire
from afd.direct import DirectClient, SimpleRegistry, create_registry

LEAKY_MESSAGE = "db password=hunter2 at /srv/app/db.py"
REDACTED = "An internal error occurred"


async def _explode(*args, **kwargs):
    raise RuntimeError(LEAKY_MESSAGE)


def _wire_text(result) -> str:
    return json.dumps(to_wire(result))


def _logged_with_traceback(caplog, logger: str) -> bool:
    return any(r.name == logger and r.exc_info for r in caplog.records)


class TestExecutionFailure:
    def test_redacts_by_default(self):
        result = execution_failure(RuntimeError(LEAKY_MESSAGE))

        assert result.success is False
        assert result.error.code == "COMMAND_EXECUTION_ERROR"
        assert result.error.message == REDACTED
        assert LEAKY_MESSAGE not in _wire_text(result)

    def test_dev_mode_returns_the_exception_text(self):
        result = execution_failure(RuntimeError(LEAKY_MESSAGE), dev_mode=True)

        assert result.error.code == "COMMAND_EXECUTION_ERROR"
        assert result.error.message == LEAKY_MESSAGE


class TestCoreRegistry:
    def _registry(self, **kwargs):
        registry = create_command_registry(**kwargs)
        registry.register(
            CommandDefinition(name="todo-create", description="Create", handler=_explode)
        )
        return registry

    @pytest.mark.asyncio
    async def test_exception_text_is_redacted_and_logged(self, caplog):
        with caplog.at_level(logging.ERROR, logger="afd.core"):
            result = await self._registry().execute("todo-create", {})

        assert result.error.code == "COMMAND_EXECUTION_ERROR"
        assert result.error.message == REDACTED
        assert LEAKY_MESSAGE not in _wire_text(result)
        assert _logged_with_traceback(caplog, "afd.core")

    @pytest.mark.asyncio
    async def test_dev_mode_returns_the_exception_text(self):
        result = await self._registry(dev_mode=True).execute("todo-create", {})

        assert result.error.message == LEAKY_MESSAGE


class TestCorePipeline:
    def _request(self) -> PipelineRequest:
        return PipelineRequest(steps=[PipelineStep(command="a"), PipelineStep(command="b")])

    @pytest.mark.asyncio
    async def test_exception_text_is_redacted_and_logged(self, caplog):
        with caplog.at_level(logging.ERROR, logger="afd.core"):
            result = await execute_pipeline(self._request(), _explode)

        assert result.steps[0].status == StepStatus.FAILURE
        assert result.steps[0].error.code == "COMMAND_EXECUTION_ERROR"
        assert result.steps[0].error.message == REDACTED
        assert result.steps[1].status == StepStatus.SKIPPED
        assert LEAKY_MESSAGE not in _wire_text(result)
        assert _logged_with_traceback(caplog, "afd.core")

    @pytest.mark.asyncio
    async def test_dev_mode_returns_the_exception_text(self):
        result = await execute_pipeline(self._request(), _explode, dev_mode=True)

        assert result.steps[0].error.message == LEAKY_MESSAGE


class TestSimpleRegistry:
    @pytest.mark.asyncio
    async def test_exception_text_is_redacted_and_logged(self, caplog):
        registry = SimpleRegistry()
        registry.register("todo-create", _explode)

        with caplog.at_level(logging.ERROR, logger="afd.direct"):
            result = await DirectClient(registry).call("todo-create", {})

        assert result.error.code == "COMMAND_EXECUTION_ERROR"
        assert result.error.message == REDACTED
        assert LEAKY_MESSAGE not in _wire_text(result)
        assert _logged_with_traceback(caplog, "afd.direct")

    @pytest.mark.asyncio
    async def test_pipe_redacts_a_failing_step(self):
        registry = SimpleRegistry()
        registry.register("todo-create", _explode)

        result = await DirectClient(registry).pipe([{"command": "todo-create"}])

        assert LEAKY_MESSAGE not in _wire_text(result)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("make", [lambda: SimpleRegistry(dev_mode=True), lambda: create_registry(dev_mode=True)])
    async def test_dev_mode_returns_the_exception_text(self, make):
        registry = make()
        registry.register("todo-create", _explode)

        result = await DirectClient(registry).call("todo-create", {})

        assert result.error.message == LEAKY_MESSAGE
