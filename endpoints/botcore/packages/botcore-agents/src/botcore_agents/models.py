"""Agent orchestration domain models."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .config import AgentConfig


class Task(BaseModel):
    """A unit of work assigned to an agent."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    description: str
    assigned_agent: str = ""
    status: Literal[
        "pending", "assigned", "running", "completed", "failed", "cancelled"
    ] = "pending"
    priority: int = Field(default=5, ge=1, le=10)
    result: str = ""
    parent_task: str = ""
    subtasks: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    retry_count: int = Field(default=0, ge=0)
    max_retries: int = Field(default=3, ge=0, le=10)


class AgentHealth(BaseModel):
    """Health snapshot of a running agent."""

    model_config = ConfigDict(extra="forbid")

    name: str
    status: Literal["stopped", "idle", "busy", "error"] = "stopped"
    current_task: str = ""
    last_heartbeat: datetime | None = None
    tasks_completed: int = Field(default=0, ge=0)
    tasks_failed: int = Field(default=0, ge=0)
    uptime_seconds: float = Field(default=0.0, ge=0.0)


class AgentState(BaseModel):
    """Full runtime state for a managed agent."""

    model_config = ConfigDict(extra="forbid")

    config: AgentConfig
    health: AgentHealth
    session_id: str = ""
    started_at: datetime | None = None
    active_tasks: list[str] = Field(default_factory=list)
