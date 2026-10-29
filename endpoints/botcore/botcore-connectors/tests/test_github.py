"""Tests for GitHubConnector — init, rate-limit capture, error remap, backoff."""

from __future__ import annotations

import time

import httpx
import respx

from botcore_connectors.config import GitHubConnectorConfig
from botcore_connectors.github import GITHUB_API_BASE, GitHubConnector

GH = GITHUB_API_BASE


# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------


class TestGitHubConnectorInit:
    def test_context_defaults(self, github_config: GitHubConnectorConfig) -> None:
        c = GitHubConnector(github_config)
        assert c.context.base_url == GH

    def test_api_version_header(self, github_config: GitHubConnectorConfig) -> None:
        c = GitHubConnector(github_config)
        assert c.context.default_headers["X-GitHub-Api-Version"] == "2022-11-28"

    def test_accept_header(self, github_config: GitHubConnectorConfig) -> None:
        c = GitHubConnector(github_config)
        assert c.context.default_headers["Accept"] == "application/vnd.github+json"

    def test_default_repo(self, github_config: GitHubConnectorConfig) -> None:
        c = GitHubConnector(github_config)
        assert c.default_repo == "octocat/hello-world"


# ---------------------------------------------------------------------------
# Rate-limit capture
# ---------------------------------------------------------------------------


class TestRateLimitCapture:
    @respx.mock
    async def test_captures_api_remaining(self, github_connector: GitHubConnector) -> None:
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(
                200, json={}, headers={"X-RateLimit-Remaining": "42", "X-RateLimit-Reset": "99"}
            )
        )
        await github_connector.api_call("GET", "/repos/a/b")
        assert github_connector._api_rate_remaining == 42
        assert github_connector._api_rate_reset == 99.0

    @respx.mock
    async def test_captures_search_remaining(self, github_connector: GitHubConnector) -> None:
        respx.get(f"{GH}/search/code").mock(
            return_value=httpx.Response(
                200,
                json={"items": [], "total_count": 0},
                headers={"X-RateLimit-Remaining": "10", "X-RateLimit-Reset": "200"},
            )
        )
        await github_connector.api_call("GET", "/search/code", params={"q": "test"})
        assert github_connector._search_rate_remaining == 10
        assert github_connector._search_rate_reset == 200.0

    @respx.mock
    async def test_api_and_search_tracked_separately(
        self, github_connector: GitHubConnector
    ) -> None:
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(
                200, json={}, headers={"X-RateLimit-Remaining": "100"}
            )
        )
        respx.get(f"{GH}/search/issues").mock(
            return_value=httpx.Response(
                200,
                json={"items": [], "total_count": 0},
                headers={"X-RateLimit-Remaining": "5"},
            )
        )
        await github_connector.api_call("GET", "/repos/a/b")
        await github_connector.api_call("GET", "/search/issues", params={"q": "x"})
        assert github_connector._api_rate_remaining == 100
        assert github_connector._search_rate_remaining == 5

    @respx.mock
    async def test_missing_headers_leaves_none(self, github_connector: GitHubConnector) -> None:
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(200, json={})
        )
        await github_connector.api_call("GET", "/repos/a/b")
        assert github_connector._api_rate_remaining is None
        assert github_connector._api_rate_reset is None

    @respx.mock
    async def test_malformed_remaining_ignored(self, github_connector: GitHubConnector) -> None:
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(
                200, json={}, headers={"X-RateLimit-Remaining": "bad"}
            )
        )
        await github_connector.api_call("GET", "/repos/a/b")
        assert github_connector._api_rate_remaining is None

    @respx.mock
    async def test_updates_on_subsequent_calls(self, github_connector: GitHubConnector) -> None:
        respx.get(f"{GH}/repos/a/b").mock(
            side_effect=[
                httpx.Response(200, json={}, headers={"X-RateLimit-Remaining": "50"}),
                httpx.Response(200, json={}, headers={"X-RateLimit-Remaining": "49"}),
            ]
        )
        await github_connector.api_call("GET", "/repos/a/b")
        assert github_connector._api_rate_remaining == 50
        await github_connector.api_call("GET", "/repos/a/b")
        assert github_connector._api_rate_remaining == 49


# ---------------------------------------------------------------------------
# gh_api_call error remapping
# ---------------------------------------------------------------------------


class TestGhApiCallRemap:
    @respx.mock
    async def test_not_found_remaps(self, github_connector: GitHubConnector) -> None:
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(404, json={"message": "Not Found"})
        )
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        assert result.error is not None
        assert result.error.code == "GITHUB_NOT_FOUND"

    @respx.mock
    async def test_rate_limited_remaps(self, github_connector: GitHubConnector) -> None:
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(
                429, json={"message": "rate limit"}, headers={"Retry-After": "0"}
            )
        )
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        assert result.error is not None
        assert result.error.code == "GITHUB_RATE_LIMITED"

    @respx.mock
    async def test_search_rate_limited_remaps(self, github_connector: GitHubConnector) -> None:
        respx.get(f"{GH}/search/code").mock(
            return_value=httpx.Response(
                429, json={"message": "rate limit"}, headers={"Retry-After": "0"}
            )
        )
        result = await github_connector.gh_api_call("GET", "/search/code", params={"q": "x"})
        assert result.error is not None
        # Search 429s also remap via GITHUB_ERROR_REMAP
        assert result.error.code == "GITHUB_RATE_LIMITED"

    @respx.mock
    async def test_validation_error_remaps(self, github_connector: GitHubConnector) -> None:
        respx.post(f"{GH}/repos/a/b/issues").mock(
            return_value=httpx.Response(422, json={"message": "Validation Failed"})
        )
        result = await github_connector.gh_api_call(
            "POST", "/repos/a/b/issues", json={"title": "x"}
        )
        assert result.error is not None
        assert result.error.code == "GITHUB_VALIDATION_ERROR"

    @respx.mock
    async def test_unmapped_code_passes_through(self, github_connector: GitHubConnector) -> None:
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(403, json={"message": "Forbidden"})
        )
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        assert result.error is not None
        assert result.error.code == "FORBIDDEN"  # not remapped


# ---------------------------------------------------------------------------
# Pre-flight rate check
# ---------------------------------------------------------------------------


class TestPreFlightRateCheck:
    @respx.mock
    async def test_api_remaining_zero_returns_error(
        self, github_connector: GitHubConnector
    ) -> None:
        github_connector._api_rate_remaining = 0
        github_connector._api_rate_reset = time.time() + 60
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        assert result.error is not None
        assert result.error.code == "GITHUB_RATE_LIMITED"

    @respx.mock
    async def test_search_remaining_zero_returns_error(
        self, github_connector: GitHubConnector
    ) -> None:
        github_connector._search_rate_remaining = 0
        result = await github_connector.gh_api_call(
            "GET", "/search/code", params={"q": "test"}
        )
        assert result.error is not None
        assert result.error.code == "GITHUB_SEARCH_RATE_LIMITED"

    @respx.mock
    async def test_api_remaining_zero_with_past_reset_allows_request(
        self, github_connector: GitHubConnector
    ) -> None:
        github_connector._api_rate_remaining = 0
        github_connector._api_rate_reset = time.time() - 1
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        assert result.success is True

    @respx.mock
    async def test_search_remaining_zero_with_past_reset_allows_request(
        self, github_connector: GitHubConnector
    ) -> None:
        github_connector._search_rate_remaining = 0
        github_connector._search_rate_reset = time.time() - 1
        respx.get(f"{GH}/search/code").mock(
            return_value=httpx.Response(200, json={"items": [], "total_count": 0})
        )
        result = await github_connector.gh_api_call(
            "GET", "/search/code", params={"q": "test"}
        )
        assert result.success is True

    @respx.mock
    async def test_remaining_positive_passes(
        self, github_connector: GitHubConnector
    ) -> None:
        github_connector._api_rate_remaining = 10
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        assert result.success is True

    @respx.mock
    async def test_remaining_none_passes(
        self, github_connector: GitHubConnector
    ) -> None:
        assert github_connector._api_rate_remaining is None
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        assert result.success is True


# ---------------------------------------------------------------------------
# Backoff uses reset timestamp
# ---------------------------------------------------------------------------


class TestBackoffUsesReset:
    @respx.mock
    async def test_uses_reset_for_429(self, github_connector: GitHubConnector) -> None:
        """When X-RateLimit-Reset is set, backoff should use it for 429."""
        # Set reset to ~now so backoff is ~0
        github_connector._api_rate_reset = time.time()
        respx.get(f"{GH}/repos/a/b").mock(
            side_effect=[
                httpx.Response(
                    429,
                    json={},
                    headers={"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": str(time.time())},
                ),
                httpx.Response(200, json={"ok": True}),
            ]
        )
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        # Pre-flight won't block because _api_rate_remaining is None initially
        # But after first 429, backoff should use reset time
        assert result.success is True

    @respx.mock
    async def test_search_uses_search_reset(self, github_connector: GitHubConnector) -> None:
        """Search requests should use _search_rate_reset, not _api_rate_reset."""
        github_connector._search_rate_reset = time.time()
        github_connector._api_rate_reset = time.time() + 3600  # far future — must not be used
        respx.get(f"{GH}/search/code").mock(
            side_effect=[
                httpx.Response(
                    429,
                    json={},
                    headers={
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(time.time()),
                    },
                ),
                httpx.Response(200, json={"items": [], "total_count": 0}),
            ]
        )
        result = await github_connector.gh_api_call(
            "GET", "/search/code", params={"q": "test"}
        )
        assert result.success is True

    @respx.mock
    async def test_falls_back_to_base_without_reset(
        self, github_connector: GitHubConnector
    ) -> None:
        """Without X-RateLimit-Reset, falls back to base exponential backoff."""
        assert github_connector._api_rate_reset is None
        respx.get(f"{GH}/repos/a/b").mock(
            side_effect=[
                httpx.Response(429, json={}, headers={"Retry-After": "0"}),
                httpx.Response(200, json={"ok": True}),
            ]
        )
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        assert result.success is True

    @respx.mock
    async def test_network_error_unaffected_by_reset(
        self, github_connector: GitHubConnector
    ) -> None:
        """Network errors should use base backoff, not rate-limit reset."""
        github_connector._api_rate_reset = time.time() + 3600  # far future
        respx.get(f"{GH}/repos/a/b").mock(
            side_effect=[
                httpx.ConnectError("refused"),
                httpx.Response(200, json={"ok": True}),
            ]
        )
        result = await github_connector.gh_api_call("GET", "/repos/a/b")
        assert result.success is True


# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------


class TestAuditIntegration:
    @respx.mock
    async def test_gh_api_call_emits_audit_log(
        self, github_connector: GitHubConnector
    ) -> None:
        """Every gh_api_call must emit an audit log entry (spec 04)."""
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        # Capture audit log output
        import logging

        audit_logger = logging.getLogger("botcore.connectors.audit")
        messages: list[str] = []
        handler = logging.Handler()
        handler.emit = lambda record: messages.append(record.getMessage())
        audit_logger.addHandler(handler)
        audit_logger.setLevel(logging.DEBUG)
        try:
            await github_connector.gh_api_call("GET", "/repos/a/b")
            assert len(messages) == 1
            assert "github" in messages[0]
            assert "GET /repos/a/b" in messages[0]
        finally:
            audit_logger.removeHandler(handler)

    @respx.mock
    async def test_audit_captures_error_status(
        self, github_connector: GitHubConnector
    ) -> None:
        respx.get(f"{GH}/repos/a/b").mock(
            return_value=httpx.Response(404, json={"message": "Not Found"})
        )
        import logging

        audit_logger = logging.getLogger("botcore.connectors.audit")
        messages: list[str] = []
        handler = logging.Handler()
        handler.emit = lambda record: messages.append(record.getMessage())
        audit_logger.addHandler(handler)
        audit_logger.setLevel(logging.DEBUG)
        try:
            await github_connector.gh_api_call("GET", "/repos/a/b")
            assert len(messages) == 1
            assert "GITHUB_NOT_FOUND" in messages[0]
        finally:
            audit_logger.removeHandler(handler)
