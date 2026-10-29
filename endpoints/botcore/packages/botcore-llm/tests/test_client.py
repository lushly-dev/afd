"""Tests for the CopilotClient singleton manager."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from copilot import UriRuntimeConnection

from botcore_llm.client import CopilotClientManager
from botcore_llm.config import LlmConfig


@pytest.fixture(autouse=True)
def _reset_singleton():
    CopilotClientManager._instance = None
    yield
    CopilotClientManager._instance = None


def _fake_client() -> MagicMock:
    client = MagicMock()
    client.start = AsyncMock()
    return client


class TestGetClient:
    @pytest.mark.asyncio
    async def test_default_uses_bundled_runtime(self):
        with patch("botcore_llm.client.CopilotClient", return_value=_fake_client()) as ctor:
            await CopilotClientManager.get_client(LlmConfig())

        ctor.assert_called_once_with(connection=None)

    @pytest.mark.asyncio
    async def test_cli_url_connects_by_uri(self):
        with patch("botcore_llm.client.CopilotClient", return_value=_fake_client()) as ctor:
            await CopilotClientManager.get_client(LlmConfig(cli_url="localhost:3000"))

        connection = ctor.call_args.kwargs["connection"]
        assert isinstance(connection, UriRuntimeConnection)
        assert connection.url == "localhost:3000"

    @pytest.mark.asyncio
    async def test_reuses_started_client(self):
        with patch("botcore_llm.client.CopilotClient", return_value=_fake_client()) as ctor:
            first = await CopilotClientManager.get_client(LlmConfig())
            second = await CopilotClientManager.get_client(LlmConfig())

        assert first is second
        ctor.assert_called_once()
