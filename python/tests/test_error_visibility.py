"""Errors that blind ``except Exception`` blocks used to hide (ruff BLE001/S110).

Each boundary still keeps the failure from crashing its caller, but the
failure is now logged or reported under an accurate error code.
"""

import logging

import pytest

from afd import success
from afd.client import McpClient
from afd.direct import DirectClient, SimpleRegistry
from afd.lushx_ext.linters import AFDLinter
from afd.server.middleware import create_telemetry_middleware
from afd.testing.commands.evaluate import scenario_evaluate
from afd.transports.mock import MockTransport


class TestClientEventHandlers:
    def test_raising_handler_is_logged_and_others_still_run(self, caplog):
        client = McpClient(transport=MockTransport())
        seen = []

        def broken(*args):
            raise RuntimeError("handler bug")

        client.on("connected", broken)
        client.on("connected", lambda *args: seen.append(True))

        with caplog.at_level(logging.ERROR, logger="afd.client"):
            client._emit("connected")

        assert seen == [True]
        assert any("connected" in r.getMessage() and r.exc_info for r in caplog.records)


class TestTelemetrySinkFailures:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("asynchronous", [False, True])
    async def test_sink_failure_is_logged_and_the_result_kept(self, caplog, asynchronous):
        class BrokenSink:
            def record(self, event):
                if asynchronous:

                    async def fail():
                        raise RuntimeError("sink down")

                    return fail()
                raise RuntimeError("sink down")

            def flush(self):
                pass

        middleware = create_telemetry_middleware(BrokenSink())

        async def next_fn():
            return success({"ok": True})

        from afd.core.commands import CommandContext

        with caplog.at_level(logging.WARNING, logger="afd.middleware"):
            result = await middleware("todo-create", {}, CommandContext(), next_fn)

        assert result.success is True
        assert any("todo-create" in r.getMessage() and r.exc_info for r in caplog.records)


class TestSimpleRegistryErrorCodes:
    @pytest.mark.asyncio
    async def test_crashing_handler_is_an_execution_error_not_bad_input(self):
        registry = SimpleRegistry()

        @registry.command(name="todo-get")
        async def todo_get(id: str):
            raise KeyError(id)

        result = await DirectClient(registry).call("todo-get", {"id": "x"})

        assert result.error.code == "COMMAND_EXECUTION_ERROR"

    @pytest.mark.asyncio
    async def test_wrong_arguments_are_a_validation_error(self):
        registry = SimpleRegistry()

        @registry.command(name="todo-get")
        async def todo_get(id: str):
            return success({"id": id})

        result = await DirectClient(registry).call("todo-get", {"identifier": "x"})

        assert result.error.code == "VALIDATION_ERROR"
        assert "todo-get" in result.error.message


class TestLinterFailures:
    def test_a_rule_failure_is_logged_not_silently_skipped(self, tmp_path, caplog, monkeypatch):
        (tmp_path / "commands.py").write_text("def x():\n    return 1\n")
        linter = AFDLinter()

        def broken(*args, **kwargs):
            raise RuntimeError("rule bug")

        monkeypatch.setattr(linter, "_lint_file", broken)
        with caplog.at_level(logging.WARNING, logger="afd.lint"):
            result = linter.lint(tmp_path)

        assert result.files_checked == 1
        assert any("commands.py" in r.getMessage() for r in caplog.records)

    def test_class_constants_are_immutable(self):
        assert isinstance(AFDLinter.SKIP_DIRS, frozenset)
        assert isinstance(AFDLinter.SKIP_PATH_PATTERNS, frozenset)


class TestScenarioEvaluateFailures:
    @pytest.mark.asyncio
    async def test_executor_failure_is_logged(self, tmp_path, monkeypatch, caplog):
        monkeypatch.chdir(tmp_path)
        (tmp_path / "a.scenario.yaml").write_text(
            "name: a\ndescription: d\njob: a\nsteps:\n  - command: x\n    expect:\n      success: true\n"
        )

        from afd.testing.scenarios import executor as executor_module

        async def broken_execute(self, scenario):
            raise RuntimeError("executor bug")

        monkeypatch.setattr(executor_module.InProcessExecutor, "execute", broken_execute)

        async def handler(command, input):
            return success({})

        with caplog.at_level(logging.WARNING, logger="afd.testing"):
            result = await scenario_evaluate({"handler": handler, "directory": "."})

        assert result.data["report"]["summary"]["error_scenarios"] == 1
        assert any(r.exc_info for r in caplog.records if r.name == "afd.testing")
