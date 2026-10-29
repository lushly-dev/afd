"""CDP inspection — DOM queries and element inspection commands."""

from __future__ import annotations

from typing import Any

import yaml
from afd import CommandResult

from botcore.commands.cdp.core import _with_session_page

_DEEP_QUERY_ALL_JS = """
(selector) => {
    function querySelectorAllDeep(root, sel) {
        const results = [];
        results.push(...root.querySelectorAll(sel));
        const elements = root.querySelectorAll('*');
        for (const el of elements) {
            if (el.shadowRoot) {
                results.push(...querySelectorAllDeep(el.shadowRoot, sel));
            }
        }
        return results;
    }
    const elements = querySelectorAllDeep(document, selector);
    return elements.map(el => ({
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
        className: el.className || null,
        textContent: (el.textContent || '').trim().substring(0, 100),
        attributes: Object.fromEntries(
            Array.from(el.attributes || []).map(a => [a.name, a.value])
        ),
    }));
}
"""

_SHADOW_SYNTAX_JS = """
(selector) => {
    const parts = selector.split('::shadow');
    let current = document;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;
        const el = current.querySelector(part);
        if (!el) return { found: false, failedAt: part, index: i };
        if (i < parts.length - 1) {
            if (!el.shadowRoot) {
                return { found: false, failedAt: part, reason: 'no shadowRoot' };
            }
            current = el.shadowRoot;
        } else {
            return {
                found: true,
                element: {
                    tagName: el.tagName.toLowerCase(),
                    id: el.id || null,
                    className: el.className || null,
                    textContent: (el.textContent || '').trim().substring(0, 100),
                    attributes: Object.fromEntries(
                        Array.from(el.attributes || []).map(a => [a.name, a.value])
                    ),
                }
            };
        }
    }
    return { found: false, reason: 'empty selector' };
}
"""


async def cdp_inspect(
    selector: str,
    prop: str | None = None,
    attr: str | None = None,
    style: str | None = None,
    text: bool = False,
    visible: bool = False,
    enabled: bool = False,
    focused: bool = False,
) -> CommandResult[dict]:
    """Inspect element properties, attributes, styles, and state."""

    async def _action(page: Any) -> dict:
        locator = page.locator(selector)
        result: dict[str, Any] = {"selector": selector}

        if prop:
            value = await locator.evaluate(f"el => el.{prop}")
            result["property"] = prop
            result["value"] = value
        elif attr:
            value = await locator.get_attribute(attr)
            result["attribute"] = attr
            result["value"] = value
        elif style:
            value = await locator.evaluate(
                f"el => getComputedStyle(el).getPropertyValue('{style}')"
            )
            result["style"] = style
            result["value"] = value
        elif text:
            value = await locator.text_content()
            result["text"] = True
            result["value"] = (value or "").strip()
        elif visible:
            result["visible"] = await locator.is_visible()
        elif enabled:
            result["enabled"] = await locator.is_enabled()
        elif focused:
            result["focused"] = await locator.evaluate(
                "el => document.activeElement === el"
            )
        else:
            info = await locator.evaluate("""el => ({
                tagName: el.tagName.toLowerCase(),
                id: el.id || null,
                className: el.className || null,
                textContent: (el.textContent || '').trim().substring(0, 200),
                value: el.value !== undefined ? el.value : null,
                checked: el.checked !== undefined ? el.checked : null,
                visible: el.offsetParent !== null,
                disabled: el.disabled || false,
            })""")
            result["info"] = info

        return result

    cmd_result = await _with_session_page(_action)
    if cmd_result.success and cmd_result.data:
        data = cmd_result.data
        if "info" in data:
            tag = data["info"].get("tagName", "unknown")
            cmd_result.reasoning = f"Inspected '{selector}' ({tag})"
        elif "value" in data:
            cmd_result.reasoning = f"Got value from '{selector}'"
        else:
            cmd_result.reasoning = f"Inspected '{selector}'"
    return cmd_result


async def cdp_query(selector: str, deep: bool = True) -> CommandResult[dict]:
    """Query for elements with automatic shadow DOM traversal."""

    async def _action(page: Any) -> dict:
        if "::shadow" in selector:
            result = await page.evaluate(_SHADOW_SYNTAX_JS, selector)
            if not result.get("found"):
                raise ValueError(
                    f"Element not found: failed at '{result.get('failedAt', 'unknown')}' "
                    f"({result.get('reason', 'not found')})"
                )
            return {
                "selector": selector,
                "mode": "explicit",
                "count": 1,
                "elements": [result["element"]],
            }
        else:
            elements = await page.evaluate(_DEEP_QUERY_ALL_JS, selector)
            return {
                "selector": selector,
                "mode": "deep",
                "count": len(elements),
                "elements": elements[:10],
            }

    result = await _with_session_page(_action)
    if result.success and result.data:
        count = result.data.get("count", 0)
        mode = result.data.get("mode", "deep")
        result.reasoning = f"Found {count} element(s) matching '{selector}' ({mode} mode)"
    return result


async def cdp_snapshot(root_selector: str | None = None) -> CommandResult[dict]:
    """Take an accessibility tree snapshot of the page."""

    def _parse_snapshot_label(label: str) -> dict[str, Any]:
        text = label.strip()
        attrs: dict[str, str] = {}

        while text.endswith("]") and " [" in text:
            text, attr_block = text.rsplit(" [", 1)
            attr_block = attr_block[:-1]
            if "=" in attr_block:
                key, value = attr_block.split("=", 1)
                attrs[key.strip()] = value.strip().strip('"')

        role = text
        name = ""
        if ' "' in text and text.endswith('"'):
            role, name = text.split(' "', 1)
            name = name[:-1]

        result: dict[str, Any] = {
            "role": role.strip(),
            "name": name,
        }
        if attrs:
            result["attributes"] = attrs
        return result

    def _to_snapshot_tree(node: Any) -> list[dict[str, Any]]:
        if node is None:
            return []
        if isinstance(node, list):
            result: list[dict[str, Any]] = []
            for child in node:
                result.extend(_to_snapshot_tree(child))
            return result
        if isinstance(node, str):
            return [_parse_snapshot_label(node)]
        if isinstance(node, dict):
            result: list[dict[str, Any]] = []
            for key, value in node.items():
                entry = _parse_snapshot_label(str(key))
                children = _to_snapshot_tree(value)
                if children:
                    entry["children"] = children
                result.append(entry)
            return result
        return [{"role": "unknown", "name": str(node)}]

    async def _action(page: Any) -> dict:
        if root_selector:
            locator = page.locator(root_selector)
            if await locator.count() == 0:
                raise ValueError(f"Root element not found: {root_selector}")
            snapshot_text = await locator.first.aria_snapshot()
        else:
            snapshot_text = await page.locator("body").aria_snapshot()

        parsed = yaml.safe_load(snapshot_text) if snapshot_text else None
        children = _to_snapshot_tree(parsed)
        if root_selector and len(children) == 1:
            snapshot: dict[str, Any] | None = children[0]
        else:
            snapshot = {
                "role": "document" if root_selector is None else "group",
                "name": "",
                "children": children,
            }

        return {
            "snapshot": snapshot,
            "raw_snapshot": snapshot_text,
            "root": root_selector or "document",
        }

    return await _with_session_page(_action)
