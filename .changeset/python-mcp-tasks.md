---
"afd-python": minor
---

### Added

- **MCP Tasks (`spec/command-metadata.md`, "Tasks"; SEP-2663)** across core, server and client (#1972):
  - `TaskSupport` (`"never" | "optional" | "required"`), `CommandDefinition.task`, `CommandContext.report_progress`/`cancel`, `task` on `define_command` and `@server.command`, `_meta.task` / grouped `_meta.actions[].task` / `afd-detail` surfacing, and registration refusal beside `confirm_prompt`, an `approval` other than `"not-required"`, or `confirmation_mode`.
  - `afd.server.tasks` (`TaskStore`, bounded `InMemoryTaskStore`, `TaskOptions`, `TaskRecord`, `TaskChange` types) and `afd.server.tasks_runtime` (`tasks/get`, `tasks/update`, `tasks/cancel` via `mcp` 2.x `Extension` / `MethodBinding`), `task_store` and `task_options` on `create_server`, principal-binding owner checks, caller-identification guards, `TASK_TOKEN_EXPIRED` handling, TTL expiry, cooperative cancellation, progress to `statusMessage`, and composite (`afd-batch`/`afd-pipe`) refusal for `task="required"`.
  - `McpClientConfig.tasks` / `create_client(..., tasks=True)` and `StreamableHttpTransport(..., tasks=True)`: `io.modelcontextprotocol/tasks` capability advertisement, `resultType: "task"` interception, `tasks/get` polling with `on_task_progress`, `cancel` / `timeout` / disconnect cleanup, `get_task` / `cancel_task`, and `-32021` -> `MISSING_CLIENT_CAPABILITY` mapping.
