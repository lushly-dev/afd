"""Integration tests — plugin wiring, lifecycle, command signatures."""

from __future__ import annotations

import asyncio
import inspect

from botcore.plugin import PluginRegistry

from botcore_connectors.config import ConnectorsConfig, GitHubConnectorConfig
from botcore_connectors.github_commands import create_github_commands
from botcore_connectors.plugin import ConnectorsPlugin

# ---------------------------------------------------------------------------
# Plugin → GitHub wiring
# ---------------------------------------------------------------------------


class TestPluginGitHubWiring:
    def test_returns_8_commands(self) -> None:
        cfg = ConnectorsConfig(enabled=["github"])
        plugin = ConnectorsPlugin(config=cfg)
        registry = PluginRegistry()
        plugin.register(registry)
        assert len(registry.commands) == 8

    def test_command_names(self) -> None:
        cfg = ConnectorsConfig(enabled=["github"])
        plugin = ConnectorsPlugin(config=cfg)
        registry = PluginRegistry()
        plugin.register(registry)
        names = sorted(fn.__name__ for fn in registry.commands)
        assert names == sorted([
            "github_issue_create",
            "github_issue_list",
            "github_issue_comment",
            "github_pr_create",
            "github_pr_list",
            "github_pr_review",
            "github_search_code",
            "github_search_issues",
        ])

    def test_other_connectors_still_empty(self) -> None:
        cfg = ConnectorsConfig(enabled=["azure_blob"])
        plugin = ConnectorsPlugin(config=cfg)
        registry = PluginRegistry()
        plugin.register(registry)
        assert registry.commands == []

    def test_register_adds_commands(self) -> None:
        cfg = ConnectorsConfig(enabled=["github"])
        plugin = ConnectorsPlugin(config=cfg)
        registry = PluginRegistry()
        plugin.register(registry)
        assert len(registry.commands) > 0
        assert registry.mcp_name == "connectors"


# ---------------------------------------------------------------------------
# Plugin lifecycle
# ---------------------------------------------------------------------------


class TestPluginLifecycle:
    async def test_close_works(self) -> None:
        cfg = ConnectorsConfig(enabled=["github"])
        plugin = ConnectorsPlugin(config=cfg)
        registry = PluginRegistry()
        plugin.register(registry)
        await plugin.close()
        assert plugin._connectors == {}

    async def test_register_close_roundtrip(self) -> None:
        cfg = ConnectorsConfig(enabled=["github"])
        plugin = ConnectorsPlugin(config=cfg)
        registry = PluginRegistry()
        plugin.register(registry)
        assert "github" in plugin._connectors
        await plugin.close()
        assert "github" not in plugin._connectors

    async def test_connectors_tracking(self) -> None:
        cfg = ConnectorsConfig(enabled=["github"])
        plugin = ConnectorsPlugin(config=cfg)
        registry = PluginRegistry()
        plugin.register(registry)
        assert "github" in plugin._connectors
        await plugin.close()


# ---------------------------------------------------------------------------
# Command signatures
# ---------------------------------------------------------------------------


class TestCommandSignatures:
    def test_all_async(self) -> None:
        config = GitHubConnectorConfig(default_repo="a/b")
        cmd_set = create_github_commands(config)
        for cmd in cmd_set.commands:
            assert asyncio.iscoroutinefunction(cmd), f"{cmd.__name__} is not async"

    def test_required_params_positional(self) -> None:
        config = GitHubConnectorConfig(default_repo="a/b")
        cmd_set = create_github_commands(config)
        # github_issue_create has 'title' as positional
        create_cmd = next(c for c in cmd_set.commands if c.__name__ == "github_issue_create")
        sig = inspect.signature(create_cmd)
        title_param = sig.parameters["title"]
        assert title_param.default is inspect.Parameter.empty

    def test_optional_have_defaults(self) -> None:
        config = GitHubConnectorConfig(default_repo="a/b")
        cmd_set = create_github_commands(config)
        # github_issue_create has 'body' as optional keyword
        create_cmd = next(c for c in cmd_set.commands if c.__name__ == "github_issue_create")
        sig = inspect.signature(create_cmd)
        body_param = sig.parameters["body"]
        assert body_param.default is None

    def test_pr_review_uses_pr_number(self) -> None:
        """Spec 05 requires the parameter to be named pr_number."""
        config = GitHubConnectorConfig(default_repo="a/b")
        cmd_set = create_github_commands(config)
        review_cmd = next(c for c in cmd_set.commands if c.__name__ == "github_pr_review")
        sig = inspect.signature(review_cmd)
        assert "pr_number" in sig.parameters
        assert "pull_number" not in sig.parameters
