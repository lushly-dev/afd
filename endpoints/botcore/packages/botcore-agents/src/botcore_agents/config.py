"""Agent orchestration configuration models."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from botcore_llm.config import LlmPermissionsConfig
from pydantic import BaseModel, ConfigDict, Field


class AgentPermissionsConfig(LlmPermissionsConfig):
    """Per-agent permission profile — extends LlmPermissionsConfig with allowlists."""

    shell_allowlist: list[str] | None = None
    filesystem_paths: list[str] | None = None


class AgentConfig(BaseModel):
    """Configuration for a single agent."""

    model_config = ConfigDict(extra="forbid")

    name: str = ""
    role: str = ""
    model: str = ""
    skills: list[str] = Field(default_factory=list)
    connectors: list[str] = Field(default_factory=list)
    connector_commands: list[str] = Field(default_factory=list)
    memory_scope: Literal["session", "agent", "global"] = "session"
    max_concurrent_tasks: int = Field(default=1, ge=1, le=10)
    heartbeat_interval: int = Field(default=30, ge=5, le=300)
    system_prompt: str = ""
    is_lead: bool = False
    permissions: AgentPermissionsConfig = Field(default_factory=AgentPermissionsConfig)


class AgentsStateConfig(BaseModel):
    """State persistence settings for the orchestrator."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    backend: Literal["json"] = "json"
    path: str = ".botcore/orchestrator-state.json"
    retention_hours: int = Field(default=168, ge=1, le=24 * 365)
    autosave: bool = False

    def resolve_path(self, workspace: Path | None = None) -> Path:
        """Resolve the configured state path against a workspace or cwd."""
        path = Path(self.path).expanduser()
        if path.is_absolute():
            return path
        base = (workspace or Path.cwd()).resolve()
        return (base / path).resolve()


class AgentsPluginConfig(BaseModel):
    """Top-level agents plugin configuration.

    Mapped from ``[tool.botcore.plugins.agents]`` in botcore.toml.
    """

    model_config = ConfigDict(extra="forbid")

    agents: dict[str, AgentConfig] = Field(default_factory=dict)
    # No built-in default: model IDs are account-specific in the Copilot runtime
    # (see ``llm_model_list``). ``start_agent`` errors when neither this nor
    # ``agents.<name>.model`` is set.
    default_model: str = ""
    max_agents: int = Field(default=10, ge=1, le=100)
    state: AgentsStateConfig = Field(default_factory=AgentsStateConfig)


def get_agents_config(plugin_config: dict[str, Any] | None = None) -> AgentsPluginConfig:
    """Extract ``AgentsPluginConfig`` from a plugin config dict.

    Args:
        plugin_config: Raw dict from botcore plugin config section, or None.

    Returns:
        Validated AgentsPluginConfig instance.
    """
    if plugin_config is None:
        return AgentsPluginConfig()
    return AgentsPluginConfig.model_validate(plugin_config)
