"""Tests for ConnectorBase — waves 1-4 per spec 01."""

from __future__ import annotations

import httpx
import pytest
import respx

from botcore_connectors.base import ConnectorBase, ConnectorContext

BASE = "https://api.test.local"


# ---------------------------------------------------------------------------
# Wave 1 — Core Protocol
# ---------------------------------------------------------------------------


class TestConnectorContext:
    def test_defaults(self) -> None:
        ctx = ConnectorContext(base_url="https://example.com")
        assert ctx.timeout_seconds == 30.0
        assert ctx.max_retries == 3
        assert ctx.backoff_factor == 2.0
        assert ctx.rate_limit_rps == 10.0
        assert ctx.default_headers == {}

    def test_rejects_negative_timeout(self) -> None:
        with pytest.raises(Exception):  # noqa: B017
            ConnectorContext(base_url="https://x.com", timeout_seconds=-1)

    def test_rejects_zero_timeout(self) -> None:
        with pytest.raises(Exception):  # noqa: B017
            ConnectorContext(base_url="https://x.com", timeout_seconds=0)

    def test_rejects_negative_rate_limit(self) -> None:
        with pytest.raises(Exception):  # noqa: B017
            ConnectorContext(base_url="https://x.com", rate_limit_rps=-5)

    def test_allows_zero_retries(self) -> None:
        ctx = ConnectorContext(base_url="https://x.com", max_retries=0)
        assert ctx.max_retries == 0


class TestApiCallSuccess:
    @respx.mock
    async def test_success_returns_command_result(self, connector: ConnectorBase) -> None:
        respx.get(f"{BASE}/repos").mock(
            return_value=httpx.Response(200, json={"items": [1, 2, 3]})
        )
        result = await connector.api_call("GET", "/repos")

        assert result.success is True
        assert result.data == {"items": [1, 2, 3]}

    @respx.mock
    async def test_sends_default_headers(self, connector: ConnectorBase) -> None:
        route = respx.get(f"{BASE}/test").mock(
            return_value=httpx.Response(200, json={})
        )
        await connector.api_call("GET", "/test")

        request = route.calls.last.request
        assert request.headers["Accept"] == "application/json"

    @respx.mock
    async def test_sends_custom_headers(self, connector: ConnectorBase) -> None:
        route = respx.get(f"{BASE}/test").mock(
            return_value=httpx.Response(200, json={})
        )
        await connector.api_call("GET", "/test", headers={"X-Custom": "val"})

        request = route.calls.last.request
        assert request.headers["X-Custom"] == "val"


# ---------------------------------------------------------------------------
# Wave 2 — Error Mapping
# ---------------------------------------------------------------------------


class TestErrorMapping:
    @respx.mock
    @pytest.mark.parametrize(
        "status,expected_code",
        [
            (400, "BAD_REQUEST"),
            (401, "AUTH_FAILED"),
            (403, "FORBIDDEN"),
            (404, "NOT_FOUND"),
            (409, "CONFLICT"),
            (422, "VALIDATION_ERROR"),
            (429, "RATE_LIMITED"),
            (500, "SERVICE_ERROR"),
            (502, "SERVICE_ERROR"),
            (503, "SERVICE_ERROR"),
            (504, "SERVICE_ERROR"),
        ],
    )
    async def test_status_maps_to_error_code(
        self, status: int, expected_code: str
    ) -> None:
        ctx = ConnectorContext(
            base_url=BASE,
            max_retries=0,
            jitter_max_seconds=0.0,
        )
        async with ConnectorBase(ctx) as c:
            respx.get(f"{BASE}/err").mock(
                return_value=httpx.Response(status, json={"message": "fail"})
            )
            result = await c.api_call("GET", "/err")

        assert result.success is False
        assert result.error is not None
        assert result.error.code == expected_code

    @respx.mock
    async def test_error_has_suggestion(self) -> None:
        ctx = ConnectorContext(base_url=BASE, max_retries=0, jitter_max_seconds=0.0)
        async with ConnectorBase(ctx) as c:
            respx.get(f"{BASE}/err").mock(
                return_value=httpx.Response(403, json={})
            )
            result = await c.api_call("GET", "/err")

        assert result.error is not None
        assert result.error.suggestion
        assert len(result.error.suggestion) > 0

    @respx.mock
    async def test_unknown_4xx_maps_to_client_error(self) -> None:
        ctx = ConnectorContext(base_url=BASE, max_retries=0, jitter_max_seconds=0.0)
        async with ConnectorBase(ctx) as c:
            respx.get(f"{BASE}/err").mock(
                return_value=httpx.Response(418, json={})
            )
            result = await c.api_call("GET", "/err")

        assert result.success is False
        assert result.error.code == "CLIENT_ERROR"

    @respx.mock
    async def test_network_error_no_exception(self) -> None:
        ctx = ConnectorContext(
            base_url=BASE, max_retries=0, jitter_max_seconds=0.0, timeout_seconds=1.0
        )
        async with ConnectorBase(ctx) as c:
            respx.get(f"{BASE}/err").mock(side_effect=httpx.ConnectError("refused"))
            result = await c.api_call("GET", "/err")

        assert result.success is False
        assert result.error.code == "NETWORK_ERROR"

    @respx.mock
    async def test_timeout_returns_network_error(self) -> None:
        ctx = ConnectorContext(
            base_url=BASE, max_retries=0, jitter_max_seconds=0.0, timeout_seconds=0.1
        )
        async with ConnectorBase(ctx) as c:
            respx.get(f"{BASE}/err").mock(
                side_effect=httpx.ReadTimeout("timed out")
            )
            result = await c.api_call("GET", "/err")

        assert result.success is False
        assert result.error.code == "NETWORK_ERROR"


# ---------------------------------------------------------------------------
# Wave 3 — Retry
# ---------------------------------------------------------------------------


class TestRetry:
    @respx.mock
    async def test_retries_429_then_succeeds(self) -> None:
        ctx = ConnectorContext(
            base_url=BASE,
            max_retries=3,
            backoff_factor=0.01,
            jitter_max_seconds=0.0,
        )
        route = respx.get(f"{BASE}/data").mock(
            side_effect=[
                httpx.Response(429, json={}, headers={"Retry-After": "0"}),
                httpx.Response(200, json={"ok": True}),
            ]
        )
        async with ConnectorBase(ctx) as c:
            result = await c.api_call("GET", "/data")

        assert result.success is True
        assert result.data == {"ok": True}
        assert route.call_count == 2

    @respx.mock
    async def test_retries_5xx_then_succeeds(self) -> None:
        ctx = ConnectorContext(
            base_url=BASE,
            max_retries=3,
            backoff_factor=0.01,
            jitter_max_seconds=0.0,
        )
        route = respx.get(f"{BASE}/data").mock(
            side_effect=[
                httpx.Response(503, json={}),
                httpx.Response(200, json={"ok": True}),
            ]
        )
        async with ConnectorBase(ctx) as c:
            result = await c.api_call("GET", "/data")

        assert result.success is True
        assert route.call_count == 2

    @respx.mock
    async def test_no_retry_on_4xx(self) -> None:
        ctx = ConnectorContext(
            base_url=BASE,
            max_retries=3,
            jitter_max_seconds=0.0,
        )
        route = respx.get(f"{BASE}/data").mock(
            return_value=httpx.Response(404, json={"message": "not found"})
        )
        async with ConnectorBase(ctx) as c:
            result = await c.api_call("GET", "/data")

        assert result.success is False
        assert result.error.code == "NOT_FOUND"
        assert route.call_count == 1

    @respx.mock
    async def test_respects_retry_after_header(self) -> None:
        ctx = ConnectorContext(
            base_url=BASE,
            max_retries=3,
            backoff_factor=100.0,  # huge — should be overridden by Retry-After
            jitter_max_seconds=0.0,
        )
        route = respx.get(f"{BASE}/data").mock(
            side_effect=[
                httpx.Response(429, json={}, headers={"Retry-After": "0"}),
                httpx.Response(200, json={"ok": True}),
            ]
        )
        async with ConnectorBase(ctx) as c:
            result = await c.api_call("GET", "/data")

        assert result.success is True
        assert route.call_count == 2

    @respx.mock
    async def test_max_retries_exhausted(self) -> None:
        ctx = ConnectorContext(
            base_url=BASE,
            max_retries=2,
            backoff_factor=0.01,
            jitter_max_seconds=0.0,
        )
        route = respx.get(f"{BASE}/data").mock(
            return_value=httpx.Response(503, json={"message": "down"})
        )
        async with ConnectorBase(ctx) as c:
            result = await c.api_call("GET", "/data")

        assert result.success is False
        assert result.error.code == "SERVICE_ERROR"
        # 1 initial + 2 retries = 3 total
        assert route.call_count == 3


# ---------------------------------------------------------------------------
# Wave 4 — Telemetry
# ---------------------------------------------------------------------------


class TestTelemetry:
    @respx.mock
    async def test_trace_id_header_sent(self, connector: ConnectorBase) -> None:
        route = respx.get(f"{BASE}/test").mock(
            return_value=httpx.Response(200, json={})
        )
        await connector.api_call("GET", "/test")

        request = route.calls.last.request
        trace_id = request.headers.get("X-Trace-Id")
        assert trace_id is not None
        assert len(trace_id) == 16

    @respx.mock
    async def test_metadata_has_timing(self, connector: ConnectorBase) -> None:
        respx.get(f"{BASE}/test").mock(
            return_value=httpx.Response(200, json={})
        )
        result = await connector.api_call("GET", "/test")

        assert result.metadata is not None
        assert result.metadata.execution_time_ms is not None
        assert result.metadata.execution_time_ms >= 0

    @respx.mock
    async def test_metadata_has_trace_id(self, connector: ConnectorBase) -> None:
        respx.get(f"{BASE}/test").mock(
            return_value=httpx.Response(200, json={})
        )
        result = await connector.api_call("GET", "/test")

        assert result.metadata is not None
        assert result.metadata.trace_id is not None
        assert len(result.metadata.trace_id) == 16

    @respx.mock
    async def test_each_call_gets_unique_trace_id(self, connector: ConnectorBase) -> None:
        respx.get(f"{BASE}/test").mock(
            return_value=httpx.Response(200, json={})
        )
        r1 = await connector.api_call("GET", "/test")
        r2 = await connector.api_call("GET", "/test")

        assert r1.metadata.trace_id != r2.metadata.trace_id
