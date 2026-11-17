"""Resolving an agent's tools must not reset the orchestrator (lushly-dev/afd#780).

The first agent with connectors builds botcore's command namespace, which reads botcore.toml
and configures every discovered plugin again, this one included. Agents created before that
must still be there.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from afd.testing import assert_error, assert_success
from botcore.config import load_config

import botcore_agents.orchestrator as orch_mod
from botcore_agents import AgentsPlugin, commands

BOTCORE_TOML = """\
[plugins.agents]
default_model = "{model}"

[plugins.agents.agents.coder]
name = "coder"
role = "coder"
model = "{model}"

[plugins.agents.agents.lister]
name = "lister"
role = "researcher"
model = "{model}"
connector_commands = ["agent_status"]
"""


@pytest.fixture()
def workspace(tmp_path, monkeypatch):
    """A workspace whose botcore.toml configures two agents; one bridges a command."""
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "fixture"\n', encoding="utf-8")
    (tmp_path / "botcore.toml").write_text(BOTCORE_TOML.format(model="test-model"), "utf-8")
    monkeypatch.chdir(tmp_path)
    orch_mod._namespace = None  # Not pre-set: the first connector agent builds it.
    plugins = {"agents": AgentsPlugin()}
    with patch("botcore.server.discover_plugins", return_value=plugins):
        yield tmp_path, plugins
    orch_mod._namespace = None
    commands.set_config(None)


async def test_resolving_tools_keeps_the_agents_already_created(workspace, mock_llm_session_create):
    root, plugins = workspace
    # As a server starts: the plugin is configured from botcore.toml once.
    commands.set_config(load_config(root, discovered_plugins=plugins).plugins["agents"])
    assert_success(await commands.agent_create("coder"))
    assert_success(await commands.agent_create("lister"))
    # Starting lister builds the namespace, which reads botcore.toml and configures again.
    assert_success(await commands.agent_start("lister"))
    assert orch_mod._namespace is not None

    assert_success(await commands.agent_status("coder"))
    assert assert_success(await commands.agent_status("lister"))["status"] != "stopped"


async def test_a_changed_botcore_toml_still_starts_a_new_orchestrator(workspace, caplog):
    root, plugins = workspace
    commands.set_config(load_config(root, discovered_plugins=plugins).plugins["agents"])
    assert_success(await commands.agent_create("coder"))
    (root / "botcore.toml").write_text(BOTCORE_TOML.format(model="other-model"), "utf-8")
    with caplog.at_level("INFO", logger="botcore_agents.commands"):
        commands.set_config(load_config(root, discovered_plugins=plugins).plugins["agents"])
    assert_error(await commands.agent_status("coder"), "AGENT_NOT_FOUND")
    assert "drops 1 agent(s): coder" in caplog.text
