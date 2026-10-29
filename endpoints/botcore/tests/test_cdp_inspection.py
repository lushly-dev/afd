"""Tests for botcore.commands.cdp.inspection."""

from __future__ import annotations

import pytest
from afd import error, success
from afd.testing import assert_success

from botcore.commands.cdp import inspection


class _FakeLocator:
    def __init__(self, snapshot_text: str, count: int = 1) -> None:
        self._snapshot_text = snapshot_text
        self._count = count

    async def count(self) -> int:
        return self._count

    @property
    def first(self) -> _FakeLocator:
        return self

    async def aria_snapshot(self) -> str:
        return self._snapshot_text


class _FakePage:
    def __init__(self, snapshots: dict[str, _FakeLocator]) -> None:
        self._snapshots = snapshots

    def locator(self, selector: str) -> _FakeLocator:
        return self._snapshots.get(selector, _FakeLocator("", count=0))


@pytest.mark.asyncio
async def test_cdp_snapshot_uses_body_aria_snapshot(monkeypatch) -> None:
    snapshot_text = (
        '- main:\n'
        '  - heading "Garden" [level=1]\n'
        '  - button "Save"\n'
    )
    fake_page = _FakePage({"body": _FakeLocator(snapshot_text)})

    async def _fake_with_session_page(action, timeout_ms=30000):
        return success(data=await action(fake_page))

    monkeypatch.setattr(inspection, "_with_session_page", _fake_with_session_page)

    result = await inspection.cdp_snapshot()

    data = assert_success(result)
    assert data["root"] == "document"
    assert data["raw_snapshot"] == snapshot_text
    assert data["snapshot"]["role"] == "document"
    assert data["snapshot"]["children"][0]["role"] == "main"
    assert data["snapshot"]["children"][0]["children"][0]["role"] == "heading"
    assert data["snapshot"]["children"][0]["children"][0]["name"] == "Garden"
    assert data["snapshot"]["children"][0]["children"][0]["attributes"]["level"] == "1"


@pytest.mark.asyncio
async def test_cdp_snapshot_uses_root_selector_subtree(monkeypatch) -> None:
    snapshot_text = (
        '- form "Login":\n'
        '  - textbox "Email"\n'
        '  - button "Save"\n'
    )
    fake_page = _FakePage({"#login": _FakeLocator(snapshot_text)})

    async def _fake_with_session_page(action, timeout_ms=30000):
        return success(data=await action(fake_page))

    monkeypatch.setattr(inspection, "_with_session_page", _fake_with_session_page)

    result = await inspection.cdp_snapshot(root_selector="#login")

    data = assert_success(result)
    assert data["root"] == "#login"
    assert data["snapshot"]["role"] == "form"
    assert data["snapshot"]["name"] == "Login"
    assert data["snapshot"]["children"][0]["role"] == "textbox"


@pytest.mark.asyncio
async def test_cdp_snapshot_errors_when_root_selector_missing(monkeypatch) -> None:
    fake_page = _FakePage({})

    async def _fake_with_session_page(action, timeout_ms=30000):
        try:
            data = await action(fake_page)
            return success(data=data)
        except Exception as exc:  # pragma: no cover - mirrors command wrapper
            return error("ROOT_NOT_FOUND", str(exc))

    monkeypatch.setattr(inspection, "_with_session_page", _fake_with_session_page)

    result = await inspection.cdp_snapshot(root_selector="#missing")

    assert result.error is not None
    assert "Root element not found" in result.error.message
