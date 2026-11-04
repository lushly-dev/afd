"""Tests for botcore.commands.cdp.core — session management (no browser needed)."""

from __future__ import annotations

import re
from pathlib import Path

from botcore.commands import cdp
from botcore.commands.cdp.core import (
    CdpSession,
    ConsoleEntry,
    _clear_session,
    _load_session,
    _save_session,
)

_BROWSER_SKILL = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "botcore"
    / "skills"
    / "browser-automation"
    / "SKILL.md"
)


def test_session_roundtrip(tmp_path) -> None:
    """Save and load a CDP session from disk."""
    session = CdpSession(
        cdp_endpoint="http://127.0.0.1:9222",
        profile_dir=str(tmp_path / "profile"),
        launched_at="2026-01-01T00:00:00",
        pid=1234,
    )
    _save_session(tmp_path, session)
    loaded = _load_session(tmp_path)

    assert loaded is not None
    assert loaded.cdp_endpoint == "http://127.0.0.1:9222"
    assert loaded.pid == 1234


def test_load_session_not_found(tmp_path) -> None:
    """_load_session returns None when no session file exists."""
    assert _load_session(tmp_path) is None


def test_clear_session(tmp_path) -> None:
    """_clear_session removes the session file."""
    session = CdpSession(
        cdp_endpoint="http://127.0.0.1:9222",
        profile_dir=str(tmp_path),
        launched_at="2026-01-01T00:00:00",
    )
    _save_session(tmp_path, session)
    assert _load_session(tmp_path) is not None

    _clear_session(tmp_path)
    assert _load_session(tmp_path) is None


def test_session_with_console_log(tmp_path) -> None:
    """CdpSession preserves console log entries."""
    session = CdpSession(
        cdp_endpoint="http://127.0.0.1:9222",
        profile_dir=str(tmp_path),
        launched_at="2026-01-01T00:00:00",
        console_log=[
            ConsoleEntry(timestamp="2026-01-01", level="log", text="hello"),
            ConsoleEntry(timestamp="2026-01-01", level="error", text="oops"),
        ],
    )
    _save_session(tmp_path, session)
    loaded = _load_session(tmp_path)

    assert loaded is not None
    assert len(loaded.console_log) == 2
    assert loaded.console_log[0].text == "hello"
    assert loaded.console_log[1].level == "error"


def test_clear_session_no_file(tmp_path) -> None:
    """_clear_session is safe when no file exists."""
    _clear_session(tmp_path)  # Should not raise


def test_browser_automation_skill_names_every_cdp_command() -> None:
    """The bundled browser-automation skill names every exported cdp_* command."""
    commands = [name for name in cdp.__all__ if name.startswith("cdp_")]
    assert commands

    skill = _BROWSER_SKILL.read_text(encoding="utf-8")
    missing = [name for name in commands if not re.search(rf"\b{name}\b", skill)]
    assert not missing, f"browser-automation/SKILL.md does not name: {missing}"
