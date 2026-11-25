"""An agent with connectors gets its connector tools from a policy-checked host.

Uses the real connectors plugin (``botcore-connectors``) as the tool host discovers it
when installed, and the real ``llm_session_create`` with a mocked Copilot client.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import botcore.plugin
import botcore_llm.commands as llm_commands
import pytest
from afd.testing import assert_success
from botcore_connectors.plugin import ConnectorsPlugin
from botcore_llm.config import LlmConfig
from copilot import ToolInvocation

import botcore_agents.orchestrator as orch_mod
from botcore_agents.orchestrator import AgentOrchestrator

PYPROJECT = """\
[project]
name = "demo"

[tool.botcore.plugins.connectors]
enabled = ["github"]

[tool.botcore.plugins.connectors.github]
default_repo = "octo/demo"
"""


@pytest.fixture()
def workspace(tmp_path, monkeypatch):
    """A workspace configuring the GitHub connector, with no credential to find."""
    (tmp_path / "pyproject.toml").write_text(PYPROJECT)
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.setenv("PATH", str(tmp_path))  # No gh on PATH either; connectors never run it.
    return tmp_path


@pytest.fixture()
def installed_connectors(monkeypatch):
    """Discover the connectors plugin as an installed entry point would provide it.

    Returns the plugin instances discovered, so a test can see what a host held.
    """
    real = botcore.plugin.discover_plugins
    discovered: list[ConnectorsPlugin] = []

    def discover(allowlist=None):
        if allowlist is not None and "connectors" in allowlist:
            others = tuple(name for name in allowlist if name != "connectors")
            discovered.append(ConnectorsPlugin())
            return {**(real(others) if others else {}), "connectors": discovered[-1]}
        return real(allowlist)

    monkeypatch.setattr(botcore.plugin, "discover_plugins", discover)
    monkeypatch.setattr(llm_commands, "_installed_plugin_names", lambda: {"connectors"})
    return discovered


@pytest.fixture()
def copilot_client():
    session = AsyncMock()
    session.session_id = "session-connector-001"
    session.on = MagicMock(return_value=lambda: None)
    client = AsyncMock()
    client.create_session = AsyncMock(return_value=session)
    with patch(
        "botcore_llm.commands.CopilotClientManager.get_client",
        new_callable=AsyncMock,
        return_value=client,
    ):
        yield client


@pytest.fixture(autouse=True)
def _llm_config():
    llm_commands.set_tool_host(None)
    yield
    llm_commands.set_config(LlmConfig())
    llm_commands.set_tool_host(None)


async def _start_and_call(orchestrator: AgentOrchestrator, client, tool_name: str) -> dict:
    orch_mod._namespace = {"github_issue_list": None, "github_issue_create": None}
    await orchestrator.create_agent("researcher")
    assert_success(await orchestrator.start_agent("researcher"))

    tools = {tool.name: tool for tool in client.create_session.call_args.kwargs["tools"]}
    assert set(tools) == {"github_issue_list", "github_issue_create"}
    invocation = ToolInvocation(
        session_id="s1", tool_call_id="tc1", tool_name=tool_name, arguments={}
    )
    result = await tools[tool_name].handler(invocation)
    return {"type": result.result_type, **json.loads(result.text_result_for_llm)}


async def test_connector_tool_call_the_default_profile_refuses_is_refused(
    workspace, installed_connectors, copilot_client, connector_orchestrator
):
    llm_commands.set_config(LlmConfig(default_model="test-model"))

    outcome = await _start_and_call(connector_orchestrator, copilot_client, "github_issue_list")

    assert outcome["type"] == "failure"
    assert outcome["error"] == "EFFECT_DENIED"
    assert "inspection" in outcome["message"]
    assert outcome["suggestion"]


@pytest.mark.parametrize("profile", ["remote-caller", "trusted-local"])
async def test_connector_tool_call_a_host_that_admits_services_reaches_the_connector(
    workspace, installed_connectors, copilot_client, connector_orchestrator, profile
):
    """Connector commands declare only ``service``: a remote-caller host runs them too."""
    llm_commands.set_config(LlmConfig(default_model="test-model", tool_profile=profile))

    outcome = await _start_and_call(connector_orchestrator, copilot_client, "github_issue_list")

    # Admitted by policy, the call ran the connector, which found no credential.
    assert outcome["error"] == "GITHUB_AUTH_MISSING"


async def test_stopping_the_agent_closes_its_connector_clients(
    workspace, installed_connectors, copilot_client, connector_orchestrator
):
    llm_commands.set_config(LlmConfig(default_model="test-model"))
    await _start_and_call(connector_orchestrator, copilot_client, "github_issue_list")
    (plugin,) = installed_connectors
    assert plugin._connectors  # The GitHub connector and its HTTP client are open.

    assert_success(await connector_orchestrator.stop_agent("researcher"))

    assert plugin._connectors == {}
