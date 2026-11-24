"""Tests for botcore.commands.cdp.diagnostics."""

from __future__ import annotations

from pathlib import Path

import pytest
from afd.testing import assert_error, assert_success

from botcore.commands.cdp import diagnostics, trace_analysis, tracing
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

    monkeypatch.setattr(tracing, "_session_root", lambda: tmp_path)
    monkeypatch.setattr(tracing, "_load_session", lambda root: session)

    async def _fake_connect(playwright, endpoint):
        return browser

    monkeypatch.setattr(tracing, "_connect_over_cdp_with_retry", _fake_connect)

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
    monkeypatch.setattr(tracing, "_session_root", lambda: tmp_path)
    monkeypatch.setattr(tracing, "_load_session", lambda root: None)

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
        trace_analysis,
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
        trace_analysis,
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


class _RichCdpSession:
    def __init__(self, target_id: str | None = None) -> None:
        self.sent: list[tuple[str, dict | None]] = []
        self.target_id = target_id

    async def send(self, method: str, params: dict | None = None) -> dict:
        self.sent.append((method, params))
        if method == "Performance.getMetrics":
            return {"metrics": [{"name": "Timestamp", "value": 42.0}]}
        if method == "Target.getTargetInfo" and self.target_id:
            return {"targetInfo": {"targetId": self.target_id}}
        return {}


class _RichPage:
    def __init__(
        self, url: str, title: str, context: _RichContext, target_id: str | None = None
    ) -> None:
        self.url = url
        self._title = title
        self.context = context
        self.target_id = target_id
        self.closed = False
        self.viewport: dict[str, int] | None = None
        self.color_scheme: str | None = None
        self.eval_result: object = []
        self.listeners: dict[str, list] = {}
        self.actions_log: list[str] = []

    async def title(self) -> str:
        return self._title

    async def close(self) -> None:
        self.closed = True
        self.context.pages.remove(self)

    async def set_viewport_size(self, size: dict[str, int]) -> None:
        self.viewport = size
        self.actions_log.append("viewport")

    async def emulate_media(self, color_scheme: str | None = None) -> None:
        self.color_scheme = color_scheme
        self.actions_log.append("color_scheme")

    async def evaluate(self, _script: str, *_args) -> object:
        return self.eval_result

    async def goto(self, url: str, wait_until: str = "load", timeout: int = 30_000) -> None:
        self.url = url
        self.actions_log.append(f"goto:{url}")

    async def wait_for_timeout(self, _ms: int) -> None:
        return None

    def on(self, event: str, cb) -> None:
        self.listeners.setdefault(event, []).append(cb)


class _RichContext:
    def __init__(self) -> None:
        self.pages: list[_RichPage] = []
        self.offline = False
        self.cdp = _RichCdpSession()

    async def new_page(self) -> _RichPage:
        page = _RichPage("about:blank", "New Tab", self, target_id=f"target-{len(self.pages)}")
        self.pages.append(page)
        return page

    async def set_offline(self, offline: bool) -> None:
        self.offline = offline

    async def new_cdp_session(self, page: _RichPage) -> _RichCdpSession:
        self.cdp.target_id = getattr(page, "target_id", None)
        return self.cdp


class _RichBrowser:
    def __init__(self, context: _RichContext) -> None:
        self.contexts = [context]


def _wire_fake_cdp(monkeypatch, tmp_path: Path, browser: object | Exception) -> CdpSession:
    from botcore.commands.cdp import core

    session = CdpSession(
        cdp_endpoint="http://127.0.0.1:9222",
        profile_dir=str(tmp_path / "profile"),
        launched_at="2026-01-01T00:00:00",
    )
    core._save_session(tmp_path, session)
    monkeypatch.setattr(core, "_session_root", lambda: tmp_path)
    monkeypatch.setattr(diagnostics, "_session_root", lambda: tmp_path)
    from botcore.commands.cdp import forms

    monkeypatch.setattr(forms, "_session_root", lambda: tmp_path)

    async def _fake_connect(_pw, _endpoint):
        if isinstance(browser, Exception):
            raise browser
        return browser

    monkeypatch.setattr(core, "_connect_over_cdp_with_retry", _fake_connect)
    monkeypatch.setattr(
        __import__("playwright.async_api", fromlist=["async_playwright"]),
        "async_playwright",
        lambda: _FakePlaywright(),
    )
    return session


@pytest.mark.asyncio
async def test_cdp_select_page_persists_and_targets_selected_tab(monkeypatch, tmp_path: Path):
    """lushly-dev/afd#778: cdp_select_page validates, persists and routes subsequent commands."""
    from botcore.commands.cdp import core, forms

    ctx = _RichContext()
    first = _RichPage("https://one.test", "One", ctx)
    second = _RichPage("https://two.test", "Two", ctx)
    ctx.pages = [first, second]
    _wire_fake_cdp(monkeypatch, tmp_path, _RichBrowser(ctx))

    bad = await forms.cdp_select_page(5)
    assert_error(bad, "CDP_INVALID_INDEX")

    selected = assert_success(await forms.cdp_select_page(1))
    assert selected == {
        "selected": 1,
        "target_id": None,
        "url": "https://two.test",
        "title": "Two",
    }
    assert core._load_session(tmp_path).selected_page == 1

    seen_urls: list[str] = []

    async def _probe(page) -> dict:
        seen_urls.append(page.url)
        return {"url": page.url}

    assert_success(await core._with_session_page(_probe))
    assert seen_urls == ["https://two.test"]

    closed = assert_success(await forms.cdp_close_page(0))
    assert closed == {"closed": 0, "remaining": 1, "selected": 0}
    assert core._load_session(tmp_path).selected_page == 0


@pytest.mark.asyncio
async def test_cdp_emulate_and_resize_apply_and_persist_across_calls(monkeypatch, tmp_path: Path):
    """lushly-dev/afd#778: cdp_emulate applies user_agent/cpu_throttle and persists overrides."""
    from botcore.commands.cdp import core, forms

    ctx = _RichContext()
    page = _RichPage("https://app.test", "App", ctx)
    ctx.pages = [page]
    _wire_fake_cdp(monkeypatch, tmp_path, _RichBrowser(ctx))

    emulated = assert_success(
        await diagnostics.cdp_emulate(
            color_scheme="dark",
            viewport="800x600",
            user_agent="Bot/1.0",
            offline=True,
            cpu_throttle=4.0,
        )
    )
    assert emulated["persisted"] is True
    assert ("Emulation.setUserAgentOverride", {"userAgent": "Bot/1.0"}) in ctx.cdp.sent
    assert ("Emulation.setCPUThrottlingRate", {"rate": 4.0}) in ctx.cdp.sent

    # Simulate a brand-new connection on the next command: overrides must re-apply automatically.
    ctx2 = _RichContext()
    page2 = _RichPage("https://app.test", "App", ctx2)
    ctx2.pages = [page2]
    monkeypatch.setattr(
        core,
        "_connect_over_cdp_with_retry",
        lambda _pw, _ep: _async_return(_RichBrowser(ctx2)),
    )

    assert_success(await core._with_session_page(lambda _p: _async_return({"ok": True})))
    assert page2.viewport == {"width": 800, "height": 600}
    assert page2.color_scheme == "dark"
    assert ctx2.offline is True
    assert ("Emulation.setUserAgentOverride", {"userAgent": "Bot/1.0"}) in ctx2.cdp.sent
    assert ("Emulation.setCPUThrottlingRate", {"rate": 4.0}) in ctx2.cdp.sent

    resized = assert_success(await forms.cdp_resize(1280, 720))
    assert resized["persisted"] is True
    assert core._load_session(tmp_path).viewport == {"width": 1280, "height": 720}
    assert_error(await forms.cdp_resize(0, 720), "CDP_INVALID_VIEWPORT")

    assert_success(await diagnostics.cdp_emulate(reset=True))
    reloaded = core._load_session(tmp_path)
    assert reloaded.viewport is None
    assert reloaded.user_agent is None
    assert reloaded.cpu_throttle is None


async def _async_return(value):
    return value


@pytest.mark.asyncio
async def test_cdp_network_commands_query_performance_entries(monkeypatch, tmp_path: Path):
    """lushly-dev/afd#778: cdp_list_network and cdp_get_network return real resource entries."""
    ctx = _RichContext()
    page = _RichPage("https://app.test", "App", ctx)
    page.eval_result = [
        {"url": "https://app.test/", "resource_type": "navigation", "entry_type": "navigation"},
        {"url": "https://app.test/api/items", "resource_type": "fetch", "entry_type": "resource"},
        {"url": "https://app.test/api/users", "resource_type": "fetch", "entry_type": "resource"},
    ]
    ctx.pages = [page]
    _wire_fake_cdp(monkeypatch, tmp_path, _RichBrowser(ctx))

    listed = assert_success(await diagnostics.cdp_list_network(resource_type="fetch", limit=1))
    assert listed["count"] == 1
    assert listed["total"] == 2
    assert listed["truncated"] is True
    assert listed["requests"][0]["url"] == "https://app.test/api/items"

    matched = assert_success(await diagnostics.cdp_get_network(r"/api/users"))
    assert matched["count"] == 1
    assert matched["matches"][0]["url"] == "https://app.test/api/users"

    assert_error(await diagnostics.cdp_get_network("[bad-regex"), "CDP_INVALID_PATTERN")


@pytest.mark.asyncio
async def test_cdp_page_commands_and_console_return_errors_instead_of_raising(
    monkeypatch, tmp_path: Path
):
    """lushly-dev/afd#778: unreachable browser and invalid grep return failed CommandResults."""
    from botcore.commands.cdp import forms

    _wire_fake_cdp(monkeypatch, tmp_path, RuntimeError("connect_over_cdp: ECONNREFUSED"))

    for coro in (
        forms.cdp_list_pages(),
        forms.cdp_new_page("https://example.test"),
        forms.cdp_close_page(0),
        forms.cdp_select_page(0),
    ):
        result = await coro
        assert_error(result, "CDP_CONNECT_FAILED")

    bad_grep = await diagnostics.cdp_console(grep="[unclosed")
    assert_error(bad_grep, "CDP_INVALID_PATTERN")


@pytest.mark.asyncio
async def test_cdp_perf_trace_unsupported_and_metrics_single_wrapped(monkeypatch, tmp_path: Path):
    """lushly-dev/afd#778: cdp_perf trace start/stop direct to cdp_trace_capture; metrics unwrap."""
    from botcore.commands import cdp_perf

    assert_error(await cdp_perf.perf_trace_start(), "CDP_TRACE_UNSUPPORTED")
    assert_error(await cdp_perf.perf_trace_stop(), "CDP_TRACE_UNSUPPORTED")

    ctx = _RichContext()
    ctx.pages = [_RichPage("https://app.test", "App", ctx)]
    _wire_fake_cdp(monkeypatch, tmp_path, _RichBrowser(ctx))

    metrics = assert_success(await cdp_perf.perf_metrics())
    assert isinstance(metrics, dict)
    assert metrics["timestamp"] == 42.0


@pytest.mark.asyncio
async def test_cdp_select_page_tracks_target_id_and_detects_closed_tab(monkeypatch, tmp_path: Path):
    """lushly-dev/afd#778: closing an earlier tab outside Botcore keeps targeting the selected
    targetId, and closing the selected target surfaces CDP_SELECTED_PAGE_CLOSED."""
    from botcore.commands.cdp import core, forms

    ctx = _RichContext()
    tab_a = _RichPage("https://a.test", "A", ctx, target_id="tid-a")
    tab_b = _RichPage("https://b.test", "B", ctx, target_id="tid-b")
    tab_c = _RichPage("https://c.test", "C", ctx, target_id="tid-c")
    ctx.pages = [tab_a, tab_b, tab_c]
    _wire_fake_cdp(monkeypatch, tmp_path, _RichBrowser(ctx))

    selected = assert_success(await forms.cdp_select_page(1))
    assert selected["target_id"] == "tid-b"

    # External close of tab A shifts indices; targetId still resolves to tab B, never tab C.
    ctx.pages.remove(tab_a)
    probed = assert_success(await core._with_session_page(lambda p: _async_return({"url": p.url})))
    assert probed == {"url": "https://b.test"}

    # External close of tab B surfaces explicit CDP_SELECTED_PAGE_CLOSED.
    ctx.pages.remove(tab_b)
    gone = await core._with_session_page(lambda p: _async_return({"url": p.url}))
    assert_error(gone, "CDP_SELECTED_PAGE_CLOSED")


@pytest.mark.asyncio
async def test_cdp_new_page_and_trace_capture_apply_persisted_emulation(
    monkeypatch, tmp_path: Path
):
    """lushly-dev/afd#778: cdp_new_page and cdp_trace_capture apply persisted overrides before
    navigation/tracing."""
    from botcore.commands.cdp import core, forms

    ctx = _RichContext()
    page0 = _RichPage("https://app.test", "App", ctx, target_id="tid-0")
    ctx.pages = [page0]
    _wire_fake_cdp(monkeypatch, tmp_path, _RichBrowser(ctx))
    assert_success(
        await diagnostics.cdp_emulate(color_scheme="dark", viewport="640x480", cpu_throttle=4.0)
    )

    assert_success(await forms.cdp_new_page("https://fresh.test"))
    created = ctx.pages[-1]
    assert created.viewport == {"width": 640, "height": 480}
    assert created.color_scheme == "dark"
    assert created.actions_log.index("viewport") < created.actions_log.index(
        "goto:https://fresh.test"
    )

    # Also verify cdp_trace_capture applies persisted overrides before Tracing.start.
    class _TraceCdp(_FakeCdpSession):
        def __init__(self) -> None:
            super().__init__()
            self.order: list[str] = []

        async def send(self, method: str, params: dict | None = None) -> dict:
            self.order.append(method)
            if method.startswith("Emulation."):
                return {}
            return await super().send(method, params)

    trace_cdp = _TraceCdp()
    trace_ctx = _RichContext()
    trace_page = _RichPage("https://app.test", "App", trace_ctx)
    trace_ctx.pages = [trace_page]
    trace_ctx.cdp = trace_cdp  # type: ignore[assignment]
    monkeypatch.setattr(tracing, "_session_root", lambda: tmp_path)
    monkeypatch.setattr(tracing, "_load_session", core._load_session)
    monkeypatch.setattr(
        tracing,
        "_connect_over_cdp_with_retry",
        lambda _pw, _ep: _async_return(_RichBrowser(trace_ctx)),
    )

    assert_success(await tracing.cdp_trace_capture(url="https://trace.test"))
    assert trace_page.viewport == {"width": 640, "height": 480}
    assert trace_cdp.order.index("Emulation.setCPUThrottlingRate") < trace_cdp.order.index(
        "Tracing.start"
    )


@pytest.mark.asyncio
async def test_cdp_trace_query_runs_off_event_loop(monkeypatch, tmp_path: Path):
    """lushly-dev/afd#1794: cdp_trace_query offloads synchronous Perfetto work via to_thread."""
    import asyncio
    import threading
    import time

    trace_path = tmp_path / "trace.json"
    trace_path.write_text('{"traceEvents":[]}', encoding="utf-8")
    loop_thread = threading.get_ident()
    worker_threads: list[int] = []
    ticks = 0

    class _SlowProcessor(_FakeTraceProcessor):
        def query(self, sql: str) -> _FakeQueryResult:
            worker_threads.append(threading.get_ident())
            time.sleep(0.15)
            return super().query(sql)

    monkeypatch.setattr(
        trace_analysis,
        "_load_trace_processor",
        lambda: lambda trace: _SlowProcessor(trace, {"select 1": [{"x": 1}]}),
    )

    async def ticker() -> None:
        nonlocal ticks
        for _ in range(5):
            await asyncio.sleep(0.02)
            ticks += 1

    result, _ = await asyncio.gather(
        diagnostics.cdp_trace_query(path=str(trace_path), sql="select 1"),
        ticker(),
    )
    assert_success(result)
    assert worker_threads and worker_threads[0] != loop_thread
    assert ticks == 5
