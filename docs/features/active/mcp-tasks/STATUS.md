# MCP Tasks: status

Epic: [#1553](https://github.com/lushly-dev/afd/issues/1553). File new work for this area as its sub-issue.

Read this before the [proposal](mcp-tasks.proposal.md).

## Delivery

| Phase | State | Evidence / next gate |
| --- | --- | --- |
| 1. Contract | Done | #793; [Tasks](../../../../spec/command-metadata.md#tasks) |
| 2. Rust pilot | Done for the server implementation | #817; `packages/rust/src/server/tasks.rs`, `packages/rust/tests/server_tasks.rs`; bounded pluggable `TaskStore`, owner checks and cancellation |
| 2. Shared todo acceptance case | Done | #2034 ([#1971](https://github.com/lushly-dev/afd/issues/1971)); `packages/examples/todo/spec/task-cases.json` (`--suite tasks --mode modern`), passing against both TypeScript and Rust todo backends (`todo-create-batch` declares `task: 'optional'`) |
| 3. TypeScript server and client | Done | #2034 ([#1971](https://github.com/lushly-dev/afd/issues/1971)); `@lushly-dev/afd-core` (`TaskSupport`, `CommandContext.reportProgress`), `@lushly-dev/afd-server` (`TaskStore`, `InMemoryTaskStore`, `TaskOptions`, `tasks/*`, `tasks.test.ts`, `tasks-client.test.ts`), `@lushly-dev/afd-client` (`McpClient` `tasks: true`, polling, `onTaskProgress`, `getTask`, `cancelTask`, `tasks.test.ts`) |
| 4. Python | Done | #2134 ([#1972](https://github.com/lushly-dev/afd/issues/1972)); `TaskSupport`, `CommandContext.report_progress`/`cancel`, `afd.server.tasks` (`TaskStore`, `InMemoryTaskStore`, `TaskOptions`), `afd.server.tasks_runtime` (`tasks/*` via `mcp` 2.x `Extension` / `MethodBinding`), `McpClient(McpClientConfig(tasks=True))` polling (`get_task`, `cancel_task`, `on_task_progress`), `test_tasks.py`, `test_tasks_client.py`, todo `--suite tasks --mode modern` |

## Implementation departure

Rust uses rmcp's task model and handler hooks, with AFD's owner-checked store, rather than
rmcp's `TaskManager`. The accepted departure is recorded in
[Umbel's step 0e amendments](../../../../endpoints/umbel/docs/phases/5-auth-hosted/spec.md#amendments-from-step-0e).
Rust's `CommandContext::report_progress` updates a task's status message; it does not deliver the
MCP progress notifications proposed by [Command progress](../../proposed/mcp-progress/mcp-progress.proposal.md).
