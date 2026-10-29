"""Shared fixtures for botcore-teams tests."""

from __future__ import annotations

from typing import Any

import pytest

from botcore_teams.config import TeamsConfig, TeamsRolesConfig


@pytest.fixture()
def teams_config() -> TeamsConfig:
    """Default test configuration."""
    return TeamsConfig(
        app_id="test-app-id",
        app_password="test-app-password",
        tenant_id="test-tenant-id",
        roles=TeamsRolesConfig(
            admin_groups=["Admins"],
            user_groups=["Users"],
        ),
    )


@pytest.fixture()
def open_config() -> TeamsConfig:
    """Configuration with no tenant restriction."""
    return TeamsConfig()


@pytest.fixture()
def sample_activity() -> dict[str, Any]:
    """A minimal Teams message activity dict."""
    return {
        "type": "message",
        "text": "team status",
        "from": {
            "aadObjectId": "user-aad-id-123",
            "id": "user-id-123",
            "name": "Test User",
        },
        "channelData": {
            "tenant": {
                "id": "test-tenant-id",
            },
        },
        "conversation": {
            "id": "conv-123",
        },
    }


@pytest.fixture()
def wrong_tenant_activity() -> dict[str, Any]:
    """Activity from an unauthorized tenant."""
    return {
        "type": "message",
        "text": "team status",
        "from": {
            "aadObjectId": "attacker-id",
            "id": "attacker-id",
            "name": "Attacker",
        },
        "channelData": {
            "tenant": {
                "id": "wrong-tenant-id",
            },
        },
        "conversation": {
            "id": "conv-456",
        },
    }
