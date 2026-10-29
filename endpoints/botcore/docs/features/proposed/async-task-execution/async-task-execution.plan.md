# Async Task Execution

> Proposed — Phase 2 agent enhancement. Foundation specs must be complete first.

## Summary

The agent orchestrator currently processes tasks synchronously — task assignment and execution happen in the same call. This proposal adds an async event loop to the orchestrator so agents can execute tasks concurrently in the background, with status polling and completion callbacks.

## Why This Matters

- Current model: `task_assign()` blocks until assignment completes, agent processes task within the same call
- Target model: `task_assign()` queues the task and returns immediately, orchestrator dispatches to agent in background, caller polls `task_status()` or receives callback
- Already in place: while a task runs, `task_status()` returns `partial_result` and `progress_message` from the task stream (in memory only, [#37](https://github.com/lushly-dev/botcore/issues/37)); background dispatch should keep feeding them
- Enables: parallel agent work, long-running tasks, dashboard-driven task tracking

## Prerequisite Specs

- [Agent Capability Declarations](../../complete/agent-skill-scoping/agent-skill-scoping.plan.md) — agents need scoped tool access before running concurrently
- [Per-Agent Permission Profiles](../../complete/per-agent-permissions/per-agent-permissions.plan.md) — concurrent agents need independent permission enforcement
- [Orchestrator State Serialization](../../complete/orchestrator-state-serialization/orchestrator-state-serialization.plan.md) — background tasks need crash recovery

## Key Design Decisions

- Orchestrator runs an `asyncio` event loop for task dispatch
- Task queue is priority-ordered (existing `priority` field on Task model)
- Agent heartbeat loop monitors health during long-running tasks
- Failed tasks requeue (up to `max_retries`) automatically
- New commands: `task_cancel(task_id)`, `task_list(status?, agent?)`

## Scope

- In-process async execution (not distributed)
- Single-machine orchestrator (distributed is a separate proposal)
- Existing Task model and AgentState machine unchanged

## Estimated Effort

Medium — asyncio loop + dispatch logic + status tracking. Task model and agent lifecycle already exist.
