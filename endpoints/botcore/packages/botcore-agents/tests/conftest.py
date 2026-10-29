"""Shared test fixtures for botcore-agents."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from botcore_agents.config import AgentConfig, AgentsPluginConfig
from botcore_agents.orchestrator import AgentOrchestrator, reset_orchestrator

# ---------------------------------------------------------------------------
# Lightweight stubs — avoid importing copilot at collection time
# ---------------------------------------------------------------------------


@dataclass
class _MockEventData:
    content: str = "Task completed successfully"
    message_id: str = "msg-001"


@dataclass
class _MockSessionEvent:
    data: Any = None
    id: Any = None
    timestamp: Any = None
    type: Any = None


# ---------------------------------------------------------------------------
# Config fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def sample_agent_config() -> AgentConfig:
    return AgentConfig(
        name="researcher",
        role="researcher",
        model="test-model",
        skills=["dev_test", "dev_lint"],
        max_concurrent_tasks=2,
        system_prompt="You are a research agent.",
    )


@pytest.fixture()
def sample_config(sample_agent_config: AgentConfig) -> AgentsPluginConfig:
    return AgentsPluginConfig(
        agents={
            "researcher": sample_agent_config,
            "coder": AgentConfig(
                name="coder",
                role="coder",
                model="test-model",
                skills=["dev_build"],
                max_concurrent_tasks=1,
            ),
        },
        default_model="test-model",
        max_agents=5,
    )


# ---------------------------------------------------------------------------
# Mock LLM fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_session_event() -> _MockSessionEvent:
    return _MockSessionEvent(data=_MockEventData())


@pytest.fixture()
def mock_llm_session_create():
    """Patch llm_session_create to return a fake session."""
    with patch(
        "botcore_agents.orchestrator.llm_session_create",
        new_callable=AsyncMock,
    ) as mock_create:
        from afd import success

        mock_create.return_value = success(
            data={
                "session_id": "session-agent-001",
                "model": "test-model",
                "tools": [],
            },
            reasoning="Mock session created",
        )
        yield mock_create


@pytest.fixture()
def mock_llm_session_destroy():
    """Patch llm_session_destroy."""
    with patch(
        "botcore_agents.orchestrator.llm_session_destroy",
        new_callable=AsyncMock,
    ) as mock_destroy:
        from afd import success

        mock_destroy.return_value = success(
            data={"session_id": "session-agent-001", "status": "destroyed"},
            reasoning="Mock session destroyed",
        )
        yield mock_destroy


@pytest.fixture()
def mock_llm_chat():
    """Patch the agent's chat stream with one built from a mock llm_chat.

    Tests set ``return_value`` (a CommandResult) on the returned AsyncMock; the
    fake stream turns it into progress, one data chunk, and a terminal chunk.
    """
    from afd import success
    from afd.core.errors import CommandError
    from afd.core.streaming import (
        create_complete_chunk,
        create_data_chunk,
        create_error_chunk,
        create_progress_chunk,
    )

    mock_chat = AsyncMock()
    mock_chat.return_value = success(
        data={
            "session_id": "session-agent-001",
            "message_id": "msg-001",
            "content": "Task completed successfully",
        },
        reasoning="Mock chat response",
    )

    async def fake_stream(session_id, message, attachments=None, timeout=None):
        yield create_progress_chunk(0.0, message="Message sent", phase="send")
        result = await mock_chat(session_id=session_id, message=message)
        if not result.success:
            err = result.error
            yield create_error_chunk(
                CommandError(code=err.code, message=err.message, suggestion=err.suggestion),
                chunks_before_error=0,
            )
            return
        data = {"text": result.data["content"], "message_id": result.data["message_id"]}
        yield create_data_chunk(data, index=0, is_last=True)
        yield create_complete_chunk(total_chunks=1, total_duration_ms=0, data=result.data)

    with patch("botcore_agents.task_stream.llm_chat_stream", fake_stream):
        yield mock_chat


@pytest.fixture()
def mock_llm(mock_llm_session_create, mock_llm_session_destroy, mock_llm_chat):
    """Convenience fixture that patches all LLM commands."""
    return {
        "session_create": mock_llm_session_create,
        "session_destroy": mock_llm_session_destroy,
        "chat": mock_llm_chat,
    }


# ---------------------------------------------------------------------------
# Orchestrator fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def orchestrator(sample_config: AgentsPluginConfig) -> AgentOrchestrator:
    """Fresh orchestrator for each test."""
    return AgentOrchestrator(sample_config)


@pytest.fixture()
def sample_config_with_connectors() -> AgentsPluginConfig:
    """Config with agents that have connectors set, for capability tests."""
    return AgentsPluginConfig(
        agents={
            "researcher": AgentConfig(
                name="researcher",
                role="researcher",
                model="test-model",
                skills=["dev_test", "dev_lint"],
                connectors=["github"],
                max_concurrent_tasks=2,
                system_prompt="You are a research agent.",
            ),
            "admin": AgentConfig(
                name="admin",
                role="admin",
                model="test-model",
                skills=["dev_build"],
                connectors=["*"],
                max_concurrent_tasks=1,
            ),
            "scoped": AgentConfig(
                name="scoped",
                role="scoped",
                model="test-model",
                skills=["dev_test"],
                connector_commands=["github_issue_list"],
                max_concurrent_tasks=1,
            ),
            "locked": AgentConfig(
                name="locked",
                role="locked",
                model="test-model",
                skills=["dev_test"],
                max_concurrent_tasks=1,
            ),
        },
        default_model="test-model",
        max_agents=10,
    )


@pytest.fixture()
def connector_orchestrator(sample_config_with_connectors: AgentsPluginConfig) -> AgentOrchestrator:
    """Orchestrator pre-loaded with connector-aware agent configs."""
    return AgentOrchestrator(sample_config_with_connectors)


@pytest.fixture(autouse=True)
def _clean_orchestrator():
    """Reset the module-level singleton and namespace cache between tests."""
    import botcore_agents.orchestrator as _orch_mod

    _orch_mod._namespace = None
    reset_orchestrator()
    yield
    _orch_mod._namespace = None
    reset_orchestrator()
