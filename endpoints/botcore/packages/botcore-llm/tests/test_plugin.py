"""Tests for the LlmPlugin protocol compliance."""

from __future__ import annotations

from botcore.plugin import BotCorePlugin, PluginRegistry

from botcore_llm import LlmPlugin
from botcore_llm.config import LlmConfig


class TestLlmPlugin:
    def test_satisfies_protocol(self):
        plugin = LlmPlugin()
        assert isinstance(plugin, BotCorePlugin)

    def test_register_adds_commands(self):
        plugin = LlmPlugin()
        registry = PluginRegistry()

        plugin.register(registry)

        names = [cmd.__name__ for cmd in registry.commands]
        assert "llm_session_create" in names
        assert "llm_session_destroy" in names
        assert "llm_session_list" in names
        assert "llm_model_list" in names
        assert "llm_chat" in names

    def test_register_sets_mcp_name(self):
        plugin = LlmPlugin()
        registry = PluginRegistry()

        plugin.register(registry)

        assert registry.mcp_name == "llm"

    def test_register_adds_docs(self):
        plugin = LlmPlugin()
        registry = PluginRegistry()

        plugin.register(registry)

        assert "llm" in registry.docs
        assert "llm_session_create" in registry.docs["llm"]

    def test_config_schema_returns_llm_config(self):
        plugin = LlmPlugin()
        schema = plugin.config_schema()

        assert schema is LlmConfig

    def test_config_has_no_hard_coded_default_model(self):
        assert LlmConfig().default_model == ""
        # An empty plugin section must still load; the error surfaces at session create.
        assert LlmConfig.model_validate({}).default_model == ""
