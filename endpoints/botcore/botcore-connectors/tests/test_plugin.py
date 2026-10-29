"""Tests for plugin module — spec 03."""

from __future__ import annotations

from botcore.plugin import BotCorePlugin, PluginRegistry

from botcore_connectors.config import ConnectorsConfig
from botcore_connectors.plugin import ConnectorsPlugin

# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


class TestPluginProtocol:
    def test_satisfies_botcore_plugin(self) -> None:
        plugin = ConnectorsPlugin()
        assert isinstance(plugin, BotCorePlugin)

    def test_config_schema_returns_connectors_config(self) -> None:
        plugin = ConnectorsPlugin()
        assert plugin.config_schema() is ConnectorsConfig


# ---------------------------------------------------------------------------
# register() — MCP name + docs
# ---------------------------------------------------------------------------


class TestRegister:
    def test_sets_mcp_name(self) -> None:
        plugin = ConnectorsPlugin()
        registry = PluginRegistry()
        plugin.register(registry)
        assert registry.mcp_name == "connectors"

    def test_adds_docs(self) -> None:
        plugin = ConnectorsPlugin()
        registry = PluginRegistry()
        plugin.register(registry)
        assert "connectors" in registry.docs
        assert "Connectors Plugin" in registry.docs["connectors"]

    def test_no_config_zero_commands(self) -> None:
        plugin = ConnectorsPlugin()
        registry = PluginRegistry()
        plugin.register(registry)
        assert registry.commands == []

    def test_empty_enabled_zero_commands(self) -> None:
        plugin = ConnectorsPlugin(config=ConnectorsConfig(enabled=[]))
        registry = PluginRegistry()
        plugin.register(registry)
        assert registry.commands == []

    def test_enabled_github_registers_commands(self) -> None:
        """GitHub connector registers 8 commands."""
        plugin = ConnectorsPlugin(config=ConnectorsConfig(enabled=["github"]))
        registry = PluginRegistry()
        plugin.register(registry)
        assert len(registry.commands) == 8
        assert registry.mcp_name == "connectors"
        assert "connectors" in registry.docs

    def test_enabled_multiple_only_github_has_commands(self) -> None:
        cfg = ConnectorsConfig(enabled=["github", "azure_blob"])
        plugin = ConnectorsPlugin(config=cfg)
        registry = PluginRegistry()
        plugin.register(registry)
        assert len(registry.commands) == 8  # only GitHub implemented


# ---------------------------------------------------------------------------
# configure() — two-phase init
# ---------------------------------------------------------------------------


class TestConfigure:
    def test_no_config_initially(self) -> None:
        plugin = ConnectorsPlugin()
        assert plugin.config is None

    def test_constructor_config(self) -> None:
        cfg = ConnectorsConfig(enabled=["github"])
        plugin = ConnectorsPlugin(config=cfg)
        assert plugin.config is cfg

    def test_configure_injects_config(self) -> None:
        plugin = ConnectorsPlugin()
        cfg = ConnectorsConfig(enabled=["email"])
        plugin.configure(cfg)
        assert plugin.config is cfg

    def test_configure_overrides_constructor(self) -> None:
        initial = ConnectorsConfig(enabled=["github"])
        plugin = ConnectorsPlugin(config=initial)
        override = ConnectorsConfig(enabled=["email"])
        plugin.configure(override)
        assert plugin.config is override
        assert plugin.enabled_prefixes == ["email"]


# ---------------------------------------------------------------------------
# enabled_prefixes — agent-scoping contract
# ---------------------------------------------------------------------------


class TestEnabledPrefixes:
    def test_no_config_returns_empty(self) -> None:
        plugin = ConnectorsPlugin()
        assert plugin.enabled_prefixes == []

    def test_returns_enabled_list(self) -> None:
        cfg = ConnectorsConfig(enabled=["github", "azure_blob"])
        plugin = ConnectorsPlugin(config=cfg)
        assert plugin.enabled_prefixes == ["github", "azure_blob"]


# ---------------------------------------------------------------------------
# Integration — _validate_plugin_configs simulation
# ---------------------------------------------------------------------------


class TestPluginConfigIntegration:
    def test_schema_to_raw_dict_roundtrip(self) -> None:
        """Simulate the flow: plugin.config_schema() → raw dict → validated model."""
        plugin = ConnectorsPlugin()
        schema = plugin.config_schema()

        raw = {
            "enabled": ["github"],
            "github": {"default_repo": "org/repo"},
            "auth": {"github_token_env": "MY_TOKEN"},
        }
        validated = schema(**raw)

        assert isinstance(validated, ConnectorsConfig)
        assert validated.enabled == ["github"]
        assert validated.github.default_repo == "org/repo"
        assert validated.auth.github_token_env == "MY_TOKEN"

    def test_configure_after_validation(self) -> None:
        """Full lifecycle: discover → schema → validate → configure → register."""
        plugin = ConnectorsPlugin()

        # Phase 1: discover + register (no config yet)
        registry1 = PluginRegistry()
        plugin.register(registry1)
        assert registry1.mcp_name == "connectors"
        assert registry1.commands == []

        # Phase 2: config arrives via _validate_plugin_configs
        schema = plugin.config_schema()
        raw = {"enabled": ["github"]}
        cfg = schema(**raw)
        plugin.configure(cfg)

        assert plugin.enabled_prefixes == ["github"]
