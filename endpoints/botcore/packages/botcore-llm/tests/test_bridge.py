"""Tests for the command → tool bridge."""

from __future__ import annotations

import json

import pytest
from afd import CommandResult, error, success
from copilot import ToolInvocation
from pydantic import BaseModel

from botcore_llm.bridge import (
    _extract_parameter_schema,
    botcore_command_to_copilot_tool,
    bridge_commands,
)

# ---------------------------------------------------------------------------
# Sample commands for testing
# ---------------------------------------------------------------------------


async def greet(name: str, greeting: str = "Hello") -> CommandResult[dict]:
    """Greet a user by name."""
    return success(data={"message": f"{greeting}, {name}!"})


async def fail_command(reason: str) -> CommandResult[dict]:
    """A command that always fails."""
    return error(
        "TEST_ERROR",
        f"Failed: {reason}",
        suggestion="Try something else",
    )


class AddParams(BaseModel):
    a: int
    b: int


async def add_numbers(params: AddParams) -> CommandResult[dict]:
    """Add two numbers."""
    return success(data={"result": params.a + params.b})


async def no_args_command() -> CommandResult[dict]:
    """A command with no arguments."""
    return success(data={"status": "ok"})


async def optional_params_command(
    name: str,
    tags: list[str] | None = None,
    count: int | None = None,
) -> CommandResult[dict]:
    """A command with optional parameters."""
    return success(data={"name": name, "tags": tags, "count": count})


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestBotcoreCommandToCopilotTool:
    def test_converts_simple_command(self):
        tool = botcore_command_to_copilot_tool(greet)

        assert tool.name == "greet"
        assert "Greet a user" in tool.description
        assert tool.parameters is not None
        assert "name" in tool.parameters["properties"]

    def test_converts_pydantic_command(self):
        tool = botcore_command_to_copilot_tool(add_numbers)

        assert tool.name == "add_numbers"
        assert tool.parameters is not None
        assert "a" in tool.parameters["properties"]
        assert "b" in tool.parameters["properties"]

    def test_converts_no_args_command(self):
        tool = botcore_command_to_copilot_tool(no_args_command)

        assert tool.name == "no_args_command"
        assert tool.parameters is None

    @pytest.mark.asyncio
    async def test_handler_calls_command_and_returns_success(self):
        tool = botcore_command_to_copilot_tool(greet)

        invocation = ToolInvocation(
            session_id="s1",
            tool_call_id="tc1",
            tool_name="greet",
            arguments={"name": "World"},
        )
        result = await tool.handler(invocation)

        assert result.result_type == "success"
        data = json.loads(result.text_result_for_llm)
        assert data["message"] == "Hello, World!"

    @pytest.mark.asyncio
    async def test_handler_converts_error_with_suggestion(self):
        tool = botcore_command_to_copilot_tool(fail_command)

        invocation = ToolInvocation(
            session_id="s1",
            tool_call_id="tc1",
            tool_name="fail_command",
            arguments={"reason": "bad input"},
        )
        result = await tool.handler(invocation)

        assert result.result_type == "failure"
        data = json.loads(result.text_result_for_llm)
        assert data["error"] == "TEST_ERROR"
        assert data["suggestion"] == "Try something else"

    @pytest.mark.asyncio
    async def test_handler_pydantic_model_params(self):
        tool = botcore_command_to_copilot_tool(add_numbers)

        invocation = ToolInvocation(
            session_id="s1",
            tool_call_id="tc1",
            tool_name="add_numbers",
            arguments={"a": 3, "b": 4},
        )
        result = await tool.handler(invocation)

        assert result.result_type == "success"
        data = json.loads(result.text_result_for_llm)
        assert data["result"] == 7


class TestExtractParameterSchema:
    def test_simple_params(self):
        schema = _extract_parameter_schema(greet)

        assert schema is not None
        assert schema["type"] == "object"
        assert "name" in schema["properties"]
        assert "greeting" in schema["properties"]
        assert "name" in schema["required"]
        assert "greeting" not in schema.get("required", [])

    def test_pydantic_params(self):
        schema = _extract_parameter_schema(add_numbers)

        assert schema is not None
        assert "a" in schema["properties"]
        assert "b" in schema["properties"]

    def test_no_params(self):
        schema = _extract_parameter_schema(no_args_command)
        assert schema is None

    def test_optional_params_unwrap_union(self):
        schema = _extract_parameter_schema(optional_params_command)

        assert schema is not None
        # list[str] | None should unwrap to "array", not fall through to "string"
        assert schema["properties"]["tags"]["type"] == "array"
        # int | None should unwrap to "integer"
        assert schema["properties"]["count"]["type"] == "integer"
        # Non-optional str stays "string"
        assert schema["properties"]["name"]["type"] == "string"


class TestBridgeCommands:
    def test_resolves_and_bridges(self):
        namespace = {"greet": greet, "add_numbers": add_numbers}
        tools = bridge_commands(["greet"], namespace)

        assert len(tools) == 1
        assert tools[0].name == "greet"

    def test_missing_command_raises(self):
        namespace = {"greet": greet}

        with pytest.raises(KeyError, match="nonexistent"):
            bridge_commands(["nonexistent"], namespace)
