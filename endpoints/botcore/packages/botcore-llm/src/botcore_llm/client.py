"""CopilotClient singleton lifecycle manager."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from copilot import CopilotClient, RuntimeConnection

if TYPE_CHECKING:
    from .config import LlmConfig

logger = logging.getLogger(__name__)


class CopilotClientManager:
    """Lazy singleton wrapper around :class:`CopilotClient`.

    Call :meth:`get_client` to obtain a started client.  The same
    instance is reused across all sessions.  Call :meth:`shutdown`
    to tear down the client (e.g. on process exit).
    """

    _instance: CopilotClient | None = None

    @classmethod
    async def get_client(cls, config: LlmConfig) -> CopilotClient:
        """Return a started :class:`CopilotClient`, creating one if needed.

        Args:
            config: LLM configuration (used on first call only).

        Returns:
            A connected CopilotClient instance.
        """
        if cls._instance is not None:
            return cls._instance

        # No cli_url: the SDK spawns its bundled runtime over stdio.
        connection = RuntimeConnection.for_uri(config.cli_url) if config.cli_url else None

        client = CopilotClient(connection=connection)
        await client.start()
        cls._instance = client
        logger.info("CopilotClient started (cli_url=%s)", config.cli_url or "stdio")
        return client

    @classmethod
    async def shutdown(cls) -> None:
        """Stop the client and clear the singleton."""
        if cls._instance is not None:
            await cls._instance.stop()
            logger.info("CopilotClient stopped")
            cls._instance = None
