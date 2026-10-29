# AFD agent engine

| Field | Value |
| --- | --- |
| Status | Proposed; research and architecture direction only |
| Date | 2026-10-28 |
| Package boundary | New independently consumable package(s) in this repository |
| Implementation | Not started by this proposal |

## Purpose

Explore a reusable AFD-native engine for ongoing agentic work. Human requests,
events and schedules should invoke the same applicable capabilities, while
hosting, interfaces and human/agent control remain independent choices.

Continuous improvement is a motivating application: observe a system, substantiate
a finding, propose a change, obtain the appropriate decision, apply and verify the
change, then promote useful learning into shared inputs. The engine must also
support other workflows without imposing that sequence on every task.

## Package and ownership boundaries

- Implement the engine in **new package(s)**, not by expanding the existing core,
  server, client or companion packages into a mandatory runtime.
- Consume existing AFD command/result and control contracts where they fit.
- Keep model providers, storage, scheduling infrastructure and transports behind
  explicit integration boundaries.
- Let optional shared modules and consumer-owned modules add capabilities without
  special cases in the engine's dispatcher, scheduler or persistence logic.
- Keep domain knowledge, acceptance criteria, deployment configuration and
  organization-specific policy with the consumer.
- Treat human-facing applications, CLI, MCP and in-process callers as surfaces
  over the same capabilities, not independent definitions of their behavior.

## Research and evidence

- [Research synthesis and architecture direction](research.md)
- [Annotated public-source ledger](sources.md)

The research distinguishes documented features, reported operating results and
empirical findings. Neither this proposal nor a merged documentation PR establishes
implemented capabilities, measured benefits or a delivery commitment.

## Decisions still open

Package names and decomposition, implementation language, the first host,
durability and identity adapters, module contribution contracts, and the initial
pilot remain open. Native Rust/C++ AFD implementations are options, not a decision
to implement the entire engine in every language.

Before expanding the shared contracts, check the existing command metadata,
journal, handoff and language-parity work, plus the proposed
[MCP Tasks](../mcp-tasks/mcp-tasks.proposal.md) and
[Plugin Discovery](../plugin-discovery/plugin-discovery.proposal.md) surfaces.

## First proof

Demonstrate one bounded workflow through human and scheduled initiation, including
interruption, a rejected proposal, uncertain completion and an accepted shared
learning. Add a second, different module without changing the execution engine.
Use that evidence to select the first implementation scope rather than committing
to a complete general-purpose platform up front.
