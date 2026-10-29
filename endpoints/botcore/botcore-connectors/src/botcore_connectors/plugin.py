"""Connectors plugin — wires into botcore's plugin system."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from botcore.plugin import PluginRegistry
from pydantic import BaseModel

from botcore_connectors.config import ConnectorsConfig

_CONNECTORS_DOCS = """\
# Connectors Plugin

Typed HTTP connectors for external services: GitHub, Azure Blob, Azure Queue, Email.

## Configuration

```toml
[tool.botcore.plugins.connectors]
enabled = ["github"]

[tool.botcore.plugins.connectors.github]
default_repo = "org/repo"
api_version = "2022-11-28"

[tool.botcore.plugins.connectors.auth]
github_token_env = "GH_TOKEN"
```

## Supported Connectors

- **github** — GitHub REST API v3
- **azure_blob** — Azure Blob Storage
- **azure_queue** — Azure Queue (Service Bus)
- **email** — Email via Microsoft Graph
"""


class ConnectorsPlugin:
    """Connectors plugin for botcore.

    Supports two-phase initialisation:
    1. ``discover_plugins()`` instantiates with no args → ``register()`` sets
       MCP name + docs but zero commands (safe for entry-point discovery).
    2. ``configure()`` injects validated config later → enables command
       filtering based on ``enabled`` list.
    """

    def __init__(self, config: ConnectorsConfig | None = None) -> None:
        self._config = config
        self._connectors: dict[str, Any] = {}

    def configure(self, config: ConnectorsConfig) -> None:
        """Inject config after construction (two-phase init)."""
        self._config = config

    @property
    def config(self) -> ConnectorsConfig | None:
        return self._config

    @property
    def enabled_prefixes(self) -> list[str]:
        """Return enabled connector names for agent-scoping."""
        if self._config is None:
            return []
        return list(self._config.enabled)

    def register(self, registry: PluginRegistry) -> None:
        """Register plugin identity, docs, and commands.

        Always sets MCP name and docs.  Commands are only registered for
        connectors listed in ``enabled`` (Phase 1 returns none regardless).
        """
        registry.set_mcp_name("connectors")
        registry.add_docs("connectors", _CONNECTORS_DOCS)

        if self._config is not None:
            for name in self._config.enabled:
                commands = self._get_commands_for(name)
                if commands:
                    registry.add_commands(commands)

    def config_schema(self) -> type[BaseModel]:
        """Return Pydantic model for config validation."""
        return ConnectorsConfig

    async def close(self) -> None:
        """Close all connector HTTP clients."""
        for connector in self._connectors.values():
            if hasattr(connector, "close"):
                await connector.close()
        self._connectors.clear()

    def _get_commands_for(self, name: str) -> list[Callable[..., Any]]:
        """Return commands for a named connector."""
        if name == "github":
            return self._get_github_commands()
        return []

    def _get_github_commands(self) -> list[Callable[..., Any]]:
        """Lazy-load GitHub commands."""
        from botcore_connectors.github_commands import create_github_commands

        if self._config is None:
            return []

        from botcore_connectors.auth import DefaultCredentialResolver

        resolver = DefaultCredentialResolver(self._config.auth)
        cmd_set = create_github_commands(self._config.github, resolver=resolver)
        self._connectors["github"] = cmd_set.connector
        return cmd_set.commands
