"""Connector configuration schema — TOML-driven, Pydantic-validated."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator

from botcore_connectors.auth import AuthConfig

KNOWN_CONNECTORS: frozenset[str] = frozenset(
    {"github", "azure_blob", "azure_queue", "email"}
)


# ── Per-connector sub-models ──────────────────────────────────────────────


class GitHubConnectorConfig(BaseModel):
    """GitHub-specific connector settings."""

    model_config = ConfigDict(extra="forbid")

    default_repo: str | None = None
    api_version: str = "2022-11-28"


class AzureBlobConfig(BaseModel):
    """Azure Blob Storage connector settings."""

    model_config = ConfigDict(extra="forbid")

    account_name: str | None = None
    container: str | None = None


class AzureQueueConfig(BaseModel):
    """Azure Queue connector settings."""

    model_config = ConfigDict(extra="forbid")

    namespace: str | None = None
    queue_name: str | None = None


class EmailConfig(BaseModel):
    """Email connector settings."""

    model_config = ConfigDict(extra="forbid")

    from_address: str | None = None


# ── Top-level connectors config ──────────────────────────────────────────


class ConnectorsConfig(BaseModel):
    """Top-level config for [tool.botcore.plugins.connectors]."""

    model_config = ConfigDict(extra="forbid")

    enabled: list[str] = []

    github: GitHubConnectorConfig = GitHubConnectorConfig()
    azure_blob: AzureBlobConfig = AzureBlobConfig()
    azure_queue: AzureQueueConfig = AzureQueueConfig()
    email: EmailConfig = EmailConfig()
    auth: AuthConfig = AuthConfig()

    @field_validator("enabled")
    @classmethod
    def _validate_enabled(cls, v: list[str]) -> list[str]:
        invalid = {name for name in v if name not in KNOWN_CONNECTORS}
        if invalid:
            msg = (
                f"Unknown connector(s): {sorted(invalid)}. "
                f"Valid connectors: {sorted(KNOWN_CONNECTORS)}"
            )
            raise ValueError(msg)
        return v
