"""Tests for auth module — spec 02."""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, patch

import httpx
import respx

from botcore_connectors.auth import (
    AuthConfig,
    DefaultCredentialResolver,
    TokenCacheEntry,
)
from botcore_connectors.base import ConnectorBase, ConnectorContext

BASE = "https://api.test.local"


# ---------------------------------------------------------------------------
# TokenCacheEntry — security invariants
# ---------------------------------------------------------------------------


class TestTokenCacheEntry:
    def test_model_dump_excludes_token(self) -> None:
        entry = TokenCacheEntry(token="ghp_secret123", provider="github")
        dumped = entry.model_dump()
        assert "token" not in dumped
        assert "github" == dumped["provider"]

    def test_repr_excludes_token(self) -> None:
        entry = TokenCacheEntry(token="ghp_secret123", provider="github")
        r = repr(entry)
        assert "ghp_secret123" not in r
        assert "github" in r

    def test_is_expired_false_when_no_expiry(self) -> None:
        entry = TokenCacheEntry(token="t", provider="x")
        assert entry.is_expired() is False

    def test_is_expired_false_when_future(self) -> None:
        entry = TokenCacheEntry(
            token="t", provider="x", expires_at=time.monotonic() + 3600
        )
        assert entry.is_expired() is False

    def test_is_expired_true_when_past(self) -> None:
        entry = TokenCacheEntry(
            token="t", provider="x", expires_at=time.monotonic() - 1
        )
        assert entry.is_expired() is True

    def test_needs_refresh_false_when_no_expiry(self) -> None:
        entry = TokenCacheEntry(token="t", provider="x")
        assert entry.needs_refresh() is False

    def test_needs_refresh_true_when_within_buffer(self) -> None:
        entry = TokenCacheEntry(
            token="t", provider="x", expires_at=time.monotonic() + 100
        )
        assert entry.needs_refresh(buffer_seconds=200) is True

    def test_needs_refresh_false_when_far_from_expiry(self) -> None:
        entry = TokenCacheEntry(
            token="t", provider="x", expires_at=time.monotonic() + 3600
        )
        assert entry.needs_refresh(buffer_seconds=300) is False


# ---------------------------------------------------------------------------
# AuthConfig — defaults
# ---------------------------------------------------------------------------


class TestAuthConfig:
    def test_defaults(self) -> None:
        cfg = AuthConfig()
        assert cfg.github_token_env == "GH_TOKEN"
        assert cfg.token_cache_ttl_seconds == 3600.0
        assert cfg.refresh_before_expiry_seconds == 300.0
        assert cfg.azure_tenant_id is None
        assert cfg.azure_client_id is None

    def test_custom_env_var(self) -> None:
        cfg = AuthConfig(github_token_env="CUSTOM_TOKEN")
        assert cfg.github_token_env == "CUSTOM_TOKEN"


# ---------------------------------------------------------------------------
# GitHub auth chain — resolver behavior
# ---------------------------------------------------------------------------


class TestGitHubAuthChain:
    async def test_resolves_from_env_var(self) -> None:
        resolver = DefaultCredentialResolver()
        with patch.dict("os.environ", {"GH_TOKEN": "env-token-123"}):
            token = await resolver.resolve("github")
        assert token == "env-token-123"

    async def test_custom_env_var_name(self) -> None:
        cfg = AuthConfig(github_token_env="MY_GH_TOKEN")
        resolver = DefaultCredentialResolver(config=cfg)
        with patch.dict("os.environ", {"MY_GH_TOKEN": "custom-token"}, clear=False):
            token = await resolver.resolve("github")
        assert token == "custom-token"

    async def test_falls_back_to_gh_cli(self) -> None:
        resolver = DefaultCredentialResolver()
        with (
            patch.dict("os.environ", {}, clear=False),
            patch("os.environ.get", return_value=""),
            patch("shutil.which", return_value="/usr/bin/gh"),
            patch(
                "botcore_connectors.auth.DefaultCredentialResolver._resolve_github_cli",
                new_callable=AsyncMock,
                return_value="cli-token-456",
            ) as mock_cli,
        ):
            token = await resolver.resolve("github")
        assert token == "cli-token-456"
        mock_cli.assert_awaited_once()

    async def test_returns_empty_when_both_fail(self) -> None:
        resolver = DefaultCredentialResolver()
        with (
            patch.dict("os.environ", {}, clear=False),
            patch("os.environ.get", return_value=""),
            patch("shutil.which", return_value=None),
        ):
            token = await resolver.resolve("github")
        assert token == ""

    async def test_returns_empty_when_gh_cli_errors(self) -> None:
        resolver = DefaultCredentialResolver()
        with (
            patch.dict("os.environ", {}, clear=False),
            patch("os.environ.get", return_value=""),
            patch("shutil.which", return_value="/usr/bin/gh"),
            patch(
                "botcore_connectors.auth.DefaultCredentialResolver._resolve_github_cli",
                new_callable=AsyncMock,
                return_value="",
            ),
        ):
            token = await resolver.resolve("github")
        assert token == ""

    async def test_unknown_provider_returns_empty(self) -> None:
        resolver = DefaultCredentialResolver()
        token = await resolver.resolve("unknown_provider")
        assert token == ""


# ---------------------------------------------------------------------------
# Token cache — caching behavior
# ---------------------------------------------------------------------------


class TestTokenCache:
    async def test_second_call_returns_cached(self) -> None:
        resolver = DefaultCredentialResolver()
        with patch.dict("os.environ", {"GH_TOKEN": "first-token"}):
            t1 = await resolver.resolve("github")

        # Change env — should NOT affect cached result.
        with patch.dict("os.environ", {"GH_TOKEN": "second-token"}):
            t2 = await resolver.resolve("github")

        assert t1 == "first-token"
        assert t2 == "first-token"

    async def test_invalidate_forces_re_resolution(self) -> None:
        resolver = DefaultCredentialResolver()
        with patch.dict("os.environ", {"GH_TOKEN": "old-token"}):
            await resolver.resolve("github")

        await resolver.invalidate("github")

        with patch.dict("os.environ", {"GH_TOKEN": "new-token"}):
            token = await resolver.resolve("github")
        assert token == "new-token"

    async def test_expired_cache_triggers_re_resolution(self) -> None:
        cfg = AuthConfig(token_cache_ttl_seconds=0)  # immediate expiry
        resolver = DefaultCredentialResolver(config=cfg)
        with patch.dict("os.environ", {"GH_TOKEN": "first"}):
            await resolver.resolve("github")

        with patch.dict("os.environ", {"GH_TOKEN": "second"}):
            token = await resolver.resolve("github")
        assert token == "second"

    async def test_near_expiry_triggers_refresh(self) -> None:
        cfg = AuthConfig(
            token_cache_ttl_seconds=1.0,
            refresh_before_expiry_seconds=5.0,  # buffer > TTL → always "near expiry"
        )
        resolver = DefaultCredentialResolver(config=cfg)
        with patch.dict("os.environ", {"GH_TOKEN": "first"}):
            await resolver.resolve("github")

        with patch.dict("os.environ", {"GH_TOKEN": "refreshed"}):
            token = await resolver.resolve("github")
        assert token == "refreshed"


# ---------------------------------------------------------------------------
# Connector auth + 401 retry — integration
# ---------------------------------------------------------------------------


def _make_connector(
    resolver: DefaultCredentialResolver | None = None,
    auth_provider: str | None = None,
) -> ConnectorBase:
    ctx = ConnectorContext(
        base_url=BASE,
        max_retries=0,
        jitter_max_seconds=0.0,
    )
    return ConnectorBase(ctx, resolver=resolver, auth_provider=auth_provider)


class TestConnectorAuth401Retry:
    @respx.mock
    async def test_401_invalidate_retry_success(self) -> None:
        """401 → invalidate → re-resolve → retry → 200."""
        call_count = 0

        async def resolve(provider: str) -> str:
            nonlocal call_count
            call_count += 1
            return "fresh-token" if call_count > 1 else "stale-token"

        resolver = AsyncMock()
        resolver.resolve = AsyncMock(side_effect=resolve)
        resolver.invalidate = AsyncMock()

        route = respx.get(f"{BASE}/data").mock(
            side_effect=[
                httpx.Response(401, json={"message": "bad creds"}),
                httpx.Response(200, json={"ok": True}),
            ]
        )

        async with _make_connector(resolver=resolver, auth_provider="github") as c:
            result = await c.api_call("GET", "/data")

        assert result.success is True
        assert result.data == {"ok": True}
        assert route.call_count == 2
        resolver.invalidate.assert_awaited_once_with("github")

    @respx.mock
    async def test_401_retry_still_401(self) -> None:
        """401 → retry → still 401 → returns AUTH_FAILED."""
        resolver = AsyncMock()
        resolver.resolve = AsyncMock(return_value="some-token")
        resolver.invalidate = AsyncMock()

        respx.get(f"{BASE}/data").mock(
            return_value=httpx.Response(401, json={"message": "nope"})
        )

        async with _make_connector(resolver=resolver, auth_provider="github") as c:
            result = await c.api_call("GET", "/data")

        assert result.success is False
        assert result.error.code == "AUTH_FAILED"

    @respx.mock
    async def test_401_re_resolve_empty_returns_refresh_failed(self) -> None:
        """401 → re-resolve returns empty → AUTH_REFRESH_FAILED."""
        call_count = 0

        async def resolve(provider: str) -> str:
            nonlocal call_count
            call_count += 1
            return "initial-token" if call_count == 1 else ""

        resolver = AsyncMock()
        resolver.resolve = AsyncMock(side_effect=resolve)
        resolver.invalidate = AsyncMock()

        respx.get(f"{BASE}/data").mock(
            return_value=httpx.Response(401, json={"message": "expired"})
        )

        async with _make_connector(resolver=resolver, auth_provider="github") as c:
            result = await c.api_call("GET", "/data")

        assert result.success is False
        assert result.error.code == "AUTH_REFRESH_FAILED"

    @respx.mock
    async def test_resolver_returns_empty_initially(self) -> None:
        """Resolver returns empty → GITHUB_AUTH_MISSING immediately."""
        resolver = AsyncMock()
        resolver.resolve = AsyncMock(return_value="")

        route = respx.get(f"{BASE}/data").mock(
            return_value=httpx.Response(200, json={})
        )

        async with _make_connector(resolver=resolver, auth_provider="github") as c:
            result = await c.api_call("GET", "/data")

        assert result.success is False
        assert result.error.code == "GITHUB_AUTH_MISSING"
        assert route.call_count == 0  # never sent

    @respx.mock
    async def test_no_resolver_no_auth_injection(self) -> None:
        """No resolver → backward-compat, no auth header."""
        route = respx.get(f"{BASE}/data").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )

        async with _make_connector() as c:
            result = await c.api_call("GET", "/data")

        assert result.success is True
        request = route.calls.last.request
        assert "Authorization" not in request.headers


# ---------------------------------------------------------------------------
# Token security invariants
# ---------------------------------------------------------------------------


class TestTokenSecurityInvariants:
    def test_token_not_in_model_dump(self) -> None:
        entry = TokenCacheEntry(token="super-secret", provider="github")
        dumped = entry.model_dump()
        assert "super-secret" not in str(dumped)

    def test_token_not_in_json(self) -> None:
        entry = TokenCacheEntry(token="super-secret", provider="github")
        json_str = entry.model_dump_json()
        assert "super-secret" not in json_str

    @respx.mock
    async def test_auth_header_sent_on_outbound_request(self) -> None:
        """The Bearer token IS present on the wire."""
        resolver = AsyncMock()
        resolver.resolve = AsyncMock(return_value="wire-token-xyz")

        route = respx.get(f"{BASE}/data").mock(
            return_value=httpx.Response(200, json={})
        )

        async with _make_connector(resolver=resolver, auth_provider="github") as c:
            await c.api_call("GET", "/data")

        request = route.calls.last.request
        assert request.headers["Authorization"] == "Bearer wire-token-xyz"

    def test_token_not_in_sanitize_args_output(self) -> None:
        from botcore_connectors.audit import sanitize_args

        result = sanitize_args({"token": "super-secret", "repo": "a/b"})
        assert "super-secret" not in result
        assert "***REDACTED***" in result

    def test_token_not_in_audit_log_entry(self) -> None:
        from botcore_connectors.audit import AuditLogger

        entry = AuditLogger().log(
            agent_id="agent-1",
            connector="github",
            command="list_issues",
            args={"token": "ghp_super_secret_value"},
            result_status="success",
            latency_ms=10.0,
            trace_id="t1",
        )
        assert "ghp_super_secret_value" not in entry.args_summary
        assert "ghp_super_secret_value" not in entry.model_dump_json()
