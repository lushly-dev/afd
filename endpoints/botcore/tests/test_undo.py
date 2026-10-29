"""Tests for botcore.commands.undo — history tracking."""

from __future__ import annotations

from unittest.mock import patch

from afd.testing import assert_success

from botcore.commands.undo import (
    clear_history,
    load_history,
    save_history,
    undo_clear,
    undo_status,
)


async def test_undo_status_no_history(tmp_path) -> None:
    """undo_status returns no history when file doesn't exist."""
    with patch("botcore.commands.undo.HISTORY_FILE", tmp_path / "nonexistent.json"):
        result = await undo_status()

    data = assert_success(result)
    assert data["has_history"] is False


async def test_undo_status_with_history(tmp_path) -> None:
    """undo_status returns last action details."""
    history_file = tmp_path / "history.json"
    history_file.write_text(
        '{"last_action": {"action": "work.start", "timestamp": "2026-01-01", "branch": "feat"}}'
    )

    with patch("botcore.commands.undo.HISTORY_FILE", history_file):
        result = await undo_status()

    data = assert_success(result)
    assert data["has_history"] is True
    assert data["last_action"] == "work.start"
    assert any("git checkout" in cmd for cmd in data["rollback_commands"])


async def test_undo_clear(tmp_path) -> None:
    """undo_clear removes history file."""
    history_file = tmp_path / "history.json"
    history_file.write_text("{}")

    with patch("botcore.commands.undo.HISTORY_FILE", history_file):
        result = await undo_clear()

    data = assert_success(result)
    assert data["cleared"] is True
    assert not history_file.exists()


def test_save_and_load_history(tmp_path) -> None:
    """save_history writes and load_history reads correctly."""
    history_file = tmp_path / "history.json"

    with patch("botcore.commands.undo.HISTORY_FILE", history_file):
        save_history("test.action", {"key": "value"})
        history = load_history()

    assert history["last_action"]["action"] == "test.action"
    assert history["last_action"]["key"] == "value"
    assert "timestamp" in history["last_action"]


def test_clear_history_no_file(tmp_path) -> None:
    """clear_history is safe when no file exists."""
    history_file = tmp_path / "nonexistent.json"

    with patch("botcore.commands.undo.HISTORY_FILE", history_file):
        clear_history()  # Should not raise
