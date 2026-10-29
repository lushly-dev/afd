"""Tests for agent configuration models."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from botcore_agents.config import (
    AgentConfig,
    AgentPermissionsConfig,
    AgentsPluginConfig,
    AgentsStateConfig,
    get_agents_config,
)


class TestAgentConfig:
    def test_defaults(self):
        cfg = AgentConfig()
        assert cfg.name == ""
        assert cfg.model == ""
        assert cfg.skills == []
        assert cfg.connectors == []
        assert cfg.memory_scope == "session"
        assert cfg.max_concurrent_tasks == 1
        assert cfg.heartbeat_interval == 30
        assert cfg.system_prompt == ""
        assert cfg.is_lead is False

    def test_valid_config(self):
        cfg = AgentConfig(
            name="researcher",
            model="test-model",
            skills=["dev_test", "dev_lint"],
            memory_scope="agent",
            max_concurrent_tasks=3,
            heartbeat_interval=60,
            system_prompt="You are a research agent.",
            is_lead=True,
        )
        assert cfg.name == "researcher"
        assert cfg.max_concurrent_tasks == 3
        assert cfg.is_lead is True

    def test_max_concurrent_tasks_bounds(self):
        with pytest.raises(ValidationError):
            AgentConfig(max_concurrent_tasks=0)
        with pytest.raises(ValidationError):
            AgentConfig(max_concurrent_tasks=11)

    def test_heartbeat_interval_bounds(self):
        with pytest.raises(ValidationError):
            AgentConfig(heartbeat_interval=4)
        with pytest.raises(ValidationError):
            AgentConfig(heartbeat_interval=301)

    def test_invalid_memory_scope(self):
        with pytest.raises(ValidationError):
            AgentConfig(memory_scope="invalid")

    def test_connector_commands_default(self):
        cfg = AgentConfig()
        assert cfg.connector_commands == []

    def test_connector_commands_set(self):
        cfg = AgentConfig(connector_commands=["github_issue_list", "github_pr_list"])
        assert cfg.connector_commands == ["github_issue_list", "github_pr_list"]

    def test_connectors_wildcard(self):
        cfg = AgentConfig(connectors=["*"])
        assert cfg.connectors == ["*"]

    def test_extra_fields_forbidden(self):
        with pytest.raises(ValidationError):
            AgentConfig(unknown_field="value")

    def test_permissions_default(self):
        cfg = AgentConfig()
        assert isinstance(cfg.permissions, AgentPermissionsConfig)
        assert cfg.permissions.allow_shell is False
        assert cfg.permissions.allow_filesystem is False
        assert cfg.permissions.allow_mcp is True
        assert cfg.permissions.allow_custom_tools is True
        assert cfg.permissions.shell_allowlist is None
        assert cfg.permissions.filesystem_paths is None

    def test_permissions_custom(self):
        cfg = AgentConfig(
            permissions=AgentPermissionsConfig(
                allow_shell=True,
                shell_allowlist=["git *"],
                allow_filesystem=True,
                filesystem_paths=["./src"],
            ),
        )
        assert cfg.permissions.allow_shell is True
        assert cfg.permissions.shell_allowlist == ["git *"]
        assert cfg.permissions.filesystem_paths == ["./src"]

    def test_permissions_from_dict(self):
        raw = {
            "name": "coder",
            "permissions": {
                "allow_shell": True,
                "shell_allowlist": ["git *", "pytest *"],
                "allow_filesystem": True,
                "filesystem_paths": ["./src", "./tests"],
            },
        }
        cfg = AgentConfig.model_validate(raw)
        assert cfg.permissions.allow_shell is True
        assert cfg.permissions.shell_allowlist == ["git *", "pytest *"]
        assert cfg.permissions.filesystem_paths == ["./src", "./tests"]


class TestAgentsPluginConfig:
    def test_defaults(self):
        cfg = AgentsPluginConfig()
        assert cfg.agents == {}
        assert cfg.default_model == ""
        assert cfg.max_agents == 10
        assert cfg.state.enabled is False
        assert cfg.state.path == ".botcore/orchestrator-state.json"

    def test_with_agents(self):
        cfg = AgentsPluginConfig(
            agents={
                "researcher": AgentConfig(name="researcher", model="test-model"),
                "coder": AgentConfig(name="coder", model="test-model"),
            },
            default_model="test-model-mini",
            max_agents=5,
        )
        assert len(cfg.agents) == 2
        assert "researcher" in cfg.agents
        assert cfg.max_agents == 5

    def test_max_agents_bounds(self):
        with pytest.raises(ValidationError):
            AgentsPluginConfig(max_agents=0)
        with pytest.raises(ValidationError):
            AgentsPluginConfig(max_agents=101)

    def test_extra_fields_forbidden(self):
        with pytest.raises(ValidationError):
            AgentsPluginConfig(unknown_field="value")


class TestAgentsStateConfig:
    def test_defaults(self):
        cfg = AgentsStateConfig()
        assert cfg.enabled is False
        assert cfg.backend == "json"
        assert cfg.path == ".botcore/orchestrator-state.json"
        assert cfg.retention_hours == 168
        assert cfg.autosave is False

    def test_resolve_path_absolute(self, tmp_path):
        path = tmp_path / "state.json"
        cfg = AgentsStateConfig(enabled=True, path=str(path))
        assert cfg.resolve_path() == path

    def test_resolve_path_relative(self, tmp_path):
        cfg = AgentsStateConfig(enabled=True, path=".botcore/state.json")
        assert cfg.resolve_path(tmp_path) == (tmp_path / ".botcore" / "state.json").resolve()


class TestGetAgentsConfig:
    def test_none_returns_defaults(self):
        cfg = get_agents_config(None)
        assert isinstance(cfg, AgentsPluginConfig)
        assert cfg.agents == {}

    def test_dict_validates(self):
        raw = {
            "default_model": "test-model-mini",
            "agents": {
                "worker": {"name": "worker", "model": "test-model"},
            },
        }
        cfg = get_agents_config(raw)
        assert cfg.default_model == "test-model-mini"
        assert "worker" in cfg.agents

    def test_invalid_dict_raises(self):
        with pytest.raises(ValidationError):
            get_agents_config({"max_agents": -1})
