"""Tests for the agent orchestrator."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from afd.testing import assert_error, assert_success

import botcore_agents.orchestrator as orch_mod
from botcore_agents.config import AgentPermissionsConfig, AgentsPluginConfig
from botcore_agents.models import Task
from botcore_agents.orchestrator import AgentOrchestrator, get_orchestrator, reset_orchestrator


class TestCreateAgent:
    async def test_create_configured_agent(self, orchestrator: AgentOrchestrator):
        result = await orchestrator.create_agent("researcher")
        data = assert_success(result)
        assert data["name"] == "researcher"
        assert data["status"] == "stopped"
        assert result.undo_command == "agent_delete"
        assert result.undo_args == {"name": "researcher"}

    async def test_create_unconfigured_agent(self, orchestrator: AgentOrchestrator):
        result = await orchestrator.create_agent("unknown")
        assert_error(result, "AGENT_NOT_CONFIGURED")

    async def test_create_duplicate_agent(self, orchestrator: AgentOrchestrator):
        await orchestrator.create_agent("researcher")
        result = await orchestrator.create_agent("researcher")
        assert_error(result, "AGENT_ALREADY_EXISTS")

    async def test_create_respects_max_agents(self, orchestrator: AgentOrchestrator):
        # Config has max_agents=5, but only 2 agent configs
        await orchestrator.create_agent("researcher")
        await orchestrator.create_agent("coder")
        # Both slots used, third would need to be configured anyway
        result = await orchestrator.create_agent("nonexistent")
        assert_error(result, "AGENT_NOT_CONFIGURED")


class TestDeleteAgent:
    async def test_delete_stopped_agent(self, orchestrator: AgentOrchestrator):
        await orchestrator.create_agent("researcher")
        result = await orchestrator.delete_agent("researcher")
        data = assert_success(result)
        assert data["deleted"] is True
        assert result.undo_command == "agent_create"
        assert result.undo_args == {"name": "researcher"}

    async def test_delete_started_agent_requires_stop(
        self, orchestrator: AgentOrchestrator, mock_llm
    ):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = await orchestrator.delete_agent("researcher")
        assert_error(result, "AGENT_MUST_BE_STOPPED")

    async def test_delete_nonexistent_agent(self, orchestrator: AgentOrchestrator):
        result = await orchestrator.delete_agent("ghost")
        assert_error(result, "AGENT_NOT_FOUND")


class TestStartAgent:
    async def test_start_agent_happy_path(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        result = await orchestrator.start_agent("researcher")
        data = assert_success(result)
        assert data["status"] == "idle"
        assert data["session_id"] == "session-agent-001"

    async def test_start_nonexistent_agent(self, orchestrator: AgentOrchestrator, mock_llm):
        result = await orchestrator.start_agent("ghost")
        assert_error(result, "AGENT_NOT_FOUND")

    async def test_double_start(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = await orchestrator.start_agent("researcher")
        assert_error(result, "AGENT_ALREADY_STARTED")

    async def test_start_uses_config_model(self, orchestrator: AgentOrchestrator, mock_llm):
        from botcore_agents.config import AgentPermissionsConfig

        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        mock_llm["session_create"].assert_awaited_once_with(
            model="test-model",
            tools=[],
            system_prompt="You are a research agent.",
            permissions=AgentPermissionsConfig(),
            agent_name="researcher",
        )

    async def test_start_passes_custom_permissions(
        self, sample_config: AgentsPluginConfig, mock_llm
    ):
        from botcore_agents.config import AgentPermissionsConfig

        custom_perms = AgentPermissionsConfig(
            allow_shell=True,
            shell_allowlist=["git *"],
        )
        sample_config.agents["researcher"].permissions = custom_perms
        orch = AgentOrchestrator(sample_config)
        await orch.create_agent("researcher")
        await orch.start_agent("researcher")
        call_kwargs = mock_llm["session_create"].call_args.kwargs
        assert call_kwargs["permissions"] is custom_perms
        assert call_kwargs["agent_name"] == "researcher"

    async def test_start_falls_back_to_default_model(
        self, sample_config: AgentsPluginConfig, mock_llm
    ):
        sample_config.agents["researcher"].model = ""
        sample_config.default_model = "test-model-mini"
        orch = AgentOrchestrator(sample_config)
        await orch.create_agent("researcher")
        assert_success(await orch.start_agent("researcher"))
        assert mock_llm["session_create"].call_args.kwargs["model"] == "test-model-mini"

    async def test_start_errors_when_no_model_configured(
        self, sample_config: AgentsPluginConfig, mock_llm
    ):
        sample_config.agents["researcher"].model = ""
        sample_config.default_model = ""
        orch = AgentOrchestrator(sample_config)
        await orch.create_agent("researcher")

        err = assert_error(await orch.start_agent("researcher"), "CONFIG_ERROR")

        assert "[tool.botcore.plugins.agents] default_model" in err.message
        assert "llm_model_list" in err.suggestion
        mock_llm["session_create"].assert_not_awaited()
        assert orch._agents["researcher"].health.status == "stopped"

    async def test_start_treats_blank_default_model_as_unset(
        self, sample_config: AgentsPluginConfig, mock_llm
    ):
        sample_config.agents["researcher"].model = ""
        sample_config.default_model = "  "
        orch = AgentOrchestrator(sample_config)
        await orch.create_agent("researcher")

        assert_error(await orch.start_agent("researcher"), "CONFIG_ERROR")

    async def test_blank_agent_model_falls_back_to_default(
        self, sample_config: AgentsPluginConfig, mock_llm
    ):
        sample_config.agents["researcher"].model = "  "
        sample_config.default_model = "test-model-mini"
        orch = AgentOrchestrator(sample_config)
        await orch.create_agent("researcher")
        assert_success(await orch.start_agent("researcher"))
        assert mock_llm["session_create"].call_args.kwargs["model"] == "test-model-mini"


class TestStopAgent:
    async def test_stop_agent_happy_path(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = await orchestrator.stop_agent("researcher")
        data = assert_success(result)
        assert data["status"] == "stopped"
        mock_llm["session_destroy"].assert_awaited_once()

    async def test_stop_nonexistent(self, orchestrator: AgentOrchestrator, mock_llm):
        result = await orchestrator.stop_agent("ghost")
        assert_error(result, "AGENT_NOT_FOUND")

    async def test_stop_already_stopped(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        result = await orchestrator.stop_agent("researcher")
        assert_error(result, "AGENT_NOT_STARTED")


class TestAssignTask:
    async def test_assign_task_happy_path(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = await orchestrator.assign_task("Find bugs", agent="researcher")
        data = assert_success(result)
        assert data["status"] == "completed"
        assert data["result"] == "Task completed successfully"
        assert data["agent"] == "researcher"

    async def test_assign_to_stopped_agent(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        result = await orchestrator.assign_task("Do work", agent="researcher")
        assert_error(result, "AGENT_NOT_STARTED")

    async def test_assign_to_nonexistent_agent(self, orchestrator: AgentOrchestrator, mock_llm):
        result = await orchestrator.assign_task("Do work", agent="ghost")
        assert_error(result, "AGENT_NOT_FOUND")

    async def test_assign_at_capacity(self, orchestrator: AgentOrchestrator, mock_llm):
        """Coder has max_concurrent_tasks=1; simulate already busy."""
        await orchestrator.create_agent("coder")
        await orchestrator.start_agent("coder")

        # Manually add a task to simulate busy state
        state = orchestrator._agents["coder"]
        state.active_tasks.append("fake-task-id")

        result = await orchestrator.assign_task("More work", agent="coder")
        assert_error(result, "AGENT_AT_CAPACITY")

    async def test_assign_respects_priority(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = await orchestrator.assign_task("Urgent", agent="researcher", priority=1)
        task_id = assert_success(result)["task_id"]
        task_result = orchestrator.get_task(task_id)
        assert task_result.data["priority"] == 1

    async def test_agent_returns_idle_after_task(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        await orchestrator.assign_task("Do something", agent="researcher")
        status = orchestrator.get_agent_status("researcher")
        assert status.data["status"] == "idle"

    async def test_failed_chat_marks_task_failed(self, orchestrator: AgentOrchestrator, mock_llm):
        from afd import error

        mock_llm["chat"].return_value = error("CHAT_ERROR", "LLM failed")

        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = await orchestrator.assign_task("Bad task", agent="researcher")
        assert_error(result, "TASK_EXECUTION_ERROR")

    async def test_assign_no_target_returns_error(self, orchestrator: AgentOrchestrator):
        result = await orchestrator.assign_task("Do work")
        assert_error(result, "NO_TARGET")


class TestResumeTask:
    async def test_resume_pending_task(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")

        task = Task(description="Resume work", status="pending")
        orchestrator._tasks[task.id] = task

        result = await orchestrator.resume_task(task.id, agent="researcher")
        data = assert_success(result)
        assert data["task_id"] == task.id
        assert data["status"] == "completed"
        assert data["agent"] == "researcher"

        restored_task = orchestrator._tasks[task.id]
        assert restored_task.status == "completed"
        assert restored_task.assigned_agent == "researcher"

    async def test_resume_missing_task(self, orchestrator: AgentOrchestrator, mock_llm):
        result = await orchestrator.resume_task("missing-task", agent="researcher")
        assert_error(result, "TASK_NOT_FOUND")

    async def test_resume_completed_task_rejected(self, orchestrator: AgentOrchestrator, mock_llm):
        task = Task(description="Already done", status="completed")
        orchestrator._tasks[task.id] = task

        result = await orchestrator.resume_task(task.id, agent="researcher")
        assert_error(result, "TASK_NOT_RESUMABLE")


class TestGetAgentStatus:
    async def test_status_stopped(self, orchestrator: AgentOrchestrator):
        await orchestrator.create_agent("researcher")
        result = orchestrator.get_agent_status("researcher")
        data = assert_success(result)
        assert data["status"] == "stopped"

    async def test_status_idle(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = orchestrator.get_agent_status("researcher")
        data = assert_success(result)
        assert data["status"] == "idle"
        assert data["uptime_seconds"] >= 0

    async def test_status_nonexistent(self, orchestrator: AgentOrchestrator):
        result = orchestrator.get_agent_status("ghost")
        assert_error(result, "AGENT_NOT_FOUND")


class TestGetTask:
    async def test_get_task(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        assign_result = await orchestrator.assign_task("Work", agent="researcher")
        task_id = assign_result.data["task_id"]

        result = orchestrator.get_task(task_id)
        data = assert_success(result)
        assert data["description"] == "Work"
        assert data["status"] == "completed"

    def test_get_nonexistent_task(self, orchestrator: AgentOrchestrator):
        result = orchestrator.get_task("no-such-id")
        assert_error(result, "TASK_NOT_FOUND")


class TestHeartbeat:
    async def test_heartbeat_updates_timestamp(self, orchestrator: AgentOrchestrator, mock_llm):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = orchestrator.heartbeat("researcher")
        data = assert_success(result)
        assert data["last_heartbeat"] is not None

    async def test_heartbeat_stopped_agent(self, orchestrator: AgentOrchestrator):
        await orchestrator.create_agent("researcher")
        result = orchestrator.heartbeat("researcher")
        assert_error(result, "AGENT_NOT_STARTED")

    def test_heartbeat_nonexistent(self, orchestrator: AgentOrchestrator):
        result = orchestrator.heartbeat("ghost")
        assert_error(result, "AGENT_NOT_FOUND")


class TestAutosave:
    async def test_create_agent_autosaves_when_enabled(self, sample_config: AgentsPluginConfig):
        sample_config.state.enabled = True
        sample_config.state.autosave = True
        backend = AsyncMock()
        orchestrator = AgentOrchestrator(sample_config, backend=backend)

        result = await orchestrator.create_agent("researcher")

        assert_success(result)
        backend.save.assert_awaited_once()

    async def test_create_agent_does_not_autosave_when_disabled(
        self, sample_config: AgentsPluginConfig
    ):
        sample_config.state.enabled = True
        sample_config.state.autosave = False
        backend = AsyncMock()
        orchestrator = AgentOrchestrator(sample_config, backend=backend)

        result = await orchestrator.create_agent("researcher")

        assert_success(result)
        backend.save.assert_not_awaited()

    async def test_autosave_failures_do_not_break_commands(self, sample_config: AgentsPluginConfig):
        sample_config.state.enabled = True
        sample_config.state.autosave = True
        backend = AsyncMock()
        backend.save.side_effect = OSError("disk full")
        orchestrator = AgentOrchestrator(sample_config, backend=backend)

        result = await orchestrator.create_agent("researcher")

        assert_success(result)
        backend.save.assert_awaited_once()

    async def test_assign_task_autosaves_before_and_after_execution(
        self, sample_config: AgentsPluginConfig, mock_llm
    ):
        sample_config.state.enabled = True
        sample_config.state.autosave = True
        backend = AsyncMock()
        orchestrator = AgentOrchestrator(sample_config, backend=backend)

        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        backend.save.reset_mock()

        result = await orchestrator.assign_task("Do work", agent="researcher")

        assert_success(result)
        assert backend.save.await_count == 2

    async def test_heartbeat_does_not_trigger_autosave(
        self, sample_config: AgentsPluginConfig, mock_llm
    ):
        sample_config.state.enabled = True
        sample_config.state.autosave = True
        backend = AsyncMock()
        orchestrator = AgentOrchestrator(sample_config, backend=backend)

        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        backend.save.reset_mock()

        result = orchestrator.heartbeat("researcher")

        assert_success(result)
        backend.save.assert_not_awaited()


class TestSingleton:
    def test_get_orchestrator_creates_default(self):
        orch = get_orchestrator()
        assert isinstance(orch, AgentOrchestrator)

    def test_get_orchestrator_returns_same(self):
        orch1 = get_orchestrator()
        orch2 = get_orchestrator()
        assert orch1 is orch2

    def test_reset_orchestrator(self):
        orch1 = get_orchestrator()
        reset_orchestrator()
        orch2 = get_orchestrator()
        assert orch1 is not orch2


class TestRoleBasedPooling:
    """Role-based agent spawning: assign by role, auto-scale instances."""

    async def test_assign_by_role_reuses_idle_agent(
        self, orchestrator: AgentOrchestrator, mock_llm
    ):
        """If an idle agent with the role exists, reuse it."""
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = await orchestrator.assign_task("Find bugs", role="researcher")
        data = assert_success(result)
        assert data["agent"] == "researcher"

    async def test_assign_by_role_spawns_when_busy(self, orchestrator: AgentOrchestrator, mock_llm):
        """If the existing role agent is busy, spawn a new instance."""
        from afd import success

        call_count = 0

        async def varying_session_create(**kwargs):
            nonlocal call_count
            call_count += 1
            return success(
                data={
                    "session_id": f"session-{call_count:03d}",
                    "model": kwargs.get("model", "test-model"),
                    "tools": [],
                },
                reasoning="Mock session",
            )

        mock_llm["session_create"].side_effect = varying_session_create

        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")

        # Make the first instance busy
        state = orchestrator._agents["researcher"]
        state.active_tasks.append("fake-task-id")
        state.active_tasks.append("fake-task-id-2")  # researcher has max_concurrent_tasks=2
        state.health.status = "busy"

        result = await orchestrator.assign_task("Second task", role="researcher")
        data = assert_success(result)
        # Should have spawned researcher-1
        assert data["agent"] == "researcher-1"
        assert "researcher-1" in orchestrator.agents

    async def test_spawn_without_model_keeps_config_suggestion(
        self, orchestrator: AgentOrchestrator, mock_llm
    ):
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        state = orchestrator._agents["researcher"]
        state.active_tasks.extend(["t1", "t2"])
        state.health.status = "busy"

        # The spawn template has no model and there is no default to fall back to.
        orchestrator._config.agents["researcher"] = state.config.model_copy(update={"model": ""})
        orchestrator._config.default_model = ""

        result = await orchestrator.assign_task("Second task", role="researcher")

        err = assert_error(result, "ROLE_SPAWN_FAILED")
        assert "[tool.botcore.plugins.agents] default_model" in err.message
        assert "llm_model_list" in err.suggestion
        assert "researcher-1" not in orchestrator.agents

    async def test_assign_by_role_spawns_sequential_names(
        self, orchestrator: AgentOrchestrator, mock_llm
    ):
        """Spawned instances get sequential names: role-1, role-2, etc."""
        from afd import success

        call_count = 0

        async def varying_session_create(**kwargs):
            nonlocal call_count
            call_count += 1
            return success(
                data={
                    "session_id": f"session-{call_count:03d}",
                    "model": kwargs.get("model", "test-model"),
                    "tools": [],
                },
                reasoning="Mock session",
            )

        mock_llm["session_create"].side_effect = varying_session_create

        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")

        # Fill researcher to capacity
        state = orchestrator._agents["researcher"]
        state.active_tasks.extend(["t1", "t2"])
        state.health.status = "busy"

        # Spawn researcher-1
        r1 = await orchestrator.assign_task("Task A", role="researcher")
        assert r1.success
        assert r1.data["agent"] == "researcher-1"

        # Fill researcher-1 to capacity
        state1 = orchestrator._agents["researcher-1"]
        state1.active_tasks.extend(["t3", "t4"])
        state1.health.status = "busy"

        # Spawn researcher-2
        r2 = await orchestrator.assign_task("Task B", role="researcher")
        r2_data = assert_success(r2)
        assert r2_data["agent"] == "researcher-2"

    async def test_assign_by_role_unconfigured(self, orchestrator: AgentOrchestrator, mock_llm):
        """Role with no matching config returns error."""
        result = await orchestrator.assign_task("Work", role="unknown")
        assert_error(result, "ROLE_NOT_CONFIGURED")

    async def test_assign_by_role_pool_full(self, orchestrator: AgentOrchestrator, mock_llm):
        """When pool hits max_agents and all role agents are busy, return error."""
        from afd import success

        call_count = 0

        async def varying_session_create(**kwargs):
            nonlocal call_count
            call_count += 1
            return success(
                data={
                    "session_id": f"session-{call_count:03d}",
                    "model": kwargs.get("model", "test-model"),
                    "tools": [],
                },
                reasoning="Mock session",
            )

        mock_llm["session_create"].side_effect = varying_session_create

        # Config has max_agents=5. Fill up the pool.
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        await orchestrator.create_agent("coder")
        await orchestrator.start_agent("coder")

        # Make researcher busy
        orchestrator._agents["researcher"].active_tasks.extend(["t1", "t2"])
        orchestrator._agents["researcher"].health.status = "busy"

        # Spawn 3 more to hit max_agents=5
        for _ in range(3):
            result = await orchestrator.assign_task("Work", role="researcher")
            spawned_name = assert_success(result)["agent"]
            orchestrator._agents[spawned_name].active_tasks.extend(["tx", "ty"])
            orchestrator._agents[spawned_name].health.status = "busy"

        # Pool is now full (5 agents), all researchers busy → should fail
        result = await orchestrator.assign_task("One more", role="researcher")
        assert_error(result, "MAX_AGENTS_REACHED")

    async def test_spawned_agent_inherits_config(self, orchestrator: AgentOrchestrator, mock_llm):
        """Spawned instances get the same model, skills, and prompt as the template."""
        from afd import success

        call_count = 0
        captured_kwargs = []

        async def capturing_session_create(**kwargs):
            nonlocal call_count
            call_count += 1
            captured_kwargs.append(kwargs)
            return success(
                data={
                    "session_id": f"session-{call_count:03d}",
                    "model": kwargs.get("model", "test-model"),
                    "tools": [],
                },
                reasoning="Mock session",
            )

        mock_llm["session_create"].side_effect = capturing_session_create

        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")

        # Make busy
        orchestrator._agents["researcher"].active_tasks.extend(["t1", "t2"])
        orchestrator._agents["researcher"].health.status = "busy"

        await orchestrator.assign_task("Another task", role="researcher")

        # The spawned instance should have same config
        spawned = orchestrator._agents["researcher-1"]
        assert spawned.config.model == "test-model"
        assert spawned.config.skills == ["dev_test", "dev_lint"]
        assert spawned.config.system_prompt == "You are a research agent."
        assert spawned.config.role == "researcher"

    async def test_agent_preferred_over_role(self, orchestrator: AgentOrchestrator, mock_llm):
        """When both agent and role are provided, agent takes precedence."""
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        result = await orchestrator.assign_task("Work", agent="researcher", role="coder")
        data = assert_success(result)
        assert data["agent"] == "researcher"


# Fake namespace for capability declaration tests
_FAKE_NS = {
    "github_issue_list": lambda: None,
    "github_issue_create": lambda: None,
    "github_pr_list": lambda: None,
    "email_send": lambda: None,
    "dev_test": lambda: None,
    "dev_lint": lambda: None,
    "dev_build": lambda: None,
}


class TestCapabilityDeclarations:
    """Verify that start_agent() restricts tools based on connector config."""

    async def test_skills_only_no_connectors(self, orchestrator: AgentOrchestrator, mock_llm):
        """Default researcher (connectors=[]) → no tools bridged (skills are knowledge, not tools)."""
        await orchestrator.create_agent("researcher")
        await orchestrator.start_agent("researcher")
        mock_llm["session_create"].assert_awaited_once_with(
            model="test-model",
            tools=[],
            system_prompt="You are a research agent.",
            permissions=AgentPermissionsConfig(),
            agent_name="researcher",
        )

    async def test_connectors_prefix_filtering(
        self, connector_orchestrator: AgentOrchestrator, mock_llm
    ):
        """connectors=["github"] → github_* commands from namespace (skills not bridged)."""
        orch_mod._namespace = _FAKE_NS

        await connector_orchestrator.create_agent("researcher")
        await connector_orchestrator.start_agent("researcher")

        call_kwargs = mock_llm["session_create"].call_args.kwargs
        tools = call_kwargs["tools"]
        # Only connector commands, not skills
        assert "github_issue_list" in tools
        assert "github_issue_create" in tools
        assert "github_pr_list" in tools
        # skills are NOT bridged as tools
        assert "dev_test" not in tools
        assert "dev_lint" not in tools
        # email commands should NOT be included
        assert "email_send" not in tools

    async def test_connector_commands_override(
        self, connector_orchestrator: AgentOrchestrator, mock_llm
    ):
        """connector_commands=["github_issue_list"] → only that command."""
        orch_mod._namespace = _FAKE_NS

        await connector_orchestrator.create_agent("scoped")
        await connector_orchestrator.start_agent("scoped")

        call_kwargs = mock_llm["session_create"].call_args.kwargs
        tools = call_kwargs["tools"]
        assert "github_issue_list" in tools
        assert len(tools) == 1  # only the one connector command

    async def test_empty_connectors_deny_by_default(
        self, connector_orchestrator: AgentOrchestrator, mock_llm
    ):
        """Default config (connectors=[], connector_commands=[]) → no tools."""
        await connector_orchestrator.create_agent("locked")
        await connector_orchestrator.start_agent("locked")

        call_kwargs = mock_llm["session_create"].call_args.kwargs
        tools = call_kwargs["tools"]
        assert tools == []

    async def test_wildcard_connectors(self, connector_orchestrator: AgentOrchestrator, mock_llm):
        """connectors=["*"] → all connector commands from KNOWN_CONNECTORS."""
        orch_mod._namespace = _FAKE_NS
        known = frozenset({"github", "email"})

        with patch.dict(
            "sys.modules",
            {
                "botcore_connectors": __import__("types").ModuleType("botcore_connectors"),
                "botcore_connectors.config": __import__("types").ModuleType(
                    "botcore_connectors.config"
                ),
            },
        ):
            import sys

            sys.modules["botcore_connectors.config"].KNOWN_CONNECTORS = known

            await connector_orchestrator.create_agent("admin")
            await connector_orchestrator.start_agent("admin")

        call_kwargs = mock_llm["session_create"].call_args.kwargs
        tools = call_kwargs["tools"]
        # Wildcard resolves all connector prefixes, but NOT skills
        assert "github_issue_list" in tools
        assert "github_issue_create" in tools
        assert "github_pr_list" in tools
        assert "email_send" in tools
        # skills are knowledge, not bridged tools
        assert "dev_build" not in tools

    async def test_pooled_instance_inherits_connectors(
        self, connector_orchestrator: AgentOrchestrator, mock_llm
    ):
        """Spawned role instance gets same connectors as template."""
        from afd import success

        orch_mod._namespace = _FAKE_NS

        call_count = 0

        async def varying_session_create(**kwargs):
            nonlocal call_count
            call_count += 1
            return success(
                data={
                    "session_id": f"session-{call_count:03d}",
                    "model": kwargs.get("model", "test-model"),
                    "tools": [],
                },
                reasoning="Mock session",
            )

        mock_llm["session_create"].side_effect = varying_session_create

        await connector_orchestrator.create_agent("researcher")
        await connector_orchestrator.start_agent("researcher")

        # Fill researcher to capacity
        state = connector_orchestrator._agents["researcher"]
        state.active_tasks.extend(["t1", "t2"])
        state.health.status = "busy"

        # Spawn researcher-1 via role
        await connector_orchestrator.assign_task("Work", role="researcher")

        spawned = connector_orchestrator._agents["researcher-1"]
        assert spawned.config.connectors == ["github"]
        assert spawned.config.connector_commands == []
