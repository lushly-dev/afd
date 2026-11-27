# MCP Tasks: status

Epic: [#1553](https://github.com/lushly-dev/afd/issues/1553) (closed by [#2158](https://github.com/lushly-dev/afd/pull/2158)).

Read this before the [proposal](mcp-tasks.proposal.md).

## Delivery

| Phase | State | Evidence / next gate |
| --- | --- | --- |
| 1. Contract | Done | #793 (`d88b71d7`); [Tasks](../../../../spec/tasks.md), [`TASK_TOKEN_EXPIRED`](../../../../spec/error-codes.md#tasks-profile-tasks) |
| 2. Rust pilot | Done for the server implementation | #817 (`7ae2bc2c`); `packages/rust/src/server/tasks.rs`, `packages/rust/tests/server_tasks.rs`; bounded pluggable `TaskStore`, owner checks and cancellation (Rust has no remote MCP client) |
| 2. Shared todo acceptance case | Done | #2034 ([#1971](https://github.com/lushly-dev/afd/issues/1971)), #2134 ([#1972](https://github.com/lushly-dev/afd/issues/1972)); `packages/examples/todo/spec/task-cases.json` (`--suite tasks --mode modern`), wired in `.github/workflows/conformance.yml` and `scripts/affected/suites.mjs` for TypeScript, Rust and Python (`todo-create-batch` declares `task: 'optional'`) |
| 3. TypeScript server and client | Done | #2034 (`619909ad`, [#1971](https://github.com/lushly-dev/afd/issues/1971)); `@lushly-dev/afd-core` (`TaskSupport`, `CommandContext.reportProgress`), `@lushly-dev/afd-server` (`TaskStore`, `InMemoryTaskStore`, `TaskOptions`, `tasks/*`, `tasks.test.ts`, `tasks-client.test.ts`), `@lushly-dev/afd-client` (`McpClient` `tasks: true`, polling, `onTaskProgress`, `getTask`, `cancelTask`, `tasks.test.ts`) |
| 4. Python | Done | #2134 (`819879cf`, [#1972](https://github.com/lushly-dev/afd/issues/1972)); `TaskSupport`, `CommandContext.report_progress`/`cancel`, `afd.server.tasks` (`TaskStore`, `InMemoryTaskStore`, `TaskOptions`), `afd.server.tasks_runtime` (`tasks/*` via `mcp` 2.x `Extension` / `MethodBinding`), `McpClient(McpClientConfig(tasks=True))` polling (`get_task`, `cancel_task`, `on_task_progress`), `test_tasks.py`, `test_tasks_client.py`, todo `--suite tasks --mode modern` |

## Closure

Feature scope completed on 2026-11-22; epic [#1553](https://github.com/lushly-dev/afd/issues/1553) closes on merge of [#2158](https://github.com/lushly-dev/afd/pull/2158). Verified against `main` at `e28d5629` using merged pull requests, GitHub sub-issue state, file existence, CI workflow configuration, and local Markdown link resolution (implementation test suites were not rerun for this documentation closeout):

- **All four phases merged:** Phase 1 spec (#793), Phase 2 Rust server pilot (#817) and shared todo acceptance suite (#2034, #2134), Phase 3 TypeScript server and client (#2034), Phase 4 Python server and client (#2134). C++ is explicitly not planned (`docs/language-parity.md`).
- **All sub-issues closed:** [#1971](https://github.com/lushly-dev/afd/issues/1971) and [#1972](https://github.com/lushly-dev/afd/issues/1972) are closed as completed; zero open sub-issues remain under [#1553](https://github.com/lushly-dev/afd/issues/1553).
- **Conformance and parity wired:** `packages/examples/todo/spec/task-cases.json` runs for TypeScript, Rust and Python in `.github/workflows/conformance.yml` and `scripts/affected/suites.mjs`; [`spec/command-metadata.md`](../../../../spec/command-metadata.md#implementation-status) and [`docs/language-parity.md`](../../../language-parity.md) record TypeScript, Python and Rust as `Yes` and C++ as `N/A`.
- **Separate / out-of-scope follow-ons (not part of this epic):** confirmations inside tasks (`input_required`, excluded from the 2026-11-07 spec), MCP progress notifications ([Command progress](../../proposed/mcp-progress/mcp-progress.proposal.md)), and a Loam shell surface for long-running tasks ([Loam status](../../../../endpoints/loam/docs/STATUS.md)).

## Implementation departure

Rust uses rmcp's task model and handler hooks, with AFD's owner-checked store, rather than
rmcp's `TaskManager`. The accepted departure is recorded in
[Umbel's step 0e amendments](../../../../endpoints/umbel/docs/phases/5-auth-hosted/spec.md#amendments-from-step-0e).
Rust's `CommandContext::report_progress` updates a task's status message; it does not deliver the
MCP progress notifications proposed by [Command progress](../../proposed/mcp-progress/mcp-progress.proposal.md).
