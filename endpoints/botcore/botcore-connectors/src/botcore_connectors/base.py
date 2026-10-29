"""Connector base layer — shared HTTP client, retry, rate limiting, telemetry."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from random import uniform
from typing import Any

import httpx
from afd import CommandResult, success
from afd.core.result import ResultMetadata
from pydantic import BaseModel, Field

from botcore_connectors.auth import CredentialResolver
from botcore_connectors.errors import (
    RETRYABLE_STATUS_CODES,
    auth_refresh_failed,
    github_auth_missing,
    map_status_to_error,
    network_error,
)

logger = logging.getLogger(__name__)

# Network errors get fewer retries than HTTP errors (per spec).
_MAX_NETWORK_RETRIES = 2


class ConnectorContext(BaseModel):
    """Immutable configuration passed to every connector instance."""

    base_url: str
    default_headers: dict[str, str] = Field(default_factory=dict)
    timeout_seconds: float = Field(default=30.0, gt=0)
    max_retries: int = Field(default=3, ge=0)
    backoff_factor: float = Field(default=2.0)
    rate_limit_rps: float = Field(default=10.0, gt=0)
    jitter_max_seconds: float = Field(default=1.0)


class ConnectorBase:
    """Shared base for all HTTP connectors.

    Provides ``api_call`` with inlined middleware behaviour:
    trace ID → logging → rate limit → retry → HTTP → error mapping.
    """

    def __init__(
        self,
        context: ConnectorContext,
        *,
        resolver: CredentialResolver | None = None,
        auth_provider: str | None = None,
    ) -> None:
        self.context = context
        self._resolver = resolver
        self._auth_provider = auth_provider or ""
        self._client: httpx.AsyncClient | None = None
        self._semaphore = asyncio.Semaphore(max(1, int(context.rate_limit_rps)))

    # -- lifecycle ------------------------------------------------------------

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.context.base_url,
                timeout=self.context.timeout_seconds,
            )
        return self._client

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> ConnectorBase:
        self._ensure_client()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    # -- public API -----------------------------------------------------------

    async def api_call(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> CommandResult[dict[str, Any]]:
        """Make an HTTP request through the middleware stack.

        Returns ``CommandResult`` for **all** outcomes — never raises.
        """
        trace_id = uuid.uuid4().hex[:16]
        start = time.monotonic()

        merged_headers = {**self.context.default_headers, "X-Trace-Id": trace_id}
        if headers:
            merged_headers.update(headers)

        # Auth injection — resolve token before sending request.
        if self._resolver is not None:
            token = await self._resolver.resolve(self._auth_provider)
            if not token:
                result = github_auth_missing()
                elapsed_ms = round((time.monotonic() - start) * 1000, 1)
                metadata = ResultMetadata(trace_id=trace_id, execution_time_ms=elapsed_ms)
                return _attach_metadata(result, metadata)
            merged_headers["Authorization"] = f"Bearer {token}"

        logger.debug("connector request  trace=%s %s %s", trace_id, method, path)

        result = await self._execute_with_retry(method, path, json, params, merged_headers)

        # Auth retry — on 401, invalidate + re-resolve once.
        if (
            self._resolver is not None
            and result.error is not None
            and result.error.code == "AUTH_FAILED"
        ):
            await self._resolver.invalidate(self._auth_provider)
            token = await self._resolver.resolve(self._auth_provider)
            if not token:
                result = auth_refresh_failed(self._auth_provider)
            else:
                merged_headers["Authorization"] = f"Bearer {token}"
                result = await self._execute_with_retry(
                    method, path, json, params, merged_headers
                )

        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        logger.debug("connector response trace=%s elapsed=%sms", trace_id, elapsed_ms)

        metadata = ResultMetadata(trace_id=trace_id, execution_time_ms=elapsed_ms)
        return _attach_metadata(result, metadata)

    # -- internals ------------------------------------------------------------

    async def _execute_with_retry(
        self,
        method: str,
        path: str,
        json: dict[str, Any] | None,
        params: dict[str, str] | None,
        headers: dict[str, str],
    ) -> CommandResult[dict[str, Any]]:
        """Retry loop with rate-limit gating."""
        ctx = self.context
        last_result: CommandResult[dict[str, Any]] | None = None
        network_failures = 0

        for attempt in range(ctx.max_retries + 1):
            # Rate-limit gate — acquire then schedule delayed release.
            await self._semaphore.acquire()
            self._schedule_release()

            try:
                response = await self._send(method, path, json, params, headers)
            except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
                network_failures += 1
                last_result = network_error(exc)
                if network_failures > _MAX_NETWORK_RETRIES:
                    return last_result
                await self._backoff(attempt, network=True)
                continue

            if response.status_code < 400:
                return _success_from_response(response)

            last_result = _error_from_response(response)

            if response.status_code not in RETRYABLE_STATUS_CODES:
                return last_result

            if attempt < ctx.max_retries:
                retry_after = _parse_retry_after(response)
                await self._backoff(attempt, retry_after_seconds=retry_after)

        # All retries exhausted.
        assert last_result is not None  # noqa: S101
        return last_result

    async def _send(
        self,
        method: str,
        path: str,
        json: dict[str, Any] | None,
        params: dict[str, str] | None,
        headers: dict[str, str],
    ) -> httpx.Response:
        client = self._ensure_client()
        return await client.request(method, path, json=json, params=params, headers=headers)

    async def _backoff(
        self,
        attempt: int,
        *,
        network: bool = False,
        retry_after_seconds: float | None = None,
    ) -> None:
        ctx = self.context
        if retry_after_seconds is not None:
            delay = retry_after_seconds
        else:
            base = 1.0 if network else ctx.backoff_factor
            delay = base * (2**attempt)
        jitter = uniform(0, ctx.jitter_max_seconds)  # noqa: S311
        await asyncio.sleep(delay + jitter)

    def _schedule_release(self) -> None:
        """Release the rate-limit semaphore after ``1/rate_limit_rps`` seconds."""
        delay = 1.0 / self.context.rate_limit_rps
        loop = asyncio.get_running_loop()
        loop.call_later(delay, self._semaphore.release)


# -- helpers (module-level, stateless) ----------------------------------------


def _success_from_response(response: httpx.Response) -> CommandResult[dict[str, Any]]:
    try:
        data = response.json()
    except Exception:
        data = {"raw": response.text}
    return success(data=data)


def _error_from_response(response: httpx.Response) -> CommandResult[dict[str, Any]]:
    try:
        body: dict[str, Any] | str = response.json()
    except Exception:
        body = response.text
    return map_status_to_error(response.status_code, body)


def _parse_retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After")
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _attach_metadata(
    result: CommandResult[dict[str, Any]],
    metadata: ResultMetadata,
) -> CommandResult[dict[str, Any]]:
    """Return a copy of *result* with metadata set."""
    return result.model_copy(update={"metadata": metadata})
