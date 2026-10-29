# Agent Surfaces And Deployment

> Active planning spec — defines how botcore agents should be operated headlessly, locally, in the cloud, and through future interfaces.

## Overview

Botcore is infrastructure, not the end-user product. That means we need a clean model for how the same agent runtime can be:
- used headlessly from CLI
- hosted locally as a persistent service
- deployed in cloud environments
- surfaced through AFD-powered or other UIs

This spec focuses on the operator and deployment story, not the internals of scheduling or collaboration.

## Status

| Field | Value |
|---|---|
| Status | Active |
| Author | AI-assisted |
| Date | 2026-03-21 |
| Last reviewed | 2026-10-01 |
| Priority | Platform Planning |

## Goals

- Headless operation must always work
- Local development/personal use must be first-class
- Cloud deployment must be feasible without redesign
- UI surfaces should be layered on top of the same command/runtime model

## Core Decision

What should be the primary operating surfaces for botcore-powered agents?

## Surfaces To Support

### 1. CLI / Headless

This is non-negotiable.

Use cases:
- local automation
- scheduled jobs
- CI/CD and scripts
- debugging and operator control

### 2. Local Gateway / Daemon

Use cases:
- long-running local agents
- personal automation
- local dashboard or app shells

### 3. Cloud Worker / Service

Use cases:
- team automation
- centralized scheduling
- notifications and webhooks
- future hosted control plane

### 4. UI Layer On Top

Use cases:
- run inspection
- approvals
- schedule management
- task and memory visibility

The UI should likely be built on AFD-compatible commands rather than inventing a separate product API.

## Options

### Option A — CLI First, UI Later

**Pros**
- Keeps the platform grounded
- Avoids premature frontend architecture
- Best for early correctness

**Cons**
- Slower path to operator-friendly visibility

### Option B — Build Local UI Alongside Runtime

**Pros**
- Faster feedback on operator experience
- Easier to test approval flows

**Cons**
- Can pull design attention away from runtime fundamentals

### Option C — Cloud Control Plane First

**Pros**
- Strong enterprise/team path
- Easier observability and management

**Cons**
- Heavy lift
- Weak local-first story

## Recommendation

Prefer **Option A with explicit UI readiness**:

- build the runtime and command surfaces so they are UI-ready
- keep CLI/headless as the primary operator surface at first
- add local or web UI on top once runtime, scheduling, and approval flows stabilize

## AFD Fit

AFD should be treated as the main interface contract layer:
- commands for runtime control
- commands for schedule CRUD
- commands for task inspection and approvals
- handoff/session bootstrapping for richer surfaces if needed

That gives botcore:
- a headless path via CLI or direct calls
- a UI path via AFD clients
- a shared contract across local and cloud deployments

## Deployment Modes

### Local Personal Runtime

- runs on developer laptop or workstation
- owns local secrets and local state
- best for personal “agent works for me” usage

### Team / Cloud Runtime

- runs in hosted infrastructure
- needs auth, tenancy, secrets, and notifications
- better for scheduled shared agents and org workflows

### Hybrid

- local agents for personal/project work
- cloud agents for team-wide automation
- shared command semantics across both

## Build vs Buy

| Concern | Prefer | Why |
|---|---|---|
| Runtime control contract | Build on AFD commands | Strongest shared interface story |
| Web UI framework | Defer | Too early to commit here |
| Service hosting | Use standard Python hosting stack | No need for custom infra primitives |
| Cloud deployment | Use ordinary container/service deployment | Botcore should not invent deployment infrastructure |

## Decision Points

- Should the first persistent runtime be repo-scoped or user-scoped?
- Should cloud deployment be single-tenant first or multi-tenant ready?
- Do we need a local desktop-style control app, or is browser UI enough later?
- Which parts of the system must work fully offline?

## Success Criteria

- Botcore agents are fully usable headlessly
- The same capabilities can be surfaced through a later AFD-based UI
- Local and cloud deployment modes share one mental model
- Botcore stays the infrastructure layer rather than collapsing into product-specific UI logic
