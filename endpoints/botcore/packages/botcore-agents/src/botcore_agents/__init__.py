"""botcore-agents — Agent orchestration plugin for botcore (Phase 1)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel

from .config import AgentPermissionsConfig, AgentsPluginConfig, AgentsStateConfig
from .state import JsonStateBackend, OrchestratorSnapshot, OrchestratorStateBackend

if TYPE_CHECKING:
    from botcore.plugin import PluginRegistry

from ._docs import AGENTS_DOCS


class AgentsPlugin:
    """BotCorePlugin implementation for agent orchestration."""

    def configure(self, config: AgentsPluginConfig) -> None:
        from .commands import set_config

        set_config(config)

    def register(self, registry: PluginRegistry) -> None:
        from .commands import AGENT_COMMANDS

        registry.add_commands(AGENT_COMMANDS)
        registry.set_mcp_name("agents")
        registry.add_docs("agents", AGENTS_DOCS)

    def config_schema(self) -> type[BaseModel] | None:
        return AgentsPluginConfig


__all__ = [
    "AgentPermissionsConfig",
    "AgentsPlugin",
    "AgentsPluginConfig",
    "AgentsStateConfig",
    "JsonStateBackend",
    "OrchestratorSnapshot",
    "OrchestratorStateBackend",
]
