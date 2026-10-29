"""Tests for resolve_connector_commands() — pure function, no mocks needed."""

from __future__ import annotations

from unittest.mock import patch

from botcore_agents.orchestrator import resolve_connector_commands

# Fake namespace simulating registered connector commands
FAKE_NAMESPACE = {
    "github_issue_list": lambda: None,
    "github_issue_create": lambda: None,
    "github_pr_list": lambda: None,
    "email_send": lambda: None,
    "email_read": lambda: None,
    "azure_blob_upload": lambda: None,
    "dev_test": lambda: None,
    "dev_lint": lambda: None,
}


class TestResolveConnectorCommands:
    def test_empty_connectors_returns_empty(self):
        """Deny-by-default: no connectors → no connector commands."""
        result = resolve_connector_commands([], [], FAKE_NAMESPACE)
        assert result == []

    def test_single_prefix_returns_matching(self):
        result = resolve_connector_commands(["github"], [], FAKE_NAMESPACE)
        assert sorted(result) == ["github_issue_create", "github_issue_list", "github_pr_list"]

    def test_multiple_prefixes_returns_union(self):
        result = resolve_connector_commands(["github", "email"], [], FAKE_NAMESPACE)
        assert sorted(result) == [
            "email_read",
            "email_send",
            "github_issue_create",
            "github_issue_list",
            "github_pr_list",
        ]

    def test_wildcard_returns_all_known_connector_commands(self):
        """Wildcard uses KNOWN_CONNECTORS to determine prefixes."""
        known = frozenset({"github", "email", "azure_blob"})
        with patch(
            "botcore_agents.orchestrator.KNOWN_CONNECTORS",
            known,
            create=True,
        ):
            # Need to patch the import inside the function
            import types

            fake_mods = {
                "botcore_connectors": types.ModuleType("botcore_connectors"),
                "botcore_connectors.config": types.ModuleType("botcore_connectors.config"),
            }
            with patch.dict("sys.modules", fake_mods):
                import sys

                sys.modules["botcore_connectors.config"].KNOWN_CONNECTORS = known
                result = resolve_connector_commands(["*"], [], FAKE_NAMESPACE)

        assert sorted(result) == [
            "azure_blob_upload",
            "email_read",
            "email_send",
            "github_issue_create",
            "github_issue_list",
            "github_pr_list",
        ]

    def test_wildcard_without_connectors_package(self):
        """Wildcard gracefully returns empty when botcore_connectors is not installed."""
        with patch.dict(
            "sys.modules",
            {"botcore_connectors": None, "botcore_connectors.config": None},
        ):
            result = resolve_connector_commands(["*"], [], FAKE_NAMESPACE)

        assert result == []

    def test_connector_commands_overrides_connectors(self):
        """Explicit connector_commands list takes precedence over prefix filtering."""
        result = resolve_connector_commands(
            ["github", "email"],
            ["github_issue_list"],
            FAKE_NAMESPACE,
        )
        assert result == ["github_issue_list"]

    def test_connector_commands_overrides_empty_connectors(self):
        """connector_commands works even when connectors is empty."""
        result = resolve_connector_commands(
            [],
            ["email_send", "github_pr_list"],
            FAKE_NAMESPACE,
        )
        assert result == ["email_send", "github_pr_list"]

    def test_unknown_prefix_returns_empty(self):
        """Unknown connector prefix produces empty result, no crash."""
        result = resolve_connector_commands(["slack"], [], FAKE_NAMESPACE)
        assert result == []

    def test_empty_namespace_returns_empty(self):
        """If namespace has no commands, prefix filtering returns empty."""
        result = resolve_connector_commands(["github"], [], {})
        assert result == []
