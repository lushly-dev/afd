"""Tests for agent domain models."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from botcore_agents.config import AgentConfig
from botcore_agents.models import AgentHealth, AgentState, Task


class TestTask:
    def test_defaults(self):
        task = Task(description="Do something")
        assert task.description == "Do something"
        assert task.status == "pending"
        assert task.priority == 5
        assert task.assigned_agent == ""
        assert task.result == ""
        assert task.retry_count == 0
        assert task.max_retries == 3
        assert len(task.id) == 36  # UUID format

    def test_id_is_unique(self):
        t1 = Task(description="a")
        t2 = Task(description="b")
        assert t1.id != t2.id

    def test_priority_bounds(self):
        Task(description="ok", priority=1)
        Task(description="ok", priority=10)
        with pytest.raises(ValidationError):
            Task(description="bad", priority=0)
        with pytest.raises(ValidationError):
            Task(description="bad", priority=11)

    def test_status_literals(self):
        for status in ("pending", "assigned", "running", "completed", "failed", "cancelled"):
            task = Task(description="x", status=status)
            assert task.status == status

    def test_invalid_status(self):
        with pytest.raises(ValidationError):
            Task(description="x", status="unknown")

    def test_retry_count_non_negative(self):
        with pytest.raises(ValidationError):
            Task(description="x", retry_count=-1)

    def test_max_retries_bounds(self):
        with pytest.raises(ValidationError):
            Task(description="x", max_retries=-1)
        with pytest.raises(ValidationError):
            Task(description="x", max_retries=11)

    def test_extra_fields_forbidden(self):
        with pytest.raises(ValidationError):
            Task(description="x", bogus="y")

    def test_timestamps(self):
        now = datetime.now(UTC)
        task = Task(description="x", started_at=now, completed_at=now)
        assert task.started_at == now
        assert task.completed_at == now


class TestAgentHealth:
    def test_defaults(self):
        h = AgentHealth(name="worker")
        assert h.name == "worker"
        assert h.status == "stopped"
        assert h.current_task == ""
        assert h.last_heartbeat is None
        assert h.tasks_completed == 0
        assert h.tasks_failed == 0
        assert h.uptime_seconds == 0.0

    def test_status_literals(self):
        for status in ("stopped", "idle", "busy", "error"):
            h = AgentHealth(name="x", status=status)
            assert h.status == status

    def test_invalid_status(self):
        with pytest.raises(ValidationError):
            AgentHealth(name="x", status="running")

    def test_counters_non_negative(self):
        with pytest.raises(ValidationError):
            AgentHealth(name="x", tasks_completed=-1)
        with pytest.raises(ValidationError):
            AgentHealth(name="x", tasks_failed=-1)

    def test_extra_fields_forbidden(self):
        with pytest.raises(ValidationError):
            AgentHealth(name="x", extra_field=True)


class TestAgentState:
    def test_construction(self):
        cfg = AgentConfig(name="worker", model="test-model")
        health = AgentHealth(name="worker")
        state = AgentState(config=cfg, health=health)
        assert state.session_id == ""
        assert state.started_at is None
        assert state.active_tasks == []

    def test_extra_fields_forbidden(self):
        cfg = AgentConfig(name="worker")
        health = AgentHealth(name="worker")
        with pytest.raises(ValidationError):
            AgentState(config=cfg, health=health, unknown=True)
