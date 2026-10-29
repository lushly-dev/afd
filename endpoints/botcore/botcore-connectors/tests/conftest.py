"""Shared test fixtures for botcore-connectors."""

from __future__ import annotations

import pytest

from botcore_connectors.base import ConnectorBase, ConnectorContext
from botcore_connectors.config import GitHubConnectorConfig
from botcore_connectors.github import GitHubConnector
from botcore_connectors.github_commands import GitHubCommandSet, create_github_commands

TEST_BASE_URL = "https://api.test.local"
GITHUB_API_BASE = "https://api.github.com"


@pytest.fixture()
def connector_context() -> ConnectorContext:
    """Minimal ConnectorContext with test defaults."""
    return ConnectorContext(
        base_url=TEST_BASE_URL,
        default_headers={"Accept": "application/json"},
        timeout_seconds=5.0,
        max_retries=3,
        jitter_max_seconds=0.0,  # deterministic in tests
    )


@pytest.fixture()
async def connector(connector_context: ConnectorContext) -> ConnectorBase:
    """ConnectorBase wired to the test base URL."""
    c = ConnectorBase(connector_context)
    yield c  # type: ignore[misc]
    await c.close()


@pytest.fixture()
def github_config() -> GitHubConnectorConfig:
    """GitHubConnectorConfig with test defaults."""
    return GitHubConnectorConfig(default_repo="octocat/hello-world")


@pytest.fixture()
async def github_connector(github_config: GitHubConnectorConfig) -> GitHubConnector:
    """GitHubConnector with no auth (test only)."""
    c = GitHubConnector(github_config)
    yield c  # type: ignore[misc]
    await c.close()


@pytest.fixture()
async def github_commands(github_config: GitHubConnectorConfig) -> GitHubCommandSet:
    """Full command set with no auth (test only)."""
    cmd_set = create_github_commands(github_config)
    yield cmd_set  # type: ignore[misc]
    await cmd_set.connector.close()
