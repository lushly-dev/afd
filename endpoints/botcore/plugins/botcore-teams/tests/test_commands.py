"""Tests for command handlers."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from afd.core.result import success
from afd.testing import assert_error, assert_success

from botcore_teams.commands import teams_handle_card_action, teams_handle_message


class TestHandleMessage:
    async def test_assign_routing(self) -> None:
        result = await teams_handle_message(
            "assign research the latest Azure SDK changes to @researcher",
            user_id="u1",
            user_name="Alice",
            conversation_id="c1",
        )
        data = assert_success(result)
        assert data["agent"] == "researcher"
        assert "research the latest Azure SDK changes" in data["description"]

    async def test_team_status_routing(self) -> None:
        result = await teams_handle_message(
            "team status",
            user_id="u1",
            user_name="Alice",
            conversation_id="c1",
        )
        data = assert_success(result)
        assert "agents" in data

    async def test_task_status_routing(self) -> None:
        result = await teams_handle_message(
            "status of task-001",
            user_id="u1",
            user_name="Alice",
            conversation_id="c1",
        )
        data = assert_success(result)
        assert "status" in data

    async def test_cancel_routing(self) -> None:
        result = await teams_handle_message(
            "cancel task-001",
            user_id="u1",
            user_name="Alice",
            conversation_id="c1",
        )
        data = assert_success(result)
        assert data["cancelled"] is True

    async def test_list_tasks_routing(self) -> None:
        result = await teams_handle_message(
            "list tasks",
            user_id="u1",
            user_name="Alice",
            conversation_id="c1",
        )
        data = assert_success(result)
        assert "tasks" in data

    async def test_unknown_intent_error(self) -> None:
        result = await teams_handle_message(
            "hello there nice weather",
            user_id="u1",
            user_name="Alice",
            conversation_id="c1",
        )
        assert_error(result, "UNKNOWN_INTENT")


class TestHandleCardAction:
    async def test_retry_action(self) -> None:
        result = await teams_handle_card_action(
            "retry",
            {"original_text": "team status"},
            user_id="u1",
        )
        data = assert_success(result)
        assert "agents" in data

    async def test_followup_action(self) -> None:
        result = await teams_handle_card_action(
            "followup",
            {"text": "list tasks"},
            user_id="u1",
        )
        data = assert_success(result)
        assert "tasks" in data

    async def test_retry_missing_text(self) -> None:
        result = await teams_handle_card_action("retry", {}, user_id="u1")
        assert_error(result, "MISSING_CONTEXT")

    async def test_unknown_action(self) -> None:
        result = await teams_handle_card_action("bogus", {}, user_id="u1")
        assert_error(result, "UNKNOWN_ACTION")


class TestRealDispatchPath:
    async def test_uses_direct_client_when_available(self) -> None:
        mock_client = MagicMock()
        mock_client.call = AsyncMock(return_value=success(
            {"task_id": "task-777", "status": "queued"},
            reasoning="Dispatched via DirectClient",
        ))

        with patch("botcore.registry.get_client", return_value=mock_client):
            result = await teams_handle_message(
                "assign investigate issue to @researcher",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )

        data = assert_success(result)
        assert data["task_id"] == "task-777"
        mock_client.call.assert_awaited_once()
