---
'@lushly-dev/afd-client': minor
'@lushly-dev/afd-cli': minor
---

Fail closed on unannotated tools in `McpClient.call()` and `afd validate --execute` (#1750, #1755).

- `@lushly-dev/afd-client`: `McpClient.call()` now returns `OUTCOME_UNKNOWN` with `retryable: false` (and the underlying code in `details.cause`) when a timeout, dropped connection, HTTP 5xx, JSON-RPC `-32603`, or failed task poll leaves the outcome unknown for any tool not positively declared `_meta.mutation === false` before dispatch (without contradicting destructive or non-read-only markers). Tools declared `_meta.mutation === false` continue to return retryable `TIMEOUT`, `CONNECTION_ERROR`, `HTTP_5xx`, and `INTERNAL_ERROR` failures.
- `@lushly-dev/afd-cli`: `afd validate --execute` now calls only tools positively marked read-only (`annotations.readOnlyHint === true` or `_meta.mutation === false`, without mutation/destructive/non-read-only markers). Tools without read-only metadata are skipped and reported as `skipped (not marked read-only)`, and combining `--surface` with `--execute` is rejected before connecting.
