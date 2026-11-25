---
"afd-python": minor
---

### Added

- Exported public `execute_batch`, `execute_stream`, `CommandExecutor`, `ExecutorOptions`, `StreamExecutorOptions`, `CommandRegistryOptions`, `is_exposed_to`, `is_mcp_exposed`, and `commands_to_mcp_tools` from `afd` and `afd.core` (and executors from `afd.server`), with `execute_batch()` and `execute_stream()` methods on `CommandRegistry`, `MCPServer`, `SimpleRegistry`, and `MockServer`.

### Changed

- Consolidated single-command execution across `CommandRegistry`, `SimpleRegistry`, `MockServer`, and `MCPServer` onto the shared `afd.core.single_executor.execute_command` path, preserving middleware order, exposure, `allow`, contexts, output budgets, cancellation, deadlines, and exception redaction.
- Consolidated `DirectClient.pipe()` onto `afd.core.pipeline.execute_pipeline()`, keeping only a public-shape adapter for `DirectPipelineResult` and legacy string `when` references.
