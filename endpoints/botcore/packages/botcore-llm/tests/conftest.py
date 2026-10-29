"""Shared test fixtures for botcore-llm."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest  # noqa: I001 — pytest must follow stdlib

# ---------------------------------------------------------------------------
# Lightweight stubs — avoid importing copilot at collection time
# ---------------------------------------------------------------------------


@dataclass
class _MockModelCapabilities:
    supports: Any = None
    limits: Any = None


@dataclass
class _MockModelSupports:
    vision: bool = False


@dataclass
class _MockModelInfo:
    id: str = "test-model"
    name: str = "Test Model"
    capabilities: Any = None
    policy: Any = None
    billing: Any = None
    supported_reasoning_efforts: Any = None
    default_reasoning_effort: Any = None


@dataclass
class _MockEventData:
    content: str = "Hello from the assistant"
    message_id: str = "msg-001"


@dataclass
class _MockSessionEvent:
    data: Any = None
    id: Any = None
    timestamp: Any = None
    type: Any = None


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_copilot_session():
    """AsyncMock of CopilotSession with sensible defaults."""
    session = AsyncMock()
    session.session_id = "session-test-001"
    session.disconnect = AsyncMock()
    session.on = MagicMock(return_value=lambda: None)

    event = _MockSessionEvent(data=_MockEventData())
    session.send_and_wait = AsyncMock(return_value=event)
    return session


@pytest.fixture()
def mock_copilot_client(mock_copilot_session):
    """AsyncMock of CopilotClient that returns the mock session."""
    client = AsyncMock()
    client.start = AsyncMock()
    client.stop = AsyncMock(return_value=[])
    client.create_session = AsyncMock(return_value=mock_copilot_session)

    model_info = _MockModelInfo(
        capabilities=_MockModelCapabilities(
            supports=_MockModelSupports(vision=True),
        ),
    )
    client.list_models = AsyncMock(return_value=[model_info])
    return client


@pytest.fixture()
def patch_client_manager(mock_copilot_client):
    """Patch CopilotClientManager to return the mock client."""
    with patch(
        "botcore_llm.client.CopilotClientManager.get_client",
        new_callable=AsyncMock,
        return_value=mock_copilot_client,
    ) as mock_get:
        # Also patch the commands module reference
        with patch(
            "botcore_llm.commands.CopilotClientManager.get_client",
            new_callable=AsyncMock,
            return_value=mock_copilot_client,
        ):
            yield mock_get
