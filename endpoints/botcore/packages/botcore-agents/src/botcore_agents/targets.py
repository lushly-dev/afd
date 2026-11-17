"""Execution-target resolution for the agent orchestrator.

``TargetResolutionMixin`` picks the agent a task runs on: a named agent, or an
instance for a role, spawning one from the role's config template when the pool
has room. ``AgentOrchestrator`` mixes it in.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from afd import CommandResult, error, success

from .models import AgentHealth, AgentState

if TYPE_CHECKING:
    from .config import AgentConfig, AgentsPluginConfig


class TargetResolutionMixin:
    """Resolve the agent that runs a task; mixed into ``AgentOrchestrator``."""

    _config: AgentsPluginConfig
    _agents: dict[str, AgentState]

    if TYPE_CHECKING:

        async def start_agent(self, name: str) -> CommandResult[dict]: ...

    async def _resolve_agent_for_role(self, role: str) -> CommandResult[dict]:
        """Find an idle agent for *role*, or spawn a new instance.

        Search order:
        1. Existing idle agent with matching role → use it
        2. Pool has capacity → create + start a new instance from the role template
        3. All at capacity → return error
        """
        # 1. Find an instance with capacity
        for name, state in self._agents.items():
            if (
                state.config.role == role
                and state.health.status in ("idle", "busy")
                and len(state.active_tasks) < state.config.max_concurrent_tasks
            ):
                return success(
                    data={"name": name},
                    reasoning=f"Reusing agent {name!r} for role {role!r}",
                )

        # 2. Find the config template for this role
        template_config = self._find_role_config(role)
        if template_config is None:
            return error(
                "ROLE_NOT_CONFIGURED",
                f"No agent configuration with role={role!r}",
                suggestion=f'Add role = "{role}" to an agent config in botcore.toml',
            )

        # 3. Check pool capacity
        if len(self._agents) >= self._config.max_agents:
            return error(
                "MAX_AGENTS_REACHED",
                f"Agent pool is full ({self._config.max_agents} max) "
                f"and no idle {role!r} agents available",
                suggestion="Stop idle agents or increase max_agents",
            )

        # 4. Create + start a new instance
        instance_name = self._next_instance_name(role)
        agent_config = template_config.model_copy(update={"name": instance_name})
        health = AgentHealth(name=instance_name, status="stopped")
        state = AgentState(config=agent_config, health=health)
        self._agents[instance_name] = state

        start_result = await self.start_agent(instance_name)
        if not start_result.success:
            # Clean up the created-but-failed-to-start agent
            del self._agents[instance_name]
            return error(
                "ROLE_SPAWN_FAILED",
                f"Spawned {instance_name!r} for role {role!r} but failed to start: "
                f"{start_result.error.message}",
                suggestion=start_result.error.suggestion,
            )

        return success(
            data={"name": instance_name, "spawned": True},
            reasoning=f"Spawned new agent {instance_name!r} for role {role!r}",
        )

    def _find_role_config(self, role: str) -> AgentConfig | None:
        """Return the first configured agent template matching *role*.

        Uses insertion-order (dict order) so the first matching entry
        in ``[plugins.agents.agents]`` wins.
        """
        for cfg in self._config.agents.values():
            if cfg.role == role:
                return cfg
        return None

    def _next_instance_name(self, role: str) -> str:
        """Generate the next sequential instance name for *role*."""
        idx = 1
        while f"{role}-{idx}" in self._agents:
            idx += 1
        return f"{role}-{idx}"

    async def _resolve_execution_target(
        self,
        *,
        agent: str,
        role: str,
    ) -> CommandResult[dict]:
        if not agent and not role:
            return error(
                "NO_TARGET",
                "Provide either 'agent' or 'role' to assign the task",
                suggestion="Pass agent='name' or role='pm'",
            )

        if role and not agent:
            resolved = await self._resolve_agent_for_role(role)
            if not resolved.success:
                return resolved
            agent = resolved.data["name"]

        if agent not in self._agents:
            return error("AGENT_NOT_FOUND", f"Agent {agent!r} does not exist")

        state = self._agents[agent]
        if state.health.status == "stopped":
            return error(
                "AGENT_NOT_STARTED",
                f"Agent {agent!r} is not started",
            )

        if len(state.active_tasks) >= state.config.max_concurrent_tasks:
            return error(
                "AGENT_AT_CAPACITY",
                f"Agent {agent!r} is at capacity "
                f"({state.config.max_concurrent_tasks} concurrent tasks)",
            )

        return success(
            data={"name": agent},
            reasoning=f"Agent {agent!r} selected for task execution",
        )
