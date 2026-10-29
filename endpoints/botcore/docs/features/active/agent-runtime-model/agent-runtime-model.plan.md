# Agent Runtime Model

> Active planning spec — defines how botcore agents should run autonomously across local and cloud environments.

## Overview

Botcore now has the foundations for secure, focused agents: capability scoping, per-agent permissions, memory, and persistent orchestrator state. What it does not yet have is the runtime model that turns those pieces into a dependable autonomous system.

This spec breaks down the runtime choices for a botcore-powered agent platform that can:
- run headlessly from CLI or service mode
- operate locally or in cloud environments
- keep using AFD as the command and surface contract
- support future scheduling, collaboration, and UI layers without re-architecture

## Status

| Field | Value |
|---|---|
| Status | Active |
| Author | AI-assisted |
| Date | 2026-03-21 |
| Last reviewed | 2026-10-01 |
| Priority | Platform Planning |

## Why This Matters

Today botcore has:
- synchronous task execution in the orchestrator
- persistent state snapshots
- per-agent permissions and tool scoping

But it does not yet have:
- a long-running agent service
- a stable execution model for scheduled/background work
- a clear local-vs-cloud story
- a clear relationship between headless operation and any future AFD-based UI

Without a runtime decision, every later feature ends up guessing at the execution environment.

## Core Decision

What should be the primary runtime abstraction for botcore agents?

## Options

### Option A — CLI-Only / Ephemeral Runtime

Run agents only inside a single CLI invocation.

**Pros**
- Smallest implementation surface
- Easy to debug
- Minimal background-process complexity

**Cons**
- Poor fit for scheduling and autonomous work
- No persistent execution loop
- Weak foundation for collaboration and dashboards

**Best for**
- Dev-mode experimentation only

### Option B — Local Persistent Gateway

Run a local long-lived botcore gateway process that owns orchestrator state, sessions, scheduling, and task execution.

**Pros**
- Best fit for personal/local autonomous agents
- Pairs well with existing orchestrator state serialization
- Easy to expose via CLI, AFD server, and local UI
- Clear path to headless operation

**Cons**
- Requires process lifecycle management
- Local auth and socket/port management become real concerns
- Cloud story still needs a second layer

**Best for**
- OpenClaw-style local agent assistant

### Option C — Cloud Worker Service First

Make the main runtime a hosted worker/gateway that runs agents remotely.

**Pros**
- Strong fit for team scheduling and centralized management
- Easier to add dashboards, notifications, and multi-user workflows
- Better operational observability

**Cons**
- Higher complexity up front
- Harder local/offline story
- Requires auth, tenancy, deployment, and secrets handling immediately

**Best for**
- SaaS-first or org-first deployment

### Option D — Hybrid Runtime Model

Define one runtime contract, then support both:
- local persistent gateway for developer/personal use
- cloud worker/gateway for managed use

**Pros**
- Matches the project vision best
- Keeps local-first usability
- Enables future hosted control plane without forking the architecture

**Cons**
- Requires stronger abstraction boundaries
- Slightly more design work up front

**Best for**
- Botcore as infrastructure powering both headless local agents and future hosted surfaces

## Recommendation

Prefer **Option D implemented in two stages**:

1. Build **Option B** first: a local persistent gateway and headless runtime.
2. Keep the runtime contract clean enough that the same orchestrator/gateway shape can later run in cloud form.

This keeps the first implementation practical while avoiding a local-only dead end.

## Runtime Principles

- **Command-first**: all agent capabilities still flow through botcore/AFD commands
- **Gateway-owned sessions**: the persistent runtime owns agent sessions, not the UI
- **Headless-first**: every runtime feature must work without a UI
- **Surface-optional**: CLI, Teams, and future AFD UI all speak to the same runtime
- **Stateful but recoverable**: process death should not mean workflow loss

## AFD Fit

AFD should be used for:
- command contracts
- DirectClient for in-process/local execution
- MCP/SSE surfaces where needed
- handoff/session bootstrap for specialized long-lived interactions

Botcore should still own:
- agent orchestration semantics
- agent lifecycle and memory policy
- runtime-specific scheduling and collaboration logic

## Build vs Buy

| Concern | Prefer | Why |
|---|---|---|
| Command/runtime contract | Build on AFD | Already aligned with botcore architecture |
| Local in-process execution | Use AFD DirectClient | Avoid inventing a second local command protocol |
| Persistent service shell | Build thin botcore gateway | Botcore-specific semantics live here |
| HTTP process hosting | Use standard Python service stack | No reason to invent hosting primitives |

## Candidate Libraries / Infrastructure

### Good Fits

- **AFD DirectClient** for co-located command execution
- **AFD server/client** for future UI or remote surfaces
- **FastAPI** or a similarly small ASGI layer if a local/cloud HTTP gateway is needed
- **Uvicorn** for service hosting

### Probably Too Heavy for Phase 1

- full workflow engines as the core runtime
- actor frameworks
- custom RPC beyond what AFD already gives us

## Decision Points

- Should the gateway be repo-scoped, user-scoped, or system-scoped?
- Should agent sessions be recreated lazily on demand or eagerly on startup?
- Should the runtime expose only commands, or also subscribe/push events?
- Should local and cloud runtimes share one config file format exactly?

## Success Criteria

- A single botcore runtime model works headlessly
- The same model can serve CLI and future AFD-based UI surfaces
- Local deployment is first-class, not a debugging mode
- Cloud deployment is possible without replacing core abstractions
