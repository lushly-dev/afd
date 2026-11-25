"""Credential resolution for connectors: from the environment only."""

from __future__ import annotations

import logging
import os
import time
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class AuthConfig(BaseModel):
    """Configuration for credential resolution."""

    github_token_env: str = "GH_TOKEN"
    token_cache_ttl_seconds: float = 3600.0
    refresh_before_expiry_seconds: float = 300.0
    # Azure/Graph fields — None defaults for forward-compat (Phase 2/3).
    azure_tenant_id: str | None = None
    azure_client_id: str | None = None


class TokenCacheEntry(BaseModel):
    """Cached credential with monotonic TTL tracking.

    The ``token`` field is excluded from serialization and repr to prevent
    accidental leakage into logs, error payloads, or telemetry.
    """

    token: str = Field(exclude=True, repr=False)
    provider: str
    expires_at: float | None = None

    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        return time.monotonic() >= self.expires_at

    def needs_refresh(self, buffer_seconds: float = 300.0) -> bool:
        if self.expires_at is None:
            return False
        return time.monotonic() >= (self.expires_at - buffer_seconds)


@runtime_checkable
class CredentialResolver(Protocol):
    """Protocol for credential resolvers."""

    async def resolve(self, provider: str) -> str:
        """Return a token for *provider*, or empty string on failure."""
        ...

    async def invalidate(self, provider: str) -> None:
        """Clear cached credentials for *provider*."""
        ...


class DefaultCredentialResolver:
    """Resolves credentials from environment variables only.

    It never runs a CLI such as ``gh auth token``, so connector commands declare no
    ``subprocess`` effect and a ``remote-caller`` host can run them. Currently supports
    GitHub only; Azure/Graph chains will be added in later phases.
    """

    def __init__(self, config: AuthConfig | None = None) -> None:
        self._config = config or AuthConfig()
        self._cache: dict[str, TokenCacheEntry] = {}

    async def resolve(self, provider: str) -> str:
        cached = self._cache.get(provider)
        if (
            cached is not None
            and not cached.is_expired()
            and not cached.needs_refresh(self._config.refresh_before_expiry_seconds)
        ):
            return cached.token

        token = await self._resolve_chain(provider)
        if token:
            self._cache[provider] = TokenCacheEntry(
                token=token,
                provider=provider,
                expires_at=time.monotonic() + self._config.token_cache_ttl_seconds,
            )
        return token

    async def invalidate(self, provider: str) -> None:
        self._cache.pop(provider, None)

    async def _resolve_chain(self, provider: str) -> str:
        if provider == "github":
            return await self._resolve_github()
        return ""

    async def _resolve_github(self) -> str:
        token = os.environ.get(self._config.github_token_env, "")
        if token:
            logger.debug("github auth resolved from env var %s", self._config.github_token_env)
        else:
            logger.debug("env var %s is unset; no github credential", self._config.github_token_env)
        return token
