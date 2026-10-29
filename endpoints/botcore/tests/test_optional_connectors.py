"""Bounded optional-agents connector fixture without a live LLM runtime."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import AsyncMock, patch


async def test_requested_wildcard_without_optional_connectors_is_actionable():
    package = ModuleType("botcore_agents")
    package.__path__ = [
        str(Path(__file__).resolve().parents[1] / "packages/botcore-agents/src/botcore_agents")
    ]
    llm_package = ModuleType("botcore_llm")
    llm_package.__path__ = [
        str(Path(__file__).resolve().parents[1] / "packages/botcore-llm/src/botcore_llm")
    ]
    llm = ModuleType("botcore_llm.commands")
    llm.llm_session_create = AsyncMock()
    llm.llm_session_destroy = AsyncMock()
    # Only the session boundary is mocked. Actual plugin config/models/orchestrator run.
    with patch.dict(
        sys.modules,
        {
            "botcore_agents": package,
            "botcore_llm": llm_package,
            "botcore_llm.commands": llm,
            "botcore_connectors": None,
            "botcore_connectors.config": None,
        },
    ):
        config = importlib.import_module("botcore_agents.config")
        runtime = importlib.import_module("botcore_agents.orchestrator")
        runtime._namespace = {"github_issue_list": lambda: None}
        agent_config = config.AgentsPluginConfig(
            agents={"fixture": config.AgentConfig(name="fixture", model="test", connectors=["*"])},
            default_model="test",
        )
        orchestrator = runtime.AgentOrchestrator(agent_config)
        assert (await orchestrator.create_agent("fixture")).success
        rejected = await orchestrator.start_agent("fixture")
        assert not rejected.success
        assert rejected.error.code == "INTEGRATION_UNAVAILABLE"
        assert "botcore-agents[connectors]" in rejected.error.suggestion
        llm.llm_session_create.assert_not_awaited()
        assert orchestrator.agents["fixture"].health.status == "stopped"
        # Named prefixes and explicit custom commands require no optional discovery adapter.
        assert runtime.resolve_connector_commands(["github"], [], runtime._namespace) == [
            "github_issue_list"
        ]
        assert runtime.resolve_connector_commands([], ["custom"], {"custom": object()}) == [
            "custom"
        ]
