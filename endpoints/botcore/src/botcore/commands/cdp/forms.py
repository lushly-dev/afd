"""CDP forms — form filling, file upload, and dialog handling commands."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from afd import CommandResult, error

from botcore.commands.cdp.core import (
    DEEP_QUERY_SINGLE_JS,
    CdpSession,
    _all_pages,
    _apply_session_overrides,
    _page_target_id,
    _session_root,
    _update_session,
    _with_session_browser,
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

    async def _action(browser: Any, session: CdpSession, _root: Path) -> dict:
        pages_info = []
        idx = 0
        selected_idx: int | None = None
        for ctx_idx, context in enumerate(browser.contexts):
            for page in context.pages:
                target_id = await _page_target_id(page)
                is_selected = (
                    target_id == session.selected_target_id
                    if session.selected_target_id
                    else idx == session.selected_page
                )
                if is_selected:
                    selected_idx = idx
                pages_info.append({
                    "index": idx,
                    "url": page.url,
                    "title": await page.title(),
                    "context": ctx_idx,
                    "selected": is_selected,
                })
                idx += 1
        return {
            "pages": pages_info,
            "count": len(pages_info),
            "selected": selected_idx if selected_idx is not None else session.selected_page,
        }

    return await _with_session_browser(_action)


async def cdp_select_page(index: int) -> CommandResult[dict]:
    """Select a page by index for subsequent commands."""

    async def _action(browser: Any, _session: CdpSession, root: Path) -> Any:
        all_pages = _all_pages(browser)
        if not all_pages:
            return error(
                "CDP_NO_PAGES",
                "No open pages found in browser.",
                suggestion="Open a page with `botcore cdp new-page` first.",
            )
        if index < 0 or index >= len(all_pages):
            return error(
                "CDP_INVALID_INDEX",
                f"Invalid page index {index}. Max: {len(all_pages) - 1}",
                suggestion="Use `botcore cdp list-pages` to see valid indices.",
            )
        page = all_pages[index]
        target_id = await _page_target_id(page)

        def _apply(current: CdpSession) -> None:
            current.selected_page = index
            current.selected_target_id = target_id

        _update_session(root, _apply)
        return {
            "selected": index,
            "target_id": target_id,
            "url": page.url,
            "title": await page.title(),
        }

    return await _with_session_browser(_action)


async def cdp_new_page(url: str | None = None) -> CommandResult[dict]:
    """Open a new page/tab in the browser."""

    async def _action(browser: Any, session: CdpSession, _root: Path) -> dict:
        context = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = await context.new_page()
        await _apply_session_overrides(page, session)
        if url:
            await page.goto(url, wait_until="domcontentloaded")
        return {
            "created": True,
            "url": page.url,
            "pages_count": len(_all_pages(browser)),
        }

    return await _with_session_browser(_action)


async def cdp_close_page(index: int = 0) -> CommandResult[dict]:
    """Close a page by index."""

    async def _action(browser: Any, session: CdpSession, root: Path) -> Any:
        all_pages = _all_pages(browser)
        if len(all_pages) <= 1:
            return error(
                "CDP_CANNOT_CLOSE_LAST",
                "Cannot close the last remaining page.",
                suggestion="Open a new page with `botcore cdp new-page` first.",
            )

        if index < 0 or index >= len(all_pages):
            return error(
                "CDP_INVALID_INDEX",
                f"Invalid page index {index}. Max: {len(all_pages) - 1}",
                suggestion="Use `botcore cdp list-pages` to see valid indices.",
            )

        closed_target_id = await _page_target_id(all_pages[index])
        await all_pages[index].close()
        remaining_pages = _all_pages(browser)
        remaining = len(remaining_pages)

        new_index = session.selected_page
        new_target_id = session.selected_target_id
        if session.selected_target_id and closed_target_id == session.selected_target_id:
            new_index = max(0, min(index, remaining - 1))
            new_target_id = (
                await _page_target_id(remaining_pages[new_index]) if remaining_pages else None
            )
        elif session.selected_target_id:
            for pos, remaining_page in enumerate(remaining_pages):
                if await _page_target_id(remaining_page) == session.selected_target_id:
                    new_index = pos
                    break
        elif index < session.selected_page:
            new_index = session.selected_page - 1
        elif session.selected_page >= remaining:
            new_index = max(0, remaining - 1)

        def _apply(current: CdpSession) -> None:
            current.selected_page = new_index
            current.selected_target_id = new_target_id

        _update_session(root, _apply)
        return {"closed": index, "remaining": remaining, "selected": new_index}

    return await _with_session_browser(_action)


async def cdp_resize(width: int, height: int) -> CommandResult[dict]:
    """Resize the viewport to specified dimensions and persist it in the session."""
    if width <= 0 or height <= 0:
        return error(
            "CDP_INVALID_VIEWPORT",
            f"Viewport dimensions must be positive integers, got {width}x{height}.",
            suggestion="Pass positive width and height, e.g. `botcore cdp resize 1280 720`.",
        )

    async def _action(page: Any) -> dict:
        viewport = {"width": width, "height": height}
        await page.set_viewport_size(viewport)
        root = _session_root()

        def _apply(current: CdpSession) -> None:
            current.viewport = viewport

        _update_session(root, _apply)
        return {"width": width, "height": height, "resized": True, "persisted": True}

    return await _with_session_page(_action)
