"""Tests for botcore.plugin."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from botcore.plugin import BotCorePlugin, PluginRegistry, discover_plugins
from tests.conftest import MockPlugin


def test_discover_no_plugins() -> None:
    """Empty entry points → empty dict."""
    with patch("botcore.plugin.importlib.metadata.entry_points") as mock_eps:
        mock_result = mock_eps.return_value
        mock_result.select.return_value = []
        plugins = discover_plugins()

    assert plugins == {}


def test_plugin_registration(mock_plugin: MockPlugin) -> None:
    """Mock plugin registers commands and sets CLI name."""
    registry = PluginRegistry()
    mock_plugin.register(registry)

    assert len(registry.commands) == 1
    assert registry.cli_name == "test-bot"


def test_plugin_protocol_check(mock_plugin: MockPlugin) -> None:
    """MockPlugin satisfies the BotCorePlugin protocol."""
    assert isinstance(mock_plugin, BotCorePlugin)


def test_plugin_config_validation(mock_plugin: MockPlugin) -> None:
    """Plugin config section validated against schema."""
    schema = mock_plugin.config_schema()
    assert schema is not None

    # Valid config
    validated = schema(greeting="hi")
    assert validated.greeting == "hi"

    # Default
    validated = schema()
    assert validated.greeting == "hello"

    # Invalid field → ValidationError
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="unknown_field"):
        schema(unknown_field="bad")


def test_orphaned_plugin_config_warns(tmp_path: Path) -> None:
    """Config section without matching plugin → warning."""
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        """\
[project]
name = "test"
version = "0.1.0"

[tool.botcore]

[tool.botcore.plugins.nonexistent]
some_key = "value"
""",
        encoding="utf-8",
    )

    from botcore.config import load_config

    with pytest.warns(UserWarning, match="nonexistent.*no matching plugin"):
        load_config(workspace=tmp_path, discovered_plugins={})


def test_plugin_registry_skills_dir(tmp_path: Path) -> None:
    """PluginRegistry tracks skill directories."""
    registry = PluginRegistry()
    registry.add_skills_dir(tmp_path / "skills")
    assert registry.skills_dirs == [tmp_path / "skills"]


def test_plugin_registry_mcp_name() -> None:
    """PluginRegistry tracks MCP name."""
    registry = PluginRegistry()
    registry.set_mcp_name("test-mcp")
    assert registry.mcp_name == "test-mcp"


def test_plugin_registry_middleware() -> None:
    """add_middleware registers callables; middleware property returns copy."""
    registry = PluginRegistry()
    assert registry.middleware == []

    def mw_a() -> None: ...  # noqa: E704
    def mw_b() -> None: ...  # noqa: E704

    registry.add_middleware(mw_a)
    registry.add_middleware(mw_b)
    assert registry.middleware == [mw_a, mw_b]

    # Property returns a defensive copy
    registry.middleware.append(lambda: None)
    assert len(registry.middleware) == 2
