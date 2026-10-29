"""GitHub connector — subclass of ConnectorBase with rate-limit tracking + error remap."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from afd import CommandResult

from botcore_connectors.audit import AuditLogger
from botcore_connectors.auth import CredentialResolver
from botcore_connectors.base import ConnectorBase, ConnectorContext
from botcore_connectors.config import GitHubConnectorConfig
from botcore_connectors.errors import (
    GITHUB_ERROR_REMAP,
    github_rate_limited,
    github_search_rate_limited,
)

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


class GitHubConnector(ConnectorBase):
    """GitHub REST API connector with dual rate-limit tracking and error remapping."""

    def __init__(
        self,
        config: GitHubConnectorConfig,
        *,
        resolver: CredentialResolver | None = None,
    ) -> None:
        context = ConnectorContext(
            base_url=GITHUB_API_BASE,
            default_headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": config.api_version,
            },
        )
        super().__init__(context, resolver=resolver, auth_provider="github")
        self._github_config = config
        self._audit = AuditLogger()

        # Dual rate-limit tracking (API vs search).
        self._api_rate_remaining: int | None = None
        self._api_rate_reset: float | None = None
        self._search_rate_remaining: int | None = None
        self._search_rate_reset: float | None = None
        self._current_path: str = ""  # tracks path for _backoff context

    @property
    def default_repo(self) -> str | None:
        return self._github_config.default_repo

    def _is_rate_limited(self, *, is_search: bool) -> bool:
        """Return True when cached rate-limit state indicates request must wait.

        If the reset timestamp has passed, stale counters are cleared so the next
        request can proceed and refresh fresh header state from GitHub.
        """
        remaining = self._search_rate_remaining if is_search else self._api_rate_remaining
        reset = self._search_rate_reset if is_search else self._api_rate_reset

        if remaining is None or remaining > 0:
            return False

        if reset is not None and reset <= time.time():
            if is_search:
                self._search_rate_remaining = None
                self._search_rate_reset = None
            else:
                self._api_rate_remaining = None
                self._api_rate_reset = None
            return False

        return True

    # -- _send override: capture X-RateLimit-* headers -------------------------

    async def _send(
        self,
        method: str,
        path: str,
        json: dict[str, Any] | None,
        params: dict[str, str] | None,
        headers: dict[str, str],
    ) -> httpx.Response:
        response = await super()._send(method, path, json, params, headers)
        self._capture_rate_headers(path, response)
        return response

    def _capture_rate_headers(self, path: str, response: httpx.Response) -> None:
        remaining_raw = response.headers.get("X-RateLimit-Remaining")
        reset_raw = response.headers.get("X-RateLimit-Reset")

        remaining: int | None = None
        reset: float | None = None

        if remaining_raw is not None:
            try:
                remaining = int(remaining_raw)
            except (ValueError, TypeError):
                pass

        if reset_raw is not None:
            try:
                reset = float(reset_raw)
            except (ValueError, TypeError):
                pass

        is_search = "/search/" in path
        if is_search:
            self._search_rate_remaining = remaining
            self._search_rate_reset = reset
        else:
            self._api_rate_remaining = remaining
            self._api_rate_reset = reset

    # -- _backoff override: use X-RateLimit-Reset for 429 timing ---------------

    async def _backoff(
        self,
        attempt: int,
        *,
        network: bool = False,
        retry_after_seconds: float | None = None,
    ) -> None:
        if not network and retry_after_seconds is None:
            # Pick the correct reset timestamp based on the request path.
            is_search = "/search/" in self._current_path
            reset = self._search_rate_reset if is_search else self._api_rate_reset
            if reset is not None:
                now = time.time()
                wait = max(0.0, reset - now)
                if wait > 0:
                    await super()._backoff(attempt, retry_after_seconds=wait)
                    return
        await super()._backoff(
            attempt, network=network, retry_after_seconds=retry_after_seconds
        )

    # -- gh_api_call: pre-flight check + error remapping -----------------------

    async def gh_api_call(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> CommandResult[dict[str, Any]]:
        """GitHub-specific API call with pre-flight rate check and error remapping."""
        self._current_path = path  # track for _backoff context
        # Pre-flight rate check.
        is_search = "/search/" in path
        if is_search and self._is_rate_limited(is_search=True):
            return github_search_rate_limited()
        if not is_search and self._is_rate_limited(is_search=False):
            return github_rate_limited(self._api_rate_reset)

        result = await self.api_call(
            method, path, json=json, params=params, headers=headers
        )

        # Remap generic error codes to GitHub-specific codes.
        if result.error is not None and result.error.code in GITHUB_ERROR_REMAP:
            new_code = GITHUB_ERROR_REMAP[result.error.code]
            new_error = result.error.model_copy(update={"code": new_code})
            result = result.model_copy(update={"error": new_error, "success": False})

        # Emit audit log entry (spec 04 — non-blocking, never crashes pipeline).
        meta = result.metadata
        audit_args = dict((json or params or {}).items()) if (json or params) else {}
        status = "success" if result.success else (
            result.error.code if result.error else "error"
        )
        self._audit.log(
            agent_id="",  # populated by orchestration layer
            connector="github",
            command=f"{method} {path}",
            args=audit_args,
            result_status=status,
            latency_ms=meta.execution_time_ms if meta else 0.0,
            trace_id=meta.trace_id if meta else "",
        )

        return result
