"""Tests for agent command functions."""

from __future__ import annotations

import pytest
from afd.testing import assert_error, assert_success

from botcore_agents.commands import (
    agent_create,
    agent_delete,
    agent_heartbeat,
    agent_start,
    agent_status,
    agent_stop,
    set_config,
    state_load,
    state_save,
    task_assign,
    task_resume,
    task_status,
)
from botcore_agents.config import AgentsPluginConfig, AgentsStateConfig
from botcore_agents.orchestrator import reset_orchestrator


@pytest.fixture(autouse=True)
def _inject_config(sample_config: AgentsPluginConfig):
    """Inject sample config into the commands module for every test."""
    set_config(sample_config)
    reset_orchestrator()
    yield
    set_config(None)
    reset_orchestrator()


class TestAgentCreate:
    async def test_create_returns_success(self):
        result = await agent_create(name="researcher")
        data = assert_success(result)
        assert data["name"] == "researcher"
        assert data["status"] == "stopped"
        assert result.undo_command == "agent_delete"
        assert result.undo_args == {"name": "researcher"}

    async def test_create_unconfigured_returns_error(self):
        result = await agent_create(name="unknown")
        assert_error(result, "AGENT_NOT_CONFIGURED")


class TestAgentDelete:
    async def test_delete_stopped_agent(self):
        await agent_create(name="researcher")
        result = await agent_delete(name="researcher")
        data = assert_success(result)
        assert data["deleted"] is True
        assert result.undo_command == "agent_create"
        assert result.undo_args == {"name": "researcher"}

    async def test_delete_started_agent_requires_stop(self, mock_llm):
        await agent_create(name="researcher")
        await agent_start(name="researcher")
        result = await agent_delete(name="researcher")
        assert_error(result, "AGENT_MUST_BE_STOPPED")

    async def test_delete_not_found(self):
        result = await agent_delete(name="ghost")
        assert_error(result, "AGENT_NOT_FOUND")


class TestAgentStart:
    async def test_start_returns_session(self, mock_llm):
        await agent_create(name="researcher")
        result = await agent_start(name="researcher")
        data = assert_success(result)
        assert data["session_id"] == "session-agent-001"

    async def test_start_not_found(self, mock_llm):
        result = await agent_start(name="ghost")
        assert_error(result, "AGENT_NOT_FOUND")


class TestAgentStop:
    async def test_stop_returns_stopped(self, mock_llm):
        await agent_create(name="researcher")
        await agent_start(name="researcher")
        result = await agent_stop(name="researcher")
        data = assert_success(result)
        assert data["status"] == "stopped"

    async def test_stop_not_started(self, mock_llm):
        await agent_create(name="researcher")
        result = await agent_stop(name="researcher")
        assert_error(result, "AGENT_NOT_STARTED")


class TestAgentStatus:
    async def test_status_returns_health(self, mock_llm):
        await agent_create(name="researcher")
        await agent_start(name="researcher")
        result = await agent_status(name="researcher")
        data = assert_success(result)
        assert data["name"] == "researcher"
        assert data["status"] == "idle"

    async def test_status_not_found(self):
        result = await agent_status(name="ghost")
        assert_error(result, "AGENT_NOT_FOUND")


class TestAgentHeartbeat:
    async def test_heartbeat_updates(self, mock_llm):
        await agent_create(name="researcher")
        await agent_start(name="researcher")
        result = await agent_heartbeat(name="researcher")
        data = assert_success(result)
        assert data["last_heartbeat"] is not None

    async def test_heartbeat_not_started(self):
        await agent_create(name="researcher")
        result = await agent_heartbeat(name="researcher")
        assert_error(result, "AGENT_NOT_STARTED")


class TestTaskAssign:
    async def test_assign_returns_result(self, mock_llm):
        await agent_create(name="researcher")
        await agent_start(name="researcher")
        result = await task_assign(description="Find bugs", agent="researcher")
        data = assert_success(result)
        assert data["status"] == "completed"
        assert data["result"] == "Task completed successfully"

    async def test_assign_custom_priority(self, mock_llm):
        await agent_create(name="researcher")
        await agent_start(name="researcher")
        result = await task_assign(description="Urgent", agent="researcher", priority=1)
        data = assert_success(result)
        task_id = data["task_id"]
        task_result = await task_status(task_id=task_id)
        assert task_result.data["priority"] == 1

    async def test_assign_not_found(self, mock_llm):
        result = await task_assign(description="Work", agent="ghost")
        assert_error(result, "AGENT_NOT_FOUND")

    async def test_assign_by_role(self, mock_llm):
        await agent_create(name="researcher")
        await agent_start(name="researcher")
        result = await task_assign(description="Research task", role="researcher")
        data = assert_success(result)
        assert data["agent"] == "researcher"

    async def test_assign_no_target(self):
        result = await task_assign(description="Work")
        assert_error(result, "NO_TARGET")


class TestTaskStatus:
    async def test_task_status_found(self, mock_llm):
        await agent_create(name="researcher")
        await agent_start(name="researcher")
        assign_result = await task_assign(description="Work", agent="researcher")
        task_id = assign_result.data["task_id"]
        result = await task_status(task_id=task_id)
        data = assert_success(result)
        assert data["description"] == "Work"

    async def test_task_status_not_found(self):
        result = await task_status(task_id="no-such-id")
        assert_error(result, "TASK_NOT_FOUND")


class TestTaskResume:
    async def test_resume_pending_task(self, mock_llm):
        from botcore_agents.models import Task
        from botcore_agents.orchestrator import get_orchestrator

        await agent_create(name="researcher")
        await agent_start(name="researcher")
        task = Task(description="Resume me", status="pending")
        get_orchestrator()._tasks[task.id] = task

        result = await task_resume(task_id=task.id, agent="researcher")
        data = assert_success(result)
        assert data["task_id"] == task.id
        assert data["status"] == "completed"
        assert data["agent"] == "researcher"

    async def test_resume_non_pending_task_returns_error(self, mock_llm):
        from botcore_agents.models import Task
        from botcore_agents.orchestrator import get_orchestrator

        task = Task(description="done", status="completed")
        get_orchestrator()._tasks[task.id] = task

        result = await task_resume(task_id=task.id, agent="researcher")
        assert_error(result, "TASK_NOT_RESUMABLE")


class TestStateCommands:
    async def test_state_save_and_load_use_configured_backend(self, tmp_path, sample_config):
        sample_config.state = AgentsStateConfig(
            enabled=True,
            path=str(tmp_path / "orchestrator-state.json"),
            retention_hours=24,
        )
        set_config(sample_config)

        await agent_create(name="researcher")
        save_result = await state_save()
        save_data = assert_success(save_result)
        assert save_data["saved"] is True
        assert (tmp_path / "orchestrator-state.json").exists()

        reset_orchestrator()
        load_result = await state_load()
        load_data = assert_success(load_result)
        assert load_data["restored"] is True

    async def test_state_commands_without_backend_return_no_backend(self, sample_config):
        set_config(sample_config)
        result = await state_save()
        assert_error(result, "NO_BACKEND")


# ---------------------------------------------------------------------------
# Integration scenarios
# ---------------------------------------------------------------------------


class TestHappyPathScenario:
    """End-to-end: create → start → assign → check status → stop."""

    async def test_full_lifecycle(self, mock_llm):
        # Create
        r = await agent_create(name="researcher")
        assert_success(r)

        # Start
        r = await agent_start(name="researcher")
        session_id = assert_success(r)["session_id"]
        assert session_id

        # Assign task
        r = await task_assign(description="Analyse codebase", agent="researcher")
        assign_data = assert_success(r)
        assert assign_data["status"] == "completed"
        task_id = assign_data["task_id"]

        # Check task status
        r = await task_status(task_id=task_id)
        task_data = assert_success(r)
        assert task_data["status"] == "completed"
        assert task_data["assigned_agent"] == "researcher"

        # Check agent health
        r = await agent_status(name="researcher")
        status_data = assert_success(r)
        assert status_data["tasks_completed"] == 1

        # Stop
        r = await agent_stop(name="researcher")
        stop_data = assert_success(r)
        assert stop_data["status"] == "stopped"

        # Delete
        r = await agent_delete(name="researcher")
        delete_data = assert_success(r)
        assert delete_data["deleted"] is True


class TestMultiAgentIsolation:
    """Two agents with independent sessions."""

    async def test_two_agents_independent(self, mock_llm):
        # Second agent gets a different session ID
        from afd import success

        call_count = 0

        async def varying_session_create(**kwargs):
            nonlocal call_count
            call_count += 1
            return success(
                data={
                    "session_id": f"session-agent-{call_count:03d}",
                    "model": kwargs.get("model", "test-model"),
                    "tools": [],
                },
                reasoning="Mock session",
            )

        mock_llm["session_create"].side_effect = varying_session_create

        await agent_create(name="researcher")
        await agent_create(name="coder")
        await agent_start(name="researcher")
        await agent_start(name="coder")

        r1 = await agent_status(name="researcher")
        r2 = await agent_status(name="coder")
        assert r1.data["name"] == "researcher"
        assert r2.data["name"] == "coder"

        # Assign to each
        t1 = await task_assign(description="Research", agent="researcher")
        t2 = await task_assign(description="Code", agent="coder")
        t1_data = assert_success(t1)
        t2_data = assert_success(t2)
        assert t1_data["task_id"] != t2_data["task_id"]


class TestErrorCascading:
    """Stop agent with running task → task marked cancelled."""

    async def test_stop_cancels_active_tasks(self, mock_llm):
        await agent_create(name="researcher")
        await agent_start(name="researcher")

        # Simulate an active task without actually running it
        from botcore_agents.orchestrator import get_orchestrator

        orch = get_orchestrator()
        from botcore_agents.models import Task

        task = Task(description="Long running", assigned_agent="researcher", status="running")
        orch._tasks[task.id] = task
        orch._agents["researcher"].active_tasks.append(task.id)

        result = await agent_stop(name="researcher")
        data = assert_success(result)
        assert task.id in data["cancelled_tasks"]

        # Verify task is cancelled
        task_result = await task_status(task_id=task.id)
        assert task_result.data["status"] == "cancelled"


class TestCapacityLimit:
    """Assign tasks up to max_concurrent_tasks, next one errors."""

    async def test_capacity_enforcement(self, mock_llm):
        # Coder has max_concurrent_tasks=1
        await agent_create(name="coder")
        await agent_start(name="coder")

        # Manually fill capacity
        from botcore_agents.orchestrator import get_orchestrator

        orch = get_orchestrator()
        orch._agents["coder"].active_tasks.append("fake-task")

        result = await task_assign(description="More work", agent="coder")
        assert_error(result, "AGENT_AT_CAPACITY")
