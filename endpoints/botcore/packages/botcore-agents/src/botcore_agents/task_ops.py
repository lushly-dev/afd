"""Task listing, cancellation, and team status operations for the agent orchestrator.

``TaskOperationsMixin`` backs ``task_list``, ``task_cancel``, and ``team_status``;
``AgentOrchestrator`` mixes it in so ``orchestrator.py`` stays within the file-size
budget.
"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from afd import CommandResult, error, success

from .models import AgentState, Task

if TYPE_CHECKING:
    from .config import AgentsPluginConfig

VALID_TASK_STATUSES: frozenset[str] = frozenset(
    {"pending", "assigned", "running", "completed", "failed", "cancelled"}
)
TERMINAL_TASK_STATUSES: frozenset[str] = frozenset({"completed", "failed", "cancelled"})


class TaskOperationsMixin:
    """Task listing, cancellation, and team-wide status; mixed into ``AgentOrchestrator``."""

    _config: AgentsPluginConfig
    _agents: dict[str, AgentState]
    _tasks: dict[str, Task]
    _progress: dict[str, dict[str, str]]
    _cancel_events: dict[str, asyncio.Event]
    _active_runs: dict[str, asyncio.Task[None]]

    if TYPE_CHECKING:

        async def _autosave_if_configured(self, reason: str) -> None: ...

    def _release_task_from_agent(self, state: AgentState, task_id: str) -> None:
        """Remove *task_id* from *state*'s active list and update its idle/busy health."""
        if task_id in state.active_tasks:
            state.active_tasks.remove(task_id)
        if state.health.status != "stopped":
            if state.health.current_task == task_id or not state.active_tasks:
                state.health.current_task = state.active_tasks[0] if state.active_tasks else ""
            state.health.status = "idle" if not state.active_tasks else "busy"

    async def _abort_live_run(self, task_id: str) -> None:
        """Signal and abort any in-flight chat pump for *task_id* before releasing its slot."""
        cancel_event = self._cancel_events.get(task_id)
        if cancel_event is not None:
            cancel_event.set()
        pump = self._active_runs.get(task_id)
        if pump is not None and not pump.done():
            pump.cancel()
            with contextlib.suppress(BaseException):
                await pump

    def list_tasks(
        self,
        status: str | None = None,
        agent: str | None = None,
    ) -> CommandResult[dict]:
        """List tracked tasks, optionally filtered by status or assigned agent."""
        if status and status not in VALID_TASK_STATUSES:
            valid = ", ".join(sorted(VALID_TASK_STATUSES))
            return error(
                "INVALID_STATUS",
                f"Unknown task status {status!r}",
                suggestion=f"Use one of: {valid}",
                retryable=False,
            )

        items: list[dict] = []
        for task in self._tasks.values():
            if status and task.status != status:
                continue
            if agent and task.assigned_agent != agent:
                continue
            data = task.model_dump(mode="json")
            if task.status == "running" and task.id in self._progress:
                data.update(self._progress[task.id])
            items.append(data)

        return success(
            data={"tasks": items, "count": len(items)},
            reasoning=f"Found {len(items)} task(s)",
        )

    async def cancel_task(self, task_id: str) -> CommandResult[dict]:
        """Cancel a pending, assigned, or running task."""
        if task_id not in self._tasks:
            return error(
                "TASK_NOT_FOUND",
                f"No task with id {task_id!r}",
                suggestion="Use task_list to see tracked tasks",
                retryable=False,
            )

        task = self._tasks[task_id]
        if task.status in TERMINAL_TASK_STATUSES:
            return error(
                "TASK_NOT_CANCELLABLE",
                f"Task {task_id!r} is already {task.status} and cannot be cancelled",
                suggestion="Use task_list to see active or pending tasks",
                retryable=False,
            )

        task.status = "cancelled"
        task.completed_at = datetime.now(UTC)
        self._progress.pop(task_id, None)

        # Abort the in-flight chat turn before freeing the agent slot so no live SDK turn
        # continues after cancellation reports success (even if a stream consumer is paused).
        await self._abort_live_run(task_id)

        agent_name = task.assigned_agent
        if agent_name and agent_name in self._agents:
            self._release_task_from_agent(self._agents[agent_name], task_id)

        await self._autosave_if_configured(f"task_cancel:{task_id}")
        return success(
            data={
                "task_id": task_id,
                "status": "cancelled",
                "cancelled": True,
                "agent": agent_name,
            },
            reasoning=f"Task {task_id} cancelled",
        )

    def get_team_status(self) -> CommandResult[dict]:
        """Return a team-wide status overview across all agents and tasks."""
        now = datetime.now(UTC)
        agents: list[dict] = []
        for state in self._agents.values():
            uptime = (now - state.started_at).total_seconds() if state.started_at else 0.0
            health = state.health.model_copy(update={"uptime_seconds": uptime})
            agents.append(health.model_dump(mode="json"))

        active_tasks = sum(1 for t in self._tasks.values() if t.status == "running")
        pending_tasks = sum(1 for t in self._tasks.values() if t.status in {"pending", "assigned"})
        return success(
            data={
                "agents": agents,
                "agent_count": len(agents),
                "active_tasks": active_tasks,
                "pending_tasks": pending_tasks,
                "total_tasks": len(self._tasks),
            },
            reasoning=(
                f"Team status: {len(agents)} agent(s), "
                f"{active_tasks} running, {pending_tasks} pending"
            ),
        )
