"""Tests for botcore.commands.cdp.diagnostics."""

from __future__ import annotations

from pathlib import Path

import pytest
from afd.testing import assert_error, assert_success

from botcore.commands.cdp import diagnostics
from botcore.commands.cdp.core import CdpSession, ConsoleEntry


class _FakeCdpSession:
    def __init__(self, trace_text: str = '{"traceEvents":[]}') -> None:
        self.trace_text = trace_text
        self.started_with: dict | None = None
        self.closed_stream: str | None = None
        self.listeners: dict[str, object] = {}

    async def send(self, method: str, params: dict | None = None) -> dict:
        if method == "Tracing.start":
            self.started_with = params or {}
            return {}

        if method == "Tracing.end":
            listener = self.listeners.get("Tracing.tracingComplete")
            if listener is not None:
                listener({"stream": "trace-stream"})
            return {}

        if method == "IO.read":
            return {"data": self.trace_text, "eof": True}

        if method == "IO.close":
            self.closed_stream = (params or {}).get("handle")
            return {}

        raise AssertionError(f"Unexpected CDP method: {method}")

    def on(self, event: str, callback) -> None:
        self.listeners[event] = callback

    def remove_listener(self, event: str, callback) -> None:
        if self.listeners.get(event) is callback:
            del self.listeners[event]


class _FakePage:
    def __init__(self) -> None:
        self.goto_calls: list[dict] = []
        self.waits: list[int] = []

    async def goto(self, url: str, wait_until: str, timeout: int) -> None:
        self.goto_calls.append({"url": url, "wait_until": wait_until, "timeout": timeout})

    async def wait_for_timeout(self, ms: int) -> None:
        self.waits.append(ms)


class _FakeContext:
    def __init__(self, cdp_session: _FakeCdpSession, page: _FakePage) -> None:
        self.cdp_session = cdp_session
        self.pages = [page]

    async def new_page(self):  # pragma: no cover - not used, but mirrors interface
        return self.pages[0]

    async def new_cdp_session(self, page):
        return self.cdp_session


class _FakeBrowser:
    def __init__(self, context: _FakeContext) -> None:
        self.contexts = [context]


class _FakePlaywright:
    def __init__(self) -> None:
        self.chromium = object()

    async def __aenter__(self) -> _FakePlaywright:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class _FakeQueryResult:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows
        self.column_names = list(rows[0].keys()) if rows else []

    def __iter__(self):
        for row in self._rows:
            yield type("Row", (), row)()


class _FakeTraceProcessor:
    def __init__(self, trace: str, query_map: dict[str, list[dict]]) -> None:
        self.trace = trace
        self.query_map = query_map

    def __enter__(self) -> _FakeTraceProcessor:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def query(self, sql: str) -> _FakeQueryResult:
        normalized = " ".join(sql.split())
        for fragment, rows in self.query_map.items():
            if fragment in normalized:
                return _FakeQueryResult(rows)
        raise AssertionError(f"Unexpected SQL: {sql}")


@pytest.mark.asyncio
async def test_cdp_trace_capture_writes_default_trace_path(monkeypatch, tmp_path: Path) -> None:
    cdp_session = _FakeCdpSession()
    page = _FakePage()
    browser = _FakeBrowser(_FakeContext(cdp_session, page))
    session = CdpSession(
        cdp_endpoint="http://127.0.0.1:9222",
        profile_dir=str(tmp_path / "profile"),
        launched_at="2026-01-01T00:00:00",
    )

    monkeypatch.setattr(diagnostics, "_session_root", lambda: tmp_path)
    monkeypatch.setattr(diagnostics, "_load_session", lambda root: session)

    async def _fake_connect(playwright, endpoint):
        return browser

    monkeypatch.setattr(diagnostics, "_connect_over_cdp_with_retry", _fake_connect)

    class _AsyncPlaywrightFactory:
        def __call__(self):
            return _FakePlaywright()

    monkeypatch.setattr(
        __import__("playwright.async_api", fromlist=["async_playwright"]),
        "async_playwright",
        _AsyncPlaywrightFactory(),
    )

    result = await diagnostics.cdp_trace_capture(
        url="https://example.test/story",
        name="reference-kit",
        settle_ms=25,
    )

    data = assert_success(result)
    assert cdp_session.started_with == {
        "categories": diagnostics.DEFAULT_TRACE_CATEGORIES,
        "transferMode": "ReturnAsStream",
        "streamFormat": "json",
        "streamCompression": "none",
    }
    assert data["kind"] == "chrome-devtools-trace"
    assert data["path"].endswith(".json")
    assert "reference-kit" in data["path"]
    assert Path(data["path"]).read_text(encoding="utf-8") == '{"traceEvents":[]}'
    assert cdp_session.closed_stream == "trace-stream"
    assert page.goto_calls == [
        {
            "url": "https://example.test/story",
            "wait_until": "load",
            "timeout": diagnostics.DEFAULT_TIMEOUT_MS,
        }
    ]
    assert page.waits == [25]


@pytest.mark.asyncio
async def test_cdp_trace_capture_errors_without_session(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(diagnostics, "_session_root", lambda: tmp_path)
    monkeypatch.setattr(diagnostics, "_load_session", lambda root: None)

    result = await diagnostics.cdp_trace_capture()

    assert_error(result, "CDP_SESSION_NOT_FOUND")


@pytest.mark.asyncio
async def test_cdp_console_clear_persists_empty_log(monkeypatch, tmp_path: Path) -> None:
    session = CdpSession(
        cdp_endpoint="http://127.0.0.1:9222",
        profile_dir=str(tmp_path / "profile"),
        launched_at="2026-01-01T00:00:00",
        console_log=[
            ConsoleEntry(
                timestamp="2026-01-01T00:00:01",
                level="warning",
                text="warn",
                url="https://example.test",
            )
        ],
    )
    saved: dict[str, object] = {}

    monkeypatch.setattr(diagnostics, "_session_root", lambda: tmp_path)
    monkeypatch.setattr(diagnostics, "_load_session", lambda root: session)

    def _fake_save(root, updated_session):
        saved["root"] = root
        saved["session"] = updated_session

    monkeypatch.setattr(diagnostics, "_save_session", _fake_save)

    result = await diagnostics.cdp_console(clear=True)

    assert_success(result)
    assert session.console_log == []
    assert saved["root"] == tmp_path
    assert saved["session"] is session


@pytest.mark.asyncio
async def test_cdp_trace_query_returns_compact_rows(monkeypatch, tmp_path: Path) -> None:
    trace_path = tmp_path / "trace.json"
    trace_path.write_text('{"traceEvents":[]}', encoding="utf-8")

    query_map = {
        "select name, dur from slice": [
            {"name": "LongTask", "dur": 120_000_000},
            {"name": "Layout", "dur": 80_000_000},
        ]
    }

    monkeypatch.setattr(
        diagnostics,
        "_load_trace_processor",
        lambda: lambda trace: _FakeTraceProcessor(trace, query_map),
    )

    result = await diagnostics.cdp_trace_query(
        path=str(trace_path),
        sql="select name, dur from slice order by dur desc",
        limit=1,
    )

    data = assert_success(result)
    assert data["path"] == str(trace_path.resolve())
    assert data["columns"] == ["name", "dur"]
    assert data["rows"] == [{"name": "LongTask", "dur": 120_000_000}]
    assert data["truncated"] is True


@pytest.mark.asyncio
async def test_cdp_trace_summary_returns_stable_shape(monkeypatch, tmp_path: Path) -> None:
    trace_path = tmp_path / "trace.json"
    trace_path.write_text('{"traceEvents":[]}', encoding="utf-8")

    query_map = {
        "FROM trace_bounds": [
            {"start_ts": 1_000_000_000, "end_ts": 1_250_000_000},
        ],
        "GROUP BY p.upid": [
            {
                "processName": "Renderer",
                "pid": 123,
                "sliceCount": 14,
                "totalSliceDurNs": 190_000_000,
                "maxSliceDurNs": 120_000_000,
            }
        ],
        "GROUP BY t.utid": [
            {
                "utid": 77,
                "threadName": "CrRendererMain",
                "processName": "Renderer",
                "pid": 123,
                "sliceCount": 10,
                "totalSliceDurNs": 180_000_000,
                "maxSliceDurNs": 120_000_000,
            }
        ],
        "GROUP BY category": [
            {
                "category": "devtools.timeline",
                "sliceCount": 5,
                "totalDurNs": 180_000_000,
                "maxDurNs": 120_000_000,
            }
        ],
        "WHERE s.dur >=": [
            {
                "name": "LongTask",
                "category": "devtools.timeline",
                "ts": 1_050_000_000,
                "dur": 120_000_000,
                "utid": 77,
                "threadName": "CrRendererMain",
                "processName": "Renderer",
                "pid": 123,
            }
        ],
        "WHERE s.dur > 0": [
            {
                "name": "LongTask",
                "category": "devtools.timeline",
                "ts": 1_050_000_000,
                "dur": 120_000_000,
                "utid": 77,
                "threadName": "CrRendererMain",
                "processName": "Renderer",
                "pid": 123,
            }
        ],
        "WHERE t.utid = 77 AND s.dur > 0": [
            {
                "name": "RenderWork",
                "category": "devtools.timeline",
                "ts": 1_060_000_000,
                "dur": 24_000_000,
                "utid": 77,
                "threadName": "CrRendererMain",
                "processName": "Renderer",
                "pid": 123,
            }
        ],
        "SELECT COUNT(*) AS count FROM slice": [
            {"count": 1},
        ],
    }

    monkeypatch.setattr(
        diagnostics,
        "_load_trace_processor",
        lambda: lambda trace: _FakeTraceProcessor(trace, query_map),
    )

    result = await diagnostics.cdp_trace_summary(path=str(trace_path))

    data = assert_success(result)
    assert data["bounds"]["durationMs"] == 250.0
    assert data["actors"]["primaryThread"]["threadName"] == "CrRendererMain"
    assert data["slices"]["longTaskCount"] == 1
    assert data["slices"]["topByDuration"][0]["durMs"] == 120.0
    assert data["slices"]["primaryThreadLongTasks"][0]["utid"] == 77
    assert data["slices"]["mainThreadTopByDuration"][0]["name"] == "RenderWork"
    assert data["signals"]["mainThreadLongTaskCount"] == 1
    assert data["signals"]["browserPipelineLongTaskCount"] == 0
    assert data["signals"]["metricSpanCount"] == 0
