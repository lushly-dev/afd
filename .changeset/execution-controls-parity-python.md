---
"afd-python": minor
---

### Added

- **Execution controls enforcement parity (`spec/execution-controls.md`, #2129):**
  - `DEFAULT_COMMAND_TIMEOUT_MS` (`30000`), `default_timeout_ms` on `ServerConfig` / `create_server()` (0 or `None` disables; MCP Tasks remain bounded by their task TTL), and per-call `context.timeout` enforcement in `MCPServer` returning `TIMEOUT` (`retryable=True`, `details={"command", "timeoutMs"}`) while signalling `context.signal`.
  - Cooperative cancellation on `CommandContext` (`signal`, `cancel`, `is_cancelled()`): pre-cancelled single commands skip middleware/handlers with `COMMAND_CANCELLED` (`retryable=False`), and `afd-batch` stops scheduling unstarted items on caller cancellation (`COMMAND_CANCELLED`, `durationMs=0`) while allowing in-flight items to finish cooperatively.
  - `DEFAULT_MAX_BATCH_SIZE` (`500`), `DEFAULT_MAX_BATCH_PARALLELISM` (`16`), and `check_batch_limits` exported from `afd` and `afd.core`.
  - `DEFAULT_MAX_VALIDATION_ISSUES` (`100`) and `max_validation_issues` on `ServerConfig` / `create_server()` capping `VALIDATION_ERROR` issue lists with `details.truncated: True`, `details.limit`, `details.totalErrors`, and a truncation notice in `suggestion`.

### Changed

- **Validation issue code catalog (`spec/validation.md`, #2129):** `afd.server.validation` maps Pydantic v2 error types into AFD's nine-code validation issue catalog (`VALIDATION_ISSUE_CODES`, `map_pydantic_issue_code`) instead of leaking raw Pydantic error type strings.
