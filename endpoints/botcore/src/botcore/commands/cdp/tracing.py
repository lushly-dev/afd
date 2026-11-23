"""CDP trace capture — record a Chrome DevTools performance trace."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from afd import CommandResult, error, success

from botcore.commands.cdp.core import (
    DEFAULT_TIMEOUT_MS,
    SelectedPageClosedError,
    _apply_session_overrides,
    _connect_over_cdp_with_retry,
    _default_traces_dir,
    _load_session,
    _select_session_page,
    _session_root,
)

DEFAULT_TRACE_CATEGORIES = ",".join(
    [
        "-*",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "blink",
        "blink.user_timing",
        "cc",
        "loading",
        "latencyInfo",
        "toplevel",
        "v8.execute",
    ]
)


async def cdp_trace_capture(  # noqa: PLR0913
    url: str | None = None,
    path: str | None = None,
    name: str | None = None,
    wait_until: str = "load",
    settle_ms: int = 0,
    categories: str | None = None,
    stream_format: str = "json",
    stream_compression: str = "none",
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> CommandResult[dict]:
    """Capture a real Chrome DevTools performance trace for the current page or a navigated URL."""
    from playwright.async_api import async_playwright

    root = _session_root()
    session = _load_session(root)
    if not session:
        return error(
            "CDP_SESSION_NOT_FOUND",
            "No active CDP session found.",
            suggestion="Run `botcore cdp launch` or `botcore cdp attach` first.",
        )

    if path:
        trace_path = Path(path)
    else:
        traces_dir = _default_traces_dir(root)
        traces_dir.mkdir(parents=True, exist_ok=True)
        trace_name = name or "trace"
        safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", trace_name).strip("-") or "trace"
        extension = "json" if stream_format == "json" else "trace"
        filename = f"{safe_name}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.{extension}"
        trace_path = traces_dir / filename

    try:
        async with async_playwright() as playwright:
            browser = await _connect_over_cdp_with_retry(playwright, session.cdp_endpoint)
            page = await _select_session_page(browser, session)
            await _apply_session_overrides(page, session)
            context = getattr(page, "context", None) or browser.contexts[0]
            cdp_session = await context.new_cdp_session(page)
            loop = asyncio.get_running_loop()
            trace_future: asyncio.Future[str] = loop.create_future()

            async def _read_trace_stream(params: dict[str, Any]) -> None:
                stream = params.get("stream")
                if not stream:
                    if not trace_future.done():
                        trace_future.set_exception(
                            RuntimeError("Tracing completed without a stream handle.")
                        )
                    return

                chunks: list[str] = []
                while True:
                    chunk = await cdp_session.send("IO.read", {"handle": stream})
                    chunks.append(chunk.get("data", ""))
                    if chunk.get("eof"):
                        break

                await cdp_session.send("IO.close", {"handle": stream})
                if not trace_future.done():
                    trace_future.set_result("".join(chunks))

            def _handle_tracing_complete(params: dict[str, Any]) -> None:
                asyncio.create_task(_read_trace_stream(params))

            cdp_session.on("Tracing.tracingComplete", _handle_tracing_complete)
            await cdp_session.send(
                "Tracing.start",
                {
                    "categories": categories or DEFAULT_TRACE_CATEGORIES,
                    "transferMode": "ReturnAsStream",
                    "streamFormat": stream_format,
                    "streamCompression": stream_compression,
                },
            )
            if url:
                await page.goto(url, wait_until=wait_until, timeout=DEFAULT_TIMEOUT_MS)
            if settle_ms > 0:
                await page.wait_for_timeout(settle_ms)
            await cdp_session.send("Tracing.end")
            trace_data = await asyncio.wait_for(trace_future, timeout=timeout_ms / 1000)
            trace_path.write_text(trace_data, encoding="utf-8")
            cdp_session.remove_listener("Tracing.tracingComplete", _handle_tracing_complete)
    except SelectedPageClosedError as exc:
        return error(
            "CDP_SELECTED_PAGE_CLOSED",
            str(exc),
            suggestion=(
                "Run `botcore cdp list-pages` and `botcore cdp select-page <index>` "
                "to select an open tab."
            ),
        )
    except Exception as exc:
        return error(
            "CDP_TRACE_CAPTURE_FAILED",
            f"{type(exc).__name__}: {exc}",
            suggestion="Ensure the browser session is healthy and the trace scenario is valid.",
            details={
                "path": str(trace_path),
                "url": url,
                "waitUntil": wait_until,
                "settleMs": settle_ms,
                "categories": categories or DEFAULT_TRACE_CATEGORIES,
                "streamFormat": stream_format,
                "streamCompression": stream_compression,
            },
        )

    return success(
        {
            "path": str(trace_path),
            "kind": "chrome-devtools-trace",
            "url": url,
            "waitUntil": wait_until,
            "settleMs": settle_ms,
            "categories": categories or DEFAULT_TRACE_CATEGORIES,
            "streamFormat": stream_format,
            "streamCompression": stream_compression,
        },
        reasoning="Captured a Chrome DevTools performance trace for the requested scenario.",
    )
