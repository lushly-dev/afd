"""Tests for orchestrator state serialization: snapshot model, JSON backend, save/load."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from afd.testing import assert_error, assert_success
from pydantic import ValidationError

from botcore_agents.config import AgentConfig, AgentsPluginConfig
from botcore_agents.models import AgentHealth, AgentState, Task
from botcore_agents.orchestrator import AgentOrchestrator
from botcore_agents.state import (
    AgentSnapshot,
    JsonStateBackend,
    OrchestratorSnapshot,
    TaskSnapshot,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _minimal_config() -> AgentsPluginConfig:
    return AgentsPluginConfig(
        agents={
            "researcher": AgentConfig(
                name="researcher",
                role="researcher",
                model="test-model",
            ),
        },
    )


def _minimal_snapshot() -> OrchestratorSnapshot:
    config = _minimal_config()
    agent_state = AgentState(
        config=config.agents["researcher"],
        health=AgentHealth(name="researcher", status="idle"),
        session_id="sess-1",
    )
    task = Task(description="test task", status="completed", assigned_agent="researcher")
    return OrchestratorSnapshot(
        config=config,
        agents={"researcher": AgentSnapshot.from_state(agent_state)},
        tasks={task.id: TaskSnapshot.from_task(task)},
    )


# ===========================================================================
# TestOrchestratorSnapshot
# ===========================================================================


class TestOrchestratorSnapshot:
    def test_defaults(self):
        config = _minimal_config()
        snap = OrchestratorSnapshot(config=config, agents={}, tasks={})
        assert snap.version == "1.0"
        assert isinstance(snap.timestamp, datetime)
        assert snap.timestamp.tzinfo is not None

    def test_roundtrip_json(self):
        snap = _minimal_snapshot()
        raw = snap.model_dump(mode="json")
        restored = OrchestratorSnapshot.model_validate(raw)
        assert restored.version == snap.version
        assert restored.agents.keys() == snap.agents.keys()
        assert restored.tasks.keys() == snap.tasks.keys()

    def test_snapshot_omits_runtime_only_agent_fields(self):
        snap = _minimal_snapshot()
        agent = snap.agents["researcher"]
        dumped = agent.model_dump()
        assert "config" in dumped
        assert "session_id" not in dumped
        assert "active_tasks" not in dumped
        assert "started_at" not in dumped

    def test_extra_fields_forbidden(self):
        config = _minimal_config()
        with pytest.raises(ValidationError):
            OrchestratorSnapshot(config=config, agents={}, tasks={}, bogus="nope")


# ===========================================================================
# TestJsonStateBackend
# ===========================================================================


class TestJsonStateBackend:
    @pytest.mark.asyncio
    async def test_save_creates_file(self, tmp_path: Path):
        path = tmp_path / "state.json"
        backend = JsonStateBackend(path)
        snap = _minimal_snapshot()
        await backend.save(snap)
        assert path.exists()
        content = path.read_text()
        assert '"version"' in content

    @pytest.mark.asyncio
    async def test_load_missing_file_returns_none(self, tmp_path: Path):
        path = tmp_path / "nope.json"
        backend = JsonStateBackend(path)
        result = await backend.load()
        assert result is None

    @pytest.mark.asyncio
    async def test_clear_removes_saved_snapshot(self, tmp_path: Path):
        path = tmp_path / "state.json"
        backend = JsonStateBackend(path)
        await backend.save(_minimal_snapshot())
        assert path.exists()

        await backend.clear()

        assert not path.exists()

    @pytest.mark.asyncio
    async def test_save_load_roundtrip(self, tmp_path: Path):
        path = tmp_path / "state.json"
        backend = JsonStateBackend(path)
        snap = _minimal_snapshot()
        await backend.save(snap)
        restored = await backend.load()
        assert restored is not None
        assert restored.version == snap.version
        assert set(restored.agents.keys()) == set(snap.agents.keys())
        assert set(restored.tasks.keys()) == set(snap.tasks.keys())

    @pytest.mark.asyncio
    async def test_stale_snapshot_returns_none(self, tmp_path: Path):
        path = tmp_path / "state.json"
        backend = JsonStateBackend(path, retention_hours=1)
        snap = _minimal_snapshot()
        # Force old timestamp
        snap.timestamp = datetime.now(UTC) - timedelta(hours=2)
        # Write manually to bypass save() which would re-timestamp
        path.write_text(snap.model_dump_json(indent=2))
        result = await backend.load()
        assert result is None

    @pytest.mark.asyncio
    async def test_custom_retention_hours(self, tmp_path: Path):
        path = tmp_path / "state.json"
        backend = JsonStateBackend(path, retention_hours=500)
        snap = _minimal_snapshot()
        snap.timestamp = datetime.now(UTC) - timedelta(hours=400)
        path.write_text(snap.model_dump_json(indent=2))
        result = await backend.load()
        assert result is not None

    @pytest.mark.asyncio
    async def test_load_prunes_old_terminal_tasks(self, tmp_path: Path):
        path = tmp_path / "state.json"
        backend = JsonStateBackend(path, retention_hours=24)
        snap = _minimal_snapshot()

        old_completed = Task(
            description="old complete",
            status="completed",
            assigned_agent="researcher",
            created_at=datetime.now(UTC) - timedelta(days=3),
            completed_at=datetime.now(UTC) - timedelta(days=3),
        )
        recent_completed = Task(
            description="recent complete",
            status="completed",
            assigned_agent="researcher",
            completed_at=datetime.now(UTC) - timedelta(hours=2),
        )
        pending_task = Task(
            description="pending",
            status="pending",
            assigned_agent="researcher",
            created_at=datetime.now(UTC) - timedelta(days=10),
        )

        snap.tasks = {
            old_completed.id: old_completed,
            recent_completed.id: recent_completed,
            pending_task.id: pending_task,
        }

        await backend.save(snap)
        restored = await backend.load()

        assert restored is not None
        assert old_completed.id not in restored.tasks
        assert recent_completed.id in restored.tasks
        assert pending_task.id in restored.tasks

    @pytest.mark.asyncio
    async def test_save_creates_parent_directories(self, tmp_path: Path):
        path = tmp_path / "sub" / "dir" / "state.json"
        backend = JsonStateBackend(path)
        snap = _minimal_snapshot()
        await backend.save(snap)
        assert path.exists()

    @pytest.mark.asyncio
    async def test_atomic_write_cleans_up_temp_on_error(self, tmp_path: Path):
        path = tmp_path / "state.json"
        backend = JsonStateBackend(path)
        snap = _minimal_snapshot()

        # Patch os.replace to raise, simulating write failure
        with patch("botcore_agents.state.os.replace", side_effect=OSError("disk full")):
            with pytest.raises(OSError, match="disk full"):
                await backend.save(snap)

        # No temp files should remain
        remaining = list(tmp_path.glob("*.tmp"))
        assert remaining == []
        assert not path.exists()


# ===========================================================================
# TestOrchestratorSaveLoad
# ===========================================================================


class TestOrchestratorSaveLoad:
    @pytest.mark.asyncio
    async def test_save_no_backend_returns_error(self):
        orch = AgentOrchestrator(_minimal_config())
        result = await orch.save_state()
        assert_error(result, "NO_BACKEND")

    @pytest.mark.asyncio
    async def test_load_no_backend_returns_error(self):
        orch = AgentOrchestrator(_minimal_config())
        result = await orch.load_state()
        assert_error(result, "NO_BACKEND")

    @pytest.mark.asyncio
    async def test_full_roundtrip(self, tmp_path: Path):
        """Create agents, save, reset orchestrator, load, verify."""
        backend = JsonStateBackend(tmp_path / "state.json")
        config = _minimal_config()
        orch = AgentOrchestrator(config, backend=backend)

        # Create an agent manually (skip LLM)
        agent_cfg = config.agents["researcher"]
        health = AgentHealth(name="researcher", status="idle")
        orch._agents["researcher"] = AgentState(
            config=agent_cfg, health=health, session_id="live-session"
        )
        task = Task(description="do stuff", status="completed", assigned_agent="researcher")
        orch._tasks[task.id] = task

        # Save
        save_result = await orch.save_state()
        save_data = assert_success(save_result)
        assert save_data["saved"] is True
        assert save_data["agents"] == 1
        assert save_data["tasks"] == 1

        # Create a fresh orchestrator, load into it
        orch2 = AgentOrchestrator(_minimal_config(), backend=backend)
        load_result = await orch2.load_state()
        load_data = assert_success(load_result)
        assert load_data["restored"] is True
        assert load_data["agents"] == 1
        assert "task_resume" in load_data["note"]
        assert "researcher" in orch2._agents
        assert task.id in orch2._tasks

    @pytest.mark.asyncio
    async def test_loaded_agents_are_stopped(self, tmp_path: Path):
        backend = JsonStateBackend(tmp_path / "state.json")
        config = _minimal_config()
        orch = AgentOrchestrator(config, backend=backend)

        agent_cfg = config.agents["researcher"]
        health = AgentHealth(name="researcher", status="busy", current_task="t1")
        orch._agents["researcher"] = AgentState(
            config=agent_cfg,
            health=health,
            session_id="sess-x",
            active_tasks=["t1"],
            started_at=datetime.now(UTC),
        )

        await orch.save_state()

        orch2 = AgentOrchestrator(_minimal_config(), backend=backend)
        await orch2.load_state()

        state = orch2._agents["researcher"]
        assert state.health.status == "stopped"
        assert state.session_id == ""
        assert state.active_tasks == []
        assert state.health.current_task == ""
        assert state.started_at is None

    @pytest.mark.asyncio
    async def test_load_normalizes_non_terminal_tasks(self, tmp_path: Path):
        backend = JsonStateBackend(tmp_path / "state.json")
        config = _minimal_config()
        orch = AgentOrchestrator(config, backend=backend)

        running = Task(
            description="running task",
            status="running",
            assigned_agent="researcher",
            started_at=datetime.now(UTC),
            result="partial output",
        )
        assigned = Task(
            description="assigned task",
            status="assigned",
            assigned_agent="researcher",
            started_at=datetime.now(UTC),
        )
        completed = Task(
            description="completed task",
            status="completed",
            assigned_agent="researcher",
            completed_at=datetime.now(UTC),
            result="done",
        )
        orch._tasks = {
            running.id: running,
            assigned.id: assigned,
            completed.id: completed,
        }

        await orch.save_state()

        orch2 = AgentOrchestrator(_minimal_config(), backend=backend)
        await orch2.load_state()

        restored_running = orch2._tasks[running.id]
        assert restored_running.status == "pending"
        assert restored_running.assigned_agent == ""
        assert restored_running.started_at is None
        assert restored_running.completed_at is None
        assert restored_running.result == ""

        restored_assigned = orch2._tasks[assigned.id]
        assert restored_assigned.status == "pending"
        assert restored_assigned.assigned_agent == ""
        assert restored_assigned.started_at is None

        restored_completed = orch2._tasks[completed.id]
        assert restored_completed.status == "completed"
        assert restored_completed.assigned_agent == "researcher"
        assert restored_completed.result == "done"

    @pytest.mark.asyncio
    async def test_load_no_saved_state(self, tmp_path: Path):
        backend = JsonStateBackend(tmp_path / "nope.json")
        orch = AgentOrchestrator(_minimal_config(), backend=backend)
        result = await orch.load_state()
        data = assert_success(result)
        assert data["restored"] is False
        assert "No saved snapshot" in data["note"]

    @pytest.mark.asyncio
    async def test_loaded_pending_task_can_be_resumed(self, tmp_path: Path, mock_llm):
        backend = JsonStateBackend(tmp_path / "state.json")
        config = _minimal_config()
        orch = AgentOrchestrator(config, backend=backend)

        agent_cfg = config.agents["researcher"]
        orch._agents["researcher"] = AgentState(
            config=agent_cfg,
            health=AgentHealth(name="researcher", status="idle"),
            session_id="live-session",
        )
        pending = Task(description="resume after restore", status="pending")
        orch._tasks[pending.id] = pending

        await orch.save_state()

        orch2 = AgentOrchestrator(_minimal_config(), backend=backend)
        load_result = await orch2.load_state()
        assert_success(load_result)

        start_result = await orch2.start_agent("researcher")
        assert_success(start_result)

        resume_result = await orch2.resume_task(pending.id, agent="researcher")
        resume_data = assert_success(resume_result)
        assert resume_data["task_id"] == pending.id
        assert resume_data["status"] == "completed"
        assert orch2._tasks[pending.id].status == "completed"

    @pytest.mark.asyncio
    async def test_snapshot_deep_copies(self, tmp_path: Path):
        """Mutating live state after save should not affect snapshot."""
        backend = JsonStateBackend(tmp_path / "state.json")
        config = _minimal_config()
        orch = AgentOrchestrator(config, backend=backend)

        agent_cfg = config.agents["researcher"]
        health = AgentHealth(name="researcher", status="idle")
        orch._agents["researcher"] = AgentState(config=agent_cfg, health=health)

        await orch.save_state()

        # Mutate live state
        orch._agents["researcher"].health.tasks_completed = 999

        # Load into fresh orchestrator
        orch2 = AgentOrchestrator(_minimal_config(), backend=backend)
        await orch2.load_state()
        assert orch2._agents["researcher"].health.tasks_completed == 0

    @pytest.mark.asyncio
    async def test_backend_save_exception(self):
        mock_backend = AsyncMock()
        mock_backend.save.side_effect = OSError("boom")
        orch = AgentOrchestrator(_minimal_config(), backend=mock_backend)
        result = await orch.save_state()
        assert_error(result, "STATE_SAVE_ERROR")

    @pytest.mark.asyncio
    async def test_backend_load_exception(self):
        mock_backend = AsyncMock()
        mock_backend.load.side_effect = OSError("boom")
        orch = AgentOrchestrator(_minimal_config(), backend=mock_backend)
        result = await orch.load_state()
        assert_error(result, "STATE_LOAD_ERROR")
