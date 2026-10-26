# MCP Tasks for long-running commands

> **Goal**: Let a command that outlives an HTTP request run as an MCP task under the `io.modelcontextprotocol/tasks` extension. The client gets a task handle at once, and polls for status and the result.

| Field | Value |
|---|---|
| Status | Proposed 2026-10-25. Ranked 4 of 4 among the [MCP 2026-07-28 Phase 7 follow-ons](../../active/mcp-2026-07-28/proposal.md#phase-7-optional-follow-ons-each-its-own-proposal). Recommended to wait; see "When to start". |
| Author | jasfalk (drafted with Claude) |
| Spec | [SEP-2663: Tasks extension](https://modelcontextprotocol.io/seps/2663-tasks-extension) (Final, Extensions Track), [extensions overview](https://modelcontextprotocol.io/extensions/overview) |
| Packages | `spec/`, `packages/core`, `packages/server`, `packages/client`, `python/`, `packages/rust` |
| Related | [Command progress](../mcp-progress/mcp-progress.proposal.md) (status messages), [MCP confirmations](../../active/mcp-confirmations/mcp-confirmations.proposal.md) (the `input_required` status), [MCP authorization](../mcp-authorization/mcp-authorization.proposal.md) (task access checks), [handoff pattern](../../complete/handoff-pattern/) (AFD's command-level start-and-poll pattern) |

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
- `context.progress` from the [progress proposal](../mcp-progress/mcp-progress.proposal.md) updates `statusMessage`, and `lastUpdatedAt`, instead of sending notifications.
- A confirm-gated command (see [confirmations](../../active/mcp-confirmations/mcp-confirmations.proposal.md)) moves to `input_required`, and continues when `tasks/update` brings an accepted confirmation.
- The result is the same `CallToolResult` that an inline call returns, including `structuredContent`.

### Per language

| Language | Implementation |
|---|---|
| Rust | rmcp's `TaskManager`, behind a store adapter. Pilot first. |
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
| T1 | Start now? | No. Wait for a real long-running command or a TypeScript SDK runtime, and run the Rust pilot first. |
| T2 | How does a command opt in? | `task: 'never' \| 'optional' \| 'required'`, default `'never'`. |
| T3 | Where is task state kept? | A pluggable `TaskStore`. The in-memory default is single-instance only. |
| T4 | How do progress updates appear? | As `statusMessage` updates. |
| T5 | Do tasks need authorization? | On shared servers, yes: bind each task to its principal. A single-user server can rely on unguessable IDs alone. |

## Out of scope

Push notifications through `subscriptions/listen`, tasks for requests other than `tools/call`, the removed `tasks/list` and `tasks/result` from the experimental `2025-11-25` design, and turning the handoff pattern into tasks.

## Sources

- [SEP-2663](https://modelcontextprotocol.io/seps/2663-tasks-extension): negotiation, `CreateTaskResult`, the `Task` shape and statuses, `tasks/get`, `tasks/update` and `tasks/cancel`, `Mcp-Name` routing, and security rules.
- The SDKs as installed: rmcp 3.7.0 (`task_manager.rs`, `model/task.rs`), TypeScript `@modelcontextprotocol/server` 2.4.0 (no task runtime), Python `mcp` 2.3.0 (`mcp/server/extension.py`).
