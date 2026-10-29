# Agent Trust And Approvals

> Active planning spec — defines how botcore should handle destructive actions, approvals, and sandbox boundaries.

## Overview

Botcore’s philosophy differs from “open terminal” agent systems. The primary safety mechanism should be constrained commands and explicit approvals, not giving every agent general shell access and relying on prompts or a universal sandbox to contain damage afterward.

This spec defines the decision space for destructive action handling, approval UX, and when sandboxing is actually needed.

## Status

| Field | Value |
|---|---|
| Status | Active |
| Author | AI-assisted |
| Date | 2026-03-21 |
| Last reviewed | 2026-10-01 |
| Priority | Platform Planning |

## Principle

The preferred safety stack is:

1. **Capability scoping** — what commands/tools exist for the agent
2. **Permission scoping** — what system-level actions are allowed
3. **Trust metadata and approval** — which actions require confirmation
4. **Sandbox isolation** — only for commands that execute inherently risky or untrusted workloads

## Core Decision

Should botcore rely primarily on sandboxing, approvals, constrained commands, or a layered mix?

## Options

### Option A — Open Terminal + Sandbox

Give agents broad shell access inside a sandbox.

**Pros**
- Very flexible
- Strong for power-user coding flows

**Cons**
- Harder to reason about
- Still broad capability exposure
- Sandbox becomes a mandatory platform dependency

### Option B — Command-First + Approval

Expose only reviewed commands and require approval for destructive ones.

**Pros**
- Strongest auditability
- Clearest product behavior
- Best fit for botcore’s philosophy

**Cons**
- Less flexible than raw shell
- Requires more command design effort

### Option C — Hybrid

Use command-first by default, but allow sandboxed execution commands for narrow cases like untrusted code execution.

**Pros**
- Most practical long-term model
- Keeps the safe default while preserving escape hatches

**Cons**
- Needs clear product policy to avoid accidental “everything becomes exec”

## Recommendation

Prefer **Option C with Option B as the default posture**:

- most agents should only use constrained commands
- destructive commands should carry trust metadata and approval semantics
- sandboxing should be an optional execution surface for specific high-risk commands

## AFD Fit

AFD already has useful patterns here in its [Command Trust Config spec](https://github.com/lushly-dev/afd/blob/main/docs/features/complete/command-trust-config/command-trust-config.spec.md):
- `destructive` metadata
- `confirmPrompt`
- surfacing trust metadata to clients/UIs

That spec describes confirmation **after backend execution, before local apply**. This is useful UI metadata, not a general pre-execution authorization barrier. Botcore must enforce approval before any protected side effect in the handler, regardless of whether the caller is CLI, scheduled, delegated, or remote. A preview/apply split can support this only when preview is side-effect-free and apply checks approval.

Botcore should likely adopt compatible command trust semantics so:
- CLI can require confirmation
- local/headless runtimes can enforce policy
- future AFD-based UIs can reuse the same metadata

## Where Approvals Should Apply

- deleting data or resources
- merging/publishing/deploying
- filesystem writes outside a narrow project scope
- connector actions with external side effects
- commands that spend money, create tickets, send email, or trigger workflows

## Where Sandboxing Still Matters

- arbitrary shell/script execution
- executing code from untrusted repos
- package install/build/run commands for unknown projects
- browser automation against hostile or unknown content
- third-party plugin execution with broad host access

## Build vs Buy

| Concern | Prefer | Why |
|---|---|---|
| Trust metadata schema | Borrow from AFD | Good conceptual fit, avoids inventing a parallel model |
| Approval middleware/policy layer | Build in botcore | Approval semantics are part of botcore runtime policy |
| Sandboxed execution | Use existing sandbox/container tools | Too much risk to hand-roll isolation |

## Candidate Libraries / Infrastructure

### Approval / Policy

- botcore-owned middleware and command metadata
- AFD-compatible trust metadata conventions

### Sandboxing

- OS/container sandboxes
- Docker/Podman-style isolation
- stricter local execution wrappers for command-specific cases

The recommendation is to avoid making sandboxing a hard dependency for all botcore agents.

## Decision Points

- Should commands require approval before the handler runs, or use a side-effect-free preview followed by approval-gated apply?
- Do destructive commands need preview/apply split semantics?
- Should approvals be user-interactive only, or also policy-driven for headless runs?
- Which commands are trusted enough to bypass approval in scheduled/cloud operation?

## Success Criteria

- Most useful agents can operate without raw shell access
- Destructive actions are visible and explicitly gated
- Sandbox use is targeted, not universal
- The resulting model is safer and more predictable than “open terminal autonomy”
