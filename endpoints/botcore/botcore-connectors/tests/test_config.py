"""Tests for config module — spec 03."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from botcore_connectors.auth import AuthConfig
from botcore_connectors.config import (
    KNOWN_CONNECTORS,
    AzureBlobConfig,
    AzureQueueConfig,
    ConnectorsConfig,
    EmailConfig,
    GitHubConnectorConfig,
)

# ---------------------------------------------------------------------------
# KNOWN_CONNECTORS
# ---------------------------------------------------------------------------


class TestKnownConnectors:
    def test_is_frozenset(self) -> None:
        assert isinstance(KNOWN_CONNECTORS, frozenset)

    def test_contains_expected_names(self) -> None:
        assert KNOWN_CONNECTORS == {"github", "azure_blob", "azure_queue", "email"}

    def test_immutable(self) -> None:
        with pytest.raises(AttributeError):
            KNOWN_CONNECTORS.add("new")  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# ConnectorsConfig — defaults and validation
# ---------------------------------------------------------------------------


class TestConnectorsConfigDefaults:
    def test_empty_enabled(self) -> None:
        cfg = ConnectorsConfig()
        assert cfg.enabled == []

    def test_sub_model_defaults(self) -> None:
        cfg = ConnectorsConfig()
        assert cfg.github == GitHubConnectorConfig()
        assert cfg.azure_blob == AzureBlobConfig()
        assert cfg.azure_queue == AzureQueueConfig()
        assert cfg.email == EmailConfig()
        assert cfg.auth == AuthConfig()

    def test_github_defaults(self) -> None:
        cfg = ConnectorsConfig()
        assert cfg.github.default_repo is None
        assert cfg.github.api_version == "2022-11-28"

    def test_azure_blob_defaults(self) -> None:
        cfg = ConnectorsConfig()
        assert cfg.azure_blob.account_name is None
        assert cfg.azure_blob.container is None

    def test_azure_queue_defaults(self) -> None:
        cfg = ConnectorsConfig()
        assert cfg.azure_queue.namespace is None
        assert cfg.azure_queue.queue_name is None

    def test_email_defaults(self) -> None:
        cfg = ConnectorsConfig()
        assert cfg.email.from_address is None


class TestConnectorsConfigValidation:
    def test_valid_single_connector(self) -> None:
        cfg = ConnectorsConfig(enabled=["github"])
        assert cfg.enabled == ["github"]

    def test_valid_multiple_connectors(self) -> None:
        cfg = ConnectorsConfig(enabled=["github", "azure_blob", "email"])
        assert len(cfg.enabled) == 3

    def test_all_known_connectors(self) -> None:
        cfg = ConnectorsConfig(enabled=sorted(KNOWN_CONNECTORS))
        assert set(cfg.enabled) == KNOWN_CONNECTORS

    def test_unknown_connector_raises(self) -> None:
        with pytest.raises(ValidationError, match="nonexistent"):
            ConnectorsConfig(enabled=["nonexistent"])

    def test_mixed_valid_invalid_raises(self) -> None:
        with pytest.raises(ValidationError, match="bogus"):
            ConnectorsConfig(enabled=["github", "bogus"])

    def test_error_includes_valid_names(self) -> None:
        with pytest.raises(ValidationError, match="Valid connectors"):
            ConnectorsConfig(enabled=["nope"])


class TestConnectorsConfigExtraForbid:
    def test_top_level_extra_forbidden(self) -> None:
        with pytest.raises(ValidationError, match="extra"):
            ConnectorsConfig(unknown_field="x")  # type: ignore[call-arg]

    def test_github_extra_forbidden(self) -> None:
        with pytest.raises(ValidationError, match="extra"):
            GitHubConnectorConfig(unknown="x")  # type: ignore[call-arg]

    def test_azure_blob_extra_forbidden(self) -> None:
        with pytest.raises(ValidationError, match="extra"):
            AzureBlobConfig(unknown="x")  # type: ignore[call-arg]

    def test_azure_queue_extra_forbidden(self) -> None:
        with pytest.raises(ValidationError, match="extra"):
            AzureQueueConfig(unknown="x")  # type: ignore[call-arg]

    def test_email_extra_forbidden(self) -> None:
        with pytest.raises(ValidationError, match="extra"):
            EmailConfig(unknown="x")  # type: ignore[call-arg]


class TestConnectorsConfigCustomValues:
    def test_github_custom_values(self) -> None:
        cfg = ConnectorsConfig(
            github=GitHubConnectorConfig(default_repo="org/repo", api_version="2024-01-01")
        )
        assert cfg.github.default_repo == "org/repo"
        assert cfg.github.api_version == "2024-01-01"

    def test_auth_config_reuse(self) -> None:
        cfg = ConnectorsConfig(
            auth=AuthConfig(github_token_env="CUSTOM_TOKEN", token_cache_ttl_seconds=600.0)
        )
        assert cfg.auth.github_token_env == "CUSTOM_TOKEN"
        assert cfg.auth.token_cache_ttl_seconds == 600.0

    def test_raw_dict_validation(self) -> None:
        """Simulate _validate_plugin_configs flow: raw dict → validated model."""
        raw = {
            "enabled": ["github"],
            "github": {"default_repo": "org/repo"},
            "auth": {"github_token_env": "MY_TOKEN"},
        }
        cfg = ConnectorsConfig(**raw)
        assert cfg.enabled == ["github"]
        assert cfg.github.default_repo == "org/repo"
        assert cfg.auth.github_token_env == "MY_TOKEN"
