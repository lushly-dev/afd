"""Tests for AgentsPlugin registration and protocol compliance."""

from __future__ import annotations

from unittest.mock import MagicMock

from pydantic import BaseModel

from botcore_agents import AgentsPlugin
from botcore_agents.config import AgentsPluginConfig


class TestAgentsPlugin:
    def test_implements_protocol(self):
        """Plugin is recognised as implementing BotCorePlugin protocol."""
        from botcore.plugin import BotCorePlugin

        plugin = AgentsPlugin()
        assert isinstance(plugin, BotCorePlugin)

    def test_config_schema_returns_model(self):
        plugin = AgentsPlugin()
        schema = plugin.config_schema()
        assert schema is AgentsPluginConfig
        assert issubclass(schema, BaseModel)

    def test_register_adds_commands(self):
        plugin = AgentsPlugin()
        registry = MagicMock()
        plugin.register(registry)
        registry.add_commands.assert_called_once()
        commands = registry.add_commands.call_args[0][0]
        assert len(commands) == 11
        names = {cmd.__name__ for cmd in commands}
        assert names == {
            "agent_create",
            "agent_delete",
            "agent_start",
            "agent_stop",
            "agent_status",
            "agent_heartbeat",
            "task_assign",
            "task_resume",
            "task_status",
            "state_save",
            "state_load",
        }

    def test_register_sets_mcp_name(self):
        plugin = AgentsPlugin()
        registry = MagicMock()
        plugin.register(registry)
        registry.set_mcp_name.assert_called_once_with("agents")

    def test_register_adds_docs(self):
        plugin = AgentsPlugin()
        registry = MagicMock()
        plugin.register(registry)
        registry.add_docs.assert_called_once()
        topic, content = registry.add_docs.call_args[0]
        assert topic == "agents"
        assert "agent_create" in content
