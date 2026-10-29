"""Integration test fixtures — wires real Copilot SDK for live LLM tests.

Scenarios are split into two tiers:
  - ``mock``: Fast tests using mocked LLM (no network, CI-safe)
  - ``live``: Real Copilot CLI calls (requires auth, tagged 'live')

Use ``pytest -m live`` or ``pytest -m "not live"`` to filter.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from afd import success
from botcore_agents.config import AgentConfig, AgentsPluginConfig
from botcore_agents.orchestrator import AgentOrchestrator, reset_orchestrator
from botcore_llm.client import CopilotClientManager
from botcore_llm.commands import set_config as set_llm_config
from botcore_llm.config import LlmConfig
from botcore_memory.access import current_agent
from botcore_memory.commands import configure as configure_memory
from botcore_memory.commands import reset as reset_memory
from botcore_memory.models import MemoryConfig

SCENARIOS_DIR = Path(__file__).parent / "scenarios"


# ---------------------------------------------------------------------------
# Markers
# ---------------------------------------------------------------------------


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "live: requires Copilot CLI (real LLM)")


# ---------------------------------------------------------------------------
# Agent config shared across tests
# ---------------------------------------------------------------------------

AGENT_MODEL = "claude-sonnet-4.5"


@pytest.fixture()
def agent_config() -> AgentsPluginConfig:
    """Standard two-agent config for integration tests."""
    return AgentsPluginConfig(
        agents={
            "researcher": AgentConfig(
                name="researcher",
                model=AGENT_MODEL,
                skills=[],
                max_concurrent_tasks=2,
                system_prompt=(
                    "You are a research agent. Follow instructions precisely. "
                    "When asked to reply with exact text, do so without extra commentary."
                ),
            ),
            "coder": AgentConfig(
                name="coder",
                model=AGENT_MODEL,
                skills=[],
                max_concurrent_tasks=1,
                system_prompt="You are a coding agent. Be concise.",
            ),
        },
        default_model=AGENT_MODEL,
        max_agents=5,
    )


# ---------------------------------------------------------------------------
# LLM config
# ---------------------------------------------------------------------------


@pytest.fixture()
def llm_config() -> LlmConfig:
    """LLM config pointing at real Copilot CLI via stdio."""
    return LlmConfig(
        default_model=AGENT_MODEL,
        cli_url="",
        streaming=True,
        infinite_sessions=False,  # Keep sessions short for tests
    )


# ---------------------------------------------------------------------------
# Memory config (temp dir)
# ---------------------------------------------------------------------------


@pytest.fixture()
def memory_config(tmp_path: Path) -> MemoryConfig:
    return MemoryConfig(local_path=str(tmp_path))


# ---------------------------------------------------------------------------
# Orchestrator (real or mock LLM depending on marker)
# ---------------------------------------------------------------------------


@pytest.fixture()
def orchestrator(agent_config: AgentsPluginConfig) -> AgentOrchestrator:
    return AgentOrchestrator(agent_config)


@pytest.fixture(autouse=True)
def _clean_orchestrator():
    """Reset orchestrator singleton between tests."""
    reset_orchestrator()
    yield
    reset_orchestrator()


@pytest.fixture(autouse=True)
def _clean_llm_client():
    """Shut down the Copilot client singleton after each test."""
    yield
    import asyncio

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(CopilotClientManager.shutdown())
        else:
            loop.run_until_complete(CopilotClientManager.shutdown())
    except Exception:
        CopilotClientManager._instance = None


@pytest.fixture(autouse=True)
def _setup_memory(memory_config: MemoryConfig):
    """Configure memory with a temp store and set default agent."""
    configure_memory(memory_config)
    token = current_agent.set("researcher")
    yield
    current_agent.reset(token)
    reset_memory()


@pytest.fixture()
def setup_llm(llm_config: LlmConfig):
    """Inject real LLM config into the commands module."""
    set_llm_config(llm_config)
    yield


# ---------------------------------------------------------------------------
# Mock LLM fixtures (for fast 'mock' scenarios)
# ---------------------------------------------------------------------------


def _fake_chat_stream(mock_chat: AsyncMock):
    """An llm_chat_stream stand-in that streams the CommandResult *mock_chat* returns."""
    from afd.core.errors import CommandError
    from afd.core.streaming import (
        create_complete_chunk,
        create_data_chunk,
        create_error_chunk,
    )

    async def fake(session_id, message, attachments=None, timeout=None):
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

    return fake


@pytest.fixture()
def mock_llm():
    """Patch all LLM commands with fast mocks — no Copilot CLI needed."""
    mock_chat = AsyncMock()
    with (
        patch(
            "botcore_agents.orchestrator.llm_session_create",
            new_callable=AsyncMock,
        ) as mock_create,
        patch(
            "botcore_agents.orchestrator.llm_session_destroy",
            new_callable=AsyncMock,
        ) as mock_destroy,
        patch("botcore_agents.task_stream.llm_chat_stream", _fake_chat_stream(mock_chat)),
    ):
        mock_create.return_value = success(
            data={
                "session_id": "mock-session-001",
                "model": AGENT_MODEL,
                "tools": [],
            },
            reasoning="Mock session created",
        )
        mock_destroy.return_value = success(
            data={"session_id": "mock-session-001", "status": "destroyed"},
            reasoning="Mock session destroyed",
        )
        mock_chat.return_value = success(
            data={
                "session_id": "mock-session-001",
                "message_id": "msg-001",
                "content": "Task completed successfully",
            },
            reasoning="Mock chat response",
        )
        yield {
            "session_create": mock_create,
            "session_destroy": mock_destroy,
            "chat": mock_chat,
        }


# ---------------------------------------------------------------------------
# Command dispatcher for scenario executor
# ---------------------------------------------------------------------------


def build_command_handler(
    orchestrator: AgentOrchestrator,
    agent_name: str = "researcher",
):
    """Build a command handler that routes scenario steps to real commands.

    Returns a callable ``async (command, input) -> dict`` compatible
    with AFD's InProcessExecutor.
    """

    async def handler(command: str, input_data: dict[str, Any] | None) -> dict[str, Any]:
        args = input_data or {}

        # Agent lifecycle commands
        if command == "agent_create":
            result = await orchestrator.create_agent(args["name"])
        elif command == "agent_start":
            result = await orchestrator.start_agent(args["name"])
        elif command == "agent_stop":
            result = await orchestrator.stop_agent(args["name"])
        elif command == "agent_status":
            result = orchestrator.get_agent_status(args["name"])
        elif command == "agent_heartbeat":
            result = orchestrator.heartbeat(args["name"])

        # Task commands
        elif command == "task_assign":
            result = await orchestrator.assign_task(
                description=args["description"],
                agent=args["agent"],
                priority=args.get("priority", 5),
            )
        elif command == "task_status":
            result = orchestrator.get_task(args["task_id"])

        # Memory commands
        elif command == "memory_set":
            from botcore_memory.commands import memory_set

            result = await memory_set(**args)
        elif command == "memory_get":
            from botcore_memory.commands import memory_get

            result = await memory_get(**args)
        elif command == "memory_search":
            from botcore_memory.commands import memory_search

            result = await memory_search(**args)
        elif command == "memory_delete":
            from botcore_memory.commands import memory_delete

            result = await memory_delete(**args)
        elif command == "memory_list":
            from botcore_memory.commands import memory_list

            result = await memory_list(**args)

        else:
            raise ValueError(f"Unknown command: {command}")

        # Convert CommandResult to dict for the evaluator
        out: dict[str, Any] = {"success": result.success}
        if result.success:
            out["data"] = result.data
        else:
            out["error"] = {
                "code": result.error.code,
                "message": result.error.message,
            }
        if hasattr(result, "reasoning") and result.reasoning:
            out["reasoning"] = result.reasoning
        return out

    return handler
