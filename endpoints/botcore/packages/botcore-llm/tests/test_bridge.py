"""Tests for the command → tool bridge."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from afd import CommandResult, error, success
from botcore.context import ExecutionContext
from botcore.host import CommandHost, CommandPolicy
from copilot import ToolInvocation
from pydantic import BaseModel

from botcore_llm.bridge import botcore_command_to_copilot_tool, bridge_commands

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


WRITES: list[str] = []


async def write_note(text: str) -> CommandResult[dict]:
    """Write a note into the source tree."""
    WRITES.append(text)
    return success(data={"written": text})


def _host(tmp_path: Path, profile: str = "inspection") -> CommandHost:
    host = CommandHost("test", ExecutionContext(tmp_path, profile=profile))
    for command in (greet, fail_command, add_numbers, no_args_command, optional_params_command):
        host.register(command.__name__, command, CommandPolicy())
    host.register("write_note", write_note, CommandPolicy(("source-write",)))
    return host


def _invoke(tool_name: str, arguments: dict | None) -> ToolInvocation:
    return ToolInvocation(
        session_id="s1", tool_call_id="tc1", tool_name=tool_name, arguments=arguments
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestBotcoreCommandToCopilotTool:
    def test_converts_simple_command(self, tmp_path):
        tool = botcore_command_to_copilot_tool("greet", _host(tmp_path))

        assert tool.name == "greet"
        assert "Greet a user" in tool.description
        assert tool.parameters is not None
        assert "name" in tool.parameters["properties"]
        assert tool.parameters["required"] == ["name"]

    def test_converts_pydantic_command(self, tmp_path):
        tool = botcore_command_to_copilot_tool("add_numbers", _host(tmp_path))

        assert tool.name == "add_numbers"
        assert tool.parameters is not None
        assert "params" in tool.parameters["properties"]

    def test_converts_no_args_command(self, tmp_path):
        tool = botcore_command_to_copilot_tool("no_args_command", _host(tmp_path))

        assert tool.name == "no_args_command"
        assert tool.parameters is None

    def test_optional_params_use_the_host_catalog_schema(self, tmp_path):
        host = _host(tmp_path)
        tool = botcore_command_to_copilot_tool("optional_params_command", host)
        (row,) = [r for r in host.catalog() if r["name"] == "optional_params_command"]

        assert tool.parameters == row["input_schema"]

    def test_missing_command_raises(self, tmp_path):
        with pytest.raises(KeyError, match="nonexistent"):
            botcore_command_to_copilot_tool("nonexistent", _host(tmp_path))

    @pytest.mark.asyncio
    async def test_handler_calls_command_and_returns_success(self, tmp_path):
        tool = botcore_command_to_copilot_tool("greet", _host(tmp_path))

        result = await tool.handler(_invoke("greet", {"name": "World"}))

        assert result.result_type == "success"
        data = json.loads(result.text_result_for_llm)
        assert data["message"] == "Hello, World!"

    @pytest.mark.asyncio
    async def test_handler_converts_error_with_suggestion(self, tmp_path):
        tool = botcore_command_to_copilot_tool("fail_command", _host(tmp_path))

        result = await tool.handler(_invoke("fail_command", {"reason": "bad input"}))

        assert result.result_type == "failure"
        data = json.loads(result.text_result_for_llm)
        assert data["error"] == "TEST_ERROR"
        assert data["suggestion"] == "Try something else"

    @pytest.mark.asyncio
    async def test_handler_pydantic_model_params(self, tmp_path):
        tool = botcore_command_to_copilot_tool("add_numbers", _host(tmp_path))

        result = await tool.handler(_invoke("add_numbers", {"params": {"a": 3, "b": 4}}))

        assert result.result_type == "success"
        data = json.loads(result.text_result_for_llm)
        assert data["result"] == 7


class TestHostPolicy:
    """A model's tool call is dispatched by the host, under the host's policy."""

    @pytest.mark.asyncio
    async def test_call_the_profile_refuses_is_refused_before_the_handler(self, tmp_path):
        WRITES.clear()
        tool = botcore_command_to_copilot_tool("write_note", _host(tmp_path, "inspection"))

        result = await tool.handler(_invoke("write_note", {"text": "hi"}))

        assert result.result_type == "failure"
        data = json.loads(result.text_result_for_llm)
        assert data["error"] == "EFFECT_DENIED"
        assert data["suggestion"]
        assert WRITES == []

    @pytest.mark.asyncio
    async def test_call_the_profile_admits_runs(self, tmp_path):
        WRITES.clear()
        tool = botcore_command_to_copilot_tool("write_note", _host(tmp_path, "trusted-local"))

        result = await tool.handler(_invoke("write_note", {"text": "hi"}))

        assert result.result_type == "success"
        assert WRITES == ["hi"]

    @pytest.mark.asyncio
    async def test_unknown_argument_is_refused_with_the_host_error(self, tmp_path):
        tool = botcore_command_to_copilot_tool("greet", _host(tmp_path))

        result = await tool.handler(_invoke("greet", {"nmae": "World"}))

        data = json.loads(result.text_result_for_llm)
        assert data["error"] == "VALIDATION_ERROR"
        assert "name" in data["suggestion"]

    @pytest.mark.asyncio
    async def test_call_runs_as_an_agent(self, tmp_path):
        from botcore.context import current_call

        seen = []

        async def who() -> CommandResult[dict]:
            """Report the caller."""
            seen.append(current_call().actor.kind)
            return success(data={})

        host = _host(tmp_path)
        host.register("who", who, CommandPolicy())
        tool = botcore_command_to_copilot_tool("who", host)

        await tool.handler(_invoke("who", None))

        assert seen == ["agent"]

    @pytest.mark.asyncio
    async def test_host_naming_a_human_keeps_the_agent_as_caller(self, tmp_path):
        from afd import Actor
        from botcore.context import current_call

        seen = []

        async def who() -> CommandResult[dict]:
            """Report the caller."""
            actor = current_call().actor
            seen.append((actor.kind, actor.on_behalf_of))
            return success(data={})

        host = _host(tmp_path)
        host.actor = Actor(kind="human", id="owner")
        host.register("who", who, CommandPolicy())
        tool = botcore_command_to_copilot_tool("who", host)

        await tool.handler(_invoke("who", None))

        assert seen == [("agent", "owner")]

    @pytest.mark.parametrize(
        ("host_actor", "expected"),
        [
            (None, ("agent", "researcher", None)),
            ({"kind": "agent"}, ("agent", "researcher", None)),
            ({"kind": "agent", "id": "lane"}, ("agent", "lane", None)),
            ({"kind": "human", "id": "owner"}, ("agent", "researcher", "owner")),
        ],
    )
    @pytest.mark.asyncio
    async def test_agent_name_is_the_caller_id_where_the_host_gives_none(
        self, tmp_path, host_actor, expected
    ):
        from afd import Actor
        from botcore.context import current_call

        seen = []

        async def who() -> CommandResult[dict]:
            """Report the caller."""
            actor = current_call().actor
            seen.append((actor.kind, actor.id, actor.on_behalf_of))
            return success(data={})

        host = _host(tmp_path)
        host.actor = Actor(**host_actor) if host_actor else None
        host.register("who", who, CommandPolicy())
        (tool,) = bridge_commands(["who"], host, agent_name="researcher")

        await tool.handler(_invoke("who", None))

        assert seen == [expected]

    @pytest.mark.parametrize(
        "actor",
        [
            {"kind": "service", "id": "ci"},
            {"kind": "human"},
            {"kind": "script", "id": "cron"},
        ],
    )
    def test_host_naming_no_one_a_model_can_act_for_is_refused(self, tmp_path, actor):
        from afd import Actor

        from botcore_llm.bridge import HostActorRefused

        host = _host(tmp_path)
        host.actor = Actor(**actor)
        with pytest.raises(HostActorRefused, match=actor["kind"]) as caught:
            botcore_command_to_copilot_tool("greet", host)
        assert "human actor with an id" in caught.value.suggestion

    @pytest.mark.asyncio
    async def test_non_object_arguments_reach_host_validation(self, tmp_path):
        tool = botcore_command_to_copilot_tool("no_args_command", _host(tmp_path))

        for arguments in ([], "", 0, False, ["x"]):
            result = await tool.handler(_invoke("no_args_command", arguments))
            data = json.loads(result.text_result_for_llm)
            assert data.get("error") == "VALIDATION_ERROR", arguments
        assert (await tool.handler(_invoke("no_args_command", None))).result_type == "success"


class TestBridgeCommands:
    def test_resolves_and_bridges(self, tmp_path):
        tools = bridge_commands(["greet"], _host(tmp_path))

        assert len(tools) == 1
        assert tools[0].name == "greet"

    def test_missing_command_raises(self, tmp_path):
        with pytest.raises(KeyError, match="nonexistent"):
            bridge_commands(["nonexistent"], _host(tmp_path))
