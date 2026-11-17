"""Agent orchestrator — pool management, task assignment, session lifecycle.

Connector resolution lives in ``capabilities.py``; target resolution in ``targets.py``
and state persistence in ``state.py`` are mixed into ``AgentOrchestrator``.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from afd import CommandResult, error, success
from botcore_llm.commands import llm_session_create, llm_session_destroy

from .capabilities import ConnectorIntegrationUnavailable, resolve_connector_commands
from .config import AgentConfig, AgentsPluginConfig
from .models import AgentHealth, AgentState, Task
from .state import OrchestratorPersistenceMixin
from .targets import TargetResolutionMixin

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from afd.core.streaming import StreamChunk

    from .state import OrchestratorStateBackend

logger = logging.getLogger(__name__)

# Cached command namespace — avoids re-discovering plugins on every start.
_namespace: dict[str, Callable[..., Any]] | None = None


class AgentOrchestrator(TargetResolutionMixin, OrchestratorPersistenceMixin):
    """Manages agent lifecycle and task execution.

    Phase 1: synchronous task execution (no background loop).
    """

    def __init__(
        self,
        config: AgentsPluginConfig,
        *,
        backend: OrchestratorStateBackend | None = None,
    ) -> None:
        self._config = config
        self._agents: dict[str, AgentState] = {}
        self._tasks: dict[str, Task] = {}
        # Live output of running tasks, in memory only: a restored task restarts.
        self._progress: dict[str, dict[str, str]] = {}
        self._backend = backend

    @property
    def config(self) -> AgentsPluginConfig:
        return self._config

    @property
    def agents(self) -> dict[str, AgentState]:
        return dict(self._agents)

    @property
    def tasks(self) -> dict[str, Task]:
        return dict(self._tasks)

    def _resolve_tools(self, config: AgentConfig) -> list[str]:
        """Build the tools list from connector commands.

        Skills are contextual knowledge (not executable commands) and are
        NOT included here — they inform the agent via system prompt and
        skill files, not via LLM tool bridging.
        """
        tools: list[str] = []

        if config.connectors or config.connector_commands:
            global _namespace
            if _namespace is None:
                from botcore.server import build_namespace

                _namespace, _ = build_namespace()

            tools.extend(
                resolve_connector_commands(
                    config.connectors,
                    config.connector_commands,
                    _namespace,
                )
            )

        return tools

    async def create_agent(self, name: str) -> CommandResult[dict]:
        """Create an agent from config. Does not start it."""
        if name not in self._config.agents:
            return error(
                "AGENT_NOT_CONFIGURED",
                f"No agent configuration for {name!r}",
                suggestion="Add agent config under [plugins.agents.agents] in botcore.toml",
            )

        if name in self._agents:
            return error(
                "AGENT_ALREADY_EXISTS",
                f"Agent {name!r} already exists",
                suggestion="Use agent_start to start it, or agent_stop then recreate",
            )

        if len(self._agents) >= self._config.max_agents:
            return error(
                "MAX_AGENTS_REACHED",
                f"Agent pool is full ({self._config.max_agents} max)",
                suggestion="Stop or remove an existing agent first",
            )

        agent_config = self._config.agents[name]
        health = AgentHealth(name=name, status="stopped")
        state = AgentState(config=agent_config, health=health)
        self._agents[name] = state
        await self._autosave_if_configured(f"agent_create:{name}")

        return success(
            data={"name": name, "status": "stopped"},
            reasoning=f"Agent {name!r} created with status=stopped",
            undo_command="agent_delete",
            undo_args={"name": name},
        )

    async def delete_agent(self, name: str) -> CommandResult[dict]:
        """Delete a stopped agent from the pool."""
        if name not in self._agents:
            return error("AGENT_NOT_FOUND", f"Agent {name!r} does not exist")

        state = self._agents[name]
        if state.health.status != "stopped":
            return error(
                "AGENT_MUST_BE_STOPPED",
                f"Agent {name!r} must be stopped before deletion",
                suggestion="Use agent_stop before agent_delete",
            )

        del self._agents[name]
        await self._autosave_if_configured(f"agent_delete:{name}")

        return success(
            data={"name": name, "deleted": True},
            reasoning=f"Agent {name!r} deleted from the pool",
            undo_command="agent_create",
            undo_args={"name": name},
        )

    async def start_agent(self, name: str) -> CommandResult[dict]:
        """Start an agent by creating an LLM session."""
        if name not in self._agents:
            return error("AGENT_NOT_FOUND", f"Agent {name!r} does not exist")

        state = self._agents[name]
        if state.health.status != "stopped":
            return error(
                "AGENT_ALREADY_STARTED",
                f"Agent {name!r} is already {state.health.status}",
            )

        model = state.config.model.strip() or self._config.default_model.strip()
        if not model:
            return error(
                "CONFIG_ERROR",
                f"No model configured for agent {name!r}: set "
                "[tool.botcore.plugins.agents] default_model or the agent's model field",
                suggestion=(
                    "Add default_model under [tool.botcore.plugins.agents] in botcore.toml. "
                    "Use llm_model_list to see model IDs your account can use"
                ),
                retryable=False,
            )
        try:
            tools = self._resolve_tools(state.config)
        except ConnectorIntegrationUnavailable as exc:
            return error(
                "INTEGRATION_UNAVAILABLE",
                str(exc),
                suggestion="Install 'botcore-agents[connectors]' and configure its plugin, "
                "or select explicit connector commands from the configured namespace",
            )
        system_prompt = state.config.system_prompt or None

        result = await llm_session_create(
            model=model,
            tools=tools,
            system_prompt=system_prompt,
            permissions=state.config.permissions,
            agent_name=name,
        )

        if not result.success:
            return error(
                "SESSION_CREATE_ERROR",
                f"Failed to create LLM session for {name!r}: {result.error.message}",
            )

        now = datetime.now(UTC)
        state.session_id = result.data["session_id"]
        state.started_at = now
        state.health.status = "idle"
        state.health.last_heartbeat = now
        await self._autosave_if_configured(f"agent_start:{name}")

        return success(
            data={
                "name": name,
                "status": "idle",
                "session_id": state.session_id,
            },
            reasoning=f"Agent {name!r} started with session {state.session_id}",
        )

    async def stop_agent(self, name: str) -> CommandResult[dict]:
        """Stop an agent and destroy its LLM session."""
        if name not in self._agents:
            return error("AGENT_NOT_FOUND", f"Agent {name!r} does not exist")

        state = self._agents[name]
        if state.health.status == "stopped":
            return error(
                "AGENT_NOT_STARTED",
                f"Agent {name!r} is not started",
            )

        # Cancel active tasks
        cancelled_tasks = []
        for task_id in list(state.active_tasks):
            if task_id in self._tasks:
                task = self._tasks[task_id]
                task.status = "cancelled"
                task.completed_at = datetime.now(UTC)
                self._progress.pop(task_id, None)
                cancelled_tasks.append(task_id)
        state.active_tasks.clear()

        # Destroy session
        if state.session_id:
            await llm_session_destroy(state.session_id)
            state.session_id = ""

        state.health.status = "stopped"
        state.health.current_task = ""
        state.started_at = None
        await self._autosave_if_configured(f"agent_stop:{name}")

        return success(
            data={
                "name": name,
                "status": "stopped",
                "cancelled_tasks": cancelled_tasks,
            },
            reasoning=f"Agent {name!r} stopped, {len(cancelled_tasks)} task(s) cancelled",
        )

    async def assign_task(
        self,
        description: str,
        agent: str = "",
        role: str = "",
        priority: int = 5,
    ) -> CommandResult[dict]:
        """Assign and execute a task synchronously via an agent's LLM session.

        Supply *agent* to target a specific instance, or *role* to let the
        orchestrator pick an idle instance (or spawn a new one from the role's
        config template). Collects ``assign_task_stream``.
        """
        from .task_stream import collect_task

        return await collect_task(self.assign_task_stream(description, agent, role, priority))

    def assign_task_stream(
        self, description: str, agent: str = "", role: str = "", priority: int = 5
    ) -> AsyncIterator[StreamChunk]:
        """Assign a task and stream its progress; see ``task_stream``."""
        from .task_stream import stream_assign

        return stream_assign(self, description, agent=agent, role=role, priority=priority)

    async def resume_task(
        self,
        task_id: str,
        agent: str = "",
        role: str = "",
    ) -> CommandResult[dict]:
        """Resume a pending task by executing it with a running agent."""
        from .task_stream import collect_task

        return await collect_task(self.resume_task_stream(task_id, agent, role))

    def resume_task_stream(
        self, task_id: str, agent: str = "", role: str = ""
    ) -> AsyncIterator[StreamChunk]:
        """Resume a pending task and stream its progress; see ``task_stream``."""
        from .task_stream import stream_resume

        return stream_resume(self, task_id, agent=agent, role=role)

    def get_agent_status(self, name: str) -> CommandResult[dict]:
        """Return health snapshot for an agent."""
        if name not in self._agents:
            return error("AGENT_NOT_FOUND", f"Agent {name!r} does not exist")

        state = self._agents[name]
        now = datetime.now(UTC)
        uptime = 0.0
        if state.started_at:
            uptime = (now - state.started_at).total_seconds()

        health = state.health.model_copy(update={"uptime_seconds": uptime})
        return success(
            data=health.model_dump(mode="json"),
            reasoning=f"Agent {name!r} status: {health.status}",
        )

    def get_task(self, task_id: str) -> CommandResult[dict]:
        """Return task details."""
        if task_id not in self._tasks:
            return error("TASK_NOT_FOUND", f"No task with id {task_id!r}")

        task = self._tasks[task_id]
        data = task.model_dump(mode="json")
        if task.status == "running" and task.id in self._progress:
            data.update(self._progress[task.id])
        return success(
            data=data,
            reasoning=f"Task {task_id} status: {task.status}",
        )

    def heartbeat(self, name: str) -> CommandResult[dict]:
        """Update agent heartbeat and return health."""
        if name not in self._agents:
            return error("AGENT_NOT_FOUND", f"Agent {name!r} does not exist")

        state = self._agents[name]
        if state.health.status == "stopped":
            return error(
                "AGENT_NOT_STARTED",
                f"Agent {name!r} is not started",
            )

        now = datetime.now(UTC)
        state.health.last_heartbeat = now

        uptime = 0.0
        if state.started_at:
            uptime = (now - state.started_at).total_seconds()

        health = state.health.model_copy(update={"uptime_seconds": uptime})
        return success(
            data=health.model_dump(mode="json"),
            reasoning=f"Heartbeat for {name!r} at {now.isoformat()}",
        )

    async def _begin_task(self, task: Task, agent: str) -> AgentState:
        """Mark *task* running on *agent* and the agent busy; return the agent's state."""
        state = self._agents[agent]
        task.assigned_agent = agent
        task.status = "running"
        task.started_at = datetime.now(UTC)
        task.completed_at = None
        self._tasks.setdefault(task.id, task)
        if task.id not in state.active_tasks:
            state.active_tasks.append(task.id)
        self._progress[task.id] = {"partial_result": "", "progress_message": f"Started on {agent}"}
        state.health.status = "busy"
        state.health.current_task = task.id
        await self._autosave_if_configured(f"task_started:{task.id}")
        return state

    async def _finish_task(
        self, task: Task, state: AgentState, status: str, result: str
    ) -> CommandResult[dict]:
        """Record a task outcome and free the agent (*state* from ``_begin_task``)."""
        agent = state.health.name
        # After a state restore the id may belong to a new run of the task; leave its progress.
        if self._tasks.get(task.id) is task:
            self._progress.pop(task.id, None)
        # stop_agent may already have cancelled the task and stopped the agent.
        if task.status != "cancelled":
            task.status = status
            task.result = result
        task.completed_at = task.completed_at or datetime.now(UTC)
        if task.status == "completed":
            state.health.tasks_completed += 1
        elif task.status == "failed":
            state.health.tasks_failed += 1

        if task.id in state.active_tasks:
            state.active_tasks.remove(task.id)
        if state.health.status != "stopped":
            state.health.current_task = ""
            state.health.status = "idle" if not state.active_tasks else "busy"
        await self._autosave_if_configured(f"task_finished:{task.id}")

        if task.status == "failed":
            return error(
                "TASK_EXECUTION_ERROR",
                f"Task failed: {task.result}",
                suggestion="Check the agent with agent_status, then assign the task again",
            )
        if task.status == "cancelled":
            return error(
                "TASK_CANCELLED",
                f"Task {task.id} was cancelled before it completed",
                suggestion="Assign the task again with task_assign",
            )
        return success(
            data={
                "task_id": task.id,
                "status": task.status,
                "result": task.result,
                "agent": agent,
            },
            reasoning=f"Task {task.id} completed by agent {agent!r}",
        )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_orchestrator: AgentOrchestrator | None = None


def get_orchestrator(
    config: AgentsPluginConfig | None = None,
    *,
    backend: OrchestratorStateBackend | None = None,
) -> AgentOrchestrator:
    """Return the module-level orchestrator singleton.

    If *config* is provided and no orchestrator exists, one is created.
    If called without config and none exists, creates one with defaults.
    """
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = AgentOrchestrator(config or AgentsPluginConfig(), backend=backend)
    elif backend is not None and _orchestrator._backend is not backend:
        logger.warning(
            "get_orchestrator() called with backend= but singleton already exists; "
            "updating backend on existing instance"
        )
        _orchestrator._backend = backend
    return _orchestrator


def reset_orchestrator() -> None:
    """Reset the singleton (useful in tests)."""
    global _orchestrator
    _orchestrator = None
