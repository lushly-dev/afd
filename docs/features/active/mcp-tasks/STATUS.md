# MCP Tasks: status

Read this before the [proposal](mcp-tasks.proposal.md). Last reconciled 2026-11-13 against
`main` at `1024546b`, using source and merged history. This audit did not rerun the task suites.

## Delivery

| Phase | State | Evidence / next gate |
| --- | --- | --- |
| 1. Contract | Done | #793; [Tasks](../../../../spec/command-metadata.md#tasks) |
| 2. Rust pilot | Done for the server implementation | #817; `packages/rust/src/server/tasks.rs`, `packages/rust/tests/server_tasks.rs`; bounded pluggable `TaskStore`, owner checks and cancellation |
| 2. Shared todo acceptance case | Not done | Waits for a second language; a Rust-only test does not close this gate |
| 3. TypeScript server and client | Not started | Port against the shared contract and add the common acceptance case |
| 4. Python | Not started | Same contract; server and client behavior remain open |

## Implementation departure

Rust uses rmcp's task model and handler hooks, with AFD's owner-checked store, rather than
rmcp's `TaskManager`. The accepted departure is recorded in
[Umbel's step 0e amendments](../../../../endpoints/umbel/docs/phases/5-auth-hosted/spec.md#amendments-from-step-0e).
Rust's `CommandContext::report_progress` updates a task's status message; it does not deliver the
MCP progress notifications proposed by [Command progress](../../proposed/mcp-progress/mcp-progress.proposal.md).
