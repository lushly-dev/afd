# Multi-Agent Collaboration

> Active planning spec — defines how botcore agents should coordinate work, delegate tasks, and share context safely.

## Overview

Botcore already has the beginnings of role-aware orchestration, but not yet a full collaboration model. If agents are going to work together by leveraging each other's specialties, botcore needs explicit patterns for delegation, work ownership, context sharing, and result review.

This spec focuses on structured collaboration, not freeform “agents chatting with each other.”

## Status

| Field | Value |
|---|---|
| Status | Active |
| Author | AI-assisted |
| Date | 2026-03-21 |
| Last reviewed | 2026-10-01 |
| Priority | Platform Planning |

## Goals

- Let specialist agents collaborate predictably
- Preserve least privilege between agents
- Keep work auditable and resumable
- Fit both local and cloud runtimes

## Non-Goals

- Building a general-purpose conversational chat bus between agents
- Fully distributed actor-style orchestration in the first phase
- Letting agents discover arbitrary peers and improvise coordination rules

## Core Decision

What should be the primary collaboration mechanism between botcore agents?

## Options

### Option A — Shared Task Graph Only

Agents collaborate only through orchestrator tasks and subtasks.

**Pros**
- Simple and auditable
- Strong fit with current orchestrator model
- Easy to persist and inspect

**Cons**
- Can be rigid for richer workflows
- Requires explicit structure everywhere

### Option B — Shared Task Graph + Shared Memory

Agents delegate through tasks, but use agent/team/task memory for intermediate findings and handoff context.

**Pros**
- Practical and flexible
- Good balance of structure and context sharing
- Maps well to current botcore memory model

**Cons**
- Requires clearer memory conventions
- Risk of stale or ambiguous handoff state

### Option C — Agent-to-Agent Message Bus

Introduce explicit messages/mailboxes/events between agents.

**Pros**
- More expressive collaboration patterns
- Better for async and distributed systems

**Cons**
- Much more complex
- Harder to audit and reason about
- Easy to create noisy or emergent behavior

## Recommendation

Prefer **Option B first**:

- use the orchestrator task graph as the canonical work model
- use memory and structured task outputs for handoff context
- add richer eventing only if task+memory proves insufficient

This keeps the system legible and secure.

## Authorization Prerequisite

The current memory implementation isolates agent scopes, but permits every agent to read and write team/task scopes. Scope names alone do not enforce team membership or task participation.

Shared-memory collaboration must enforce team/task membership before it can satisfy the least-privilege goal. The runtime must bind caller identity and participation to each shared-memory operation; nonparticipants must not be able to read or overwrite handoff context. Participant write roles remain a separate design decision below.

## Collaboration Model To Standardize

- **Lead/worker**: one agent creates and owns the parent task
- **Subtask delegation**: specialists receive bounded subtasks
- **Structured outputs**: handoffs should produce command data, not just prose
- **Review step**: a lead or reviewer agent validates outputs before finalization
- **Shared memory policy**: decide what belongs in task memory vs team memory

## Build vs Buy

| Concern | Prefer | Why |
|---|---|---|
| Task orchestration | Build on botcore orchestrator | Botcore-specific semantics live here |
| Shared context | Build on botcore memory | Already part of the platform boundary |
| Specialized real-time/session interactions | Use AFD handoff pattern where needed | Better for long-lived protocol bootstrap than for general collaboration |
| Event bus | Defer | Too much complexity early |

## AFD Fit

AFD is useful for:
- inter-command pipelines
- richer result metadata and suggestions
- handoff/bootstrap for specialized sessions

AFD does not replace botcore’s need for:
- task ownership rules
- delegation policy
- memory scope rules
- review/approval loops between agents

## Decision Points

- Should delegated work always create a subtask record?
- How should the runtime enforce team/task membership for shared-memory reads and writes?
- Should task memory be write-open to all agents on the task, or scoped by role?
- Do we require reviewer-style approval before side-effecting follow-up tasks?
- When do we escalate from task graph semantics to a real event/message bus?

## Success Criteria

- Specialist agents can collaborate without raw peer-to-peer shell freedom
- Delegation is auditable through tasks and persisted state
- Shared context is structured and least-privilege aware
- The first version stays understandable by operators and users
