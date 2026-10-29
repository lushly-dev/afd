"""CDP navigation — page navigation and waiting commands."""

from __future__ import annotations

from typing import Any

from afd import CommandResult, error

from botcore.commands.cdp.core import DEFAULT_TIMEOUT_MS, _with_session_page


async def cdp_navigate(url: str, wait_until: str = "load") -> CommandResult[dict]:
    """Navigate the page to the given URL."""

    async def _action(page: Any) -> dict:
        response = await page.goto(url, wait_until=wait_until, timeout=DEFAULT_TIMEOUT_MS)
        title = await page.title()
        return {
            "url": page.url,
            "status": response.status if response else None,
            "title": title,
        }

    return await _with_session_page(_action)


async def cdp_wait(
    selector: str | None = None,
    ms: int | None = None,
    hidden: bool = False,
    text: str | None = None,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> CommandResult[dict]:
    """Wait for a selector, text, or timeout."""
    if not selector and ms is None and text is None:
        return error(
            "CDP_WAIT_TARGET_REQUIRED",
            "Provide --selector, --ms, or --text.",
            suggestion='Example: botcore cdp wait --selector "#ready"',
        )

    async def _action(page: Any) -> dict:
        if text:
            await page.wait_for_function(
                f"document.body.innerText.includes({repr(text)})",
                timeout=timeout_ms,
            )
            return {"text": text, "timeout_ms": timeout_ms}
        if selector:
            if hidden:
                await page.wait_for_selector(selector, state="hidden", timeout=timeout_ms)
                return {"selector": selector, "hidden": True, "timeout_ms": timeout_ms}
            else:
                await page.wait_for_selector(selector, timeout=timeout_ms)
                return {"selector": selector, "timeout_ms": timeout_ms}
        await page.wait_for_timeout(ms or 0)
        return {"ms": ms}

    return await _with_session_page(_action)
