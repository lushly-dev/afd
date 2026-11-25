---
"afd-python": patch
---

### Fixed

- **`McpClient.call()`** fails closed to `OUTCOME_UNKNOWN` (`retryable=False`, with the underlying cause in `details["cause"]`) when a timeout, connection/transport loss, HTTP 5xx, JSON-RPC `-32603`, or failed MCP task poll leaves the outcome unknown for any tool not positively declared `_meta.mutation: false` (without contradicting `destructive`, `destructiveHint`, or `readOnlyHint: false`) before dispatch; clears cached tool metadata on reconnect discovery failure; preserves `ToolInfo.annotations` from `tools/list` ([#2319](https://github.com/lushly-dev/afd/issues/2319)).
