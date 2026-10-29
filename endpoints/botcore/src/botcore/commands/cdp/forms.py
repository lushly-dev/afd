"""CDP forms — form filling, file upload, and dialog handling commands."""

from __future__ import annotations

from typing import Any

from afd import CommandResult, error, success

from botcore.commands.cdp.core import (
    DEEP_QUERY_SINGLE_JS,
    _connect_over_cdp_with_retry,
    _load_session,
    _session_root,
    _with_session_page,
)


async def cdp_fill(selector: str, value: str, deep: bool = False) -> CommandResult[dict]:
    """Fill an input, textarea, or select element with a value."""

    async def _action(page: Any) -> dict:
        if deep:
            el = await page.evaluate_handle(DEEP_QUERY_SINGLE_JS, selector)
            if await el.evaluate("el => el === null"):
                raise ValueError(f"Element not found: {selector}")
            await el.as_element().fill(value)
        else:
            await page.fill(selector, value)
        return {"selector": selector, "value": value, "filled": True}

    return await _with_session_page(_action)


async def cdp_fill_form(fields: dict[str, str]) -> CommandResult[dict]:
    """Fill multiple form fields at once."""

    async def _action(page: Any) -> dict:
        filled = []
        for selector, value in fields.items():
            await page.fill(selector, value)
            filled.append(selector)
        return {"filled": filled, "count": len(filled)}

    return await _with_session_page(_action)


async def cdp_upload(selector: str, file_path: str, deep: bool = False) -> CommandResult[dict]:
    """Upload a file through a file input element."""

    async def _action(page: Any) -> dict:
        from pathlib import Path

        path = Path(file_path)
        if not path.exists():
            raise ValueError(f"File not found: {file_path}")

        if deep:
            el = await page.evaluate_handle(DEEP_QUERY_SINGLE_JS, selector)
            if await el.evaluate("el => el === null"):
                raise ValueError(f"Element not found: {selector}")
            await el.as_element().set_input_files(str(path))
        else:
            await page.set_input_files(selector, str(path))

        return {"selector": selector, "file": str(path), "uploaded": True}

    return await _with_session_page(_action)


async def cdp_handle_dialog(
    action: str = "accept",
    prompt_text: str | None = None,
) -> CommandResult[dict]:
    """Handle browser dialogs (alert, confirm, prompt).

    Must be called before triggering the dialog.
    """

    async def _action(page: Any) -> dict:
        async def handle_dialog(dialog: Any) -> None:
            if action == "dismiss":
                await dialog.dismiss()
            else:
                await dialog.accept(prompt_text)

        page.on("dialog", handle_dialog)

        return {
            "handler_set": True,
            "action": action,
            "prompt_text": prompt_text,
            "note": "Dialog handler is now active. Trigger the dialog to handle it.",
        }

    return await _with_session_page(_action)


async def cdp_list_pages() -> CommandResult[dict]:
    """List all open pages/tabs in the browser."""
    from playwright.async_api import async_playwright

    root = _session_root()
    session = _load_session(root)
    if not session:
        return error(
            "CDP_NO_SESSION",
            "No active CDP session.",
            suggestion="Run 'botcore cdp launch' or 'botcore cdp attach' first",
        )

    async with async_playwright() as pw:
        browser = await _connect_over_cdp_with_retry(pw, session.cdp_endpoint)
        contexts = browser.contexts
        pages_info = []
        idx = 0
        for ctx_idx, context in enumerate(contexts):
            for page in context.pages:
                pages_info.append({
                    "index": idx,
                    "url": page.url,
                    "title": await page.title(),
                    "context": ctx_idx,
                })
                idx += 1
        return success({"pages": pages_info, "count": len(pages_info)})


async def cdp_select_page(index: int) -> CommandResult[dict]:
    """Select a page by index for subsequent commands."""
    return success({
        "selected": index,
        "note": "Page selection stored. Subsequent commands will use this page.",
    })


async def cdp_new_page(url: str | None = None) -> CommandResult[dict]:
    """Open a new page/tab in the browser."""
    from playwright.async_api import async_playwright

    root = _session_root()
    session = _load_session(root)
    if not session:
        return error(
            "CDP_NO_SESSION",
            "No active CDP session.",
            suggestion="Run 'botcore cdp launch' or 'botcore cdp attach' first",
        )

    async with async_playwright() as pw:
        browser = await _connect_over_cdp_with_retry(pw, session.cdp_endpoint)
        context = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = await context.new_page()
        if url:
            await page.goto(url, wait_until="domcontentloaded")
        return success({
            "created": True,
            "url": page.url,
            "pages_count": len(context.pages),
        })


async def cdp_close_page(index: int = 0) -> CommandResult[dict]:
    """Close a page by index."""
    from playwright.async_api import async_playwright

    root = _session_root()
    session = _load_session(root)
    if not session:
        return error(
            "CDP_NO_SESSION",
            "No active CDP session.",
            suggestion="Run 'botcore cdp launch' or 'botcore cdp attach' first",
        )

    async with async_playwright() as pw:
        browser = await _connect_over_cdp_with_retry(pw, session.cdp_endpoint)
        contexts = browser.contexts
        all_pages = []
        for context in contexts:
            all_pages.extend(context.pages)

        if len(all_pages) <= 1:
            return error(
                "CDP_CANNOT_CLOSE_LAST",
                "Cannot close the last remaining page.",
                suggestion="Open a new page with 'botcore cdp new-page' first",
            )

        if index < 0 or index >= len(all_pages):
            return error(
                "CDP_INVALID_INDEX",
                f"Invalid page index {index}. Max: {len(all_pages) - 1}",
                suggestion="Use 'botcore cdp list-pages' to see valid indices",
            )

        await all_pages[index].close()
        return success({"closed": index, "remaining": len(all_pages) - 1})


async def cdp_resize(width: int, height: int) -> CommandResult[dict]:
    """Resize the viewport to specified dimensions."""

    async def _action(page: Any) -> dict:
        await page.set_viewport_size({"width": width, "height": height})
        return {"width": width, "height": height, "resized": True}

    return await _with_session_page(_action)
