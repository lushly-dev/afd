"""LLM runtime configuration models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class LlmPermissionsConfig(BaseModel):
    """Permission gate configuration for LLM sessions."""

    allow_shell: bool = False
    allow_filesystem: bool = False
    allow_mcp: bool = True
    allow_custom_tools: bool = True


class LlmCostConfig(BaseModel):
    """Per-session token budget (stub for Phase 3)."""

    warn_tokens_per_session: int = 100_000
    max_tokens_per_session: int = 500_000


class LlmConfig(BaseModel):
    """Top-level LLM runtime configuration.

    Mapped from ``[tool.botcore.plugins.llm]`` in botcore.toml.
    """

    # No built-in default: model IDs are account-specific in the Copilot runtime
    # (see ``llm_model_list``). ``llm_session_create`` errors when unset.
    default_model: str = ""
    cli_url: str = ""
    streaming: bool = True
    infinite_sessions: bool = True
    permissions: LlmPermissionsConfig = LlmPermissionsConfig()
    cost: LlmCostConfig = LlmCostConfig()


def get_llm_config(plugin_config: dict[str, Any] | None = None) -> LlmConfig:
    """Extract ``LlmConfig`` from a plugin config dict.

    Args:
        plugin_config: Raw dict from botcore plugin config section, or None.

    Returns:
        Validated LlmConfig instance.
    """
    if plugin_config is None:
        return LlmConfig()
    return LlmConfig.model_validate(plugin_config)
