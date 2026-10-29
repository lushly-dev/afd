"""Tests for TeamsPlugin registration and protocol."""

from __future__ import annotations

import pytest
from botcore.plugin import BotCorePlugin, PluginRegistry
from pydantic import ValidationError

from botcore_teams import TeamsPlugin
from botcore_teams.config import TeamsConfig


class TestTeamsPlugin:
    def test_satisfies_protocol(self) -> None:
        plugin = TeamsPlugin()
        assert isinstance(plugin, BotCorePlugin)

    def test_registers_commands(self) -> None:
        plugin = TeamsPlugin()
        registry = PluginRegistry()
        plugin.register(registry)

        assert len(registry.commands) == 2

    def test_sets_mcp_name(self) -> None:
        plugin = TeamsPlugin()
        registry = PluginRegistry()
        plugin.register(registry)

        assert registry.mcp_name == "teams"

    def test_registers_docs(self) -> None:
        plugin = TeamsPlugin()
        registry = PluginRegistry()
        plugin.register(registry)

        assert "teams" in registry.docs
        assert "teams_handle_message" in registry.docs["teams"]

    def test_config_schema_returns_teams_config(self) -> None:
        plugin = TeamsPlugin()
        schema = plugin.config_schema()
        assert schema is TeamsConfig

    def test_config_schema_validates(self) -> None:
        plugin = TeamsPlugin()
        schema = plugin.config_schema()
        assert schema is not None

        # Valid config
        config = schema(app_id="my-app", tenant_id="my-tenant")
        assert config.app_id == "my-app"
        assert config.tenant_id == "my-tenant"

    def test_config_defaults(self) -> None:
        plugin = TeamsPlugin()
        schema = plugin.config_schema()
        assert schema is not None

        config = schema()
        assert config.app_id == ""
        assert config.port == 3978

    def test_config_rejects_extra_fields(self) -> None:
        plugin = TeamsPlugin()
        schema = plugin.config_schema()
        assert schema is not None

        with pytest.raises(ValidationError, match="unknown_field"):
            schema(unknown_field="bad")
