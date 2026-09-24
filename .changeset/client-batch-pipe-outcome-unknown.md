---
'@lushly-dev/afd-client': minor
---

`McpClient.batch()` and `pipe()` honour their timeouts and no longer claim that commands failed when the outcome is unknown.

- The request now waits for `BatchOptions.timeout` or `PipelineOptions.timeoutMs` plus a 5 second margin (exported as `SERVER_DEADLINE_MARGIN_MS`), and never less than the client `timeout`. Both used to time out at the client `timeout` (30 s by default) while the server kept running.
- **Behavior change:** when the request times out or the connection fails after it was sent, the result is an `OUTCOME_UNKNOWN` failure with `retryable: false` and details of the cause. A batch reports no per-command `results` and zero success and failure counts (it used to report every command as failed); a pipeline carries the error on one pipeline-level step (`index: -1`) instead of marking every step as failed. The server may already have run the writes, so check their effects before retrying.
- When nothing ran (not connected, a JSON-RPC rejection, an HTTP 4xx), the result is still a definite failure, now with the specific code (`NOT_CONNECTED`, `INVALID_INPUT`, ...) instead of `BATCH_ERROR`/`PIPELINE_ERROR`.
- `callTool()` and `request()` take an optional `{ timeout }` (`RequestOptions`) for one request.
