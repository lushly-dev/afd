"""Tests for LLM commands (with mocked Copilot client)."""

from __future__ import annotations

import json

import pytest
from afd import CommandResult, success
from afd.testing import assert_error, assert_success
from botcore.context import ExecutionContext
from botcore.host import CommandHost, CommandPolicy
from copilot import ToolInvocation

from botcore_llm.commands import (
    llm_chat,
    llm_model_list,
    llm_session_create,
    llm_session_destroy,
    llm_session_list,
    set_config,
    set_tool_host,
)
from botcore_llm.config import LlmConfig
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
