# Plan: Agent Orchestration

> **Status:** Complete
> **Date:** 2026-02-25
> **Updated:** 2026-02-26 — Phase 1 (single agent + capability declarations) shipped in `packages/botcore-agents/`
> **Scope:** Multi-agent lifecycle, task routing, heartbeat, and coordination as separate botcore plugin package (`botcore-agents`)
> **Depends on:** [LLM Runtime](../llm-runtime/00-overview.plan.md) (`botcore-llm` plugin), botcore core, `afd` Python package (reconnection, batch execution, telemetry, middleware)

---

## Summary

Add multi-agent orchestration to botcore: define agents with individual models, skills, connectors, and memory scopes. An orchestrator manages agent lifecycle (create, start, stop, health), routes tasks to agents based on capability matching, runs a heartbeat loop for health monitoring, and coordinates task execution.

Each agent is backed by a Copilot SDK session (from the LLM Runtime feature) with scoped tools — agents can only call commands they're configured to access.

---

## Architecture

```
Task assignment (Teams, CLI, MCP)
    ↓
┌─────────────────────────────────────────────┐
│  ORCHESTRATOR                               │
│  task-assign → router → agent selection     │
│  heartbeat loop → health monitoring         │
│  task queue → priority + retry              │
├─────────────────────────────────────────────┤
│  AGENT POOL                                 │
│  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Agent A      │  │ Agent B             │  │
│  │ model: gpt4o │  │ model: claude       │  │
│  │ skills: [..] │  │ skills: [..]        │  │
│  │ connectors:  │  │ connectors:         │  │
│  │   [github]   │  │   [github, email]   │  │
│  │ memory: own  │  │ memory: own         │  │
│  │ session: SDK │  │ session: SDK        │  │
│  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## Agent Configuration

```toml
# botcore.toml

[agents.researcher]
model = "gpt-4.1"
skills = ["research", "problem-solver"]
connectors = ["github"]
memory_scope = "private"
max_concurrent_tasks = 1
heartbeat_interval = 30           # seconds
system_prompt = "You are a research specialist."

[agents.developer]
model = "claude-sonnet-4"
skills = ["test-writer", "refactoring-learn", "commit"]
connectors = ["github", "azure-devops"]
memory_scope = "team"              # Can read shared memory
max_concurrent_tasks = 2
system_prompt = "You are a senior developer."

[agents.coordinator]
model = "gpt-4.1"
skills = ["manage-projects", "spec-writer"]
connectors = ["github", "email", "calendar"]
memory_scope = "team"
max_concurrent_tasks = 3
is_lead = true                     # Can decompose and delegate tasks
```

---

## Core Data Models

```python
@dataclass
class AgentConfig:
    name: str                              # "researcher"
    model: str                             # "gpt-4.1"
    skills: list[str]                      # Botcore skill names
    connectors: list[str]                  # Connector command prefixes
    connector_commands: list[str]          # Explicit command override (takes precedence)
    memory_scope: Literal["private", "team", "project"]
    max_concurrent_tasks: int = 1
    heartbeat_interval: int = 30           # seconds
    system_prompt: str = ""
    is_lead: bool = False                  # Can decompose + delegate

@dataclass
class Task:
    id: str                                # UUID
    description: str
    assigned_agent: str | None = None
    status: Literal["pending", "assigned", "running", "completed", "failed", "cancelled"]
    priority: int = 5                      # 1 (highest) - 10 (lowest)
    result: dict | None = None             # CommandResult data on completion
    parent_task: str | None = None         # For subtask decomposition
    subtasks: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    assigned_at: datetime | None = None
    completed_at: datetime | None = None
    retry_count: int = 0
    max_retries: int = 2

@dataclass
class AgentHealth:
    name: str
    status: Literal["idle", "busy", "unhealthy", "stopped"]
    current_task: str | None = None
    last_heartbeat: datetime
    tasks_completed: int = 0
    tasks_failed: int = 0
    uptime_seconds: float = 0
```

---

## Commands

```python
# Agent lifecycle
async def agent_create(name: str) -> CommandResult[dict]:
    """Create agent from config, initialize Copilot session with scoped tools."""

async def agent_start(name: str) -> CommandResult[dict]:
    """Start agent: create session, begin heartbeat loop."""

async def agent_stop(name: str) -> CommandResult[dict]:
    """Stop agent: destroy session, cancel pending tasks."""

async def agent_list() -> CommandResult[list[dict]]:
    """List all agents with health status."""

async def agent_status(name: str) -> CommandResult[dict]:
    """Detailed agent status: health, current task, history, token usage."""

async def agent_heartbeat(name: str) -> CommandResult[dict]:
    """Manual heartbeat probe. Returns health + current task + resource usage."""

# Task management
async def task_assign(
    description: str,
    agent: str | None = None,         # Explicit assignment
    priority: int = 5,
    parent: str | None = None,        # Subtask of another task
) -> CommandResult[dict]:
    """Assign task. If no agent specified, router selects best match."""

async def task_status(task_id: str) -> CommandResult[dict]:
    """Task status with progress, agent assignment, subtasks."""

async def task_list(
    status: str | None = None,
    agent: str | None = None,
) -> CommandResult[list[dict]]:
    """List tasks with optional filters."""

async def task_cancel(task_id: str) -> CommandResult[dict]:
    """Cancel a pending or running task."""

# Team operations
async def team_status() -> CommandResult[dict]:
    """Overview: all agents, active tasks, queue depth, health summary."""

async def team_broadcast(message: str) -> CommandResult[dict]:
    """Send a message to all agents (injected into their sessions)."""
```

---

## Task Router

When `task_assign` is called without an explicit agent, the router selects the best match:

```python
def route_task(task: Task, agents: list[AgentConfig], health: dict[str, AgentHealth]) -> str | None:
    """Select best agent for task. Returns agent name or None if no match."""
    candidates = []
    for agent in agents:
        score = 0
        # 1. Skill keyword matching (task description ↔ skill triggers)
        score += skill_match_score(task.description, agent.skills)
        # 2. Connector availability (does task need external access?)
        score += connector_match_score(task.description, agent.connectors)
        # 3. Availability (current load vs max_concurrent_tasks)
        if health[agent.name].status == "busy" and current_tasks(agent) >= agent.max_concurrent_tasks:
            continue  # Skip overloaded agents
        # 4. Lead agents get priority for decomposition tasks
        if task.parent_task is None and agent.is_lead:
            score += 2
        candidates.append((agent.name, score))
    
    candidates.sort(key=lambda x: x[1], reverse=True)
    return candidates[0][0] if candidates else None
```

---

## Heartbeat Loop

The heartbeat loop uses AFD's `ReconnectPolicy` and `create_reconnecting_handoff()` for session recovery with exponential backoff, rather than hand-rolling retry logic:

```python
from afd.handoff import create_reconnecting_handoff, ReconnectPolicy
from afd.telemetry import TelemetrySink, create_telemetry_event

_reconnect_policy = ReconnectPolicy(
    max_retries=3,
    base_delay_ms=1000,
    max_delay_ms=30000,
    backoff_factor=2.0,
)

async def _heartbeat_loop(agent_name: str, interval: int, telemetry: TelemetrySink):
    """Background task that monitors agent health."""
    while True:
        await asyncio.sleep(interval)
        health = await _probe_agent(agent_name)
        _health_registry[agent_name] = health
        
        # Emit health telemetry event
        telemetry.emit(create_telemetry_event(
            name="agent.heartbeat",
            attributes={"agent": agent_name, "status": health.status},
        ))
        
        if health.status == "unhealthy":
            # Attempt recovery using AFD reconnection with exponential backoff
            connection = create_reconnecting_handoff(
                agent_name, policy=_reconnect_policy,
                on_reconnect=lambda: agent_start(agent_name),
            )
            await connection.reconnect()
            # Re-queue any interrupted tasks
            await _requeue_interrupted_tasks(agent_name)
```

### Batch Task Execution

When a lead agent decomposes work into subtasks, the orchestrator uses AFD's `execute_batch()` for structured batch execution with configurable failure modes:

```python
from afd.batch import execute_batch, BatchResult

async def _execute_subtasks(subtasks: list[Task], mode: str = "continue") -> BatchResult:
    """Execute subtasks using AFD batch semantics."""
    return await execute_batch(
        [_execute_single_task(t) for t in subtasks],
        on_failure=mode,  # "continue" or "stop"
    )
    # BatchResult provides structured per-task success/failure with aggregation
```

### CommandResult `plan` Field

When a lead agent decomposes a task, the result uses AFD's `plan` field (added in CommandResult standardization #144) to communicate the execution plan:

```python
async def task_assign(description, agent=None, priority=5, parent=None):
    if is_decomposable and agent_config.is_lead:
        subtasks = await _decompose(description)
        return success(
            data={"task_id": task.id, "subtasks": [s.id for s in subtasks]},
            plan=[{"step": s.description, "agent": s.assigned_agent, "status": "pending"}
                  for s in subtasks],
            reasoning=f"Decomposed into {len(subtasks)} subtasks",
        )
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Agents defined in `botcore.toml`** | Config-driven, no code changes to add/modify agents. Botcore's config system handles validation. |
| **One Copilot session per agent** | Session isolation. No cross-agent context contamination. Independent compaction. |
| **Skill-based routing** | Botcore's skill `triggers` keywords already exist — reuse for task matching. |
| **Lead agent for decomposition** | Only lead agents can create subtasks. Prevents recursive delegation loops. |
| **Orchestrator is synchronous coordinator** | No agent-to-agent direct communication. All coordination through task queue. Auditable. |
| **Heartbeat with auto-recovery** | Copilot sessions can go unhealthy. AFD `ReconnectPolicy` with exponential backoff handles recovery. |
| **AFD batch execution for subtasks** | `execute_batch()` with continue-on-failure / stop-on-error modes provides structured batch semantics for task decomposition. |
| **AFD telemetry for health monitoring** | `TelemetrySink` + `TelemetryEvent` emit structured health events from the heartbeat loop, enabling observable agent health. |
| **CommandResult `plan` for decomposition** | Lead agents use the `plan` field (from AFD #144) to communicate subtask execution plans. |

---

## Package Structure

Shipped as a standalone pip-installable plugin — **not** inside `src/botcore/`.

```
packages/botcore-agents/
├── pyproject.toml                # entry-point: [project.entry-points."botcore.plugins"]
├── src/
│   └── botcore_agents/
│       ├── __init__.py           # AgentsPlugin (BotCorePlugin implementation)
│       ├── config.py             # AgentConfig, AgentsPluginConfig (Pydantic)
│       ├── models.py             # Task, AgentHealth, AgentState (Pydantic)
│       ├── orchestrator.py       # AgentOrchestrator — pool + task management
│       ├── _docs.py              # MCP documentation
│       ├── commands.py           # agent_*, task_* commands
│       ├── router.py             # (Phase 2) Task → agent matching
│       └── queue.py              # (Phase 2) Task queue with priority ordering
└── tests/
    ├── conftest.py               # Fixtures: config, mock LLM, orchestrator
    ├── test_config.py
    ├── test_models.py
    ├── test_orchestrator.py
    ├── test_resolve_connector_commands.py  # Pure function tests
    ├── test_commands.py
    └── test_plugin.py
```

### Plugin Registration

```toml
# botcore-agents/pyproject.toml
[project]
name = "botcore-agents"
dependencies = ["botcore", "botcore-llm", "afd"]

[project.entry-points."botcore.plugins"]
agents = "botcore_agents:AgentsPlugin"
```

```python
# botcore_agents/__init__.py
from botcore.plugin import BotCorePlugin

class AgentsPlugin(BotCorePlugin):
    def register(self, registry):
        from .commands import AGENT_COMMANDS
        registry.add_commands(AGENT_COMMANDS)
        registry.set_mcp_name("agents")
        registry.add_docs("agents", AGENT_DOCS)
```

---

## Phases

### Phase 1: Single Agent

- [x] Scaffold `botcore-agents` plugin package with `pyproject.toml` + entry-point
- [x] `AgentsPlugin` implementing `BotCorePlugin.register()`
- [x] `AgentConfig` Pydantic model with `extra="forbid"` validation
- [x] `agent_create` / `agent_start` / `agent_stop` commands
- [x] Copilot session creation with scoped tool bridge (from LLM Runtime)
- [x] `task_assign` (explicit agent only, no routing)
- [x] `agent_status` / `agent_heartbeat`
- [x] Capability declarations — `connector_commands` field, `resolve_connector_commands()` with 4-step resolution (explicit → deny-by-default → wildcard → prefix filter), `_resolve_tools()` combining skills + connector commands
- [ ] Telemetry integration: emit `TelemetryEvent` from agent lifecycle commands via AFD `TelemetrySink`
- [x] Unit tests with mock Copilot sessions (110 tests)
- [ ] JTBD scenario tests for agent lifecycle (using AFD Python `afd.testing` scenario runner)

**Acceptance criteria:**
- [x] Single agent starts, receives task, executes via Copilot session, returns result
- [x] Agent tools are scoped — only declared skills/connectors available
- [x] Agent stop destroys session cleanly
- [ ] Agent lifecycle events emitted as telemetry

### Phase 2: Multi-Agent + Router

- [ ] Multiple agents in config, independent sessions
- [ ] Task router (skill matching, availability, lead priority)
- [ ] `task_list` / `task_cancel` / `team_status`
- [ ] Task queue with priority ordering
- [ ] Routing tests with multiple agents and varied skill profiles

### Phase 3: Heartbeat + Auto-Recovery

- [ ] Background heartbeat loop per agent using AFD `ReconnectPolicy` for exponential backoff
- [ ] `create_reconnecting_handoff()` for session auto-restart
- [ ] Unhealthy detection + auto-restart with backoff
- [ ] Interrupted task requeuing
- [ ] `team_broadcast` for system-wide messages
- [ ] Health history tracking via AFD `TelemetryEvent` stream

### Phase 4: Task Decomposition

- [ ] Lead agent subtask creation via `task_assign(parent=...)`
- [ ] Subtask batch execution using AFD `execute_batch()` with continue-on-failure / stop-on-error modes
- [ ] `CommandResult.plan` field for communicating decomposition plans
- [ ] Subtask tracking and roll-up via `BatchResult`
- [ ] Decomposition depth limit (prevent infinite delegation)
- [ ] Parent task completes when all subtasks complete

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Agent escapes tool scope | Session-scoped tools from LLM Runtime. `resolve_connector_commands()` enforces deny-by-default — agents only see declared skills + resolved connector commands. |
| Runaway task creation | Lead-only decomposition + depth limit (default: 3 levels) |
| Agent-to-agent injection | No direct communication. All through orchestrator task queue. |
| Resource exhaustion | `max_concurrent_tasks` per agent. Queue depth limits. |
| Stale/zombie agents | Heartbeat loop with configurable timeout. Auto-stop after N missed beats. |

---

## AFD Integration Summary

| AFD Module | Used For | Replaces |
|---|---|---|
| `afd.handoff` | `ReconnectPolicy` + `create_reconnecting_handoff()` for heartbeat auto-recovery | Hand-rolled retry logic in heartbeat loop |
| `afd.batch` | `execute_batch()` + `BatchResult` for subtask decomposition execution | Custom subtask tracking and roll-up |
| `afd.telemetry` | `TelemetrySink` + `TelemetryEvent` for agent health monitoring | Custom health history tracking |
| `afd.middleware` | `compose_middleware()` for agent command execution hooks | Custom pre/post execution hooks |
| `afd.testing` | JTBD scenario tests for agent lifecycle and task routing | Ad-hoc pytest fixtures |
| `CommandResult.plan` | Decomposition plan communication from lead agents | Custom plan data structures |
