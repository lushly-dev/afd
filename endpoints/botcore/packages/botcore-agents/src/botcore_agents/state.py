"""Orchestrator state serialization — snapshot model, backend protocol, JSON backend."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from .config import AgentConfig, AgentsPluginConfig
from .models import AgentState, Task

logger = logging.getLogger(__name__)


class AgentSnapshot(BaseModel):
    """Portable persisted form of an agent.

    This deliberately excludes live session/runtime-only fields such as
    ``session_id``, ``active_tasks``, and ``started_at``.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    config: AgentConfig
    status_at_save: Literal["stopped", "idle", "busy", "error"] = "stopped"
    tasks_completed: int = Field(default=0, ge=0)
    tasks_failed: int = Field(default=0, ge=0)
    last_heartbeat: datetime | None = None

    @classmethod
    def from_state(cls, state: AgentState) -> AgentSnapshot:
        return cls(
            name=state.health.name,
            config=state.config.model_copy(deep=True),
            status_at_save=state.health.status,
            tasks_completed=state.health.tasks_completed,
            tasks_failed=state.health.tasks_failed,
            last_heartbeat=state.health.last_heartbeat,
        )

    def to_state(self) -> AgentState:
        """Restore a portable snapshot into a safe stopped runtime state."""
        from .models import AgentHealth

        return AgentState(
            config=self.config.model_copy(deep=True),
            health=AgentHealth(
                name=self.name,
                status="stopped",
                current_task="",
                last_heartbeat=self.last_heartbeat,
                tasks_completed=self.tasks_completed,
                tasks_failed=self.tasks_failed,
                uptime_seconds=0.0,
            ),
            session_id="",
            started_at=None,
            active_tasks=[],
        )


class TaskSnapshot(BaseModel):
    """Portable persisted form of a task."""

    model_config = ConfigDict(extra="forbid")

    id: str
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

    @classmethod
    def from_task(cls, task: Task) -> TaskSnapshot:
        return cls(**task.model_dump(mode="python"))

    def to_task(self) -> Task:
        """Restore a task into a recoverable runtime form."""
        data = self.model_dump(mode="python")
        if self.status not in {"completed", "failed", "cancelled"}:
            data.update({
                "status": "pending",
                "assigned_agent": "",
                "result": "",
                "started_at": None,
                "completed_at": None,
            })
        return Task(**data)


class OrchestratorSnapshot(BaseModel):
    """Point-in-time snapshot of the full orchestrator state.

    Uses dedicated snapshot models so the persisted schema remains stable
    even when runtime ``AgentState`` / ``Task`` models evolve.
    """

    model_config = ConfigDict(extra="forbid")

    version: str = "1.0"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    config: AgentsPluginConfig
    agents: dict[str, AgentSnapshot]
    tasks: dict[str, TaskSnapshot]


@runtime_checkable
class OrchestratorStateBackend(Protocol):
    """Async interface for persisting orchestrator snapshots.

    Construction is backend-specific (file path, DB connection, etc.).
    """

    async def save(self, snapshot: OrchestratorSnapshot) -> None: ...

    async def load(self) -> OrchestratorSnapshot | None: ...

    async def clear(self) -> None: ...


class JsonStateBackend:
    """Persist snapshots as indented JSON files with atomic writes.

    Parameters
    ----------
    path:
        File path for the JSON snapshot.
    retention_hours:
        Snapshots older than this are treated as stale and ignored on load.
        Defaults to 168 (7 days).
    """

    def __init__(self, path: Path, retention_hours: int = 168) -> None:
        self._path = Path(path)
        self._retention_hours = retention_hours

    async def save(self, snapshot: OrchestratorSnapshot) -> None:
        """Write *snapshot* to disk via atomic temp-file + rename."""
        await asyncio.to_thread(self._save_sync, snapshot)

    async def load(self) -> OrchestratorSnapshot | None:
        """Read snapshot from disk, or ``None`` if missing/stale."""
        return await asyncio.to_thread(self._load_sync)

    async def clear(self) -> None:
        """Delete the persisted snapshot file, if present."""
        await asyncio.to_thread(self._clear_sync)

    # -- sync helpers (run inside to_thread) --------------------------------

    def _save_sync(self, snapshot: OrchestratorSnapshot) -> None:
        parent = self._path.parent
        parent.mkdir(parents=True, exist_ok=True)

        json_bytes = snapshot.model_dump_json(indent=2).encode()

        fd, tmp_path = tempfile.mkstemp(dir=parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(json_bytes)
            os.replace(tmp_path, self._path)
        except BaseException:
            # Clean up temp file on any error
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def _load_sync(self) -> OrchestratorSnapshot | None:
        if not self._path.exists():
            return None

        raw = self._path.read_text(encoding="utf-8")
        try:
            snapshot = OrchestratorSnapshot.model_validate_json(raw)
        except (ValueError, Exception) as exc:
            logger.warning("Snapshot parse failed: %s", exc)
            return None

        # Reject stale snapshots
        age_hours = (datetime.now(UTC) - snapshot.timestamp).total_seconds() / 3600
        if age_hours > self._retention_hours:
            logger.info(
                "Ignoring stale snapshot (%.1f h old, retention=%d h)",
                age_hours,
                self._retention_hours,
            )
            return None

        return self._prune_terminal_tasks(snapshot)

    def _clear_sync(self) -> None:
        self._path.unlink(missing_ok=True)

    def _prune_terminal_tasks(self, snapshot: OrchestratorSnapshot) -> OrchestratorSnapshot:
        """Drop old terminal tasks while preserving active work."""
        terminal_statuses = {"completed", "failed", "cancelled"}
        cutoff = datetime.now(UTC)
        kept_tasks: dict[str, TaskSnapshot] = {}
        pruned = 0

        for task_id, task in snapshot.tasks.items():
            if task.status not in terminal_statuses:
                kept_tasks[task_id] = task
                continue

            finished_at = task.completed_at or task.created_at
            age_hours = (cutoff - finished_at).total_seconds() / 3600
            if age_hours > self._retention_hours:
                pruned += 1
                continue

            kept_tasks[task_id] = task

        if pruned:
            logger.info(
                "Pruned %d terminal task(s) older than retention=%d h",
                pruned,
                self._retention_hours,
            )

        return snapshot.model_copy(update={"tasks": kept_tasks})
