# Cost-Aware Agent Routing

> Proposed — extends agent orchestrator with model cost tracking and budget enforcement.

## Summary

Add cost awareness to agent orchestration: track token usage per agent, enforce daily/weekly budgets, prefer cheaper models for bulk tasks, and escalate to expensive models only when confidence is low. Aligns with Lushly Vision 7 (Agent Orchestration Tiers).

## Why This Matters

- Multi-agent systems can burn through API budgets quickly
- Different tasks need different model tiers (Haiku for classification, Sonnet for drafting, Opus for reports)
- Without cost tracking, there's no visibility or control over agent spending
- Without budget enforcement, a runaway agent loop can exhaust credits

## Key Design Decisions

- Add `model_tier` and `cost_per_1k_tokens` fields to AgentConfig
- Orchestrator tracks cumulative token usage per agent (from session metadata)
- New config: `[budgets]` section with `daily_limit`, `weekly_limit`, `prefer_cheapest`
- Task router prefers cheapest capable agent; escalates if confidence < threshold
- New commands: `budget_status()`, `budget_reset(agent?)`

## Prerequisite Specs

- [Agent Capability Declarations](../../complete/agent-skill-scoping/agent-skill-scoping.plan.md) — routing needs capability awareness
- [Orchestrator State Serialization](../../complete/orchestrator-state-serialization/orchestrator-state-serialization.plan.md) — budget counters need persistence

## Scope

- Extend AgentConfig and AgentOrchestrator (additive, no breaking changes)
- Token usage tracked from LLM session responses
- Budget enforcement as soft limit (warn) and hard limit (block)

## Estimated Effort

Small-Medium — additive fields on AgentConfig, routing heuristic in task_assign, budget tracking commands.
