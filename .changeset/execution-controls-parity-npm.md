---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
---

Enforce execution-controls ceilings and server default deadlines in TypeScript (`spec/execution-controls.md`, #2128):

- **Server default deadline:** `createMcpServer` and `createMcpHandler` enforce `defaultTimeoutMs` (default `DEFAULT_COMMAND_TIMEOUT_MS = 30000`, `0` or `null` disables; MCP Tasks remain bounded by their TTL). Pre-cancelled calls fail before middleware with `COMMAND_CANCELLED` (`retryable: false`).
- **Batch limits:** `executeBatch`, `createCommandRegistry`, `createMcpServer`, `createMcpHandler`, and `createDirectRegistry` enforce `maxBatchSize` (default `DEFAULT_MAX_BATCH_SIZE = 500`) and `maxBatchParallelism` (default `DEFAULT_MAX_BATCH_PARALLELISM = 16`) via `checkBatchLimits`, rejecting over-limit requests before confirmations or command execution with `INVALID_BATCH_REQUEST` (`retryable: false`).
- **Validation issue cap:** `validateInput`, `validateInputEnhanced`, `createMcpServer`, and `createDirectRegistry` cap reported `VALIDATION_ERROR` issues at `maxValidationIssues` (default `DEFAULT_MAX_VALIDATION_ISSUES = 100`), setting `details.truncated: true`, `details.limit`, `details.totalErrors`, and appending an explicit truncation notice to `suggestion`.

Behaviour change: `VALIDATION_ERROR` responses with more than `maxValidationIssues` (default `100`) issues now cap `details.errors` at 100 entries with `details.truncated: true`, `details.limit: 100`, `details.totalErrors`, and a truncation notice in `suggestion`, replacing `issue-count-uncapped` with `issue-count-capped` in `spec/vectors/validation.json` across TypeScript, Python, Rust, and C++ (#2128, #2129, #2130, #2131).
