"""Connector capability resolution: which connector commands an agent may call."""

from __future__ import annotations

import logging
from typing import Any

# Moved from orchestrator.py; it keeps that module's logger name so log routing and
# filters see the same records.
logger = logging.getLogger("botcore_agents.orchestrator")


class ConnectorIntegrationUnavailable(RuntimeError):
    """An explicitly requested optional connector adapter is unavailable."""


def resolve_connector_commands(
    connectors: list[str],
    connector_commands: list[str],
    namespace: dict[str, Any],
) -> list[str]:
    """Resolve which connector commands an agent may access.

    Resolution order:
    1. *connector_commands* non-empty → return those directly (explicit override).
    2. *connectors* empty → ``[]`` (deny-by-default).
    3. ``"*"`` in *connectors* → all known connector-prefixed commands.
    4. Otherwise → prefix-filter *namespace* keys against *connectors*.
    """
    # 1. Explicit command list takes precedence
    if connector_commands:
        missing = [c for c in connector_commands if c not in namespace]
        if missing:
            logger.warning("connector_commands not in namespace: %s", missing)
        return list(connector_commands)

    # 2. Deny-by-default
    if not connectors:
        return []

    # 3. Wildcard — all connector-prefixed commands
    if "*" in connectors:
        try:
            from botcore_connectors.config import KNOWN_CONNECTORS
        except ImportError as exc:
            raise ConnectorIntegrationUnavailable(
                "Wildcard connector discovery requires the optional botcore-connectors integration"
            ) from exc
        prefixes = tuple(f"{c}_" for c in KNOWN_CONNECTORS)
        return [k for k in namespace if any(k.startswith(p) for p in prefixes)]

    # 4. Prefix-filter against connectors list
    prefixes = tuple(f"{c}_" for c in connectors)
    return [k for k in namespace if any(k.startswith(p) for p in prefixes)]
