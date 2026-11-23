"""Tests for LLM commands (with mocked Copilot client)."""

from __future__ import annotations

import json

import pytest
from afd import CommandResult, success
from afd.testing import assert_error, assert_success
from botcore.context import ExecutionContext
from botcore.host import CommandHost, CommandPolicy
from copilot import ToolInvocation

import botcore_llm.commands as llm_commands
from botcore_llm.commands import (
    llm_chat,
    llm_model_list,
    llm_session_create,
    llm_session_destroy,
    llm_session_list,
    set_config,
    set_tool_host,
)
from botcore_llm.config import LlmConfig, LlmPermissionsConfig
from botcore_llm.session import get_session_registry


@pytest.fixture(autouse=True)
def _clean_registry():
    """Ensure a clean session registry for each test."""
    registry = get_session_registry()
    registry._sessions.clear()
    yield
    registry._sessions.clear()


@pytest.fixture(autouse=True)
def _default_model():
    """Configure a placeholder default model; the real config has none."""
    set_config(LlmConfig(default_model="test-model"))
    yield
    set_config(LlmConfig())


class TestLlmSessionCreate:
    @pytest.mark.asyncio
    async def test_returns_session_id(self, patch_client_manager, mock_copilot_session):
        result = await llm_session_create(model="test-model")

        data = assert_success(result)
        assert data["session_id"] == mock_copilot_session.session_id
        assert data["model"] == "test-model"

    @pytest.mark.asyncio
    async def test_registers_in_session_registry(self, patch_client_manager, mock_copilot_session):
        await llm_session_create()

        registry = get_session_registry()
        entry = registry.get(mock_copilot_session.session_id)
        assert entry is not None
        assert entry.model == "test-model"

    @pytest.mark.asyncio
    async def test_uses_config_default_model(self, patch_client_manager, mock_copilot_session):
        set_config(LlmConfig(default_model="test-model-alt"))
        try:
            result = await llm_session_create()

            data = assert_success(result)
            assert data["model"] == "test-model-alt"
        finally:
            set_config(LlmConfig())  # reset

    @pytest.mark.asyncio
    async def test_errors_when_no_model_configured(self, patch_client_manager, mock_copilot_client):
        set_config(LlmConfig())

        result = await llm_session_create()

        err = assert_error(result, "CONFIG_ERROR")
        assert "[tool.botcore.plugins.llm] default_model" in err.message
        assert "llm_model_list" in err.suggestion
        mock_copilot_client.create_session.assert_not_awaited()
        assert get_session_registry().list_all() == []

    @pytest.mark.asyncio
    async def test_errors_when_default_model_blank(self, patch_client_manager):
        set_config(LlmConfig(default_model="   "))

        result = await llm_session_create()

        assert_error(result, "CONFIG_ERROR")

    @pytest.mark.asyncio
    async def test_blank_explicit_model_falls_back_to_default(
        self, patch_client_manager, mock_copilot_session
    ):
        result = await llm_session_create(model="  ")

        data = assert_success(result)
        assert data["model"] == "test-model"

    @pytest.mark.asyncio
    async def test_explicit_model_works_without_default(
        self, patch_client_manager, mock_copilot_session
    ):
        set_config(LlmConfig())

        result = await llm_session_create(model="test-model-alt")

        data = assert_success(result)
        assert data["model"] == "test-model-alt"

    @pytest.mark.asyncio
    async def test_passes_session_config_as_keywords(
        self, patch_client_manager, mock_copilot_client
    ):
        """SDK 1.0.26 ``create_session`` is keyword-only."""
        await llm_session_create(system_prompt="Be terse", streaming=False)

        call = mock_copilot_client.create_session.call_args
        assert call.args == ()
        assert call.kwargs["model"] == "test-model"
        assert call.kwargs["streaming"] is False
        assert call.kwargs["system_message"] == {"mode": "append", "content": "Be terse"}
        assert callable(call.kwargs["on_permission_request"])


class TestLlmSessionDestroy:
    @pytest.mark.asyncio
    async def test_destroys_session(self, patch_client_manager, mock_copilot_session):
        await llm_session_create()

        result = await llm_session_destroy(mock_copilot_session.session_id)

        data = assert_success(result)
        assert data["status"] == "destroyed"
        mock_copilot_session.disconnect.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_removes_from_registry(self, patch_client_manager, mock_copilot_session):
        await llm_session_create()
        await llm_session_destroy(mock_copilot_session.session_id)

        registry = get_session_registry()
        assert registry.get(mock_copilot_session.session_id) is None

    @pytest.mark.asyncio
    async def test_nonexistent_session_returns_error(self, patch_client_manager):
        result = await llm_session_destroy("no-such-session")

        assert_error(result, "SESSION_NOT_FOUND")


class TestLlmSessionList:
    @pytest.mark.asyncio
    async def test_returns_registered_sessions(self, patch_client_manager, mock_copilot_session):
        await llm_session_create(model="test-model")

        result = await llm_session_list()

        data = assert_success(result)
        assert len(data) == 1
        assert data[0]["session_id"] == mock_copilot_session.session_id

    @pytest.mark.asyncio
    async def test_empty_when_no_sessions(self, patch_client_manager):
        result = await llm_session_list()

        assert_success(result) == []


class TestLlmModelList:
    @pytest.mark.asyncio
    async def test_returns_model_info(self, patch_client_manager, mock_copilot_client):
        result = await llm_model_list()

        data = assert_success(result)
        assert len(data) == 1
        assert data[0]["id"] == "test-model"
        assert data[0]["supports_vision"] is True


class TestLlmChat:
    @pytest.mark.asyncio
    async def test_returns_assistant_response(self, patch_client_manager, mock_copilot_session):
        await llm_session_create()

        result = await llm_chat(
            session_id=mock_copilot_session.session_id,
            message="What is 2+2?",
        )

        data = assert_success(result)
        assert data["content"] == "Hello from the assistant"
        assert data["session_id"] == mock_copilot_session.session_id

    @pytest.mark.asyncio
    async def test_invalid_session_returns_error(self, patch_client_manager):
        result = await llm_chat(session_id="bad-id", message="hi")

        assert_error(result, "SESSION_NOT_FOUND")

    @pytest.mark.asyncio
    async def test_passes_attachments(self, patch_client_manager, mock_copilot_session):
        await llm_session_create()

        attachments = [{"type": "file", "path": "/tmp/test.txt", "displayName": "test.txt"}]
        await llm_chat(
            session_id=mock_copilot_session.session_id,
            message="Read this",
            attachments=attachments,
        )

        call_kwargs = mock_copilot_session.send_and_wait.call_args.kwargs
        assert call_kwargs["attachments"] == attachments

    @pytest.mark.asyncio
    async def test_sends_prompt_without_timeout_by_default(
        self, patch_client_manager, mock_copilot_session
    ):
        """The SDK takes the prompt positionally and rejects ``timeout=None``."""
        await llm_session_create()

        await llm_chat(session_id=mock_copilot_session.session_id, message="hi")

        call = mock_copilot_session.send_and_wait.call_args
        assert call.args == ("hi",)
        assert "timeout" not in call.kwargs

    @pytest.mark.asyncio
    async def test_passes_timeout(self, patch_client_manager, mock_copilot_session):
        await llm_session_create()

        await llm_chat(session_id=mock_copilot_session.session_id, message="hi", timeout=5.0)

        assert mock_copilot_session.send_and_wait.call_args.kwargs["timeout"] == 5.0


class TestLlmSessionCreateTools:
    """Bridged tools dispatch through a managed host, under its policy."""

    @pytest.fixture(autouse=True)
    def _reset_tool_host(self):
        set_tool_host(None)
        yield
        set_tool_host(None)

    @staticmethod
    def _tool(mock_copilot_client, name: str):
        tools = mock_copilot_client.create_session.call_args.kwargs["tools"]
        return next(tool for tool in tools if tool.name == name)

    @staticmethod
    async def _call(tool, arguments: dict | None = None) -> dict:
        invocation = ToolInvocation(
            session_id="s1", tool_call_id="tc1", tool_name=tool.name, arguments=arguments
        )
        result = await tool.handler(invocation)
        return {"type": result.result_type, **json.loads(result.text_result_for_llm)}

    @pytest.mark.asyncio
    async def test_tool_call_the_host_policy_refuses_is_refused(
        self, patch_client_manager, mock_copilot_client, tmp_path
    ):
        calls: list[str] = []

        async def write_note(text: str) -> CommandResult[dict]:
            """Write a note."""
            calls.append(text)
            return success(data={})

        host = CommandHost("lane", ExecutionContext(tmp_path, profile="inspection"))
        host.register("write_note", write_note, CommandPolicy(("source-write",)))
        set_tool_host(host)

        assert_success(await llm_session_create(tools=["write_note"]))
        outcome = await self._call(self._tool(mock_copilot_client, "write_note"), {"text": "x"})

        assert outcome["type"] == "failure"
        assert outcome["error"] == "EFFECT_DENIED"
        assert outcome["suggestion"]
        assert calls == []

    @pytest.mark.asyncio
    async def test_tool_calls_run_as_the_named_agent(
        self, patch_client_manager, mock_copilot_client, tmp_path
    ):
        from botcore.context import current_call

        async def who() -> CommandResult[dict]:
            """Name the caller."""
            actor = current_call().actor
            return success(data={"kind": actor.kind, "id": actor.id})

        host = CommandHost("lane", ExecutionContext(tmp_path, profile="inspection"))
        host.register("who", who, CommandPolicy())
        set_tool_host(host)

        assert_success(await llm_session_create(tools=["who"], agent_name="researcher"))
        outcome = await self._call(self._tool(mock_copilot_client, "who"))

        assert outcome == {"type": "success", "kind": "agent", "id": "researcher"}

    @pytest.mark.parametrize("outer", [{"kind": "service", "id": "remote"}, None])
    @pytest.mark.asyncio
    async def test_agent_name_is_only_a_label_inside_any_host_call(
        self, patch_client_manager, mock_copilot_client, tmp_path, outer
    ):
        from afd import Actor
        from afd.core.commands import CommandContext
        from botcore.context import current_call, use_call

        async def who() -> CommandResult[dict]:
            """Name the caller."""
            actor = current_call().actor
            return success(data={"kind": actor.kind, "id": actor.id})

        host = CommandHost("lane", ExecutionContext(tmp_path, profile="inspection"))
        host.register("who", who, CommandPolicy())
        set_tool_host(host)

        # A host call that names a caller, and one with no actor at all.
        with use_call(CommandContext(actor=Actor(**outer) if outer else None)):
            created = await llm_session_create(tools=["who"], agent_name="researcher")
        assert_success(created)
        outcome = await self._call(self._tool(mock_copilot_client, "who"))

        assert outcome == {"type": "success", "kind": "agent", "id": None}

    @pytest.mark.asyncio
    async def test_default_host_admits_inspection_and_refuses_writes(
        self, patch_client_manager, mock_copilot_client, tmp_path, monkeypatch
    ):
        (tmp_path / "pyproject.toml").write_text('[project]\nname = "demo"\n')
        monkeypatch.chdir(tmp_path)

        assert_success(await llm_session_create(tools=["info_workspace", "spec_create"]))
        allowed = await self._call(self._tool(mock_copilot_client, "info_workspace"))
        refused = await self._call(
            self._tool(mock_copilot_client, "spec_create"), {"path": "docs/features/demo"}
        )

        assert allowed["type"] == "success"
        assert refused["error"] == "EFFECT_DENIED"
        assert not (tmp_path / "docs").exists()

    @pytest.mark.asyncio
    async def test_command_the_host_does_not_serve_is_unknown(
        self, patch_client_manager, tmp_path, monkeypatch
    ):
        (tmp_path / "pyproject.toml").write_text('[project]\nname = "demo"\n')
        monkeypatch.chdir(tmp_path)

        result = await llm_session_create(tools=["llm_session_list"])

        assert_error(result, "UNKNOWN_COMMAND")
        assert "tool host" in result.error.suggestion

    @staticmethod
    def _lane_host(tmp_path) -> CommandHost:
        async def note() -> CommandResult[dict]:
            """Read a note."""
            return success(data={})

        host = CommandHost("lane", ExecutionContext(tmp_path))
        host.register("note", note, CommandPolicy())
        return host

    @pytest.mark.asyncio
    async def test_session_offers_only_bridged_and_permitted_tools(
        self, patch_client_manager, mock_copilot_client, tmp_path
    ):
        set_tool_host(self._lane_host(tmp_path))

        assert_success(await llm_session_create(tools=["note"]))
        available = mock_copilot_client.create_session.call_args.kwargs["available_tools"]

        assert "custom:note" in available
        assert "builtin:ask_user" in available
        # A runtime-provided MCP or custom tool, and shell or file built-ins, are hidden.
        for hidden in ("mcp:*", "custom:extra_tool", "builtin:bash", "builtin:view"):
            assert hidden not in available, hidden
        assert not any(entry.startswith("mcp:") for entry in available)

    @pytest.mark.asyncio
    async def test_named_mcp_servers_and_shell_widen_the_session_tools(
        self, patch_client_manager, mock_copilot_client
    ):
        permissions = LlmPermissionsConfig(allow_shell=True, mcp_servers=["github"])

        assert_success(await llm_session_create(permissions=permissions))
        available = mock_copilot_client.create_session.call_args.kwargs["available_tools"]

        assert "mcp:*" in available
        assert "builtin:bash" in available
        assert "builtin:view" not in available
        assert "builtin:apply_patch" not in available
        # No tool types input into a running process past the shell allowlist.
        assert "builtin:write_bash" not in available
        assert "builtin:write_powershell" not in available

    @pytest.mark.asyncio
    async def test_filesystem_offers_the_file_builtins_and_lsp_is_always_offered(
        self, patch_client_manager, mock_copilot_client
    ):
        assert_success(await llm_session_create())
        available = mock_copilot_client.create_session.call_args.kwargs["available_tools"]
        assert "builtin:lsp" in available
        assert "builtin:apply_patch" not in available

        permissions = LlmPermissionsConfig(allow_filesystem=True)
        assert_success(await llm_session_create(permissions=permissions))
        available = mock_copilot_client.create_session.call_args.kwargs["available_tools"]
        assert {"builtin:apply_patch", "builtin:view", "builtin:lsp"} <= set(available)

    @pytest.mark.asyncio
    async def test_host_with_a_service_actor_is_refused(
        self, patch_client_manager, mock_copilot_client, tmp_path
    ):
        from afd import Actor

        host = self._lane_host(tmp_path)
        host.actor = Actor(kind="service", id="ci")
        set_tool_host(host)

        result = await llm_session_create(tools=["note"])

        assert_error(result, "TOOL_HOST_ACTOR_REFUSED")
        assert "human actor with an id" in result.error.suggestion
        mock_copilot_client.create_session.assert_not_called()

    @pytest.mark.asyncio
    async def test_destroy_closes_the_tool_host_the_session_built(
        self, patch_client_manager, mock_copilot_session, tmp_path, monkeypatch
    ):
        closed: list[str] = []

        class _Plugin:
            async def close(self) -> None:
                closed.append("plugin")

        host = self._lane_host(tmp_path)
        host.plugins = {"fake": _Plugin()}
        monkeypatch.setattr(llm_commands, "_get_tool_host", lambda _config: (host, True))

        assert_success(await llm_session_create(tools=["note"]))
        assert closed == []
        assert_success(await llm_session_destroy(mock_copilot_session.session_id))

        assert closed == ["plugin"]

    @pytest.mark.asyncio
    async def test_destroy_leaves_a_supplied_host_open(
        self, patch_client_manager, mock_copilot_session, tmp_path
    ):
        closed: list[str] = []

        class _Plugin:
            async def close(self) -> None:
                closed.append("plugin")

        host = self._lane_host(tmp_path)
        host.plugins = {"fake": _Plugin()}
        set_tool_host(host)

        assert_success(await llm_session_create(tools=["note"]))
        assert_success(await llm_session_destroy(mock_copilot_session.session_id))

        assert closed == []
