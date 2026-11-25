---
"afd-python": minor
---

### Added

- Separate MCP task execution run budget (`max_run_ms`, default 1 hour via `DEFAULT_TASK_MAX_RUN_MS`) from post-completion retention (`ttl_ms`, default 1 hour) in `TaskOptions`. A new task starts with `ttlMs = max_run_ms + ttl_ms` (2 hours by default) and atomically tightens `ttlMs` on terminal transition to `min(max_run_ms, max(0, finished_at - created_at)) + ttl_ms` (capped at `token_expiry_grace_ms` when configured), so results remain readable for a full hour after completion. Tasks still working when `max_run_ms` elapses stop and complete with `TIMEOUT` (`retryable=True` for reads or unstarted tasks, `False` for started mutations), retained for `ttl_ms`.
