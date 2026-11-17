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
    _default_screenshots_dir,
    _load_session,
    _save_session,
    _session_root,
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
        pattern = re.compile(grep, re.IGNORECASE)
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


async def cdp_list_network(
    resource_type: str | None = None,
    limit: int = 50,
) -> CommandResult[dict]:
    """List network requests made by the page."""
    return success(
        {
            "note": "Network capturing requires prior setup. Use cdp eval with Performance API.",
            "suggestion": (
                "botcore cdp eval \"performance.getEntriesByType('resource')"
                '.map(r => ({name: r.name, type: r.initiatorType, duration: r.duration}))"'
            ),
        }
    )


async def cdp_get_network(url_pattern: str) -> CommandResult[dict]:
    """Get details of a network request matching the URL pattern."""
    return success(
        {
            "note": "Network inspection requires prior capture setup.",
            "pattern": url_pattern,
            "suggestion": "Use browser DevTools Network tab or cdp eval with fetch interception.",
        }
    )


async def cdp_emulate(
    color_scheme: str | None = None,
    viewport: str | None = None,
    user_agent: str | None = None,
    offline: bool = False,
    cpu_throttle: float | None = None,
) -> CommandResult[dict]:
    """Emulate device/browser features."""

    async def _action(page: Any) -> dict:
        changes: list[str] = []

        if color_scheme:
            await page.emulate_media(color_scheme=color_scheme)
            changes.append(f"color_scheme={color_scheme}")

        if viewport:
            parts = viewport.split("x")
            if len(parts) == 2:
                w, h = int(parts[0]), int(parts[1])
                await page.set_viewport_size({"width": w, "height": h})
                changes.append(f"viewport={w}x{h}")

        if offline:
            context = page.context
            await context.set_offline(True)
            changes.append("offline=true")

        if user_agent:
            changes.append(f"user_agent={user_agent} (requires CDP)")
        if cpu_throttle:
            changes.append(f"cpu_throttle={cpu_throttle} (requires CDP)")

        return {"emulated": changes, "count": len(changes)}

    return await _with_session_page(_action)
