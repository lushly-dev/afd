"""CDP interaction — mouse and keyboard input commands."""

from __future__ import annotations

from typing import Any

from afd import CommandResult, error

from botcore.commands.cdp.core import DEFAULT_TIMEOUT_MS, _with_session_page

# Shared JS for deep-querying bounding boxes
_DEEP_QUERY_BOX_JS = """(selector) => {
    function querySelectorDeep(root, sel) {
        let result = root.querySelector(sel);
        if (result) return result;
        const elements = root.querySelectorAll('*');
        for (const el of elements) {
            if (el.shadowRoot) {
                result = querySelectorDeep(el.shadowRoot, sel);
                if (result) return result;
            }
        }
        return null;
    }
    const el = querySelectorDeep(document, selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
}"""

_DEEP_SCROLL_JS = """(selector) => {
    function querySelectorDeep(root, sel) {
        let result = root.querySelector(sel);
        if (result) return result;
        const elements = root.querySelectorAll('*');
        for (const el of elements) {
            if (el.shadowRoot) {
                result = querySelectorDeep(el.shadowRoot, sel);
                if (result) return result;
            }
        }
        return null;
    }
    const el = querySelectorDeep(document, selector);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    return true;
}"""

_DEEP_FOCUS_JS = """(selector) => {
    function querySelectorDeep(root, sel) {
        let result = root.querySelector(sel);
        if (result) return result;
        const elements = root.querySelectorAll('*');
        for (const el of elements) {
            if (el.shadowRoot) {
                result = querySelectorDeep(el.shadowRoot, sel);
                if (result) return result;
            }
        }
        return null;
    }
    const el = querySelectorDeep(document, selector);
    if (!el) return false;
    el.focus();
    return true;
}"""


async def cdp_click(  # noqa: PLR0913
    selector: str,
    x: int | None = None,
    y: int | None = None,
    button: str = "left",
    double: bool = False,
    ctrl: bool = False,
    shift: bool = False,
    alt: bool = False,
    deep: bool = False,
) -> CommandResult[dict]:
    """Click an element with extended options.

    Supports button (left/right/middle), double-click, modifier keys,
    and deep shadow DOM traversal.
    """

    async def _action(page: Any) -> dict:
        modifiers = []
        if ctrl:
            modifiers.append("Control")
        if shift:
            modifiers.append("Shift")
        if alt:
            modifiers.append("Alt")

        if deep:
            box = await page.evaluate(_DEEP_QUERY_BOX_JS, selector)
            if not box:
                raise ValueError(f"Element not found in shadow DOM: {selector}")

            click_x = box["x"] + (x or 0)
            click_y = box["y"] + (y or 0)

            for mod in modifiers:
                await page.keyboard.down(mod)

            if double:
                await page.mouse.dblclick(click_x, click_y, button=button)
            else:
                await page.mouse.click(click_x, click_y, button=button)

            for mod in reversed(modifiers):
                await page.keyboard.up(mod)
        else:
            locator = page.locator(selector)
            click_opts: dict[str, Any] = {"timeout": DEFAULT_TIMEOUT_MS}

            if x is not None and y is not None:
                click_opts["position"] = {"x": x, "y": y}
            if button != "left":
                click_opts["button"] = button
            if double:
                click_opts["click_count"] = 2
            if modifiers:
                click_opts["modifiers"] = modifiers

            await locator.click(**click_opts)

        return {
            "selector": selector, "x": x, "y": y, "button": button,
            "double": double, "modifiers": modifiers or None, "deep": deep,
        }

    result = await _with_session_page(_action)
    if result.success:
        click_desc = "double-" if double else ""
        click_desc += f"{button}-clicked" if button != "left" else "clicked"
        deep_desc = " (deep)" if deep else ""
        result.reasoning = f"Successfully {click_desc} '{selector}'{deep_desc}"
    return result


async def cdp_hover(selector: str, deep: bool = False) -> CommandResult[dict]:
    """Hover over an element to trigger hover states, tooltips, or menus."""

    async def _action(page: Any) -> dict:
        if deep:
            box = await page.evaluate(_DEEP_QUERY_BOX_JS, selector)
            if not box:
                raise ValueError(f"Element not found in shadow DOM: {selector}")
            await page.mouse.move(box["x"], box["y"])
        else:
            await page.locator(selector).hover(timeout=DEFAULT_TIMEOUT_MS)
        return {"selector": selector, "deep": deep}

    result = await _with_session_page(_action)
    if result.success:
        deep_desc = " (deep)" if deep else ""
        result.reasoning = f"Hovering over '{selector}'{deep_desc}"
    return result


async def cdp_scroll(
    selector: str | None = None,
    x: int | None = None,
    y: int | None = None,
    deep: bool = False,
) -> CommandResult[dict]:
    """Scroll an element into view or scroll the page by offset."""
    if not selector and x is None and y is None:
        return error(
            "CDP_SCROLL_TARGET_REQUIRED",
            "Provide --selector or --x/--y offset.",
            suggestion="Example: botcore cdp scroll --selector '.panel' or --y 500",
        )

    async def _action(page: Any) -> dict:
        result_data: dict[str, Any] = {"selector": selector, "x": x, "y": y, "deep": deep}

        if selector:
            if deep:
                scrolled = await page.evaluate(_DEEP_SCROLL_JS, selector)
                if not scrolled:
                    raise ValueError(f"Element not found in shadow DOM: {selector}")
            else:
                await page.locator(selector).scroll_into_view_if_needed(
                    timeout=DEFAULT_TIMEOUT_MS
                )
            result_data["scrolledIntoView"] = True

        if x is not None or y is not None:
            await page.evaluate(f"window.scrollBy({x or 0}, {y or 0})")
            result_data["scrolledBy"] = {"x": x or 0, "y": y or 0}

        return result_data

    result = await _with_session_page(_action)
    if result.success:
        if selector and (x or y):
            result.reasoning = (
                f"Scrolled '{selector}' into view and scrolled by ({x or 0}, {y or 0})"
            )
        elif selector:
            result.reasoning = f"Scrolled '{selector}' into view"
        else:
            result.reasoning = f"Scrolled page by ({x or 0}, {y or 0})"
    return result


async def cdp_drag(
    selector: str,
    to: str | None = None,
    dx: int | None = None,
    dy: int | None = None,
) -> CommandResult[dict]:
    """Drag an element to a target selector or by offsets."""
    if not to and (dx is None or dy is None):
        return error(
            "CDP_DRAG_TARGET_REQUIRED",
            "Provide --to selector or both --dx and --dy.",
            suggestion='Example: botcore cdp drag "#item" --dx 100 --dy 0',
        )

    async def _action(page: Any) -> dict:
        if to:
            await page.drag_and_drop(selector, to, timeout=DEFAULT_TIMEOUT_MS)
            return {"selector": selector, "to": to}
        box = await page.locator(selector).bounding_box()
        if not box:
            raise RuntimeError("Drag source element not found.")
        start_x = box["x"] + box["width"] / 2
        start_y = box["y"] + box["height"] / 2
        end_x = start_x + (dx or 0)
        end_y = start_y + (dy or 0)
        await page.mouse.move(start_x, start_y)
        await page.mouse.down()
        await page.mouse.move(end_x, end_y)
        await page.mouse.up()
        return {"selector": selector, "dx": dx, "dy": dy}

    return await _with_session_page(_action)


async def cdp_type(
    text: str,
    selector: str | None = None,
    delay_ms: int = 0,
    deep: bool = False,
) -> CommandResult[dict]:
    """Type text into the focused element or a specific element."""

    async def _action(page: Any) -> dict:
        if selector:
            if deep:
                box = await page.evaluate(_DEEP_QUERY_BOX_JS, selector)
                if not box:
                    raise ValueError(f"Element not found in shadow DOM: {selector}")
                await page.mouse.click(box["x"], box["y"])
            else:
                await page.locator(selector).click(timeout=DEFAULT_TIMEOUT_MS)

        if delay_ms > 0:
            await page.keyboard.type(text, delay=delay_ms)
        else:
            await page.keyboard.type(text)
        return {"text": text, "selector": selector, "delay_ms": delay_ms, "deep": deep}

    result = await _with_session_page(_action)
    if result.success:
        target = f"into '{selector}'" if selector else "into focused element"
        deep_desc = " (deep)" if deep else ""
        result.reasoning = f"Typed {len(text)} characters {target}{deep_desc}"
    return result


async def cdp_press(
    key: str,
    selector: str | None = None,
    deep: bool = False,
) -> CommandResult[dict]:
    """Press a key or key combination (e.g. Enter, Control+a, Alt+Tab)."""

    async def _action(page: Any) -> dict:
        if selector:
            if deep:
                focused = await page.evaluate(_DEEP_FOCUS_JS, selector)
                if not focused:
                    raise ValueError(f"Element not found in shadow DOM: {selector}")
            else:
                await page.locator(selector).focus(timeout=DEFAULT_TIMEOUT_MS)

        await page.keyboard.press(key)
        return {"key": key, "selector": selector, "deep": deep}

    result = await _with_session_page(_action)
    if result.success:
        target = f" on '{selector}'" if selector else ""
        deep_desc = " (deep)" if deep else ""
        result.reasoning = f"Pressed '{key}'{target}{deep_desc}"
    return result
