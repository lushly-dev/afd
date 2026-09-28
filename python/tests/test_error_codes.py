"""The shared error-code catalog and the D4 rules in spec/error-codes.md.

- Remote MCP answers ``COMMAND_NOT_FOUND`` for unknown and unexposed commands
  alike, so private commands stay hidden.
- An in-process registry called with an interface answers ``COMMAND_NOT_EXPOSED``.
- DirectClient answers ``UNKNOWN_TOOL``, always with a suggestion.
- Suggestions name only tools the host provides.
"""

import json
from pathlib import Path

import pytest

from afd import ExposeOptions, success
from afd.core.commands import CommandContext, CommandDefinition, create_command_registry
from afd.core.errors import ErrorCodes
from afd.direct import DirectClient, SimpleRegistry
from afd.server import create_server

CATALOG = Path(__file__).resolve().parents[2] / "spec" / "vectors" / "error-codes.json"


def test_error_codes_is_the_shared_catalog():
    codes = json.loads(CATALOG.read_text(encoding="utf-8"))["codes"]
    defined = [name for name in vars(ErrorCodes) if not name.startswith("_")]
    assert defined == codes
    for name in defined:
        assert getattr(ErrorCodes, name) == name


def _server():
    server = create_server("d4")

    @server.command(name="todo-list", description="List todos", expose=ExposeOptions(mcp=True))
    async def todo_list(input):
        return success([])

    @server.command(name="secret-rotate", description="Rotate keys", expose=ExposeOptions(mcp=False))
    async def secret_rotate(input):
        return success({"rotated": True})

    return server


class TestRemoteHidesPrivateCommands:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("name", ["secret-rotate", "no-such-command"])
    async def test_afd_call(self, name):
        result = await _server().call_tool("afd-call", {"command": name})

        assert result.error.code == "COMMAND_NOT_FOUND"
        assert result.error.message == f"Command '{name}' not found"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("name", ["secret-rotate", "no-such-command"])
    async def test_afd_batch(self, name):
        result = await _server().call_tool("afd-batch", {"commands": [{"command": name}]})

        error = result.results[0].result.error
        assert error.code == "COMMAND_NOT_FOUND"
        assert error.message == f"Command '{name}' not found"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("name", ["secret-rotate", "no-such-command"])
    async def test_afd_pipe(self, name):
        result = await _server().call_tool("afd-pipe", {"steps": [{"command": name}]})

        assert result.steps[0].error.code == "COMMAND_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_in_process_interface_gets_not_exposed(self):
        result = await _server().execute(
            "secret-rotate", {}, CommandContext(extra={"interface": "mcp"})
        )

        assert result.error.code == "COMMAND_NOT_EXPOSED"
        assert result.error.retryable is False


class TestCoreRegistry:
    @pytest.mark.asyncio
    async def test_not_in_context_names_the_command_contexts(self):
        registry = create_command_registry()

        async def handler(input, context=None):
            return success({})

        registry.register(
            CommandDefinition(
                name="plan-order", description="Plan", handler=handler, contexts=["planning"]
            )
        )
        result = await registry.execute(
            "plan-order", {}, CommandContext(extra={"active_context": "combat"})
        )

        assert result.error.code == "COMMAND_NOT_IN_CONTEXT"
        assert "afd-context" not in result.error.suggestion
        assert "'planning'" in result.error.suggestion


class TestDirectClientUnknownTool:
    @pytest.mark.asyncio
    async def test_suggests_the_closest_match(self):
        registry = SimpleRegistry()

        @registry.command(name="todo-list")
        async def todo_list():
            return success([])

        result = await DirectClient(registry).call("todo-lst", {})

        assert result.error.code == "UNKNOWN_TOOL"
        assert result.error.suggestion == "Did you mean 'todo-list'?"
        assert result.error.retryable is False

    @pytest.mark.asyncio
    async def test_always_has_a_suggestion(self):
        registry = SimpleRegistry()

        @registry.command(name="todo-list")
        async def todo_list():
            return success([])

        result = await DirectClient(registry).call("zzzz", {})

        assert result.error.code == "UNKNOWN_TOOL"
        assert result.error.suggestion == (
            "Call one of the commands returned by list_command_names()"
        )
