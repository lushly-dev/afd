"""Resolving an agent's tools must not reset the orchestrator (lushly-dev/afd#780).

The first agent with connectors builds botcore's command namespace, which configures every
discovered plugin again, this one included. Agents created before that must still be there.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from afd.testing import assert_error, assert_success

import botcore_agents.orchestrator as orch_mod
from botcore_agents import AgentsPlugin, commands
from botcore_agents.config import AgentConfig, AgentsPluginConfig


def _config(model: str = "test-model") -> AgentsPluginConfig:
    return AgentsPluginConfig(
        agents={
            "coder": AgentConfig(name="coder", role="coder", model=model),
            "lister": AgentConfig(
                name="lister",
                role="researcher",
                model=model,
                connector_commands=["agent_status"],
            ),
        },
        default_model=model,
    )


@pytest.fixture(autouse=True)
def _fresh():
    orch_mod._namespace = None  # Not pre-set: the first connector agent builds it.
    yield
    orch_mod._namespace = None
    commands.set_config(None)


async def test_resolving_tools_keeps_the_agents_already_created(mock_llm_session_create):
    commands.set_config(_config())
    # botcore.toml read again, as build_namespace reads it: an equal, separate configuration.
    loaded = SimpleNamespace(plugins={"agents": _config()})
    with (
        patch("botcore.server.discover_plugins", return_value={"agents": AgentsPlugin()}),
        patch("botcore.server.load_config", return_value=loaded),
    ):
        assert_success(await commands.agent_create("coder"))
        assert_success(await commands.agent_create("lister"))
        assert_success(await commands.agent_start("lister"))
        assert orch_mod._namespace is not None

    assert_success(await commands.agent_status("coder"))
    assert assert_success(await commands.agent_status("lister"))["status"] != "stopped"


async def test_a_different_configuration_still_starts_a_new_orchestrator():
    commands.set_config(_config())
    assert_success(await commands.agent_create("coder"))
    commands.set_config(_config(model="other-model"))
    assert_error(await commands.agent_status("coder"), "AGENT_NOT_FOUND")
