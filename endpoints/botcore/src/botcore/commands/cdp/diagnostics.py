"""CDP diagnostics — screenshot, console, network, eval, and emulation commands.

Trace capture lives in tracing.py and trace analysis in trace_analysis.py; both are
re-exported here so ``botcore.commands.cdp.diagnostics`` keeps its public names.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from afd import CommandResult, error, success

from botcore.commands.cdp.core import (
    DEFAULT_TIMEOUT_MS as DEFAULT_TIMEOUT_MS,
)
from botcore.commands.cdp.core import (
    CdpSession,
    _default_screenshots_dir,
    _load_session,
    _save_session,
    _session_root,
    _update_session,
    _with_session_page,
)
from botcore.commands.cdp.trace_analysis import (
    DEFAULT_LONG_TASK_THRESHOLD_MS as DEFAULT_LONG_TASK_THRESHOLD_MS,
)
from botcore.commands.cdp.trace_analysis import (
    DEFAULT_TRACE_QUERY_LIMIT as DEFAULT_TRACE_QUERY_LIMIT,
)
from botcore.commands.cdp.trace_analysis import (
    DEFAULT_TRACE_TOP_LIMIT as DEFAULT_TRACE_TOP_LIMIT,
)
from botcore.commands.cdp.trace_analysis import cdp_trace_query as cdp_trace_query
from botcore.commands.cdp.trace_analysis import cdp_trace_summary as cdp_trace_summary
from botcore.commands.cdp.tracing import (
    DEFAULT_TRACE_CATEGORIES as DEFAULT_TRACE_CATEGORIES,
)
from botcore.commands.cdp.tracing import cdp_trace_capture as cdp_trace_capture


async def cdp_screenshot(
    path: str | None = None,
    full_page: bool = False,
) -> CommandResult[dict]:
    """Capture a screenshot of the current page."""

    async def _action(page: Any) -> dict:
        from pathlib import Path

        root = _session_root()
        if path:
            screenshot_path = Path(path)
        else:
            screenshots_dir = _default_screenshots_dir(root)
            screenshots_dir.mkdir(parents=True, exist_ok=True)
            name = f"screenshot-{datetime.now().strftime('%Y%m%d-%H%M%S')}.png"
            screenshot_path = screenshots_dir / name
        await page.screenshot(path=str(screenshot_path), full_page=full_page)
        return {"path": str(screenshot_path), "full_page": full_page}

    return await _with_session_page(_action)


async def cdp_console(
    tail: int | None = None,
    level: str | None = None,
    grep: str | None = None,
    clear: bool = False,
) -> CommandResult[dict]:
    """Show captured console log entries with optional filtering."""
    root = _session_root()
    session = _load_session(root)
    if not session:
        return error(
            "CDP_SESSION_NOT_FOUND",
            "No active CDP session found.",
            suggestion="Run `botcore cdp launch` or `botcore cdp attach` first.",
        )

    if clear:
        session.console_log = []
        _save_session(root, session)
        return success(data={"cleared": True}, reasoning="Console log cleared")

    entries = session.console_log

    if level:
        allowed_levels = {lv.strip().lower() for lv in level.split(",")}
        entries = [e for e in entries if e.level.lower() in allowed_levels]

    if grep:
        try:
            pattern = re.compile(grep, re.IGNORECASE)
        except re.error as exc:
            return error(
                "CDP_INVALID_PATTERN",
                f"Invalid grep pattern {grep!r}: {exc}",
                suggestion="Pass a valid regular expression to grep.",
            )
        entries = [e for e in entries if pattern.search(e.text)]

    if tail:
        entries = entries[-tail:]

    return success(
        data={"entries": [e.model_dump() for e in entries], "count": len(entries)},
        reasoning=f"Found {len(entries)} console entries",
    )


async def cdp_get_console_message(index: int) -> CommandResult[dict]:
    """Get a specific console message by index."""
    root = _session_root()
    session = _load_session(root)
    if not session:
        return error(
            "CDP_NO_SESSION",
            "No active CDP session.",
            suggestion="Run 'botcore cdp launch' or 'botcore cdp attach' first",
        )

    if index < 0 or index >= len(session.console_log):
        return error(
            "CDP_INVALID_INDEX",
            f"Invalid index {index}. Max: {len(session.console_log) - 1}",
            suggestion="Use 'botcore cdp console' to list all messages first",
        )

    entry = session.console_log[index]
    return success(
        {
            "index": index,
            "timestamp": entry.timestamp,
            "level": entry.level,
            "text": entry.text,
            "url": entry.url,
        }
    )


async def cdp_eval(expression: str) -> CommandResult[dict]:
    """Evaluate a JavaScript expression in the current page."""

    async def _action(page: Any) -> dict:
        result = await page.evaluate(expression)
        return {"expression": expression, "result": result}

    return await _with_session_page(_action)


_NETWORK_ENTRIES_JS = """() => {
    const entries = [
        ...performance.getEntriesByType('navigation'),
        ...performance.getEntriesByType('resource'),
    ];
    return entries.map((r) => ({
        url: r.name,
        resource_type: r.initiatorType || r.entryType || 'other',
        entry_type: r.entryType || 'resource',
        start_time_ms: Math.round((r.startTime || 0) * 100) / 100,
        duration_ms: Math.round((r.duration || 0) * 100) / 100,
        transfer_size: r.transferSize ?? null,
        encoded_body_size: r.encodedBodySize ?? null,
        decoded_body_size: r.decodedBodySize ?? null,
        protocol: r.nextHopProtocol || null,
        status: typeof r.responseStatus === 'number' ? r.responseStatus : null,
    }));
}"""


async def cdp_list_network(
    resource_type: str | None = None,
    limit: int = 50,
) -> CommandResult[dict]:
    """List network requests recorded by the page's Performance Resource Timing API."""
    if limit < 1:
        return error(
            "CDP_INVALID_INPUT",
            f"limit must be >= 1, got {limit}.",
            suggestion="Pass a positive limit, e.g. `botcore cdp list-network --limit 50`.",
        )

    async def _action(page: Any) -> dict:
        entries = await page.evaluate(_NETWORK_ENTRIES_JS)
        if resource_type:
            wanted = {item.strip().lower() for item in resource_type.split(",") if item.strip()}
            entries = [
                item
                for item in entries
                if str(item.get("resource_type", "")).lower() in wanted
                or str(item.get("entry_type", "")).lower() in wanted
            ]
        total = len(entries)
        shown = entries[:limit]
        return {
            "requests": shown,
            "count": len(shown),
            "total": total,
            "truncated": total > limit,
        }

    return await _with_session_page(_action)


async def cdp_get_network(url_pattern: str) -> CommandResult[dict]:
    """Get details of network requests matching a URL regex pattern."""
    try:
        pattern = re.compile(url_pattern, re.IGNORECASE)
    except re.error as exc:
        return error(
            "CDP_INVALID_PATTERN",
            f"Invalid url_pattern regex {url_pattern!r}: {exc}",
            suggestion="Pass a valid regular expression for url_pattern.",
        )

    async def _action(page: Any) -> dict:
        entries = await page.evaluate(_NETWORK_ENTRIES_JS)
        matches = [item for item in entries if pattern.search(str(item.get("url", "")))]
        return {
            "pattern": url_pattern,
            "matches": matches,
            "count": len(matches),
        }

    return await _with_session_page(_action)


def _parse_viewport(viewport: str) -> tuple[int, int] | None:
    parts = viewport.lower().split("x")
    if len(parts) != 2:
        return None
    try:
        width, height = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    return (width, height) if width > 0 and height > 0 else None


async def cdp_emulate(  # noqa: PLR0913 - emulation options
    color_scheme: str | None = None,
    viewport: str | None = None,
    user_agent: str | None = None,
    offline: bool = False,
    cpu_throttle: float | None = None,
    reset: bool = False,
) -> CommandResult[dict]:
    """Emulate device/browser features and persist them across session commands."""
    parsed_viewport: tuple[int, int] | None = None
    if viewport is not None:
        parsed_viewport = _parse_viewport(viewport)
        if parsed_viewport is None:
            return error(
                "CDP_INVALID_VIEWPORT",
                f"Invalid viewport {viewport!r}; expected '<width>x<height>' with positive ints.",
                suggestion="Pass viewport as WxH, e.g. `botcore cdp emulate --viewport 1280x720`.",
            )
    if cpu_throttle is not None and cpu_throttle < 1:
        return error(
            "CDP_INVALID_INPUT",
            f"cpu_throttle must be >= 1, got {cpu_throttle}.",
            suggestion="Pass a slowdown factor >= 1 (1 disables throttling, 4 is 4x slowdown).",
        )

    async def _action(page: Any) -> dict:
        changes: list[str] = []
        root = _session_root()
        cdp = None

        async def _cdp() -> Any:
            nonlocal cdp
            if cdp is None:
                cdp = await page.context.new_cdp_session(page)
            return cdp

        if reset:
            await page.emulate_media(color_scheme=None)
            await page.context.set_offline(False)
            client = await _cdp()
            await client.send("Emulation.setUserAgentOverride", {"userAgent": ""})
            await client.send("Emulation.setCPUThrottlingRate", {"rate": 1})
            changes.append("reset")

        if color_scheme:
            await page.emulate_media(color_scheme=color_scheme)
            changes.append(f"color_scheme={color_scheme}")

        if parsed_viewport is not None:
            w, h = parsed_viewport
            await page.set_viewport_size({"width": w, "height": h})
            changes.append(f"viewport={w}x{h}")

        if offline:
            await page.context.set_offline(True)
            changes.append("offline=true")

        if user_agent:
            client = await _cdp()
            await client.send("Emulation.setUserAgentOverride", {"userAgent": user_agent})
            changes.append(f"user_agent={user_agent}")

        if cpu_throttle is not None:
            client = await _cdp()
            await client.send("Emulation.setCPUThrottlingRate", {"rate": cpu_throttle})
            changes.append(f"cpu_throttle={cpu_throttle}")

        def _apply(current: CdpSession) -> None:
            if reset:
                current.color_scheme = None
                current.viewport = None
                current.user_agent = None
                current.offline = False
                current.cpu_throttle = None
            if color_scheme:
                current.color_scheme = color_scheme
            if parsed_viewport is not None:
                current.viewport = {"width": parsed_viewport[0], "height": parsed_viewport[1]}
            if offline:
                current.offline = True
            if user_agent:
                current.user_agent = user_agent
            if cpu_throttle is not None:
                current.cpu_throttle = cpu_throttle

        _update_session(root, _apply)

        return {"emulated": changes, "count": len(changes), "persisted": True}

    return await _with_session_page(_action, apply_overrides=False)
