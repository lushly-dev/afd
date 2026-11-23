"""Tests for command handlers."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from afd.core.result import error, success
from afd.testing import assert_error, assert_success

from botcore_teams.commands import teams_handle_card_action, teams_handle_message


def _mock_client(data: dict[str, Any]) -> MagicMock:
    client = MagicMock()
    client.call = AsyncMock(return_value=success(data, reasoning="Dispatched via DirectClient"))
    return client


class TestHandleMessage:
    async def test_assign_routing(self) -> None:
        client = _mock_client({"task_id": "task-42", "agent": "researcher", "status": "queued"})
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "assign research the latest Azure SDK changes to @researcher",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        data = assert_success(result)
        assert data["agent"] == "researcher"
        client.call.assert_awaited_once_with(
            "task_assign",
            {"description": "research the latest Azure SDK changes", "agent": "researcher"},
        )

    async def test_team_status_routing(self) -> None:
        client = _mock_client({"agents": [{"name": "researcher", "status": "idle"}]})
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "team status",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        data = assert_success(result)
        assert "agents" in data
        client.call.assert_awaited_once_with("team_status", {})

    async def test_task_status_routing(self) -> None:
        client = _mock_client({"task_id": "task-001", "status": "in_progress"})
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "status of task-001",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        data = assert_success(result)
        assert data["status"] == "in_progress"
        client.call.assert_awaited_once_with("task_status", {"task_id": "task-001"})

    async def test_cancel_routing(self) -> None:
        client = _mock_client({"cancelled": True, "task_id": "task-001", "status": "cancelled"})
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "cancel task-001",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        data = assert_success(result)
        assert data["cancelled"] is True
        client.call.assert_awaited_once_with("task_cancel", {"task_id": "task-001"})

    @pytest.mark.parametrize(
        "text",
        ["cancel the current work", "cancel task assigned to @researcher"],
    )
    async def test_task_cancel_without_an_id_asks_for_one(self, text: str) -> None:
        client = _mock_client({})
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                text,
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        err = assert_error(result, "MISSING_TASK_ID")
        assert err.suggestion and "cancel" in err.suggestion
        client.call.assert_not_awaited()

    async def test_list_tasks_routing(self) -> None:
        client = _mock_client({"tasks": []})
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "list tasks",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        data = assert_success(result)
        assert "tasks" in data
        client.call.assert_awaited_once_with("task_list", {})

    async def test_task_status_without_an_id_asks_for_one(self) -> None:
        client = _mock_client({})
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "how is the research going",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        err = assert_error(result, "MISSING_TASK_ID")
        assert err.suggestion and "status of" in err.suggestion
        client.call.assert_not_awaited()

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
        client = _mock_client({"agents": []})
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_card_action(
                "retry",
                {"original_text": "team status"},
                user_id="u1",
            )
        data = assert_success(result)
        assert "agents" in data
        client.call.assert_awaited_once_with("team_status", {})

    async def test_followup_action(self) -> None:
        client = _mock_client({"tasks": []})
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_card_action(
                "followup",
                {"text": "list tasks"},
                user_id="u1",
            )
        data = assert_success(result)
        assert "tasks" in data
        client.call.assert_awaited_once_with("task_list", {})

    async def test_retry_missing_text(self) -> None:
        result = await teams_handle_card_action("retry", {}, user_id="u1")
        err = assert_error(result, "MISSING_CONTEXT")
        assert err.suggestion

    async def test_followup_missing_text(self) -> None:
        result = await teams_handle_card_action("followup", {}, user_id="u1")
        err = assert_error(result, "MISSING_CONTEXT")
        assert err.suggestion

    async def test_unknown_action(self) -> None:
        result = await teams_handle_card_action("bogus", {}, user_id="u1")
        assert_error(result, "UNKNOWN_ACTION")


class TestRealDispatchPath:
    async def test_uses_direct_client_when_available(self) -> None:
        mock_client = _mock_client({"task_id": "task-777", "status": "queued"})

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

    async def test_empty_registry_returns_failure_with_suggestion_never_a_stub(self) -> None:
        # With no botcore-agents commands registered, DirectClient returns UNKNOWN_TOOL.
        result = await teams_handle_message(
            "assign investigate issue to @researcher",
            user_id="u1",
            user_name="Alice",
            conversation_id="c1",
        )
        err = assert_error(result, "UNKNOWN_TOOL")
        assert result.data is None
        assert "task_assign" in err.message
        assert err.suggestion and "task_assign" in err.suggestion
        assert err.retryable is False

    @pytest.mark.parametrize("code", ["UNKNOWN_TOOL", "UNKNOWN_COMMAND"])
    async def test_missing_command_returns_error_with_suggestion(self, code: str) -> None:
        client = MagicMock()
        client.call = AsyncMock(return_value=error(code, "not found"))
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "team status",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        err = assert_error(result, code)
        assert result.data is None
        assert err.suggestion and "team_status" in err.suggestion
        assert err.retryable is False

    async def test_non_missing_error_is_propagated(self) -> None:
        client = MagicMock()
        client.call = AsyncMock(
            return_value=error("PERMISSION_DENIED", "Forbidden", suggestion="Ask an admin.")
        )
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "list tasks",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        err = assert_error(result, "PERMISSION_DENIED")
        assert err.suggestion == "Ask an admin."

    async def test_downstream_error_without_suggestion_gets_recovery_guidance(self) -> None:
        client = MagicMock()
        client.call = AsyncMock(return_value=error("NO_AGENT", "Unavailable"))
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "team status",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        err = assert_error(result, "NO_AGENT")
        assert err.message == "Unavailable"
        assert err.suggestion and "team_status" in err.suggestion

    async def test_dispatch_exception_hides_raw_error_and_avoids_blind_retry(self) -> None:
        client = MagicMock()
        client.call = AsyncMock(side_effect=RuntimeError("secret internal db trace"))
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "assign deploy fix to @coder",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        err = assert_error(result, "DISPATCH_FAILED")
        assert "secret internal db trace" not in err.message
        assert err.suggestion and "before retrying" in err.suggestion
        assert err.retryable is False

    async def test_attribute_error_during_call_is_dispatch_failed_not_unavailable(self) -> None:
        client = MagicMock()
        client.call = AsyncMock(side_effect=AttributeError("handler bug"))
        with patch("botcore.registry.get_client", return_value=client):
            result = await teams_handle_message(
                "team status",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        err = assert_error(result, "DISPATCH_FAILED")
        assert err.suggestion
        assert err.retryable is False

    async def test_missing_dispatcher_returns_unavailable_failure(self) -> None:
        with patch("botcore.registry.get_client", side_effect=ImportError("no registry")):
            result = await teams_handle_message(
                "team status",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        err = assert_error(result, "DISPATCH_UNAVAILABLE")
        assert err.suggestion
        assert err.retryable is False


class TestShippedAgentCommands:
    """Every Teams intent reaches a shipped botcore-agents command (lushly-dev/afd#2174, #2234)."""

    @staticmethod
    def _build_registry():
        from afd import SimpleRegistry, create_direct_client
        from botcore_agents import commands as agents_commands

        registry = SimpleRegistry()
        for cmd in agents_commands.AGENT_COMMANDS:
            registry.command(cmd.__name__)(cmd)
        return create_direct_client(registry), agents_commands

    def test_every_intent_maps_to_a_shipped_agent_command(self) -> None:
        from botcore_agents import commands as agents_commands

        from botcore_teams.intent import INTENT_PATTERNS

        shipped = {cmd.__name__ for cmd in agents_commands.AGENT_COMMANDS}
        routed = {command for _, command, _ in INTENT_PATTERNS}
        assert routed <= shipped

    async def test_status_message_runs_the_shipped_handler(self) -> None:
        client, agents_commands = self._build_registry()
        orchestrator = MagicMock()
        orchestrator.get_task.return_value = success({"id": "task-001", "status": "running"})
        with (
            patch.object(agents_commands, "_get_orch", return_value=orchestrator),
            patch("botcore.registry.get_client", return_value=client),
        ):
            result = await teams_handle_message(
                "status of task-001",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        data = assert_success(result)
        assert data["status"] == "running"
        orchestrator.get_task.assert_called_once_with("task-001")

    async def test_assign_message_runs_the_shipped_handler(self) -> None:
        client, agents_commands = self._build_registry()
        orchestrator = MagicMock()
        orchestrator.assign_task = AsyncMock(
            return_value=success(
                {"task_id": "task-42", "status": "completed", "result": "ok", "agent": "researcher"}
            )
        )
        with (
            patch.object(agents_commands, "_get_orch", return_value=orchestrator),
            patch("botcore.registry.get_client", return_value=client),
        ):
            result = await teams_handle_message(
                "assign audit dependencies to @researcher",
                user_id="u1",
                user_name="Alice",
                conversation_id="c1",
            )
        data = assert_success(result)
        assert data["agent"] == "researcher"
        orchestrator.assign_task.assert_awaited_once_with(
            "audit dependencies", agent="researcher", role="", priority=5
        )

    async def test_team_status_list_and_cancel_run_against_real_orchestrator(self) -> None:
        from botcore_agents.config import AgentConfig, AgentsPluginConfig
        from botcore_agents.models import Task
        from botcore_agents.orchestrator import AgentOrchestrator

        client, agents_commands = self._build_registry()
        cfg = AgentsPluginConfig(
            agents={"researcher": AgentConfig(name="researcher", model="test-model")},
            default_model="test-model",
        )
        orchestrator = AgentOrchestrator(cfg)
        assert_success(await orchestrator.create_agent("researcher"))
        task = Task(description="Investigate queue", status="pending")
        orchestrator._tasks[task.id] = task

        with (
            patch.object(agents_commands, "_get_orch", return_value=orchestrator),
            patch("botcore.registry.get_client", return_value=client),
        ):
            team_res = await teams_handle_message(
                "team status", user_id="u1", user_name="Alice", conversation_id="c1"
            )
            team_data = assert_success(team_res)
            assert team_data["agent_count"] == 1
            assert team_data["agents"][0]["name"] == "researcher"
            assert team_data["pending_tasks"] == 1
            assert team_res.reasoning

            list_res = await teams_handle_message(
                "list tasks", user_id="u1", user_name="Alice", conversation_id="c1"
            )
            list_data = assert_success(list_res)
            assert list_data["count"] == 1
            assert list_data["tasks"][0]["id"] == task.id

            from botcore_teams.cards import render_command_result

            list_card = render_command_result(list_res)
            list_facts = list_card["body"][1]["facts"]
            assert any(
                f["title"] == task.id and "Investigate queue" in f["value"] for f in list_facts
            )
            team_card = render_command_result(team_res)
            team_facts = team_card["body"][1]["facts"]
            assert any(f["title"] == "researcher" and "stopped" in f["value"] for f in team_facts)

            cancel_res = await teams_handle_message(
                f"cancel task {task.id}", user_id="u1", user_name="Alice", conversation_id="c1"
            )
            cancel_data = assert_success(cancel_res)
            assert cancel_data["cancelled"] is True
            assert cancel_data["task_id"] == task.id

            status_res = await teams_handle_message(
                f"status of {task.id}", user_id="u1", user_name="Alice", conversation_id="c1"
            )
            status_data = assert_success(status_res)
            assert status_data["status"] == "cancelled"
