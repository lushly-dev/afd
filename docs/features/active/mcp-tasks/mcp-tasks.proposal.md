# MCP Tasks for long-running commands

> **Goal**: Let a command that outlives an HTTP request run as an MCP task under the `io.modelcontextprotocol/tasks` extension. The client gets a task handle at once, and polls for status and the result.

| Field | Value |
|---|---|
| Status | Active. Proposed 2026-10-25; approved 2026-11-04 with the [Umbel phase 5 specification](../../../../endpoints/umbel/docs/phases/5-auth-hosted/spec.md#122-tasks-for-long-jobs-d127) (decisions D106 and D127, under the owner's 2026-10-31 delegation): Umbel's `sources-sync`, `knowledge-index` and `knowledge-refresh` outlive a request, which answers T1. Phase 1, the spec, done 2026-11-07 as Umbel step 0a: [Tasks](../../../../spec/command-metadata.md#tasks) in `spec/command-metadata.md` (T2, T3 and T5, with confirmations inside tasks left out, below). Phase 2, the Rust pilot, done 2026-11-07 as Umbel step 0e: `packages/rust` serves `task`, a `TaskStore` (a bounded in-memory default) and the `tasks/*` handlers with the owner check, on `rmcp` 3.9's model types and handler hooks for the extension. It does not use `rmcp`'s `TaskManager`, which keeps tasks in memory with no owner, no pluggable store and no bound, and marks a task past its TTL `failed`; the choices are in the Umbel specification's [Amendments from step 0e](../../../../endpoints/umbel/docs/phases/5-auth-hosted/spec.md#amendments-from-step-0e). A task-capable todo command in the conformance suite waits for a second language. TypeScript and Python (phases 3 and 4) are next; progress is in the [Umbel status](../../../../endpoints/umbel/docs/STATUS.md). Ranked 4 of 4 among the [MCP 2026-07-28 Phase 7 follow-ons](../mcp-2026-07-28/proposal.md#phase-7-optional-follow-ons-each-its-own-proposal). |
| Author | jasfalk (drafted with Claude) |
| Spec | [SEP-2663: Tasks extension](https://modelcontextprotocol.io/seps/2663-tasks-extension) (Final, Extensions Track), [extensions overview](https://modelcontextprotocol.io/extensions/overview) |
| Packages | `spec/`, `packages/core`, `packages/server`, `packages/client`, `python/`, `packages/rust` |
| Related | [Command progress](../../proposed/mcp-progress/mcp-progress.proposal.md) (status messages), [MCP confirmations](../mcp-confirmations/mcp-confirmations.proposal.md) (the `input_required` status), [MCP authorization](../mcp-authorization/mcp-authorization.proposal.md) (task access checks), [handoff pattern](../../complete/handoff-pattern/) (AFD's command-level start-and-poll pattern) |

## Why this is fourth

| Criterion | Assessment |
|---|---|
| Value | Low to medium today. It only matters for commands that run longer than a client will hold a request open, and AFD's examples have none. The handoff pattern already covers start-and-poll at the command level. |
| Readiness | Low. The extension is Final, but only rmcp ships a runtime (`TaskManager`). TypeScript SDK 2.4 and Python `mcp` 2.3 have no task runtime, so AFD would write the `tasks/*` handlers itself. |
| Effort | L. A task store that works across stateless instances, three methods, capability gating, and principal checks, in each server. |
| Dependencies | Progress, for status messages. Authorization, to bind tasks to a caller on shared servers. Confirmations, for the `input_required` status. |

### When to start

Start when either holds:
- an AFD user has a command that regularly exceeds a client request timeout, or
- the TypeScript SDK ships a tasks runtime, which would remove most of the TypeScript work.

Until then, a Rust pilot on rmcp's `TaskManager` is cheap and would test the design.

## What the extension defines

- **Negotiation.** The client declares `extensions["io.modelcontextprotocol/tasks"]` in each request's client capabilities. The server declares it in `server/discover`.
- **Server's choice.** Only `tools/call` can become a task. The server decides per request whether to answer with `resultType: "task"` and a `Task`. It must not do so for a client that did not declare the extension. A tool that can only run as a task answers `-32021` with the required capability.
- **`Task`.** `taskId`, `status` (`working`, `input_required`, `completed`, `failed`, `cancelled`), `statusMessage`, `createdAt`, `lastUpdatedAt`, `ttlMs`, `pollIntervalMs`. A completed task carries the `CallToolResult`; a failed one carries the error.
- **Methods.** `tasks/get` returns the task. `tasks/update` delivers `inputResponses` to a task waiting for input. `tasks/cancel` requests cooperative cancellation. `Mcp-Name` carries the `taskId` for HTTP routing.
- **Limits.** Progress and log notifications are not delivered for tasks. Task IDs must be unguessable, and every task request must pass the same authorization as the original call.

## Proposal

### Command metadata

`spec/command-metadata.md` gains `task: 'never' | 'optional' | 'required'`, default `'never'`:

- **`'optional'`.** The command runs as a task when the client declares the extension, and inline otherwise.
- **`'required'`.** The command runs only as a task. A client without the extension gets `-32021`.

### Task store

A `TaskStore` interface holds task records and results: `create`, `get`, `update`, `cancel`, `expire`. An in-memory store is the default and is documented as single-instance only. Hosts with several instances plug in a shared store. Records carry the principal from [authorization](../mcp-authorization/mcp-authorization.proposal.md) when present, and every `tasks/*` call checks it.

### Execution

- The task runs the command through the normal executor with a fresh `CommandContext`. Its `signal` is aborted by `tasks/cancel` or by TTL expiry.
- `context.progress` from the [progress proposal](../../proposed/mcp-progress/mcp-progress.proposal.md) updates `statusMessage`, and `lastUpdatedAt`, instead of sending notifications.
- A confirm-gated command (see [confirmations](../mcp-confirmations/mcp-confirmations.proposal.md)) moves to `input_required`, and continues when `tasks/update` brings an accepted confirmation. *Not in the 2026-11-07 spec:* a command with `confirmPrompt`, an approval policy or the host-verified mode cannot declare `task`, so no task asks a person; a later revision may add this.
- The result is the same `CallToolResult` that an inline call returns, including `structuredContent`.

### Per language

| Language | Implementation |
|---|---|
| Rust | Done (Umbel step 0e): `rmcp`'s task model types and `ServerHandler` hooks, with AFD's own runner and `TaskStore`, since `TaskManager` has no owner check, store or bound. |
| TypeScript | AFD-owned handlers for `tasks/get`, `tasks/update` and `tasks/cancel` on the low-level `Server`, plus the store. |
| Python | The SDK's generic `Extension` and `MethodBinding` mechanism, plus the store. |
| C++ | Not planned. |

The AFD client gains task support: it declares the extension when asked, polls at `pollIntervalMs`, and returns the final `CommandResult`, so callers see an ordinary result.

## Phases

1. Spec: the `task` field, the store contract, and the status and cancellation rules.
2. Rust pilot on `TaskManager`, with conformance cases for a task-capable todo command.
3. TypeScript server and client.
4. Python.

## Decisions

| # | Question | Recommendation |
|---|---|---|
| T1 | Start now? | No. Wait for a real long-running command or a TypeScript SDK runtime, and run the Rust pilot first. *Answered 2026-11-04 (Umbel D127):* Umbel has the long-running commands; the spec and the Rust pilot start now. |
| T2 | How does a command opt in? | `task: 'never' \| 'optional' \| 'required'`, default `'never'`. |
| T3 | Where is task state kept? | A pluggable `TaskStore`. The in-memory default is single-instance only. |
| T4 | How do progress updates appear? | As `statusMessage` updates. |
| T5 | Do tasks need authorization? | On shared servers, yes: bind each task to its principal. A single-user server can rely on unguessable IDs alone. *Specified 2026-11-07:* every task's owner is the starting call's principal binding, checked on every `tasks/*` request on every server, and a task stops when the token that started it expires (`TASK_TOKEN_EXPIRED`). |

## Out of scope

Push notifications through `subscriptions/listen`, tasks for requests other than `tools/call`, the removed `tasks/list` and `tasks/result` from the experimental `2025-11-25` design, and turning the handoff pattern into tasks.

## Sources

- [SEP-2663](https://modelcontextprotocol.io/seps/2663-tasks-extension): negotiation, `CreateTaskResult`, the `Task` shape and statuses, `tasks/get`, `tasks/update` and `tasks/cancel`, `Mcp-Name` routing, and security rules.
- The SDKs as installed: rmcp 3.7.0 (`task_manager.rs`, `model/task.rs`), TypeScript `@modelcontextprotocol/server` 2.4.0 (no task runtime), Python `mcp` 2.3.0 (`mcp/server/extension.py`).
