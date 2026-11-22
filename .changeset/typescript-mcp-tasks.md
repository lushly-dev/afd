---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-client": minor
---

Implement MCP Tasks (MCP 2026-07-28, SEP-2663) across TypeScript core, server and client (#1971):

- **`@lushly-dev/afd-core`**: Add `TaskSupport` (`'never' | 'optional' | 'required'`), `CommandDefinition.task`, `CommandContext.reportProgress`, `_meta.task` emission in `commandToolMeta`, and registration refusal when `task: 'optional' | 'required'` is combined with `confirmPrompt`, `approval`, or `confirmationMode`.
- **`@lushly-dev/afd-server`**: Add `TaskStore`, bounded `InMemoryTaskStore`, `TaskOptions`, `taskStore`/`taskOptions` on `createMcpServer` and `createMcpHandler`, `tasks/get`, `tasks/update`, and `tasks/cancel` handlers with principal-binding owner checks, caller-identification guards, scope enforcement, `TASK_TOKEN_EXPIRED` handling, cooperative cancellation, progress reporting, and `afd-detail` `task` metadata.
- **`@lushly-dev/afd-client`**: Add `tasks?: boolean` on `McpClientConfig` and `StreamableHttpTransportOptions`, automatic `tasks/get` polling with `onTaskProgress`, `AbortSignal`/timeout cancellation, `getTask`/`cancelTask` methods, and `MISSING_CLIENT_CAPABILITY` mapping for `-32021`.
